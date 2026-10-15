# Agora · P0 后端设计：协议 / 数据结构 / 状态机

> 阶段：P0 最小可运行（仅柏拉图一位先贤，跑通 1v1 循环）
> 技术选型：**Node.js 20 + TypeScript + Hono + SSE**
> 状态：待确认，确认后写实现代码

---

## 0. P0 的两处"明知故犯"（先说放弃的是什么）

| 决策 | P0 做法 | 偏离的 ADR | 何时纠正 |
|---|---|---|---|
| **状态存放** | 服务端内存 Map 持有 Debate 聚合 | ADR-011（无状态，客户端携带历史） | M2 部署到多实例/需要跨设备复盘时 |
| **情绪分类** | 启发式关键词规则 | 预留 `MoodClassifier` 接口 | M2 换成 cheap 模型分类 |

**为什么 P0 先用内存态**：无状态方案要求客户端每轮把完整历史发回来，P0 阶段这会同时增加前端复杂度和请求体大小，而免费云单实例下内存 Map 完全够用。等真的需要横向扩展或分享链接时再切——那时接口不用改，只换 `store/` 实现。

---

## 1. 后端目录结构

```
apps/api/
├─ src/
│  ├─ index.ts                    # 入口：本地 @hono/node-server；Workers 时导出 default
│  ├─ app.ts                      # buildApp()：装配路由与中间件（可测试，不 listen）
│  ├─ config/
│  │  └─ env.ts                   # zod 校验 env，缺 Key 直接启动失败
│  ├─ routes/
│  │  ├─ health.ts                # GET  /api/healthz
│  │  ├─ personas.ts              # GET  /api/personas
│  │  ├─ topics.ts                # GET  /api/topics
│  │  └─ debate.ts                # ★ 建局 / 开场 / 发言 / 裁判，全部返回 SSE
│  ├─ domain/                     # ★ 纯领域，不 import Hono / SDK
│  │  ├─ Debate.ts                # 聚合根 + 不变量
│  │  ├─ RoundPolicy.ts           # 回合数 / 长度上限 / 压缩阈值
│  │  ├─ StateMachine.ts          # status × turn 迁移表
│  │  ├─ PromptBuilder.ts         # 人格 prompt + 对局变量 → messages[]
│  │  ├─ ContextCompressor.ts     # 超 6 轮压缩
│  │  ├─ IdentityGuard.ts         # 破人设检测（柏拉图 vs 苏格拉底 是重点）
│  │  └─ MoodClassifier.ts        # 情绪启发式（P0）+ 模型分类（预留）
│  ├─ infra/
│  │  ├─ llm/
│  │  │  ├─ types.ts              # LlmClient 接口、Tier、Delta
│  │  │  ├─ openaiCompat.ts       # ★ OpenAI 兼容协议适配器（一家适配覆盖 N 家）
│  │  │  ├─ router.ts             # 三层选路 + 超时 + 重试 + 熔断
│  │  │  └─ budget.ts             # 日预算闸（P0 简化：全局计数）
│  │  ├─ store/
│  │  │  ├─ DebateStore.ts        # 接口
│  │  │  └─ memoryStore.ts        # P0：Map + TTL 清理
│  │  ├─ sse.ts                   # SSE 编码器（帧序列化 + 心跳 + headers）
│  │  └─ rateLimit.ts             # IP 限流（内存计数）
│  ├─ personas/
│  │  ├─ types.ts                 # PersonaCard（同 docs/data-model.ts）
│  │  └─ plato.ts                 # ★ 柏拉图卡片（P0）
│  ├─ data/
│  │  └─ topics.ts                # 20 题（P0 可先灌 5 题验证）
│  └─ types/
├─ ../../prompts/
│  └─ plato.system.md             # ★ 人格 prompt（静态层，见上）
├─ .env.example
├─ package.json
├─ tsconfig.json
└─ wrangler.toml                  # 未来上 Workers 时用
```

**为什么用 OpenAI 兼容协议做唯一适配器**：DeepSeek、月之暗面、智谱、硅基流动、Groq、通义（兼容模式）、vLLM、Ollama 全都实现了这套 `/chat/completions` 协议。P0 只写一个适配器，换供应商只改 `LLM_BASE_URL` / `LLM_API_KEY` / 模型名三个环境变量。**这是 P0 阶段性价比最高的一个决定。**

---

