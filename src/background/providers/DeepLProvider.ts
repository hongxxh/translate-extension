/* DeepL 官方 API —— 长句/整段质量最好的机器翻译。
   Free 档每月 50 万字符、仅邮箱注册（Key 以 :fx 结尾），走 api-free.deepl.com。 */
import { splitChunks } from '../../shared/text';
import type { Provider } from './types';

const DEEPL_LANG: Record<string, string> = {
  'zh-CN': 'ZH',
  'zh-TW': 'ZH', // DeepL 中文只有简体一种
  en: 'EN-US',
  ja: 'JA',
  ko: 'KO',
  fr: 'FR',
  de: 'DE',
  es: 'ES',
  ru: 'RU',
};

export const deeplProvider: Provider = {
  id: 'deepl',
  async translate(ctx, settings, onPartial) {
    const cfg = settings.deepl || {};
    const key = String(cfg.apiKey || '').trim();
    if (!key) throw new Error('DEEPL_NO_KEY');

    const host = key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
    const target = DEEPL_LANG[ctx.targetLang] || 'ZH';

    // 长文本按 4000 字符切段，用 text 数组一次性提交，DeepL 按原顺序返回
    const chunks = ctx.text.length > 4000 ? splitChunks(ctx.text, 4000) : [ctx.text];
    const res = await fetch(host + '/v2/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'DeepL-Auth-Key ' + key,
      },
      body: JSON.stringify({ text: chunks, target_lang: target }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json.message || 'DeepL 接口 HTTP ' + res.status;
      throw new Error('DeepL：' + msg);
    }
    const out = (json.translations || []).map((t: { text?: string }) => t && t.text).filter(Boolean).join('');
    if (!out) throw new Error('EMPTY_RESULT');
    if (onPartial) onPartial(out);
    return out;
  },
};
