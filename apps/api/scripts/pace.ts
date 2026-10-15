/**
 * 节奏测量脚本：跑「开场 + 2 轮发言」，量化课堂演示的实际体感。
 *
 * 测什么：
 *   1. 每轮回复的字数（对照 prompt 里的 150–200 字目标）
 *   2. 首字延迟 TTFB（决定"点了之后要等多久才看到第一个字"）
 *   3. 帧间隔 / 帧大小（决定"打字机"是否顺滑）
 *   4. 传输层开销（SSE 编码 + 解析，扣除 mock 的人为 sleep）
 *
 * 运行：
 *   npm run pace                 # mock 模式，测链路与传输开销
 *   npm run pace -- --real       # 未来接真模型时用同样口径测
 */
import { loadEnv } from '../src/config/env.js';
import { createLlmClient, LlmRouter } from '../src/infra/llm/router.js';
import { MemoryDebateStore } from '../src/infra/store/memoryStore.js';
import { TurnRegistry } from '../src/infra/store/turnChannel.js';
import { IpRateLimiter } from '../src/infra/rateLimit.js';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';

interface Frame {
  t: number; // 相对请求发起的毫秒数
  delta: string;
}

interface RoundReport {
  label: string;
  text: string;
  chars: number;
  cjk: number;
  ttfbMs: number;
  totalMs: number;
  frameCount: number;
  frameGapMs: { avg: number; p95: number; max: number };
  frameChars: { avg: number; min: number; max: number };
  bytesOnWire: number;
}

// 与 mock.ts 保持一致，用于扣除人为 sleep，剩下的才是 SSE 传输层真实开销
const MOCK_DELAY_PER_FRAME = Number(process.env.MOCK_DELAY_MS ?? 60);

function countCjk(s: string): number {
  return (s.match(/[\u4e00-\u9fa5]/g) ?? []).length;
}

function pctl(nums: number[], p: number): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.floor((p / 100) * s.length));
  return s[i] as number;
}

async function runRound(
  call: (p: string, i?: RequestInit) => Promise<Response>,
  path: string,
  body: unknown,
  label: string,
  deductMockDelay: boolean,
): Promise<RoundReport> {
  const frames: Frame[] = [];
  const t0 = Date.now();
  const res = await call(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let bytesOnWire = 0;
  let text = '';
  let ttfbMs = 0;
  let firstDeltaSeen = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesOnWire += value.byteLength;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() ?? '';
    for (const p of parts) {
      const ev = /^event:\s*(.+)$/m.exec(p);
      const dt = /^data:\s*(.+)$/m.exec(p);
      if (!ev || !dt) continue;
      const now = Date.now() - t0;
      const data = JSON.parse(dt[1]);
      if (ev[1].trim() === 'delta') {
        if (!firstDeltaSeen) {
          ttfbMs = now;
          firstDeltaSeen = true;
        }
        frames.push({ t: now, delta: data.delta as string });
      }
      if (ev[1].trim() === 'done') text = data.fullText as string;
    }
  }
  const totalMs = Date.now() - t0;

  const gaps: number[] = [];
  for (let i = 1; i < frames.length; i++) {
    const g = (frames[i] as Frame).t - (frames[i - 1] as Frame).t;
    // mock 每帧固定 sleep，扣除后剩下的才是传输层真实开销
    gaps.push(deductMockDelay ? Math.max(0, g - MOCK_DELAY_PER_FRAME) : g);
  }
  const sizes = frames.map((f) => f.delta.length);

  return {
    label,
    text,
    chars: text.length,
    cjk: countCjk(text),
    ttfbMs,
    totalMs,
    frameCount: frames.length,
    frameGapMs: {
      avg: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0,
      p95: pctl(gaps, 95),
      max: gaps.length ? Math.max(...gaps) : 0,
    },
    frameChars: {
      avg: sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0,
      min: sizes.length ? Math.min(...sizes) : 0,
      max: sizes.length ? Math.max(...sizes) : 0,
    },
    bytesOnWire,
  };
}

function printRound(r: RoundReport): void {
  console.log(`\n【${r.label}】`);
  console.log(`  ${r.text}`);
  console.log(
    `  ── 字数 ${r.chars}（中文 ${r.cjk}）| 首字 ${r.ttfbMs}ms | 总时长 ${(r.totalMs / 1000).toFixed(2)}s | 帧数 ${r.frameCount}`,
  );
  console.log(
    `  ── 帧间隔 avg ${r.frameGapMs.avg.toFixed(1)}ms / p95 ${r.frameGapMs.p95}ms / max ${r.frameGapMs.max}ms` +
      ` | 帧长 avg ${r.frameChars.avg.toFixed(1)} 字 (${r.frameChars.min}–${r.frameChars.max}) | 线上 ${r.bytesOnWire}B`,
  );
}

