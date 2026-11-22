import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeRepo, pairTelegram, telegramRequest } from '../scripts/connect-telegram.mjs';
import { readTelegramConnection } from '../src/telegram-config.ts';

const makeUpdate = (update_id, type, text, id = 42) => ({ update_id, message: { text, chat: { id, type } } });

test('pairs only a private chat that opens the single-use Start link', async () => {
  const calls = [];
  const result = await pairTelegram(async (method, body) => {
    calls.push([method, body]);
    if (method === 'getMe') return { is_bot: true, username: 'PreviewBot' };
    if (method === 'getWebhookInfo') return { url: '' };
    if (calls.length === 3) return [
      makeUpdate(100, 'private', '/start'),
      makeUpdate(101, 'group', '/start abc_123'),
      makeUpdate(102, 'private', '/start an_old_code')
    ];
    assert.equal(body.offset, 103);
    return [makeUpdate(103, 'private', '/start abc_123', 9876543210)];
  }, url => assert.equal(url, 'https://t.me/PreviewBot?start=abc_123'), { code: 'abc_123' });
  assert.equal(result, '9876543210');
});

test('leaves an existing webhook alone and gives an actionable error', async () => {
  const methods = [];
  await assert.rejects(pairTelegram(async method => {
    methods.push(method);
    return method === 'getMe' ? { is_bot: true, username: 'PreviewBot' } : { url: 'https://example.test' };
  }, () => assert.fail('Did not expect a Start link')), /dedicated preview bot/i);
  assert.deepEqual(methods, ['getMe', 'getWebhookInfo']);
});

test('stops polling at the deadline with no inferred recipient', async () => {
  let now = 0;
  await assert.rejects(pairTelegram(async method => {
    if (method === 'getMe') return { is_bot: true, username: 'PreviewBot' };
    if (method === 'getWebhookInfo') return { url: '' };
    now += 10_000;
    return [makeUpdate(now, 'private', '/start')];
  }, () => {}, { timeoutMs: 20_000, now: () => now }), /timed out waiting for start/i);
  assert.equal(now, 20_000);
});

test('API failures never echo credentials or Telegram response text', async () => {
  const token = '987:abcdefghijklmnopqrstuvwxyz';
  await assert.rejects(telegramRequest(token, 'getMe', {}, async () => {
    throw new Error(token);
  }), error => error.message === 'Could not reach Telegram. Check your internet connection and run setup again.');
  await assert.rejects(telegramRequest(token, 'getMe', {}, async () =>
    Response.json({ ok: false, error_code: 401, description: token }, { status: 401 })
  ), error => error.message === 'Telegram rejected the bot token. Copy the latest token from BotFather and try again.');
});

test('prefers the paired secret and preserves existing deployments', () => {
  assert.deepEqual(readTelegramConnection({
    TELEGRAM_CONNECTION: '{"token":"987:abcdefghijklmnopqrstuvwxyz","chat":"42"}',
    TELEGRAM_BOT_TOKEN: 'old',
    TELEGRAM_CHAT_ID: '-100'
  }), { token: '987:abcdefghijklmnopqrstuvwxyz', chat: '42' });
  assert.deepEqual(readTelegramConnection({ TELEGRAM_BOT_TOKEN: 'old', TELEGRAM_CHAT_ID: '-100' }), { token: 'old', chat: '-100' });
  assert.equal(readTelegramConnection({ TELEGRAM_BOT_TOKEN: 'old' }), undefined);
  assert.throws(() => readTelegramConnection({ TELEGRAM_CONNECTION: '{"token":"sensitive"}' }), /invalid/i);
});

test('accepts a pasted private repository URL or project slug', () => {
  assert.equal(normalizeRepo(' https://github.com/example/project.git/ '), 'example/project');
  assert.equal(normalizeRepo('example/project'), 'example/project');
  assert.throws(() => normalizeRepo('https://unrelated.example/example/project'));
});
