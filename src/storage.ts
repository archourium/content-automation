import { randomUUID } from 'node:crypto';
import type { Trend } from './engine.ts';
import { cloudflare } from './providers.ts';

export type Publication = { container_id: string; media_id: string | null; status: 'pending' | 'published' };
type SqlResult = { success: boolean; results: unknown[] };

export function storage(account: string, token: string, database: string, mediaBase: string) {
  const api = cloudflare(account, token);
  const mediaOrigin = new URL(mediaBase);
  if (mediaOrigin.protocol !== 'https:' || mediaOrigin.username || mediaOrigin.password) {
    throw new Error('MEDIA_BASE_URL must be an HTTPS URL.');
  }
  async function query<T = never>(sql: string, params: (string | number | null)[]) {
    const [result] = await api<SqlResult[]>(`/d1/database/${encodeURIComponent(database)}/query`,
      { sql, params }, 'Cloudflare D1');
    if (!result?.success) throw new Error('D1 query failed.');
    return result.results as T[];
  }
  return {
    async saveTrends(region: string, day: string, trends: Trend[]) {
      await query('INSERT INTO trend_snapshots VALUES (?, ?, ?) ON CONFLICT(region, day) DO UPDATE SET trends = excluded.trends',
        [region, day, JSON.stringify(trends)]);
    },
    async getTrends(region: string, since: string): Promise<Trend[]> {
      const rows = await query<{ trends: string }>('SELECT trends FROM trend_snapshots WHERE region = ? AND day >= ? ORDER BY day DESC', [region, since]);
      return rows.flatMap(row => JSON.parse(row.trends) as Trend[]);
    },
    async upload(image: Buffer) {
      await query('DELETE FROM images WHERE expires_at <= ?', [Date.now()]);
      const id = randomUUID();
      await query('INSERT INTO images VALUES (?, ?, ?)', [id, image.toString('base64'), Date.now() + 86_400_000]);
      const url = new URL(`/media/${id}.jpg`, mediaOrigin);
      const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(20_000) });
      if (!response.ok || response.headers.get('content-type') !== 'image/jpeg') {
        throw new Error('The media Worker could not serve the generated JPEG.');
      }
      return url.href;
    },
    async lookup(accountId: string, day: string): Promise<Publication | undefined> {
      const [row] = await query<Publication>('SELECT container_id, media_id, status FROM publications WHERE account = ? AND day = ?', [accountId, day]);
      return row;
    },
    async claim(accountId: string, day: string, container: string) {
      const rows = await query('INSERT INTO publications (account, day, container_id, status) VALUES (?, ?, ?, \'pending\') ON CONFLICT(account, day) DO NOTHING RETURNING container_id',
        [accountId, day, container]);
      return rows.length === 1;
    },
    async complete(accountId: string, day: string, media: string | null) {
      await query("UPDATE publications SET status = 'published', media_id = COALESCE(?, media_id) WHERE account = ? AND day = ?", [media, accountId, day]);
    }
  };
}
