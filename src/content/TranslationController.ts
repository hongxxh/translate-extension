/* 编排层：把选区、气泡、面板、翻译请求串起来。
   - 选区/视口事件 → SelectionManager
   - 气泡 → FloatingButton
   - 结果渲染 → TranslationPanel
   - 远程通道 → background 的长连接；本机通道 → 页面上下文直调 */
import { SelectionManager } from './selection/SelectionManager';
import { FloatingButton } from './ui/FloatingButton';
import { TranslationPanel, compareList } from './ui/TranslationPanel';
import { rangeRect } from './selection/selection-utils';
import { runChromeAi } from './providers/ChromeAiProvider';
import { fetchSettings, lookup, saveSettings } from '../shared/messaging/client';
import { AI_PORT } from '../shared/messaging/protocol';
import type { AiPortEvent } from '../shared/messaging/protocol';
import { mergeSettings } from '../shared/storage/settings';
import { PROVIDER_LABELS } from '../shared/constants';
import { isSentenceText, isWordLike } from '../shared/text';
import type {
  ProviderId,
  SentenceMode,
  Settings,
  SettingsPatch,
} from '../shared/types';

const OPEN_DEDUPE_MS = 800;

export class TranslationController {
  private settings: Settings = mergeSettings(null);
  private panel: TranslationPanel | null = null;
  private readonly tip: FloatingButton;
  private readonly selection: SelectionManager;
  private port: chrome.runtime.Port | null = null;
  private text = '';
  private rect: DOMRect | null = null;
  private lastOpen: { text: string; at: number } | null = null;
  private started = false;

