/* Microsoft Translator（Azure AI 服务）—— 必应翻译的现行企业版。
   免费档 F0 每月 200 万字符，需 Azure 订阅密钥 + 资源所在区域。
   不传 from，交给 Azure 自动检测语种。 */
import { splitChunks } from '../../shared/text';
import type { Provider } from './types';

const AZURE_LANG: Record<string, string> = {
  'zh-CN': 'zh-Hans',
  'zh-TW': 'zh-Hant',
  en: 'en',
  ja: 'ja',
  ko: 'ko',
  fr: 'fr',
  de: 'de',
  es: 'es',
  ru: 'ru',
};

export const azureProvider: Provider = {
  id: 'azure',
  async translate(ctx, settings, onPartial) {
    const cfg = settings.azure || {};
    const key = String(cfg.apiKey || '').trim();
    const region = String(cfg.region || '').trim();
    if (!key) throw new Error('AZURE_NO_KEY');
    if (!region) throw new Error('AZURE_NO_REGION');

    const target = AZURE_LANG[ctx.targetLang] || ctx.targetLang;
    const url = 'https://api.cognitive.microsofttranslator.com/translate'
      + '?api-version=3.0&to=' + encodeURIComponent(target);

    // 单次请求上限 50000 字符 / 100 个元素；4000 分段只是留足余量
    const chunks = ctx.text.length > 4000 ? splitChunks(ctx.text, 4000) : [ctx.text];
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'Ocp-Apim-Subscription-Key': key,
        'Ocp-Apim-Region': region,
      },
      body: JSON.stringify(chunks.map((t) => ({ Text: t }))),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (json.error && json.error.message) || 'Microsoft Translator 接口 HTTP ' + res.status;
      throw new Error('Microsoft Translator：' + msg);
    }
    const out = (Array.isArray(json) ? json : [])
      .map((t: { translations?: { text?: string }[] }) => t && t.translations && t.translations[0] && t.translations[0].text)
      .filter(Boolean)
      .join('');
    if (!out) throw new Error('EMPTY_RESULT');
    if (onPartial) onPartial(out);
    return out;
  },
};
