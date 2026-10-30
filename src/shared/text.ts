/* 纯文本处理：hash、去标签、语言判定、提示词、输出清洗、切句、切块、并发上限。
   background 与 content 都必须用同一份 —— 两处判定不一致会直接表现为
   「中文原文翻成中文」这种看起来像 bug 的行为。 */
import { LANG_NAMES } from './constants';
import type { TranslateKind } from './types';

export function hashStr(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function stripTags(s: unknown): string {
  return String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/** 中文判定：CJK 字符数 × 2 ≥ 拉丁字母数就算「中文为主」 */
export function textLooksZh(text: unknown): boolean {
  const s = String(text || '');
  const cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length;
  if (!cjk) return false;
  const latin = (s.match(/[A-Za-z]/g) || []).length;
  return cjk * 2 >= latin;
}

/** 原文已是中文 + 目标是中文 → 自动改译英语。
    必须在分发给通道之前算好，让所有通道（含不读 prompt 的机器翻译）都生效。 */
export function effectiveTargetLang(text: string, targetLang?: string): string {
  const t = targetLang || 'zh-CN';
  if (textLooksZh(text) && /^zh(-|$)/i.test(t)) return 'en';
  return t;
}

export function buildPrompt(text: string, targetLang: string, kind: TranslateKind): string {
  const lang = textLooksZh(text) ? '英语' : LANG_NAMES[targetLang] || targetLang;

  if (kind === 'word') {
    return [
      '你是专业词典与翻译引擎。请处理下面这个词或短语，翻译为' + lang + '。',
      '严格按以下格式输出，不要任何多余说明、不要 Markdown 标题：',
      '第1行：最贴切的译文',
      '第2行：词性 + 简明释义；有多个常见义项时用 ① ② ③ 并列',
      '第3行：一个例句 + 对照译文，格式「例句 | 对照」',
      '禁止调用任何工具、禁止读写文件、禁止联网搜索，直接回答。',
      '',
      '原文：' + text,
    ].join('\n');
  }

  return [
    '你是专业翻译引擎。将下面的文本翻译为' + lang + '。',
    '要求：',
    '1. 只输出译文，不要解释、不要前言、不要用引号包裹、不要复述原文。',
    '2. 完整保留原文的段落结构、换行与标点风格。',
    '3. 术语使用通用规范译法；人名、地名、品牌名保留原文或使用通行译名。',
    '4. 禁止调用任何工具、禁止读写文件、禁止联网搜索，直接回答。',
    '',
    '原文：',
    text,
  ].join('\n');
}

export function cleanOutput(s: string): string {
  let t = String(s || '').trim();
  t = t.replace(/^```[a-z]*\n?/i, '').replace(/```$/, '').trim();
  t = t.replace(/^(译文|翻译|Translation|Output)\s*[:：]\s*/i, '');
  if (/^["“「']([\s\S]*)["”」']$/.test(t) && t.length < 400) {
    t = t.slice(1, -1).trim();
  }
  return t.trim();
}

/** 切句：保留分隔符，按分隔符把整段拆成一句句（逐句对照用）。
    英文句点只在「后面是空白或结尾、且前面不是数字」时才算断句，
    这样 3.14 与 e.g. 不会被切开。 */
export function splitSentences(text: string): string[] {
  const raw = String(text || '').replace(/\r/g, ' ').trim();
  if (!raw) return [];

  const STOP = '[。！？；…!?;]';
  const parts = raw.split(new RegExp('(' + STOP + '+|(?<![0-9])\\.(?=\\s|$))', 'g'));
  const out: string[] = [];
  let buf = '';

  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    if (seg == null || seg === '') continue;
    if (/^[。！？；…!?;.]+$/.test(seg)) {
      buf += seg;
      if (buf.trim()) out.push(buf.trim());
      buf = '';
    } else {
      buf += seg;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.length ? out : [raw];
}

/** 按字符上限切块，尽量在空格/换行处断开 */
export function splitChunks(text: string, limit: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf(' ', limit);
    if (cut < limit * 0.5) cut = rest.lastIndexOf('\n', limit);
    if (cut < limit * 0.5) cut = limit;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.trim()) out.push(rest);
  return out;
}

/** 并发上限：逐句翻译时不要一次把十几个请求全撒出去 */
export async function mapLimit<T, R>(list: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(list.length);
  let i = 0;
  const workers: Promise<void>[] = [];
  const n = Math.max(1, Math.min(limit, list.length));
  for (let w = 0; w < n; w++) {
    workers.push((async () => {
      for (;;) {
        const idx = i++;
        if (idx >= list.length) return;
        out[idx] = await fn(list[idx], idx);
      }
    })());
  }
  await Promise.all(workers);
  return out;
}

/** 单词/短语判定：≤3 个词 且 ≤40 字符 */
export function isWordLike(text: string): boolean {
  return text.split(/\s+/).filter(Boolean).length <= 3 && text.length <= 40;
}

/** 句子判定：足够长，或含 5 个以上词（中文无空格靠长度兜底） */
export function isSentenceText(text: string): boolean {
  const s = String(text || '').trim();
  return s.length >= 20 || s.split(/\s+/).filter(Boolean).length >= 5;
}
