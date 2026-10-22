/* 划词译 · popup */

const $ = (id) => document.getElementById(id);

function send(type, payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, payload }, (res) => {
      resolve(res || { ok: false, error: 'NO_RESPONSE' });
    });
  });
}

const PROVIDER_NOTE = {
  'chrome-ai': '本机模型直接翻译，无需账号、无需联网。',
  deepl: 'DeepL 官方 API，长句质量最好；需在设置里填 Free Key（仅邮箱注册）。',
  azure: 'Microsoft Translator（Azure）；需在设置里填订阅密钥与资源区域。',
  google: 'Google Cloud Translation；需在设置里填 Google Cloud 的 API Key。',
  libre: 'LibreTranslate，可自建；需在设置里填服务地址（自建通常免 Key）。',
  openai: '走你自己的模型接口，去设置里填地址和 Key。',
  'free-mt': '免密钥公开接口，质量一般，适合应急。',
};

/* 需要密钥的通道 → 检查对应字段是否已填 */
const KEY_OF = {
  deepl: (s) => Boolean(s.deepl && s.deepl.apiKey),
  azure: (s) => Boolean(s.azure && s.azure.apiKey && s.azure.region),
  google: (s) => Boolean(s.google && s.google.apiKey),
  openai: (s) => Boolean(s.openai && s.openai.apiKey),
  libre: () => true,   // 自建实例通常免密钥
};

const DICT_SOURCES = ['youdao', 'collins', 'sentences', 'wiktionary', 'freedict', 'ydsimple'];

function renderAuth(provider, settings) {
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
  go.addEventListener('click', () => chrome.runtime.openOptionsPage());
  box.appendChild(go);

  const ready = KEY_OF[provider] ? KEY_OF[provider](settings) : true;
  if (!ready) {
    dot.className = 'dot warn';
    note.textContent = '该通道还没填密钥，点「去设置」补上。';
  } else {
    note.textContent = PROVIDER_NOTE[provider] || '';
  }
}

async function refresh() {
  const settings = await send('settings:get');

  if (settings.ok) {
    const s = settings.data;
    const provider = s.provider || 'chrome-ai';
    renderAuth(provider, s);
    $('targetLang').value = s.targetLang;
    $('trigger').value = s.trigger;
    $('provider').value = provider;
    $('cmpEnabled').checked = !!(s.compare && s.compare.enabled);
    DICT_SOURCES.forEach((k) => {
      $('src-' + k).checked = s.sources[k] !== false;
    });
  }
}

function bind() {
  $('targetLang').addEventListener('change', (e) => send('settings:set', { targetLang: e.target.value }));
  $('trigger').addEventListener('change', (e) => send('settings:set', { trigger: e.target.value }));
  $('provider').addEventListener('change', (e) => {
    send('settings:set', { provider: e.target.value }).then(refresh);
  });

  $('cmpEnabled').addEventListener('change', (e) => {
    send('settings:set', { compare: { enabled: e.target.checked } });
  });

  DICT_SOURCES.forEach((k) => {
    const el = $('src-' + k);
    el.addEventListener('change', () => {
      const sources = {};
      DICT_SOURCES.forEach((n) => {
        sources[n] = $('src-' + n).checked;
      });
      send('settings:set', { sources });
    });
  });

  $('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('clearCache').addEventListener('click', async () => {
    await send('cache:clear');
    const b = $('clearCache');
    b.textContent = '已清除';
    setTimeout(() => { b.textContent = '清缓存'; }, 1200);
  });
}

bind();
refresh();
