import type { LlmRouter } from '../infra/llm/router.js';
import { estimateTokens } from '../infra/llm/openaiCompat.js';
import type { ContextDigest, Debate, Topic } from '../types.js';
import { buildCompressMessages } from './PromptBuilder.js';

/** 模型偶尔会在 JSON 前后加话，做一次宽松提取 */
export function extractJson(text: string): unknown | undefined {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

function toStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)).slice(0, 5) : [];
}

/**
 * 上下文压缩：把早期轮次压成 digest，只保留最近 N 轮全文。
 * 摘要用 cheap 档——这是最不需要聪明模型的任务，省下的 token 是纯利润。
 */
export class ContextCompressor {
  constructor(private readonly router: LlmRouter) {}

  async compress(
    debate: Debate,
    topic: Topic,
    keepRecentRounds: number,
    signal?: AbortSignal,
    /** 先贤身份键：mock 的压缩摘要按人设生成（原来写死「柏拉图主张」，其余先贤串味） */
    personaKey?: string,
  ): Promise<ContextDigest | undefined> {
    const full = debate.messages.filter((m) => !m.compressed && m.role !== 'judge');
    if (full.length <= keepRecentRounds * 2 + 2) return undefined;

    const cutoffSeq = full[full.length - keepRecentRounds * 2]?.seq;
    if (cutoffSeq === undefined) return undefined;

    const toCompress = full.filter((m) => m.seq < cutoffSeq);
    if (toCompress.length === 0) return undefined;

    const raw = await this.router.complete({
      tier: 'cheap',
      purpose: 'compress',
      responseFormat: 'json',
      temperature: 0.2,
      maxTokens: 400,
      personaKey,
      messages: buildCompressMessages({ history: toCompress, topic }),
      signal,
    });

    const parsed = extractJson(raw) as Record<string, unknown> | undefined;
    if (!parsed) return undefined;

    return {
      throughSeq: cutoffSeq - 1,
      userPosition: String(parsed.userPosition ?? '').slice(0, 120),
      personaPosition: String(parsed.personaPosition ?? '').slice(0, 120),
      conceded: toStringArray(parsed.conceded),
      refuted: toStringArray(parsed.refuted),
      openThreads: toStringArray(parsed.openThreads),
      tokenCost: estimateTokens(raw),
      createdAt: Date.now(),
    };
  }
}
