/* 划词监听：mouseup / mousedown / keydown / selectionchange / scroll / resize。
   全部走捕获阶段，页面自己的 stopPropagation 拦不住；destroy() 一次性解绑，
   重复注入时先销毁旧的，避免同页面出现两套监听。 */
import { isOwnHost } from '../ui/shadow-root';
import { readSelection } from './selection-utils';
import type { Settings } from '../../shared/types';

export interface SelectionCallbacks {
  settings: () => Settings | null;
  /** 松手后该显示气泡（icon 触发） */
  onTip: (text: string, rect: DOMRect) => void;
  /** 直接开面板（auto / alt 触发，以及右键菜单入口） */
  onOpen: (text: string, rect: DOMRect) => void;
  /** 选区没了：气泡延迟隐藏，给「按下去那一下」留缓冲 */
  onEmpty: () => void;
  /** 选区不合规（太短 / 太长）：立即撤掉气泡 */
  onHideTip: () => void;
  /** 浮层之外的 mousedown：收面板 + 撤气泡 */
  onOutsideDown: () => void;
  onEscape: () => void;
  /** 滚动 / 缩放后浮层位置已失效 */
  onViewportChange: () => void;
}

interface Bound {
  target: EventTarget;
  type: string;
  fn: EventListener;
  capture: boolean;
}

export class SelectionManager {
  private dragging = false;
  private selTimer = 0;
  private hideTimer = 0;
  private bound: Bound[] = [];

  constructor(private readonly cb: SelectionCallbacks) {}

  start(): void {
    if (this.bound.length) return;
    this.on(document, 'mouseup', this.handleMouseUp as EventListener, true);
    this.on(document, 'mousedown', this.handleMouseDown as EventListener, true);
    this.on(document, 'keydown', this.handleKeyDown as EventListener, true);
    this.on(document, 'selectionchange', this.handleSelectionChange as EventListener, true);
    this.on(window, 'scroll', this.handleViewport as EventListener, true);
    this.on(window, 'resize', this.handleViewport as EventListener, true);
  }

  destroy(): void {
    for (const b of this.bound) b.target.removeEventListener(b.type, b.fn, b.capture);
    this.bound = [];
    window.clearTimeout(this.selTimer);
    window.clearTimeout(this.hideTimer);
  }

  private on(target: EventTarget, type: string, fn: EventListener, capture: boolean): void {
    target.addEventListener(type, fn, capture);
    this.bound.push({ target, type, fn, capture });
  }

  private textOk(text: string, s: Settings | null): boolean {
    const min = (s && s.minLen) || 1;
    const max = (s && s.maxLen) || 400;
    return text.length >= min && text.length <= max;
  }

  private handleSelection(event: MouseEvent | null): void {
    const s = this.cb.settings();
    const pick = readSelection();

    if (!pick) {
      if (!s || s.trigger === 'icon') this.cb.onEmpty();
      return;
    }
    const text = pick.text.trim();
    if (!text || !this.textOk(text, s)) {
      this.cb.onHideTip();
      return;
    }

    if (s && s.trigger === 'auto') {
      window.setTimeout(() => {
        const again = readSelection();
        if (again && again.text.trim() === text) this.cb.onOpen(text, pick.rect);
      }, 260);
      return;
    }
    if (s && s.trigger === 'alt') {
      if (event && event.altKey) this.cb.onOpen(text, pick.rect);
      return;
    }
    if (this.dragging) return; // 还在拖，等松手
    this.cb.onTip(text, pick.rect);
  }

  private handleMouseUp = (e: MouseEvent): void => {
    this.dragging = false;
    if (isOwnHost(e.target)) return;
    // 有些页面在 mouseup 之后才把 selection 定下来，异步再读一次更稳
    this.handleSelection(e);
    window.setTimeout(() => this.handleSelection(e), 0);
  };

  /* selectionchange 是兜底：键盘 Shift+方向键、双击选词、跨 iframe 结束、
     以及在窗口外松开鼠标等情况，光靠 mouseup 会漏。 */
  private handleSelectionChange = (): void => {
    const s = this.cb.settings();
    if (s && s.trigger === 'auto') return;
    window.clearTimeout(this.selTimer);
    this.selTimer = window.setTimeout(() => {
      if (this.dragging) return;
      this.handleSelection(null);
    }, 180);
  };

  private handleMouseDown = (e: MouseEvent): void => {
    if (isOwnHost(e.target)) return;
    this.dragging = true;
    this.cb.onOutsideDown();
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      this.cb.onEscape();
      return;
    }
    // 键盘扩选（Shift+方向键 / Cmd+A）也要能唤出气泡
    if (e.shiftKey || ((e.metaKey || e.ctrlKey) && e.key === 'a')) {
      window.clearTimeout(this.selTimer);
      this.selTimer = window.setTimeout(() => this.handleSelection(null), 80);
    }
  };

  private handleViewport = (): void => {
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.cb.onViewportChange(), 120);
  };
}
