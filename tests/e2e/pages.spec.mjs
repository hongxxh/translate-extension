/* 设置页与弹窗的加载冒烟：改动 options.js / popup.js 后最容易踩的是
   「HTML 里删了某个 id，JS 还在 $('xxx')」—— 这里直接把两个页面打开跑一遍，
   断言关键控件存在且没有脚本报错。 */

export const meta = { name: 'selecttrans · 设置页与弹窗' };

export default async function (t) {
  const { launch, captureConsole, getExtensionId, expect, waitFor, options, log } = t;

  const context = await launch({
    headless: options.headless !== false,
    channel: options.channel,
    extensions: options.extensions && options.extensions.length ? options.extensions : ['.'],
  });

  const id = await getExtensionId(context);
  log('extension id: ' + id);

  const errors = [];
  const open = async (path) => {
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(path + ' → ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(path + ' → ' + m.text()); });
    await page.goto('chrome-extension://' + id + path, { waitUntil: 'load' });
    captureConsole(page, { label: path });
    return page;
  };

  /* ---- 设置页 ---- */
  const opt = await open('/src/options.html');
  await waitFor(() => opt.evaluate(() => !!document.getElementById('sentProvider')),
    { timeout: 5000, message: '设置页加载' });

  const optInfo = await opt.evaluate(() => {
    const ids = ['provider', 'targetLang', 'trigger', 'azKey', 'azRegion', 'ggKey', 'lbBase',
      'lbKey', 'deeplKey', 'sentProvider', 'sentMode', 'sentPerSentence', 'sentDict',
      'src-youdao', 'src-collins', 'src-sentences', 'src-wiktionary', 'src-freedict', 'src-ydsimple',
      'azureCard', 'googleCard', 'libreCard', 'deeplCard', 'openaiCard'];
    const missing = ids.filter((i) => !document.getElementById(i));
    return {
      missing,
      providers: Array.from(document.getElementById('provider').options).map((o) => o.value),
      cmpPick: Array.from(document.querySelectorAll('#cmpPick input')).map((i) => i.value),
      // 旧版的必应词典勾选项不该还在
      hasBing: !!document.getElementById('src-bing'),
      hasWb: !!document.getElementById('wbCard') || !!document.getElementById('clientId'),
      cards: ids.filter((i) => /Card$/.test(i))
        .map((i) => i + '=' + (document.getElementById(i).hidden ? 'hidden' : 'shown')),
    };
  });
  expect.equal(optInfo.missing.length, 0, '设置页缺少控件：' + optInfo.missing.join(', '));
  expect.equal(optInfo.providers.length, 7, '通道下拉 7 项：' + optInfo.providers.join('/'));
  expect.truthy(optInfo.providers.indexOf('azure') >= 0
    && optInfo.providers.indexOf('google') >= 0
    && optInfo.providers.indexOf('libre') >= 0, '主通道含 azure / google / libre');
  expect.equal(optInfo.providers.indexOf('tencent'), -1, '腾讯混元已移除');
  expect.equal(optInfo.cmpPick.length, 7, '并列勾选 7 项：' + optInfo.cmpPick.join('/'));
  expect.truthy(optInfo.cmpPick.indexOf('libre') >= 0, 'LibreTranslate 可勾进并排');
  expect.equal(optInfo.providers.indexOf('workbuddy'), -1, 'workbuddy 已移除');
  expect.equal(optInfo.hasBing, false, '必应词典勾选项已移除');
  expect.equal(optInfo.hasWb, false, 'WorkBuddy 凭据卡片已移除');
  log('卡片显隐：' + optInfo.cards.join(' '));

  /* ---- 弹窗 ---- */
  const pop = await open('/src/popup.html');
  await waitFor(() => pop.evaluate(() => !!document.getElementById('provider')),
    { timeout: 5000, message: '弹窗加载' });

  const popInfo = await pop.evaluate(() => ({
    providers: Array.from(document.getElementById('provider').options).map((o) => o.value),
    hasBing: !!document.getElementById('src-bing'),
    note: document.getElementById('authNote').textContent.trim(),
    box: document.getElementById('authBox').textContent.trim(),
  }));
  expect.equal(popInfo.providers.length, 7, '弹窗通道 7 项：' + popInfo.providers.join('/'));
  expect.equal(popInfo.providers.indexOf('tencent'), -1, '弹窗里腾讯混元已移除');
  expect.equal(popInfo.hasBing, false, '弹窗里也没有必应勾选项');
  expect.truthy(popInfo.box.length > 0, '授权区有内容：' + popInfo.box);
  log('弹窗提示：' + popInfo.note);

  await waitFor(() => errors.length >= 0, { timeout: 200 });
  if (errors.length) throw new Error('页面报错：\n' + errors.join('\n'));
  log('两个页面均无脚本报错');

  await context.testkit.cleanup();
}
