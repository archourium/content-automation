import { randomUUID } from 'node:crypto';
import type { Trend } from './engine.ts';
import { cloudflare, requestJson } from './providers.ts';
import { storageQueries } from './storage-queries.ts';

export type Publication = { container_id: string; media_id: string | null; status: 'pending' | 'published' };
type SqlResult = { success: boolean; results: unknown[] };

export function storage(account: string, token: string, database: string, mediaBase: string, mediaStorageToken?: string) {
  const api = cloudflare(account, token);
  const mediaOrigin = new URL(mediaBase);
  if (mediaOrigin.protocol !== 'https:' || mediaOrigin.username || mediaOrigin.password) {
    throw new Error('MEDIA_BASE_URL must be an HTTPS URL.');
  }
  async function query<T = never>(sql: string, params: (string | number | null)[]) {
    const result = mediaStorageToken
      ? await requestJson<SqlResult>('Media storage', new URL('/internal/query', mediaOrigin).href, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + mediaStorageToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql, params })
      })
      : (await api<SqlResult[]>(`/d1/database/${encodeURIComponent(database)}/query`,
        { sql, params }, 'Cloudflare D1'))[0];
    if (!result?.success) throw new Error('D1 query failed.');
    return result.results as T[];
  }
  return {
    async saveTrends(region: string, day: string, trends: Trend[]) {
      await query(storageQueries.saveTrends,
        [region, day, JSON.stringify(trends)]);
    },
    async getTrends(region: string, since: string): Promise<Trend[]> {
      const rows = await query<{ trends: string }>(storageQueries.getTrends, [region, since]);
      return rows.flatMap(row => JSON.parse(row.trends) as Trend[]);
    },
    async upload(image: Buffer) {
      await query(storageQueries.removeExpiredImages, [Date.now()]);
      const id = randomUUID();
      await query(storageQueries.addImage, [id, image.toString('base64'), Date.now() + 86_400_000]);
      const url = new URL(`/media/${id}.jpg`, mediaOrigin);
      const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(20_000) });
      if (!response.ok || response.headers.get('content-type') !== 'image/jpeg') {
        throw new Error('The media Worker could not serve the generated JPEG.');
      }
      return url.href;
    },
    async lookup(accountId: string, day: string): Promise<Publication | undefined> {
      const [row] = await query<Publication>(storageQueries.lookupPublication, [accountId, day]);
      return row;
    },
    async claim(accountId: string, day: string, container: string) {
      const rows = await query(storageQueries.claimPublication,
        [accountId, day, container]);
      return rows.length === 1;
    },
    async complete(accountId: string, day: string, media: string | null) {
      await query(storageQueries.completePublication, [media, accountId, day]);
    }
  };
}
