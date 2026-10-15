import type { Env } from './config/env.js';
import type { LlmRouter } from './infra/llm/router.js';
import type { IpRateLimiter } from './infra/rateLimit.js';
import type { MemoryDebateStore } from './infra/store/memoryStore.js';
import type { TurnRegistry } from './infra/store/turnChannel.js';
import type { RoundPolicyConfig } from './domain/RoundPolicy.js';

export interface AppContext {
  env: Env;
  router: LlmRouter;
  store: MemoryDebateStore;
  limiter: IpRateLimiter;
  turns: TurnRegistry;
  policy: RoundPolicyConfig;
  startedAt: number;
}

export interface HonoVars {
  Variables: { ctx: AppContext };
}