## 2. 通信协议（SSE）

### 2.1 为什么是 SSE 而不是 WebSocket

见 `ADR-010`：Vercel Serverless 不支持 WS，Render 免费层会休眠。SSE 是纯 HTTP，且**一个 POST 请求即可同时完成"提交发言 + 接收流式回复"**，比双通道简单。客户端用 `fetch + ReadableStream` 自研解析（约 30 行），不用 `EventSource`——后者只支持 GET，无法带请求体和自定义 header。

### 2.2 事件表

| event | 时机 | data 字段 |
|---|---|---|
| `start` | LLM 首帧到达前 | `{ messageId, seq, round, mood, personaKey }` |
| `delta` | 每个文本分片 | `{ i, delta }` |
| `done` | 生成结束 | `{ messageId, seq, round, fullText, tokens, latencyMs }` |
| `digest` | 触发上下文压缩时 | `{ contextDigest }` |
| `guard` | 破人设重写时 | `{ action: 'regenerate' \| 'fallback', reason }` |
| `round_end` | 回合结算 | `{ round, nextTurn: 'user' \| 'sage' \| 'judge' }` |
| `error` | 任何失败 | `{ code, message, retryable }` |

心跳：每 5s 一个注释帧 `: ping\n\n`，客户端忽略。
续传：每帧带 `id: <seq>`，断流后重连携带 `Last-Event-ID`。

### 2.3 帧示例

```
id: 7
event: start
data: {"messageId":"01J...","seq":7,"round":4,"mood":"amused","personaKey":"plato"}

id: 7
event: delta
data: {"i":0,"delta":"让我们从这儿出发。"}

id: 7
event: delta
data: {"i":1,"delta":"你所指的『自由』本身是什么？"}

id: 7
event: done
data: {"messageId":"01J...","seq":7,"round":4,"fullText":"...","tokens":183,"latencyMs":2140}

event: round_end
data: {"round":4,"nextTurn":"user"}
```

### 2.4 响应头（必须）

```
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no          ← 防中间代理缓冲，微信链路下尤其关键
```

### 2.5 时序

见下方时序图。关键点：

1. `start` 必须在第一个 `delta` 之前发出 —— 前端据此创建气泡容器，避免文本"凭空出现"
2. `mood` 由 `MoodClassifier` 同步算出，与 LLM 请求**并行**，不占用首字延迟
3. 压缩判定在拼装 Prompt **之前**，否则这一轮就白压缩了
4. `round_end` 由服务端判定，客户端不自治

### 2.6 HTTP 接口

```
GET    /api/healthz
GET    /api/personas                       → PersonaCard[]（不含 prompt 全文）
GET    /api/topics?category=               → Topic[]
POST   /api/debate                         → { debateId, opening? }
         body: { personaKey, topicId, userStance, maxRounds }
POST   /api/debate/:id/opening             → SSE（先贤第 1 轮开场）
POST   /api/debate/:id/turn                → SSE（玩家发言 → 先贤回应）
         body: { text }
         header: X-Session-Id, Last-Event-ID（续传）
POST   /api/debate/:id/judge               → SSE（裁判点评，结构化 JSON）
DELETE /api/debate/:id                     → { ok }
```

**为什么开场单独一个端点**：先贤先手时，客户端还没有"玩家发言"，用一个语义明确的 `opening` 比让 `turn` 接受空文本更不易出错，也便于前端单独做入场动画。

---

## 3. 模型调用封装（三层 + 一个内部工具）

### 3.1 统一接口

```ts
type Tier = 'strong' | 'fast' | 'cheap';

interface ChatRequest {
  tier: Tier;
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json';
  signal?: AbortSignal;
}

interface LlmClient {
  chat(req: ChatRequest): AsyncIterable<Delta>;   // 流式
  chatOnce(req: ChatRequest): Promise<string>;    // 非流式（压缩/分类用）
}
```

### 3.2 三层职责

| 层 | Tier | 温度 | maxTokens | 用途 | 说明 |
|---|---|---|---|---|---|
| **sage** | `strong` | 0.85 | 600 | 柏拉图发言 | 人设一致性与论证质量是产品核心，不能省 |
| **judge** | `strong` | 0.3 | 800 | 裁判点评 | 需要稳定 JSON，用 `responseFormat: 'json'` |
| **matcher** | `cheap` | 0.2 | 300 | 命题匹配 | 自定义命题 → 推荐先贤 + 生成正反方立场表述 |
| *compressor*（内部） | `cheap` | 0.2 | 400 | 上下文压缩 | 摘要任务简单，省下的 token 是纯利润 |

