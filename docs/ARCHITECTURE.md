# Agora · 雅典广场 — 架构设计 v0.2（H5 版）

> 版本：v0.2 / 阶段：设计，未写业务代码
> 定位：**课堂演示**。1 真人 vs 1 AI 先贤，回合制辩论；H5 网页 + 微信内打开；零成本、免审核、免备案。
> 上一版（v0.1 微信小程序方案）已废弃，差异见 `ADR-009`。

---

## 0. 三个必须先讲的连带结论

改 H5 不是换个前端外壳，它会推翻 v0.1 的三条决策：

1. **当初选 WebSocket 的唯一原因是「小程序不支持 SSE」。这个约束消失了。** H5 下 SSE 是纯 HTTP，能跑在任何 Serverless 上；而 WebSocket 需要常驻进程——Vercel Serverless 根本不支持，Render 免费层会休眠 50 秒。所以**改用 SSE**，WS 从资产变成负债。
2. **免登录意味着你的 LLM 接口是匿名公网 API。** 最大的风险不再是合规，而是二维码贴出去第二天 Key 被刷爆。防护闸从"可选"升级为"必须有"。
3. **SQLite 不能用于 Serverless**（文件系统只读、实例无状态）。数据持久化下沉到客户端 `localStorage`，后端做成无状态——这反而让部署简单一个数量级。

---

## 1. 部署方案（含取舍）

| 方案 | 前端 | 后端 | 流式 | 冷启动 | 时长限制 | 成本 | 结论 |
|---|---|---|---|---|---|---|---|
| **A. 全栈 Next.js on Vercel** | Vercel | Vercel Serverless | SSE | 1-3s | Hobby `maxDuration` 60s | 0 | **最简**，一个工程一次部署 |
| **B. 静态前端 + Cloudflare Workers** | Vercel | CF Workers (Hono) | SSE，或 WS via Durable Objects | < 50ms | 无墙钟限制（CPU 10ms/请求，流式等待不算） | 0 | **最稳**，推荐课堂演示 |
| C. 静态前端 + Render 免费 | Vercel | Render Web Service | SSE 或 WS | **15 分钟无请求即休眠，冷启动约 50s** | 无 | 0 | 有 WS，但休眠对演示是致命的 |
| D. Railway | — | — | — | — | — | **已无免费层**（仅试用额度） | 排除 |

**对你给的清单的两点更正**：Railway 自 2024 年起取消免费计划，只剩试用额度，请从候选中划掉；Render 免费层的休眠不是理论风险，是必然发生——如果非要用它，必须配 UptimeRobot 之类每 10 分钟自 ping 保活，且现场第一次访问仍可能慢。

**推荐**：**B 为主**（课堂演示的第一诉求是"不能翻车"，CF Workers 几乎无冷启动且不限墙钟时间），**A 为备**（若你更看重"一个仓库一次部署"的省心）。两者都用 SSE，后端代码几乎可复用（Hono 与 Next.js Route Handler 都是 `Request → Response` 模型）。

> 若坚持要用 WebSocket：只有方案 C 可用，且必须配保活。我不建议。详见 `ADR-010`。

### 前端框架：React 还是 Vue

**建议 React 18 + Vite + TypeScript + Tailwind。** 理由：Vercel 生态同源、流式渲染的现成参考最多（AI 类项目几乎清一色 React）、`zustand` 足够轻。Vue 3 同样能做得很好，若你本人更熟 Vue，选 Vue 的收益大于框架本身的差异——**这条不值得纠结，用你手最熟的那个**。选方案 A 时则直接用 Next.js（App Router + Route Handlers）。

---

## 2. 目录结构

```
agora/
├─ apps/
│  ├─ web/                       # H5 前端（React + Vite + TS）
│  └─ api/                       # 后端（Hono on Cloudflare Workers；方案 A 时为 Next.js routes）
├─ packages/
│  └─ shared/                    # 纯类型 + 协议常量（零运行时依赖）
├─ docs/
└─ prompts/                      # （软链或独立目录）人设 prompt 版本库
```

### 2.1 `apps/web`

