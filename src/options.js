/* 划词译 · options */

const $ = (id) => document.getElementById(id);

function send(type, payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, payload }, (res) => {
      resolve(res || { ok: false, error: 'NO_RESPONSE' });
    });
  });
}

const ERR_TEXT = {
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

const PROVIDER_TIP = {
  'chrome-ai': 'Chrome 内置 AI 在页面上下文运行，此处测试会走降级链。真实效果请在网页中划词验证。',
  openai: '验证自定义模型的地址、模型名与 Key。',
  deepl: '验证 DeepL Auth Key（Free 档以 :fx 结尾，走 api-free.deepl.com）。',
  azure: '验证 Azure 翻译资源的订阅密钥与区域。',
  google: '验证 Google Cloud Translation 的 API Key 与配额。',
  libre: '验证 LibreTranslate 服务地址（自建实例通常免 Key）。',
  'free-mt': '验证免密钥机器翻译接口连通性。',
};

/* 词典来源开关：新增来源时只改这里 + options.html / popup.html 的 id */
const DICT_SOURCES = ['youdao', 'collins', 'sentences', 'wiktionary', 'freedict', 'ydsimple'];

/* 只显示当前所选通道对应的那张配置卡片 */
const CARD_OF = {
  openai: 'openaiCard',
  deepl: 'deeplCard',
  azure: 'azureCard',
  google: 'googleCard',
  libre: 'libreCard',
};

function applyProvider(p) {
  Object.keys(CARD_OF).forEach((k) => {
    $(CARD_OF[k]).hidden = (k !== p);
  });
}

async function loadSettings() {
  const res = await send('settings:get');
  if (!res.ok) return;
  const s = res.data;
  $('targetLang').value = s.targetLang;
  $('trigger').value = s.trigger;
  $('provider').value = s.provider || 'chrome-ai';
  $('fallbackEnabled').checked = s.fallbackEnabled !== false;
  applyProvider(s.provider || 'chrome-ai');
  const o = s.openai || {};
  $('baseUrl').value = o.baseUrl || '';
  $('model').value = o.model || '';
  $('apiKey').value = o.apiKey || '';
  $('deeplKey').value = (s.deepl || {}).apiKey || '';
  const az = s.azure || {};
  $('azKey').value = az.apiKey || '';
  $('azRegion').value = az.region || '';
  $('ggKey').value = (s.google || {}).apiKey || '';
  const lb = s.libre || {};
  $('lbBase').value = lb.baseUrl || 'https://libretranslate.com';
  $('lbKey').value = lb.apiKey || '';
  const sn = s.sentence || {};
  $('sentProvider').value = sn.provider || 'follow';
  $('sentMode').value = sn.mode || 'target';
  $('sentPerSentence').checked = sn.perSentence !== false;
  $('sentDict').checked = !!sn.dict;
  const c = s.compare || {};
  $('cmpEnabled').checked = c.enabled !== false;
  const picked = Array.isArray(c.providers) ? c.providers : [];
  const boxes = $('cmpPick').querySelectorAll('input[type=checkbox]');
  for (let i = 0; i < boxes.length; i++) {
    boxes[i].checked = picked.indexOf(boxes[i].value) >= 0;
  }
  DICT_SOURCES.forEach((k) => {
    $('src-' + k).checked = s.sources[k] !== false;
  });
  $('aiEnabled').checked = s.aiEnabled !== false;
}

function bind() {
  $('targetLang').addEventListener('change', (e) => send('settings:set', { targetLang: e.target.value }));
  $('trigger').addEventListener('change', (e) => send('settings:set', { trigger: e.target.value }));
  $('aiEnabled').addEventListener('change', (e) => send('settings:set', { aiEnabled: e.target.checked }));

  $('provider').addEventListener('change', (e) => {
    send('settings:set', { provider: e.target.value });
    applyProvider(e.target.value);
  });
  $('fallbackEnabled').addEventListener('change', (e) => send('settings:set', { fallbackEnabled: e.target.checked }));

  const saveOpenai = () => send('settings:set', {
    openai: {
      baseUrl: $('baseUrl').value.trim(),
      model: $('model').value.trim(),
      apiKey: $('apiKey').value.trim(),
    },
  });
  ['baseUrl', 'model', 'apiKey'].forEach((id) => {
    $(id).addEventListener('change', saveOpenai);
  });

  const saveDeepl = () => send('settings:set', { deepl: { apiKey: $('deeplKey').value.trim() } });
  $('deeplKey').addEventListener('change', saveDeepl);

  const saveAzure = () => send('settings:set', {
    azure: { apiKey: $('azKey').value.trim(), region: $('azRegion').value.trim() },
  });
  ['azKey', 'azRegion'].forEach((id) => { $(id).addEventListener('change', saveAzure); });

  const saveGoogle = () => send('settings:set', { google: { apiKey: $('ggKey').value.trim() } });
  $('ggKey').addEventListener('change', saveGoogle);

  const saveLibre = () => send('settings:set', {
    libre: {
      baseUrl: $('lbBase').value.trim() || 'https://libretranslate.com',
      apiKey: $('lbKey').value.trim(),
    },
  });
  ['lbBase', 'lbKey'].forEach((id) => { $(id).addEventListener('change', saveLibre); });

  // 句子翻译：四个选项各自独立保存
  $('sentProvider').addEventListener('change', (e) => {
    send('settings:set', { sentence: { provider: e.target.value } });
  });
  $('sentMode').addEventListener('change', (e) => {
    send('settings:set', { sentence: { mode: e.target.value } });
  });
  $('sentPerSentence').addEventListener('change', (e) => {
    send('settings:set', { sentence: { perSentence: e.target.checked } });
  });
  $('sentDict').addEventListener('change', (e) => {
    send('settings:set', { sentence: { dict: e.target.checked } });
  });

  // 并列对照：按 DOM 顺序收集勾选的通道，面板里也按这个顺序排列
  const saveCompare = () => {
    const boxes = $('cmpPick').querySelectorAll('input[type=checkbox]');
    const providers = [];
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].checked) providers.push(boxes[i].value);
    }
    send('settings:set', {
      compare: { enabled: $('cmpEnabled').checked, providers },
    });
  };
  $('cmpEnabled').addEventListener('change', saveCompare);
  $('cmpPick').addEventListener('change', saveCompare);

  DICT_SOURCES.forEach((k) => {
    $('src-' + k).addEventListener('change', () => {
      const sources = {};
      DICT_SOURCES.forEach((n) => {
        sources[n] = $('src-' + n).checked;
      });
      send('settings:set', { sources });
    });
  });

  $('runTest').addEventListener('click', async () => {
    const text = $('testInput').value.trim();
    const out = $('testOut');
    out.className = 'out';
    if (!text) { out.textContent = '请先输入测试文本。'; return; }
    const st = await send('settings:get');
    const provider = (st.ok && st.data.provider) || 'chrome-ai';
    out.className = 'out';
    out.textContent = '请求中…' + (PROVIDER_TIP[provider] ? '\n' + PROVIDER_TIP[provider] : '');
    const btn = $('runTest');
    btn.disabled = true;
    const t0 = Date.now();
    const res = await send('ai:translate', { text });
    btn.disabled = false;
    const cost = ((Date.now() - t0) / 1000).toFixed(1);

    if (res.ok) {
      out.className = 'out';
      out.textContent = res.data.text + '\n\n—— ' + cost + 's' + (res.data.cached ? ' · 来自缓存' : '');
    } else {
      out.className = 'out err';
      out.textContent = (ERR_TEXT[res.error] || res.error) + '\n\n原始错误：' + res.error;
    }
  });
}

bind();
loadSettings();