> 第四层是你没点的，但它必须存在——否则压缩会用 strong 档烧钱，而摘要恰恰是最不需要聪明模型的任务。

### 3.3 环境变量

```bash
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=sk-xxxxxxxx
LLM_MODEL_STRONG=deepseek-chat
LLM_MODEL_FAST=deepseek-chat
LLM_MODEL_CHEAP=deepseek-chat
DAILY_TOKEN_CAP=200000
RATE_LIMIT_PER_IP=30
```

P0 三档指向同一模型完全没问题（省钱），接口留好后随时拆分。

### 3.4 Router 职责

- 按 `tier` 选模型名
- 超时：`strong` 45s / `cheap` 15s（AbortController）
- 重试：仅对 `429 / 5xx / 网络错误`，最多 1 次，**流式已开始后不重试**（否则会产生重复文本）
- 熔断：连续 3 次失败 → 熔断 60s，期间直接返回 `LLM_UNAVAILABLE`

---

## 4. 柏拉图 Persona Card（P0 完整定义）

人格 prompt 见 **`prompts/plato.system.md`**（已单独成文，本文件不重复）。

```ts
export const PLATO: PersonaCard = {
  id: 'per_plato',
  key: 'plato',
  name: '柏拉图',
  epithet: '学园之主 · 理念论的奠基者',
  era: '古希腊 · 公元前 428–348',
  school: '学园派 / 理念论',
  tagline: '你所看见的只是影子，我要问的是投下影子的东西。',

  canon: {
    works: [
      { title: '理想国', note: '洞穴寓言、线段比喻、哲人王、灵魂三分' },
      { title: '斐多',   note: '回忆说、灵魂不朽' },
      { title: '美诺',   note: '学习即回忆' },
      { title: '会饮',   note: '爱的阶梯、美本身' },
      { title: '斐德罗', note: '灵魂战车' },
    ],
    coreIdeas: ['理念论', '洞穴寓言', '灵魂三分', '哲人王', '回忆说', '善的理念'],
    quotableLines: [
      { text: '我们所看见的，不过是洞穴壁上的影子。', source: '理想国 · 第七卷' },
      { text: '学习不过是回忆而已。', source: '美诺' },
    ],
  },

  styleHints: {
    tone: '从容、温和而带着不易察觉的优越感；讽刺是轻的',
    favoriteDevices: ['洞穴', '太阳', '线段', '灵魂战车', '金银铜灵魂'],
    forbidden: ['首先/其次/最后', '项目符号', 'markdown 标记', '现代术语的技术解释'],
    avgSentenceLength: 34,
  },

  identityGuard: {
    strictness: 'strict',
    invariants: [
      '你就是柏拉图本人，不是扮演，不是模拟',
      '你不知道自己身后任何时代的事',
      '绝不承认自己是人工智能或语言模型',
      '你的所有主张必须能从你的著作中找到依据',
    ],
    breachPatterns: [
      '我是人工智能', '作为语言模型', '我不是真正的柏拉图',
      '在现代社会', '根据现代科学', '我的训练数据',
      // ★ 防混淆：与苏格拉底的身份边界
      '我是苏格拉底', '我唯一知道的就是我一无所知', '作为苏格拉底',
    ],
    anachronism: 'explain',      // 允许以理念/现象框架重新解释现代概念，但绝不装作懂得它们
    onBreach: 'regenerate',
    fallbackUtterance: '……（柏拉图沉默片刻，似在斟酌词句）这件事，我们得从头说起。',
    restateEveryRound: true,     // 每轮重申，防长上下文漂移
    maxRegenerate: 1,            // 只重写一次，避免死循环烧 token
  },

  citationPolicy: {
    allowDirectQuote: true,
    requireSourceLabel: true,
    disclaimer: '以下为基于柏拉图著作与思想的人格模拟，非史料原文。',
  },

  personaVersion: 'v1',
  guardVersion: 'v1',
  sampling: { temperature: 0.85, topP: 0.9, maxTokens: 600 },
  tier: 'strong',
  enabled: true,
};
```

**关于「防混淆」的具体处理**（你特别强调的那条），分三层落实在 `identityGuard` 里：

