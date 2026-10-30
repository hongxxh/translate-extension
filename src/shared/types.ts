/* 全扩展共用的数据类型。background / content / popup / options 都从这里取，
   避免各自写一份结构导致字段漂移。 */

export type ProviderId =
  | 'chrome-ai'
  | 'deepl'
  | 'azure'
  | 'google'
  | 'libre'
  | 'openai'
  | 'free-mt';

/** 主通道可选项（句子专用通道额外允许 follow = 跟随主通道） */
export type SentenceProviderId = ProviderId | 'follow';

export type TriggerMode = 'icon' | 'auto' | 'alt';

/** 句子显示方式：只译文 / 逐句双语对照 / 原文 + 译文 */
export type SentenceMode = 'target' | 'bilingual' | 'source';

export interface OpenaiSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface DeeplSettings {
  /** DeepL Auth Key；以 :fx 结尾 = Free 档（自动走 api-free.deepl.com） */
  apiKey: string;
}

export interface AzureSettings {
  apiKey: string;
  region: string;
}

export interface GoogleSettings {
  apiKey: string;
}

export interface LibreSettings {
  baseUrl: string;
  apiKey: string;
}

export interface SentenceSettings {
  provider: SentenceProviderId;
  mode: SentenceMode;
  /** 按句拆分后逐句翻译（对照模式更整齐，也更容易缓存命中） */
  perSentence: boolean;
  /** 句子模式是否仍然查词典 */
  dict: boolean;
}

export interface CompareSettings {
  enabled: boolean;
  providers: ProviderId[];
}

export interface SourceSettings {
  youdao: boolean;
  collins: boolean;
  sentences: boolean;
  wiktionary: boolean;
  freedict: boolean;
  ydsimple: boolean;
}

export interface Settings {
  targetLang: string;
  trigger: TriggerMode;
  aiEnabled: boolean;
  provider: ProviderId;
  /** 主通道失败时降级到 free-mt */
  fallbackEnabled: boolean;
  minLen: number;
  maxLen: number;
  cacheDays: number;
  openai: OpenaiSettings;
  deepl: DeeplSettings;
  azure: AzureSettings;
  google: GoogleSettings;
  libre: LibreSettings;
  sentence: SentenceSettings;
  compare: CompareSettings;
  sources: SourceSettings;
}

/** settings:set 只吃深合并的补丁，任意层级都能局部更新 */
export type SettingsPatch = Partial<Omit<Settings, 'openai' | 'deepl' | 'azure' | 'google' | 'libre' | 'sentence' | 'compare' | 'sources'>> & {
  openai?: Partial<OpenaiSettings>;
  deepl?: Partial<DeeplSettings>;
  azure?: Partial<AzureSettings>;
  google?: Partial<GoogleSettings>;
  libre?: Partial<LibreSettings>;
  sentence?: Partial<SentenceSettings>;
  compare?: Partial<CompareSettings>;
  sources?: Partial<SourceSettings>;
};

/* --------------------------- 词典 --------------------------- */

export interface DictExample {
  en: string;
  zh: string;
}

export interface DictItem {
  pos: string;
  def: string;
  example?: DictExample | null;
}

export interface DictBlock {
  id: string;
  title: string;
  source?: string;
  star?: number;
  /** 只表示「可折叠」，渲染时一律默认展开 */
  collapsed?: boolean;
  items: DictItem[];
}

export interface DictSentence {
  en: string;
  zh: string;
}

export interface LinkItem {
  name: string;
  url: string;
}

export interface DictResult {
  word: string;
  phonetic: { uk: string; us: string; ipa: string };
  audio: Record<string, string>;
  blocks: DictBlock[];
  sentences: DictSentence[];
  links: LinkItem[];
  /** 有来源失败时为 true，UI 可提示「部分来源不可用」 */
  partial: boolean;
}

/* --------------------------- 翻译 --------------------------- */

export type TranslateKind = 'word' | 'sentence';

export interface TranslateContext {
  text: string;
  targetLang: string;
  prompt: string;
  kind: TranslateKind;
}

export interface SentencePair {
  src: string;
  dst: string;
}

export interface TranslateResult {
  text: string;
  cached: boolean;
  pairs?: SentencePair[] | null;
}

export interface TranslateRequest {
  text: string;
  targetLang?: string;
  provider?: ProviderId | null;
  providers?: ProviderId[] | null;
}
