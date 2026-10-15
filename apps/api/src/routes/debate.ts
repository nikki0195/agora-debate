import { Hono } from 'hono';
import { z } from 'zod';
import type { HonoVars, AppContext } from '../context.js';
import { DebateAggregate, newId } from '../domain/Debate.js';
import { assertInput, assertRounds, LIMITS } from '../domain/RoundPolicy.js';
import { classifyMood } from '../domain/MoodClassifier.js';
import { buildJudgeMessages, buildSageMessages, type PersonaCard } from '../domain/PromptBuilder.js';
import { checkIdentity, fallbackText } from '../domain/IdentityGuard.js';
import { ContextCompressor, extractJson } from '../domain/ContextCompressor.js';
import { fitLength, isTooShort } from '../domain/LengthFit.js';
import { estimateTokens } from '../infra/llm/openaiCompat.js';
import { sseResponse, type SseEmitter } from '../infra/sse.js';
import type { TurnChannel } from '../infra/store/turnChannel.js';
import { PERSONAS } from '../personas/index.js';
import { findTopic } from '../data/topics.js';
import { ApiError } from '../types.js';

const createSchema = z.object({
  personaKey: z.string().default('plato'),
  topicId: z.string().min(1),
  userStance: z.enum(['pro', 'con']).default('pro'),
  maxRounds: z.coerce.number().int().min(LIMITS.MIN_ROUNDS).max(LIMITS.MAX_ROUNDS).default(6),
});

const turnSchema = z.object({ text: z.string().default('') });

/** 长度重试的独立预算：身份重试用尽 attempt 后，仍保留一次重写短文本的机会 */
const SHORT_RETRY_BUDGET = 1;