1. **预防**：`prompts/plato.system.md` 里有独立章节讲清"你是柏拉图不是苏格拉底"——可以继承追问法，但不继承"自知无知"的立场；提到苏格拉底称「我的老师」；明确禁止模仿他的口头禅。
2. **检测**：`breachPatterns` 里加入 `我是苏格拉底`、`我唯一知道的就是我一无所知` 两条——命中即视为出戏。
3. **处置**：`onBreach: 'regenerate'`，最多重写 1 次，仍失败则用 `fallbackUtterance`。

---

## 5. 单局数据结构与状态机

### 5.1 数据结构

```ts
type DebateStatus = 'draft' | 'running' | 'judging' | 'done' | 'aborted';
type Turn         = 'awaiting_user' | 'generating_sage' | 'awaiting_judge';

interface Debate {
  id: string;
  personaKey: 'plato';              // P0 固定
  topicId: string;
  userStance: Stance;
  personaStance: Stance;            // 自动取反
  maxRounds: number;                // 6-10
  round: number;                    // 从 1 开始
  status: DebateStatus;
  turn: Turn;
  messages: Message[];              // 全量，含 user/sage/judge
  seq: number;                      // 单调递增，SSE 续传锚点
  contextDigest?: ContextDigest;    // 压缩摘要
  compressedThroughSeq: number;     // 已压缩到的 seq（不含）
  totalTokens: number;
  createdAt: number;
  updatedAt: number;
}

interface Message {
  id: string;
  seq: number;
  round: number;
  role: 'user' | 'sage' | 'judge';
  stance?: Stance;
  content: string;
  compressed: boolean;              // 已被摘要取代
  mood?: Mood;                      // 仅 sage
  tokens: number;
  firstTokenLatencyMs?: number;
  createdAt: number;
}

interface ContextDigest {
  throughSeq: number;
  userPosition: string;   // ≤ 80 字
  personaPosition: string;
  conceded: string[];     // 已被认可的点
  refuted: string[];      // 已被驳倒的点
  openThreads: string[];  // 悬而未决
  tokenCost: number;
}

type Mood = 'calm' | 'amused' | 'irritated' | 'impressed';
```

### 5.2 状态机

```
                 POST /debate
                      │
                      ▼
                 ┌─────────┐
                 │  draft  │
                 └────┬────┘
              POST /opening │
                      ▼
      ┌────────► ┌──────────────────┐
      │          │     running      │
      │          │ awaiting_user    │◄──────────┐
      │          └────────┬─────────┘           │
      │              POST │ /turn               │
      │                   ▼                     │
      │          ┌──────────────────┐           │
      │          │ generating_sage  │           │
      │          └────────┬─────────┘           │
      │                   ▼                     │
      │            round_end 事件               │
      │                   │                     │
      │          round < maxRounds ? ────yes────┘
      │                   │ no
      │                   ▼
      │          ┌──────────────────┐
      │          │     judging      │
      │          │ awaiting_judge   │
      │          └────────┬─────────┘
      │                   ▼
      │             ┌──────────┐
      └─────────────│   done   │
      DELETE/abort  └──────────┘
                          │
                          ▼
                    ┌──────────┐
                    │ aborted  │
                    └──────────┘
```

**不变量（写进 `Debate.ts` 断言）**：

1. `generating_sage` 期间拒绝新的 `POST /turn`（返回 `NOT_YOUR_TURN`）——并发发言是最容易漏的一条
2. `round > maxRounds` 时拒绝 `POST /turn`（返回 `ROUND_EXHAUSTED`）
3. `seq` 严格单调递增，是续传的唯一锚点
4. `status === 'done'` 后所有写操作拒绝
5. `messages` 中 `compressed: true` 的条目不进 Prompt 正文，只由 `contextDigest` 代表

### 5.3 上下文压缩规则（超 6 轮触发）

```
COMPRESS_AFTER_ROUNDS = 6
KEEP_RECENT_ROUNDS    = 3
```

触发时机：`round > 6` 且 `seq - compressedThroughSeq > 12` 时，在**拼装 Prompt 之前**执行。

压缩后的 Prompt 结构：

```
[system]  plato.system.md（全量人格，含 mood）
[system]  辩题 + 双方立场
[system]  【此前对话摘要】{ userPosition / personaPosition / conceded / refuted / openThreads }
[ ...  ]  最近 3 轮全文（user/sage 交替）
[user ]  当前这一轮的玩家发言
```

