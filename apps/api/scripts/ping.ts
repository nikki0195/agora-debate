/**
 * Key 连通性测试：1 次最小请求，判断是「Key 问题」还是「代码问题」。
 * 输出全程脱敏，不打印完整 Key。
 */
import { loadEnv } from '../src/config/env.js';
import { createLlmClient, LlmRouter } from '../src/infra/llm/router.js';

function mask(k: string): string {
  if (!k) return '(空)';
  if (k.length <= 10) return '****';
  return `${k.slice(0, 4)}…${k.slice(-4)}（长度 ${k.length}）`;
}

async function main(): Promise<void> {
  const env = loadEnv();
  console.log(`  provider = ${env.LLM_PROVIDER}`);
  console.log(`  base_url = ${env.LLM_BASE_URL}`);
  console.log(`  api_key  = ${mask(env.LLM_API_KEY)}`);
  console.log(`  model    = ${env.LLM_MODEL_STRONG}`);

  const client = await createLlmClient(env);
  const router = new LlmRouter(client, env);

  console.log('\n  发送最小请求（max_tokens=16）…');
  const t0 = Date.now();
  try {
    const reply = await router.complete({
      tier: 'cheap',
      purpose: 'ping',
      messages: [{ role: 'user', content: '只回复两个字：可用' }],
      maxTokens: 16,
    });
    console.log(`  ✓ 连通成功（${Date.now() - t0}ms）`);
    console.log(`  回复：${JSON.stringify(reply.trim())}`);
    console.log(`  用量：${JSON.stringify(router.usage())}`);
    console.log('\n  VERDICT=KEY_OK');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ✗ 调用失败（${Date.now() - t0}ms）`);
    console.log(`  错误：${msg}`);
    console.log('\n  VERDICT=KEY_FAILED');
    process.exitCode = 1;
  }
}

main();
