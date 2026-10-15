import type { Env } from '../../config/env.js';
import { estimateTokens } from './openaiCompat.js';
import { LlmError, type ChatOptions, type LlmClient } from './types.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 模型路由：分层选路 + 预算闸 + 熔断 + 重试。
 * 重试铁律：一旦已经吐出第一个 token，绝不再重试——否则客户端会收到重复文本。
 */
export class LlmRouter {
  private tokensToday = 0;
  private dayKey = '';
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;

  constructor(
    private readonly client: LlmClient,
    private readonly env: Env,
  ) {
    this.dayKey = this.today();
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private rollDayIfNeeded(): void {
    const key = this.today();
    if (key !== this.dayKey) {
      this.dayKey = key;
      this.tokensToday = 0;
    }
  }

  private assertAvailable(): void {
    this.rollDayIfNeeded();
    if (Date.now() < this.circuitOpenUntil) {
      throw new LlmError('上游熔断中，稍后再试', true);
    }
    if (this.tokensToday >= this.env.DAILY_TOKEN_CAP) {
      throw new LlmError('今日额度已用尽', false);
    }
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0;
  }

  private onFailure(err: unknown): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= 3) {
      this.circuitOpenUntil = Date.now() + 60_000;
      this.consecutiveFailures = 0;
    }
    void err;
  }

  private account(text: string): void {
    this.rollDayIfNeeded();
    this.tokensToday += estimateTokens(text);
  }

  async *stream(opts: ChatOptions): AsyncIterable<string> {
    this.assertAvailable();

    let produced = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        for await (const delta of this.client.stream(opts)) {
          produced = true;
          this.account(delta);
          yield delta;
        }
        this.onSuccess();
        return;
      } catch (err) {
        this.onFailure(err);
        const retryable = err instanceof LlmError ? err.retryable : false;
        // 已吐字 / 不可重试 / 已重试过 → 直接抛出
        if (produced || !retryable || attempt === 1) throw err;
        await sleep(500);
      }
    }
  }

  async complete(opts: ChatOptions): Promise<string> {
    this.assertAvailable();
    try {
      const text = await this.client.complete(opts);
      this.account(text);
      this.onSuccess();
      return text;
    } catch (err) {
      this.onFailure(err);
      throw err;
    }
  }

  usage() {
    this.rollDayIfNeeded();
    return {
      tokensToday: this.tokensToday,
      cap: this.env.DAILY_TOKEN_CAP,
      remaining: Math.max(0, this.env.DAILY_TOKEN_CAP - this.tokensToday),
      circuitOpen: Date.now() < this.circuitOpenUntil,
    };
  }

  describe() {
    return {
      provider: this.client.name,
      models: {
        strong: this.env.LLM_MODEL_STRONG,
        fast: this.env.LLM_MODEL_FAST,
        cheap: this.env.LLM_MODEL_CHEAP,
      },
    };
  }
}

export async function createLlmClient(env: Env): Promise<LlmClient> {
  if (env.LLM_PROVIDER === 'mock') {
    const { createMockClient } = await import('./mock.js');
    return createMockClient();
  }
  const { createOpenAICompatClient } = await import('./openaiCompat.js');
  return createOpenAICompatClient({
    baseUrl: env.LLM_BASE_URL,
    apiKey: env.LLM_API_KEY,
    models: {
      strong: env.LLM_MODEL_STRONG,
      fast: env.LLM_MODEL_FAST,
      cheap: env.LLM_MODEL_CHEAP,
    },
    timeoutMs: { strong: env.LLM_TIMEOUT_MS_STRONG, cheap: env.LLM_TIMEOUT_MS_CHEAP },
  });
}
