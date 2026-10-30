/* LibreTranslate —— 可自建的开源翻译后端，也提供官方公共服务。
   接口与键名公开固定：POST /translate，{q, source, target, api_key} → {translatedText}。
   自建实例通常免 Key；官方 libretranslate.com 现在需要注册拿 Key。 */
import { splitChunks } from '../../shared/text';
import type { Provider } from './types';

const LIBRE_LANG: Record<string, string> = {
  'zh-CN': 'zh',
  'zh-TW': 'zh', // LibreTranslate 中文只有一个码
  en: 'en',
  ja: 'ja',
  ko: 'ko',
  fr: 'fr',
  de: 'de',
  es: 'es',
  ru: 'ru',
};

export const libreProvider: Provider = {
  id: 'libre',
  async translate(ctx, settings, onPartial) {
    const cfg = settings.libre || {};
    const base = String(cfg.baseUrl || '').replace(/\/+$/, '').replace(/\/translate$/, '');
    if (!base) throw new Error('LIBRE_NO_BASEURL');

    const target = LIBRE_LANG[ctx.targetLang] || ctx.targetLang;
    // 匿名实例通常关闭了 auto 检测，这里按字符启发式给源语言
    const source = /[\u4e00-\u9fff]/.test(ctx.text) ? 'zh' : 'en';
    const chunks = ctx.text.length > 2000 ? splitChunks(ctx.text, 2000) : [ctx.text];

    const parts: string[] = [];
    for (const t of chunks) {
      const body: Record<string, string> = { q: t, source, target, format: 'text' };
      if (cfg.apiKey) body.api_key = cfg.apiKey;
      const res = await fetch(base + '/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = json.error || json.message || 'LibreTranslate 接口 HTTP ' + res.status;
        throw new Error('LibreTranslate：' + msg);
      }
      const one = json.translatedText;
      if (!one) throw new Error('EMPTY_RESULT');
      parts.push(one);
      if (onPartial) onPartial(parts.join(''));
    }
    return parts.join('');
  },
};