```
apps/web/
├─ index.html
├─ vite.config.ts
├─ src/
│  ├─ main.tsx / App.tsx
│  ├─ routes/                    # hash 路由（#/d?s=laozi&t=t12），免去服务端重写配置
│  │  ├─ Home.tsx                # 广场：选先贤 / 今日辩题
│  │  ├─ SageDetail.tsx
│  │  ├─ TopicList.tsx           # 传统 / 当代 / 自定义
│  │  ├─ Setup.tsx               # 选立场、回合数
│  │  ├─ Debate.tsx              # ★ 对局页
│  │  ├─ Verdict.tsx             # 裁判点评
│  │  └─ Replay.tsx              # 复盘（只读 / 可导出）
│  ├─ components/
│  │  ├─ ChatBubble.tsx          # 三态：streaming / complete / interrupted
│  │  ├─ StreamingText.tsx       # ★ 流式渲染 + 节流（rAF 合并，避免每次 token 触发 React 重渲染）
│  │  ├─ SageAvatar.tsx
│  │  ├─ RoundProgress.tsx
│  │  ├─ SafeInput.tsx           # 长度校验 + 微信键盘适配
│  │  ├─ AiBadge.tsx             # ★ 「AI 生成 · 风格演绎」标识（教学诚信，见 §8）
│  │  └─ QrPanel.tsx             # 二维码生成与展示
│  ├─ services/
│  │  ├─ api.ts                  # fetch 封装、重试、错误码映射
│  │  ├─ stream.ts               # ★ SSE/ReadableStream 解析 + Last-Event-ID 续传
│  │  └─ session.ts              # ★ 匿名会话（localStorage + nanoid）
│  ├─ stores/                    # zustand：debateStore / personaStore
│  ├─ persistence/               # localStorage 对局仓库 + 导入/导出 JSON
│  ├─ fallback/                  # ★ 离线兜底脚本（详见 §6.4 L3）
│  │  ├─ scripts/                # 预生成的辩论 JSON
│  │  └─ player.ts               # 定时播放，模拟流式
│  └─ styles/
└─ public/
```

### 2.2 `apps/api`

```
apps/api/
├─ src/
│  ├─ index.ts                   # Hono app（方案 A：Next.js route handlers 同构）
│  ├─ routes/
│  │  ├─ personas.ts             # GET /api/personas
│  │  ├─ topics.ts               # GET /api/topics
│  │  ├─ debate.ts               # POST /api/debate/:id/utterance → SSE 流 ★
│  │  ├─ judge.ts                # POST /api/debate/:id/judge → SSE 流
│  │  └─ health.ts
│  ├─ domain/                    # ★ 纯领域，不 import 任何运行时 API
│  │  ├─ Debate.ts               # 聚合根：回合不变量、状态迁移
│  │  ├─ RoundPolicy.ts          # 回合数、长度上限、超时
│  │  ├─ PromptBuilder.ts        # 人设 + 辩题 + 立场 + 历史 → messages[]
│  │  ├─ ContextCompressor.ts    # ★ 上下文压缩（详见 §4）
│  │  ├─ IdentityGuard.ts        # ★ 人设守护（详见 §4.3）
│  │  └─ events.ts
│  ├─ infra/
│  │  ├─ llm/
│  │  │  ├─ LlmProvider.ts       # stream({tier, messages, signal}) → AsyncIterable<Delta>
│  │  │  ├─ router.ts            # ★ 模型分层选路 + 熔断 + 重试
│  │  │  ├─ providers/{dashscope.ts, hunyuan.ts, zhipu.ts, openai.ts, siliconflow.ts}
│  │  │  └─ budget.ts            # ★ 全局/单 IP token 闸
│  │  ├─ rateLimit/              # ★ IP 限流（KV 计数器 / 内存）
│  │  ├─ cache/{memory.ts, kv.ts}  # 续传缓冲 + 摘要缓存（省 token 的关键）
│  │  └─ safety/lightFilter.ts   # 轻量本地词表（降级版内容安全）
│  └─ observability/{logger.ts, metrics.ts}
├─ prompts/
│  ├─ sages/{aristotle.v1.md, plato.v1.md, pythagoras.v1.md, confucius.v1.md, laozi.v1.md}
│  ├─ judge.v1.md
│  └─ system.guard.md            # 防注入 + 风格约束 + AI 标识
├─ tests/
└─ wrangler.toml                 # 方案 B；方案 A 时为 next.config
```

---

## 3. 数据流（无状态后端）

```
┌─ 浏览器 ────────────────────────────────────────────┐
│  localStorage：Session(clientId) + 对局历史 + 自定义命题 │
│  内存中：当前 Debate 全量 messages[]                   │
└───────────────┬─────────────────────────────────────┘
                │ POST /utterance
                │ body: { debateId, sessionId, text,
                │         history[], contextDigest, tier }
                │ header: X-Session-Id, Last-Event-ID(续传时)
                ▼
┌─ 后端（无状态）──────────────────────────────────────┐
│  限流 → 预算检查 → 轻量过滤 → 上下文压缩 → Prompt 拼装 │
│  → LLM 流式 → 人设守护 → SSE 逐帧下发                 │
│  仅缓存：续传缓冲(60s) + 摘要结果(1h)                  │
└─────────────────────────────────────────────────────┘
```

