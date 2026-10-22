/* =========================================================
 * 划词译 · SelectTrans — background service worker
 * 职责：设置与凭据管理 / 权威词典聚合 / 多通道 AI 与机器翻译
 * ========================================================= */

const DEFAULT_SETTINGS = {
  targetLang: 'zh-CN',
  trigger: 'icon',            // icon | auto | alt
  aiEnabled: true,
  // chrome-ai | deepl | azure | google | libre | openai | free-mt
  provider: 'chrome-ai',
  fallbackEnabled: true,      // 主通道失败时降级到 free-mt
  openai: {
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
  },
  deepl: {
    apiKey: '',               // DeepL Auth Key；以 :fx 结尾 = Free 档（自动走 api-free.deepl.com）
  },
  azure: {
    apiKey: '',               // Microsoft Translator 的订阅密钥
    region: '',               // 资源所在区域，如 eastasia / westeurope
  },
  google: {
    apiKey: '',               // Google Cloud Translation API v2 的 API Key
  },
  libre: {
    baseUrl: 'https://libretranslate.com',
    apiKey: '',               // 自建实例可留空；公共服务需要 Key
  },
  // 句子翻译：句子和单词的诉求不同，给它一套独立的选项
  sentence: {
    provider: 'follow',       // follow = 跟随主通道；也可为句子单独指定一条通道
    mode: 'target',           // target = 仅译文 | bilingual = 逐句双语对照 | source = 原文 + 译文
    perSentence: true,        // 按句拆分后逐句翻译（对照模式更整齐，也更容易缓存命中）
    dict: false,              // 句子模式是否仍然查词典
  },
  // 并列对照：面板里并排显示多个通道的译文，便于直接比对。
  // 本地模型排第一 —— 它零配置、离线，永远是用户手上那张保底牌。
  compare: {
    enabled: true,
    providers: ['chrome-ai', 'deepl'],
  },
  sources: {
    youdao: true,
    collins: true,
    sentences: true,
    wiktionary: true,
    freedict: true,           // Free Dictionary API（Wiktionary 数据，英英释义）
    ydsimple: true,           // 有道简明释义（中文速览）
  },
  minLen: 1,
  maxLen: 400,
  cacheDays: 7,
};

const LANG_NAMES = {
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  en: '英语',
  ja: '日语',
  ko: '韩语',
  fr: '法语',
  de: '德语',
  es: '西班牙语',
  ru: '俄语',
};

/* ------------------------- 基础工具 ------------------------- */

function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const stripTags = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

/* ------------------------- 设置 ------------------------- */

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  const s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
  s.sources = Object.assign({}, DEFAULT_SETTINGS.sources, (settings && settings.sources) || {});
  s.compare = Object.assign({}, DEFAULT_SETTINGS.compare, (settings && settings.compare) || {});
  if (!Array.isArray(s.compare.providers)) s.compare.providers = DEFAULT_SETTINGS.compare.providers.slice();
  s.sentence = Object.assign({}, DEFAULT_SETTINGS.sentence, (settings && settings.sentence) || {});
  ['openai', 'deepl', 'azure', 'google', 'libre'].forEach((k) => {
    s[k] = Object.assign({}, DEFAULT_SETTINGS[k], (settings && settings[k]) || {});
  });
  return s;
}

async function setSettings(patch) {
  const cur = await getSettings();
  const next = Object.assign({}, cur, patch || {});
  if (patch && patch.sources) next.sources = Object.assign({}, cur.sources, patch.sources);
  if (patch && patch.compare) next.compare = Object.assign({}, cur.compare, patch.compare);
  if (patch && patch.sentence) next.sentence = Object.assign({}, cur.sentence, patch.sentence);
  ['openai', 'deepl', 'azure', 'google', 'libre'].forEach((k) => {
    if (patch && patch[k]) next[k] = Object.assign({}, cur[k], patch[k]);
  });
  await chrome.storage.local.set({ settings: next });
  return next;
}

/* ------------------------- 缓存 ------------------------- */

const CACHE_MAX = 300;

async function cacheGet(key) {
  const { cache } = await chrome.storage.local.get('cache');
  const item = cache && cache[key];
  if (!item) return null;
  if (Date.now() > item.exp) {
    delete cache[key];
    await chrome.storage.local.set({ cache });
    return null;
  }
  return item.v;
}

