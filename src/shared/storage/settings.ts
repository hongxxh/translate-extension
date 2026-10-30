/* 设置与凭据：默认值 + 读取 + 深合并写入。
   sources / compare / sentence 与五个凭据组都是分组结构，
   任意一层给补丁都要能局部更新，不能整体覆盖。 */
import type { Settings, SettingsPatch } from '../types';

export const DEFAULT_SETTINGS: Settings = {
  targetLang: 'zh-CN',
  trigger: 'icon', // icon | auto | alt
  aiEnabled: true,
  provider: 'chrome-ai',
  fallbackEnabled: true,
  openai: {
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
  },
  deepl: { apiKey: '' },
  azure: { apiKey: '', region: '' },
  google: { apiKey: '' },
  libre: { baseUrl: 'https://libretranslate.com', apiKey: '' },
  sentence: {
    provider: 'follow',
    mode: 'target',
    perSentence: true,
    dict: false,
  },
  compare: {
    enabled: true,
    providers: ['chrome-ai', 'deepl'],
  },
  sources: {
    youdao: true,
    collins: true,
    sentences: true,
    wiktionary: true,
    freedict: true,
    ydsimple: true,
  },
  minLen: 1,
  maxLen: 400,
  cacheDays: 7,
};

const CREDENTIAL_GROUPS = ['openai', 'deepl', 'azure', 'google', 'libre'] as const;
type CredentialGroup = (typeof CREDENTIAL_GROUPS)[number];

/** 把 storage 里的原始对象补齐成完整 Settings（缺字段一律回落默认值） */
export function mergeSettings(raw: unknown): Settings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings>;
  const out = { ...DEFAULT_SETTINGS, ...s } as Settings;

  out.sources = { ...DEFAULT_SETTINGS.sources, ...(s.sources || {}) };
  out.compare = { ...DEFAULT_SETTINGS.compare, ...(s.compare || {}) };
  if (!Array.isArray(out.compare.providers)) {
    out.compare.providers = DEFAULT_SETTINGS.compare.providers.slice();
  }
  out.sentence = { ...DEFAULT_SETTINGS.sentence, ...(s.sentence || {}) };

  const bag = out as unknown as Record<CredentialGroup, Record<string, unknown>>;
  for (const group of CREDENTIAL_GROUPS) {
    bag[group] = {
      ...(DEFAULT_SETTINGS[group] as unknown as Record<string, unknown>),
      ...((s[group] as unknown as Record<string, unknown>) || {}),
    };
  }
  return out;
}

/** 只做合并，不落盘：便于在纯函数测试里复用 */
export function applyPatch(cur: Settings, patch?: SettingsPatch | null): Settings {
  const next = { ...cur, ...(patch || {}) } as Settings;
  if (!patch) return next;

  if (patch.sources) next.sources = { ...cur.sources, ...patch.sources };
  if (patch.compare) next.compare = { ...cur.compare, ...patch.compare };
  if (patch.sentence) next.sentence = { ...cur.sentence, ...patch.sentence };
  const bag = next as unknown as Record<CredentialGroup, Record<string, unknown>>;
  for (const group of CREDENTIAL_GROUPS) {
    const part = patch[group] as unknown as Record<string, unknown> | undefined;
    if (part) bag[group] = { ...(cur[group] as unknown as Record<string, unknown>), ...part };
  }
  return next;
}

export async function getSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get('settings');
  return mergeSettings(settings);
}

export async function setSettings(patch: SettingsPatch): Promise<Settings> {
  const next = applyPatch(await getSettings(), patch);
  await chrome.storage.local.set({ settings: next });
  return next;
}
