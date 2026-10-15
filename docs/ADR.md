# Agora · 架构决策记录（ADR）v0.2

> 规则：每个不可逆或高成本的决策都留一条。记录 WHY，不记录 WHAT。
> 状态：Proposed → Accepted → Deprecated / Superseded by ADR-XXX
>
> **v0.2 说明**：项目定位从「微信小程序」改为「H5 网页 + 微信内打开」，定位课堂演示。
> ADR-001/002/003/004/006/008 被废弃或取代（保留原文以便追溯当时的约束），新增 ADR-009 ~ ADR-015。
> ADR-005、ADR-007 不受影响，继续有效。

## 决策索引

| # | 标题 | v0.2 状态 |
|---|---|---|
| 001 | MVP 前端采用原生小程序 | **Superseded by ADR-009** |
| 002 | 输入 HTTPS + 输出 WS 双通道 | **Superseded by ADR-010** |
| 003 | Drizzle + SQLite→Postgres 双驱动 | **Superseded by ADR-011** |
| 004 | AI 输出首句缓冲 + 异步送审 + 撤回 | **Deprecated**（ADR-012） |
| 005 | 裁判只点评不判胜负 | ✅ Accepted（不受影响） |
| 006 | scene 短码映射 | **Superseded by ADR-013** |
| 007 | Prompt 文件版本化管理 | ✅ Accepted（不受影响） |
| 008 | 后端 Fastify | **Superseded by ADR-014** |
| **009** | **从微信小程序改为 H5 网页** | ✅ Accepted（新增） |
| **010** | **流式改用 SSE（fetch + ReadableStream），弃用 WebSocket** | ✅ Accepted（新增） |
| **011** | **后端无状态化，持久化下沉客户端** | ✅ Accepted（新增） |
| **012** | **合规降级，但滥用防护升级为必做** | ✅ Accepted（新增） |
| **013** | **二维码 = 普通 URL 二维码 + hash 路由** | ✅ Accepted（新增） |
| **014** | **运行时选型：Hono on Cloudflare Workers（主）/ Next.js on Vercel（备）** | ✅ Accepted（新增） |
| **015** | **前端框架 React + Vite（前端选型不再关键）** | ✅ Accepted（新增） |

---

## ADR-009：从微信小程序改为 H5 网页

**Status**: Accepted（2026-10-12）

**Context**
项目定位调整为**课堂演示**。原小程序方案的前置成本与定位不匹配：
- 需要 ICP 备案域名 + HTTPS 证书（周期数周）
- 需要小程序注册、类目选择、提审（AI 生成内容类目审核不确定性高）
- 需要企业/个体工商户主体，个人主体受限多
- 需要 `msgSecCheck`、隐私协议、2MB 主包治理
课堂演示的核心诉求是**本周就能用、零成本、随时改随时发版**，小程序方案的每一条前置成本都不创造教学价值。

**Decision**
改为纯 H5 网页（React + Vite），部署在 Vercel 默认域名，微信内直接打开，扫码用普通 URL 二维码。取消登录、取消备案、取消 `msgSecCheck`、取消主包限制。

**Consequences**
- 更容易：零成本、免审核、免备案、发版即时生效、调试用桌面浏览器即可。
- 更困难：
  - 失去 `wx.login` 身份 → 变成匿名公网 API，必须自建限流与预算闸（ADR-012）
  - 失去小程序码 → 二维码是普通 URL，识别率依赖 URL 长度（ADR-013）
  - 失去微信原生分享卡片 → 只能靠复制链接/二维码传播
  - 需要自己处理微信 X5 内核兼容性（ARCHITECTURE §6）
- **意外收获**：H5 支持 SSE，WebSocket 不再是必需品（ADR-010），部署自由度大幅提升。

---

## ADR-010：流式改用 SSE（fetch + ReadableStream），弃用 WebSocket

**Status**: Accepted

**Context**
v0.1 选 WebSocket 的唯一理由是「小程序不支持 SSE」。改 H5 后这个约束消失。而 WebSocket 在零成本部署下是明确的负债：
- Vercel Serverless **不支持** WebSocket（无状态函数无法维持连接升级）
- Render 免费层支持 WS，但 15 分钟无请求即休眠，冷启动约 50 秒——课堂演示现场必然翻车
- Cloudflare Workers 需要 Durable Objects 才能做 WS，复杂度上升一个量级
SSE 是纯 HTTP，任何 Serverless 都能跑。