async function cacheSet(key, value, days) {
  const { cache } = await chrome.storage.local.get('cache');
  const c = cache || {};
  c[key] = { v: value, exp: Date.now() + (days || 7) * 864e5, t: Date.now() };
  const keys = Object.keys(c);
  if (keys.length > CACHE_MAX) {
    keys.sort((a, b) => (c[a].t || 0) - (c[b].t || 0))
      .slice(0, keys.length - CACHE_MAX)
      .forEach((k) => delete c[k]);
  }
  await chrome.storage.local.set({ cache: c });
}

/* ------------------------- 权威词典 ------------------------- */

function buildLinks(q) {
  const e = encodeURIComponent(q);
  return [
    { name: 'Cambridge', url: 'https://dictionary.cambridge.org/dictionary/english-chinese-simplified/' + e },
    { name: 'Merriam-Webster', url: 'https://www.merriam-webster.com/dictionary/' + e },
    { name: 'Collins', url: 'https://www.collinsdictionary.com/dictionary/english/' + e },
    { name: '有道', url: 'https://dict.youdao.com/result?word=' + e + '&lang=en' },
  ];
}

/* 有道 jsonapi 是词典主力：英汉双解 + 柯林斯 + 双语例句，一次请求全拿到。 */

async function fetchYoudaoJSON(q) {
  const url = 'https://dict.youdao.com/jsonapi?q=' + encodeURIComponent(q);
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('有道接口 HTTP ' + res.status);
  return await res.json();
}

function parseYoudao(json, sources) {
  const out = { phonetic: {}, blocks: [], sentences: [] };
  if (!json || typeof json !== 'object') return out;

  const ec = json.ec;
  if (sources.youdao && ec && ec.word && ec.word[0]) {
    const w = ec.word[0];
    out.phonetic.uk = w.ukphone || '';
    out.phonetic.us = w.usphone || '';
    const items = [];
    (w.trs || []).forEach((group) => {
      (group.tr || []).forEach((t) => {
        const lines = (t.l && t.l.i) || [];
        lines.forEach((line) => {
          const text = stripTags(line);
          const m = text.match(/^([a-z]+\.)\s*([\s\S]*)$/i);
          items.push(m ? { pos: m[1], def: m[2] } : { pos: '', def: text });
        });
      });
    });
    if (items.length) out.blocks.push({ id: 'youdao', title: '有道词典 · 英汉双解', items });
    if (w.wfs && w.wfs.length) {
      out.blocks.push({
        id: 'forms',
        title: '词形变化',
        collapsed: true,
        items: w.wfs.map((f) => ({ pos: (f.wf && f.wf.name) || '', def: (f.wf && f.wf.value) || '' })),
      });
    }
  }

  const col = json.collins;
  if (sources.collins && col && col.collins_entries && col.collins_entries.length) {
    const items = [];
    let star = 0;
    col.collins_entries.forEach((entry) => {
      star = star || Number(entry.star || 0);
      const entries = (entry.entries && entry.entries.entry) || [];
      entries.forEach((en) => {
        (en.tran_entry || []).forEach((te) => {
          const ex = te.exam_sents && te.exam_sents.sent && te.exam_sents.sent[0];
          items.push({
            pos: (te.pos_entry && te.pos_entry.pos) || '',
            def: stripTags(te.tran),
            example: ex ? { en: stripTags(ex.eng_sent), zh: stripTags(ex.chn_sent) } : null,
          });
        });
      });
    });
    if (items.length) {
      out.blocks.push({ id: 'collins', title: '柯林斯高阶词典', star, collapsed: true, items });
    }
  }

  const bl = json.blng_sents_part;
  const pairs = (bl && bl['sentence-pair']) || [];
  if (sources.sentences && pairs.length) {
    out.sentences = pairs.slice(0, 4).map((p) => ({
      en: stripTags(p['sentence-eng'] || p.sentence || ''),
      zh: stripTags(p['sentence-translation'] || ''),
    }));
  }

  return out;
}

async function fetchWiktionary(q) {
  const res = await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(q));
  if (!res.ok) return null;
  const arr = await res.json();
  if (!Array.isArray(arr) || !arr.length) return null;

  const phonetics = [];
  arr.forEach((e) => (e.phonetics || []).forEach((p) => phonetics.push(p)));
  const audio = (phonetics.find((p) => p.audio && /-us\./.test(p.audio))
    || phonetics.find((p) => p.audio && /-uk\./.test(p.audio))
    || phonetics.find((p) => p.audio) || {}).audio || '';
  const ipa = (arr[0].phonetic) || ((phonetics.find((p) => p.text) || {}).text || '');

  const items = [];
  arr.forEach((e) => {
    (e.meanings || []).forEach((m) => {
      (m.definitions || []).slice(0, 2).forEach((d) => {
        items.push({
          pos: m.partOfSpeech || '',
          def: d.definition || '',
          example: d.example ? { en: d.example, zh: '' } : null,
        });
      });
    });
  });

  if (!items.length) return null;
  return {
    phonetic: ipa,
    audio,
    block: { id: 'wiktionary', title: 'Wiktionary · 英英释义', source: 'dictionaryapi.dev', collapsed: true, items: items.slice(0, 8) },
  };
}

