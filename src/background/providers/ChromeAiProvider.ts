/* Chrome 内置 AI（Gemini Nano）：只能在页面上下文（content script）调用，
   service worker 里没有 Translator / LanguageDetector 全局。
   这里保留条目只是为了让「通道表」完整，调用方会拿到明确的错误码。 */
import type { Provider } from './types';

export const chromeAiProvider: Provider = {
  id: 'chrome-ai',
  async translate() {
    throw new Error('CHROME_AI_PAGE_ONLY');
  },
};
