export type Tier = 'strong' | 'fast' | 'cheap';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type LlmPurpose = 'sage' | 'judge' | 'compress' | 'mood' | 'match' | 'ping';

export interface ChatOptions {
  tier: Tier;
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json';
  signal?: AbortSignal;
  /** 用途标记：便于 mock 适配器分派、日志归类、成本控制 */
  purpose?: LlmPurpose;
  /**
   * 先贤身份键（plato/aristotle/pythagoras/confucius/laozi）。
   * mock 适配器靠它把占位文本按人设分流——否则五位先贤共用一个柏拉图腔的池子，
   * 无 Key 的「深度体验」里亚里士多德满嘴洞穴比喻（2026-10-14 课堂演示事故）。
   * 真实模型路径不需要它（人格已在 system prompt 里），但传上无害。
   */
  personaKey?: string;
}

/** 流式：逐段产出文本 */
export interface LlmClient {
  readonly name: string;
  stream(opts: ChatOptions): AsyncIterable<string>;
  /** 非流式：压缩、分类等短任务用 */
  complete(opts: ChatOptions): Promise<string>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}