/* Free Dictionary API（freedictionaryapi.com）：Wiktionary 数据源，免密钥。
   与 dictionaryapi.dev 的收词范围不同，补一层英文释义、例句与音标。 */
async function fetchFreeDictionary(q) {
  const res = await fetch('https://freedictionaryapi.com/api/v1/entries/en/' + encodeURIComponent(q), {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  if (!json || !Array.isArray(json.entries) || !json.entries.length) return null;

  const items = [];
  let phonetic = '';
  json.entries.forEach((e) => {
    if (!phonetic) {
      const pr = (e.pronunciations || []).filter((x) => x && x.text)[0];
      if (pr) phonetic = pr.text;
    }
    (e.senses || []).forEach((s) => {
      if (items.length >= 8) return;
      const def = stripTags(s.definition || '');
      if (!def) return;
      const ex = (s.examples || [])[0];
      items.push({
        pos: e.partOfSpeech || '',
        def,
        example: ex ? { en: stripTags(ex), zh: '' } : null,
      });
    });
  });

  if (!items.length) return null;
  return {
    phonetic,
    block: { id: 'freedict', title: 'Free Dictionary · 英英释义', source: 'freedictionaryapi.com', collapsed: true, items },
  };
}

/* 有道 suggest：简明中文释义 + 网络释义，返回体很小，适合补一条中文速览。 */
async function fetchYoudaoSuggest(q) {
  const url = 'https://dict.youdao.com/suggest?num=5&ver=3.0&doctype=json&cache=false&le=en&q='
    + encodeURIComponent(q);
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('有道 suggest HTTP ' + res.status);
  const json = await res.json();
  const entries = (json && json.data && json.data.entries) || [];
  if (!entries.length) return null;

  const norm = (s) => String(s || '').trim().toLowerCase();
  const exact = entries.filter((e) => norm(e.entry) === norm(q));
  const list = exact.length ? exact : entries.slice(0, 3);

  const items = [];
  list.forEach((e) => {
    const text = stripTags(e.explain || '');
    if (!text) return;
    const m = text.match(/^([a-z]+\.)\s*([\s\S]*)$/i);
    items.push(m ? { pos: m[1], def: m[2] } : { pos: '', def: text });
  });
  if (!items.length) return null;
  return { block: { id: 'ydsimple', title: '有道 · 简明释义', source: 'dict.youdao.com', collapsed: true, items } };
}

async function dictLookup({ text }) {
  const q = String(text || '').trim();
  if (!q) throw new Error('EMPTY_QUERY');
  const settings = await getSettings();
  const sources = settings.sources;

  const result = {
    word: q,
    phonetic: { uk: '', us: '', ipa: '' },
    audio: {},
    blocks: [],
    sentences: [],
    links: buildLinks(q),
    partial: false,
  };

  // 只请求用户开着的来源；关掉的直接给 null，省一次网络往返
  const needYoudao = !!(sources.youdao || sources.collins || sources.sentences);
  const jobs = [
    needYoudao ? fetchYoudaoJSON(q) : Promise.resolve(null),
    sources.wiktionary ? fetchWiktionary(q) : Promise.resolve(null),
    sources.freedict ? fetchFreeDictionary(q) : Promise.resolve(null),
    sources.ydsimple ? fetchYoudaoSuggest(q) : Promise.resolve(null),
  ];
  const [yd, wk, fd, ys] = await Promise.allSettled(jobs);

  const ydBlocks = [];
  if (yd.status === 'fulfilled' && yd.value) {
    const parsed = parseYoudao(yd.value, sources);
    result.phonetic.uk = parsed.phonetic.uk || '';
    result.phonetic.us = parsed.phonetic.us || '';
    ydBlocks.push(...parsed.blocks);
    result.sentences = parsed.sentences;
  } else if (yd.status === 'rejected') {
    result.partial = true;
  }

  const wikiBlocks = [];
  [wk, fd, ys].forEach((r) => {
    if (r.status !== 'fulfilled' || !r.value || !r.value.block) return;
    if (!result.phonetic.uk && !result.phonetic.us && r.value.phonetic) result.phonetic.ipa = r.value.phonetic;
    if (r.value.audio) result.audio.wiki = r.value.audio;
    wikiBlocks.push(r.value.block);
  });

  // 展示顺序：有道 → 柯林斯 → 词形变化 → 英英 → Free Dictionary → 简明释义
  const byId = (id) => ydBlocks.filter((b) => b.id === id);
  const wikiById = (id) => wikiBlocks.filter((b) => b.id === id);
  result.blocks = [
    ...byId('youdao'),
    ...byId('collins'),
    ...byId('forms'),
    ...wikiById('wiktionary'),
    ...wikiById('freedict'),
    ...wikiById('ydsimple'),
  ];

  const enc = encodeURIComponent(q);
  result.audio.uk = 'https://dict.youdao.com/dictvoice?audio=' + enc + '&type=1';
  result.audio.us = 'https://dict.youdao.com/dictvoice?audio=' + enc + '&type=2';
  result.audio.word = q;

  if (!result.blocks.length && !result.sentences.length) result.partial = true;
  return result;
}

/* ------------------------- AI 翻译 ------------------------- */

/* 语言判定与「原文已是中文 → 自动改译英语」。
   规则必须在分发前算一次，让所有通道都拿到生效后的目标语言；
   否则只有读 prompt 的通道会翻转，DeepL/Azure/Google/Libre/free-mt 仍译成中文，
   中文原文甚至会因源语言 = 目标语言直接报 FREE_MT_SAME_LANG。 */
function textLooksZh(text) {
  const s = String(text || '');
  const cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length;
  if (!cjk) return false;
  const latin = (s.match(/[A-Za-z]/g) || []).length;
  return cjk * 2 >= latin;
}

function effectiveTargetLang(text, targetLang) {
  const t = targetLang || 'zh-CN';
  if (textLooksZh(text) && /^zh(-|$)/i.test(t)) return 'en';
  return t;
}

function buildPrompt(text, targetLang, kind) {
  const lang = textLooksZh(text) ? '英语' : (LANG_NAMES[targetLang] || targetLang);

  if (kind === 'word') {
    return [
      '你是专业词典与翻译引擎。请处理下面这个词或短语，翻译为' + lang + '。',
      '严格按以下格式输出，不要任何多余说明、不要 Markdown 标题：',
      '第1行：最贴切的译文',
      '第2行：词性 + 简明释义；有多个常见义项时用 ① ② ③ 并列',
      '第3行：一个例句 + 对照译文，格式「例句 | 对照」',
      '禁止调用任何工具、禁止读写文件、禁止联网搜索，直接回答。',
      '',
      '原文：' + text,
    ].join('\n');
  }

  return [
    '你是专业翻译引擎。将下面的文本翻译为' + lang + '。',
    '要求：',
    '1. 只输出译文，不要解释、不要前言、不要用引号包裹、不要复述原文。',
    '2. 完整保留原文的段落结构、换行与标点风格。',
    '3. 术语使用通用规范译法；人名、地名、品牌名保留原文或使用通行译名。',
    '4. 禁止调用任何工具、禁止读写文件、禁止联网搜索，直接回答。',
    '',
    '原文：',
    text,
  ].join('\n');
}

function cleanOutput(s) {
  let t = String(s || '').trim();
  t = t.replace(/^```[a-z]*\n?/i, '').replace(/```$/, '').trim();
  t = t.replace(/^(译文|翻译|Translation|Output)\s*[:：]\s*/i, '');
  if (/^["“「']([\s\S]*)["”」']$/.test(t) && t.length < 400) {
    t = t.slice(1, -1).trim();
  }
  return t.trim();
}

/* 切句：中英混排按句末标点 + 换行拆开，保留标点本身。
   用于「逐句对照」—— 一句一句翻译后按原顺序配对，读起来才对得上。 */
/* 切句：保留分隔符，按分隔符把整段拆成一句句。
   英文的 "." 要单独认（旧版漏了它，英文整段只能切成一坨），
   但用前后断言排掉小数点与缩写里的点（3.14 / e.g. 里的单字母后不切）。 */
function splitSentences(text) {
  const raw = String(text || '').replace(/\r/g, ' ').trim();
  if (!raw) return [];

  const STOP = '[。！？；…!?;]';
  // 捕获组保留分隔符；连续标点（"？！"）算一个结束。
  // 英文句点只在「后面是空白或结尾、且前面不是数字」时才算断句，
  // 这样 3.14 与 e.g. 不会被切开。
  const parts = raw.split(new RegExp('(' + STOP + '+|(?<![0-9])\\.(?=\\s|$))', 'g'));
  const out = [];
  let buf = '';

  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    if (seg == null || seg === '') continue;
    if (/^[。！？；…!?;.]+$/.test(seg)) {
      buf += seg;
      if (buf.trim()) out.push(buf.trim());
      buf = '';
    } else {
      buf += seg;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.length ? out : [raw];
}

/* 并发上限：逐句翻译时不要一次把十几个请求全撒出去 */
async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let i = 0;
  const workers = [];
  const n = Math.max(1, Math.min(limit, list.length));
  for (let w = 0; w < n; w++) {
    workers.push((async () => {
      for (;;) {
        const idx = i++;
        if (idx >= list.length) return;
        out[idx] = await fn(list[idx], idx);
      }
    })());
  }
  await Promise.all(workers);
  return out;
}

/* 通道三：自定义 OpenAI 兼容接口（DeepSeek / 智谱 / Moonshot / 通义 / 本地 Ollama …） */
async function translateViaOpenAI(ctx, settings, onPartial) {
  const cfg = settings.openai || {};
  const base = String(cfg.baseUrl || '').replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  const model = cfg.model || 'deepseek-chat';
  if (!base) throw new Error('OPENAI_NO_BASEURL');
  if (!cfg.apiKey) throw new Error('OPENAI_NO_KEY');

  const res = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + cfg.apiKey,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      stream: false,
      messages: [
        { role: 'system', content: '你是专业翻译引擎。只输出译文，不要解释、不要前言、不要用引号包裹。' },
        { role: 'user', content: ctx.prompt },
      ],
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json.error && (json.error.message || json.error.code)) || ('自定义模型接口 HTTP ' + res.status);
    throw new Error('自定义模型：' + msg);
  }
  const content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  if (!content) throw new Error('EMPTY_RESULT');
  if (onPartial) onPartial(content);
  return content;
}

/* 通道三·补充：DeepL 官方 API —— 长句/整段质量最好的机器翻译。
   Free 档每月 50 万字符、仅邮箱注册（Key 以 :fx 结尾）；Pro 档走 api.deepl.com。 */
const DEEPL_LANG = {
  'zh-CN': 'ZH', 'zh-TW': 'ZH',   // DeepL 中文只有简体一种
  en: 'EN-US', ja: 'JA', ko: 'KO', fr: 'FR', de: 'DE', es: 'ES', ru: 'RU',
};

async function translateViaDeepl(ctx, settings, onPartial) {
  const cfg = settings.deepl || {};
  const key = String(cfg.apiKey || '').trim();
  if (!key) throw new Error('DEEPL_NO_KEY');
  const host = key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  const target = DEEPL_LANG[ctx.targetLang] || 'ZH';

  // 长文本按 4000 字符切段，用 text 数组一次性提交，DeepL 按原顺序返回
  const chunks = ctx.text.length > 4000 ? splitChunks(ctx.text, 4000) : [ctx.text];
  const res = await fetch(host + '/v2/translate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'DeepL-Auth-Key ' + key,
    },
    body: JSON.stringify({ text: chunks, target_lang: target }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json.message || ('DeepL 接口 HTTP ' + res.status);
    throw new Error('DeepL：' + msg);
  }
  const out = (json.translations || []).map((t) => t && t.text).filter(Boolean).join('');
  if (!out) throw new Error('EMPTY_RESULT');
  if (onPartial) onPartial(out);
  return out;
}

/* 通道四：Microsoft Translator（Azure AI 服务）
   必应词典网页已无公开 JSON 接口（旧 dict/clientsearch 端点返回 HTML，改版即失效），
   因此不再抓页面，改走微软官方翻译 API —— 也就是必应翻译的现行企业版。
   免费档 F0 每月 200 万字符，需 Azure 订阅密钥 + 资源所在区域。 */
const AZURE_LANG = {
  'zh-CN': 'zh-Hans', 'zh-TW': 'zh-Hant',
  en: 'en', ja: 'ja', ko: 'ko', fr: 'fr', de: 'de', es: 'es', ru: 'ru',
};

async function translateViaAzure(ctx, settings, onPartial) {
  const cfg = settings.azure || {};
  const key = String(cfg.apiKey || '').trim();
  const region = String(cfg.region || '').trim();
  if (!key) throw new Error('AZURE_NO_KEY');
  if (!region) throw new Error('AZURE_NO_REGION');

  const target = AZURE_LANG[ctx.targetLang] || ctx.targetLang;
  // 不传 from，交给 Azure 自动检测语种
  const url = 'https://api.cognitive.microsofttranslator.com/translate'
    + '?api-version=3.0&to=' + encodeURIComponent(target);

  // 单次请求上限 50000 字符 / 100 个元素；4000 分段只是留足余量
  const chunks = ctx.text.length > 4000 ? splitChunks(ctx.text, 4000) : [ctx.text];
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Ocp-Apim-Subscription-Key': key,
      'Ocp-Apim-Region': region,
    },
    body: JSON.stringify(chunks.map((t) => ({ Text: t }))),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json.error && json.error.message) || ('Microsoft Translator 接口 HTTP ' + res.status);
    throw new Error('Microsoft Translator：' + msg);
  }
  const out = (Array.isArray(json) ? json : [])
    .map((t) => t && t.translations && t.translations[0] && t.translations[0].text)
    .filter(Boolean)
    .join('');
  if (!out) throw new Error('EMPTY_RESULT');
  if (onPartial) onPartial(out);
  return out;
}