function clientIp(c: { req: { header(name: string): string | undefined } }): string {
  return (
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

function guardRate(ctx: AppContext, ip: string): void {
  ctx.limiter.sweep();
  if (!ctx.limiter.hit(ip)) throw new ApiError('RATE_LIMITED', 429);
}

type TurnKind = 'opening' | 'reply';

interface TurnInput {
  kind: TurnKind;
  text?: string;
  resumeSeq?: number;
}

async function runSageTurn(
  emit: SseEmitter,
  ctx: AppContext,
  debateId: string,
  input: TurnInput,
): Promise<void> {
  const raw = ctx.store.get(debateId);
  if (!raw) throw new ApiError('DEBATE_NOT_FOUND', 404);

  const persona: PersonaCard | undefined = PERSONAS[raw.personaKey];
  const topic = findTopic(raw.topicId);
  if (!persona) throw new ApiError('PERSONA_NOT_FOUND', 404);
  if (!topic) throw new ApiError('TOPIC_NOT_FOUND', 404);

  const agg = DebateAggregate.from(raw);
  const turnKey = ctx.turns.key(debateId, agg.peekNextSeq());
  const resumeChannel = input.resumeSeq !== undefined ? ctx.turns.get(turnKey) : undefined;

  // 续传：直接接上正在跑的那一轮，不重复追加玩家发言
  if (resumeChannel) {
    await pipeChannel(emit, ctx, resumeChannel, debateId, agg.peekNextSeq());
    return;
  }

  let mood = classifyMood(input.text ?? '');
  if (input.kind === 'opening') {
    agg.assertCanOpen();
    agg.markGenerating();
    mood = 'calm';
  } else {
    agg.assertCanUserSpeak();
    agg.appendUser(assertInput(input.text ?? ''));
  }
  ctx.store.update(debateId, agg.data);

  const seq = agg.peekNextSeq();
  const messageId = newId('msg');
  const channel = ctx.turns.create(turnKey);

  // 上下文压缩：必须在拼装 Prompt 之前做，否则这一轮白压
  if (agg.needsCompress(ctx.policy)) {
    try {
      const digest = await new ContextCompressor(ctx.router).compress(
        agg.data,
        topic,
        ctx.policy.keepRecentRounds,
        undefined,
        persona.key,
      );
      if (digest) {
        agg.applyDigest(digest);
        ctx.store.update(debateId, agg.data);
        emit.send('digest', { contextDigest: digest });
      }
    } catch {
      // 压缩失败不阻断本轮：宁可多花 token，也不能让对局卡住
    }
  }

  const messages = buildSageMessages({
    persona,
    topic,
    userStance: agg.data.userStance,
    personaStance: agg.data.personaStance,
    round: agg.data.round,
    maxRounds: agg.data.maxRounds,
    mood,
    history: agg.data.messages,
    digest: agg.data.contextDigest,
    keepRecentRounds: ctx.policy.keepRecentRounds,
  });

  emit.send(
    'start',
    { messageId, seq, round: agg.data.round, mood, personaKey: persona.key },
    seq,
  );

  let content = '';
  const turnStartedAt = Date.now();
  let latencyMs: number | undefined;
  let index = 0;
  let regenerateCount = 0;
  let shortRetried = false;
  let fitted: { text: string; truncated: boolean } | undefined;

  // attempt 预算 = 身份重试上限 + 1 次独立的长度重试额度。
  // 不能共享：实测老子开场 68 字——身份破防（时代回响句）用尽 attempt 后，
  // 长度兜底被饿死，半句话直接端上课堂。GLM-4-Flash 免费，多一次生成约 3 秒，值。
  const maxAttempt = persona.identityGuard.maxRegenerate + 1 + SHORT_RETRY_BUDGET;

  for (let attempt = 0; attempt <= maxAttempt; attempt++) {
    channel.reset();
    content = '';
    index = 0;
    const isRetry = attempt > 0;
    let firstDelta = true;

    for await (const delta of ctx.router.stream({
      tier: persona.tier,
      purpose: 'sage',
      messages,
      temperature: persona.sampling.temperature,
      maxTokens: persona.sampling.maxTokens,
      personaKey: persona.key,
      // 故意不传 signal：客户端断开时生成要继续跑完，才能支持续传
    })) {
      if (latencyMs === undefined) latencyMs = Date.now() - turnStartedAt;
      content += delta;
      channel.push(delta);
      // 重试的首帧必须整段替换：否则前端会把上一轮输出和这一轮拼在一起
      // （只有 done 的 fullText 会覆盖，流式中间态是脏的）。fallback 路径同理。
      emit.send(
        'delta',
        { i: index++, delta, ...(isRetry && firstDelta ? { replaced: true } : {}) },
        seq,
      );
      firstDelta = false;
    }

    const guard = checkIdentity(persona, content, regenerateCount);

    if (guard.action === 'pass') {
      // 长度兜底：max_tokens 对中文几乎无效，prompt 的「150–200 字」也偶发失守
      // （实测开场掉到过 68 字）。截断后仍不足 MIN_CJK → 花掉独立的长度额度
      // 重新生成；额度耗尽就接受，打 short 标记交给前端弱提示。
      fitted = fitLength(content);
      if (!isTooShort(fitted.text) || shortRetried) break;
      shortRetried = true;
      emit.send('guard', { action: 'regenerate', reason: '回复过短，先贤重新组织语言' });
      continue;
    }

    regenerateCount = guard.regenerateCount;
    emit.send('guard', { action: guard.action, reason: guard.breaches.join('、') });
    if (guard.action === 'regenerate') continue;

    // 兜底话术是写死的人设声明，短是设计使然，不再做长度重试
    content = fallbackText(persona);
    channel.reset();
    channel.push(content);
    emit.send('delta', { i: 0, delta: content, replaced: true }, seq);
    fitted = fitLength(content);
    break;
  }

  channel.finish();

  // 软截断：max_tokens 会在中途硬截，产出「以下是一个可能的方案：\n\n1.」这种断句
  const finalText = fitted?.text ?? content;

  const msg = agg.finishSage(finalText, {
    tokens: estimateTokens(finalText),
    mood,
    latencyMs,
    id: messageId,
  });
  ctx.store.update(debateId, agg.data);

  emit.send(
    'done',
    {
      messageId: msg.id,
      seq: msg.seq,
      round: msg.round,
      fullText: finalText,
      tokens: msg.tokens,
      firstTokenLatencyMs: msg.firstTokenLatencyMs,
      ...(fitted?.truncated ? { truncated: true } : {}),
      ...(isTooShort(finalText) ? { short: true } : {}),
    },
    msg.seq,
  );

  emit.send('round_end', {
    round: agg.data.round,
    nextTurn: agg.data.status === 'judging' ? 'judge' : 'user',
  });
}

/** 续传：先补发已有内容，再继续接收剩余 */
async function pipeChannel(
  emit: SseEmitter,
  ctx: AppContext,
  ch: TurnChannel,
  debateId: string,
  seq: number,
): Promise<void> {
  emit.send('start', { messageId: 'resume', seq, resumed: true }, seq);

  let index = 0;
  if (ch.text) emit.send('delta', { i: index++, delta: ch.text, resume: true }, seq);

  await new Promise<void>((resolve) => {
    const offDelta = ch.onDelta((delta) => emit.send('delta', { i: index++, delta }, seq));
    const offDone = ch.onDone(() => {
      offDelta();
      offDone();
      resolve();
    });
    if (ch.done) {
      offDelta();
      offDone();
      resolve();
    }
  });

  const fresh = ctx.store.get(debateId);
  const last = fresh?.messages.at(-1);
  if (last && last.role === 'sage' && last.seq === seq) {
    emit.send('done', { messageId: last.id, seq, round: last.round, fullText: last.content, tokens: last.tokens }, seq);
    emit.send('round_end', { round: fresh?.round ?? 1, nextTurn: fresh?.status === 'judging' ? 'judge' : 'user' });
  }
}

export const debateRoutes = new Hono<HonoVars>()
  .post('/debate', async (c) => {
    const ctx = c.var.ctx;
    guardRate(ctx, clientIp(c));

    const parsed = createSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'BAD_REQUEST', detail: parsed.error.flatten() }, 400);

    const { personaKey, topicId, userStance, maxRounds } = parsed.data;
    assertRounds(maxRounds);
    if (!PERSONAS[personaKey]) return c.json({ error: 'PERSONA_NOT_FOUND' }, 404);
    if (!findTopic(topicId)) return c.json({ error: 'TOPIC_NOT_FOUND' }, 404);

    const agg = DebateAggregate.create({ personaKey, topicId, userStance, maxRounds });
    ctx.store.create(agg.data);

    return c.json({ debateId: agg.id, debate: agg.data }, 201);
  })

  .get('/debate/:id', (c) => {
    const d = c.var.ctx.store.get(c.req.param('id'));
    if (!d) return c.json({ error: 'DEBATE_NOT_FOUND' }, 404);
    return c.json(d);
  })

  .delete('/debate/:id', (c) => {
    const ctx = c.var.ctx;
    const id = c.req.param('id');
    const d = ctx.store.get(id);
    if (!d) return c.json({ error: 'DEBATE_NOT_FOUND' }, 404);
    const agg = DebateAggregate.from(d);
    agg.abort();
    ctx.store.delete(id);
    return c.json({ ok: true });
  })

  .post('/debate/:id/opening', (c) => {
    const ctx = c.var.ctx;
    const id = c.req.param('id');
    guardRate(ctx, clientIp(c));
    const resumeSeq = parseResumeSeq(c.req.header('x-resume-seq'));
    return sseResponse((emit) => runSageTurn(emit, ctx, id, { kind: 'opening', resumeSeq }), c.req.raw.signal);
  })

  .post('/debate/:id/turn', async (c) => {
    const ctx = c.var.ctx;
    const id = c.req.param('id');
    guardRate(ctx, clientIp(c));

    const parsed = turnSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'BAD_REQUEST' }, 400);

    const resumeSeq = parseResumeSeq(c.req.header('x-resume-seq'));
    return sseResponse(
      (emit) => runSageTurn(emit, ctx, id, { kind: 'reply', text: parsed.data.text, resumeSeq }),
      c.req.raw.signal,
    );
  })

  .post('/debate/:id/judge', (c) => {
    const ctx = c.var.ctx;
    const id = c.req.param('id');
    guardRate(ctx, clientIp(c));

    return sseResponse(async (emit) => {
      const raw = ctx.store.get(id);
      if (!raw) throw new ApiError('DEBATE_NOT_FOUND', 404);
      const topic = findTopic(raw.topicId);
      const persona = PERSONAS[raw.personaKey];
      if (!topic || !persona) throw new ApiError('TOPIC_NOT_FOUND', 404);

      const agg = DebateAggregate.from(raw);
      agg.assertCanJudge();
      ctx.store.update(id, { ...agg.data, status: 'judging', turn: 'awaiting_judge' });

      emit.send('judge_start', { debateId: id });

      let text = '';
      for await (const delta of ctx.router.stream({
        tier: 'strong',
        purpose: 'judge',
        responseFormat: 'json',
        temperature: 0.3,
        maxTokens: 800,
        personaKey: persona.key,
        messages: buildJudgeMessages({
          history: agg.data.messages,
          topic,
          personaName: persona.name,
        }),
      })) {
        text += delta;
        emit.send('judge_chunk', { delta });
      }

      const parsed = extractJson(text) as Record<string, unknown> | undefined;
      const verdict = parsed ?? {
        scores: {},
        userHighlights: [],
        personaHighlights: [],
        suggestions: ['点评生成失败，可稍后重试。'],
        summary: text.slice(0, 300),
      };

      const fresh = DebateAggregate.from(ctx.store.get(id) ?? agg.data);
      const judgeMsg = {
        id: newId('msg'),
        seq: fresh.data.seq + 1,
        round: fresh.data.round,
        role: 'judge' as const,
        content: JSON.stringify(verdict),
        compressed: false,
        tokens: estimateTokens(text),
        createdAt: Date.now(),
      };
      const next: typeof fresh.data = {
        ...fresh.data,
        messages: [...fresh.data.messages, judgeMsg],
        seq: judgeMsg.seq,
        status: 'done',
        turn: 'awaiting_user',
        totalTokens: fresh.data.totalTokens + judgeMsg.tokens,
        updatedAt: Date.now(),
      };
      ctx.store.update(id, next);

      emit.send('judge_done', { verdict }, judgeMsg.seq);
      emit.send('round_end', { round: next.round, nextTurn: 'judge' });
    }, c.req.raw.signal);
  });

function parseResumeSeq(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
