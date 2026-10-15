export type Stance = 'pro' | 'con';
export type Mood = 'calm' | 'amused' | 'irritated' | 'impressed';
export type Role = 'user' | 'sage' | 'judge';

export type DebateStatus = 'draft' | 'running' | 'judging' | 'done' | 'aborted';
export type Turn = 'awaiting_user' | 'generating_sage' | 'awaiting_judge';

export interface Message {
  id: string;
  seq: number;
  round: number;
  role: Role;
  stance?: Stance;
  content: string;
  /** 已被上下文摘要取代：不进 Prompt 正文，但前端仍完整显示 */
  compressed: boolean;
  mood?: Mood;
  tokens: number;
  firstTokenLatencyMs?: number;
  createdAt: number;
}

export interface ContextDigest {
  throughSeq: number;
  userPosition: string;
  personaPosition: string;
  conceded: string[];
  refuted: string[];
  openThreads: string[];
  tokenCost: number;
  createdAt: number;
}

export interface Debate {
  id: string;
  personaKey: string;
  topicId: string;
  userStance: Stance;
  personaStance: Stance;
  maxRounds: number;
  round: number;
  status: DebateStatus;
  turn: Turn;
  messages: Message[];
  /** 单调递增，SSE 续传与去重锚点 */
  seq: number;
  contextDigest?: ContextDigest;
  compressedThroughSeq: number;
  totalTokens: number;
  createdAt: number;
  updatedAt: number;
}

export interface Topic {
  id: string;
  key: string;
  title: string;
  category: 'traditional' | 'contemporary';
  tags: string[];
  background?: string;
  difficulty: 1 | 2 | 3;
  sensitive: boolean;
  stanceHints: { pro: string; con: string };
}

export interface Verdict {
  debateId: string;
  scores: Record<string, number>;
  userHighlights: string[];
  personaHighlights: string[];
  suggestions: string[];
  summary: string;
  followUpQuestion?: string;
  model: string;
}

export const ERROR_CODES = {
  DEBATE_NOT_FOUND: '对局不存在或已过期',
  NOT_YOUR_TURN: '还没到你发言',
  ROUND_EXHAUSTED: '本局回合已用完',
  INPUT_TOO_LONG: '说得太长了，精简一点',
  INPUT_EMPTY: '总得说点什么吧',
  RATE_LIMITED: '稍等一下，先贤还在应付其他人',
  QUOTA_EXCEEDED: '今日额度用尽，明天再来',
  LLM_UNAVAILABLE: '先贤走神了，稍等片刻',
  PERSONA_NOT_FOUND: '找不到这位先贤',
  TOPIC_NOT_FOUND: '找不到这道辩题',
  STREAM_INTERRUPTED: '网络中断了，正在接上',
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly httpStatus: number = 400,
    readonly retryable: boolean = false,
  ) {
    super(ERROR_CODES[code]);
    this.name = 'ApiError';
  }
}