/* 通道五：Google Cloud Translation API（v2 Basic，API Key 直连）
   v2 用 ?key= 认证，不需要 OAuth；v3 要服务账号 JWT，不适合纯客户端扩展。 */
const GOOGLE_LANG = {
  'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW',
  en: 'en', ja: 'ja', ko: 'ko', fr: 'fr', de: 'de', es: 'es', ru: 'ru',
};

async function translateViaGoogle(ctx, settings, onPartial) {
  const cfg = settings.google || {};
  const key = String(cfg.apiKey || '').trim();
  if (!key) throw new Error('GOOGLE_NO_KEY');

  const target = GOOGLE_LANG[ctx.targetLang] || ctx.targetLang;
  const chunks = ctx.text.length > 4000 ? splitChunks(ctx.text, 4000) : [ctx.text];
  const res = await fetch('https://translation.googleapis.com/language/translate/v2?key=' + encodeURIComponent(key), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // q 支持数组，多段一次提交并按原顺序返回
    body: JSON.stringify({ q: chunks, target, format: 'text' }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = json.error || {};
    const msg = e.message || e.status || ('Google 翻译接口 HTTP ' + res.status);
    throw new Error('Google 翻译：' + msg);
  }
  const list = json.data && json.data.translations;
  const out = Array.isArray(list) ? list.map((t) => t && t.translatedText).filter(Boolean).join('') : '';
  if (!out) throw new Error('EMPTY_RESULT');
  if (onPartial) onPartial(out);
  return out;
}

/* 通道六：LibreTranslate —— 可自建的开源翻译后端，也提供官方公共服务。
   接口与键名都公开固定：POST /translate，{q, source, target, api_key} → {translatedText}。
   自建实例通常免 Key；官方 libretranslate.com 现在需要注册拿 Key。 */
const LIBRE_LANG = {
  'zh-CN': 'zh', 'zh-TW': 'zh',       // LibreTranslate 中文只有一个码
  en: 'en', ja: 'ja', ko: 'ko', fr: 'fr', de: 'de', es: 'es', ru: 'ru',
};

async function translateViaLibre(ctx, settings, onPartial) {
  const cfg = settings.libre || {};
  const base = String(cfg.baseUrl || '').replace(/\/+$/, '').replace(/\/translate$/, '');
  if (!base) throw new Error('LIBRE_NO_BASEURL');

  const target = LIBRE_LANG[ctx.targetLang] || ctx.targetLang;
  // 匿名实例通常关闭了 auto 检测，这里按字符启发式给源语言
  const source = /[\u4e00-\u9fff]/.test(ctx.text) ? 'zh' : 'en';
  const chunks = ctx.text.length > 2000 ? splitChunks(ctx.text, 2000) : [ctx.text];

  const parts = [];
  for (const t of chunks) {
    const body = { q: t, source, target, format: 'text' };
    if (cfg.apiKey) body.api_key = cfg.apiKey;
    const res = await fetch(base + '/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json.error || json.message || ('LibreTranslate 接口 HTTP ' + res.status);
      throw new Error('LibreTranslate：' + msg);
    }
    const one = json.translatedText;
    if (!one) throw new Error('EMPTY_RESULT');
    parts.push(one);
    if (onPartial) onPartial(parts.join(''));
  }
  return parts.join('');
}

/* 通道四：免密钥机器翻译（MyMemory，匿名可用） */
const MM_LANG = {
  'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW', en: 'en', ja: 'ja', ko: 'ko',
  fr: 'fr', de: 'de', es: 'es', ru: 'ru',
};

function splitChunks(text, limit) {
  const out = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf(' ', limit);
    if (cut < limit * 0.5) cut = rest.lastIndexOf('\n', limit);
    if (cut < limit * 0.5) cut = limit;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.trim()) out.push(rest);
  return out;
}

