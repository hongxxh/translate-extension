/* Chrome 内置 AI（Gemini Nano）：零配置、零密钥、离线、数据不出本机。
   必须在页面上下文（content script）里调用，service worker / Worker 里没有
   这两个全局对象。返回 false 表示「本机不可用」，调用方再走降级链。 */
import { effectiveTargetLang, textLooksZh } from '../../shared/text';

const AI_LANG: Record<string, string> = {
  'zh-CN': 'zh',
  'zh-TW': 'zh-Hant',
  en: 'en',
  ja: 'ja',
  ko: 'ko',
  fr: 'fr',
  de: 'de',
  es: 'es',
  ru: 'ru',
};

interface TranslatorLike {
  ready?: Promise<void>;
  translate(text: string): Promise<string>;
  destroy?(): void;
}

interface TranslatorFactory {
  availability(opts: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(opts: {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (m: EventTarget) => void;
  }): Promise<TranslatorLike>;
}

interface DetectorLike {
  detect(text: string): Promise<{ detectedLanguage?: string }[]>;
  destroy?(): void;
}

interface DetectorFactory {
  create(): Promise<DetectorLike>;
}

function globals(): { Translator?: TranslatorFactory; LanguageDetector?: DetectorFactory } {
  return globalThis as unknown as {
    Translator?: TranslatorFactory;
    LanguageDetector?: DetectorFactory;
  };
}

/** 「原文已是中文 → 自动改译英语」，必须与 background 的 effectiveTargetLang 同一套判定 */
export function aiTargetLang(text: string, targetLang?: string): string {
  return effectiveTargetLang(text, targetLang);
}

export function chromeAiAvailable(): boolean {
  return Boolean(globals().Translator);
}

export async function runChromeAi(
  text: string,
  targetLang: string,
  onPartial?: ((t: string) => void) | null,
): Promise<boolean> {
  const { Translator, LanguageDetector } = globals();
  if (!Translator) return false;

  let source = textLooksZh(text) ? 'zh' : 'en';
  if (LanguageDetector) {
    try {
      const detector = await LanguageDetector.create();
      const res = await detector.detect(text);
      if (res && res[0] && res[0].detectedLanguage) source = res[0].detectedLanguage;
      if (detector.destroy) detector.destroy();
    } catch { /* 保持启发式判断 */ }
  }

  const target = AI_LANG[aiTargetLang(text, targetLang)] || targetLang;
  if (source === target) return false;

  try {
    const availability = await Translator.availability({ sourceLanguage: source, targetLanguage: target });
    if (availability === 'unavailable') return false;

    const translator = await Translator.create({
      sourceLanguage: source,
      targetLanguage: target,
      monitor(m: EventTarget) {
        m.addEventListener('downloadprogress', (e) => {
          const ev = e as { loaded?: number };
          const pct = Math.round((ev.loaded || 0) * 100);
          if (onPartial) onPartial('正在下载本地翻译模型… ' + pct + '%（仅首次，之后完全离线）');
        });
      },
    });
    if (translator.ready) await translator.ready;
    const out = await translator.translate(text);
    if (translator.destroy) translator.destroy();
    if (!out) return false;
    if (onPartial) onPartial(out);
    return true;
  } catch {
    return false;
  }
}
