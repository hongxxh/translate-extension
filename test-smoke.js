/* 冒烟测试：复用 background.js 中的纯函数，对真实接口数据做解析验证 */
const fs = require('fs');
const vm = require('vm');

const src = fs.readFileSync(__dirname + '/src/background.js', 'utf8');
const cut = src.indexOf('/* ------------------------- 消息路由');
const pure = src.slice(0, cut);

const sandbox = {
  fetch: (u, o) => fetch(u, o),
  console,
  URLSearchParams,
  chrome: { storage: { local: { get: async () => ({}), set: async () => {} } } },
  setTimeout,
  clearTimeout,
};
vm.createContext(sandbox);
vm.runInContext(pure, sandbox);

const YD = sandbox.parseYoudao, WK = sandbox.fetchWiktionary, BL = sandbox.buildLinks;
const PR = sandbox.buildPrompt, CO = sandbox.cleanOutput, SS = sandbox.splitSentences;

function assert(cond, msg) {
  if (!cond) { console.error('  FAIL:', msg); process.exitCode = 1; }
  else console.log('  ok  :', msg);
}

(async () => {
  const SOURCES = {
    youdao: true, collins: true, sentences: true,
    wiktionary: true, freedict: true, ydsimple: true,
  };

  for (const word of ['hello', 'defer', 'serendipity']) {
    console.log('\n== 有道 / ' + word + ' ==');
    const json = await sandbox.fetchYoudaoJSON(word);
    const parsed = YD(json, SOURCES);
    const ec = parsed.blocks.find(b => b.id === 'youdao');
    assert(ec && ec.items.length > 0, `英汉双解 ${ec ? ec.items.length : 0} 条`);
    assert(parsed.phonetic.us || parsed.phonetic.uk, '音标 ' + JSON.stringify(parsed.phonetic));
    const col = parsed.blocks.find(b => b.id === 'collins');
    console.log('  柯林斯条数:', col ? col.items.length : 0, '星级:', col ? col.star : '-');
    console.log('  例句数:', parsed.sentences.length);
    assert(parsed.sentences.length > 0 || word === 'serendipity', '双语例句');
    console.log('  首条释义:', JSON.stringify(ec.items[0]).slice(0, 90));
  }

  console.log('\n== Wiktionary / hello ==');
  const wk = await WK('hello');
  assert(wk && wk.block && wk.block.items.length > 0, `英英释义 ${wk ? wk.block.items.length : 0} 条`);
  assert(wk && wk.block.items.some(i => i.example && i.example.en), '含英文例句');
  console.log('  音标:', wk.phonetic, ' 音频:', (wk.audio || '').slice(0, 60));

  console.log('\n== Wiktionary / 中文词（应安全返回 null）==');
  const wk2 = await WK('你好');
  assert(wk2 === null, '中文词不崩溃，返回 null');

  console.log('\n== Free Dictionary / hello ==');
  const fd = await sandbox.fetchFreeDictionary('hello');
  assert(fd && fd.block && fd.block.items.length > 0, `英英释义 ${fd ? fd.block.items.length : 0} 条`);
  assert(fd && !!(fd.phonetic || fd.block.items[0].def), '含音标或释义');
  if (fd) console.log('  首条:', JSON.stringify(fd.block.items[0]).slice(0, 90));

  console.log('\n== 有道简明释义 / hello ==');
  const ys = await sandbox.fetchYoudaoSuggest('hello');
  assert(ys && ys.block && ys.block.items.length > 0, `简明释义 ${ys ? ys.block.items.length : 0} 条`);
  assert(ys && /[\u4e00-\u9fff]/.test(ys.block.items[0].def), '首条是中文释义');
  if (ys) console.log('  首条:', JSON.stringify(ys.block.items[0]).slice(0, 90));

  console.log('\n== 权威词典跳转 ==');
  const links = BL('hello');
  assert(links.length === 4, '跳转站共 4 个：' + links.map((l) => l.name).join(' / '));
  assert(links[0].url.includes('dictionary.cambridge.org'), 'Cambridge');
  assert(links[1].url.includes('merriam-webster.com'), 'Merriam-Webster');
  assert(links[2].url.includes('collinsdictionary.com'), 'Collins');
  assert(links[3].url.includes('dict.youdao.com'), '有道在列');

  console.log('\n== 提示词 ==');
  const pw = PR('serendipity', 'zh-CN', 'word');
  const ps = PR('The committee deferred its decision.', 'zh-CN', 'sentence');
  assert(/第1行/.test(pw) && /serendipity/.test(pw), '单词模板结构正确');
  assert(/只输出译文/.test(ps) && ps.includes('The committee'), '句子模板结构正确');
  assert(PR('你好世界', 'zh-CN', 'sentence').includes('英语'), '中文原文自动改译英语');
  const ETL = sandbox.effectiveTargetLang;
  assert(ETL('你好世界', 'zh-CN') === 'en', '生效目标语言：中→英');
  assert(ETL('Hello world', 'zh-CN') === 'zh-CN', '生效目标语言：英→中不受影响');

  console.log('\n== 输出清洗 ==');
  assert(CO('"Hello."') === 'Hello.', '去包裹引号 → ' + CO('"Hello."'));
  assert(CO('译文：你好') === '你好', '去前缀 → ' + CO('译文：你好'));
  assert(CO('```\n你好\n```') === '你好', '去代码块 → ' + CO('```\n你好\n```'));
  assert(CO('Translation: hi there') === 'hi there', '去英文前缀 → ' + CO('Translation: hi there'));

  console.log('\n== HTML 清洗 ==');
  assert(vm.runInContext('stripTags(\'You say "<b>hello</b>"\')', sandbox) === 'You say "hello"', 'stripTags');

  console.log('\n== 聚合查询（dictLookup）==');
  const merged = await sandbox.dictLookup({ text: 'defer' });
  const ids = merged.blocks.map((b) => b.id);
  assert(ids.indexOf('youdao') === 0, '有道排在首位：' + ids.join(' > '));
  assert(ids.indexOf('youdao') < ids.indexOf('collins'), '柯林斯排在有道之后');
  assert(merged.links.length === 4, '跳转链接 4 条：' + merged.links.map((l) => l.name).join(' / '));
  console.log('  最终顺序:', ids.join(' > '));
  console.log('  音标:', JSON.stringify(merged.phonetic), '| 例句:', merged.sentences.length);

  console.log('\n== 免密钥机器翻译（MyMemory）==');
  const mt1 = await sandbox.translateViaFreeMT(
    { text: 'The committee deferred its decision pending further evidence.', targetLang: 'zh-CN' },
    () => {}
  );
  assert(/[\u4e00-\u9fff]/.test(mt1), '英→中 返回中文：' + mt1.slice(0, 60));
  const mt2 = await sandbox.translateViaFreeMT({ text: '你好世界', targetLang: 'en' }, () => {});
  assert(/[A-Za-z]/.test(mt2), '中→英 返回英文：' + mt2.slice(0, 60));
  let mtErr = null;
  try {
    await sandbox.translateViaFreeMT({ text: '你好', targetLang: 'zh-CN' }, () => {});
  } catch (e) { mtErr = e.message; }
  assert(mtErr === 'FREE_MT_SAME_LANG', '同语言检测：' + mtErr);

  console.log('\n== 分块（长文本）==');
  const long = 'word '.repeat(200);
  const chunks = sandbox.splitChunks(long, 450);
  assert(chunks.length > 1 && chunks.every((c) => c.length <= 460), '长文本切成 ' + chunks.length + ' 块，均不超限');

  console.log('\n== 通道分发 ==');
  let e1 = null;
  try { await sandbox.runProvider('chrome-ai', { prompt: 'x' }, () => {}, {}); } catch (e) { e1 = e.message; }
  assert(e1 === 'CHROME_AI_PAGE_ONLY', 'chrome-ai 不在 service worker 执行：' + e1);
  let e2 = null;
  try { await sandbox.runProvider('openai', { prompt: 'x' }, () => {}, { openai: {} }); } catch (e) { e2 = e.message; }
  assert(e2 === 'OPENAI_NO_BASEURL', '缺少接口地址：' + e2);
  let e3 = null;
  try { await sandbox.runProvider('openai', { prompt: 'x' }, () => {}, { openai: { baseUrl: 'https://x/v1' } }); } catch (e) { e3 = e.message; }
  assert(e3 === 'OPENAI_NO_KEY', '缺少 API Key：' + e3);
  let e4 = null;
  try { await sandbox.runProvider('deepl', { prompt: 'x' }, () => {}, { deepl: {} }); } catch (e) { e4 = e.message; }
  assert(e4 === 'DEEPL_NO_KEY', 'DeepL 缺少 Key：' + e4);
  let e5 = null;
  try { await sandbox.runProvider('tencent', { prompt: 'x' }, () => {}, {}); } catch (e) { e5 = e.message; }
  assert(e5 === 'UNKNOWN_PROVIDER', '腾讯混元已下线：' + e5);
  let e7 = null;
  try { await sandbox.runProvider('azure', { text: 'x', targetLang: 'zh-CN' }, () => {}, { azure: {} }); } catch (e) { e7 = e.message; }
  assert(e7 === 'AZURE_NO_KEY', 'Microsoft Translator 缺少密钥：' + e7);
  let e8 = null;
  try { await sandbox.runProvider('azure', { text: 'x', targetLang: 'zh-CN' }, () => {}, { azure: { apiKey: 'k' } }); } catch (e) { e8 = e.message; }
  assert(e8 === 'AZURE_NO_REGION', 'Microsoft Translator 缺少区域：' + e8);
  let e9 = null;
  try { await sandbox.runProvider('google', { text: 'x', targetLang: 'zh-CN' }, () => {}, { google: {} }); } catch (e) { e9 = e.message; }
  assert(e9 === 'GOOGLE_NO_KEY', 'Google 翻译缺少 Key：' + e9);
  let e10 = null;
  try { await sandbox.runProvider('libre', { text: 'x', targetLang: 'zh-CN' }, () => {}, { libre: { baseUrl: '' } }); } catch (e) { e10 = e.message; }
  assert(e10 === 'LIBRE_NO_BASEURL', 'LibreTranslate 缺少服务地址：' + e10);

  console.log('\n== 句子切分（逐句对照用）==');
  const ss = SS('Hello world. How are you? 我很好。真的');
  assert(ss.length === 4, '中英混排切成 4 句：' + JSON.stringify(ss));
  assert(ss[0] === 'Hello world.' && ss[3] === '真的', '标点保留、无标点尾句也保留');
  assert(SS('no stop here').length === 1, '无句末标点时不切：' + JSON.stringify(SS('no stop here')));

  console.log('\n测试结束');
})();
