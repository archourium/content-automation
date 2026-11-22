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

test('reviews the delivery JPEG, redraws a rejected scene, and uses the reviewed alt text', async () => {
  const prompts: string[] = [];
  const reviewed: Buffer[] = [];
  const { post, image } = await createPost({ ...profile, imageReview: 'objects-only' }, [], now, {
    async write(system) {
      assert.match(system, /unoccupied still life/i);
      return { trendIndex: null, caption: 'Write one sentence.', altText: 'A hand', imagePrompt: 'A journal' };
    },
    async draw(prompt, options) {
      assert.equal(options?.quality, 'high');
      prompts.push(prompt);
      return sharp({ create: { width: 32, height: 32, channels: 3, background: prompts.length === 1 ? '#554477' : '#cc8866' } }).png().toBuffer();
    },
    async inspectImage(image, instructions) {
      assert.match(instructions, /hands/i);
      reviewed.push(image);
      return reviewed.length === 1
        ? { approved: false, reason: 'There is a detached hand.' }
        : { approved: true, altText: 'A closed journal beside a brass lamp.' };
    }
  });
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /unoccupied still life/i);
  assert.deepEqual(image, reviewed[1]);
  assert.notDeepEqual(image, reviewed[0]);
  assert.equal((await sharp(reviewed[1]).metadata()).width, 1080);
  assert.equal(post.altText, 'A closed journal beside a brass lamp.');
});

test('rejects a second failed review and refuses invalid or missing review results', async () => {
  const reviewedProfile = { ...profile, imageReview: 'objects-only' as const };
  let draws = 0;
  const generator = {
    async write() {
      return { trendIndex: null, caption: 'Write one sentence.', altText: 'A journal', imagePrompt: 'A journal' };
    },
    draw() {
      draws++;
      return sharp({ create: { width: 32, height: 32, channels: 3, background: '#554477' } }).png().toBuffer();
    }
  };
  await assert.rejects(createPost(reviewedProfile, [], now, generator), /requires an image reviewer/);
  assert.equal(draws, 0);
  await assert.rejects(createPost(reviewedProfile, [], now, {
    ...generator,
    async inspectImage() { return { approved: 'true' }; }
  }), /no valid decision/);
  assert.equal(draws, 1);
  await assert.rejects(createPost(reviewedProfile, [], now, {
    ...generator,
    async inspectImage() { return { approved: false, reason: 'Visible body part' }; }
  }), /failed visual review twice/);
  assert.equal(draws, 3);
});

test('reviews editorial illustrations with coherent figures and retries an isolated limb as a still life', async () => {
  const illustration = profileSchema.parse({ ...profile, imageReview: 'editorial-illustration' });
  const prompts: string[] = [];
  const { post } = await createPost(illustration, [], now, {
    async write(system) {
      assert.match(system, /head and torso/i);
      return { trendIndex: null, caption: 'Write one line.', altText: 'A hand', imagePrompt: 'A figure seated at a desk' };
    },
    draw(prompt) {
      prompts.push(prompt);
      return sharp({ create: { width: 32, height: 32, channels: 3, background: '#443399' } }).png().toBuffer();
    },
    async inspectImage(_image, instructions) {
      assert.match(instructions, /detached hands/i);
      assert.match(instructions, /photographs/i);
      assert.doesNotMatch(instructions, /reject any visible person/i);
      return prompts.length === 1
        ? { approved: false, reason: 'Detached hand.' }
        : { approved: true, altText: 'A notebook beside an amber lamp.' };
    }
  });
  assert.match(prompts[0], /head and torso/i);
  assert.match(prompts[1], /unoccupied still life/i);
  assert.doesNotMatch(prompts[1], /figure seated at a desk/i);
  assert.equal(post.altText, 'A notebook beside an amber lamp.');
});

test('redrafts a short caption and stops before rendering if the retry is also short', async () => {
  const caption = 'When you close a tab to take a break, write the first thing you will do when you return.';
  const captionProfile = { ...profile, captionMinWords: 12 };
  const draft = { trendIndex: null, caption: 'Take a break.', altText: 'A journal', imagePrompt: 'A journal' };
  let writes = 0;
  const generator = {
    async write() {
      writes++;
      return writes === 2 ? { ...draft, caption } : draft;
    },
    draw: () => sharp({ create: { width: 32, height: 32, channels: 3, background: '#554477' } }).png().toBuffer()
  };
  assert.equal((await createPost(captionProfile, [], now, generator)).post.caption, caption);
  assert.equal(writes, 2);
  await assert.rejects(createPost(captionProfile, [], now, {
    ...generator,
    draw() { throw new Error('The short caption should never reach the image model.'); }
  }), /caption did not meet the minimum/);
  assert.equal(writes, 4);
});