**Decision**
- 服务端：`POST /api/debate/:id/utterance` 直接返回 `text/event-stream`，**一个请求同时完成"提交发言 + 接收流式回复"**，比 v0.1 的双通道更简单。
- 客户端：**自研 fetch + ReadableStream 解析器**（约 30 行），不用 `EventSource`——因为 `EventSource` 只支持 GET（我们需要带 body 的 POST），且不能带自定义 header（需要 `X-Session-Id`）。
- 续传：用 SSE 的 `id:` 字段 + `Last-Event-ID`，服务端按 `messageId` 缓存 60s。
- 响应头强制 `X-Accel-Buffering: no` + `Cache-Control: no-transform`，防中间代理缓冲。

**Consequences**
- 更容易：后端可跑在任何 Serverless；无连接管理、无心跳协议（改用 SSE 注释帧）、无并发连接数限制。
- 更困难：
  - SSE 单向——但输入本来就是 POST，不构成损失
  - 微信 X5 与部分链路可能缓冲流 → 需在真机验证，失败降级 L2（非流式）
  - 依赖服务端 60s 续传缓冲；多实例部署时缓冲需搬到 KV

---

## ADR-011：后端无状态化，持久化下沉客户端 localStorage

**Status**: Accepted

**Context**
SQLite 在新部署目标上不可用：Vercel 文件系统只读（除 `/tmp`）、Cloudflare Workers 无文件系统、Render 免费层磁盘 ephemeral。而引入外部数据库（Postgres/Turso/D1）会立刻吃掉"零成本 + 零运维"的预算。

**Decision**
- 后端**完全无状态**：不落库，对局状态由客户端持有，每次请求携带 `history[]` 与 `contextDigest`。
- 客户端 `localStorage` 存：Session(clientId)、对局历史、自定义命题。
- 服务端只保留两类临时态：续传缓冲（60s TTL）、摘要缓存（1h TTL，省 token）。
- 未来若需要"分享复盘链接"，再引入 Cloudflare D1 或 Turso（都有免费层，D1 即 SQLite 语义，迁移成本近乎为零）。

**Consequences**
- 更容易：部署自由度最高、成本为零、无 ORM 与迁移的心智负担。
- 更困难：
  - 历史由客户端携带，**可被篡改**。课堂演示场景接受（无作弊动机），但若未来要做积分/排行榜必须重新设计。
  - 换设备即丢失对局记录 → 提供导出/导入 JSON 补偿。
  - 请求体随轮次增大 → 必须配上下文压缩（ARCHITECTURE §4.2），否则后期请求体过大。

---

## ADR-012：合规降级，但滥用防护升级为必做

**Status**: Accepted

**Context**
取消 `msgSecCheck`、备案、审核后，内容合规压力下降；但**免登录 + 公开二维码**意味着 LLM 接口变成匿名公网 API——任何人扫码即可无限调用，Key 可能在一天内被刷爆。风险等级从"合规"转移到"成本与可用性"。

**Decision**
- **降级**：取消 `msgSecCheck`；保留输入侧轻量本地词表粗筛 + Prompt 侧约束 + 输出侧破人设检测。若二维码会张贴到校外/公开网络，至少启用 provider 自带 moderation（多数境内模型免费提供）。
- **升级为必做的防护闸**：
  1. IP 限流（Cloudflare WAF 或 KV 计数器），建议 10 局/小时/IP
  2. 全局 `DAILY_TOKEN_CAP`，触顶自动降档到 cheap，再触顶返回友好提示
  3. 单局轮次 ≤ 10、单条输入 ≤ 500 字、单局 token 上限
  4. 全局并发闸 ≤ 5
  5. **演示口令 `DEMO_CODE`**：开启后需口令才放行——课堂现场最保险的一招
- **保留 AI 标识**，但理由从监管合规改为**教学诚信**：气泡角标 + 页面说明 + 著作引用标注「为风格化演绎」。课堂场景里，学生把 AI 演绎当成史料原话引用出去，是这个产品最真实的危害。

**Consequences**
- 更容易：无审核依赖、无备案周期、无第三方审核成本。
- 更困难：限流与预算逻辑必须自己写对；误伤正常用户（同一教室 NAT 出口 IP 相同）的风险需要考虑——建议按 IP + clientId 复合计数，并放宽到 30 局/小时/教室场景。

---

## ADR-013：二维码 = 普通 URL 二维码 + hash 路由

**Status**: Accepted

**Context**
不再用 `wxacode.getUnlimited`，因此 32 字符 scene 限制消失。二维码内容就是普通 URL，微信扫一扫可识别，微信内网页长按也能识别跳转。

