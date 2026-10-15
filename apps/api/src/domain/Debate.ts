import type { ContextDigest, Debate, Message, Mood, Stance } from '../types.js';
import { ApiError } from '../types.js';
import type { RoundPolicyConfig } from './RoundPolicy.js';

let counter = 0;
function nextId(prefix: string): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export const newId = nextId;

export function flip(stance: Stance): Stance {
  return stance === 'pro' ? 'con' : 'pro';
}

export interface CreateDebateInput {
  personaKey: string;
  topicId: string;
  userStance: Stance;
  maxRounds: number;
}

/**
 * 对局聚合根。所有状态迁移必须经过这里，禁止外部直接改 Debate。
 * 不变量：
 *   1. generating_sage 期间不接受新的玩家发言（并发发言最容易漏）
 *   2. round > maxRounds 后不再接受发言
 *   3. seq 严格单调递增，是 SSE 续传的唯一锚点
 *   4. done 之后一切写操作拒绝
 */
export class DebateAggregate {
  private constructor(private d: Debate) {}

  static create(input: CreateDebateInput): DebateAggregate {
    const now = Date.now();
    return new DebateAggregate({
      id: nextId('dbt'),
      personaKey: input.personaKey,
      topicId: input.topicId,
      userStance: input.userStance,
      personaStance: flip(input.userStance),
      maxRounds: input.maxRounds,
      round: 1,
      status: 'draft',
      turn: 'awaiting_user',
      messages: [],
      seq: 0,
      compressedThroughSeq: 0,
      totalTokens: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  static from(d: Debate): DebateAggregate {
    return new DebateAggregate({ ...d, messages: [...d.messages] });
  }

  get data(): Debate {
    return this.d;
  }

  get id(): string {
    return this.d.id;
  }

  private touch(): void {
    this.d.updatedAt = Date.now();
  }

  /** 先贤先手时的开场：只允许在 draft 且尚无消息时调用 */
  assertCanOpen(): void {
    if (this.d.messages.length > 0) {
      throw new ApiError('NOT_YOUR_TURN', 409);
    }
    if (this.d.status === 'done' || this.d.status === 'aborted') {
      throw new ApiError('NOT_YOUR_TURN', 409);
    }
  }

  assertCanUserSpeak(): void {
    if (this.d.status === 'aborted' || this.d.status === 'done') {
      throw new ApiError('ROUND_EXHAUSTED', 409);
    }
    if (this.d.turn === 'generating_sage') {
      throw new ApiError('NOT_YOUR_TURN', 409);
    }
    // 只按「用户发言轮次」计数：maxRounds 指玩家可发言的轮数，开场白不计入。
    // 不能用 round > maxRounds 判断——开场会让 round 先走一格，那样会提前一回合误封。
    if (this.d.messages.filter((m) => m.role === 'user').length >= this.d.maxRounds) {
      throw new ApiError('ROUND_EXHAUSTED', 409);
    }
  }

  assertCanJudge(): void {
    // judging 正是「等待裁判」的状态，必须放行；只有已结束的对局才拒绝
    if (this.d.status === 'done' || this.d.status === 'aborted') {
      throw new ApiError('ROUND_EXHAUSTED', 409);
    }
  }

  appendUser(text: string): Message {
    const msg: Message = {
      id: nextId('msg'),
      seq: ++this.d.seq,
      round: this.d.round,
      role: 'user',
      stance: this.d.userStance,
      content: text,
      compressed: false,
      tokens: Math.ceil(text.length / 1.5),
      createdAt: Date.now(),
    };
    this.d.messages.push(msg);
    this.d.status = 'running';
    this.d.turn = 'generating_sage';
    this.touch();
    return msg;
  }

  /** 开场白由先贤先说，round 与 turn 与玩家发言路径不同 */
  markGenerating(): void {
    this.d.status = 'running';
    this.d.turn = 'generating_sage';
    this.touch();
  }

  /** 即将生成的先贤消息所占用的 seq（用于 SSE 的 id 与续传锚点） */
  peekNextSeq(): number {
    return this.d.seq + 1;
  }

  finishSage(
    content: string,
    opts: { tokens: number; mood?: Mood; latencyMs?: number; id?: string },
  ): Message {
    const msg: Message = {
      id: opts.id ?? nextId('msg'),
      seq: ++this.d.seq,
      round: this.d.round,
      role: 'sage',
      stance: this.d.personaStance,
      content,
      compressed: false,
      mood: opts.mood,
      tokens: opts.tokens,
      firstTokenLatencyMs: opts.latencyMs,
      createdAt: Date.now(),
    };
    this.d.messages.push(msg);
    this.d.totalTokens += opts.tokens;

    const userTurns = this.d.messages.filter((m) => m.role === 'user').length;
    if (userTurns >= this.d.maxRounds) {
      this.d.status = 'judging';
      this.d.turn = 'awaiting_judge';
    } else {
      this.d.round += 1;
      this.d.turn = 'awaiting_user';
    }
    this.touch();
    return msg;
  }

  /** 生成失败时回滚，避免卡在 generating_sage 再也进不去 */
  rollbackSage(): void {
    if (this.d.turn === 'generating_sage') {
      this.d.turn = this.d.messages.some((m) => m.role === 'user') ? 'awaiting_user' : 'awaiting_user';
      this.touch();
    }
  }

  needsCompress(policy: RoundPolicyConfig): boolean {
    if (this.d.round <= policy.compressAfterRounds) return false;
    return this.d.seq - this.d.compressedThroughSeq > policy.keepRecentRounds * 2 + 2;
  }

  applyDigest(digest: ContextDigest): void {
    this.d.contextDigest = digest;
    this.d.compressedThroughSeq = digest.throughSeq;
    for (const m of this.d.messages) {
      if (m.seq <= digest.throughSeq && m.role !== 'judge') m.compressed = true;
    }
    this.touch();
  }

  abort(): void {
    this.d.status = 'aborted';
    this.d.turn = 'awaiting_user';
    this.touch();
  }
}
