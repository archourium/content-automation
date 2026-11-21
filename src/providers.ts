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
    const envelope = await requestJson<{ success: boolean; result: T }>(service, base + path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
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
    async draw(prompt) {
      const result = await api<{ image?: string }>(
        '/ai/run/@cf/black-forest-labs/flux-1-schnell', { prompt, steps: 4 }, 'Workers AI image'
      );
      if (!result.image) throw new Error('Workers AI returned no image.');
      return Buffer.from(result.image, 'base64');
    }
  };
}

export function instagram(account: string, token: string, version = 'v27.0') {
  if (!/^v\d+\.\d+$/.test(version) || !/^\d+$/.test(account)) throw new Error('Invalid Instagram account ID or API version.');
  const base = `https://graph.instagram.com/${version}`;
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
