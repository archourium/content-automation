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
    throw new Error('Could not reach Telegram. Check your internet connection and run setup again.');
  }
  const result = await response.json().catch(() => null);
  const code = result?.error_code ?? response.status;
  if (code === 401 || code === 404) {
    throw new Error('Telegram rejected the bot token. Copy the latest token from BotFather and try again.');
  }
  if (code === 409) {
    throw new Error('Another application is using this bot. Use a dedicated preview bot or stop the other application and try again.');
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
  if (webhook?.url) throw new Error('This bot already has a webhook. Create a dedicated preview bot through BotFather.');

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
  throw new Error('Timed out waiting for Start. Run setup again to get a fresh link.');
}

function readToken() {
  if (!process.stdin.isTTY) throw new Error('Double-click Set Up Telegram.cmd to enter the token.');
  process.stdout.write('Paste the bot token and press Enter (input is hidden): ');
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
        if (character === '\u0003') return finish(new Error('Setup cancelled.'));
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
  if (typeof value !== 'string') throw new Error('Enter the private GitHub repository for your project.');
  const slug = value.trim().replace(/^https:\/\/github\.com\//i, '').replace(/\/$/, '').replace(/\.git$/, '');
  if (!/^[\w-]+\/[\w.-]+$/.test(slug)) throw new Error('Enter a valid URL, for example https://github.com/owner/private-project');
  return slug;
}

async function projectRepository() {
  try {
    const manifest = JSON.parse(await readFile('package.json', 'utf8'));
    return manifest.contentAutomation?.repository;
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw new Error('Could not read package.json in the project folder.');
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
    destination = await ask('Paste the URL of the private GitHub repository that runs your automation: ');
  }
  const slug = normalizeRepo(destination);
  const repository = `github.com/${slug}`;
  console.log(`Step 1. Checking GitHub access for ${slug}.`);
  if (!values.check && process.stdin.isTTY) {
    const auth = spawnSync('gh', ['auth', 'status', '--active', '--hostname', 'github.com'], {
      stdio: 'ignore', windowsHide: true, timeout: 30_000
    });
    if (auth.error?.code === 'ENOENT') throw new Error('Install GitHub CLI from https://cli.github.com/ and run setup again.');
    if (auth.status !== 0) {
      await ask('Press Enter to sign in to GitHub in your browser. ');
      const login = spawnSync('gh', ['auth', 'login', '--hostname', 'github.com', '--web', '--git-protocol', 'https'], { stdio: 'inherit' });
      if (login.status !== 0) throw new Error('GitHub sign-in did not finish. Sign in and run setup again.');
    }
  }
  const privateRepo = JSON.parse(github(['repo', 'view', repository, '--json', 'visibility'], undefined,
    `Could not open ${slug}. Check your internet connection and GitHub account access.`));
  if (privateRepo.visibility !== 'PRIVATE') throw new Error('Choose a private repository for the Telegram connection.');
  github(['secret', 'list', '--repo', repository], undefined, 'This GitHub account cannot access the target repository secrets.');
  if (values.check) {
    console.log('Setup is ready. The target repository is accessible.');
    return;
  }

  console.log('\nStep 2. Get your token from BotFather. Press Enter to open BotFather if you need to create a token.');
  let token = process.env.TELEGRAM_BOT_TOKEN?.trim() || await readToken();
  if (!token) {
    console.log('At https://t.me/BotFather, send /newbot and follow the instructions. Copy the token and return here.');
    openLink('https://t.me/BotFather');
    token = await readToken();
  }
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) throw new Error('The token format is invalid. Copy the entire token from BotFather and run setup again.');
  const request = (method, payload) => telegramRequest(token, method, payload);
  console.log("\nStep 3. Press Start in Telegram to pair your private chat.");
  const chat = await pairTelegram(request, link => {
    console.log("If Telegram did not open, open this link within 3 minutes:\n" + link);
    openLink(link);
  });

  github(['secret', 'set', 'TELEGRAM_CONNECTION', '--repo', repository],
    JSON.stringify({ token, chat }), 'Could not save the connection in GitHub. Check your repository access and run setup again.');
  console.log(`Saved the Telegram connection in ${slug}.`);
  try {
    await request('sendMessage', { chat_id: chat, text: 'Telegram is connected. Content previews will appear in this chat.' });
    console.log('Setup is complete. Check Telegram for the test message. You can close this window.');
  } catch {
    throw new Error('The connection is saved, but the test message failed. Check that the bot can message you, then run telegram-check in GitHub Actions.');
  }
}

if (import.meta.main) {
  await main().catch(error => {
    console.error(error instanceof Error ? error.message : 'Telegram setup failed.');
    process.exitCode = 1;
  });
}
