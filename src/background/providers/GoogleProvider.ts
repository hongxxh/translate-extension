/* Google Cloud Translation API（v2 Basic，API Key 直连）
   v2 用 ?key= 认证，不需要 OAuth；v3 要服务账号 JWT，不适合纯客户端扩展。 */
import { splitChunks } from '../../shared/text';
import type { Provider } from './types';

const GOOGLE_LANG: Record<string, string> = {
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

export const googleProvider: Provider = {
  id: 'google',
  async translate(ctx, settings, onPartial) {
    const cfg = settings.google || {};
    const key = String(cfg.apiKey || '').trim();
    if (!key) throw new Error('GOOGLE_NO_KEY');

    const target = GOOGLE_LANG[ctx.targetLang] || ctx.targetLang;
    const chunks = ctx.text.length > 4000 ? splitChunks(ctx.text, 4000) : [ctx.text];
    const res = await fetch(
      'https://translation.googleapis.com/language/translate/v2?key=' + encodeURIComponent(key),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // q 支持数组，多段一次提交并按原顺序返回
        body: JSON.stringify({ q: chunks, target, format: 'text' }),
      },
    );

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = json.error || {};
      const msg = e.message || e.status || 'Google 翻译接口 HTTP ' + res.status;
      throw new Error('Google 翻译：' + msg);
    }
    const list = json.data && json.data.translations;
    const out = Array.isArray(list)
      ? list.map((t: { translatedText?: string }) => t && t.translatedText).filter(Boolean).join('')
      : '';
    if (!out) throw new Error('EMPTY_RESULT');
    if (onPartial) onPartial(out);
    return out;
  },
};
