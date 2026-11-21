type Environment = {
  DB: {
    prepare(query: string): {
      bind(id: string, now: number): {
        first<T>(): Promise<T | null>;
      };
    };
  };
};

export default {
  async fetch(request: Request, env: Environment): Promise<Response> {
    const path = new URL(request.url).pathname;
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