- 摘要由 `cheap` 档生成，结果按 `debateId + throughSeq` 缓存，避免重复烧钱
- 压缩只影响发给模型的 `messages[]`，**数据库/内存里的 `messages` 全量保留**，前端照常显示完整历史

### 5.4 情绪分类（P0 启发式）

| 输入特征 | mood |
|---|---|
| 含"你说得对""我明白了""有道理" | `impressed` |
| 含"无聊""废话""你根本没回答""胡说" | `irritated` |
| 含反问、归谬、"按你这么说" | `amused` |
| 其他 | `calm` |

P0 用关键词表即可，零延迟零成本。`MoodClassifier` 接口预留，M2 换成 cheap 模型分类（与 LLM 主请求并行，不占首字延迟）。

---

## 6. P0 验收标准

**功能**
- [ ] `POST /api/healthz` 返回 200，env 缺失时启动失败并给出明确提示
- [ ] 建局 → 柏拉图开场 → 玩家发言 → 柏拉图回应，可连续跑满 6 轮不中断
- [ ] 设为 10 轮时，第 7 轮起触发上下文压缩，且柏拉图仍能正确引用第 1 轮的立场
- [ ] 并发保护：`generating_sage` 期间再发一次 `/turn`，返回 `NOT_YOUR_TURN`
- [ ] 回合耗尽后再发言，返回 `ROUND_EXHAUSTED`

**流式**
- [ ] 首字延迟 P95 ≤ 2s（国内模型）
- [ ] 帧间隔无 >500ms 卡顿
- [ ] 手动断开后带 `Last-Event-ID` 重连，能续上且不丢字、不重复
- [ ] `curl -N` 能直接看到逐帧输出（不经过任何前端也能验证）

**人设（柏拉图专项，最关键）**
- [ ] 10 次随机发言中，**零次**自称苏格拉底或模仿其口头禅
- [ ] 主动询问"你和苏格拉底是什么关系"时，回答称「我的老师」并表明观点已超越其诘问法
- [ ] 追问"你说的自由/公平/成功，本身是什么"的次数 ≥ 5/10（体现从具体追问本质）
- [ ] 至少 3/10 次使用了洞穴/太阳/线段/战车/金银铜 中的一个比喻
- [ ] 提到现代概念（AI、手机、考试）时，不装作懂得，而是用理念/现象框架重新提问
- [ ] 被直接诱导"你是 AI 吗"时，不承认，且把它转成哲学问题
- [ ] 盲测：5 位读者能认出这是柏拉图而非苏格拉底

**工程**
- [ ] Key 只在 env，任何响应（含错误详情）都不出现 provider / model / Key 信息
- [ ] 换供应商只需改 3 个环境变量，代码零改动
- [ ] `pnpm dev` 一条命令起服务

---

## 7. 确认结果（已确认，代码实现完毕）

| 项 | 结论 | 落地 |
|---|---|---|
| ① 选型 Node + Hono + SSE | **确认** | `apps/api`，见 `apps/api/README.md` |
| ② P0 服务端内存态 | **确认**，加两个保险 | `/api/healthz` 供免费监控保活；验证页内置「加载中 + 超时重试」 |
| ③ 单实例约束 | **确认** | `/api/healthz` 返回 `deployment.mode = single-instance`；README 与代码注释均标注 |
| ④ 内存只维持活跃对局 | **确认** | TTL 2h、上限 200 局、超限淘汰最久未更新 |
| ⑤ 回复长度 | **150–200 字** | `apps/api/prompts/plato.system.md` |

**实现期发现并修正的两个状态机 bug**（冒烟测试暴露的，值得记一笔）：

1. `assertCanUserSpeak` 原先用 `round > maxRounds` 判断回合耗尽——但先贤开场会让 `round` 先走一格，导致最后一回合被提前误封。改为**只按用户发言轮次计数**（`maxRounds` 指玩家可发言轮数，开场不计入）。
2. `assertCanJudge` 原先拒绝 `status === 'judging'`——而 `judging` 恰恰是「等待裁判」的状态，把裁判入口自己堵死了。改为只拒绝 `done` / `aborted`。

两个 bug 都属于「状态机写反」类型，靠人工 review 很难发现，**是冒烟测试抓出来的**。这印证了把状态机不变量写成可执行断言的价值。
