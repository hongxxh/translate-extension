/* 翻译结果面板：标题（原文 + 音标） / AI 区 / 词典区 / 外部词典跳转。
   所有节点都在 Shadow DOM 里，页面 CSS 影响不到；渲染一律用 textContent，
   绝不把选中文本拼进 innerHTML。 */
import { h, HOST_ID, mountHost, svgIcon } from './shadow-root';
import type { Mount } from './shadow-root';
import { place } from '../selection/selection-utils';
import { PROVIDER_LABELS, PROVIDER_IDS, SENTENCE_MODES } from '../../shared/constants';
import { isSentenceText } from '../../shared/text';
import { openOptions } from '../../shared/messaging/client';
import type {
  DictResult,
  LinkItem,
  ProviderId,
  SentenceMode,
  SentencePair,
  Settings,
} from '../../shared/types';

export interface PanelColumn {
  provider: ProviderId;
  body: HTMLElement;
  tag: HTMLElement;
}

export interface PanelCallbacks {
  /** 面板里的通道下拉切换 */
  onProviderChange: (provider: ProviderId) => void;
  /** 单条 ↔ 对照 */
  onCompareToggle: (next: { enabled: boolean; providers: ProviderId[] }) => void;
  /** 句子显示方式循环切换 */
  onSentenceModeChange: (mode: SentenceMode) => void;
  onClose: () => void;
}

export interface AiRenderOptions {
  isWord?: boolean;
  pairs?: SentencePair[] | null;
}

