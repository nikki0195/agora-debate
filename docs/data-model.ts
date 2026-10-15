/**
 * Agora · 数据模型契约 v0.2（H5 版）
 *
 * 这是「契约文件」，不是业务代码。
 * 落地时：packages/shared/src/types.ts（类型与协议）+ apps/api 与 apps/web 各自引用。
 *
 * v0.2 变更（相对 v0.1 小程序版）：
 *   - 删除：openid / wx.login / unionid / 小程序 session / wxacode_assets / msgSecCheck 审计
 *   - 新增：Session（匿名）、PersonaCard.identityGuard（★ identity_guard 已补）、
 *          ContextDigest、FallbackScript、SSE 事件协议
 *   - 保留：PersonaCard、Debate、Topic、Message、Verdict、模型分层、上下文压缩
 *
 * 约定：
 *  - id 一律 ULID（时间有序、26 字符、可排序）
 *  - 时间一律 epoch ms（number），避免时区坑
 *  - 无服务端持久化：Debate/Message 落客户端 localStorage，后端仅持有 60s 续传缓冲
 */

// ─────────────────────────────────────────────────────────────
// 枚举与常量
// ─────────────────────────────────────────────────────────────

export type Stance = 'pro' | 'con';

export type DebateStatus =
  | 'draft'      // 已选择先贤/辩题，未开局
  | 'running'
  | 'judging'
  | 'done'
  | 'interrupted'  // 流式中断（区别于 v0.1 的 aborted，客户端可续传恢复）
  | 'aborted';

export type MessageRole = 'user' | 'sage' | 'judge' | 'system';

export type MessageStatus =
  | 'streaming'
  | 'complete'
  | 'interrupted'  // 未生成完，可续传
  | 'blocked';     // 本地词表粗筛未通过

export type TopicCategory = 'traditional' | 'contemporary';

/** v0.1 的 isPublic / moderationStatus 取消：课堂演示无需公共池与审核队列 */
export type TopicScope = 'local' | 'preset';

/** 模型分层（ARCHITECTURE §4.1） */
export type LlmTier = 'strong' | 'fast' | 'cheap';

export const VERDICT_DIMENSIONS = [
  'clarity',      // 论点清晰度
  'evidence',     // 论据质量
  'logic',        // 逻辑一致性
  'rebuttal',     // 对对方的有效回应
  'style',        // 风格与修辞
] as const;
export type VerdictDimension = (typeof VERDICT_DIMENSIONS)[number];

// ─────────────────────────────────────────────────────────────
// 会话（匿名，替代 v0.1 的 User / openid）
// ─────────────────────────────────────────────────────────────

export interface Session {
  /** 客户端生成的匿名 ID（nanoid），存 localStorage；服务端仅用于限流与日志，不持久化 */
  clientId: string;
  createdAt: number;
  /** 服务端按需计算的 IP 哈希，仅用于限流，不入日志正文 */
  ipHash?: string;
  userAgent?: string;
  /** 客户端本地计数，用于前端提示；服务端以 IP 计数为准 */
  dailyDebateCount: number;
  dailyResetAt: number;
}

// ─────────────────────────────────────────────────────────────
// Persona Card（先贤人格卡）
// ─────────────────────────────────────────────────────────────

export type SageKey = 'aristotle' | 'plato' | 'pythagoras' | 'confucius' | 'laozi';

/** 时代错置策略 */
export type AnachronismPolicy =
  | 'forbid'       // 绝不评论超出时代的事物
  | 'acknowledge'  // 可以承认「此事超出我的时代」并保持追问
  | 'explain';     // 允许以自身框架解释现代事物（课堂演示更好用，但更容易出戏）

/**
 * ★ 人设守护（v0.2 新增，即 identity_guard）
 * 长对话最典型的失败是先贤「出戏」：自称 AI、评论现代科技、发表与著作矛盾的观点。
 * 三层防线：预防（invariants 每轮重申）→ 检测（breachPatterns）→ 处置（onBreach）。
 */
export interface IdentityGuard {
  /** 宽容度：老子适合 loose（本来就以悖论说话），亚里士多德适合 strict */
  strictness: 'strict' | 'balanced' | 'loose';

