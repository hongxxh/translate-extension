/* 设置页：11 节配置 + 连通性测试。DOM id 与 options/index.html 一一对应，
   改 id 必须两边同步（tests/e2e/pages.spec.mjs 会直接断言这些 id 存在）。 */
import { fetchSettings, saveSettings, testTranslate } from '../shared/messaging/client';
import { DICT_SOURCES } from '../shared/constants';
import type { ProviderId, Settings, SettingsPatch, SourceSettings } from '../shared/types';

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error('设置页缺少控件 #' + id);
  return el as T;
}

const val = (id: string): string => $<HTMLInputElement | HTMLSelectElement>(id).value;
const checked = (id: string): boolean => $<HTMLInputElement>(id).checked;

const ERR_TEXT: Record<string, string> = {
  AI_DISABLED: 'AI 翻译已被关闭',
  TIMEOUT: '请求超时',
  EMPTY_RESULT: '未取得翻译结果',
  REFUSAL: '模型拒绝了本次请求',
  EMPTY_QUERY: '没有可查询的内容',
  OPENAI_NO_KEY: '未填写自定义模型的 API Key',
  OPENAI_NO_BASEURL: '未填写自定义模型的接口地址',
  CHROME_AI_UNAVAILABLE: '本机不支持 Chrome 内置 AI（需 Chrome 138+ 且硬件达标）',
  CHROME_AI_PAGE_ONLY: 'Chrome 内置 AI 只能在页面上下文调用，请在网页中划词测试',
  FREE_MT_SAME_LANG: '原文与目标语言相同',
  DEEPL_NO_KEY: '未填写 DeepL 的 Auth Key',
  AZURE_NO_KEY: '未填写 Microsoft Translator 的订阅密钥',
  AZURE_NO_REGION: '未填写 Microsoft Translator 的资源区域',
  GOOGLE_NO_KEY: '未填写 Google 翻译的 API Key',
  LIBRE_NO_BASEURL: '未填写 LibreTranslate 的服务地址',
  UNKNOWN_PROVIDER: '未知的翻译通道',
};

const PROVIDER_TIP: Record<ProviderId, string> = {
  'chrome-ai': 'Chrome 内置 AI 在页面上下文运行，此处测试会走降级链。真实效果请在网页中划词验证。',
  openai: '验证自定义模型的地址、模型名与 Key。',
  deepl: '验证 DeepL Auth Key（Free 档以 :fx 结尾，走 api-free.deepl.com）。',
  azure: '验证 Azure 翻译资源的订阅密钥与区域。',
  google: '验证 Google Cloud Translation 的 API Key 与配额。',
  libre: '验证 LibreTranslate 服务地址（自建实例通常免 Key）。',
  'free-mt': '验证免密钥机器翻译接口连通性。',
};

/** 只显示当前所选通道对应的那张配置卡片 */
const CARD_OF: Partial<Record<ProviderId, string>> = {
  openai: 'openaiCard',
  deepl: 'deeplCard',
  azure: 'azureCard',
  google: 'googleCard',
  libre: 'libreCard',
};

function applyProvider(p: ProviderId): void {
  Object.keys(CARD_OF).forEach((k) => {
    const card = CARD_OF[k as ProviderId];
    if (card) $(card).hidden = k !== p;
  });
}

async function loadSettings(): Promise<void> {
  const s = await fetchSettings();
  if (!s) return;

  $<HTMLSelectElement>('targetLang').value = s.targetLang;
  $<HTMLSelectElement>('trigger').value = s.trigger;
  $<HTMLSelectElement>('provider').value = s.provider || 'chrome-ai';
  $<HTMLInputElement>('fallbackEnabled').checked = s.fallbackEnabled !== false;
  applyProvider(s.provider || 'chrome-ai');

  $<HTMLInputElement>('baseUrl').value = s.openai.baseUrl || '';
  $<HTMLInputElement>('model').value = s.openai.model || '';
  $<HTMLInputElement>('apiKey').value = s.openai.apiKey || '';
  $<HTMLInputElement>('deeplKey').value = s.deepl.apiKey || '';
  $<HTMLInputElement>('azKey').value = s.azure.apiKey || '';
  $<HTMLInputElement>('azRegion').value = s.azure.region || '';
  $<HTMLInputElement>('ggKey').value = s.google.apiKey || '';
  $<HTMLInputElement>('lbBase').value = s.libre.baseUrl || 'https://libretranslate.com';
  $<HTMLInputElement>('lbKey').value = s.libre.apiKey || '';

  $<HTMLSelectElement>('sentProvider').value = s.sentence.provider || 'follow';
  $<HTMLSelectElement>('sentMode').value = s.sentence.mode || 'target';
  $<HTMLInputElement>('sentPerSentence').checked = s.sentence.perSentence !== false;
  $<HTMLInputElement>('sentDict').checked = Boolean(s.sentence.dict);

  $<HTMLInputElement>('cmpEnabled').checked = s.compare.enabled !== false;
  const picked = Array.isArray(s.compare.providers) ? s.compare.providers : [];
  $('cmpPick').querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((box) => {
    box.checked = picked.indexOf(box.value as ProviderId) >= 0;
  });

  DICT_SOURCES.forEach((k) => {
    $<HTMLInputElement>('src-' + k).checked = s.sources[k] !== false;
  });
  $<HTMLInputElement>('aiEnabled').checked = s.aiEnabled !== false;
}

