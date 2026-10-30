/* 跨层共用的常量表：通道名、语言名、句子显示方式、词典来源清单。
   新增通道 / 来源时改这里，UI（面板下拉、设置页、弹窗）自动跟着变。 */
import type { ProviderId, SentenceMode, SourceSettings } from './types';

export const LANG_NAMES: Record<string, string> = {
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  en: '英语',
  ja: '日语',
  ko: '韩语',
  fr: '法语',
  de: '德语',
  es: '西班牙语',
  ru: '俄语',
};

/** 通道显示名：面板下拉、并列列头、右键菜单共用 */
export const PROVIDER_LABELS: Record<ProviderId, string> = {
  'chrome-ai': '本地模型 · Gemini Nano',
  deepl: 'DeepL',
  azure: 'Microsoft Translator',
  google: 'Google 翻译',
  libre: 'LibreTranslate',
  openai: '自定义模型',
  'free-mt': '免费机器翻译',
};

/** 固定顺序：下拉与并列勾选都按它排 */
export const PROVIDER_IDS = Object.keys(PROVIDER_LABELS) as ProviderId[];

export interface SentenceModeOption {
  id: SentenceMode;
  label: string;
  title: string;
}

/** 句子显示方式：面板标题栏的那个小按钮按这个顺序循环切换 */
export const SENTENCE_MODES: SentenceModeOption[] = [
  { id: 'target', label: '译文', title: '只显示译文' },
  { id: 'bilingual', label: '对照', title: '逐句双语对照' },
  { id: 'source', label: '原文', title: '先原文后译文' },
];

/** 词典来源开关的唯一清单（设置页 / 弹窗的 id 为 src-<key>） */
export const DICT_SOURCES = [
  'youdao',
  'collins',
  'sentences',
  'wiktionary',
  'freedict',
  'ydsimple',
] as (keyof SourceSettings)[];

/** 词典区块与双语例句一律默认展开，collapsed 只表示「可折叠」 */
export const BLOCK_ORDER = [
  'youdao',
  'collins',
  'forms',
  'wiktionary',
  'freedict',
  'ydsimple',
];
