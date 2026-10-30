/* 免密钥机器翻译（MyMemory，匿名可用）—— 兜底通道。
   注意：并列对照里它是一条普通通道，不是别处的兜底。 */
import { splitChunks } from '../../shared/text';
import type { Provider } from './types';

const MM_LANG: Record<string, string> = {
  'zh-CN': 'zh-CN',
  'zh-TW': 'zh-TW',
  en: 'en',
  ja: 'ja',
  ko: 'ko',
  fr: 'fr',
  de: 'de',
  es: 'es',
  ru: 'ru',
};

export const freeMtProvider: Provider = {
  id: 'free-mt',
  async translate(ctx, _settings, onPartial) {
    const tgt = MM_LANG[ctx.targetLang] || ctx.targetLang;
    const src = /[\u4e00-\u9fff]/.test(ctx.text) ? 'zh-CN' : 'en';
    if (src === tgt) throw new Error('FREE_MT_SAME_LANG');

    const parts: string[] = [];
    for (const chunk of splitChunks(ctx.text, 450)) {
      const url = 'https://api.mymemory.translated.net/get?q='
        + encodeURIComponent(chunk) + '&langpair=' + encodeURIComponent(src + '|' + tgt);
      const res = await fetch(url);
      const json = await res.json().catch(() => null);
      const t = json && json.responseData && json.responseData.translatedText;
      if (!t) {
        const detail = json && json.responseDetails ? json.responseDetails : '接口无返回';
        throw new Error('免费机器翻译：' + String(detail).slice(0, 120));
      }
      parts.push(t);
      if (onPartial) onPartial(parts.join(''));
    }
    return parts.join('');
  },
};