function save(patch: SettingsPatch): void {
  void saveSettings(patch);
}

function bind(): void {
  $<HTMLSelectElement>('targetLang').addEventListener('change', (e) => save({
    targetLang: (e.target as HTMLSelectElement).value,
  }));
  $<HTMLSelectElement>('trigger').addEventListener('change', (e) => save({
    trigger: (e.target as HTMLSelectElement).value as Settings['trigger'],
  }));
  $<HTMLInputElement>('aiEnabled').addEventListener('change', (e) => save({
    aiEnabled: (e.target as HTMLInputElement).checked,
  }));

  $<HTMLSelectElement>('provider').addEventListener('change', (e) => {
    const p = (e.target as HTMLSelectElement).value as ProviderId;
    save({ provider: p });
    applyProvider(p);
  });
  $<HTMLInputElement>('fallbackEnabled').addEventListener('change', (e) => save({
    fallbackEnabled: (e.target as HTMLInputElement).checked,
  }));

  const saveOpenai = (): void => save({
    openai: {
      baseUrl: val('baseUrl').trim(),
      model: val('model').trim(),
      apiKey: val('apiKey').trim(),
    },
  });
  ['baseUrl', 'model', 'apiKey'].forEach((id) => $(id).addEventListener('change', saveOpenai));

  $<HTMLInputElement>('deeplKey').addEventListener('change', () => save({
    deepl: { apiKey: val('deeplKey').trim() },
  }));

  const saveAzure = (): void => save({
    azure: { apiKey: val('azKey').trim(), region: val('azRegion').trim() },
  });
  ['azKey', 'azRegion'].forEach((id) => $(id).addEventListener('change', saveAzure));

  $<HTMLInputElement>('ggKey').addEventListener('change', () => save({
    google: { apiKey: val('ggKey').trim() },
  }));

  const saveLibre = (): void => save({
    libre: {
      baseUrl: val('lbBase').trim() || 'https://libretranslate.com',
      apiKey: val('lbKey').trim(),
    },
  });
  ['lbBase', 'lbKey'].forEach((id) => $(id).addEventListener('change', saveLibre));

  // 句子翻译：四个选项各自独立保存
  $<HTMLSelectElement>('sentProvider').addEventListener('change', (e) => save({
    sentence: { provider: (e.target as HTMLSelectElement).value as Settings['sentence']['provider'] },
  }));
  $<HTMLSelectElement>('sentMode').addEventListener('change', (e) => save({
    sentence: { mode: (e.target as HTMLSelectElement).value as Settings['sentence']['mode'] },
  }));
  $<HTMLInputElement>('sentPerSentence').addEventListener('change', (e) => save({
    sentence: { perSentence: (e.target as HTMLInputElement).checked },
  }));
  $<HTMLInputElement>('sentDict').addEventListener('change', (e) => save({
    sentence: { dict: (e.target as HTMLInputElement).checked },
  }));

  // 并列对照：按 DOM 顺序收集勾选的通道，面板里也按这个顺序排列
  const saveCompare = (): void => {
    const providers: ProviderId[] = [];
    $('cmpPick').querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((box) => {
      if (box.checked) providers.push(box.value as ProviderId);
    });
    save({ compare: { enabled: checked('cmpEnabled'), providers } });
  };
  $<HTMLInputElement>('cmpEnabled').addEventListener('change', saveCompare);
  $('cmpPick').addEventListener('change', saveCompare);

  DICT_SOURCES.forEach((k) => {
    $<HTMLInputElement>('src-' + k).addEventListener('change', () => {
      const sources = {} as Record<string, boolean>;
      DICT_SOURCES.forEach((n) => { sources[n] = checked('src-' + n); });
      save({ sources: sources as Partial<SourceSettings> });
    });
  });

  $('runTest').addEventListener('click', async () => {
    const text = $<HTMLTextAreaElement>('testInput').value.trim();
    const out = $('testOut');
    out.className = 'out';
    if (!text) {
      out.textContent = '请先输入测试文本。';
      return;
    }
    const settings = await fetchSettings();
    const provider = (settings && settings.provider) || 'chrome-ai';
    out.className = 'out';
    out.textContent = '请求中…' + (PROVIDER_TIP[provider] ? '\n' + PROVIDER_TIP[provider] : '');

    const btn = $<HTMLButtonElement>('runTest');
    btn.disabled = true;
    const t0 = Date.now();
    const res = await testTranslate(text);
    btn.disabled = false;
    const cost = ((Date.now() - t0) / 1000).toFixed(1);

    if (res.ok && res.data) {
      out.className = 'out';
      out.textContent = res.data.text + '\n\n—— ' + cost + 's' + (res.data.cached ? ' · 来自缓存' : '');
    } else {
      out.className = 'out err';
      out.textContent = (ERR_TEXT[res.error || ''] || res.error)
        + '\n\n原始错误：' + res.error;
    }
  });
}

bind();
void loadSettings();