async function translateViaFreeMT(ctx, onPartial) {
  const tgt = MM_LANG[ctx.targetLang] || ctx.targetLang;
  const src = /[\u4e00-\u9fff]/.test(ctx.text) ? 'zh-CN' : 'en';
  if (src === tgt) throw new Error('FREE_MT_SAME_LANG');

  const parts = [];
  for (const chunk of splitChunks(ctx.text, 450)) {
    const url = 'https://api.mymemory.translated.net/get?q='
      + encodeURIComponent(chunk) + '&langpair=' + encodeURIComponent(src + '|' + tgt);
    const res = await fetch(url);
    const json = await res.json().catch(() => null);
    const t = json && json.responseData && json.responseData.translatedText;
    if (!t) {
      const detail = json && json.responseDetails ? json.responseDetails : '接口无返回';
      throw new Error('免费机器翻译：' + String(detail).slice(0, 120));
    }
    parts.push(t);
    if (onPartial) onPartial(parts.join(''));
  }
  return parts.join('');
}

async function runProvider(provider, ctx, onPartial, settings) {
  if (provider === 'openai') return translateViaOpenAI(ctx, settings, onPartial);
  if (provider === 'deepl') return translateViaDeepl(ctx, settings, onPartial);
  if (provider === 'azure') return translateViaAzure(ctx, settings, onPartial);
  if (provider === 'google') return translateViaGoogle(ctx, settings, onPartial);
  if (provider === 'libre') return translateViaLibre(ctx, settings, onPartial);
  if (provider === 'free-mt') return translateViaFreeMT(ctx, onPartial);
  if (provider === 'chrome-ai') throw new Error('CHROME_AI_PAGE_ONLY');
  throw new Error('UNKNOWN_PROVIDER');
}

