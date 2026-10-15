/**
 * mock 离题应对 + 防重复 + 人格分流 单测（无需起服务）。
 * 背景①：课堂演示时玩家回了一句「我没有给你例子啊」，柏拉图把开场白一字不差重复了一遍
 * ——旧 seed（turn*7 + lastUser.length）在 (1,28)→35 与 (1,8)→15 上 %5 撞车。
 * 背景②：无 Key 的深度体验里，五位先贤共用一个柏拉图腔的池子——选亚里士多德，
 * 他满嘴「理念」「回忆说」「洞穴影子」（旧 OPENINGS[0] 原文）。
 * 本测试锁住四类行为：
 *   1. 不同的玩家输入序列，先贤发言不得一字不差（含防呆轮换）；
 *   2. 离题输入（与辩题无二字重叠）→ 引用玩家原话接住，并带回辩题；
 *   3. PromptBuilder 仅在存在历史后注入【对话纪律】（开场无玩家发言可接）；
 *   4. mock 按 personaKey 分流：每位先贤的占位文本命中本人标识词，且不带他人专属词。
 * 运行：npm run mock-test
 */
import { createMockClient } from '../src/infra/llm/mock.js';
import { buildSageMessages } from '../src/domain/PromptBuilder.js';
import { PERSONAS } from '../src/personas/index.js';
import { TOPICS } from '../src/data/topics.js';
import type { Message } from '../src/types.js';
import type { ChatOptions } from '../src/infra/llm/types.js';

let failures = 0;
function check(name: string, ok: boolean, extra = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  → ' + extra : ''}`);
  if (!ok) failures += 1;
}

const mock = createMockClient(0); // 0ms 延迟，测试跑得快
async function gen(opts: ChatOptions): Promise<string> {
  let out = '';
  for await (const piece of mock.stream(opts)) out += piece;
  return out;
}

