#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
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
    throw new Error('Could not reach the Telegram Bot API.');
  }
  const result = await response.json().catch(() => null);
  const code = result?.error_code ?? response.status;
  if (code === 401 || code === 404) {
    throw new Error('Telegram rejected the bot token. Copy the current token from BotFather.');
  }
  if (code === 409) {
    throw new Error('Telegram is already receiving updates for this bot elsewhere. Use a dedicated bot or stop its other polling session.');
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
  if (webhook?.url) throw new Error('This bot already uses a webhook. Create a dedicated bot for previews in BotFather.');

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
  throw new Error('Telegram pairing timed out. Run setup again and press Start in the new link.');
}

function readToken() {
  if (!process.stdin.isTTY) throw new Error('Run this command in an interactive terminal.');
  process.stdout.write('Paste the BotFather token and press Enter (input hidden): ');
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

function openTelegram(link) {
  console.log(`\nOpen this one-time link and press Start within 3 minutes:\n${link}\n`);
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

async function main() {
  const { values } = parseArgs({
    options: { repo: { type: 'string' }, help: { type: 'boolean', short: 'h' } }
  });
  if (values.help) {
    console.log('Usage: node connect-telegram.mjs --repo OWNER/PRIVATE_REPO');
    return;
  }
  if (!values.repo || !/^[\w-]+\/[\w.-]+$/.test(values.repo)) {
    throw new Error('Pass --repo OWNER/PRIVATE_REPO. Use your deployment repository.');
  }

  const repository = `github.com/${values.repo}`;
  const privateRepo = JSON.parse(github(['repo', 'view', repository, '--json', 'visibility'], undefined,
    'Cannot open the deployment repository. Run gh auth login and check the repository name and account.'));
  if (privateRepo.visibility !== 'PRIVATE') throw new Error('Choose the private deployment repository.');
  github(['secret', 'list', '--repo', repository], undefined, 'This GitHub account cannot manage secrets in the deployment repository.');

  const token = process.env.TELEGRAM_BOT_TOKEN?.trim() || await readToken();
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) throw new Error('Enter a bot token from BotFather.');
  const request = (method, payload) => telegramRequest(token, method, payload);
  const chat = await pairTelegram(request, openTelegram);

  github(['secret', 'set', 'TELEGRAM_CONNECTION', '--repo', repository],
    JSON.stringify({ token, chat }), 'Could not save the Telegram connection. Verify GitHub access and run setup again.');
  console.log(`Telegram connection saved in ${values.repo}.`);
  try {
    await request('sendMessage', { chat_id: chat, text: 'Telegram is connected. Content previews can be sent to this chat.' });
    console.log('Test message delivered.');
  } catch {
    throw new Error('Connection saved, but Telegram could not deliver the test message. Check that the bot is unblocked and run the Telegram test workflow.');
  }
}

if (import.meta.main) {
  await main().catch(error => {
    console.error(error instanceof Error ? error.message : 'Telegram setup failed.');
    process.exitCode = 1;
  });
}
