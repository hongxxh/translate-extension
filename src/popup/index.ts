/* 弹窗：快速切目标语言 / 触发方式 / 通道 / 并列对照 / 词典来源，另加清缓存。 */
import { clearCache, fetchSettings, openOptions, saveSettings } from '../shared/messaging/client';
import { DICT_SOURCES } from '../shared/constants';
import type { ProviderId, Settings } from '../shared/types';

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error('弹窗缺少控件 #' + id);
  return el as T;
}

const PROVIDER_NOTE: Record<ProviderId, string> = {
  'chrome-ai': '本机模型直接翻译，无需账号、无需联网。',
  deepl: 'DeepL 官方 API，长句质量最好；需在设置里填 Free Key（仅邮箱注册）。',
  azure: 'Microsoft Translator（Azure）；需在设置里填订阅密钥与资源区域。',
  google: 'Google Cloud Translation；需在设置里填 Google Cloud 的 API Key。',
  libre: 'LibreTranslate，可自建；需在设置里填服务地址（自建通常免 Key）。',
  openai: '走你自己的模型接口，去设置里填地址和 Key。',
  'free-mt': '免密钥公开接口，质量一般，适合应急。',
};

/** 需要密钥的通道 → 检查对应字段是否已填 */
const KEY_OF: Partial<Record<ProviderId, (s: Settings) => boolean>> = {
  deepl: (s) => Boolean(s.deepl && s.deepl.apiKey),
  azure: (s) => Boolean(s.azure && s.azure.apiKey && s.azure.region),
  google: (s) => Boolean(s.google && s.google.apiKey),
  openai: (s) => Boolean(s.openai && s.openai.apiKey),
  libre: () => true, // 自建实例通常免密钥
};

function renderAuth(provider: ProviderId, settings: Settings): void {
  const box = $('authBox');
  const note = $('authNote');
  const dot = $('statusDot');
  box.textContent = '';

  dot.className = 'dot on';
  box.appendChild(Object.assign(document.createElement('div'), {
    className: 'auth-info',
    textContent: '无需登录',
  }));
  const go = document.createElement('button');
  go.textContent = '去设置';
  go.addEventListener('click', () => openOptions());
  box.appendChild(go);

  const check = KEY_OF[provider];
  if (check && !check(settings)) {
    dot.className = 'dot warn';
    note.textContent = '该通道还没填密钥，点「去设置」补上。';
  } else {
    note.textContent = PROVIDER_NOTE[provider] || '';
  }
}

async function refresh(): Promise<void> {
  const settings = await fetchSettings();
  if (!settings) return;

  const provider = settings.provider || 'chrome-ai';
  renderAuth(provider, settings);
  $<HTMLSelectElement>('targetLang').value = settings.targetLang;
  $<HTMLSelectElement>('trigger').value = settings.trigger;
  $<HTMLSelectElement>('provider').value = provider;
  $<HTMLInputElement>('cmpEnabled').checked = Boolean(settings.compare && settings.compare.enabled);
  DICT_SOURCES.forEach((k) => {
    $<HTMLInputElement>('src-' + k).checked = settings.sources[k] !== false;
  });
}

function bind(): void {
  $<HTMLSelectElement>('targetLang').addEventListener('change', (e) => {
    void saveSettings({ targetLang: (e.target as HTMLSelectElement).value });
  });
  $<HTMLSelectElement>('trigger').addEventListener('change', (e) => {
    void saveSettings({ trigger: (e.target as HTMLSelectElement).value as Settings['trigger'] });
  });
  $<HTMLSelectElement>('provider').addEventListener('change', (e) => {
    void saveSettings({ provider: (e.target as HTMLSelectElement).value as ProviderId }).then(refresh);
  });

  $<HTMLInputElement>('cmpEnabled').addEventListener('change', (e) => {
    void saveSettings({ compare: { enabled: (e.target as HTMLInputElement).checked } });
  });

  DICT_SOURCES.forEach((k) => {
    $<HTMLInputElement>('src-' + k).addEventListener('change', () => {
      const sources = {} as Record<string, boolean>;
      DICT_SOURCES.forEach((n) => { sources[n] = $<HTMLInputElement>('src-' + n).checked; });
      void saveSettings({ sources: sources as unknown as Settings['sources'] });
    });
  });

  $('openOptions').addEventListener('click', () => openOptions());
  $('clearCache').addEventListener('click', async () => {
    await clearCache();
    const b = $('clearCache');
    b.textContent = '已清除';
    setTimeout(() => { b.textContent = '清缓存'; }, 1200);
  });
}

bind();
void refresh();
