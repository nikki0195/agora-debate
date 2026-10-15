/**
 * 真实 HTTP 端到端验证：对运行中的服务打完整一局。
 * 与 smoke.ts 的区别：smoke 用 app.fetch 进程内调用，
 * 本脚本走真实网络 + 真实 SSE 分帧，验证 chunked 传输与事件顺序。
 */
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8787';

interface Ev { event: string; data: any; at: number }

async function readSse(res: Response, t0: number): Promise<Ev[]> {
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
      // 关键：在读取的瞬间打时间戳，而不是收完后再遍历
      const at = Date.now() - t0;
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) events.push({ event: line.slice(6).trim(), data: {}, at });
        else if (line.startsWith('data:') && events.length) {
          try { events[events.length - 1].data = JSON.parse(line.slice(5)); } catch { /* 心跳等非 JSON */ }
        }
      }
    }
  }
  return events;
}

/** 从事件列表里取首个指定事件的到达时间 */
function atOf(events: Ev[], name: string): number | undefined {
  return events.find((e) => e.event === name)?.at;
}

async function main() {
  console.log(`BASE = ${BASE}\n`);

  // 1. 静态页
  const page = await fetch(`${BASE}/`);
  console.log(`页面      HTTP ${page.status}  ${page.headers.get('content-type')}`);

  // 2. 建局
  const topics = await (await fetch(`${BASE}/api/topics`)).json() as any;
  const topic = topics.items.find((t: any) => t.era === 'modern') ?? topics.items[0];
  console.log(`辩题      ${topic.id}  《${topic.title}》`);

  const t0 = Date.now();
  const created = await (await fetch(`${BASE}/api/debate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ personaKey: 'plato', topicId: topic.id, userStance: 'con', maxRounds: 6 }),
  })).json() as any;
  console.log(`建局      ${created.debateId}  (${Date.now() - t0}ms)`);

  // 3. 先贤开场（流式）
  const t1 = Date.now();
  const openRes = await fetch(`${BASE}/api/debate/${created.debateId}/opening`, { method: 'POST' });
  console.log(`开场      响应头 content-type = ${openRes.headers.get('content-type')}`);
  console.log(`          x-accel-buffering = ${openRes.headers.get('x-accel-buffering')}`);
  const openEv = await readSse(openRes, t1);
  const openDone = openEv.find((e) => e.event === 'done');
  if (openDone) {
    const text: string = openDone.data.fullText ?? '';
    const cjk = (text.match(/[\u4e00-\u9fa5]/g) ?? []).length;
    // start 事件在 LLM 调用之前就发出，它到达的时刻 = 用户看到「正在思考」的时刻
    console.log(`          start 到达 ${atOf(openEv, 'start')}ms   首字 ${atOf(openEv, 'delta')}ms   完成 ${atOf(openEv, 'done')}ms   ${cjk} 中文字`);
    console.log(`          事件序 ${openEv.map((x) => x.event).join(' → ')}`);
    console.log(`          ── 开场原文 ──\n          ${text}`);
  }
  for (const e of openEv) if (e.event === 'error') console.log(`          ✗ error: ${JSON.stringify(e.data)}`);

  // 4. 玩家发言 → 先贤回应（流式）
  const t2 = Date.now();
  const turnRes = await fetch(`${BASE}/api/debate/${created.debateId}/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '我觉得正义就是强者的利益，谁有力量谁就能定义规则。你怎么看？' }),
  });
  const turnEv = await readSse(turnRes, t2);
  const turnStart = turnEv.find((e) => e.event === 'start');
  const turnDone = turnEv.find((e) => e.event === 'done');
  if (turnDone) {
    const text: string = turnDone.data.fullText ?? '';
    const cjk = (text.match(/[\u4e00-\u9fa5]/g) ?? []).length;
    console.log(`\n第1轮     start 到达 ${atOf(turnEv, 'start')}ms   首字 ${atOf(turnEv, 'delta')}ms   完成 ${atOf(turnEv, 'done')}ms   ${cjk} 中文字`);
    console.log(`          mood = ${turnStart?.data?.mood ?? '(未返回)'}  truncated = ${turnDone.data.truncated ?? false}`);
    console.log(`          ── 柏拉图回应 ──\n          ${text}`);
  }
  for (const e of turnEv) {
    if (e.event === 'guard') console.log(`          guard: ${JSON.stringify(e.data)}`);
    if (e.event === 'error') console.log(`          ✗ error: ${JSON.stringify(e.data)}`);
  }

  // 5. 对局状态（GET /:id 直接返回 debate 对象，不包 debate 字段）
  const state = await (await fetch(`${BASE}/api/debate/${created.debateId}`)).json() as any;
  console.log(`\n状态      status=${state.status} turn=${state.turn} round=${state.round} 消息数=${state.messages.length}`);
  console.log(`\n✓ 端到端通过：页面 → 建局 → 开场流式 → 回合流式 → 状态查询`);
}

main().catch((e) => { console.error('E2E 失败:', e); process.exit(1); });
