/* 划词气泡：一个小按钮 + 一圈 46px 的透明命中区。
   这里有两个刻意的设计，都是踩过坑之后留下的：
   - 命中区比按钮大一圈（见 styles.css 的 .st-tip-wrap），否则「点不中」；
   - 监听 pointerdown 而不是 click —— 页面常常在 mousedown 阶段就把选区清掉了，
     等 click 时按钮已经被撤走。 */
import { h, mountHost, TIP_HOST_ID } from './shadow-root';
import type { Mount } from './shadow-root';
import { placeTip, TIP_BOX } from '../selection/selection-utils';

const HIDE_DELAY = 260;

export class FloatingButton {
  private mount: Mount | null = null;
  private timer = 0;
  private text = '';
  private rect: DOMRect | null = null;

  constructor(private readonly onActivate: (text: string, rect: DOMRect) => void) {}

  get visible(): boolean {
    return Boolean(this.mount);
  }

  get currentText(): string {
    return this.text;
  }

  show(text: string, rect: DOMRect): void {
    this.hide();
    const mount = mountHost(TIP_HOST_ID);
    const wrap = h('div', 'st-tip-wrap');
    const btn = h('button', 'st-tip', '译');
    btn.title = '查询「' + text.slice(0, 20) + '」';
    btn.setAttribute('aria-label', '划词译');

    wrap.appendChild(btn);
    mount.shadow.appendChild(wrap);
    placeTip(mount.host, rect, TIP_BOX, TIP_BOX);

    // 指针移入续命，避免手抖的时候气泡先消失
    wrap.addEventListener('mouseenter', () => window.clearTimeout(this.timer));

    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const r = this.rect || rect;
      const t = this.text || text;
      this.hide();
      this.onActivate(t, r);
    });
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const t = this.text || text;
        const r = this.rect || rect;
        this.hide();
        this.onActivate(t, r);
      }
    });

    this.mount = mount;
    this.rect = rect;
    this.text = text;
  }

  hide(): void {
    window.clearTimeout(this.timer);
    if (this.mount) {
      this.mount.host.remove();
      this.mount = null;
    }
    this.text = '';
    this.rect = null;
  }

  /** 延迟隐藏：选区被清空的瞬间就撤掉气泡，会让「按下去那一下」落空 */
  hideSoon(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.hide(), HIDE_DELAY);
  }

  /** 鼠标移入时续命 */
  keepAlive(): void {
    window.clearTimeout(this.timer);
  }

  destroy(): void {
    this.hide();
  }
}
