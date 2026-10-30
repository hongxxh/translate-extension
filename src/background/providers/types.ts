/* 翻译通道的统一接口。新增一条通道 = 加一个实现 Provider 的文件 + 在
   providers/index.ts 注册；分发、降级、并列对照都不用改。 */
import type { ProviderId, Settings, TranslateContext } from '../../shared/types';

export type PartialFn = ((text: string) => void) | null | undefined;

export interface Provider {
  id: ProviderId;
  /** settings 里的凭据分组由各通道自己取，分发层不关心 */
  translate(ctx: TranslateContext, settings: Settings, onPartial?: PartialFn): Promise<string>;
}
