/**
 * 开场长度分布统计（真 Key）：采样 N 个开局，报告中文字数分布、
 * short 标记、guard 重试与 replaced 帧——验证「150–200 字」目标与
 * 短文本兜底是否按设计工作。
 * 运行：npm run length-stats [次数，默认 6]
 */
import { loadEnv } from '../src/config/env.js';
import { createLlmClient, LlmRouter } from '../src/infra/llm/router.js';
import { MemoryDebateStore } from '../src/infra/store/memoryStore.js';
import { TurnRegistry } from '../src/infra/store/turnChannel.js';
import { IpRateLimiter } from '../src/infra/rateLimit.js';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { PERSONAS } from '../src/personas/index.js';

const cjk = (s: string) => (s.match(/[\u4e00-\u9fa5]/g) ?? []).length;

interface Ev { event: string; data: any }

async function readSse(res: Response): Promise<Ev[]> {
  const events: Ev[] = [];
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) events.push({ event: line.slice(6).trim(), data: {} });
        else if (line.startsWith('data:') && events.length) {
          try { events[events.length - 1].data = JSON.parse(line.slice(5)); } catch { /* 心跳等非 JSON */ }
        }
      }
    }
  }
  return events;
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? 6);
  const env = loadEnv({});
  const router = new LlmRouter(await createLlmClient(env), env);
  const ctx: AppContext = {
    env,
    router,
    store: new MemoryDebateStore(env.DEBATE_TTL_MS, env.MAX_ACTIVE_DEBATES),
    limiter: new IpRateLimiter(env.RATE_LIMIT_PER_IP),
    turns: new TurnRegistry(),
    policy: { compressAfterRounds: env.COMPRESS_AFTER_ROUNDS, keepRecentRounds: env.KEEP_RECENT_ROUNDS },
    startedAt: Date.now(),
  };
  const app = buildApp(ctx);
  const call = (path: string, init?: RequestInit) => app.fetch(new Request(`http://local${path}`, init));

  const topics: any = await (await call('/api/topics')).json();
  const keys = Object.keys(PERSONAS);

  const counts: number[] = [];
  let shortCount = 0;
  let shortRetried = 0;

  for (let i = 0; i < n; i++) {
    const personaKey = keys[i % keys.length]!;
    const topic = topics.items[i % topics.items.length];
    const created: any = await (
      await call('/api/debate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personaKey,
          topicId: topic.id,
          userStance: i % 2 ? 'con' : 'pro',
          maxRounds: 6,
        }),
      })
    ).json();

    const ev = await readSse(await call(`/api/debate/${created.debateId}/opening`, { method: 'POST' }));
    const done = ev.find((e) => e.event === 'done')?.data;
    const text: string = done?.fullText ?? '';
    const c = cjk(text);
    counts.push(c);

    const guards = ev.filter((e) => e.event === 'guard');
    const replacedFrames = ev.filter((e) => e.event === 'delta' && e.data.replaced).length;
    if (done?.short) shortCount += 1;
    if (guards.some((g) => typeof g.data.reason === 'string' && g.data.reason.includes('过短'))) shortRetried += 1;

    // 输出保持 ASCII：中文经控制台 GBK 显示链必乱，数字都曾被带偏
    console.log(
      `${String(i + 1).padStart(2)}. ${personaKey.padEnd(11)} ${String(c).padStart(3)} cjk` +
        `  short=${done?.short ? 'Y' : '-'}` +
        `  guards=${guards.length} [${guards.map((g) => g.data.action).join('/')}]` +
        `  replacedFrames=${replacedFrames}`,
    );
  }

  counts.sort((a, b) => a - b);
  const avg = Math.round(counts.reduce((s, v) => s + v, 0) / counts.length);
  // 总结行用 ASCII：node 控制台中文经 GBK 显示链会变乱码，数字也曾被误读
  console.log(
    `\nSUMMARY min=${counts[0]} median=${counts[Math.floor(counts.length / 2)]} max=${counts.at(-1)} avg=${avg}`,
  );
  console.log(`SUMMARY short=${shortCount}/${n} shortRetried=${shortRetried}/${n}`);
}

main().catch((err) => {
  console.error('统计脚本异常：', err);
  process.exit(1);
});
