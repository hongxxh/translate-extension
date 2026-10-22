/* =========================================================
 * 划词译 · SelectTrans — content script
 * 划词 → 气泡按钮 → 面板（AI 翻译 + 权威词典）
 * ========================================================= */

(function () {
  if (window.__selectTransLoaded) return;
  window.__selectTransLoaded = true;

  const MAX_Z = '2147483647';
  const HOST_ID = 'st-root-host';
  const TIP_BOX = 46;   // 气泡命中区边长（视觉按钮 28px，四周各留 9px）
  const PAD = 8;        // 浮层与视口边缘的最小间距
  const pad = PAD;

  const state = {
    settings: null,
    text: '',
    panel: null,
    tip: null,
    rect: null,
    seq: 0,
    port: null,
    hideTimer: 0,
    tipTimer: 0,
    tipRect: null,
    tipText: '',
    selTimer: 0,
    dragging: false,
    lastOpen: null,
  };

  /* --------------------------- 样式 --------------------------- */

  const CSS = `
  :host { all: initial; }
  .st-card, .st-card * {
    box-sizing: border-box; margin: 0; padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  }
  .st-card {
    width: 384px; max-height: 540px; display: flex; flex-direction: column;
    background: #FFFFFF; border: 1px solid #E4E6EB; border-radius: 12px;
    box-shadow: 0 10px 32px rgba(15,23,42,.16), 0 2px 6px rgba(15,23,42,.06);
    overflow: hidden; color: #1F2329; font-size: 13px; line-height: 1.62;
    text-align: left; direction: ltr;
  }
  .st-hd { padding: 13px 15px 11px; border-bottom: 1px solid #F0F1F4; position: relative; }
  .st-title { display: flex; align-items: baseline; gap: 8px; padding-right: 26px; }
  .st-word { font-size: 18px; font-weight: 600; letter-spacing: -.01em; color: #101828; word-break: break-word; }
  /* 句子模式：原文最多只显示一行，点击展开/收起 */
  .st-word.is-sent {
    font-size: 13px; font-weight: 400; color: #4B5563; line-height: 1.55; letter-spacing: 0;
    display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical;
    overflow: hidden; cursor: pointer;
  }
  .st-word.is-sent.open { display: block; -webkit-line-clamp: unset; white-space: pre-wrap; }
  .st-word.is-sent.open::after { content: "  收起"; font-size: 11px; color: #9AA1AC; white-space: nowrap; }
  .st-phon { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 4px; color: #6B7280; font-size: 12px; }
  .st-phon .st-p { display: inline-flex; align-items: center; gap: 3px; }
  .st-spk {
    display: inline-flex; align-items: center; justify-content: center;
    width: 20px; height: 20px; border: 0; border-radius: 5px; background: transparent;
    color: #185FA5; cursor: pointer; padding: 0;
  }
  .st-spk:hover { background: #EAF2FB; }
  .st-close {
    position: absolute; top: 10px; right: 10px; width: 22px; height: 22px;
    border: 0; border-radius: 6px; background: transparent; color: #9AA1AC;
    cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0;
  }
  .st-close:hover { background: #F3F4F6; color: #4B5563; }
  .st-body { overflow-y: auto; overscroll-behavior: contain; flex: 1 1 auto; }
  .st-body::-webkit-scrollbar { width: 8px; }
  .st-body::-webkit-scrollbar-thumb { background: #D8DBE1; border-radius: 4px; }
  .st-body::-webkit-scrollbar-track { background: transparent; }

  .st-sec { padding: 12px 15px; border-bottom: 1px solid #F3F4F6; }
  .st-sec:last-child { border-bottom: 0; }
  .st-sec-hd { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
  .st-badge {
    font-size: 10px; font-weight: 600; letter-spacing: .04em; padding: 1px 5px;
    border-radius: 4px; background: #EAF2FB; color: #185FA5; line-height: 1.5;
  }
  .st-sec-t { font-size: 11px; font-weight: 600; color: #6B7280; letter-spacing: .02em; }
  .st-mode { margin-left: auto; font-size: 10px; color: #9AA1AC; }
  /* 面板内通道切换：做成文字样式，避免破坏标题区的克制感 */
  .st-ch {
    font: inherit; font-size: 11px; font-weight: 600; color: #6B7280;
    letter-spacing: .02em; border: 0; background: transparent; padding: 0 2px;
    margin: 0 -2px; cursor: pointer; outline: none; max-width: 210px;
  }
  .st-ch:hover, .st-ch:focus { color: #185FA5; }

  /* 并列对照：两列等宽并排，中间一条极淡分隔线，不加卡片不抢视觉 */
  .st-card.is-cmp { max-width: calc(100vw - 16px); }
  .st-ai-grid { display: grid; gap: 0 14px; align-items: start; }
  .st-col { min-width: 0; }
  .st-col + .st-col { border-left: 1px solid #F0F1F4; padding-left: 14px; }
  .st-col-hd { display: flex; align-items: center; gap: 5px; margin-bottom: 5px; }
  .st-col-hd b { font-size: 11px; font-weight: 600; color: #374151; letter-spacing: .02em; }
  .st-col-tag { margin-left: auto; font-size: 10px; color: #9AA1AC; }
  .st-cmp {
    font: inherit; font-size: 10.5px; font-weight: 500; color: #6B7280;
    border: 1px solid #E4E6EB; border-radius: 999px; background: #FFF;
    padding: 0 7px; margin-left: 2px; cursor: pointer; line-height: 1.6;
  }
  .st-cmp:hover { color: #185FA5; border-color: #CBD8E8; background: #F7FAFD; }
  .st-cmp-tag { font-size: 10px; color: #9AA1AC; letter-spacing: .02em; }

  .st-ai-text { color: #1F2329; white-space: pre-wrap; word-break: break-word; }
  .st-ai-grid .st-ai-text { font-size: 13px; }
  .st-ai-grid .st-ai-text.is-word { font-size: 13.5px; }
  .st-ai-grid .st-ai-text .st-ai-line1 { font-size: 14px; }
  .st-ai-grid .st-ai-err { font-size: 12px; }
  .st-ai-text.is-word { font-size: 14px; }
  .st-ai-text .st-ai-line1 { font-size: 15px; font-weight: 600; color: #101828; }
  .st-ai-loading { display: flex; flex-direction: column; gap: 6px; padding: 2px 0; }
  .st-sk { height: 11px; border-radius: 4px; background: linear-gradient(90deg,#F1F3F5 25%,#E7EAEE 37%,#F1F3F5 63%); background-size: 400% 100%; animation: st-skim 1.3s ease-in-out infinite; }
  @keyframes st-skim { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }
  .st-ai-err { color: #6B7280; font-size: 12.5px; }
  .st-ai-err b { color: #B4232A; font-weight: 500; }
  .st-act {
    display: inline-block; margin-top: 8px; padding: 4px 10px; border: 1px solid #CBD8E8;
    border-radius: 6px; background: #F7FAFD; color: #185FA5; font-size: 12px; cursor: pointer;
  }
  .st-act:hover { background: #EAF2FB; }

  .st-src + .st-src { margin-top: 10px; }
  .st-src-hd { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
  .st-src-n { font-size: 11px; font-weight: 600; color: #98A1AC; letter-spacing: .02em; }
  .st-star { color: #E0A11B; font-size: 10px; letter-spacing: 1px; }
  .st-def { display: flex; gap: 7px; align-items: flex-start; margin-bottom: 5px; }
  .st-pos {
    flex: 0 0 auto; font-size: 11px; font-style: italic; color: #185FA5;
    background: #EAF2FB; border-radius: 4px; padding: 0 5px; margin-top: 2px; line-height: 1.55;
  }
  .st-def-t { color: #2B3038; word-break: break-word; }
  .st-ex { margin: 3px 0 7px 0; padding-left: 9px; border-left: 2px solid #EDEFF3; }
  .st-ex-en { color: #5A6270; font-size: 12px; }
  .st-ex-zh { color: #8A919D; font-size: 12px; }

  .st-sent { margin-bottom: 8px; }
  .st-sent:last-child { margin-bottom: 0; }
  .st-sent-en { color: #374151; font-size: 12.5px; }
  .st-sent-zh { color: #6B7280; font-size: 12.5px; }

  .st-empty { color: #9AA1AC; font-size: 12.5px; }

  .st-ft { display: flex; flex-wrap: wrap; gap: 6px; padding: 9px 15px; background: #FAFBFC; border-top: 1px solid #F0F1F4; }
  .st-link {
    font-size: 11px; color: #5A6270; text-decoration: none; padding: 2px 8px;
    border: 1px solid #E4E6EB; border-radius: 999px; background: #fff; cursor: pointer; line-height: 1.6;
  }
  .st-link:hover { border-color: #B9CBE0; color: #185FA5; }

  details > summary { list-style: none; cursor: pointer; }
  details > summary::-webkit-details-marker { display: none; }
  details > summary .st-src-n::before {
    content: ""; display: inline-block; width: 0; height: 0; margin-right: 5px;
    border-left: 4px solid #AAB2BD; border-top: 3.5px solid transparent; border-bottom: 3.5px solid transparent;
    vertical-align: middle; transition: transform .12s ease;
  }
  details[open] > summary .st-src-n::before { transform: rotate(90deg); }

  /* 气泡按钮：天青底板 + 深墨文字，与 LOGO 同色系。
     外面套一层 46px 的透明命中区 —— 按钮视觉只有 28px，但鼠标在周边
     8~9px 内也按得到，这是「不好点中」的主要来源。 */
  .st-tip-wrap {
    position: absolute; left: 0; top: 0; width: 46px; height: 46px;
    display: flex; align-items: center; justify-content: center;
    pointer-events: auto; -webkit-user-select: none; user-select: none;
  }
  .st-tip {
    display: flex; align-items: center; justify-content: center; width: 28px; height: 28px;
    border-radius: 9px; background: linear-gradient(180deg, #B8E7FA, #62C4E8);
    color: #06203E; cursor: pointer;
    box-shadow: 0 2px 8px rgba(6,60,120,.38), inset 0 0 0 1px rgba(255,255,255,.55);
    border: 0; padding: 0;
    font-size: 14px; font-weight: 600; line-height: 1; user-select: none;
    text-shadow: 0 1px 0 rgba(255,255,255,.55);
    transition: transform .12s ease, box-shadow .12s ease;
  }
  .st-tip:hover, .st-tip:focus-visible {
    transform: scale(1.1); background: linear-gradient(180deg, #A5DFF8, #4FB6E2);
    box-shadow: 0 4px 14px rgba(6,60,120,.45), inset 0 0 0 1px rgba(255,255,255,.7);
  }
  .st-tip:active { transform: scale(.94); }

  /* 逐句对照：原文淡、译文实，成对堆叠 */
  .st-pairs { display: flex; flex-direction: column; gap: 9px; }
  .st-pair { display: flex; flex-direction: column; gap: 2px; }
  .st-pair + .st-pair { padding-top: 9px; border-top: 1px solid #F3F4F6; }
  .st-pair-src { color: #8A919D; font-size: 12px; white-space: pre-wrap; word-break: break-word; }
  .st-pair-dst { color: #1F2329; font-size: 13px; white-space: pre-wrap; word-break: break-word; }
  .st-pair-dst:empty::after { content: "…"; color: #C6CBD3; }
  `;

  /* --------------------------- DOM 工具 --------------------------- */

  function mountHost(id) {
    const host = document.createElement('div');
    host.id = id;
    host.style.cssText = [
      'all:initial', 'position:fixed', 'top:0', 'left:0', 'width:0', 'height:0',
      'z-index:' + MAX_Z, 'display:block',
    ].join(';');
    const shadow = host.attachShadow({ mode: 'open' });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      shadow.adoptedStyleSheets = [sheet];
    } catch (e) {
      const style = document.createElement('style');
      style.textContent = CSS;
      shadow.appendChild(style);
    }
    (document.body || document.documentElement).appendChild(host);
    return { host, shadow };
  }

  function h(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }

  function svgIcon(path, size) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', size || 13);
    svg.setAttribute('height', size || 13);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', path);
    svg.appendChild(p);
    return svg;
  }

  /* 定位：永远把浮层夹在视口内。
     之前的写法只在「下方放不下」的分支里夹一次 top，于是选区靠近页面顶部时
     top 会算成负数 —— 气泡被顶到视口外面，看起来就是「选中了却没有按钮」。 */
  function clamp(v, max) {
    return Math.max(pad, Math.min(v, max - pad));
  }

  function apply(host, left, top, w, h) {
    host.style.transform = 'translate('
      + Math.round(clamp(left, window.innerWidth - w)) + 'px,'
      + Math.round(clamp(top, window.innerHeight - h)) + 'px)';
  }

  function place(host, rect, w, hgt, prefer) {
    let left = rect.left + rect.width / 2 - w / 2;
    let top = prefer === 'above' ? rect.top - hgt - 10 : rect.bottom + 10;
    // 首选方向放不下就翻到另一侧
    if (top + hgt > window.innerHeight - pad) top = rect.top - hgt - 10;
    apply(host, left, top, w, hgt);
  }

  /* 气泡单独一套定位：贴着选区末尾（鼠标松手的位置）放，手不用走远路。
     右下优先，放不下依次翻到左下、右上、左上。 */
  function placeTip(host, rect, w, hgt) {
    const gap = 4;
    let left = rect.right + gap;
    let top = rect.bottom + gap;

    if (left + w > window.innerWidth - pad) left = rect.left - w - gap;   // 右侧不够 → 挪到左边
    if (left < pad) left = rect.right - w - gap;                          // 左边也不够 → 贴选区右端内侧
    if (top + hgt > window.innerHeight - pad) top = rect.top - hgt - gap; // 下方不够 → 翻到上方
    if (top < pad) top = rect.bottom - hgt - gap;                         // 上方也不够 → 贴选区下沿内侧

    apply(host, left, top, w, hgt);
  }

  /* --------------------------- 选区 --------------------------- */

  function rectUsable(r) {
    return Boolean(r) && (r.width > 1 || r.height > 1);
  }

  /* 选区几何信息。
     坑：range.getClientRects() 的最后一个矩形经常是零宽的 —— 跨行选到行尾时，
     末尾会多出一个位于下一行行首的 0×h 矩形。旧代码直接用最后一个，于是判定
     「没有可用位置」直接放弃，气泡就不出现了。这里倒着找第一个真正有面积的矩形，
     找不到再退回整体包围盒。 */
  function rangeRect(range) {
    let rects = [];
    try {
      rects = Array.prototype.slice.call(range.getClientRects() || []);
    } catch (e) {
      rects = [];
    }
    for (let i = rects.length - 1; i >= 0; i--) {
      if (rectUsable(rects[i])) return rects[i];
    }
    try {
      const box = range.getBoundingClientRect();
      if (rectUsable(box)) return box;
    } catch (e) { /* noop */ }
    return null;
  }

  function readSelection() {
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
      const s = active.selectionStart;
      const e = active.selectionEnd;
      if (typeof s === 'number' && typeof e === 'number' && e > s) {
        const r = active.getBoundingClientRect();
        if (rectUsable(r)) return { text: active.value.slice(s, e), rect: r };
      }
    }
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const text = sel.toString();
    if (!text || !text.trim()) return null;

    let range;
    try {
      range = sel.getRangeAt(0);
    } catch (e) {
      return null;
    }
    const rect = rangeRect(range);
    if (!rect) return null;
    return { text, rect };
  }

  /* --------------------------- 气泡按钮 --------------------------- */

  function hideTip() {
    window.clearTimeout(state.tipTimer);
    if (state.tip) {
      state.tip.host.remove();
      state.tip = null;
    }
  }

  /* 延迟隐藏：选区被清空的瞬间就撤掉气泡，会让「按下去那一下」落空。
     给 260ms 缓冲，期间点中气泡照样能开面板。 */
  function hideTipSoon() {
    window.clearTimeout(state.tipTimer);
    state.tipTimer = window.setTimeout(hideTip, 260);
  }

  function showTip(text, rect) {
    hideTip();
    const mount = mountHost(HOST_ID + '-tip');
    const wrap = h('div', 'st-tip-wrap');
    const btn = h('button', 'st-tip', '译');
    btn.title = '查询「' + text.slice(0, 20) + '」';
    btn.setAttribute('aria-label', '划词译');
    wrap.appendChild(btn);
    mount.shadow.appendChild(wrap);
    placeTip(mount.host, rect, TIP_BOX, TIP_BOX);

    // 指针移入/移出都续命，避免手抖的时候气泡先消失
    wrap.addEventListener('mouseenter', () => window.clearTimeout(state.tipTimer));

    // 用 pointerdown 而不是 click：页面常常在 mousedown 阶段就清掉选区
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const r = state.tipRect || rect;
      hideTip();
      openPanel(text, r);
    });
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        hideTip();
        openPanel(text, state.tipRect || rect);
      }
    });

    state.tip = mount;
    state.tipRect = rect;
    state.tipText = text;
  }

  /* --------------------------- 发音 --------------------------- */

  function playAudio(url, fallback) {
    const urls = [url, fallback].filter(Boolean);
    if (!urls.length) return;
    const tryPlay = (i) => {
      if (i >= urls.length) return;
      try {
        const a = new Audio(urls[i]);
        a.volume = 1;
        a.play().catch(() => tryPlay(i + 1));
      } catch (e) {
        tryPlay(i + 1);
      }
    };
    tryPlay(0);
  }

  /* --------------------------- 面板 --------------------------- */

  function closePanel() {
    if (state.port) {
      try { state.port.disconnect(); } catch (e) { /* noop */ }
      state.port = null;
    }
    if (state.panel) {
      state.panel.host.remove();
      state.panel = null;
    }
    state.text = '';
  }

  /* 并列对照的通道列表。返回 null 表示走原来的单通道形态。
     注意 chrome-ai 也在列表里 —— 它在页面上下文运行，由 startAi 单独起一路，
     不走 background 的 port，所以不能在这里过滤掉。 */
  function compareList() {
    const cfg = (state.settings && state.settings.compare) || {};
    if (!cfg.enabled) return null;
    const list = Array.isArray(cfg.providers) ? cfg.providers : [];
    const ok = list.filter((p) => PROVIDERS[p]);
    return ok.length >= 2 ? ok : null;
  }

  /* 面板宽度：每列约 252px，加左右内边距与列间距 */
  function cmpWidth(n) {
    return Math.min(32 + n * 252 + (n - 1) * 14, 980);
  }

  function buildPanel() {
    const mount = mountHost(HOST_ID);
    const card = h('div', 'st-card');
    card.setAttribute('role', 'dialog');

    const hd = h('div', 'st-hd');
    const title = h('div', 'st-title');
    const word = h('span', 'st-word');
    title.appendChild(word);
    const closeBtn = h('button', 'st-close');
    closeBtn.title = '关闭 (Esc)';
    closeBtn.appendChild(svgIcon('M18 6L6 18M6 6l12 12', 13));
    hd.appendChild(title);
    hd.appendChild(closeBtn);

    const phon = h('div', 'st-phon');
    hd.appendChild(phon);

    const body = h('div', 'st-body');

    const aiSec = h('section', 'st-sec');
    const aiHd = h('div', 'st-sec-hd');
    aiHd.appendChild(h('span', 'st-badge', 'AI'));

    /* 形态切换按钮：单条 ↔ 并列。写进配置，下次划词沿用。 */
    const cmpToggle = (label) => {
      const b = h('button', 'st-cmp', label);
      b.title = (label === '单条') ? '只显示一个通道' : '并排显示两个通道的译文';
      b.addEventListener('click', async () => {
        const cur = (state.settings && state.settings.compare) || {};
        const next = {
          enabled: label === '对照',
          providers: cur.providers || ['chrome-ai', 'deepl'],
        };
        state.settings = Object.assign({}, state.settings, { compare: next });
        await saveSettings({ compare: next });
        const t = state.text;
        const r = state.rect;
        if (t) openPanel(t, r);
      });
      return b;
    };

    /* 句子显示方式切换：译文 / 对照 / 原文 —— 只对句子出现，写进配置沿用 */
    const sentToggle = () => {
      const b = h('button', 'st-cmp', '');
      const sync = () => {
        const m = SENTENCE_MODES.filter((x) => x.id === sentenceMode())[0] || SENTENCE_MODES[0];
        b.textContent = m.label;
        b.title = '句子显示方式：' + m.title + '（点击切换到下一种）';
      };
      sync();
      b.addEventListener('click', async () => {
        const ids = SENTENCE_MODES.map((m) => m.id);
        const next = ids[(ids.indexOf(sentenceMode()) + 1) % ids.length];
        state.settings = Object.assign({}, state.settings, {
          sentence: Object.assign({}, state.settings.sentence, { mode: next }),
        });
        await saveSettings({ sentence: { mode: next } });
        sync();
        if (state.text) startAi(state.text, (state.settings && state.settings.targetLang) || 'zh-CN');
      });
      return b;
    };

    const cmpList = compareList();
    let aiSel = null;
    let cols = null;
    const aiBody = h('div', 'st-ai-body');

    if (cmpList) {
      card.classList.add('is-cmp');
      card.style.width = cmpWidth(cmpList.length) + 'px';
      aiHd.appendChild(h('span', 'st-cmp-tag', '并列 ' + cmpList.length));
      const grid = h('div', 'st-ai-grid');
      grid.style.gridTemplateColumns = 'repeat(' + cmpList.length + ', minmax(0, 1fr))';
      cols = cmpList.map((p) => {
        const col = h('div', 'st-col');
        const chd = h('div', 'st-col-hd');
        chd.appendChild(h('b', null, PROVIDERS[p]));
        const tag = h('span', 'st-col-tag', '');
        chd.appendChild(tag);
        const cbody = h('div', 'st-ai-body');
        col.appendChild(chd);
        col.appendChild(cbody);
        grid.appendChild(col);
        return { provider: p, body: cbody, tag };
      });
      aiBody.appendChild(grid);
      aiHd.appendChild(cmpToggle('单条'));
    } else {
      // 通道下拉：直接在面板里切换，立即重译，不用去设置页
      aiSel = h('select', 'st-ch');
      aiSel.title = '翻译通道 · 切换后立即重新翻译';
      Object.keys(PROVIDERS).forEach((v) => {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = PROVIDERS[v];
        aiSel.appendChild(o);
      });
      aiSel.addEventListener('change', async () => {
        const p = aiSel.value;
        state.settings = Object.assign({}, state.settings, { provider: p });
        // 当前是句子时，同时把「句子专用通道」改掉，否则下拉看起来没生效
        const patch = { provider: p };
        if (state.text && isSentenceText(state.text)) patch.sentence = { provider: p };
        await saveSettings(patch);
        if (state.text) startAi(state.text, (state.settings && state.settings.targetLang) || 'zh-CN');
      });
      aiHd.appendChild(aiSel);
      if (state.text && isSentenceText(state.text)) aiHd.appendChild(sentToggle());
      aiHd.appendChild(cmpToggle('对照'));
    }

    const modeTag = h('span', 'st-mode');
    aiHd.appendChild(modeTag);
    aiSec.appendChild(aiHd);
    aiSec.appendChild(aiBody);
    body.appendChild(aiSec);

    const dictSec = h('section', 'st-sec');
    body.appendChild(dictSec);

    const ft = h('div', 'st-ft');

    card.appendChild(hd);
    card.appendChild(body);
    card.appendChild(ft);
    mount.shadow.appendChild(card);

    closeBtn.addEventListener('click', closePanel);

    state.panel = Object.assign(mount, { card, word, phon, aiBody, aiSel, cols, modeTag, dictSec, ft });
    return state.panel;
  }

  function renderPhonetic(p) {
    const phon = state.panel.phon;
    phon.textContent = '';
    const us = p.phonetic.us || '';
    const uk = p.phonetic.uk || '';
    const ipa = p.phonetic.ipa || '';

    if (uk) {
      const s = h('span', 'st-p', '英 /' + uk + '/');
      const b = h('button', 'st-spk');
      b.title = '英式发音';
      b.appendChild(svgIcon('M11 5L6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 010 7', 12));
      b.addEventListener('click', () => playAudio(p.audio.uk));
      s.appendChild(b);
      phon.appendChild(s);
    }
    if (us) {
      const s = h('span', 'st-p', '美 /' + us + '/');
      const b = h('button', 'st-spk');
      b.title = '美式发音';
      b.appendChild(svgIcon('M11 5L6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 010 7', 12));
      b.addEventListener('click', () => playAudio(p.audio.us));
      s.appendChild(b);
      phon.appendChild(s);
    }
    if (!uk && !us && ipa) phon.appendChild(h('span', 'st-p', '/' + ipa + '/'));
    if (!phon.childNodes.length && p.audio.wiki) {
      const b = h('button', 'st-spk');
      b.title = '播放发音';
      b.appendChild(svgIcon('M11 5L6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 010 7', 12));
      b.addEventListener('click', () => playAudio(p.audio.wiki));
      phon.appendChild(b);
    }
  }

  function renderAiLoading(where) {
    const box = where || state.panel.aiBody;
    box.textContent = '';
    const wrap = h('div', 'st-ai-loading');
    [92, 78, 60].forEach((w) => {
      const sk = h('div', 'st-sk');
      sk.style.width = w + '%';
      wrap.appendChild(sk);
    });
    box.appendChild(wrap);
  }

  const ERR_TEXT = {
    AI_DISABLED: 'AI 翻译已在设置中关闭',
    TIMEOUT: '翻译超时，请稍后重试',
    EMPTY_RESULT: '未取得翻译结果',
    REFUSAL: '模型拒绝了本次请求',
    EMPTY_QUERY: '没有可查询的内容',
    OPENAI_NO_KEY: '未填写自定义模型的 API Key',
    OPENAI_NO_BASEURL: '未填写自定义模型的接口地址',
    CHROME_AI_UNAVAILABLE: '本机不支持 Chrome 内置 AI（需 Chrome 138+ 且硬件达标）',
    CHROME_AI_PAGE_ONLY: 'Chrome 内置 AI 只能在页面上下文中调用',
    FREE_MT_SAME_LANG: '原文与目标语言相同',
    DEEPL_NO_KEY: '未填写 DeepL 的 Auth Key（设置页第 3 节）',
    AZURE_NO_KEY: '未填写 Microsoft Translator 的订阅密钥（设置页第 4 节）',
    AZURE_NO_REGION: '未填写 Microsoft Translator 的资源区域（设置页第 4 节）',
    GOOGLE_NO_KEY: '未填写 Google 翻译的 API Key（设置页第 5 节）',
    LIBRE_NO_BASEURL: '未填写 LibreTranslate 的服务地址（设置页第 6 节）',
    UNKNOWN_PROVIDER: '未知的翻译通道',
  };

  const PROVIDERS = {
    'chrome-ai': '本地模型 · Gemini Nano',
    deepl: 'DeepL',
    azure: 'Microsoft Translator',
    google: 'Google 翻译',
    libre: 'LibreTranslate',
    openai: '自定义模型',
    'free-mt': '免费机器翻译',
  };

  const SENTENCE_MODES = [
    { id: 'target', label: '译文', title: '只显示译文' },
    { id: 'bilingual', label: '对照', title: '逐句双语对照' },
    { id: 'source', label: '原文', title: '先原文后译文' },
  ];

  function sentenceMode() {
    const sc = (state.settings && state.settings.sentence) || {};
    return SENTENCE_MODES.some((m) => m.id === sc.mode) ? sc.mode : 'target';
  }

  /* 句子判定：足够长，或含 5 个以上词（中文无空格靠长度兜底） */
  function isSentenceText(t) {
    const s = String(t || '').trim();
    return s.length >= 20 || s.split(/\s+/).filter(Boolean).length >= 5;
  }

  /* 实际使用的通道：句子可以单独指定一条，不跟随主通道 */
  function effectiveProvider(text) {
    const s = state.settings || {};
    const sc = s.sentence || {};
    if (text && isSentenceText(text) && sc.provider && sc.provider !== 'follow') {
      return PROVIDERS[sc.provider] ? sc.provider : (s.provider || 'chrome-ai');
    }
    return s.provider || 'chrome-ai';
  }

  function saveSettings(patch) {
    return chrome.runtime.sendMessage({ type: 'settings:set', payload: patch })
      .then((res) => {
        if (res && res.ok) state.settings = res.data;
        return res;
      })
      .catch(() => null);
  }

  const AI_LANG = {
    'zh-CN': 'zh', 'zh-TW': 'zh-Hant', en: 'en', ja: 'ja', ko: 'ko',
    fr: 'fr', de: 'de', es: 'es', ru: 'ru',
  };

  /* 「原文已是中文 → 自动改译英语」必须和 background.js 用同一套判定，
     否则本机模型会因 source === target 直接返回 false，看着就是规则没生效。 */
  function textLooksZh(text) {
    const s = String(text || '');
    const cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length;
    if (!cjk) return false;
    const latin = (s.match(/[A-Za-z]/g) || []).length;
    return cjk * 2 >= latin;
  }

  function aiTargetLang(text, targetLang) {
    const t = targetLang || 'zh-CN';
    if (textLooksZh(text) && /^zh(-|$)/i.test(t)) return 'en';
    return t;
  }

  /* Chrome 内置 AI（Gemini Nano）：零配置、零密钥、离线、数据不出本机。
     必须在页面上下文（content script）里调用，Web Worker / service worker 不可用。 */
  async function runChromeAi(text, targetLang, onPartial) {
    if (typeof Translator === 'undefined') return false;

    let source = /[\u4e00-\u9fff]/.test(text) ? 'zh' : 'en';
    if (typeof LanguageDetector !== 'undefined') {
      try {
        const detector = await LanguageDetector.create();
        const res = await detector.detect(text);
        if (res && res[0] && res[0].detectedLanguage) source = res[0].detectedLanguage;
        if (detector.destroy) detector.destroy();
      } catch (e) { /* 保持启发式判断 */ }
    }

    const target = AI_LANG[aiTargetLang(text, targetLang)] || targetLang;
    if (source === target) return false;

    try {
      const availability = await Translator.availability({ sourceLanguage: source, targetLanguage: target });
      if (availability === 'unavailable') return false;

      const translator = await Translator.create({
        sourceLanguage: source,
        targetLanguage: target,
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => {
            const pct = Math.round((e.loaded || 0) * 100);
            onPartial('正在下载本地翻译模型… ' + pct + '%（仅首次，之后完全离线）');
          });
        },
      });
      if (translator.ready) await translator.ready;
      const out = await translator.translate(text);
      if (translator.destroy) translator.destroy();
      if (!out) return false;
      onPartial(out);
      return true;
    } catch (e) {
      return false;
    }
  }

  function renderAiError(code, where) {
    const box = where || state.panel.aiBody;
    box.textContent = '';
    const wrap = h('div', 'st-ai-err');
    wrap.appendChild(h('b', null, '翻译失败：'));
    wrap.appendChild(document.createTextNode(ERR_TEXT[code] || code));
    box.appendChild(wrap);

    // 凭据类错误 → 给一个直达设置页的按钮
    const NEEDS_SETUP = ['DEEPL_NO_KEY',
      'OPENAI_NO_KEY', 'OPENAI_NO_BASEURL', 'AZURE_NO_KEY', 'AZURE_NO_REGION',
      'GOOGLE_NO_KEY', 'LIBRE_NO_BASEURL'];
    if (NEEDS_SETUP.indexOf(code) >= 0) {
      const btn = h('button', 'st-act', '打开设置并授权');
      btn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'open:options' });
      });
      box.appendChild(btn);
    }
  }

  function renderPairs(pairs, where) {
    const box = where || state.panel.aiBody;
    box.textContent = '';
    const wrap = h('div', 'st-pairs');
    (pairs || []).forEach((p) => {
      const row = h('div', 'st-pair');
      row.appendChild(h('div', 'st-pair-src', p.src || ''));
      row.appendChild(h('div', 'st-pair-dst', p.dst || ''));
      wrap.appendChild(row);
    });
    box.appendChild(wrap);
  }

  function renderAiText(text, opts, where) {
    const box = where || state.panel.aiBody;
    box.textContent = '';
    const o = opts || {};

    // 逐句对照 / 原文+译文：按对渲染
    if (o.pairs && o.pairs.length) {
      renderPairs(o.pairs, box);
      return;
    }

    const el = h('div', 'st-ai-text');
    const lines = String(text).split('\n');
    const isWord = o.isWord && lines.length >= 2;

    if (isWord) {
      el.appendChild(h('div', 'st-ai-line1', lines[0].trim()));
      const rest = lines.slice(1).filter((l) => l.trim());
      rest.forEach((l) => el.appendChild(h('div', null, l.trim())));
    } else {
      el.textContent = text;
    }
    box.appendChild(el);
  }

  function renderDictionary(data, wanted) {
    const sec = state.panel.dictSec;
    sec.textContent = '';

    if (wanted !== data.word) return;

    renderPhonetic(data);

    if (!data.blocks.length && !data.sentences.length) {
      sec.appendChild(h('div', 'st-empty', '词典未收录该词条，AI 翻译结果见上方。'));
    }

    data.blocks.forEach((block) => {
      const src = h('div', 'st-src');
      const hdRow = h('div', 'st-src-hd');
      const nameEl = h('span', 'st-src-n', block.title);
      hdRow.appendChild(nameEl);
      if (block.star) {
        hdRow.appendChild(h('span', 'st-star', '★'.repeat(Math.min(3, block.star))));
      }

      const listWrap = h('div');
      block.items.forEach((item) => {
        const row = h('div', 'st-def');
        if (item.pos) row.appendChild(h('span', 'st-pos', item.pos));
        row.appendChild(h('span', 'st-def-t', item.def));
        listWrap.appendChild(row);
        if (item.example && item.example.en) {
          const ex = h('div', 'st-ex');
          ex.appendChild(h('div', 'st-ex-en', item.example.en));
          if (item.example.zh) ex.appendChild(h('div', 'st-ex-zh', item.example.zh));
          listWrap.appendChild(ex);
        }
      });

      if (block.collapsed) {
        const det = document.createElement('details');
        det.open = true;   // 词典默认展开，仍可点标题收起
        const sum = document.createElement('summary');
        sum.appendChild(hdRow);
        det.appendChild(sum);
        det.appendChild(listWrap);
        src.appendChild(det);
      } else {
        src.appendChild(hdRow);
        src.appendChild(listWrap);
      }
      sec.appendChild(src);
    });

    if (data.sentences && data.sentences.length) {
      const det = document.createElement('details');
      det.open = true;   // 双语例句默认展开
      det.style.marginTop = '10px';
      const sum = document.createElement('summary');
      const hdRow = h('div', 'st-src-hd');
      hdRow.appendChild(h('span', 'st-src-n', '双语例句'));
      sum.appendChild(hdRow);
      det.appendChild(sum);
      const inner = h('div');
      data.sentences.forEach((s) => {
        const box = h('div', 'st-sent');
        if (s.en) box.appendChild(h('div', 'st-sent-en', s.en));
        if (s.zh) box.appendChild(h('div', 'st-sent-zh', s.zh));
        inner.appendChild(box);
      });
      det.appendChild(inner);
      sec.appendChild(det);
    }
  }

  function renderLinks(links) {
    const ft = state.panel.ft;
    ft.textContent = '';
    links.forEach((l) => {
      const a = h('a', 'st-link', l.name);
      a.href = l.url;
      a.target = '_blank';
      a.rel = 'noreferrer noopener';
      ft.appendChild(a);
    });
  }

  function renderRaw(text) {
    if (!state.panel) return;
    const box = state.panel.aiBody;
    box.textContent = '';
    const el = h('div', 'st-ai-text');
    el.textContent = text;
    box.appendChild(el);
  }

  /** 单通道：provider 为字符串；并列：providers 为数组，逐列回填 */
  function startViaBackground(text, targetLang, provider, providers) {
    if (state.port) {
      try { state.port.disconnect(); } catch (e) { /* noop */ }
    }
    const port = chrome.runtime.connect({ name: 'ai' });
    state.port = port;
    const isWord = text.split(/\s+/).filter(Boolean).length <= 3 && text.length <= 40;

    port.onMessage.addListener((m) => {
      if (!m || !state.panel) return;

      if (m.type === 'chan') {
        const cols = state.panel.cols || [];
        // 优先按通道名匹配，避免任一侧过滤顺序不同导致错位
        const col = cols.filter((c) => c.provider === m.provider)[0] || cols[m.index];
        if (!col) return;
        if (m.phase === 'partial') {
          renderAiText(m.text, { isWord }, col.body);
        } else if (m.phase === 'done') {
          renderAiText(m.text, { isWord }, col.body);
          col.tag.textContent = m.cached ? '缓存' : '';
        } else if (m.phase === 'error') {
          renderAiError(m.code, col.body);
          col.tag.textContent = '失败';
        }
        return;
      }

      if (m.type === 'partial') {
        // 逐句对照是一句句回来的，partial 阶段不整体覆盖，等 done 一起铺开
        if (!(m.pairs && m.pairs.length)) renderAiText(m.text, { isWord });
      } else if (m.type === 'done') {
        renderAiText(m.text, { isWord, cached: m.cached, pairs: m.pairs });
        state.panel.modeTag.textContent = m.cached ? '缓存' : '';
      } else if (m.type === 'error') {
        renderAiError(m.code);
      }
    });
    port.onDisconnect.addListener(() => { /* 面板关闭 */ });
    port.postMessage({ type: 'start', payload: { text, targetLang, provider, providers } });
  }

  function startAi(text, targetLang) {
    const settings = state.settings || {};
    // 句子可能单独指定了通道，这里要与 background 的判定保持一致
    const provider = effectiveProvider(text);
    const cmp = compareList();

    // 并列对照：每列一个通道，各写各的，互不覆盖
    if (cmp && state.panel && state.panel.cols) {
      const isWord = text.split(/\s+/).filter(Boolean).length <= 3 && text.length <= 40;

      state.panel.cols.forEach((c) => {
        c.tag.textContent = '';
        renderAiLoading(c.body);
      });
      if (settings.aiEnabled === false) {
        state.panel.cols.forEach((c) => renderAiError('AI_DISABLED', c.body));
        return;
      }

      const remote = [];
      cmp.forEach((p) => {
        const col = state.panel.cols.filter((c) => c.provider === p)[0];
        if (!col) return;

        if (p === 'chrome-ai') {
          // 本机模型只能在页面上下文跑，单独起一路，不和 port 通道混在一起
          runChromeAi(text, targetLang, (t) => {
            if (!state.panel) return;
            renderAiText(t, { isWord }, col.body);
          }).then((ok) => {
            if (!state.panel) return;
            if (ok) {
              col.tag.textContent = '本机';
            } else {
              renderAiError('CHROME_AI_UNAVAILABLE', col.body);
              col.tag.textContent = '不可用';
            }
          });
        } else {
          remote.push(p);
        }
      });

      if (remote.length) startViaBackground(text, targetLang, null, remote);
      return;
    }

    if (state.panel && state.panel.aiSel) {
      const sel = state.panel.aiSel;
      if (sel.value !== provider) sel.value = provider;
    }
    renderAiLoading();

    if (provider === 'chrome-ai') {
      runChromeAi(text, targetLang, renderRaw).then((ok) => {
        if (!state.panel) return;
        if (ok) {
          state.panel.modeTag.textContent = '本机';
          return;
        }
        // 本机不支持 → 交给 background 按降级链处理
        renderAiLoading();
        startViaBackground(text, targetLang, provider);
      });
      return;
    }

    startViaBackground(text, targetLang, provider);
  }

  async function openPanel(text, rect) {
    closePanel();
    hideTip();
    state.text = text;
    state.rect = rect;
    const settings = state.settings || {};
    const panel = buildPanel();

    const trimmed = text.trim();
    const isSentence = isSentenceText(trimmed);
    panel.word.textContent = trimmed;
    panel.word.classList.toggle('is-sent', isSentence);
    panel.word.title = isSentence ? '点击展开 / 收起原文' : '';
    if (isSentence) {
      panel.word.addEventListener('click', () => panel.word.classList.toggle('open'));
    }
    panel.modeTag.textContent = '';

    // 先渲染以取得实际高度，再定位
    const w0 = panel.cols ? (parseInt(panel.card.style.width, 10) || 588) : 384;
    panel.host.style.visibility = 'hidden';
    place(panel.host, rect, w0, 360, 'above');
    panel.host.style.visibility = 'visible';

    requestAnimationFrame(() => {
      if (!state.panel) return;
      const rectCard = state.panel.card.getBoundingClientRect();
      place(state.panel.host, rect, rectCard.width || w0, rectCard.height || 340, 'above');
    });

    if (settings.aiEnabled !== false) {
      startAi(text, settings.targetLang || 'zh-CN');
    } else if (panel.cols) {
      panel.cols.forEach((c) => renderAiError('AI_DISABLED', c.body));
    } else {
      renderAiError('AI_DISABLED');
    }

    // 句子默认不查词典（词典查不到整句），但设置里可以打开
    const sc = settings.sentence || {};
    if (isSentence && !sc.dict) {
      panel.dictSec.textContent = '';
      panel.dictSec.appendChild(
        h('div', 'st-empty', '已按句子翻译。划选单词或短语可查词典、看例句。')
      );
    } else {
      chrome.runtime.sendMessage({ type: 'dict:lookup', payload: { text: trimmed } }, (res) => {
        if (!state.panel) return;
        if (res && res.ok) {
          renderDictionary(res.data, trimmed);
          renderLinks(res.data.links || []);
        } else {
          state.panel.dictSec.textContent = '';
          state.panel.dictSec.appendChild(
            h('div', 'st-empty', '词典查询失败：' + ((res && res.error) || '未知错误'))
          );
          renderLinks([
            { name: 'Cambridge', url: 'https://dictionary.cambridge.org/dictionary/english-chinese-simplified/' + encodeURIComponent(trimmed) },
            { name: 'Merriam-Webster', url: 'https://www.merriam-webster.com/dictionary/' + encodeURIComponent(trimmed) },
          ]);
        }
      });
    }
  }

  /* --------------------------- 事件绑定 --------------------------- */

  function inHost(target) {
    const id = target && target.id;
    return Boolean(id) && String(id).indexOf(HOST_ID) === 0;
  }

  /* 选区长度是否值得处理 */
  function textOk(text) {
    const settings = state.settings || {};
    return text.length >= (settings.minLen || 1) && text.length <= (settings.maxLen || 400);
  }

  /* 显示气泡（icon 触发方式下的唯一入口） */
  function maybeShowTip(pick) {
    const settings = state.settings || {};
    if (!pick) {
      hideTipSoon();
      return;
    }
    const text = pick.text.trim();
    if (!text || !textOk(text)) {
      hideTip();
      return;
    }
    // 同一种选区不要反复重建气泡，否则位置会跳
    if (state.tip && state.tipText === text) {
      window.clearTimeout(state.tipTimer);
      return;
    }
    showTip(text, pick.rect);
  }

  /* 直接开面板（auto / alt 触发）。mouseup 与 selectionchange 可能都命中同一段
     选区，这里做一次去重，避免面板被连续开两次、翻译请求也发两遍。 */
  function openOnce(text, rect) {
    const now = Date.now();
    if (state.lastOpen && state.lastOpen.text === text && now - state.lastOpen.at < 800) return;
    state.lastOpen = { text, at: now };
    openPanel(text, rect);
  }

  function handleSelection(event) {
    const settings = state.settings || {};
    const pick = readSelection();

    if (!pick) {
      if (settings.trigger === 'icon') hideTipSoon();
      return;
    }

    const text = pick.text.trim();
    if (!text || !textOk(text)) {
      hideTip();
      return;
    }

    if (settings.trigger === 'auto') {
      window.setTimeout(() => {
        const again = readSelection();
        if (again && again.text.trim() === text) openOnce(text, pick.rect);
      }, 260);
      return;
    }

    if (settings.trigger === 'alt') {
      if (event && event.altKey) openOnce(text, pick.rect);
      return;
    }

    if (state.dragging) return;   // 还在拖，等松手
    maybeShowTip(pick);
  }

  function onMouseUp(e) {
    state.dragging = false;
    if (inHost(e.target)) return;
    // 有些页面在 mouseup 之后才把 selection 定下来，异步再读一次更稳
    handleSelection(e);
    window.setTimeout(() => handleSelection(e), 0);
  }

  /* selectionchange 是兜底：键盘 Shift+方向键、双击选词、跨 iframe 结束、
     以及在窗口外松开鼠标等情况，光靠 mouseup 会漏。 */
  function onSelectionChange() {
    const settings = state.settings || {};
    if (settings.trigger === 'auto') return;
    window.clearTimeout(state.selTimer);
    state.selTimer = window.setTimeout(() => {
      if (state.dragging) return;
      handleSelection(null);
    }, 180);
  }

  function onMouseDown(e) {
    if (!inHost(e.target)) {
      state.dragging = true;
      if (state.panel) closePanel();
      hideTip();
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      if (state.panel) closePanel();
      hideTip();
      return;
    }
    // 键盘扩选（Shift+方向键 / Cmd+A）也要能唤出气泡
    if (e.shiftKey || ((e.metaKey || e.ctrlKey) && e.key === 'a')) {
      window.clearTimeout(state.selTimer);
      state.selTimer = window.setTimeout(() => handleSelection(null), 80);
    }
  }

  function onScroll() {
    if (state.panel || state.tip) {
      window.clearTimeout(state.hideTimer);
      state.hideTimer = window.setTimeout(() => {
        if (state.panel) closePanel();
        hideTip();
      }, 120);
    }
  }

  async function boot() {
    const res = await chrome.runtime.sendMessage({ type: 'settings:get' }).catch(() => null);
    if (res && res.ok) state.settings = res.data;

    document.addEventListener('mouseup', onMouseUp, true);
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('selectionchange', onSelectionChange, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', () => { if (state.panel) closePanel(); hideTip(); }, true);

    // 标记注入完成：DOM 是共享的，页面与自动化测试都能读到这个属性
    document.documentElement.setAttribute('data-st-ready', '1');

    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'st:open' && msg.text) {
        const sel = window.getSelection();
        let rect = null;
        try {
          rect = sel && sel.rangeCount ? rangeRect(sel.getRangeAt(0)) : null;
        } catch (e) { rect = null; }
        if (!rect) {
          rect = { left: window.innerWidth / 2 - 100, top: 120, width: 200, height: 20, bottom: 140 };
        }
        openPanel(msg.text.trim(), rect);
      }
      if (msg && msg.type === 'st:settings-changed') {
        chrome.runtime.sendMessage({ type: 'settings:get' }).then((r) => {
          if (r && r.ok) state.settings = r.data;
        }).catch(() => {});
      }
    });
  }

  boot();
})();
