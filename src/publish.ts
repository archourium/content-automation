import type { Post } from './engine.ts';
import type { instagram } from './providers.ts';
import type { storage } from './storage.ts';

type Instagram = ReturnType<typeof instagram>;
type Store = Pick<ReturnType<typeof storage>, 'lookup' | 'claim' | 'complete' | 'upload'>;

export async function checkPublication(api: Instagram, store: Store, account: string, day: string) {
  const previous = await store.lookup(account, day);
  if (!previous) return false;
  if (previous.status === 'published') return true;
  const { status_code } = await api.status(previous.container_id);
  if (status_code === 'PUBLISHED') {
    await store.complete(account, day, null);
    return true;
  }
  throw new Error(`Today's publication is unresolved (container status ${status_code}). Check Instagram before clearing its publication record.`);
}

export async function publishPost(
  api: Instagram, store: Store, account: string, day: string, post: Post, image: Buffer
) {
  if (await checkPublication(api, store, account, day)) return { status: 'already-published' };
  const url = await store.upload(image);
  const { id: container } = await api.create(url, post.caption, post.altText);
  if (!container) throw new Error('Instagram returned no container ID.');

  for (let attempt = 1; attempt <= 5; attempt++) {
    const { status_code } = await api.status(container);
    if (status_code === 'FINISHED') break;
    if (status_code !== 'IN_PROGRESS' || attempt === 5) {
      throw new Error(`Instagram container was not ready (${status_code}).`);
    }
    await new Promise(resolve => setTimeout(resolve, 60_000));
  }

  if (!await store.claim(account, day, container)) return { status: 'claimed-by-another-run' };
  const { id } = await api.publish(container);
  if (!id) throw new Error('Instagram returned no published media ID.');
  await store.complete(account, day, id);
  return { status: 'published', id };
}
