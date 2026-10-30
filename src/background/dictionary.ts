/* 权威词典聚合：有道 jsonapi（英汉双解 + 柯林斯 + 双语例句）为主，
   Wiktionary（dictionaryapi.dev）与 Free Dictionary API 补英英释义，
   有道 suggest 补一条中文速览。任一来源失败都要能安全降级（partial）。 */
import { stripTags } from '../shared/text';
import { getSettings } from '../shared/storage/settings';
import type { DictBlock, DictItem, DictResult, LinkItem, SourceSettings } from '../shared/types';

export function buildLinks(q: string): LinkItem[] {
  const e = encodeURIComponent(q);
  return [
    { name: 'Cambridge', url: 'https://dictionary.cambridge.org/dictionary/english-chinese-simplified/' + e },
    { name: 'Merriam-Webster', url: 'https://www.merriam-webster.com/dictionary/' + e },
    { name: 'Collins', url: 'https://www.collinsdictionary.com/dictionary/english/' + e },
    { name: '有道', url: 'https://dict.youdao.com/result?word=' + e + '&lang=en' },
  ];
}

export async function fetchYoudaoJSON(q: string): Promise<unknown> {
  const url = 'https://dict.youdao.com/jsonapi?q=' + encodeURIComponent(q);
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('有道接口 HTTP ' + res.status);
  return await res.json();
}

interface YoudaoLine {
  i?: string[];
}
interface YoudaoTr {
  l?: YoudaoLine;
}
interface YoudaoGroup {
  tr?: YoudaoTr[];
}
interface YoudaoJson {
  ec?: {
    word?: {
      ukphone?: string;
      usphone?: string;
      trs?: YoudaoGroup[];
      wfs?: { wf?: { name?: string; value?: string } }[];
    }[];
  };
  collins?: {
    collins_entries?: {
      star?: number | string;
      entries?: {
        entry?: {
          tran_entry?: {
            pos_entry?: { pos?: string };
            tran?: string;
            exam_sents?: { sent?: { eng_sent?: string; chn_sent?: string }[] };
          }[];
        }[];
      };
    }[];
  };
  blng_sents_part?: { 'sentence-pair'?: Record<string, string>[] };
}

/** 把「n. 名词」这类前缀拆成词性 + 释义；拆不出来就整条当释义 */
function splitPos(text: string): { pos: string; def: string } {
  const m = text.match(/^([a-z]+\.)\s*([\s\S]*)$/i);
  return m ? { pos: m[1], def: m[2] } : { pos: '', def: text };
}

export function parseYoudao(json: unknown, sources: SourceSettings): {
  phonetic: { uk: string; us: string };
  blocks: DictBlock[];
  sentences: DictResult['sentences'];
} {
  const out = { phonetic: { uk: '', us: '' }, blocks: [] as DictBlock[], sentences: [] as DictResult['sentences'] };
  if (!json || typeof json !== 'object') return out;

  const data = json as YoudaoJson;
  const ec = data.ec;
  if (sources.youdao && ec && ec.word && ec.word[0]) {
    const w = ec.word[0];
    out.phonetic.uk = w.ukphone || '';
    out.phonetic.us = w.usphone || '';

    const items: DictItem[] = [];
    (w.trs || []).forEach((group) => {
      (group.tr || []).forEach((t) => {
        ((t.l && t.l.i) || []).forEach((line) => {
          items.push(splitPos(stripTags(line)));
        });
      });
    });
    if (items.length) out.blocks.push({ id: 'youdao', title: '有道词典 · 英汉双解', items });

    if (w.wfs && w.wfs.length) {
      out.blocks.push({
        id: 'forms',
        title: '词形变化',
        collapsed: true,
        items: w.wfs.map((f) => ({ pos: (f.wf && f.wf.name) || '', def: (f.wf && f.wf.value) || '' })),
      });
    }
  }

  const col = data.collins;
  if (sources.collins && col && col.collins_entries && col.collins_entries.length) {
    const items: DictItem[] = [];
    let star = 0;
    col.collins_entries.forEach((entry) => {
      star = star || Number(entry.star || 0);
      const entries = (entry.entries && entry.entries.entry) || [];
      entries.forEach((en) => {
        (en.tran_entry || []).forEach((te) => {
          const ex = te.exam_sents && te.exam_sents.sent && te.exam_sents.sent[0];
          items.push({
            pos: (te.pos_entry && te.pos_entry.pos) || '',
            def: stripTags(te.tran),
            example: ex ? { en: stripTags(ex.eng_sent), zh: stripTags(ex.chn_sent) } : null,
          });
        });
      });
    });
    if (items.length) {
      out.blocks.push({ id: 'collins', title: '柯林斯高阶词典', star, collapsed: true, items });
    }
  }

  const bl = data.blng_sents_part;
  const pairs = (bl && bl['sentence-pair']) || [];
  if (sources.sentences && pairs.length) {
    out.sentences = pairs.slice(0, 4).map((p) => ({
      en: stripTags(p['sentence-eng'] || p.sentence || ''),
      zh: stripTags(p['sentence-translation'] || ''),
    }));
  }
  return out;
}

