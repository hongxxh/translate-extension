/* Shadow DOM 基础设施：宿主容器 + 样式注入 + 建元素小工具。
   面板与气泡各挂一个宿主，样式用 adoptedStyleSheets 注入，
   页面自身的 CSS 完全影响不到里面。 */
import css from './styles.css';

export const MAX_Z = '2147483647';
/** 面板宿主 id；气泡宿主是它 + '-tip' */
export const HOST_ID = 'st-root-host';
export const TIP_HOST_ID = HOST_ID + '-tip';

export interface Mount {
  host: HTMLElement;
  shadow: ShadowRoot;
}

function parent(): HTMLElement {
  return document.body || document.documentElement;
}

export function isOwnHost(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  const id = el && el.id;
  return Boolean(id) && String(id).indexOf(HOST_ID) === 0;
}

export function mountHost(id: string): Mount {
  const host = document.createElement('div');
  host.id = id;
  host.style.cssText = [
    'all:initial', 'position:fixed', 'top:0', 'left:0', 'width:0', 'height:0',
    'z-index:' + MAX_Z, 'display:block',
  ].join(';');

  const shadow = host.attachShadow({ mode: 'open' });
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    shadow.adoptedStyleSheets = [sheet];
  } catch {
    const style = document.createElement('style');
    style.textContent = css;
    shadow.appendChild(style);
  }

  parent().appendChild(host);
  return { host, shadow };
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

export function svgIcon(path: string, size?: number): SVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size || 13));
  svg.setAttribute('height', String(size || 13));
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