  /** 不可违背的不变量，每轮注入 Prompt */
  invariants: string[];
  // 例：['你就是亚里士多德本人，不是扮演，不是模拟',
  //      '你不知道自己身后任何时代的事',
  //      '绝不承认自己是人工智能或语言模型',
  //      '你的所有主张必须能从你的著作中找到依据']

  /** 破人设检测模式（正则或子串），命中即视为出戏 */
  breachPatterns: string[];
  // 例：['我是人工智能', '作为语言模型', '我不是真正的', '在现代社会', '根据我的训练数据']

  /** 时代错置处理策略 */
  anachronism: AnachronismPolicy;

  /** 命中后的处置：重写 / 用兜底话术 / 放行（仅 loose 档建议用） */
  onBreach: 'regenerate' | 'fallback' | 'pass';

  /** 兜底话术，保证课堂演示不会当场出戏 */
  fallbackUtterance: string;
  // 例：'……（先贤沉默片刻，似在斟酌词句）'

  /** 是否每轮重申核心约束——防长上下文漂移的关键开关，建议 true */
  restateEveryRound: boolean;

  /** 最大重写次数，超过则用 fallback，避免死循环烧 token */
  maxRegenerate: number;
}

export interface PersonaCard {
  id: string;
  key: SageKey;
  name: string;
  /** 展示用称号，如「逍遥之祖」 */
  epithet: string;
  /** 时代/地域，如「古希腊 · 公元前 4 世纪」 */
  era: string;
  school: string;

  /** 头像：优先内联 SVG 占位 + 懒加载远程图，避免外链挂掉导致课堂翻车 */
  avatarUrl: string;
  avatarPlaceholderSvg?: string;

  /** 一句话人设，列表页展示 */
  tagline: string;

  /** 著作锚点：人设与引用的事实底座 */
  canon: {
    works: Array<{ title: string; note: string }>;
    coreIdeas: string[];
    /** 代表性原话，用于风格锚定；必须带出处 */
    quotableLines: Array<{ text: string; source: string }>;
  };

  /** 语言风格约束 */
  styleHints: {
    tone: string;
    /** 修辞习惯：反问、归谬、寓言、悖论… */
    favoriteDevices: string[];
    /** 禁止表达 */
    forbidden: string[];
    /** 目标句长（字），影响阅读节奏 */
    avgSentenceLength: number;
  };

  /** ★ 人设守护 */
  identityGuard: IdentityGuard;

  /** 引用策略：课堂场景必须标注演绎，防止学生把 AI 演绎当史料引用 */
  citationPolicy: {
    allowDirectQuote: boolean;
    requireSourceLabel: boolean;
    disclaimer: string;  // 例：'以下为基于其著作与思想的人格模拟，非史料原文'
  };

  /** prompt 文件版本，如 aristotle.v1.md → 'v1' */
  personaVersion: string;
  /** system.guard.md 版本 */
  guardVersion: string;

  /** 采样参数，按先贤调性差异化 */
  sampling: { temperature: number; topP: number; maxTokens: number };
  /** 该先贤主发言使用的模型档位 */
  tier: LlmTier;

  enabled: boolean;
}

/** 人设守护的检查结果（运行期契约） */
export interface IdentityCheckResult {
  passed: boolean;
  breaches: string[];
  action: 'pass' | 'regenerate' | 'fallback';
  /** 已重写的次数 */
  regenerateCount: number;
}

// ─────────────────────────────────────────────────────────────
// 辩题
// ─────────────────────────────────────────────────────────────

export interface Topic {
  id: string;
  /** 稳定短 key，用于二维码 URL：t01…t20 */
  key: string;
  title: string;
  category: TopicCategory;
  tags: string[];
  /** 背景材料，进 Prompt 帮先贤理解语境（当代题尤其需要） */
  background?: string;
  difficulty: 1 | 2 | 3;
  scope: TopicScope;
  /** 敏感议题标记，命中则收紧 Prompt */
  sensitive: boolean;
  /** 建议的正反方表述，帮助开局 */
  stanceHints?: { pro: string; con: string };
  createdAt: number;
}

