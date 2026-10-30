/* 划词译 · 划词气泡与面板的端到端冒烟。
   用法：testkit run tests/e2e/selection-bubble.spec.mjs --extension=.
   覆盖三个历史上出过问题的场景：
     1) 选区贴着页面顶部 —— 旧版 top 算成负数，气泡被顶出视口，看起来「没反应」；
     2) 跨行选区末尾落在下一行行首 —— 最后一个 client rect 是零宽的，旧版直接放弃；
     3) 点中气泡要能真的打开面板（命中区够大、不被 mousedown 提前撤掉）。 */

export const meta = { name: 'selecttrans · 划词气泡' };

const HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>
  body { margin: 0; font: 16px/1.8 -apple-system, sans-serif; }
  /* 第一段故意顶在页面最上面，用来复现负 top 的 bug */
  #top { position: absolute; top: 4px; left: 16px; }
  #mid { position: absolute; top: 300px; left: 16px; width: 320px; }
</style></head>
<body>
  <p id="top">Serendipity is the art of finding something good without looking for it.</p>
  <p id="mid">The committee deferred its decision pending further evidence, and the chairman asked everyone to wait quietly until the next meeting was finally convened.</p>
  <p id="word">defer</p>
</body></html>`;

async function tipBox(page) {
  return page.evaluate(() => {
    const host = document.getElementById('st-root-host-tip');
    if (!host || !host.shadowRoot) return null;
    const btn = host.shadowRoot.querySelector('.st-tip');
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, text: btn.textContent };
  });
}

async function panelBox(page) {
  return page.evaluate(() => {
    const host = document.getElementById('st-root-host');
    if (!host || !host.shadowRoot) return null;
    const card = host.shadowRoot.querySelector('.st-card');
    if (!card) return null;
    const r = card.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
}

export default async function (t) {
  const { launch, serve, captureConsole, expect, waitFor, options, log } = t;

  const server = await serve({ title: 'selecttrans smoke', body: HTML });
  const context = await launch({
    headless: options.headless !== false,
    channel: options.channel,
    // --extension=<dir> 只进了 options，launch 需要显式带上
    extensions: options.extensions && options.extensions.length ? options.extensions : ['dist'],
  });
  const page = context.pages()[0] || (await context.newPage());
  const logs = captureConsole(page, { label: 'page' });

  await page.goto(server.url, { waitUntil: 'domcontentloaded' });
  // content script 在 document_idle 注入，等它把监听挂上
  await waitFor(() => page.evaluate(() => document.documentElement.getAttribute('data-st-ready') === '1'),
    { timeout: 8000, message: 'content script 注入完成' });

  /* ------- 场景 1：顶部选区也要能看到气泡 ------- */
  log('场景 1 · 贴顶选区');
  {
    const box = await page.locator('#top').boundingBox();
    await page.mouse.move(box.x + 10, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();

    const tip = await waitFor(() => tipBox(page), { timeout: 4000, message: '顶部选区的气泡出现' });
    expect.equal(tip.text, '译', '气泡上写着「译」');
    expect.truthy(tip.y >= 0, `气泡必须在视口内（y=${tip.y}）`);
    expect.truthy(tip.y + tip.h <= 900, '气泡不能跑到视口下方');
    expect.truthy(tip.w >= 24, '按钮本体不小于 24px');
  }

  /* ------- 场景 2：跨行选区（末尾零宽矩形） ------- */
  log('场景 2 · 跨行选区，末尾落在下一行行首');
  {
    await page.mouse.click(5, 5);           // 先清掉上一个选区
    const box = await page.locator('#mid').boundingBox();
    await page.mouse.move(box.x + 8, box.y + 8);
    await page.mouse.down();
    // 拖到第二行行首：range 的最后一个 rect 会是零宽的
    await page.mouse.move(box.x + 8, box.y + box.height - 6, { steps: 12 });
    await page.mouse.up();

    const tip = await waitFor(() => tipBox(page), { timeout: 4000, message: '跨行选区的气泡出现' });
    expect.truthy(tip.y >= 0 && tip.y + tip.h <= 900, `跨行气泡也在视口内（y=${tip.y}）`);

    /* ------- 场景 3：点中气泡要打开面板 ------- */
    log('场景 3 · 点击气泡打开面板');
    await page.mouse.move(tip.x + tip.w / 2, tip.y + tip.h / 2);
    await page.mouse.down();
    await page.mouse.up();

    const card = await waitFor(() => panelBox(page), { timeout: 4000, message: '面板打开' });
    expect.truthy(card.w > 200 && card.h > 60, `面板尺寸正常（${card.w}×${card.h}）`);
    expect.truthy(card.x >= 0 && card.y >= 0, `面板在视口内（${card.x}, ${card.y}）`);

    // 气泡开完面板就该消失，不要留两个浮层
    expect.equal(await tipBox(page), null, '打开面板后气泡移除');

    /* ------- 场景 4：句子模式要有「译文 / 对照 / 原文」开关 ------- */
    log('场景 4 · 句子显示方式开关');
    const BTNS = '.st-sec-hd button';
    const headBtns = async () => page.evaluate((sel) => {
      const host = document.getElementById('st-root-host');
      if (!host || !host.shadowRoot) return [];
      return Array.from(host.shadowRoot.querySelectorAll(sel))
        .map((b) => ({ text: b.textContent.trim(), title: b.title || '' }));
    }, BTNS);
    // 句子开关的 title 以「句子显示方式」开头，据此与「单条 / 对照」区分
    const sentBtn = async () => (await headBtns()).filter((b) => b.title.indexOf('句子显示方式') === 0)[0] || null;
    const clickHead = async (label) => page.evaluate((args) => {
      const host = document.getElementById('st-root-host');
      const btn = Array.from(host.shadowRoot.querySelectorAll(args.sel))
        .filter((b) => b.textContent.trim() === args.want)[0];
      if (!btn) return false;
      btn.click();
      return true;
    }, { sel: BTNS, want: label });

    // 并列模式下每列各翻各的、不产生对照对，所以先切回单条模式
    if ((await headBtns()).some((b) => b.text === '单条')) await clickHead('单条');
    const before = await waitFor(async () => (await sentBtn()) || null,
      { timeout: 4000, message: '单条模式下出现句子显示方式开关' });
    expect.equal(before.text, '译文', '句子开关默认「译文」');

    await clickHead('译文');
    const after = await waitFor(async () => {
      const b = await sentBtn();
      return b && b.text === '对照' ? b : null;
    }, { timeout: 4000, message: '点击后切到「对照」' });
    log('切换后：' + after.text + '（' + after.title + '）');

    await page.keyboard.press('Escape');
    await waitFor(async () => (await panelBox(page)) === null, { timeout: 3000, message: 'Esc 关闭面板' });
  }

  log('浏览器日志：\n' + (logs.text() || '（无）'));
  await context.testkit.cleanup();
  await server.close();
}
