/* 翻译结果缓存。键 = 'ai:' + hash(provider|targetLang|kind|text)，
   按写入时间戳淘汰，最多 300 条。 */
import { hashStr } from '../text';

const CACHE_MAX = 300;

interface CacheItem {
  v: string;
  exp: number;
  t: number;
}

type CacheBag = Record<string, CacheItem>;

export function cacheKey(provider: string, targetLang: string, kind: string, text: string): string {
  return 'ai:' + hashStr(provider + '|' + targetLang + '|' + kind + '|' + text);
}

export async function cacheGet(key: string): Promise<string | null> {
  const { cache } = await chrome.storage.local.get('cache');
  const bag = (cache || {}) as CacheBag;
  const item = bag[key];
  if (!item) return null;
  if (Date.now() > item.exp) {
    delete bag[key];
    await chrome.storage.local.set({ cache: bag });
    return null;
  }
  return item.v;
}

export async function cacheSet(key: string, value: string, days: number): Promise<void> {
  const { cache } = await chrome.storage.local.get('cache');
  const bag = (cache || {}) as CacheBag;
  bag[key] = { v: value, exp: Date.now() + (days || 7) * 864e5, t: Date.now() };

  const keys = Object.keys(bag);
  if (keys.length > CACHE_MAX) {
    keys
      .sort((a, b) => (bag[a].t || 0) - (bag[b].t || 0))
      .slice(0, keys.length - CACHE_MAX)
      .forEach((k) => delete bag[k]);
  }
  await chrome.storage.local.set({ cache: bag });
}

export async function cacheClear(): Promise<void> {
  await chrome.storage.local.remove('cache');
}
