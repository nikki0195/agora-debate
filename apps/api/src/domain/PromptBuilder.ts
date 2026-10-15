import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ContextDigest, Message, Mood, Stance, Topic } from '../types.js';
import type { LlmMessage } from '../infra/llm/types.js';

export interface PersonaCard {
  key: string;
  name: string;
  tagline: string;
  identityGuard: {
    invariants: string[];
    restateEveryRound: boolean;
    /** 字面片段，命中即破防 */
    breachPatterns: string[];
    /**
     * 正则片段。字面模式挡不住同义改写——
     * 实测 GLM-4-Flash 会说「我是由人类智慧所创造的语言模型」，
     * 绕过了『我是人工智能』『作为语言模型』等全部字面模式。
     * 正则按「自称」的语义结构匹配，而不是匹配关键词。
     */
    breachRegex?: string[];
    fallbackUtterance: string;
    maxRegenerate: number;
  };
  sampling: { temperature: number; maxTokens: number };
  tier: 'strong' | 'fast' | 'cheap';
  /** 展示元数据：只服务于前端大厅/分享卡，不参与 Prompt 组装 */
  display: {
    era: string;
    oneLiner: string;
    accent: string;
    glyph: string;
  };
}

const promptCache = new Map<string, string>();

/** 从 apps/api/prompts/<key>.system.md 读取人格 prompt（进程内缓存） */
export function loadPersonaPrompt(key: string): string {
  const cached = promptCache.get(key);
  if (cached) return cached;

  const file = path.resolve(process.cwd(), 'prompts', `${key}.system.md`);
  const text = readFileSync(file, 'utf8');
  promptCache.set(key, text);
  return text;
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, name: string) => {
    const v = vars[name];
    return v === undefined ? whole : v;
  });
}

function digestBlock(digest: ContextDigest | undefined): string {
  if (!digest) return '';
  const lines = [
    '【此前对话摘要】',
    `对方立场：${digest.personaPosition}`,
    `你的立场推进：${digest.userPosition}`,
    digest.conceded.length ? `已被认可：${digest.conceded.join('；')}` : '',
    digest.refuted.length ? `已被驳倒：${digest.refuted.join('；')}` : '',
    digest.openThreads.length ? `悬而未决：${digest.openThreads.join('；')}` : '',
  ].filter(Boolean);
  return `${lines.join('\n')}\n`;
}

export interface SagePromptInput {
  persona: PersonaCard;
  topic: Topic;
  userStance: Stance;
  personaStance: Stance;
  round: number;
  maxRounds: number;
  mood: Mood;
  history: Message[];
  digest?: ContextDigest;
  keepRecentRounds: number;
}

/**
 * 组装先贤的 messages[]。
 * 结构：静态人格层（全量） → 人设重申（防长上下文漂移） → 辩题与立场 → 摘要 → 最近 N 轮全文 → 当前输入
 */
export function buildSageMessages(input: SagePromptInput): LlmMessage[] {
  const { persona, topic, userStance, personaStance } = input;

  const personaText = fill(loadPersonaPrompt(persona.key), {
    topic_title: topic.title,
    topic_background: topic.background ?? '（无额外背景）',
    sage_stance_text: personaStance === 'pro' ? topic.stanceHints.pro : topic.stanceHints.con,
    user_stance_text: userStance === 'pro' ? topic.stanceHints.pro : topic.stanceHints.con,
    stance: personaStance === 'pro' ? '正方' : '反方',
    round: String(input.round),
    max_rounds: String(input.maxRounds),
    context_digest_block: digestBlock(input.digest),
    mood: input.mood,
  });

  const messages: LlmMessage[] = [{ role: 'system', content: personaText }];

  // 每轮重申核心不变量：长对话中最有效的防漂移手段
  if (persona.identityGuard.restateEveryRound) {
    messages.push({
      role: 'system',
      content: `【重申】${persona.identityGuard.invariants.join('；')}。`,
    });
  }

  // 对话纪律：玩家会离题、反问、否认前提（实测演示时有玩家回「我没有给你例子啊」）。
  // 若先贤无视这句话，只会把先前的论述换个说法再讲一遍——观感就是「重复发言」。
  // 这条规则与人格无关，五份人格文件各自维护自己的声音，不重复写；
  // 开场时还没有玩家发言可接，故仅在有历史后注入。
  if (input.history.length > 0) {
    messages.push({
      role: 'system',
      content: [
        '【对话纪律】',
        '1. 永远先接住玩家最后一句发言：用一句话回应它——肯定其中真实的部分，或温和地指出它离题、记错了，再回到辩题。',
        '2. 不无视玩家的话重复先前的论述；不追逐玩家抛开的离题话题。',
        '3. 若玩家否认你说过的话（如「我没有给过例子」），先澄清事实，再继续你的论证主线。',
        '4. 以上不得违背你的人格与口吻。',
      ].join('\n'),
    });
  }

  // 最近 N 轮全文（compressed 的条目已由 digest 代表，不重复进 Prompt）
  const recent = input.history.filter((m) => !m.compressed).slice(-input.keepRecentRounds * 2);
  for (const m of recent) {
    messages.push({
      role: m.role === 'sage' ? 'assistant' : 'user',
      content: m.content,
    });
  }

  // 开场时 history 为空，messages 会以 system 结尾。
  // 智谱 GLM 对此直接报 400/1214（OpenAI 与 DeepSeek 却允许）——补一条 user 引导，
  // 既满足结构约束，也给模型一个明确的「该你开口了」信号。
  // 这条不写入 store，不会污染后续轮次的 history。
  // 顺带把字数要求写进引导语：实测 system prompt 里的「150–200 字硬约束」
  // 对开场约束不足（6 次采样均值 127 字），user 层再补一道。
  if (recent.length === 0) {
    messages.push({
      role: 'user',
      content: '请你先开口。用一百五十到二百字，谈谈你对这个辩题的开场。',
    });
  }

  return messages;
}

export interface JudgePromptInput {
  history: Message[];
  topic: Topic;
  personaName: string;
}

export function buildJudgeMessages(input: JudgePromptInput): LlmMessage[] {
  const transcript = input.history
    .map((m) => {
      const who = m.role === 'user' ? '来访者' : `${input.personaName}（AI）`;
      return `第${m.round}轮 ${who}：${m.content}`;
    })
    .join('\n\n');

  return [
    { role: 'system', content: loadPersonaPrompt('judge') },
    {
      role: 'user',
      content: `辩题：${input.topic.title}\n\n【对局记录】\n${transcript}\n\n请按系统要求输出 JSON 点评。`,
    },
  ];
}

export interface CompressPromptInput {
  history: Message[];
  topic: Topic;
}

export function buildCompressMessages(input: CompressPromptInput): LlmMessage[] {
  const transcript = input.history
    .map((m) => `${m.role === 'user' ? '来访者' : '先贤'}：${m.content}`)
    .join('\n');
  return [
    {
      role: 'system',
      content:
        '你是对话摘要器。只输出 JSON，不要任何解释文字。字段：userPosition、personaPosition（各 ≤80 字）、conceded、refuted、openThreads（字符串数组）。',
    },
    { role: 'user', content: `辩题：${input.topic.title}\n\n对话：\n${transcript}` },
  ];
}
