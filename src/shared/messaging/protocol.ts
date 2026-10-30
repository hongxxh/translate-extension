/* 消息协议：所有 chrome.runtime 消息与长连接事件的唯一定义处。
   background 与 content / popup / options 都引用这里，改字段名会被 tsc 拦住。 */
import type {
  DictResult,
  ProviderId,
  SentencePair,
  Settings,
  SettingsPatch,
  TranslateRequest,
} from '../types';

export type MessageType =
  | 'dict:lookup'
  | 'settings:get'
  | 'settings:set'
  | 'ai:translate'
  | 'cache:clear'
  | 'open:options'
  // 下面两条是 background → content 的定向消息
  | 'st:open'
  | 'st:settings-changed';

export interface MessageMap {
  'dict:lookup': { text: string };
  'settings:get': undefined;
  'settings:set': SettingsPatch;
  'ai:translate': TranslateRequest;
  'cache:clear': undefined;
  'open:options': undefined;
  'st:open': { text: string };
  'st:settings-changed': undefined;
}

export interface Envelope<K extends MessageType = MessageType> {
  type: K;
  payload?: MessageMap[K];
}

export interface MessageResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

/** AI 流式/并列通道的端口名 */
export const AI_PORT = 'ai';

export type AiPortEvent =
  | { type: 'chan'; index: number; provider: ProviderId; phase: 'partial'; text: string }
  | { type: 'chan'; index: number; provider: ProviderId; phase: 'done'; text: string; cached?: boolean }
  | { type: 'chan'; index: number; provider: ProviderId; phase: 'error'; code: string }
  | { type: 'partial'; text: string }
  | { type: 'done'; text: string; cached?: boolean; pairs?: SentencePair[] | null }
  | { type: 'error'; code: string };

/** content → background 的端口启动消息 */
export interface AiStartMessage {
  type: 'start';
  payload: TranslateRequest;
}

export type { DictResult, Settings, SettingsPatch, TranslateRequest };