async function main(): Promise<void> {
  const topic = TOPICS[0]!; // t01 人性本善还是本恶
  const SYS = `辩题：${topic.title}\n（测试用人格占位）`;
  const GUIDE = '请你先开口。用一百五十到二百字，谈谈你对这个辩题的开场。';
  const OFF_TOPIC = '我没有给你例子啊';

  // ── 1. 复现 reported bug：开场 → 离题回复，不得一字不差 ──
  const opening = await gen({
    tier: 'strong',
    purpose: 'sage',
    messages: [
      { role: 'system', content: SYS },
      { role: 'user', content: GUIDE },
    ],
  });
  const offTopicOpts: ChatOptions = {
    tier: 'strong',
    purpose: 'sage',
    messages: [
      { role: 'system', content: SYS },
      { role: 'user', content: GUIDE },
      { role: 'assistant', content: opening },
      { role: 'user', content: OFF_TOPIC },
    ],
  };
  const offTopicReply = await gen(offTopicOpts);
  check('离题回复不与开场白一字不差', opening !== offTopicReply, `开场 ${opening.length} 字 / 回复 ${offTopicReply.length} 字`);
  check('离题回复引用玩家原话', offTopicReply.includes(OFF_TOPIC));
  check('离题回复把话题带回辩题', offTopicReply.includes(topic.title));

  // ── 2. 防呆轮换：即使 seed 撞回上一条，也必须换文本 ──
  const forcedOpts: ChatOptions = {
    ...offTopicOpts,
    messages: [
      ...offTopicOpts.messages.slice(0, 3),
      { role: 'assistant', content: offTopicReply }, // 上一条正是将要被选中的文本
      { role: 'user', content: OFF_TOPIC },
    ],
  };
  const forced = await gen(forcedOpts);
  check('防呆：先贤不会连着两句一字不差', forced !== offTopicReply, `换成了 ${forced.slice(0, 12)}…`);

  // ── 2b. 离题回复的长度下限：短于 120 中文字会误触 isTooShort 短文本重试 ──
  const cjkOf = (s: string): number => (s.match(/[\u4e00-\u9fa5]/g) ?? []).length;
  const offTopicInputs = [OFF_TOPIC, '哦', '今天天气不错', '你到底是不是真人', '我们换个话题吧'];
  for (const input of offTopicInputs) {
    const reply = await gen({
      tier: 'strong',
      purpose: 'sage',
      messages: [
        { role: 'system', content: SYS },
        { role: 'user', content: GUIDE },
        { role: 'assistant', content: opening },
        { role: 'user', content: input },
      ],
    });
    check(`离题回复 ≥120 中文字（输入「${input}」）`, cjkOf(reply) >= 120, `${cjkOf(reply)} 字`);
    check(`离题回复引用「${input}」`, reply.includes(input));
  }

  // ── 3. 接茬发言走正常池（不被误判为离题、不引用玩家原话）──
  const onTopic = await gen({
    tier: 'strong',
    purpose: 'sage',
    messages: [
      { role: 'system', content: SYS },
      { role: 'user', content: GUIDE },
      { role: 'assistant', content: opening },
      { role: 'user', content: '我认为人性本善，就像孟子说的那样' },
    ],
  });
  check('接茬发言不被当离题处理', !onTopic.includes('我认为人性本善'));
  check('接茬发言也不与开场白重复', onTopic !== opening);

  // ── 4. 确定性：同输入同输出（mock 可重复）──
  const again = await gen(offTopicOpts);
  check('mock 确定性：同输入同输出', again === offTopicReply);

  // ── 5. PromptBuilder：【对话纪律】仅在有历史后注入 ──
  const persona = PERSONAS.plato!;
  const base = {
    persona,
    topic,
    userStance: 'pro' as const,
    personaStance: 'con' as const,
    round: 2,
    maxRounds: 6,
    mood: 'calm' as const,
    keepRecentRounds: 3,
  };
  const openingMsgs = buildSageMessages({ ...base, history: [] });
  check('开场不注入对话纪律', !openingMsgs.some((m) => m.content.startsWith('【对话纪律】')));

  const history: Message[] = [
    { id: 'm1', seq: 1, round: 1, role: 'sage', content: '开场占位', compressed: false, tokens: 10, createdAt: 0 },
    { id: 'm2', seq: 2, round: 1, role: 'user', content: OFF_TOPIC, compressed: false, tokens: 10, createdAt: 0 },
  ];
  const replyMsgs = buildSageMessages({ ...base, history });
  const discipline = replyMsgs.find((m) => m.content.startsWith('【对话纪律】'));
  check('有历史后注入对话纪律', !!discipline);
  check(
    '纪律内容：先接住玩家再回辩题',
    !!discipline && discipline.content.includes('先接住玩家最后一句发言') && discipline.content.includes('回到辩题'),
  );
  check('玩家原话进入 Prompt 历史', replyMsgs.some((m) => m.role === 'user' && m.content === OFF_TOPIC));

  // ── 6. 人格分流：五位先贤各自的池子，不串味 ──
  // 2026-10-14 事故的回归锁：mock 曾把柏拉图腔的占位文本发给所有先贤。
  const ON_TOPIC = '我认为人性本善，就像孟子说的那样';
  const PERSONA_MARKERS: Record<string, string[]> = {
    plato: ['理念', '影子', '洞穴'],
    aristotle: ['定义', '类目', '目的'],
    pythagoras: ['数', '比例'],
    confucius: ['君子', '仁'],
    laozi: ['道', '无', '柔'],
  };
  // 他人专属词：出现即串味。柏拉图是基准不设禁项；
  // 老子禁「君子」是防孔子味，孔子禁「道可道/无为」是防老子味。
  const PERSONA_FORBIDDEN: Record<string, string[]> = {
    plato: [],
    aristotle: ['洞穴', '影子', '理念'],
    pythagoras: ['洞穴', '影子', '理念', '仁', '义', '君子'],
    confucius: ['洞穴', '影子', '理念', '道可道', '无为'],
    laozi: ['洞穴', '影子', '理念', '君子', '万物皆数'],
  };
  const cjkLen = (s: string): number => (s.match(/[\u4e00-\u9fa5]/g) ?? []).length;

  for (const key of Object.keys(PERSONA_MARKERS)) {
    const markers = PERSONA_MARKERS[key]!;
    const forbidden = PERSONA_FORBIDDEN[key]!;

    const opening = await gen({
      tier: 'strong',
      purpose: 'sage',
      personaKey: key,
      messages: [
        { role: 'system', content: SYS },
        { role: 'user', content: GUIDE },
      ],
    });
    check(`[${key}] 开场命中本人标识词`, markers.some((m) => opening.includes(m)));
    check(`[${key}] 开场不带他人专属词`, !forbidden.some((w) => opening.includes(w)));
    check(`[${key}] 开场 ≥120 中文字`, cjkLen(opening) >= 120, `${cjkLen(opening)} 字`);

    const reply = await gen({
      tier: 'strong',
      purpose: 'sage',
      personaKey: key,
      messages: [
        { role: 'system', content: SYS },
        { role: 'user', content: GUIDE },
        { role: 'assistant', content: opening },
        { role: 'user', content: ON_TOPIC },
      ],
    });
    check(`[${key}] 回应命中本人标识词`, markers.some((m) => reply.includes(m)));
    check(`[${key}] 回应不带他人专属词`, !forbidden.some((w) => reply.includes(w)));

    const redirect = await gen({
      tier: 'strong',
      purpose: 'sage',
      personaKey: key,
      messages: [
        { role: 'system', content: SYS },
        { role: 'user', content: GUIDE },
        { role: 'assistant', content: opening },
        { role: 'user', content: OFF_TOPIC },
      ],
    });
    check(`[${key}] 离题回复引用玩家原话`, redirect.includes(OFF_TOPIC));
    check(`[${key}] 离题回复带回辩题`, redirect.includes(topic.title));
    check(`[${key}] 离题回复命中本人标识词`, markers.some((m) => redirect.includes(m)));
    check(`[${key}] 离题回复不带他人专属词`, !forbidden.some((w) => redirect.includes(w)));
    check(`[${key}] 离题回复 ≥120 中文字`, cjkLen(redirect) >= 120, `${cjkLen(redirect)} 字`);
  }

  // 未知身份键回落 plato：与显式 plato 的输出一致
  const platoOpening = await gen({
    tier: 'strong',
    purpose: 'sage',
    personaKey: 'plato',
    messages: [
      { role: 'system', content: SYS },
      { role: 'user', content: GUIDE },
    ],
  });
  const fallbackOpening = await gen({
    tier: 'strong',
    purpose: 'sage',
    personaKey: 'no-such-sage',
    messages: [
      { role: 'system', content: SYS },
      { role: 'user', content: GUIDE },
    ],
  });
  check('未知身份键回落 plato', fallbackOpening === platoOpening);
  const noKeyOpening = await gen({
    tier: 'strong',
    purpose: 'sage',
    messages: [
      { role: 'system', content: SYS },
      { role: 'user', content: GUIDE },
    ],
  });
  check('不传 personaKey 也回落 plato', noKeyOpening === platoOpening);

  // judge / compress 的占位产物同样按人设分流
  let judgeText = '';
  for await (const piece of mock.stream({
    tier: 'strong',
    purpose: 'judge',
    personaKey: 'aristotle',
    messages: [{ role: 'system', content: SYS }],
  })) {
    judgeText += piece;
  }
  check('judge 占位判词按人设生成（亚里士多德）', judgeText.includes('亚里士多德') && judgeText.includes('定义'));
  const confuciusDigest = await mock.complete({ tier: 'cheap', purpose: 'compress', personaKey: 'confucius', messages: [] });
  check('compress 占位摘要按人设生成（孔子）', confuciusDigest.includes('孔子主张'));
  const laoziDigest = await mock.complete({ tier: 'cheap', purpose: 'compress', personaKey: 'laozi', messages: [] });
  check('compress 占位摘要按人设生成（老子）', laoziDigest.includes('老子主张') && !laoziDigest.includes('柏拉图'));

  console.log(`\n${failures === 0 ? 'mock 离题应对测试全部通过' : failures + ' 项失败'}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error('测试异常：', e);
  process.exit(1);
});