interface WikiEntry {
  phonetic?: string;
  phonetics?: { text?: string; audio?: string }[];
  meanings?: { partOfSpeech?: string; definitions?: { definition?: string; example?: string }[] }[];
}

export async function fetchWiktionary(q: string): Promise<{
  phonetic: string;
  audio: string;
  block: DictBlock;
} | null> {
  const res = await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(q));
  if (!res.ok) return null;
  const arr = (await res.json()) as WikiEntry[];
  if (!Array.isArray(arr) || !arr.length) return null;

  const phonetics: { text?: string; audio?: string }[] = [];
  arr.forEach((e) => (e.phonetics || []).forEach((p) => phonetics.push(p)));
  const audio = (phonetics.find((p) => p.audio && /-us\./.test(p.audio))
    || phonetics.find((p) => p.audio && /-uk\./.test(p.audio))
    || phonetics.find((p) => p.audio)
    || {}).audio || '';
  const ipa = arr[0].phonetic || ((phonetics.find((p) => p.text) || {}).text || '');

  const items: DictItem[] = [];
  arr.forEach((e) => {
    (e.meanings || []).forEach((m) => {
      (m.definitions || []).slice(0, 2).forEach((d) => {
        items.push({
          pos: m.partOfSpeech || '',
          def: d.definition || '',
          example: d.example ? { en: d.example, zh: '' } : null,
        });
      });
    });
  });

  if (!items.length) return null;
  return {
    phonetic: ipa,
    audio,
    block: {
      id: 'wiktionary',
      title: 'Wiktionary · 英英释义',
      source: 'dictionaryapi.dev',
      collapsed: true,
      items: items.slice(0, 8),
    },
  };
}

interface FreeDictEntry {
  partOfSpeech?: string;
  pronunciations?: { text?: string }[];
  senses?: { definition?: string; examples?: string[] }[];
}

/** Free Dictionary API（freedictionaryapi.com）：与 dictionaryapi.dev 收词范围不同，
    补一层英文释义、例句与音标。 */
