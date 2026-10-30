/* =========================================================
 * 划词译 · SelectTrans — background service worker 入口
 * 职责：消息路由 / 长连接流式通道 / 右键菜单
 * 业务实现都在 TranslationService 与 providers/ 里，这里只做接线。
 * ========================================================= */
import { dictLookup } from './dictionary';
import { aiTranslate, aiTranslateParallel } from './TranslationService';
import type { ChannelEvent } from './TranslationService';
import { PARALLEL_ALLOWED, PROVIDERS, isParallelAllowed, runProvider, translateViaFreeMT } from './providers/index';
import { AI_PORT } from '../shared/messaging/protocol';
import type { AiPortEvent, AiStartMessage, Envelope, MessageResponse } from '../shared/messaging/protocol';
import { getSettings, setSettings, DEFAULT_SETTINGS } from '../shared/storage/settings';
import { cacheClear } from '../shared/storage/cache';
import type { DictResult, Settings, SettingsPatch, TranslateRequest, TranslateResult } from '../shared/types';
import { effectiveTargetLang } from '../shared/text';

/* 对外暴露的接口。test-providers.js / test-smoke.js 用 vm 加载打包产物后直接取用。 */
export {
  aiTranslate,
  aiTranslateParallel,
  PARALLEL_ALLOWED,
  PROVIDERS,
  isParallelAllowed,
  runProvider,
  translateViaFreeMT,
  dictLookup,
  getSettings,
  setSettings,
  DEFAULT_SETTINGS,
  effectiveTargetLang,
};
export { buildLinks, fetchYoudaoJSON, parseYoudao, fetchWiktionary, fetchFreeDictionary, fetchYoudaoSuggest } from './dictionary';
export { buildPrompt, cleanOutput, hashStr, splitChunks, splitSentences, stripTags, textLooksZh } from '../shared/text';

const MENU_ID = 'st-lookup';

/** 统一把抛出的东西变成错误码字符串 */
function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string' && err) return err;
  return String(err ?? '');
}

function handleMessage(
  msg: Envelope,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (res: MessageResponse<unknown>) => void,
): boolean {
  void (async () => {
    try {
      switch (msg && msg.type) {
        case 'dict:lookup':
          sendResponse({ ok: true, data: await dictLookup((msg.payload || {}) as { text: string }) });
          break;
        case 'settings:get':
          sendResponse({ ok: true, data: await getSettings() });
          break;
        case 'settings:set':
          sendResponse({ ok: true, data: await setSettings((msg.payload || {}) as SettingsPatch) });
          break;
        case 'ai:translate':
          // 设置页「连通性测试」用：验证当前通道的凭据与接口
          sendResponse({ ok: true, data: await aiTranslate((msg.payload || {}) as TranslateRequest, null, {}) });
          break;
        case 'cache:clear':
          await cacheClear();
          sendResponse({ ok: true });
          break;
        case 'open:options':
          void chrome.runtime.openOptionsPage();
          sendResponse({ ok: true });
          break;
        default:
          sendResponse({ ok: false, error: 'UNKNOWN_MESSAGE' });
      }
    } catch (err) {
      sendResponse({ ok: false, error: errMsg(err) });
    }
  })();
  return true; // 异步响应必须返回 true
}

function handleConnect(port: chrome.runtime.Port): void {
  if (port.name !== AI_PORT) return;
  let aborted = false;
  port.onDisconnect.addListener(() => { aborted = true; });
  port.onMessage.addListener((raw: AiStartMessage) => {
    if (!raw || raw.type !== 'start') return;
    const push = (payload: AiPortEvent): void => {
      if (aborted) return;
      try {
        port.postMessage(payload);
      } catch {
        aborted = true;
      }
    };
    const req = (raw.payload || {}) as TranslateRequest;
    // 只要带的是数组就走并列（哪怕只剩一个远程通道，也要按列独立、不兜底）
    const multi = Array.isArray(req.providers) && req.providers.length > 0;

    void (async () => {
      try {
        if (multi) {
          // 并列对照：每个通道单独推一条 chan 事件
          // 注意：并列模式不发 done —— 主容器装的是 grid，清空它会把两列一起抹掉
          await aiTranslateParallel(req, (ev: ChannelEvent) => push({ type: 'chan', ...ev }));
        } else {
          const res: TranslateResult = await aiTranslate(req, (partial: string) => push({ type: 'partial', text: partial }));
          push({ type: 'done', text: res.text, cached: res.cached, pairs: res.pairs || null });
        }
      } catch (err) {
        push({ type: 'error', code: errMsg(err) });
      }
    })();
  });
}

function createMenu(): void {
  try {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: '用「划词译」查询选中的内容',
      contexts: ['selection'],
    });
  } catch {
    // 菜单已存在（重复安装）时忽略
  }
}

function handleMenuClick(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab): void {
  if (info.menuItemId !== MENU_ID || !tab || !tab.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'st:open', text: info.selectionText || '' }).catch(() => {});
}

function handleInstalled(): void {
  createMenu();
}

/** 挂上所有监听。service worker 里自动调用；测试环境（vm）里不调用。 */
export function attach(): void {
  chrome.runtime.onMessage.addListener(handleMessage);
  chrome.runtime.onConnect.addListener(handleConnect);
  chrome.runtime.onInstalled.addListener(handleInstalled);
  chrome.contextMenus.onClicked.addListener(handleMenuClick);
}

const inServiceWorker = typeof chrome !== 'undefined'
  && Boolean(chrome.runtime && chrome.runtime.onMessage)
  // service worker 没有 DOM；vm 沙箱里也没有 runtime，两个条件一起兜住
  && typeof document === 'undefined';

if (inServiceWorker) attach();

export type { DictResult, Settings, TranslateRequest };