// ─────────────────────────────────────────────────────────────
// 对局
// ─────────────────────────────────────────────────────────────

/** 上下文压缩摘要（ARCHITECTURE §4.2） */
export interface ContextDigest {
  /** 已压缩到第几条 seq（不含） */
  throughSeq: number;
  userPosition: string;
  sagePosition: string;
  /** 已被对方认可的点 */
  conceded: string[];
  /** 已被驳倒的点 */
  refuted: string[];
  /** 悬而未决的线头 */
  openThreads: string[];
  /** 生成该摘要的模型与档位 */
  model: string;
  tier: LlmTier;
  tokenCost: number;
  createdAt: number;
}

export interface Debate {
  id: string;
  /** 匿名会话 ID，对应 Session.clientId */
  sessionId: string;
  sageKey: SageKey;
  topicId: string;

  userStance: Stance;
  sageStance: Stance;
  maxRounds: number;          // 6-10
  currentRound: number;       // 从 1 开始
  status: DebateStatus;

  /** 先手：MVP 固定先贤开场 */
  openingRole: 'sage' | 'user';

  /** 可复现性：记录生成时的版本组合 */
  personaVersion: string;
  guardVersion: string;
  judgeVersion: string;
  llmModel: string;
  llmTier: LlmTier;

  /** ★ 上下文压缩状态 */
  contextDigest?: ContextDigest;
  /** 已压缩到的 seq，续传时告诉服务端从哪开始 */
  compressedThroughSeq: number;

  /** 成本观测 */
  totalTokens: number;
  /** 从哪个二维码进入，null 表示直接打开 */
  qrSource?: string;

  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
}

export interface Message {
  id: string;
  debateId: string;
  /** 单调递增多轮序号；SSE 的 id 字段与续传都靠它 */
  seq: number;
  round: number;
  role: MessageRole;
  stance?: Stance;
  content: string;
  /** 是否被摘要取代（前端据此折叠显示） */
  compressed: boolean;
  status: MessageStatus;
  model?: string;
  tier?: LlmTier;
  promptTokens?: number;
  completionTokens?: number;
  /** 首字延迟，用于 P95 指标 */
  firstTokenLatencyMs?: number;
  /** 人设守护触发的重写次数 */
  identityRegenerated?: number;
  createdAt: number;
}

export interface Verdict {
  id: string;
  debateId: string;
  /** 维度分 1-10，仅点评，无胜负（ADR-005 保持不变） */
  scores: Record<VerdictDimension, number>;
  userHighlights: string[];
  sageHighlights: string[];
  suggestions: string[];
  /** 总结陈词，200-400 字 */
  summary: string;
  /** 钩子：先贤会如何继续追问你 */
  followUpQuestion?: string;
  model: string;
  tier: LlmTier;
  judgeVersion: string;
  createdAt: number;
}

// ─────────────────────────────────────────────────────────────
// 轻量内容过滤日志（替代 v0.1 的 msgSecCheck 审计）
// ─────────────────────────────────────────────────────────────

export interface ModerationLog {
  id: string;
  targetType: 'user_input' | 'ai_output' | 'custom_topic';
  sessionId: string;
  debateId?: string;
  /** 本地词表命中项 */
  hits: string[];
  action: 'pass' | 'block' | 'regenerate' | 'fallback';
  /** 只存哈希与截断片段，不存完整原文 */
  contentHash: string;
  excerpt?: string;
  createdAt: number;
}

// ─────────────────────────────────────────────────────────────
// 离线兜底脚本（ARCHITECTURE §6.4 L3）
// ─────────────────────────────────────────────────────────────

export interface FallbackScript {
  id: string;
  sageKey: SageKey;
  topicId: string;
  rounds: Array<{ round: number; role: MessageRole; content: string }>;
  verdictSummary: string;
  /** 页面角标用，便于现场确认这是兜底内容 */
  generatedAt: number;
}

// ─────────────────────────────────────────────────────────────
// SSE 事件协议（packages/shared 唯一定义源）
// ─────────────────────────────────────────────────────────────