/* 一次通道调用：缓存 → 调用 → 兜底 → 清洗 → 回写缓存 */
async function runOnce(provider, ctx, onPartial, settings, allowFallback) {
  const key = 'ai:' + hashStr(provider + '|' + ctx.targetLang + '|' + ctx.kind + '|' + ctx.text);
  const hit = await cacheGet(key);
  if (hit) {
    if (onPartial) onPartial(hit);
    return { text: hit, cached: true };
  }

  let raw;
  try {
    raw = await runProvider(provider, ctx, onPartial, settings);
  } catch (err) {
    if (allowFallback && provider !== 'free-mt') {
      raw = await runProvider('free-mt', ctx, () => {}, settings);
    } else {
      throw err;
    }
  }

  const out = cleanOutput(raw);
  if (!out) throw new Error('EMPTY_RESULT');
  await cacheSet(key, out, settings.cacheDays);
  return { text: out, cached: false };
}

async function aiTranslate({ text, targetLang, provider }, onPartial, opts) {
  const settings = await getSettings();
  if (!settings.aiEnabled) throw new Error('AI_DISABLED');

  const src = String(text || '').trim();
  if (!src) throw new Error('EMPTY_QUERY');

  const kind = src.split(/\s+/).filter(Boolean).length <= 3 && src.length <= 40 ? 'word' : 'sentence';
  const lang = effectiveTargetLang(src, targetLang || settings.targetLang);
  const sOpt = Object.assign({}, DEFAULT_SETTINGS.sentence, settings.sentence || {});

  // 句子可以单独指定通道：比如单词用本地模型、长句走 DeepL
  let useProvider = provider || settings.provider || 'chrome-ai';
  if (kind === 'sentence' && sOpt.provider && sOpt.provider !== 'follow') {
    useProvider = sOpt.provider;
  }

  const prompt = buildPrompt(src, lang, kind);
  const ctx = { text: src, targetLang: lang, prompt, kind };

  // opts.fallback === false 时不做免费机器翻译兜底（并列对照用）
  const allowFallback = !(opts && opts.fallback === false) && settings.fallbackEnabled;

  // 逐句对照：切句后一句一句翻，再把「原文 / 译文」成对回传，面板按对显示
  const wantPairs = kind === 'sentence'
    && sOpt.mode === 'bilingual'
    && sOpt.perSentence !== false
    && !(opts && opts.noPairs);

  if (wantPairs) {
    const sentences = splitSentences(src).slice(0, 24);
    if (sentences.length >= 2) {
      const done = await mapLimit(sentences, 4, (one) => runOnce(
        useProvider,
        { text: one, targetLang: lang, prompt: buildPrompt(one, lang, 'sentence'), kind: 'sentence' },
        () => {},
        settings,
        allowFallback,
      ));
      const pairs = sentences.map((s, i) => ({ src: s, dst: (done[i] && done[i].text) || '' }));
      const joined = pairs.map((p) => p.dst).filter(Boolean).join('\n');
      if (onPartial) onPartial(joined);
      return { text: joined, pairs, cached: false };
    }
  }

  const res = await runOnce(useProvider, ctx, onPartial, settings, allowFallback);
  // 「原文 + 译文」模式也把原文带回去，面板直接分段渲染
  if (kind === 'sentence' && sOpt.mode === 'source') {
    res.pairs = [{ src, dst: res.text }];
  }
  return res;
}