const ERR_TEXT: Record<string, string> = {
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

/** 凭据类错误 → 给一个直达设置页的按钮 */
const NEEDS_SETUP = [
  'DEEPL_NO_KEY',
  'OPENAI_NO_KEY',
  'OPENAI_NO_BASEURL',
  'AZURE_NO_KEY',
  'AZURE_NO_REGION',
  'GOOGLE_NO_KEY',
  'LIBRE_NO_BASEURL',
];

/** 并列对照的通道列表：null 表示走单通道形态 */
export function compareList(settings: Settings): ProviderId[] | null {
  const cfg = settings.compare || {};
  if (!cfg.enabled) return null;
  const ok = (Array.isArray(cfg.providers) ? cfg.providers : []).filter((p) => PROVIDER_LABELS[p]);
  return ok.length >= 2 ? ok : null;
}

/** 面板宽度：每列约 252px，加左右内边距与列间距 */
function cmpWidth(n: number): number {
  return Math.min(32 + n * 252 + (n - 1) * 14, 980);
}

function playAudio(url?: string, fallback?: string): void {
  const urls = [url, fallback].filter(Boolean) as string[];
  if (!urls.length) return;
  const tryPlay = (i: number): void => {
    if (i >= urls.length) return;
    try {
      const a = new Audio(urls[i]);
      a.volume = 1;
      a.play().catch(() => tryPlay(i + 1));
    } catch {
      tryPlay(i + 1);
    }
  };
  tryPlay(0);
}

export class TranslationPanel {
  private readonly mount: Mount;
  readonly card: HTMLElement;
  readonly word: HTMLElement;
  private readonly phon: HTMLElement;
  readonly aiBody: HTMLElement;
  readonly dictSec: HTMLElement;
  private readonly ft: HTMLElement;
  private readonly modeTag: HTMLElement;
  private readonly getSettings: () => Settings;
  private aiSel: HTMLSelectElement | null = null;
  private cols: PanelColumn[] | null = null;
  private closed = false;

  constructor(
    getSettings: () => Settings,
    text: string,
    private readonly callbacks: PanelCallbacks,
  ) {
    // 设置要「活读」：开关改完设置后同步刷新标签，读快照会拿到过期值
    this.getSettings = getSettings;
    this.mount = mountHost(HOST_ID);
    const trimmed = text.trim();
    const isSentence = isSentenceText(trimmed);

    this.card = h('div', 'st-card');
    this.card.setAttribute('role', 'dialog');

    /* ---- 标题区 ---- */
    const hd = h('div', 'st-hd');
    const title = h('div', 'st-title');
    this.word = h('span', 'st-word', trimmed);
    this.word.classList.toggle('is-sent', isSentence);
    this.word.title = isSentence ? '点击展开 / 收起原文' : '';
    if (isSentence) {
      this.word.addEventListener('click', () => this.word.classList.toggle('open'));
    }
    title.appendChild(this.word);

    const closeBtn = h('button', 'st-close');
    closeBtn.title = '关闭 (Esc)';
    closeBtn.appendChild(svgIcon('M18 6L6 18M6 6l12 12', 13));
    closeBtn.addEventListener('click', () => this.callbacks.onClose());

    this.phon = h('div', 'st-phon');
    hd.appendChild(title);
    hd.appendChild(closeBtn);
    hd.appendChild(this.phon);

    /* ---- AI 区 ---- */
    const body = h('div', 'st-body');
    const aiSec = h('section', 'st-sec');
    const aiHd = h('div', 'st-sec-hd');
    aiHd.appendChild(h('span', 'st-badge', 'AI'));

    this.aiBody = h('div', 'st-ai-body');
    const cmp = compareList(getSettings());

    if (cmp) {
      this.card.classList.add('is-cmp');
      this.card.style.width = cmpWidth(cmp.length) + 'px';
      aiHd.appendChild(h('span', 'st-cmp-tag', '并列 ' + cmp.length));

      const grid = h('div', 'st-ai-grid');
      grid.style.gridTemplateColumns = 'repeat(' + cmp.length + ', minmax(0, 1fr))';
      this.cols = cmp.map((p) => {
        const col = h('div', 'st-col');
        const chd = h('div', 'st-col-hd');
        chd.appendChild(h('b', '', PROVIDER_LABELS[p]));
        const tag = h('span', 'st-col-tag', '');
        chd.appendChild(tag);
        const cbody = h('div', 'st-ai-body');
        col.appendChild(chd);
        col.appendChild(cbody);
        grid.appendChild(col);
        return { provider: p, body: cbody, tag };
      });
      this.aiBody.appendChild(grid);
      aiHd.appendChild(this.buildCompareToggle('单条'));
    } else {
      this.aiSel = h('select', 'st-ch');
      this.aiSel.title = '翻译通道 · 切换后立即重新翻译';
      PROVIDER_IDS.forEach((v) => {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = PROVIDER_LABELS[v];
        this.aiSel?.appendChild(o);
      });
      this.aiSel.addEventListener('change', () => {
        this.callbacks.onProviderChange(this.aiSel?.value as ProviderId);
      });
      aiHd.appendChild(this.aiSel);
      if (isSentence) aiHd.appendChild(this.buildSentenceToggle());
      aiHd.appendChild(this.buildCompareToggle('对照'));
    }

    this.modeTag = h('span', 'st-mode');
    aiHd.appendChild(this.modeTag);
    aiSec.appendChild(aiHd);
    aiSec.appendChild(this.aiBody);

    this.dictSec = h('section', 'st-sec');
    body.appendChild(aiSec);
    body.appendChild(this.dictSec);

    this.ft = h('div', 'st-ft');
    this.card.appendChild(hd);
    this.card.appendChild(body);
    this.card.appendChild(this.ft);
    this.mount.shadow.appendChild(this.card);
  }

  /* --------------------------- 形态切换按钮 --------------------------- */

  private buildCompareToggle(label: '单条' | '对照'): HTMLElement {
    const b = h('button', 'st-cmp', label);
    b.title = label === '单条' ? '只显示一个通道' : '并排显示两个通道的译文';
    b.addEventListener('click', () => {
      const cur = this.getSettings().compare || {};
      this.callbacks.onCompareToggle({
        enabled: label === '对照',
        providers: cur.providers || ['chrome-ai', 'deepl'],
      });
    });
    return b;
  }

  private buildSentenceToggle(): HTMLElement {
    const b = h('button', 'st-cmp', '');
    const sync = (): void => {
      const cur = this.currentSentenceMode();
      const m = SENTENCE_MODES.filter((x) => x.id === cur)[0] || SENTENCE_MODES[0];
      b.textContent = m.label;
      b.title = '句子显示方式：' + m.title + '（点击切换到下一种）';
    };
    sync();
    b.addEventListener('click', () => {
      const ids = SENTENCE_MODES.map((m) => m.id);
      const next = ids[(ids.indexOf(this.currentSentenceMode()) + 1) % ids.length];
      this.callbacks.onSentenceModeChange(next);
      sync();
    });
    return b;
  }

  private currentSentenceMode(): SentenceMode {
    const sc = this.getSettings().sentence || {};
    return SENTENCE_MODES.some((m) => m.id === sc.mode) ? (sc.mode as SentenceMode) : 'target';
  }

  /* --------------------------- 定位 / 生命周期 --------------------------- */

  open(rect: DOMRect): void {
    // 先按估算高度定位（隐藏），渲染拿到真实尺寸后再校正一次
    const w0 = this.cols ? (parseInt(this.card.style.width, 10) || 588) : 384;
    this.mount.host.style.visibility = 'hidden';
    place(this.mount.host, rect, w0, 360, 'above');
    this.mount.host.style.visibility = 'visible';

    requestAnimationFrame(() => {
      if (this.closed) return;
      const box = this.card.getBoundingClientRect();
      place(this.mount.host, rect, box.width || w0, box.height || 340, 'above');
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.mount.host.remove();
  }

  /* --------------------------- 渲染 --------------------------- */

  get columns(): PanelColumn[] | null {
    return this.cols;
  }

  syncProviderSelect(provider: ProviderId): void {
    if (this.aiSel && this.aiSel.value !== provider) this.aiSel.value = provider;
  }

  setModeTag(text: string): void {
    this.modeTag.textContent = text;
  }

  private target(where?: HTMLElement | null): HTMLElement {
    return where || this.aiBody;
  }

  showLoading(where?: HTMLElement | null): void {
    const box = this.target(where);
    box.textContent = '';
    const wrap = h('div', 'st-ai-loading');
    [92, 78, 60].forEach((w) => {
      const sk = h('div', 'st-sk');
      sk.style.width = w + '%';
      wrap.appendChild(sk);
    });
    box.appendChild(wrap);
  }

  showError(code: string, where?: HTMLElement | null): void {
    const box = this.target(where);
    box.textContent = '';
    const wrap = h('div', 'st-ai-err');
    wrap.appendChild(h('b', '', '翻译失败：'));
    wrap.appendChild(document.createTextNode(ERR_TEXT[code] || code));
    box.appendChild(wrap);

    if (NEEDS_SETUP.indexOf(code) >= 0) {
      const btn = h('button', 'st-act', '打开设置并授权');
      btn.addEventListener('click', () => openOptions());
      box.appendChild(btn);
    }
  }

  showPairs(pairs: SentencePair[], where?: HTMLElement | null): void {
    const box = this.target(where);
    box.textContent = '';
    const wrap = h('div', 'st-pairs');
    pairs.forEach((p) => {
      const row = h('div', 'st-pair');
      row.appendChild(h('div', 'st-pair-src', p.src || ''));
      row.appendChild(h('div', 'st-pair-dst', p.dst || ''));
      wrap.appendChild(row);
    });
    box.appendChild(wrap);
  }

  showText(text: string, opts?: AiRenderOptions, where?: HTMLElement | null): void {
    const box = this.target(where);
    box.textContent = '';
    const o = opts || {};

    if (o.pairs && o.pairs.length) {
      this.showPairs(o.pairs, box);
      return;
    }

    const el = h('div', 'st-ai-text');
    const lines = String(text).split('\n');
    const isWord = o.isWord && lines.length >= 2;

    if (isWord) {
      el.appendChild(h('div', 'st-ai-line1', lines[0].trim()));
      lines.slice(1).filter((l) => l.trim()).forEach((l) => el.appendChild(h('div', '', l.trim())));
    } else {
      el.textContent = text;
    }
    box.appendChild(el);
  }

  showPhonetic(data: DictResult): void {
    this.phon.textContent = '';
    const { uk, us, ipa } = data.phonetic;

    const speaker = (title: string, url?: string): HTMLElement => {
      const b = h('button', 'st-spk');
      b.title = title;
      b.appendChild(svgIcon('M11 5L6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 010 7', 12));
      b.addEventListener('click', () => playAudio(url));
      return b;
    };

    if (uk) {
      const s = h('span', 'st-p', '英 /' + uk + '/');
      s.appendChild(speaker('英式发音', data.audio.uk));
      this.phon.appendChild(s);
    }
    if (us) {
      const s = h('span', 'st-p', '美 /' + us + '/');
      s.appendChild(speaker('美式发音', data.audio.us));
      this.phon.appendChild(s);
    }
    if (!uk && !us && ipa) this.phon.appendChild(h('span', 'st-p', '/' + ipa + '/'));
    if (!this.phon.childNodes.length && data.audio.wiki) {
      this.phon.appendChild(speaker('播放发音', data.audio.wiki));
    }
  }

  showEmptyDict(message: string): void {
    this.dictSec.textContent = '';
    this.dictSec.appendChild(h('div', 'st-empty', message));
  }

  showDictionary(data: DictResult, wanted: string): void {
    if (wanted !== data.word) return; // 慢回来的旧请求不要覆盖新面板
    this.dictSec.textContent = '';
    this.showPhonetic(data);

    if (!data.blocks.length && !data.sentences.length) {
      this.dictSec.appendChild(h('div', 'st-empty', '词典未收录该词条，AI 翻译结果见上方。'));
    }

    data.blocks.forEach((block) => {
      const src = h('div', 'st-src');
      const hdRow = h('div', 'st-src-hd');
      hdRow.appendChild(h('span', 'st-src-n', block.title));
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
        det.open = true; // 词典默认展开，仍可点标题收起
        const sum = document.createElement('summary');
        sum.appendChild(hdRow);
        det.appendChild(sum);
        det.appendChild(listWrap);
        src.appendChild(det);
      } else {
        src.appendChild(hdRow);
        src.appendChild(listWrap);
      }
      this.dictSec.appendChild(src);
    });

    if (data.sentences && data.sentences.length) {
      const det = document.createElement('details');
      det.open = true; // 双语例句默认展开
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
      this.dictSec.appendChild(det);
    }
  }

  showLinks(links: LinkItem[]): void {
    this.ft.textContent = '';
    links.forEach((l) => {
      const a = h('a', 'st-link', l.name);
      a.href = l.url;
      a.target = '_blank';
      a.rel = 'noreferrer noopener';
      this.ft.appendChild(a);
    });
  }
}