**Decision**
- 用 **hash 路由**：`https://<domain>/#/d?s=laozi&t=t12&st=pro`。免去服务端 rewrite 配置，且 URL 更短。
- **URL 长度目标 ≤ 60 字符**。32 字符的硬限制没了，但限制因素变成了**二维码识别率**——越密越难扫，课堂投影和打印 A4 上尤其明显。
- 生成用 `qrcode` npm 包，**前端即可生成**，不需要后端接口，也不需要 `wxacode_assets` 映射表。
- 分享复盘用同一套 URL（复盘数据从 localStorage 读，跨设备则需 ADR-011 的持久化扩展）。

**Consequences**
- 更容易：无需 access_token 中控、无需码图存储与 CDN、码图可随时重新生成。
- 更困难：失去"码印出去后 payload 仍可改"的能力（URL 是死的）→ 需要变更时只能重印。用短参数 key（`s=laozi`）而非 id，可读性更好且不易变。

---

## ADR-014：运行时选型 —— Hono on Cloudflare Workers（主）/ Next.js on Vercel（备）

**Status**: Accepted

**Context**
候选清单里的三个后端宿主，可行性差异极大：
- **Vercel Serverless**：不支持 WS（可接受，已改 SSE）；冷启动 1-3s；Hobby 计划 `maxDuration` 上限 60s，长生成有超时风险。
- **Render 免费层**：支持 WS；但 15 分钟无请求即休眠、冷启动约 50 秒——课堂演示现场必然翻车，除非配外部保活。
- **Railway**：自 2024 年起已取消免费计划，只剩试用额度 → **排除**。
- **Cloudflare Workers（第四个选项）**：几乎无冷启动（<50ms）；流式等待 LLM 的时间不计入 CPU 时间（免费层 10ms CPU/请求的限制不影响流式代理）；无墙钟时长限制；免费额度充裕。

**Decision**
- **主选**：Hono on Cloudflare Workers（后端）+ Vercel 静态前端。稳定性压倒一切——课堂演示的第一诉求是"不能翻车"。
- **备选**：全栈 Next.js on Vercel（App Router + Route Handlers）。一个仓库一次部署，最省心；代价是 60s 时长上限与偶发冷启动。
- 两者都用 `Request → Response` 模型，后端业务代码几乎可复用。
- 若坚持用 WebSocket，只有 Render 可选，且必须配 UptimeRobot 每 10 分钟自 ping 保活。**不推荐**。

**Consequences**
- 更容易：零成本、无休眠、全球边缘低延迟、Workers KV 可直接做限流与缓存。
- 更困难：需要 CORS 配置；Workers 环境不是完整 Node（部分 npm 包不兼容，需选 edge 友好的依赖）；本地调试依赖 `wrangler dev`。

---

## ADR-015：前端框架 React + Vite（这条不再关键）

**Status**: Accepted

**Context**
H5 方案下前端框架的选择自由度很高，React 与 Vue 都能满足需求，没有架构级的强约束。

**Decision**
采用 React 18 + Vite + TypeScript + Tailwind，状态管理用 `zustand`。若选 ADR-014 的备选方案，则直接用 Next.js。

**理由**：Vercel 生态同源；AI 流式渲染的现成参考绝大多数是 React；`zustand` 足够轻。

**Consequences**
- 这不是一条强决策。**如果你本人更熟 Vue 3，选 Vue 的收益大于框架本身的差异**——直接改，不必为此写 ADR。
- 真正的约束在别处：流式渲染的节流（每次 token 都触发 React 重渲染会卡）、微信键盘适配（§6.2）、离线兜底（§6.4 L3）。这些与框架选择无关。

---

# 以下为 v0.1 决策（保留原文以便追溯当时的约束）

## ADR-001：MVP 前端采用原生小程序（TypeScript + Skyline），不使用 Taro

**Status**: **Superseded by ADR-009**

**Context**
Agora 首版只投放微信小程序一个端。Taro 的核心价值是跨端复用，在本项目中该价值为零；而它的代价是确定的：Skyline 渲染引擎、`wx.getPrivacySetting` 等隐私接口、`wxacode` 新参数、WebSocket 底层控制都需要等社区适配，通常滞后 1-3 个月。

**Decision**
采用原生小程序 + TypeScript + Skyline。

**Consequences**
- 更容易：WS 流式完全可控、新 API 即时可用、包体最小。
- 更困难：npm 生态需「构建 npm」；跨端需重写视图层。

---

## ADR-002：双通道通信 —— 用户输入走 HTTPS，AI 输出走 WebSocket 流式

