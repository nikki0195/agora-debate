import { serve } from '@hono/node-server';
import { loadEnv } from './config/env.js';
import { createLlmClient, LlmRouter } from './infra/llm/router.js';
import { MemoryDebateStore } from './infra/store/memoryStore.js';
import { TurnRegistry } from './infra/store/turnChannel.js';
import { IpRateLimiter } from './infra/rateLimit.js';
import { loadPersonaPrompt } from './domain/PromptBuilder.js';
import { buildApp } from './app.js';
import type { AppContext } from './context.js';

async function main(): Promise<void> {
  const env = loadEnv();

  // 启动即校验 prompt 文件存在，避免第一次发言才炸
  for (const key of ['plato', 'judge']) loadPersonaPrompt(key);

  const router = new LlmRouter(await createLlmClient(env), env);

  const ctx: AppContext = {
    env,
    router,
    store: new MemoryDebateStore(env.DEBATE_TTL_MS, env.MAX_ACTIVE_DEBATES),
    limiter: new IpRateLimiter(env.RATE_LIMIT_PER_IP),
    turns: new TurnRegistry(),
    policy: {
      compressAfterRounds: env.COMPRESS_AFTER_ROUNDS,
      keepRecentRounds: env.KEEP_RECENT_ROUNDS,
    },
    startedAt: Date.now(),
  };

  // 后台清理：过期对局、过期续传通道、过期限流窗口
  const sweeper = setInterval(() => {
    ctx.store.stats();
    ctx.turns.sweep();
    ctx.limiter.sweep();
  }, 60_000);
  sweeper.unref();

  const app = buildApp(ctx);
  serve({ fetch: app.fetch, port: env.PORT });

  console.log(`\n  Agora API 已启动`);
  console.log(`  地址      http://localhost:${env.PORT}`);
  console.log(`  验证页    http://localhost:${env.PORT}/`);
  console.log(`  健康检查  http://localhost:${env.PORT}/api/healthz  （免费云保活打这个）`);
  console.log(`  LLM       ${env.LLM_PROVIDER} / ${router.describe().models.strong}`);
  console.log(`  部署前提  单实例（内存态）\n`);
}

main().catch((err: unknown) => {
  console.error('\n启动失败：');
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