export type SseEvent =
  | { event: 'sage_start';  data: { messageId: string; seq: number; round: number } }
  | { event: 'chunk';       data: { messageId: string; i: number; delta: string } }
  | { event: 'done';        data: { messageId: string; seq: number; round: number; fullText: string } }
  | { event: 'digest';      data: { contextDigest: ContextDigest } }
  | { event: 'guard';       data: { action: 'regenerate' | 'fallback'; reason?: string } }
  | { event: 'round_close'; data: { round: number; nextRole: 'user' | 'sage' } }
  | { event: 'judge_start'; data: { debateId: string } }
  | { event: 'judge_chunk'; data: { delta: string } }
  | { event: 'judge_done';  data: { verdict: Verdict } }
  | { event: 'error';       data: { code: ErrorCode; retryable: boolean } };

/** 心跳帧（注释行 `: ping`），不计入事件类型 */
export const SSE_HEARTBEAT = ': ping\n\n';

/** 响应头要求：防中间代理缓冲（微信链路下尤其重要） */
export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;

// ─────────────────────────────────────────────────────────────
// HTTP 接口清单（MVP）
// ─────────────────────────────────────────────────────────────
// GET    /api/personas                        → PersonaCard[]（不含 prompt 全文）
// GET    /api/personas/:key                   → PersonaCard
// GET    /api/topics?category=                → Topic[]
// POST   /api/debate/:id/utterance            → SSE 流
//          body:   { sessionId, text, history[], contextDigest, seq }
//          header: X-Session-Id, Last-Event-ID（续传）
// POST   /api/debate/:id/judge                → SSE 流
// POST   /api/verify-demo-code  { code }      → { ok }（可选，见 §8.1）
// GET    /api/healthz
//
// 说明：无登录接口、无对局落库接口 —— 对局状态由客户端持有并随请求携带。

// ─────────────────────────────────────────────────────────────
// 错误码（前后端共用，客户端按 code 做文案映射）
// ─────────────────────────────────────────────────────────────

export const ERROR_CODES = {
  NOT_YOUR_TURN: '还没到你发言',
  ROUND_EXHAUSTED: '本局回合已用完',
  INPUT_TOO_LONG: '说得太长了，精简一点',
  INPUT_EMPTY: '总得说点什么吧',
  INPUT_BLOCKED: '换个说法试试',
  RATE_LIMITED: '稍等一下，先贤还在应付其他人',
  DEMO_CODE_REQUIRED: '请输入演示口令',
  DEMO_CODE_INVALID: '演示口令不对',
  QUOTA_EXCEEDED: '今日额度用尽，明天再来',
  LLM_UNAVAILABLE: '先贤走神了，稍等片刻',
  STREAM_INTERRUPTED: '网络中断了，正在接上',
  PERSONA_NOT_FOUND: '找不到这位先贤',
  TOPIC_NOT_FOUND: '找不到这道辩题',
} as const;
export type ErrorCode = keyof typeof ERROR_CODES;

// ─────────────────────────────────────────────────────────────
// 二维码 URL 契约（替代 v0.1 的 wxacode scene）
// ─────────────────────────────────────────────────────────────

/**
 * 普通二维码，内容即 URL。用 hash 路由免去服务端 rewrite。
 * 目标：≤ 60 字符（二维码越密越难扫，课堂投影 / 打印 A4 上尤其明显）
 *
 *   https://<domain>/#/d?s=laozi&t=t12&st=pro   直达对局
 *   https://<domain>/#/s?k=laozi                直达先贤
 *   https://<domain>/#/t?k=t12                  直达辩题
 *
 * 不再有 32 字符 scene 限制，但仍要短 —— 限制因素变成了二维码识别率。
 */
export function buildQrUrl(
  base: string,
  kind: 'debate' | 'sage' | 'topic',
  params: Record<string, string>,
): string {
  const path = kind === 'debate' ? 'd' : kind === 'sage' ? 's' : 't';
  const query = new URLSearchParams(params).toString();
  return `${base}/#/${path}?${query}`;
}
