/* 统一的 runtime 消息客户端。用 callback 形态而不是 Promise 形态：
   service worker 没起来时会「端口关闭」，Promise 版会抛未捕获异常，
   callback 版只是拿到 undefined，这里统一兜成 NO_RESPONSE。 */
import type { MessageMap, MessageResponse, MessageType } from './protocol';
import type { DictResult, Settings, SettingsPatch, TranslateResult } from '../types';

export function send<K extends MessageType>(
  type: K,
  payload?: MessageMap[K],
): Promise<MessageResponse<unknown>> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type, payload }, (res: MessageResponse<unknown>) => {
        void chrome.runtime.lastError;
        resolve(res || { ok: false, error: 'NO_RESPONSE' });
      });
    } catch {
      resolve({ ok: false, error: 'NO_RESPONSE' });
    }
  });
}

export function lookup(text: string): Promise<MessageResponse<DictResult>> {
  return send('dict:lookup', { text }) as Promise<MessageResponse<DictResult>>;
}

export function getSettings(): Promise<MessageResponse<Settings>> {
  return send('settings:get') as Promise<MessageResponse<Settings>>;
}

/** 返回合并后的完整设置；失败时回退到 null，调用方自己兜底 */
export async function fetchSettings(): Promise<Settings | null> {
  const res = await getSettings();
  return res.ok && res.data ? res.data : null;
}

export function saveSettings(patch: SettingsPatch): Promise<MessageResponse<Settings>> {
  return send('settings:set', patch) as Promise<MessageResponse<Settings>>;
}

/** 设置页「连通性测试」：用一条真实请求验证当前通道的凭据 */
export function testTranslate(text: string): Promise<MessageResponse<TranslateResult>> {
  return send('ai:translate', { text }) as Promise<MessageResponse<TranslateResult>>;
}

export function clearCache(): Promise<MessageResponse<unknown>> {
  return send('cache:clear');
}

export function openOptions(): void {
  send('open:options').catch(() => {});
}
