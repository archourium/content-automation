import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import sharp from 'sharp';
import { createPost, localDate, parseTrends, profileSchema, recentTrends } from '../src/engine.ts';
import { publishPost } from '../src/publish.ts';
import type { Publication } from '../src/storage.ts';

const profile = profileSchema.parse(JSON.parse(await readFile('profiles/example.json', 'utf8')));
const now = new Date('2026-11-21T18:00:00Z');
const rss = '<rss><channel><item><title>Writing &amp; reading</title><pubDate>Sat, 21 Nov 2026 08:00:00 GMT</pubDate><ht:approx_traffic>2000+</ht:approx_traffic></item></channel></rss>';

test('parses RSS and uses local calendar days, deduplicating snapshots', () => {
  const timeZone = 'Asia/Makassar';
  assert.equal(localDate(now, timeZone), '2026-11-22');
  const [trend] = parseTrends(rss);
  assert.equal(trend.title, 'Writing & reading');
  assert.deepEqual(recentTrends([trend, trend, { ...trend, date: '2026-11-20T08:00:00Z' }], now, timeZone), [trend]);
});

test('generates a square JPEG and falls back when no trend fits', async () => {
  const { post, image } = await createPost(profile, parseTrends(rss), now, {
    async write(_instructions, input) {
      assert.equal(JSON.parse(input).trends.length, 1);
      return { trendIndex: null, caption: 'Write one sentence.', altText: 'An illustration', imagePrompt: 'A notebook' };
    },
    draw: () => sharp({ create: { width: 48, height: 32, channels: 3, background: '#443399' } }).png().toBuffer()
  });
  assert.ok(profile.fallbackTopics.includes(post.topic));
  const { format, width, height } = await sharp(image).metadata();
  assert.deepEqual({ format, width, height }, { format: 'jpeg', width: 1080, height: 1080 });
});

test('a repeated run reconciles an uncertain publish without sending another', async () => {
  let row: Publication | undefined;
  let publishCalls = 0;
  let status = 'FINISHED';
  const api = {
    async create() { return { id: 'container' }; },
    async status() { return { status_code: status }; },
    async publish() { publishCalls++; throw new Error('Response lost'); }
  };
  const store = {
    async upload() { return 'https://example.com/post.jpg'; },
    async lookup() { return row; },
    async claim() {
      if (row) return false;
      row = { container_id: 'container', media_id: null, status: 'pending' };
      return true;
    },
    async complete() { row = { container_id: 'container', media_id: null, status: 'published' }; }
  };
  const post = { topic: 'topic', imagePrompt: 'prompt', caption: 'caption', altText: 'alt' };
  const run = () => publishPost(api, store, '123', '2026-11-22', post, Buffer.alloc(5));
  await assert.rejects(run, /Response lost/);
  await assert.rejects(run, /publication is unresolved/);
  status = 'PUBLISHED';
  assert.deepEqual(await run(), { status: 'already-published' });
  assert.equal(row?.status, 'published');
  assert.equal(publishCalls, 1);
});
