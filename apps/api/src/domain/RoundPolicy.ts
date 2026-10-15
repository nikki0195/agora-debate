import { ApiError } from '../types.js';

export const LIMITS = {
  MIN_ROUNDS: 6,
  MAX_ROUNDS: 10,
  MAX_INPUT_CHARS: 500,
  /** 先贤单轮目标字数（课堂节奏：太短不像柏拉图，太长拖慢演示） */
  REPLY_CHARS_MIN: 150,
  REPLY_CHARS_MAX: 200,
  /** 超过该字数视为可能跑偏，交给 IdentityGuard 复核 */
  REPLY_CHARS_HARD_MAX: 400,
} as const;

export interface RoundPolicyConfig {
  compressAfterRounds: number;
  keepRecentRounds: number;
}

export function assertRounds(n: number): void {
  if (!Number.isInteger(n) || n < LIMITS.MIN_ROUNDS || n > LIMITS.MAX_ROUNDS) {
    throw new ApiError('ROUND_EXHAUSTED', 400);
  }
}

export function assertInput(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) throw new ApiError('INPUT_EMPTY', 400);
  if (trimmed.length > LIMITS.MAX_INPUT_CHARS) throw new ApiError('INPUT_TOO_LONG', 400);
  return trimmed;
}