**客户端携带历史的代价与收益**：收益是后端彻底无状态、可部署在任何 Serverless、零数据库成本；代价是历史可被篡改（课堂演示场景可接受，且本来就没有作弊动机）。若未来要做"分享复盘链接"，再引入 Cloudflare D1 或 Turso 存快照（两者都有免费层，D1 就是 SQLite 语义，迁移成本近乎为零）。

---

## 4. 保留项：模型分层、上下文压缩、人设守护

### 4.1 模型分层（Tier）

| 用途 | 档位 | 理由 |
|---|---|---|
| 先贤主发言 | `strong` | 人设一致性与论证质量是产品核心，不能省 |
| 裁判点评 | `strong`（要求 JSON 模式） | 结构化输出需要稳定 |
| 上下文摘要压缩 | `cheap` | 摘要任务简单，省下来的 token 是纯利润 |
| 开场白 / 短追问 | `fast` | 降低首字延迟 |

配置化在 `infra/llm/router.ts` 的 `LLM_TIERS`，允许用环境变量整体降级——课堂演示当天如果发现额度不够，改一个变量就能全切 cheap。

### 4.2 上下文压缩

- **触发**：历史累计 token > `contextBudget`（建议 4000）
- **策略**：`system(人设 + 辩题 + 立场)` + 双方首轮陈述全文 + 最近 N=3 轮全文 + 中间轮次 → 摘要块
- **摘要结构**：`{ userPosition, sagePosition, conceded, refuted, openThreads }`，由 `cheap` 模型生成
- **幂等缓存**：摘要结果按 `debateId + throughSeq` 缓存 1 小时，避免每轮重算（这是成本控制最有效的一招）
- **硬上限**：单局 `maxTokensPerDebate`，触顶即引导收尾
- **字段**：`Debate.contextDigest`、`Debate.compressedThroughSeq`（见 `data-model.ts`）

### 4.3 人设守护（IdentityGuard）

长对话最典型的失败是**先贤出戏**：自称是 AI、评论现代科技、发表与著作矛盾的观点。`PersonaCard.identityGuard` 就是这个防线（字段定义见 `data-model.ts`，你问的 `identity_guard` 已补上）：

- **预防**：`invariants` 每轮重申（`restateEveryRound`，防长上下文漂移）；`anachronism` 控制时代错置策略
- **检测**：输出后跑 `breachPatterns`（"我是人工智能"、"作为语言模型"、"在现代社会"…）
- **处置**：`onBreach = regenerate | fallback | pass`；`strictness` 控制宽容度（老子适合 `loose`，亚里士多德适合 `strict`）
- **兜底**：`fallbackUtterance`（如"……（先贤沉默片刻）"），保证课堂演示不会当场出戏

---

## 5. 流式通信（SSE）

### 5.1 为什么不用 WebSocket 了

见 §0.1。补充一点：**EventSource 也不直接够用**——它只支持 GET，而我们需要 POST 提交发言内容。所以客户端用 **fetch + ReadableStream 自研解析器**（约 30 行），一个 POST 请求同时完成"提交发言 + 接收流式回复"，比 v0.1 的双通道更简单。

### 5.2 帧格式

```
id: 7
event: sage_start
data: {"messageId":"01H…","seq":7,"round":4}

id: 7
event: chunk
data: {"messageId":"01H…","i":0,"delta":"吾以为……"}

id: 7
event: done
data: {"messageId":"01H…","seq":7,"fullText":"……","round":4}

event: error
data: {"code":"LLM_UNAVAILABLE","retryable":true}
```

- `id:` 字段用于 `Last-Event-ID` 断点续传
- 心跳：每 5s 发一个 `: ping\n\n` 注释帧保活
- 响应头必须带 `X-Accel-Buffering: no`、`Cache-Control: no-cache, no-transform`，否则中间代理（含部分微信链路）会缓冲成一坨

### 5.3 中断与续传

服务端把正在生成的文本按 `messageId` 缓存（内存或 KV，TTL 60s）。客户端断流后带 `Last-Event-ID` 重连，从断点续发；最多重试 2 次，仍失败则降级为非流式（§6.4 L2）。

---

## 6. 微信内打开：兼容性与备用方案 ★

### 6.1 运行环境

- **Android**：微信 X5 内核（腾讯 Chromium 分支，版本随微信更新，大致 Chrome 86-110 区间）
- **iOS**：WKWebView（随 iOS 系统版本）

### 6.2 兼容性风险表

