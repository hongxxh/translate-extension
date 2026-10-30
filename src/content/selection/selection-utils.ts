/* 选区几何与浮层定位。
   两个历史坑都在这里兜住：
   1) 贴顶选区 —— 定位必须「无条件」夹在视口内，不能只在放不下的分支里夹一次，
      否则 top 会算成负数，气泡/面板被顶出视口，看着就是「选中了却没反应」；
   2) 跨行选区末尾零宽 —— range.getClientRects() 最后一个矩形常常是 0×h，
      要倒着找第一个真正有面积的矩形，找不到再退回整体包围盒。 */

/** 浮层与视口边缘的最小间距 */
export const PAD = 8;
/** 气泡命中区边长：视觉按钮 28px，四周各留 9px，这是「点不中」的解药 */
export const TIP_BOX = 46;

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export function clamp(v: number, max: number): number {
  return Math.max(PAD, Math.min(v, max - PAD));
}

export function apply(host: HTMLElement, left: number, top: number, w: number, h: number): void {
  host.style.transform = 'translate('
    + Math.round(clamp(left, window.innerWidth - w)) + 'px,'
    + Math.round(clamp(top, window.innerHeight - h)) + 'px)';
}

/** 面板定位：首选方向放不下就翻到另一侧 */
export function place(host: HTMLElement, rect: Box, w: number, h: number, prefer?: 'above' | 'below'): void {
  let top = prefer === 'above' ? rect.top - h - 10 : rect.bottom + 10;
  const left = rect.left + rect.width / 2 - w / 2;
  if (top + h > window.innerHeight - PAD) top = rect.top - h - 10;
  apply(host, left, top, w, h);
}

/** 气泡定位：贴着选区末尾（鼠标松手的位置）放，右下优先，逐边翻转 */
export function placeTip(host: HTMLElement, rect: Box, w: number, h: number): void {
  const gap = 4;
  let left = rect.right + gap;
  let top = rect.bottom + gap;

  if (left + w > window.innerWidth - PAD) left = rect.left - w - gap;   // 右侧不够 → 挪到左边
  if (left < PAD) left = rect.right - w - gap;                          // 左边也不够 → 贴选区右端内侧
  if (top + h > window.innerHeight - PAD) top = rect.top - h - gap;     // 下方不够 → 翻到上方
  if (top < PAD) top = rect.bottom - h - gap;                           // 上方也不够 → 贴选区下沿内侧

  apply(host, left, top, w, h);
}

export function rectUsable(r: Box | DOMRect | null | undefined): boolean {
  return Boolean(r) && ((r as Box).width > 1 || (r as Box).height > 1);
}

export function rangeRect(range: Range): DOMRect | null {
  let rects: DOMRect[] = [];
  try {
    rects = Array.prototype.slice.call(range.getClientRects() || []) as DOMRect[];
  } catch {
    rects = [];
  }
  for (let i = rects.length - 1; i >= 0; i--) {
    if (rectUsable(rects[i])) return rects[i];
  }
  try {
    const box = range.getBoundingClientRect();
    if (rectUsable(box)) return box;
  } catch { /* 某些异常选区拿不到包围盒，退回 null */ }
  return null;
}

export interface SelectionPick {
  text: string;
  rect: DOMRect;
}

/** 读当前选区：输入框 / 文本域走 selectionStart，其余走 window.getSelection() */
export function readSelection(): SelectionPick | null {
  const active = document.activeElement as (HTMLElement & {
    selectionStart?: number;
    selectionEnd?: number;
    value?: string;
  }) | null;

  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
    const s = active.selectionStart;
    const e = active.selectionEnd;
    if (typeof s === 'number' && typeof e === 'number' && e > s) {
      const r = active.getBoundingClientRect();
      if (rectUsable(r)) return { text: String(active.value || '').slice(s, e), rect: r };
    }
  }

  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const text = sel.toString();
  if (!text || !text.trim()) return null;

  let range: Range;
  try {
    range = sel.getRangeAt(0);
  } catch {
    return null;
  }
  const rect = rangeRect(range);
  if (!rect) return null;
  return { text, rect };
}
