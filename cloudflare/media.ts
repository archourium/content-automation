import { timingSafeEqual } from 'node:crypto';
import { storageQueries } from '../src/storage-queries.ts';

const supportedQueries = new Set(Object.values(storageQueries));

type Parameter = string | number | null;
type Environment = {
  MEDIA_STORAGE_TOKEN?: string;
  DB: {
    prepare(query: string): {
      bind(...parameters: Parameter[]): {
        first<T>(): Promise<T | null>;
        all<T>(): Promise<{ success: boolean; results: T[] }>;
      };
    };
  };
};

function authorized(request: Request, token?: string) {
  if (!token) return false;
  const received = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from('Bearer ' + token);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

async function queryDatabase(request: Request, env: Environment) {
  if (request.method !== 'POST' || !env.MEDIA_STORAGE_TOKEN) return new Response(null, { status: 404 });
  if (!authorized(request, env.MEDIA_STORAGE_TOKEN)) return new Response(null, { status: 401 });
  if (Number(request.headers.get('content-length')) > 900_000) return new Response(null, { status: 413 });

  const payload = await request.json().then(value => value as { sql?: unknown; params?: unknown } | null).catch(() => null);
  if (typeof payload?.sql !== 'string' || !supportedQueries.has(payload.sql) ||
      !Array.isArray(payload.params) || payload.params.length > 10 ||
      !payload.params.every(value => value === null || typeof value === 'number' || typeof value === 'string')) {
    return new Response(null, { status: 400 });
  }
  try {
    const result = await env.DB.prepare(payload.sql).bind(...payload.params).all();
    return Response.json({ success: result.success, results: result.results }, {
      headers: { 'Cache-Control': 'no-store' }
    });
  } catch {
    return new Response(null, { status: 502 });
  }
}

export default {
  async fetch(request: Request, env: Environment): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/internal/query') return queryDatabase(request, env);

    const id = /^\/media\/([a-f0-9-]{36})\.jpg$/.exec(path)?.[1];
    if (!id || !['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 404 });
    const row = await env.DB.prepare('SELECT jpeg FROM images WHERE id = ? AND expires_at > ?')
      .bind(id, Date.now()).first<{ jpeg: string }>();
    if (!row) return new Response(null, { status: 404 });
    const bytes = request.method === 'HEAD' ? null : Buffer.from(row.jpeg, 'base64');
    return new Response(bytes, {
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' }
    });
  }
};
