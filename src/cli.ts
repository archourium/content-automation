import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { createPost, fetchTrends, localDate, profileSchema, recentTrends } from './engine.ts';
import type { Generator } from './engine.ts';
import { instagram, telegram, workersAI } from './providers.ts';
import { checkPublication, publishPost } from './publish.ts';
import { storage } from './storage.ts';

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}.`);
  return value;
}

const placeholder: Generator = {
  async write(_system, input) {
    const { profile, fallback } = JSON.parse(input);
    return {
      trendIndex: null,
      caption: `Test preview for ${profile.name}\n\n${fallback}`,
      imagePrompt: 'Fixture image',
      altText: 'Indigo preview image used to test the publication pipeline.'
    };
  },
  draw: () => sharp({ create: { width: 1080, height: 1080, channels: 3, background: '#151132' } })
    .jpeg().toBuffer()
};

async function main() {
  const { values } = parseArgs({
    options: {
      profile: { type: 'string', default: 'profiles/example.json' },
      mode: { type: 'string', default: 'preview' },
      output: { type: 'string', default: 'output' },
      fixture: { type: 'boolean' }
    }
  });
  const mode = values.mode;
  if (mode !== 'preview' && mode !== 'telegram' && mode !== 'instagram') throw new Error('Use preview, telegram, or instagram mode.');
  if (values.fixture && mode !== 'preview') throw new Error('Fixture generation is available only in preview mode.');

  const profile = profileSchema.parse(JSON.parse(await readFile(values.profile, 'utf8')));
  const now = new Date();
  const day = localDate(now, profile.timeZone);
  const previousDay = localDate(new Date(Date.parse(day) - 86_400_000), 'UTC');
  const account = mode === 'instagram' ? required('INSTAGRAM_ACCOUNT_ID') : undefined;
  const api = account ? instagram(account, required('INSTAGRAM_ACCESS_TOKEN'), process.env.INSTAGRAM_API_VERSION) : undefined;
  const store = account ? storage(required('CLOUDFLARE_ACCOUNT_ID'), required('CLOUDFLARE_API_TOKEN'),
    required('CLOUDFLARE_D1_ID'), required('MEDIA_BASE_URL')) : undefined;
  if (api && store && account && await checkPublication(api, store, account, day)) {
    console.log('This Instagram account already published today.');
    return;
  }

  const generator = values.fixture ? placeholder : workersAI(required('CLOUDFLARE_ACCOUNT_ID'), required('CLOUDFLARE_API_TOKEN'));
  const telegramCredentials = mode === 'telegram'
    ? { token: required('TELEGRAM_BOT_TOKEN'), chat: required('TELEGRAM_CHAT_ID') } : undefined;
  const current = await fetchTrends(profile.region).catch((error: unknown) => {
    console.warn(error instanceof Error ? error.message : 'Could not read Google Trends.');
    return [];
  });
  console.log(`Fetched ${current.length} trend items for ${profile.region}.`);
  if (store && current.length) await store.saveTrends(profile.region, day, current);
  const history = store ? await store.getTrends(profile.region, previousDay) : [];
  const trends = recentTrends([...current, ...history], now, profile.timeZone);

  try {
    const { post, image } = await createPost(profile, trends, now, generator);
    await mkdir(values.output, { recursive: true });
    const prefix = join(values.output, `${profile.id}-${day}`);
    await writeFile(`${prefix}.jpg`, image);
    await writeFile(`${prefix}.json`, JSON.stringify({ fixture: Boolean(values.fixture), day, trendCount: trends.length, ...post }, null, 2));
    if (api && store && account) console.log(await publishPost(api, store, account, day, post, image));
    if (telegramCredentials) await telegram(telegramCredentials.token, telegramCredentials.chat, image, post.caption);
    console.log(`Saved ${prefix}.jpg and .json.`);
  } catch (error) {
    if (mode === 'instagram' && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      const note = 'Daily Instagram publication failed. See the private workflow run.';
      const endpoint = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: note }),
        signal: AbortSignal.timeout(10_000)
      }).catch(() => {});
    }
    throw error;
  }
}

await main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Unexpected automation error.');
  process.exitCode = 1;
});