export async function fetchFreeDictionary(q: string): Promise<{
  phonetic: string;
  block: DictBlock;
} | null> {
  const res = await fetch('https://freedictionaryapi.com/api/v1/entries/en/' + encodeURIComponent(q), {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as { entries?: FreeDictEntry[] } | null;
  if (!json || !Array.isArray(json.entries) || !json.entries.length) return null;

  const items: DictItem[] = [];
  let phonetic = '';
  json.entries.forEach((e) => {
    if (!phonetic) {
      const pr = (e.pronunciations || []).filter((x) => x && x.text)[0];
      if (pr) phonetic = pr.text || '';
    }
    (e.senses || []).forEach((s) => {
      if (items.length >= 8) return;
      const def = stripTags(s.definition || '');
      if (!def) return;
      const ex = (s.examples || [])[0];
      items.push({
        pos: e.partOfSpeech || '',
        def,
        example: ex ? { en: stripTags(ex), zh: '' } : null,
      });
    });
  });

  if (!items.length) return null;
  return {
    phonetic,
    block: {
      id: 'freedict',
      title: 'Free Dictionary · 英英释义',
      source: 'freedictionaryapi.com',
      collapsed: true,
      items,
    },
  };
}

interface SuggestJson {
  data?: { entries?: { entry?: string; explain?: string }[] };
}

/** 有道 suggest：简明中文释义 + 网络释义，返回体很小，适合补一条中文速览。 */
export async function fetchYoudaoSuggest(q: string): Promise<{ block: DictBlock } | null> {
  const url = 'https://dict.youdao.com/suggest?num=5&ver=3.0&doctype=json&cache=false&le=en&q='
    + encodeURIComponent(q);
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('有道 suggest HTTP ' + res.status);
  const json = (await res.json()) as SuggestJson;
  const entries = (json && json.data && json.data.entries) || [];
  if (!entries.length) return null;

  const norm = (s: unknown) => String(s || '').trim().toLowerCase();
  const exact = entries.filter((e) => norm(e.entry) === norm(q));
  const list = exact.length ? exact : entries.slice(0, 3);

  const items: DictItem[] = [];
  list.forEach((e) => {
    const text = stripTags(e.explain || '');
    if (!text) return;
    items.push(splitPos(text));
  });
  if (!items.length) return null;
  return {
    block: { id: 'ydsimple', title: '有道 · 简明释义', source: 'dict.youdao.com', collapsed: true, items },
  };
}

/** 三个「补充来源」的共同形状：都给一个 block，可选地给音标 / 音频 */
interface SideResult {
  phonetic?: string;
  audio?: string;
  block: DictBlock;
}

export async function dictLookup(payload: { text: string }): Promise<DictResult> {
  const q = String(payload.text || '').trim();
  if (!q) throw new Error('EMPTY_QUERY');
  const settings = await getSettings();
  const sources = settings.sources;

  const result: DictResult = {
    word: q,
    phonetic: { uk: '', us: '', ipa: '' },
    audio: {},
    blocks: [],
    sentences: [],
    links: buildLinks(q),
    partial: false,
  };

  // 只请求用户开着的来源；关掉的直接给 null，省一次网络往返
  const needYoudao = !!(sources.youdao || sources.collins || sources.sentences);
  const jobs = [
    needYoudao ? fetchYoudaoJSON(q) : Promise.resolve(null),
    sources.wiktionary ? fetchWiktionary(q) : Promise.resolve(null),
    sources.freedict ? fetchFreeDictionary(q) : Promise.resolve(null),
    sources.ydsimple ? fetchYoudaoSuggest(q) : Promise.resolve(null),
  ];
  const [yd, wk, fd, ys] = await Promise.allSettled(jobs);

  const ydBlocks: DictBlock[] = [];
  if (yd.status === 'fulfilled' && yd.value) {
    const parsed = parseYoudao(yd.value, sources);
    result.phonetic.uk = parsed.phonetic.uk || '';
    result.phonetic.us = parsed.phonetic.us || '';
    ydBlocks.push(...parsed.blocks);
    result.sentences = parsed.sentences;
  } else if (yd.status === 'rejected') {
    result.partial = true;
  }

  const sideBlocks: DictBlock[] = [];
  [wk, fd, ys].forEach((r) => {
    if (r.status !== 'fulfilled') return;
    const value = r.value as SideResult;
    if (!value || !('block' in value) || !value.block) return;
    if (!result.phonetic.uk && !result.phonetic.us && 'phonetic' in value && value.phonetic) {
      result.phonetic.ipa = value.phonetic;
    }
    if ('audio' in value && value.audio) result.audio.wiki = value.audio;
    sideBlocks.push(value.block);
  });

  // 展示顺序：有道 → 柯林斯 → 词形变化 → 英英 → Free Dictionary → 简明释义
  const byId = (from: DictBlock[], id: string) => from.filter((b) => b.id === id);
  result.blocks = [
    ...byId(ydBlocks, 'youdao'),
    ...byId(ydBlocks, 'collins'),
    ...byId(ydBlocks, 'forms'),
    ...byId(sideBlocks, 'wiktionary'),
    ...byId(sideBlocks, 'freedict'),
    ...byId(sideBlocks, 'ydsimple'),
  ];

  const enc = encodeURIComponent(q);
  result.audio.uk = 'https://dict.youdao.com/dictvoice?audio=' + enc + '&type=1';
  result.audio.us = 'https://dict.youdao.com/dictvoice?audio=' + enc + '&type=2';
  result.audio.word = q;

  if (!result.blocks.length && !result.sentences.length) result.partial = true;
  return result;
}
