#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';

export async function telegramRequest(token, method, body = {}, fetchRequest = fetch) {
  let response;
  try {
    response = await fetchRequest(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(16_000)
    });
  } catch {
    throw new Error('Telegram belum dapat dihubungi. Periksa internet, lalu buka setup lagi.');
  }
  const result = await response.json().catch(() => null);
  const code = result?.error_code ?? response.status;
  if (code === 401 || code === 404) {
    throw new Error('Token bot ditolak. Salin token terbaru dari BotFather dan coba lagi.');
  }
  if (code === 409) {
    throw new Error('Bot ini sedang digunakan aplikasi lain. Pakai bot khusus preview atau hentikan aplikasi tersebut sebelum mencoba lagi.');
  }
  if (!response.ok || !result?.ok) throw new Error(`Telegram ${method} failed (HTTP ${response.status}).`);
  return result.result;
}

export async function pairTelegram(request, presentLink, {
  code = randomBytes(24).toString('base64url'),
  timeoutMs = 180_000,
  now = Date.now
} = {}) {
  const bot = await request('getMe');
  if (!bot?.is_bot || !/^[A-Za-z0-9_]{5,32}$/.test(bot.username)) {
    throw new Error('Telegram returned an invalid bot profile.');
  }
  const webhook = await request('getWebhookInfo');
  if (webhook?.url) throw new Error('Bot ini sudah digunakan oleh webhook lain. Buat bot khusus preview melalui BotFather.');

  const link = `https://t.me/${bot.username}?start=${code}`;
  const deadline = now() + timeoutMs;
  presentLink(link);

  let offset;
  while (now() < deadline) {
    const timeout = Math.min(10, Math.max(0, Math.floor((deadline - now()) / 1000)));
    const updates = await request('getUpdates', { offset, timeout, allowed_updates: ['message'] });
    if (!Array.isArray(updates)) throw new Error('Telegram returned an invalid set of updates.');
    if (now() >= deadline) break;
    for (const update of updates) {
      if (Number.isSafeInteger(update.update_id)) offset = Math.max(offset ?? 0, update.update_id + 1);
      const message = update.message;
      if (message?.chat?.type === 'private' && message.text === `/start ${code}` &&
          Number.isSafeInteger(message.chat.id) && message.chat.id > 0) {
        return String(message.chat.id);
      }
    }
  }
  throw new Error('Waktu untuk menekan Start habis. Buka setup lagi untuk mendapatkan tautan baru.');
}