/* 并列对照：多个通道各跑一遍，逐通道把结果推回对应的列。
   与单通道的关键差别是 **不做 free-mt 降级** —— 否则失败的那列会变成和
   另一列一样的免费机器翻译结果，对照就失去意义。这里宁可让那一列明确报错，
   用户才知道是该去补密钥。 */
/* 并列只允许远程通道；LibreTranslate 与其它远程通道一视同仁。 */
const PARALLEL_ALLOWED = ['deepl', 'azure', 'google', 'libre', 'openai', 'free-mt'];

async function aiTranslateParallel({ text, targetLang, providers }, onChannel) {
  const settings = await getSettings();
  if (!settings.aiEnabled) throw new Error('AI_DISABLED');

  const src = String(text || '').trim();
  if (!src) throw new Error('EMPTY_QUERY');

  const list = (Array.isArray(providers) ? providers : [])
    .filter((p) => PARALLEL_ALLOWED.indexOf(p) >= 0)
    .slice(0, 4);

  await Promise.all(list.map(async (p, i) => {
    try {
      const res = await aiTranslate(
        { text: src, targetLang, provider: p },
        (t) => onChannel({ index: i, provider: p, phase: 'partial', text: t }),
        { fallback: false, noPairs: true },
      );
      onChannel({ index: i, provider: p, phase: 'done', text: res.text, cached: res.cached });
    } catch (e) {
      onChannel({ index: i, provider: p, phase: 'error', code: (e && e.message) || 'ERROR' });
    }
  }));
}