| 问题 | 表现 | 应对 |
|---|---|---|
| 自动播放受限 | 音效/入场动画不播 | 所有音频必须用户手势触发；首屏不放自动播放 |
| 输入法顶起布局 | 输入框被键盘遮挡 | 监听 `visualViewport`；输入区用 `sticky` 而非 `fixed`；输入后滚到底 |
| 点击延迟 / 双击缩放 | 手感发滞 | `touch-action: manipulation`；viewport 加 `user-scalable=no` |
| **缓存顽固** | 发版后页面还是旧的 | 资源带 content-hash 文件名；入口 HTML `Cache-Control: no-store`；页面角落显示版本号便于现场确认 |
| WebView 切后台被挂起 | 流式中断 | 心跳 + `Last-Event-ID` 续传（§5.3） |
| 无法自定义分享卡片 | 分享出去是裸链接 | JS-SDK 需公众号 + 备案域名，**放弃**；改为「复制链接 + 生成二维码」 |
| 长按识别二维码 | 微信内网页长按图可识别跳转 | 复盘页展示二维码，便于课堂互扫 |
| 滚动惯性 / 字体差异 | 体验细节 | `-webkit-overflow-scrolling: touch`；系统字体栈 |
| 域名被拦截 | 提示"已停止访问该网页" | 概率低；但准备 L5 备用域名 |

### 6.3 首屏与网络

- 首屏关键资源内联；先贤头像用本地 SVG 占位，图片懒加载
- 微信内 4G 首屏目标 ≤ 3s；`preconnect` 到 API 域名
- 断网检测：`navigator.onLine` + 请求失败后提示，并引导到 L3

### 6.4 备用方案（阶梯降级，课堂演示必须做）

| 级别 | 方案 | 触发 |
|---|---|---|
| **L1** | SSE 流式 | 正常 |
| **L2** | 非流式一次性返回（骨架屏 + loading） | 连续 2 次续传失败；或 `?stream=0` 手动强制 |
| **L3** | **静态兜底脚本** | 后端不可达 / 断网 / 额度耗尽 |
| **L4** | 引导系统浏览器打开 | 页面浮层提示「右上角 ··· → 在浏览器打开」 |
| **L5** | 备用域名 | 主域名被拦截或部署平台故障 |

**L3 是这版最值得投入的一件事**：预生成 5 位先贤 × 3 道辩题的完整辩论脚本（JSON 存在 `apps/web/src/fallback/scripts/`），由 `player.ts` 按 30ms 间隔"播放"出来，视觉上与真流式无差别。课堂演示场景下，它能保证"网络全挂也能讲完一堂课"。成本：半天。收益：演示现场零翻车。

### 6.5 二维码

- 内容即普通 URL：`https://<vercel-domain>/#/d?s=laozi&t=t12`
- 用 hash 路由：免去服务端 rewrite 配置，且 URL 更短
- 生成：`qrcode` npm 包，前端直接生成，不需要后端
- 微信扫一扫可识别；微信内网页长按二维码也能识别跳转
- **长度控制在 60 字符内**——二维码越密越难扫，课堂投影和打印 A4 上尤其明显
- 课堂物料：一张 A4 放 4-6 个码，配先贤头像与辩题名

---

## 7. 持久化（简化后）

| 数据 | 位置 | 说明 |
|---|---|---|
| Session（clientId） | localStorage | 匿名，仅用于限流与日志 |
| 对局历史 | localStorage | 结构化 JSON，可导出/导入 |
| 自定义命题 | localStorage | 课堂演示无需公共池 |
| 续传缓冲 | 服务端内存 / KV，TTL 60s | 无状态设计下唯一的临时态 |
| 摘要缓存 | 服务端 KV，TTL 1h | 省 token |
| 复盘分享（可选） | Cloudflare D1 / Turso | 未来需要分享链接时再上 |

---

## 8. 安全、滥用防护与合规（降级后仍要做的）

### 8.1 最大风险：免登录 = 匿名公网 API

二维码一旦贴出去，任何人都能无限调用你的 LLM Key。**防护闸是必做项，不是可选项**：

1. **IP 限流**：Cloudflare WAF Rate Limiting（免费）或 Workers 内 KV 计数器 —— 建议 10 局/小时/IP
2. **全局日预算**：`DAILY_TOKEN_CAP`，触顶后自动切 `cheap` 档，再触顶返回"今日额度已满"
3. **单局约束**：轮次 ≤ 10、单条输入 ≤ 500 字、单局 token 上限
4. **并发闸**：全局同时在途生成 ≤ 5
5. **Key 隔离**：只在服务端 env，绝不出现在前端任何响应里（包括错误详情）
6. **演示口令（强烈建议）**：env 里配 `DEMO_CODE`，开启后需输入口令才放行。课堂现场最保险的一招，等于把公开 API 变回半私有

