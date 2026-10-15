# Agora API · P0

Hono + SSE 后端。单实例、内存态、零成本部署。

## 跑起来

```bash
cd apps/api
npm install

# 方式 A：没有 API Key 也能跑（内置 mock 假流，用于验证链路 / 断网兜底）
LLM_PROVIDER=mock npm start

# 方式 B：接真实模型
cp .env.example .env      # 填 LLM_BASE_URL / LLM_API_KEY / 模型名
npm start
```

打开 http://localhost:8787/ 是最小验证页（含「加载中 + 超时重试」）。

### 配置优先级

`命令行环境变量` > `.env 文件` > 内置默认值。
`.env` 由 `dotenv` 加载（`src/config/env.ts` 顶部），且 dotenv 不覆盖已有的 `process.env`——
所以 `LLM_PROVIDER=mock npm start` 能临时压过 `.env` 里写死的 `openai`，调试时很方便。

## 换模型供应商

只改三个环境变量，代码零改动（OpenAI 兼容协议）：

| 供应商 | LLM_BASE_URL | 模型示例 |
|---|---|---|
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| 月之暗面 | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| 智谱 | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` |
| 硅基流动 | `https://api.siliconflow.cn/v1` | `Qwen/Qwen2.5-7B-Instruct` |
| 阿里通义 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| 本地 Ollama | `http://localhost:11434/v1` | `qwen2.5` |

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/healthz` | 健康检查（**免费云保活打这个**） |
| GET | `/api/personas` | 先贤列表 |
| GET | `/api/topics` | 题库（20 道） |
| POST | `/api/debate` | 建局 |
| GET | `/api/debate/:id` | 取对局状态（刷新页面恢复用） |
| POST | `/api/debate/:id/opening` | 先贤开场（SSE） |
| POST | `/api/debate/:id/turn` | 玩家发言 → 先贤回应（SSE） |
| POST | `/api/debate/:id/judge` | 裁判点评（SSE） |
| DELETE | `/api/debate/:id` | 结束并删除 |

SSE 事件：`start` / `delta` / `done` / `digest` / `guard` / `round_end` / `error`，每帧带 `id`（= seq）用于断点续传。

续传：断流后重发同一请求，带 header `X-Resume-Seq: <seq>`，服务端会补发已生成内容再继续。

## 验证

```bash
npm run typecheck   # 类型检查
npm run smoke       # mock 模式跑通全链路（26 项断言）

npm run pace        # 节奏测量：字数 / 首字延迟 / 帧间隔 / 传输开销
npm run probe       # 人设探针：5 条边界问题验证柏拉图人格（需真 Key）
npm run probe socrates   # 只跑「你和苏格拉底什么关系」那一条
```

**节奏测量**量的四件事：每轮中文字数（对照 150–200 目标）、首字延迟、帧间隔、
扣掉 mock 人为延迟后的传输层开销。默认每帧 250ms 模拟打字机手感，
冒烟时保持 60ms 求快——用 `MOCK_DELAY_MS` 调。

**人设探针**跑 5 个边界：苏格拉底身份（核心）、诱导复述「我一无所知」、
AI 身份攻击、时代边界（2026）、现代术语处理。每条独立建局，避免上下文污染；
判据复用 `PLATO.identityGuard` 的破防模式，与线上守卫同一套。

**其他工具**

```bash
npm run guard-test      # 守卫有效性：16 条必须命中 + 7 条必须放行（误伤即失败）
npm run length-fit-test # 长度软截断的边界用例
npm run ping            # 换供应商后验证 Key 连通性（1 次最小请求）
npm run origin          # Key 归属探测：对 7 个平台发同一 Key，找出它到底是谁家的
```

`npm run origin` 值得记一下：用户填错过 Key（拿智谱的 Key 配 DeepSeek 的地址），
靠它对 7 个平台各发一次最小请求定位到真实归属，比逐个试快得多。

## ⚠️ 部署前提：单实例

对局状态在进程内存里。**免费云默认单实例，正好合适。**
一旦横向扩容，A 实例建的对局在 B 实例上查不到。扩容前先把 `src/infra/store/memoryStore.ts`
换成 Redis / Cloudflare D1 / Turso 实现（接口不用改）。

内存只维持「当前活跃对局」：TTL 2 小时、上限 200 局，超了自动淘汰最久未更新的。
课堂演示不会同时有几十局，够用。

## 保活

免费云（如 Render）15 分钟无请求会休眠，冷启动约 50 秒。用 UptimeRobot / cron-job.org
每 5–10 分钟打一次 `/api/healthz` 即可。前端验证页已内置「加载中 + 超时重试」，
即使真冷启动也不会白屏。

## 目录

```
src/
├─ domain/     纯领域层（状态机 / Prompt / 压缩 / 人设守护 / 情绪），不依赖框架
├─ infra/      LLM 适配器、SSE、内存存储、续传通道、限流
├─ routes/     HTTP 接口
├─ personas/   先贤卡片
├─ data/       题库
└─ prompts/    人格 prompt（运行时源，改这里）
```