/* ------------------------- 消息路由 ------------------------- */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg && msg.type) {
        case 'dict:lookup':
          sendResponse({ ok: true, data: await dictLookup(msg.payload || {}) });
          break;
        case 'settings:get':
          sendResponse({ ok: true, data: await getSettings() });
          break;
        case 'settings:set':
          sendResponse({ ok: true, data: await setSettings(msg.payload) });
          break;
        case 'ai:translate':
          // 设置页「连通性测试」用：验证当前通道的凭据与接口
          sendResponse({ ok: true, data: await aiTranslate(msg.payload || {}, null, {}) });
          break;
        case 'cache:clear':
          await chrome.storage.local.remove('cache');
          sendResponse({ ok: true });
          break;
        case 'open:options':
          chrome.runtime.openOptionsPage();
          sendResponse({ ok: true });
          break;
        default:
          sendResponse({ ok: false, error: 'UNKNOWN_MESSAGE' });
      }
    } catch (err) {
      sendResponse({ ok: false, error: (err && err.message) || String(err) });
    }
  })();
  return true;
});

/* AI 流式通道 */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ai') return;
  let aborted = false;
  port.onDisconnect.addListener(() => { aborted = true; });
  port.onMessage.addListener(async (msg) => {
    if (!msg || msg.type !== 'start') return;
    const push = (payload) => { if (!aborted) { try { port.postMessage(payload); } catch (e) { aborted = true; } } };
    const payload = msg.payload || {};
    // 只要带的是数组就走并列（哪怕只剩一个远程通道，也要按列独立、不兜底）
    const multi = Array.isArray(payload.providers) && payload.providers.length > 0;

    try {
      if (multi) {
        // 并列对照：每个通道单独推一条 chan 事件
        // 注意：并列模式不发 done —— 主容器装的是 grid，清空它会把两列一起抹掉
        await aiTranslateParallel(payload, (ev) => push(Object.assign({ type: 'chan' }, ev)));
      } else {
        const res = await aiTranslate(payload, (partial) => push({ type: 'partial', text: partial }));
        push({ type: 'done', text: res.text, cached: res.cached, pairs: res.pairs || null });
      }
    } catch (err) {
      push({ type: 'error', code: (err && err.message) || 'ERROR' });
    }
  });
});

/* 右键菜单 */
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'st-lookup',
    title: '用「划词译」查询选中的内容',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'st-lookup' || !tab || !tab.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'st:open', text: info.selectionText || '' }).catch(() => {});
});
