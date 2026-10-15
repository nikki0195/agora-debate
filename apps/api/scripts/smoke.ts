/**
 * P0 冒烟：用 mock provider 跑通「建局 → 开场 → 多轮发言 → 压缩 → 裁判」全链路。
 * 运行：pnpm smoke（或 npm run smoke）
 */
import { loadEnv } from '../src/config/env.js';
import { createLlmClient, LlmRouter } from '../src/infra/llm/router.js';
import { MemoryDebateStore } from '../src/infra/store/memoryStore.js';
import { TurnRegistry } from '../src/infra/store/turnChannel.js';
import { IpRateLimiter } from '../src/infra/rateLimit.js';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';

let failures = 0;
function check(name: string, ok: boolean, extra = ''): void {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${extra ? '  → ' + extra : ''}`);
  if (!ok) failures += 1;
}

interface SseRecord {
  events: Array<{ event: string; data: any }>;
  text: string;
}

async function readSse(res: Response): Promise<SseRecord> {
  const events: Array<{ event: string; data: any }> = [];
  let text = '';
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() ?? '';
    for (const p of parts) {
      const ev = /^event:\s*(.+)$/m.exec(p);
      const dt = /^data:\s*(.+)$/m.exec(p);
      if (!ev || !dt) continue;
      const data = JSON.parse(dt[1]);
      events.push({ event: ev[1].trim(), data });
      if (ev[1].trim() === 'delta') text += data.delta;
      if (ev[1].trim() === 'done') text = data.fullText;
    }
  }
  return { events, text };
}

async function main(): Promise<void> {
  const env = loadEnv({
    LLM_PROVIDER: 'mock',
    RATE_LIMIT_PER_IP: '1000',
    // 让压缩尽早触发，验证压缩链路
    COMPRESS_AFTER_ROUNDS: '2',
    KEEP_RECENT_ROUNDS: '1',
  });

  const router = new LlmRouter(await createLlmClient(env), env);
  const ctx: AppContext = {
    env,
    router,
    store: new MemoryDebateStore(env.DEBATE_TTL_MS, env.MAX_ACTIVE_DEBATES),
    limiter: new IpRateLimiter(env.RATE_LIMIT_PER_IP),
    turns: new TurnRegistry(),
    policy: { compressAfterRounds: 2, keepRecentRounds: 1 },
    startedAt: Date.now(),
  };
  const app = buildApp(ctx);
  const call = (path: string, init?: RequestInit) => app.fetch(new Request(`http://local${path}`, init));

  console.log('\n── 基础接口 ──');
  const health: any = await (await call('/api/healthz')).json();
  check('健康检查 200', health.ok === true);
  check('标注单实例', health.deployment?.mode === 'single-instance', health.deployment?.stateStore);
  check('provider 为 mock', health.llm?.provider === 'mock');
  check('不泄露 API Key', !JSON.stringify(health).includes(env.LLM_API_KEY || '__nope__'));

  const cfgRes = await call('/agora.config.js');
  const cfgBody = await cfgRes.text();
  check('agora.config.js 可访问（拆分部署 BASE 注入）', cfgRes.status === 200 && cfgBody.includes('__AGORA_API_BASE__'), `status=${cfgRes.status}`);

  const topics: any = await (await call('/api/topics')).json();
  check('题库 20 道', topics.items.length === 20, String(topics.items.length));

  console.log('\n── 建局与开场 ──');
  const created: any = await (
    await call('/api/debate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personaKey: 'plato', topicId: topics.items[0].id, userStance: 'pro', maxRounds: 6 }),
    })
  ).json();
  check('建局返回 debateId', typeof created.debateId === 'string', created.debateId);
  const id: string = created.debateId;

  const opening = await readSse(await call(`/api/debate/${id}/opening`, { method: 'POST' }));
  check('开场有 start 事件', opening.events.some((e) => e.event === 'start'));
  check('开场有 delta 流', opening.events.filter((e) => e.event === 'delta').length > 3);
  check('开场有 done', opening.events.some((e) => e.event === 'done'));
  check('开场文本非空', opening.text.length > 20, `${opening.text.length} 字`);

  const empty = await call(`/api/debate/${id}/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '   ' }),
  });
  const emptyErr = (await readSse(empty)).events.find((e) => e.event === 'error')?.data?.code;
  check('空输入被拒', emptyErr === 'INPUT_EMPTY', String(emptyErr));

  console.log('\n── 多轮循环与压缩 ──');
  const lines = [
    '我认为正义就是强者把自己的利益写进法律。',
    '你说的理念我看不见摸不着，怎么能说它更真实？',
    '按你这么说，我们日常的判断全都是错的？',
    '你说得对，我确实没定义清楚正义本身。',
    '无聊，你一直在绕圈子，根本没有正面回答。',
    '最后一句：那我们该怎么开始认识理念？',
  ];
  let sawDigest = false;
  const moods = new Set<string>();
  for (const [i, text] of lines.entries()) {
    const rec = await readSse(
      await call(`/api/debate/${id}/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      }),
    );
    const start = rec.events.find((e) => e.event === 'start');
    if (start) moods.add(start.data.mood);
    if (rec.events.some((e) => e.event === 'digest')) sawDigest = true;
    check(`第 ${i + 1} 轮拿到回复`, rec.text.length > 20, `${rec.text.length} 字 / mood=${start?.data.mood}`);
    check(`第 ${i + 1} 轮未触发短文本兜底`, !rec.events.some((e) => e.event === 'done' && e.data.short));
  }
  check('触发了上下文压缩', sawDigest);
  check('情绪分类生效（出现多种）', moods.size >= 2, [...moods].join(','));

  console.log('\n── 状态机边界 ──');
  const state: any = await (await call(`/api/debate/${id}`)).json();
  check('状态推进到 judging', state.status === 'judging', `${state.status} round=${state.round}`);

  const exhausted = await readSse(
    await call(`/api/debate/${id}/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '再来一轮' }),
    }),
  );
  check(
    '回合耗尽后拒绝发言',
    exhausted.events.some((e) => e.event === 'error' && e.data.code === 'ROUND_EXHAUSTED'),
    exhausted.events.find((e) => e.event === 'error')?.data?.code ?? '(无)',
  );

  const notFound = await call('/api/debate/nope/turn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '你好' }),
  });
  const nfErr = (await readSse(notFound)).events.find((e) => e.event === 'error')?.data?.code;
  check('未知对局返回 DEBATE_NOT_FOUND', nfErr === 'DEBATE_NOT_FOUND', String(nfErr));

  console.log('\n── 并发保护 ──');
  const d2: any = await (
    await call('/api/debate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personaKey: 'plato', topicId: topics.items[1].id, userStance: 'con', maxRounds: 6 }),
    })
  ).json();
  const [a, b] = await Promise.all([
    readSse(await call(`/api/debate/${d2.debateId}/turn`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '第一句' }),
    })),
    readSse(await call(`/api/debate/${d2.debateId}/turn`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '插一句' }),
    })),
  ]);
  const blocked = [...a.events, ...b.events].find((e) => e.event === 'error')?.data?.code;
  check('并发发言被拒（NOT_YOUR_TURN）', blocked === 'NOT_YOUR_TURN', String(blocked));

  console.log('\n── 裁判 ──');
  const judge = await readSse(await call(`/api/debate/${id}/judge`, { method: 'POST' }));
  const done = judge.events.find((e) => e.event === 'judge_done');
  check('裁判返回 judge_done', !!done);
  check('点评不含胜负字段', done ? !('winner' in done.data.verdict) : false);
  check('点评含五维评分', done ? Object.keys(done.data.verdict.scores ?? {}).length === 5 : false);
  const after: any = await (await call(`/api/debate/${id}`)).json();
  check('对局标记为 done', after.status === 'done', after.status);

  console.log('\n── 额度与清理 ──');
  const h2: any = await (await call('/api/healthz')).json();
  check('额度计数已累加', h2.quota.tokensToday > 0, String(h2.quota.tokensToday));
  check('活跃对局统计正确', h2.debates.active >= 1, String(h2.debates.active));
  const del = await call(`/api/debate/${id}`, { method: 'DELETE' });
  check('删除对局 200', del.status === 200);

  console.log(`\n${failures === 0 ? '全部通过' : failures + ' 项失败'}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('冒烟脚本异常：', err);
  process.exit(1);
});