function readToken() {
  if (!process.stdin.isTTY) throw new Error('Klik dua kali Mulai Setup Telegram.cmd untuk memasukkan token.');
  process.stdout.write('Tempel token bot, lalu tekan Enter (token disembunyikan): ');
  return new Promise((resolve, reject) => {
    let input = '';
    const originalRaw = process.stdin.isRaw;
    function finish(error) {
      process.stdin.off('data', onInput);
      process.stdin.setRawMode(originalRaw);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(input.trim());
    }
    function onInput(buffer) {
      for (const character of buffer.toString()) {
        if (character === '\u0003') return finish(new Error('Setup dibatalkan.'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') input = input.slice(0, -1);
        else if (/^[\x20-\x7e]$/.test(character)) input += character;
      }
    }
    process.stdin.setRawMode(true);
    process.stdin.on('data', onInput);
    process.stdin.resume();
  });
}

function github(args, input, failureMessage) {
  const result = spawnSync('gh', args, { input, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  if (result.error?.code === 'ENOENT') throw new Error('Install GitHub CLI (gh), then run gh auth login.');
  if (result.status !== 0) throw new Error(failureMessage);
  return result.stdout;
}

function openLink(link) {
  const command = {
    win32: ['rundll32.exe', 'url.dll,FileProtocolHandler'],
    darwin: ['open'],
    linux: ['xdg-open']
  }[process.platform];
  if (!command) return;
  const [program, ...args] = command;
  const browser = spawn(program, [...args, link], { stdio: 'ignore', windowsHide: true });
  browser.on('error', () => {}); // The printed link also works if the browser cannot be launched.
  browser.unref();
}

async function ask(question) {
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await input.question(question)).trim(); }
  finally { input.close(); }
}

export function normalizeRepo(value) {
  if (typeof value !== 'string') throw new Error('Masukkan alamat repo GitHub privat milik proyek Anda.');
  const slug = value.trim().replace(/^https:\/\/github\.com\//i, '').replace(/\/$/, '').replace(/\.git$/, '');
  if (!/^[\w-]+\/[\w.-]+$/.test(slug)) throw new Error('Alamat repo belum sesuai. Contoh: https://github.com/nama/proyek-privat');
  return slug;
}

async function projectRepository() {
  try {
    const manifest = JSON.parse(await readFile('package.json', 'utf8'));
    return manifest.contentAutomation?.repository;
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw new Error('File package.json di folder proyek tidak bisa dibaca.');
  }
}

async function main() {
  const { values } = parseArgs({
    options: { repo: { type: 'string' }, check: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } }
  });
  if (values.help) {
    console.log('Usage: node connect-telegram.mjs [--repo OWNER/PRIVATE_REPO] [--check]');
    return;
  }

  let destination = values.repo ?? await projectRepository();
  if (!destination && process.stdin.isTTY && !values.check) {
    destination = await ask('Tempel alamat GitHub repo privat tempat otomatisasi proyek Anda berjalan: ');
  }
  const slug = normalizeRepo(destination);
  const repository = `github.com/${slug}`;
  console.log(`Langkah 1. Memeriksa akses GitHub untuk ${slug}.`);
  if (!values.check && process.stdin.isTTY) {
    const auth = spawnSync('gh', ['auth', 'status', '--active', '--hostname', 'github.com'], {
      stdio: 'ignore', windowsHide: true, timeout: 30_000
    });
    if (auth.error?.code === 'ENOENT') throw new Error('Pasang GitHub CLI dari https://cli.github.com/ lalu buka setup lagi.');
    if (auth.status !== 0) {
      await ask('Tekan Enter untuk masuk ke GitHub lewat browser. ');
      const login = spawnSync('gh', ['auth', 'login', '--hostname', 'github.com', '--web', '--git-protocol', 'https'], { stdio: 'inherit' });
      if (login.status !== 0) throw new Error('Login GitHub belum selesai. Buka setup lagi setelah berhasil masuk.');
    }
  }
  const privateRepo = JSON.parse(github(['repo', 'view', repository, '--json', 'visibility'], undefined,
    `Repo ${slug} tidak bisa dibuka. Periksa koneksi internet dan akses akun GitHub Anda.`));
  if (privateRepo.visibility !== 'PRIVATE') throw new Error('Pilih repo privat untuk menyimpan koneksi Telegram.');
  github(['secret', 'list', '--repo', repository], undefined, 'Akun GitHub ini belum bisa mengakses secrets di repo tujuan.');
  if (values.check) {
    console.log('Setup siap. Repo tujuan dapat diakses.');
    return;
  }

  console.log('\nLangkah 2. Siapkan token dari BotFather. Jika belum punya token, tekan Enter untuk membuka BotFather.');
  let token = process.env.TELEGRAM_BOT_TOKEN?.trim() || await readToken();
  if (!token) {
    console.log('Di https://t.me/BotFather, pilih /newbot lalu ikuti petunjuk. Salin token dan kembali ke sini.');
    openLink('https://t.me/BotFather');
    token = await readToken();
  }
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) throw new Error('Format token belum sesuai. Salin seluruh token dari BotFather dan buka setup lagi.');
  const request = (method, payload) => telegramRequest(token, method, payload);
  console.log("\nLangkah 3. Tekan Start di Telegram untuk memilih chat pribadi Anda.");
  const chat = await pairTelegram(request, link => {
    console.log("Jika Telegram belum terbuka, buka tautan ini dalam 3 menit:\n" + link);
    openLink(link);
  });

  github(['secret', 'set', 'TELEGRAM_CONNECTION', '--repo', repository],
    JSON.stringify({ token, chat }), 'Koneksi belum bisa disimpan di GitHub. Periksa akses ke repo dan buka setup lagi.');
  console.log(`Koneksi Telegram tersimpan di ${slug}.`);
  try {
    await request('sendMessage', { chat_id: chat, text: 'Telegram sudah tersambung. Preview konten akan dikirim ke chat ini.' });
    console.log('Selesai. Cek pesan tes di Telegram. Jendela ini sudah bisa ditutup.');
  } catch {
    throw new Error('Koneksi tersimpan. Pesan tes gagal terkirim. Pastikan bot dapat mengirim pesan ke chat Anda, lalu jalankan telegram-check di GitHub Actions.');
  }
}

if (import.meta.main) {
  await main().catch(error => {
    console.error(error instanceof Error ? error.message : 'Telegram setup failed.');
    process.exitCode = 1;
  });
}