**Status**: **Superseded by ADR-010**

**Context**
微信小程序不支持 SSE，AI 输出必须走 WebSocket 才能流式。但用户输入需要同步拿到内容安全审核结果、落库并返回 `messageId`、需要幂等。

**Decision**
输入走 `POST /debate/:id/utterance`，输出走 WS，两条通道靠 `debateId + seq` 关联。

**Consequences**
- 更容易：输入路径可靠可测、安全审核天然同步。
- 更困难：客户端要维护两套传输层的错误语义。
- **为何作废**：约束（小程序不支持 SSE）消失，且 WS 与零成本 Serverless 部署根本冲突。

---

## ADR-003：Drizzle ORM + 双驱动（本地 SQLite / 生产 Postgres）

**Status**: **Superseded by ADR-011**

**Context**
「SQLite（MVP）→ Postgres」隐含一次后期迁移，风险集中爆发在上线前。

**Decision**
本地 SQLite、生产 Postgres，同一份 Drizzle schema，两套 driver。

**Consequences**
- **为何作废**：Serverless 环境下文件系统不可用，SQLite 这条路径在新部署目标上根本不成立；且课堂演示不需要服务端持久化。

---

## ADR-004：AI 输出采用「首句缓冲送审 + 流式下发 + 命中撤回」

**Status**: **Deprecated**

**Context**
合规要求 AI 生成内容必须过检，产品体验要求流式输出，二者冲突。

**Decision**
首句送审后开始下发，后续分句异步送审，命中即撤回。

**Consequences**
- **为何作废**：`msgSecCheck` 随小程序方案一起取消。降级为「本地词表粗筛 + Prompt 约束 + 破人设检测」，见 ADR-012。
- 保留的部分：**人设守护**（`identityGuard`）不仅保留，还被强化为独立机制（ARCHITECTURE §4.3）——因为它防的是"先贤出戏"，这是产品失败，与合规无关。

---

## ADR-005：裁判只点评不判胜负（领域层硬约束）

**Status**: ✅ **Accepted**（不受本次变更影响）

**Context**
产品定位是「吵架」，不是「打擂台」。设绝对胜负会让用户把注意力从思辨转移到赢，且 AI 裁判判"AI 先贤赢"会显得既傲慢又可疑。

**Decision**
`Verdict` 数据模型**不含 winner 字段**，只有维度分（clarity / evidence / logic / rebuttal / style）、亮点引用、改进建议、总结陈词。用领域层单测断言该契约。

**Consequences**
- 更容易：产品调性统一；避免排行榜攀比。
- 更困难：失去一个天然的留存抓手。课堂演示场景下这恰恰是优点——不需要留存。

---

## ADR-006：小程序码 scene 使用短码映射，不塞明文参数

**Status**: **Superseded by ADR-013**

**Context**
`wxacode.getUnlimited` 的 scene 上限 32 字符，明文塞参数会导致加参数就要重印所有码。

**Decision**
`scene = "s" + base62(9)`，服务端 `wxacode_assets` 表维护映射。

**Consequences**
- **为何作废**：不再使用小程序码。改为普通 URL 二维码，短参数直接写在 URL 里（ADR-013）。「码印出去后 payload 可改」的能力随之失去。

---

## ADR-007：Prompt 以文件形式版本化管理，不入库

**Status**: ✅ **Accepted**（不受本次变更影响）

**Context**
MVP 阶段先贤人设 Prompt 会频繁调整。放数据库后台编辑会出现"线上行为变了但无人知道改了什么"的不可追溯状态。

**Decision**
Prompt 存 `prompts/sages/*.v1.md`，走代码仓库与 Code Review。每条 message 落库记录 `personaVersion`；v0.2 追加 `guardVersion`（人设守护版本）。

**Consequences**
- 更容易：可追溯、可回滚、可 diff。
- 更困难：非技术同学改不了 Prompt。课堂演示场景下，改 Prompt 的人就是你本人，不构成问题。

---

## ADR-008：后端使用 Fastify 而非 NestJS / Express / Python

**Status**: **Superseded by ADR-014**

**Context**
单人全栈项目，需要 WebSocket 流式、请求校验、结构化日志、低心智负担。

**Decision**
Node 20 + TypeScript + Fastify 4 + `@fastify/websocket`。

**Consequences**
- **为何作废**：Fastify 依赖常驻 Node 进程，与 Serverless/Workers 部署模型不匹配。改为 Hono（ADR-014），它与 Fastify 的设计哲学相近（轻量、中间件、schema 校验），迁移心智成本低。