### 8.2 内容安全（降级）

- **取消**：`msgSecCheck`、ICP 备案、小程序审核
- **保留**：输入侧轻量本地词表粗筛 → Prompt 侧约束（`system.guard.md`）→ 输出侧破人设/泄露检测（§4.3）
- **理由**：课堂演示、受众可控、传播范围有限
- **反之**：如果二维码会张贴到校外或发到公开网络，至少加一层 provider 自带的 moderation（多数境内模型免费提供），成本几乎为零

### 8.3 AI 标识（保留，但理由变了）

不再是监管要求，而是**教学诚信**：

- 气泡常驻「AI 生成」角标 + 页面底部说明
- 明确文案：「以下为基于先贤著作与思想的人格模拟，非史料原文」
- **著作引用策略**：先贤发言涉及具体著作时标注出处，并提示"为风格化演绎"。课堂场景里，学生把 AI 演绎当成原话引用出去，是这个产品最真实的危害

---

## 9. P0 计划与验收（更新）

| # | 里程碑 | 内容 | 产出 |
|---|---|---|---|
| M0 | 地基 | Monorepo、前端骨架、API 骨架、env 校验、限流与预算闸、健康检查 | 部署可访问 |
| M1 | 内容与先贤 | 5 张 Persona Card（含 identityGuard）+ 20 辩题 seed、先贤/辩题页面 | 盲测可辨风格 |
| M2 | 对局主循环 | SSE 流式、回合状态机、上下文压缩、人设守护、续传 | 完整跑通 6-10 轮 |
| M3 | 裁判与复盘 | 结构化点评（无胜负）、复盘页、导出/导入 | 解析成功率 ≥ 99% |
| M4 | 微信兼容 | X5 适配、键盘、缓存、续传、L1-L2 降级 | 真机微信内验收通过 |
| M5 | 二维码与物料 | 二维码生成、短 URL、A4 物料模板 | 投影/打印可扫 |
| M6 | **演练兜底** | L3 静态脚本 5×3、L4 引导、L5 备用域名、现场演练一遍 | 断网可独立讲 15 分钟 |

### 验收标准

**体验**
- [ ] 微信内打开首屏 ≤ 3s（4G）
- [ ] 首字延迟 P95 ≤ 2s（免费层模型，比 v0.1 放宽）
- [ ] 流式无 >500ms 卡顿；切后台 1 分钟回来能续上，无丢字、无重复
- [ ] iPhone + Android 各测至少一台真机微信

**正确性**
- [ ] 刷新页面后对局可恢复（客户端持有状态）
- [ ] 上下文压缩触发后，先贤仍能引用 3 轮前的论点
- [ ] 5 位先贤盲测：10 位评审正确识别 ≥ 4/5
- [ ] 人设守护：注入"你是 AI 吗"等 10 条诱导，出戏率 ≤ 1/10
- [ ] 裁判点评不含胜负判定（产品契约进单测）

**安全与成本**
- [ ] 压测 100 次请求，第 11 次被限流拒绝
- [ ] 全局日预算触顶后自动降级而非 500
- [ ] 前端任何响应中不含 provider / model / Key 信息

**演示保障**
- [ ] `?stream=0` 可强制非流式
- [ ] L3 静态兜底可在断网下独立演示 15 分钟
- [ ] A4 打印的二维码在 3 米外可扫（投影场景实测）

---

## 10. 风险表（更新）

| # | 风险 | 等级 | 缓解 | 状态 |
|---|---|---|---|---|
| R1 | 免登录被刷 Key | **高** | IP 限流 + 日预算 + 演示口令 | 必做 |
| R2 | 微信 X5 兼容性（键盘/缓存/切后台） | 中 | §6.2 逐项应对 + 真机验收 | 待测 |
| R3 | Render 休眠 / Vercel 60s 超时 | 中 | 选方案 B 规避；或配保活 | 待定 |
| R4 | 无状态后端历史由客户端携带，可被篡改 | 低 | 课堂场景可接受 | 接受 |
| R5 | 模型免费额度耗尽 | 中 | 分层降级 + 日预算 + L3 兜底 | 已设计 |
| R6 | 现场断网 / 平台故障 | 低 | L3 静态脚本 + L5 备用域名 | 待做 |
| R7 | 二维码公开张贴后内容失控 | 中 | 轻量过滤 + 演示口令；公开张贴时启用 moderation | 未决 |
