/* 通道注册表：新增通道只需要在这里加一行。 */
import { mergeSettings } from '../../shared/storage/settings';
import type { ProviderId, Settings, TranslateContext } from '../../shared/types';
import type { PartialFn, Provider } from './types';
import { azureProvider } from './AzureProvider';
import { chromeAiProvider } from './ChromeAiProvider';
import { deeplProvider } from './DeepLProvider';
import { freeMtProvider } from './FreeMTProvider';
import { googleProvider } from './GoogleProvider';
import { libreProvider } from './LibreProvider';
import { openaiProvider } from './OpenAIProvider';

export const PROVIDERS: Record<ProviderId, Provider> = {
  'chrome-ai': chromeAiProvider,
  deepl: deeplProvider,
  azure: azureProvider,
  google: googleProvider,
  libre: libreProvider,
  openai: openaiProvider,
  'free-mt': freeMtProvider,
};

/** 并列对照只允许远程通道；chrome-ai 在页面上下文另起一路。 */
export const PARALLEL_ALLOWED: ProviderId[] = ['deepl', 'azure', 'google', 'libre', 'openai', 'free-mt'];

export function isParallelAllowed(provider: string): boolean {
  return PARALLEL_ALLOWED.indexOf(provider as ProviderId) >= 0;
}

export function runProvider(
  provider: string,
  ctx: TranslateContext,
  onPartial: PartialFn,
  settings: Settings,
): Promise<string> {
  const impl = PROVIDERS[provider as ProviderId];
  if (!impl) throw new Error('UNKNOWN_PROVIDER');
  return impl.translate(ctx, settings, onPartial);
}

/** 方便测试与内部复用的直连入口（免密钥通道不需要凭据） */
export function translateViaFreeMT(ctx: TranslateContext, onPartial?: PartialFn): Promise<string> {
  return freeMtProvider.translate(ctx, mergeSettings(null), onPartial);
}

export type { Provider, PartialFn };