  constructor() {
    this.tip = new FloatingButton((text, rect) => this.openPanel(text, rect));
    this.selection = new SelectionManager({
      settings: () => this.settings,
      onTip: (text, rect) => this.maybeShowTip(text, rect),
      onOpen: (text, rect) => this.openOnce(text, rect),
      onEmpty: () => this.tip.hideSoon(),
      onHideTip: () => this.tip.hide(),
      onOutsideDown: () => {
        if (this.panel) this.closePanel();
        this.tip.hide();
      },
      onEscape: () => {
        if (this.panel) this.closePanel();
        this.tip.hide();
      },
      onViewportChange: () => {
        if (this.panel) this.closePanel();
        this.tip.hide();
      },
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    const settings = await fetchSettings();
    if (settings) this.settings = settings;

    this.selection.start();
    chrome.runtime.onMessage.addListener(this.onRuntimeMessage);

    // 标记注入完成：DOM 是共享的，页面与自动化测试都能读到这个属性
    document.documentElement.setAttribute('data-st-ready', '1');
  }

  destroy(): void {
    this.selection.destroy();
    this.tip.destroy();
    this.closePanel();
    try {
      chrome.runtime.onMessage.removeListener(this.onRuntimeMessage);
    } catch { /* 上下文已失效 */ }
    document.documentElement.removeAttribute('data-st-ready');
    this.started = false;
  }

  /* --------------------------- 气泡 --------------------------- */

  private maybeShowTip(text: string, rect: DOMRect): void {
    // 同一种选区不要反复重建气泡，否则位置会跳
    if (this.tip.visible && this.tip.currentText === text) {
      this.tip.keepAlive();
      return;
    }
    this.tip.show(text, rect);
  }

  /* mouseup 与 selectionchange 可能都命中同一段选区，这里做一次去重，
     避免面板被连续开两次、翻译请求也发两遍。 */
  private openOnce(text: string, rect: DOMRect): void {
    const now = Date.now();
    if (this.lastOpen && this.lastOpen.text === text && now - this.lastOpen.at < OPEN_DEDUPE_MS) return;
    this.lastOpen = { text, at: now };
    this.openPanel(text, rect);
  }

  /* --------------------------- 面板 --------------------------- */

  private closePanel(): void {
    if (this.port) {
      try { this.port.disconnect(); } catch { /* 已断开 */ }
      this.port = null;
    }
    if (this.panel) {
      this.panel.close();
      this.panel = null;
    }
    this.text = '';
  }

  private targetLang(): string {
    return this.settings.targetLang || 'zh-CN';
  }

  private async persist(patch: SettingsPatch): Promise<void> {
    const res = await saveSettings(patch);
    if (res.ok && res.data) this.settings = res.data;
  }

  private openPanel(text: string, rect: DOMRect): void {
    this.closePanel();
    this.tip.hide();
    this.text = text;
    this.rect = rect;

    const panel = new TranslationPanel(() => this.settings, text, {
      onProviderChange: (p) => void this.handleProviderChange(p),
      onCompareToggle: (next) => void this.handleCompareToggle(next),
      onSentenceModeChange: (mode) => void this.handleSentenceModeChange(mode),
      onClose: () => this.closePanel(),
    });
    this.panel = panel;
    panel.open(rect);

    if (this.settings.aiEnabled !== false) {
      void this.startAi(text, this.targetLang());
    } else if (panel.columns) {
      panel.columns.forEach((c) => panel.showError('AI_DISABLED', c.body));
    } else {
      panel.showError('AI_DISABLED');
    }

    this.loadDictionary(panel, text.trim());
  }

  private async handleProviderChange(provider: ProviderId): Promise<void> {
    this.settings = { ...this.settings, provider };
    // 当前是句子时，同时把「句子专用通道」改掉，否则下拉看起来没生效
    const patch: SettingsPatch = { provider };
    if (this.text && isSentenceText(this.text)) patch.sentence = { provider };
    await this.persist(patch);
    if (this.text) void this.startAi(this.text, this.targetLang());
  }

  private async handleCompareToggle(next: { enabled: boolean; providers: ProviderId[] }): Promise<void> {
    this.settings = { ...this.settings, compare: { ...this.settings.compare, ...next } };
    await this.persist({ compare: next });
    if (this.text && this.rect) this.openPanel(this.text, this.rect);
  }

  private async handleSentenceModeChange(mode: SentenceMode): Promise<void> {
    this.settings = {
      ...this.settings,
      sentence: { ...this.settings.sentence, mode },
    };
    await this.persist({ sentence: { mode } });
    if (this.text) void this.startAi(this.text, this.targetLang());
  }

  /* 句子默认不查词典（词典查不到整句），但设置里可以打开 */
  private loadDictionary(panel: TranslationPanel, trimmed: string): void {
    const sc = this.settings.sentence || {};
    if (isSentenceText(trimmed) && !sc.dict) {
      panel.showEmptyDict('已按句子翻译。划选单词或短语可查词典、看例句。');
      return;
    }

    void lookup(trimmed).then((res) => {
      if (!this.panel || this.panel !== panel) return;
      if (res.ok && res.data) {
        panel.showDictionary(res.data, trimmed);
        panel.showLinks(res.data.links || []);
        return;
      }
      panel.showEmptyDict('词典查询失败：' + (res.error || '未知错误'));
      panel.showLinks([
        {
          name: 'Cambridge',
          url: 'https://dictionary.cambridge.org/dictionary/english-chinese-simplified/' + encodeURIComponent(trimmed),
        },
        {
          name: 'Merriam-Webster',
          url: 'https://www.merriam-webster.com/dictionary/' + encodeURIComponent(trimmed),
        },
      ]);
    });
  }

  /* --------------------------- 翻译 --------------------------- */

  /** 实际使用的通道：句子可以单独指定一条，不跟随主通道 */
  private effectiveProvider(text: string): ProviderId {
    const sc = this.settings.sentence || {};
    if (text && isSentenceText(text) && sc.provider && sc.provider !== 'follow') {
      return PROVIDER_LABELS[sc.provider as ProviderId] ? (sc.provider as ProviderId) : this.settings.provider;
    }
    return this.settings.provider;
  }

  /** 单通道：provider 为字符串；并列：providers 为数组，逐列回填 */
  private startViaBackground(
    text: string,
    targetLang: string,
    provider: ProviderId | null,
    providers?: ProviderId[] | null,
  ): void {
    if (this.port) {
      try { this.port.disconnect(); } catch { /* 已断开 */ }
    }
    const port = chrome.runtime.connect({ name: AI_PORT });
    this.port = port;
    const isWord = isWordLike(text);

    port.onMessage.addListener((m: AiPortEvent) => {
      const panel = this.panel;
      if (!m || !panel) return;

      if (m.type === 'chan') {
        const cols = panel.columns || [];
        // 优先按通道名匹配，避免任一侧过滤顺序不同导致错位
        const col = cols.filter((c) => c.provider === m.provider)[0] || cols[m.index];
        if (!col) return;
        if (m.phase === 'partial') {
          panel.showText(m.text, { isWord }, col.body);
        } else if (m.phase === 'done') {
          panel.showText(m.text, { isWord }, col.body);
          col.tag.textContent = m.cached ? '缓存' : '';
        } else if (m.phase === 'error') {
          panel.showError(m.code, col.body);
          col.tag.textContent = '失败';
        }
        return;
      }

      if (m.type === 'partial') {
        // 逐句对照是一句句回来的，partial 阶段只做局部呈现，等 done 一起铺开
        panel.showText(m.text, { isWord });
      } else if (m.type === 'done') {
        panel.showText(m.text, { isWord, pairs: m.pairs });
        panel.setModeTag(m.cached ? '缓存' : '');
      } else if (m.type === 'error') {
        panel.showError(m.code);
      }
    });

    port.postMessage({ type: 'start', payload: { text, targetLang, provider, providers } });
  }

  private async startAi(text: string, targetLang: string): Promise<void> {
    const panel = this.panel;
    if (!panel) return;

    // 句子可能单独指定了通道，这里要与 background 的判定保持一致
    const provider = this.effectiveProvider(text);
    const cmp = compareList(this.settings);
    const cols = panel.columns;

    // 并列对照：每列一个通道，各写各的，互不覆盖
    if (cmp && cols) {
      const isWord = isWordLike(text);

      cols.forEach((c) => {
        c.tag.textContent = '';
        panel.showLoading(c.body);
      });
      if (this.settings.aiEnabled === false) {
        cols.forEach((c) => panel.showError('AI_DISABLED', c.body));
        return;
      }

      const remote: ProviderId[] = [];
      cmp.forEach((p) => {
        const col = cols.filter((c) => c.provider === p)[0];
        if (!col) return;
        if (p === 'chrome-ai') {
          // 本机模型只能在页面上下文跑，单独起一路，不和 port 通道混在一起
          void runChromeAi(text, targetLang, (t) => {
            if (this.panel !== panel) return;
            panel.showText(t, { isWord }, col.body);
          }).then((ok) => {
            if (this.panel !== panel) return;
            if (ok) {
              col.tag.textContent = '本机';
            } else {
              panel.showError('CHROME_AI_UNAVAILABLE', col.body);
              col.tag.textContent = '不可用';
            }
          });
        } else {
          remote.push(p);
        }
      });

      if (remote.length) this.startViaBackground(text, targetLang, null, remote);
      return;
    }

    panel.syncProviderSelect(provider);
    panel.showLoading();

    if (provider === 'chrome-ai') {
      const ok = await runChromeAi(text, targetLang, (t) => {
        if (this.panel !== panel) return;
        panel.showText(t, { isWord: isWordLike(text) });
      });
      if (this.panel !== panel) return;
      if (ok) {
        panel.setModeTag('本机');
        return;
      }
      // 本机不支持 → 交给 background 按降级链处理
      panel.showLoading();
      this.startViaBackground(text, targetLang, provider);
      return;
    }

    this.startViaBackground(text, targetLang, provider);
  }

  /* --------------------------- background 消息 --------------------------- */

  private onRuntimeMessage = (msg: { type?: string; text?: string }): void => {
    if (!msg) return;

    if (msg.type === 'st:open' && msg.text) {
      const sel = window.getSelection();
      let rect: DOMRect | null = null;
      try {
        rect = sel && sel.rangeCount ? rangeRect(sel.getRangeAt(0)) : null;
      } catch {
        rect = null;
      }
      if (!rect) {
        rect = new DOMRect(window.innerWidth / 2 - 100, 120, 200, 20);
      }
      this.openPanel(msg.text.trim(), rect);
    }

    if (msg.type === 'st:settings-changed') {
      void fetchSettings().then((s) => { if (s) this.settings = s; });
    }
  };
}