/** 用 token 速率模型推算真实模型下的节奏（mock 文本是写死的，不能代表真模型） */
function projectReal(cjkTarget: number): void {
  console.log('\n══ 真实模型节奏推算 ══');
  console.log(`  目标字数 ${cjkTarget} 中文字 ≈ ${Math.round(cjkTarget * 0.7)} tokens（中文按 1 字 ≈ 0.7 token 粗算）`);
  console.log('\n  供应商           首字延迟      生成速率       整轮耗时（175字）   体感');
  const rows: Array<[string, number, number, string]> = [
    ['DeepSeek-chat', 1200, 22, ''],
    ['GLM-4-Flash', 900, 45, ''],
    ['Qwen-plus', 1000, 30, ''],
    ['Kimi', 1500, 25, ''],
    ['本地 7B (Ollama)', 400, 12, ''],
  ];
  const tokens = Math.round(cjkTarget * 0.7);
  for (const [name, ttfb, tps, _] of rows) {
    const gen = (tokens / tps) * 1000;
    const total = ttfb + gen;
    const feel = total < 3000 ? '顺，像在打字' : total < 6000 ? '可接受，节奏像深思' : total > 10000 ? '偏慢，课堂会冷场' : '略慢，需配打字机动画';
    console.log(
      `  ${name.padEnd(18)}${(ttfb + 'ms').padEnd(14)}${(tps + ' tok/s').padEnd(15)}${(total / 1000).toFixed(1) + 's'.padEnd(12)}${feel}`,
    );
  }
  console.log('\n  注：以上为经验值，接真 Key 后用 `npm run pace` 实测覆盖（口径完全一致）。');
}

async function main(): Promise<void> {
  const isReal = process.argv.includes('--real');
  const env = loadEnv(isReal ? {} : { LLM_PROVIDER: 'mock', RATE_LIMIT_PER_IP: '1000' });

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
  const app = buildApp(ctx);
  const call = async (p: string, i?: RequestInit): Promise<Response> =>
    await app.fetch(new Request(`http://local${p}`, i));

  console.log(
    `\n══ Agora 节奏测量 ══\n  provider = ${env.LLM_PROVIDER} / models = ${JSON.stringify(router.describe().models)}`,
  );

  const topics: any = await (await call('/api/topics')).json();
  const topic = topics.items.find((t: any) => t.category === 'contemporary') ?? topics.items[0];

  const created: any = await (
    await call('/api/debate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personaKey: 'plato', topicId: topic.key, userStance: 'con', maxRounds: 6 }),
    })
  ).json();
  const id: string = created.debateId;
  console.log(`  辩题：${topic.title}`);

  const reports: RoundReport[] = [];
  reports.push(await runRound(call, `/api/debate/${id}/opening`, {}, '第 0 轮 · 柏拉图开场', !isReal));

  const userLines = [
    '你说得玄乎。我只要问一句：你讲的那个"理念"，我拿不出来给你看，你也拿不出来给我看。看不见摸不着的东西，凭什么说它比眼前这个真实？',
    '好，就算理念是真的。那也轮不到哲学家来统治——你看历史上那些念书人，有几个真的把国家管好了？让专业的人做专业的事不好吗？',
  ];
  for (const [i, text] of userLines.entries()) {
    console.log(`\n  【你】：${text}`);
    reports.push(
      await runRound(call, `/api/debate/${id}/turn`, { text }, `第 ${i + 1} 轮 · 柏拉图回应`, !isReal),
    );
  }

  for (const r of reports) printRound(r);

  const cjk = reports.map((r) => r.cjk);
  const avgCjk = cjk.reduce((a, b) => a + b, 0) / cjk.length;
  console.log('\n══ 汇总 ══');
  console.log(`  平均中文字符数：${avgCjk.toFixed(0)}（目标 150–200）`);
  console.log(
    `  ${env.LLM_PROVIDER === 'mock' ? '⚠ mock 文本为写死的占位内容，字数不代表真模型输出——仅用于验证链路与传输开销' : '真实模型实测值'}`,
  );

  if (env.LLM_PROVIDER === 'mock') {
    const overhead = reports[0]?.frameGapMs.avg ?? 0;
    console.log(`  传输层帧间隔（扣 mock sleep 后）：avg ${overhead.toFixed(1)}ms → SSE 编码与解析开销可忽略`);
    projectReal(175);
  }

  console.log('');
}

main().catch((err) => {
  console.error('节奏测量异常：', err);
  process.exit(1);
});
