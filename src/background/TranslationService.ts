/* 翻译业务层：决定「用什么通道、什么目标语言、要不要逐句」，
   并负责缓存 → 调用 → 兜底 → 清洗 → 回写缓存。 */
import { cacheGet, cacheSet, cacheKey } from '../shared/storage/cache';
import { getSettings } from '../shared/storage/settings';
import {
  buildPrompt,
  cleanOutput,
  effectiveTargetLang,
  isWordLike,
  mapLimit,
  splitSentences,
} from '../shared/text';
import type {
  ProviderId,
  SentencePair,
  Settings,
  TranslateContext,
  TranslateKind,
  TranslateRequest,
  TranslateResult,
} from '../shared/types';
import { isParallelAllowed, runProvider } from './providers/index';
import type { PartialFn } from './providers/types';

export interface AiOptions {
  /** false = 不做 free-mt 兜底（并列对照用） */
  fallback?: boolean;
  /** true = 不产生逐句对照对（并列模式） */
  noPairs?: boolean;
}

export type ChannelEvent =
  | { index: number; provider: ProviderId; phase: 'partial'; text: string }
  | { index: number; provider: ProviderId; phase: 'done'; text: string; cached?: boolean }
  | { index: number; provider: ProviderId; phase: 'error'; code: string };

/** 单词 / 句子判定：≤3 个词且 ≤40 字符算单词 */
function kindOf(src: string): TranslateKind {
  return isWordLike(src) ? 'word' : 'sentence';
}

function ctxOf(text: string, targetLang: string, kind: TranslateKind): TranslateContext {
  return { text, targetLang, prompt: buildPrompt(text, targetLang, kind), kind };
}

/** 一次通道调用：缓存 → 调用 → 兜底 → 清洗 → 回写缓存 */
export async function runOnce(
  provider: string,
  ctx: TranslateContext,
  onPartial: PartialFn,
  settings: Settings,
  allowFallback: boolean,
): Promise<TranslateResult> {
  const key = cacheKey(provider, ctx.targetLang, ctx.kind, ctx.text);
  const hit = await cacheGet(key);
  if (hit) {
    if (onPartial) onPartial(hit);
    return { text: hit, cached: true };
  }

  let raw: string;
  try {
    raw = await runProvider(provider, ctx, onPartial, settings);
  } catch (err) {
    if (allowFallback && provider !== 'free-mt') {
      raw = await runProvider('free-mt', ctx, null, settings);
    } else {
      throw err;
    }
  }

  const out = cleanOutput(raw);
  if (!out) throw new Error('EMPTY_RESULT');
  await cacheSet(key, out, settings.cacheDays);
  return { text: out, cached: false };
}

export async function aiTranslate(
  req: TranslateRequest,
  onPartial?: PartialFn | null,
  opts?: AiOptions,
): Promise<TranslateResult> {
  const settings = await getSettings();
  if (!settings.aiEnabled) throw new Error('AI_DISABLED');

  const src = String(req.text || '').trim();
  if (!src) throw new Error('EMPTY_QUERY');

  const kind = kindOf(src);
  const lang = effectiveTargetLang(src, req.targetLang || settings.targetLang);
  const sOpt = settings.sentence;

  // 句子可以单独指定通道：比如单词用本地模型、长句走 DeepL
  let useProvider = req.provider || settings.provider || 'chrome-ai';
  if (kind === 'sentence' && sOpt.provider && sOpt.provider !== 'follow') {
    useProvider = sOpt.provider;
  }

  const ctx = ctxOf(src, lang, kind);
  // opts.fallback === false 时不做免费机器翻译兜底（并列对照用）
  const allowFallback = !(opts && opts.fallback === false) && settings.fallbackEnabled;

  // 逐句对照：切句后一句一句翻，再把「原文 / 译文」成对回传，面板按对显示
  const wantPairs = kind === 'sentence'
    && sOpt.mode === 'bilingual'
    && sOpt.perSentence !== false
    && !(opts && opts.noPairs);

  if (wantPairs) {
    const sentences = splitSentences(src).slice(0, 24);
    if (sentences.length >= 2) {
      const done = await mapLimit(sentences, 4, (one) => runOnce(
        useProvider,
        ctxOf(one, lang, 'sentence'),
        null,
        settings,
        allowFallback,
      ));
      const pairs: SentencePair[] = sentences.map((s, i) => ({ src: s, dst: (done[i] && done[i].text) || '' }));
      const joined = pairs.map((p) => p.dst).filter(Boolean).join('\n');
      if (onPartial) onPartial(joined);
      return { text: joined, pairs, cached: false };
    }
  }

  const res = await runOnce(useProvider, ctx, onPartial ?? null, settings, allowFallback);
  // 「原文 + 译文」模式也把原文带回去，面板直接分段渲染
  if (kind === 'sentence' && sOpt.mode === 'source') {
    res.pairs = [{ src, dst: res.text }];
  }
  return res;
}

/* 并列对照：多个通道各跑一遍，逐通道把结果推回对应的列。
   与单通道的关键差别是 **不做 free-mt 降级** —— 否则失败的那列会变成和
   另一列一样的免费机器翻译结果，对照就失去意义。 */
export async function aiTranslateParallel(
  req: TranslateRequest,
  onChannel: (ev: ChannelEvent) => void,
): Promise<void> {
  const settings = await getSettings();
  if (!settings.aiEnabled) throw new Error('AI_DISABLED');

  const src = String(req.text || '').trim();
  if (!src) throw new Error('EMPTY_QUERY');

  const list = (Array.isArray(req.providers) ? req.providers : [])
    .filter((p) => isParallelAllowed(p))
    .slice(0, 4);

  await Promise.all(list.map(async (p, i) => {
    try {
      const res = await aiTranslate(
        { text: src, targetLang: req.targetLang, provider: p },
        (t) => onChannel({ index: i, provider: p, phase: 'partial', text: t }),
        { fallback: false, noPairs: true },
      );
      onChannel({ index: i, provider: p, phase: 'done', text: res.text, cached: res.cached });
    } catch (e) {
      onChannel({ index: i, provider: p, phase: 'error', code: e instanceof Error ? e.message : 'ERROR' });
    }
  }));
}
