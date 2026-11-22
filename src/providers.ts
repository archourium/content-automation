import type { Generator } from './engine.ts';

export async function requestJson<T>(service: string, url: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...options, signal: options.signal ?? AbortSignal.timeout(90_000) });
  } catch {
    throw new Error(`${service} request failed or timed out.`);
  }
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    const code = error?.error?.code ?? error?.errors?.[0]?.code ?? error?.error_code;
    const detail = Number.isInteger(code) ? `, API code ${code}` : '';
    throw new Error(`${service} returned HTTP ${response.status}${detail}.`);
  }
  return response.json() as Promise<T>;
}

export function cloudflare(account: string, token: string) {
  const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}`;
  return async <T>(path: string, body: unknown, service: string) => {
    const headers = new Headers({ Authorization: `Bearer ${token}` });
    if (!(body instanceof FormData)) headers.set('Content-Type', 'application/json');
    const envelope = await requestJson<{ success: boolean; result: T }>(service, base + path, {
      method: 'POST',
      headers,
      body: body instanceof FormData ? body : JSON.stringify(body)
    });
    if (!envelope.success) throw new Error(`${service} rejected the request.`);
    return envelope.result;
  };
}

export function workersAI(account: string, token: string): Generator {
  const api = cloudflare(account, token);
  return {
    async write(system, input) {
      const result = await api<{ choices?: { message?: { content?: string } }[] }>(
        '/ai/run/@cf/zai-org/glm-4.7-flash',
        {
          messages: [{ role: 'system', content: system }, { role: 'user', content: input }],
          response_format: { type: 'json_object' },
          max_completion_tokens: 1800,
          chat_template_kwargs: { enable_thinking: false }
        },
        'Workers AI text'
      );
      const content = result.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('Workers AI returned no caption.');
      return JSON.parse(content);
    },
    async draw(prompt, options) {
      const multipart = new FormData();
      multipart.set('prompt', prompt);
      multipart.set('width', '1024');
      multipart.set('height', '1024');
      const highQuality = options?.quality === 'high';
      const result = await api<{ image?: string }>(
        highQuality ? '/ai/run/@cf/black-forest-labs/flux-2-klein-9b' : '/ai/run/@cf/black-forest-labs/flux-1-schnell',
        highQuality ? multipart : { prompt, steps: 4 },
        'Workers AI image'
      );
      if (!result.image) throw new Error('Workers AI returned no image.');
      return Buffer.from(result.image, 'base64');
    },
    async inspectImage(image, instructions) {
      const result = await api<{ choices?: { message?: { content?: string } }[] }>(
        '/ai/run/@cf/google/gemma-4-26b-a4b-it',
        {
          messages: [{ role: 'user', content: [
            { type: 'text', text: instructions },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image.toString('base64')}` } }
          ] }],
          response_format: { type: 'json_object' },
          chat_template_kwargs: { enable_thinking: false },
          max_completion_tokens: 512,
          temperature: 0
        },
        'Workers AI visual review'
      );
      const content = result.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('Workers AI returned no visual review.');
      try {
        return JSON.parse(content);
      } catch {
        throw new Error('Workers AI returned an unreadable visual review.');
      }
    }
  };
}

export function instagram(account: string, token: string, version = 'v27.0', host = 'graph.instagram.com') {
  if (!/^v\d+\.\d+$/.test(version) || !/^\d+$/.test(account)) throw new Error('Invalid Instagram account ID or API version.');
  if (host !== 'graph.instagram.com' && host !== 'graph.facebook.com') {
    throw new Error('Use graph.instagram.com for Instagram Login or graph.facebook.com for Unified Login.');
  }
  const base = `https://${host}/${version}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const send = (path: string, body: unknown) => requestJson<{ id: string }>('Instagram', base + path, {
    method: 'POST', headers, body: JSON.stringify(body)
  });
  return {
    create: (imageUrl: string, caption: string, altText: string) => send(`/${account}/media`, {
      image_url: imageUrl, caption, alt_text: altText
    }),
    publish: (containerId: string) => send(`/${account}/media_publish`, { creation_id: containerId }),
    status: (containerId: string) => requestJson<{ status_code: string }>(
      'Instagram status', `${base}/${encodeURIComponent(containerId)}?fields=status_code`, { headers }
    )
  };
}

export async function telegram(token: string, chat: string, image: Buffer, caption: string) {
  const form = new FormData();
  form.set('chat_id', chat);
  form.set('caption', Array.from(caption).slice(0, 1024).join(''));
  form.set('photo', new Blob([Uint8Array.from(image)], { type: 'image/jpeg' }), 'post.jpg');
  const result = await requestJson<{ ok: boolean }>('Telegram', `https://api.telegram.org/bot${token}/sendPhoto`, {
    method: 'POST', body: form
  });
  if (!result.ok) throw new Error('Telegram rejected the preview.');
}

export async function telegramMessage(token: string, chat: string, message: string) {
  const result = await requestJson<{ ok: boolean }>('Telegram', `https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text: message }),
    signal: AbortSignal.timeout(10_000)
  });
  if (!result.ok) throw new Error('Telegram rejected the message.');
}
