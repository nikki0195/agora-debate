# Agora 公网部署指南（Vercel + Render）

> 目标：把「localhost:8787」变成公网 HTTPS 地址，微信扫码即玩。
> 适合人群：学生 · 零预算 · 零运维。全程只用网页点按钮，不碰服务器命令行。

---

## 0. 两种架构，先选一个

| | 方案 A：Render 单服务 | 方案 B：Vercel 前端 + Render 后端（本文主线） |
|---|---|---|
| 部署几个平台 | 1 个 | 2 个 |
| 代码改动 | **0 行** | 6 处已全部落地（见第 1 节） |
| CORS | 不存在（同源） | 后端已是 `origin:*`，开箱即用 |
| 静态资源速度 | 一般 | Vercel CDN，快 |
| 冷启动 | 一样睡 | 一样睡 |
| 适合 | 怕折腾，先上线跑通 | 想顺便拥有一个"正经前端域名" |

**建议**：按你原计划走方案 B（前端 Vercel、后端 Render）。代码侧已无事可做（6 处改动全部落地并回归通过），你剩下的操作就是：push GitHub → 部署 → 回填一个域名。如果看完第 3、4 节还是嫌烦，回头做方案 A，把 `apps/api` 整个 deploy 到 Render 即可，第 3 节步骤完全适用。

最终形态：

```
微信扫码 → https://agora-xxx.vercel.app        （前端：index.html / app.js / style.css）
                │  fetch('/api/*')
                ▼
        https://agora-api-xxx.onrender.com     （后端：Hono + SSE + LLM）
```

---

## 1. 部署前代码修改清单（只列改动点）

> 以下改动**已全部落地并回归通过**（typecheck / smoke / fe-smoke 39 项 / e2e / mock-test 全绿）。
> 你只需要：push 到 GitHub → 按第 3、4 节部署 → 回填 `agora.config.js` 里的域名。

### 必改 4 处（方案 B 才需要；方案 A 一行都不用改）

**① `apps/api/public/app.js` 第 5 行**

```js
// 改前
const BASE = location.origin;
// 改后
const BASE = window.__AGORA_API_BASE__ || location.origin;
```

作用：本地跑没有 `__AGORA_API_BASE__`，走 `location.origin`（= localhost:8787），现状不变；线上 Vercel 页面会先加载配置文件把 Render 域名塞进这个全局变量，所有 `/api/*` 和 `demo-dialogues.json` 就都打给 Render 了。全文件只有这一处 BASE 定义（其余 10 处调用都是 `BASE + path`），改一行全通。

**② 新建 `apps/api/public/agora.config.js`**（已创建，带 localhost 守卫）

```js
if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1' && location.hostname !== '') {
  window.__AGORA_API_BASE__ = 'https://agora-api-xxx.onrender.com';
}
```

守卫的作用：本地开发（含 file:// 双击打开）自动跳过，`play.cmd` 一键试玩不受影响；只有部署到 Vercel 后才注入后端地址。**部署 Render 拿到域名后，把 `xxx` 换成真实服务名，git push，Vercel 自动重新部署。**

**③ `apps/api/public/index.html`**：`<script src="/app.js">` 之前已加 `<script src="/agora.config.js"></script>`。顺序不能反：config 必须先于 app.js 执行，否则 BASE 读不到。

**④ `apps/api/src/app.ts`**：`STATIC_ASSETS` 白名单已注册 `/agora.config.js`。本地 Hono 只 serve 白名单内的静态文件，不注册的话本地访问会 404（Vercel 托管整个目录不受影响，但本地开发会中招）。

### 已落地的防坑改动

**⑤ `apps/api/package.json`**：`tsx` 已从 devDependencies 挪进 dependencies，**`package-lock.json` 已用 `npm install --package-lock-only` 重算同步**（tsx 及其依赖树的 dev 标记已清除，Render 用 `npm ci` 也不会再报锁文件不同步）。现在任何平台默认 `npm install` + `npm start` 都能起。Render 构建命令仍建议写 `npm install --include=dev`（双保险，typecheck 等 dev 脚本也可用）。

**⑥ 新建 `apps/api/public/vercel.json`**：给 `/`、`/index.html`、`/app.js`、`/agora.config.js` 加了 `Cache-Control: no-cache`。治“改了后端地址但手机/微信里还是旧页面”的缓存幽灵，静态部署第一大坑。

### 零改动项（已满足，列出来让你放心）

| 项 | 现状 |
|---|---|
| API Key 不写死 | `src/config/env.ts` 全走 `process.env`（dotenv），全仓无硬编码密钥；`.gitignore` 已挡 `.env` |
| 端口 | 读 `env.PORT`，Render 自动注入 PORT，直接通 |
| 监听地址 | `@hono/node-server` 不传 hostname = 通配绑定，外网可达 |
| CORS | `src/app.ts` 第 35 行已是 `origin: '*'`，Vercel 域名直接放行（无 cookie 无凭证，演示项目够用；想收紧见文末 FAQ） |
| SSE 保活 | 5 秒心跳 + `X-Accel-Buffering: no`，防中间代理缓冲/判空闲 |
| 前端流式读取 | `fetch + getReader`（非 EventSource），微信内置浏览器兼容 |
| 保活端点 | `/api/healthz` 已存在，UptimeRobot 打这个 |
| 移动端适配 | viewport、`viewport-fit=cover` 已在 |

### 环境变量（Render 网页后台配，不算代码）

部署时在 Render 后台逐条加（见第 3 节截图级步骤）：

| 键 | 值 | 备注 |
|---|---|---|
| `LLM_PROVIDER` | `openai` | 想先零成本验证链路可先填 `mock`，通了再改 |
| `LLM_BASE_URL` | `https://open.bigmodel.cn/api/paas/v4` | 智谱 |
| `LLM_API_KEY` | 智谱控制台复制的 Key | **只填在 Render 后台，不进代码不进 GitHub** |
| `LLM_MODEL_STRONG` | `glm-4-flash` | |
| `LLM_MODEL_FAST` | `glm-4-flash` | |
| `LLM_MODEL_CHEAP` | `glm-4-flash` | |
| `RATE_LIMIT_PER_IP` | `300` | ⚠️ 默认 30/小时。校园 WiFi 是 NAT，全班一个公网 IP，30 次瞬间打满，改 300 |
| `DAILY_TOKEN_CAP` | `200000` | 默认值，防刷额度，保持 |

`PORT` 不用配，Render 自动注入。

---

## 2. 推到 GitHub（Render/Vercel 都从 GitHub 部署）

项目现在还不是 git 仓库，先初始化。用 Git Bash 或 PowerShell：

```bash
cd C:\Users\Huawei\WorkBuddy\2026-10-12-23-15-38
git init
git add .
git status          # ← 务必看一眼：列表里不能出现 .env 和 node_modules
git commit -m "Agora 部署版"
```

去 github.com → New repository → 名字 `agora` → **Public**（Private 也行，Render/Vercel 免费档都支持私有库）→ 创建后按页面提示：

```bash
git remote add origin https://github.com/你的用户名/agora.git
git branch -M main
git push -u origin main
```

**防泄密检查**：`git status` 里 `.env` 必须不存在（.gitignore 已挡，确认一眼即可）。智谱 Key 只活在两个地方：Render 后台 + 你本机 `.env`。

---

## 3. Render 部署后端（保姆级）

1. **render.com** 注册（用 GitHub 账号一键登录，免验证邮箱）。
2. 右上 **New +** → **Web Service** → **Build and deploy from a Git repository** → 授权 GitHub → 选 `agora` 仓库 → Connect。
3. 配置页逐项填：

   | 页面项 | 填什么 |
   |---|---|
   | Name | `agora-api`（决定域名前缀） |
   | Region | **Singapore**（离国内最近的免费区，Oregon 慢一倍） |
   | Branch | `main` |
   | Root Directory | `apps/api` ⚠️ 最关键的一格，别留空 |
   | Runtime | `Node` |
   | Build Command | `npm install --include=dev` |
   | Start Command | `npm start` |
   | Instance Type | **Free** |

4. 往下滑 **Environment Variables**：点 **Add** 逐条加第 1 节表格里那 8 个键值对。
5. 点 **Create Web Service**。等 2-4 分钟，日志出现 `Agora API 已启动` 即成功。
6. 拿域名：页面左上角显示 `https://agora-api-xxx.onrender.com`（每个人的 xxx 不同）。
7. **验证**：浏览器打开 `https://agora-api-xxx.onrender.com/api/healthz`，返回 JSON 即通。

> 免费版规矩：15 分钟无请求自动休眠；再唤醒首请求要 30-60 秒（冷启动）。第 6 节保活就是治这个。

---

## 4. Vercel 部署前端（保姆级）

1. **vercel.com** 注册（同样 GitHub 一键登录）。
2. **Add New…** → **Project** → Import `agora` 仓库。
3. 配置页：

   | 页面项 | 填什么 |
   |---|---|
   | Framework Preset | **Other** |
   | Root Directory | `apps/api/public` ⚠️ 同样关键 |
   | Build Command | **留空**（纯静态，无构建） |
   | Output Directory | **留空** |
   | Install Command | **留空** |

4. **Deploy**。30 秒后拿到 `https://agora-xxx.vercel.app`。
5. **回填后端地址**（关键一步，否则前端找不到后端）：
   编辑本机 `apps/api/public/agora.config.js`，把第 3 步拿到的 Render 域名填进去（只换 URL，守卫原样保留）：

   ```js
   window.__AGORA_API_BASE__ = 'https://agora-api-换成你的.onrender.com';
   ```

   然后 `git commit -am "config: 后端地址" && git push`。Vercel 检测到 push 自动重新部署，1 分钟后生效。

> `apps/api/public/vercel.json` 已预置 `no-cache` 响应头（治缓存幽灵），Vercel 自动读取，无需任何操作。

---

## 5. 公网二维码

拿到 `https://agora-xxx.vercel.app` 后任选：

- **cli.im**（草料二维码）：粘贴网址 → 免费下载 PNG。微信内打开网址类二维码可能要求登录，换 **api.qrserver.com**（`https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=你的网址`，直接浏览器打开另存）；
- 或者把域名发我，我用 Python 现场生成一张 PNG 给你。

二维码指向 Vercel 域名即可（它是入口，接口自动转发 Render）。

---

## 6. UptimeRobot 保活（治 Render 休眠）

1. **uptimerobot.com** 注册免费档（50 个监控点，够用）。
2. **+ New Monitor**：

   | 项 | 填什么 |
   |---|---|
   | Monitor Type | `HTTP(s)` |
   | Friendly Name | `agora-keepalive` |
   | URL | `https://agora-api-xxx.onrender.com/api/healthz` |
   | Monitoring Interval | `5 minutes`（免费档最低 5 分钟；Render 15 分钟才睡，5 分钟一拍不会睡） |

3. Create。后台变绿即生效。

> 备选：**cron-job.org**（免费可设 1 分钟一次），二选一即可，不用都装。
> 原理：每 5 分钟一个请求把休眠计时器清零。代价是 Render 免费额度 750 小时/月，保活恰好用得完，不超。

---

## 7. 微信内访问 · 实话篇

**会不会被拦截？** 不会。`vercel.app` / `onrender.com` 都不在微信域名黑名单；两家默认带有效 HTTPS 证书；页面无诱导分享、无支付、不碰 JS-SDK，微信内置浏览器正常打开。

**SSE 会不会断流？** 风险已压到最低，机制如下：
- 后端 5 秒一个 `: ping` 心跳，中间任何代理都不会判定空闲掐线；
- 响应头带 `X-Accel-Buffering: no`，禁缓冲；
- Render Web Service 对请求时长无硬限制（不是 30 秒斩断那种平台）；
- 前端用 `fetch + getReader` 逐块读，不用 EventSource（微信 Android 对 EventSource 一向不友好）；
- 万一微信 iOS 锁屏/切后台被系统杀连接：后端实现了 `X-Resume-Seq` 断线续传，重连后从断点继续，前端也有「超时重试」按钮兜底。
- glm-4-flash 生成一段 120-200 字只要 2-6 秒，撞不上 45 秒的 `LLM_TIMEOUT_MS_STRONG`。**若以后换成 DeepSeek-R1 这类慢思考模型，务必把 `LLM_TIMEOUT_MS_STRONG` 调到 120000+。**

**真正的短板是速度，不是拦截**：服务器在境外，国内 4G/5G RTT 200-400ms。体感：试玩模式几乎无感（只首次拉一次剧本 JSON）；深度模式首字 3-8 秒，之后流式吐字。想丝滑得国内服务器 + 域名备案，学生阶段不划算，先跑起来。

---

## 8. 部署后验收标准（4G/5G 逐条勾）

**电脑侧（先自测）**
0. **一条命令验收后端**（拿到 Render 域名后，在 `apps/api` 目录跑）：
   ```bash
   node scripts/probe-online.mjs https://agora-api-xxx.onrender.com https://agora-xxx.vercel.app
   ```
   脚本自动查：healthz 200、5 位先贤、20 道辩题、试玩剧本五贤齐全、前端首页可开、`agora.config.js` 已回填真实域名（没回填直接 FAIL 并提示）。全 PASS = 部署达标。只发 GET 请求，不消耗智谱额度，可反复跑。
1. 无痕窗口开 Vercel 域名，首页 1-3 秒出来（改过 `agora.config.js` 后必须无痕，防缓存旧版）。
2. F12 → Network：`index.html / app.js / style.css` 来自 `vercel.app`；Console 无红色报错。
3. 试玩模式完整走两轮出引流卡；期间对 `onrender.com` 的请求只有 1 个 `demo-dialogues.json`。
4. 深度模式发一句话：Network 出现 `POST /api/debate/xxx/turn`，10 秒内开始流式吐字（冷启动后首次可能 30-60 秒，第二次起必须 10 秒内）。
5. 流式中途停顿不超过 10 秒；裁判点评能出分享卡。

**手机侧（关 WiFi，开 4G/5G）**
6. 微信扫二维码 → 页面正常打开，布局无横向滚动。
7. 微信内完整跑一局试玩 + 深度模式 2-3 个回合，无白屏、无卡死、无「网络错误」红字。
8. 锁屏 30 秒解锁，页面还在，或重进后能继续（续传兜底）。
9. 换一台手机（不同运营商）再扫一次，同样正常。
10. UptimeRobot 后台显示绿灯；Render 日志无 CORS 报错。

**保活**
11. 闲置 20 分钟后手机再开，60 秒内能玩（冷启动一次），之后流畅。

---

## 9. 常见坑速查

| 症状 | 原因 | 解法 |
|---|---|---|
| Render 部署日志报 `tsx: not found` | NODE_ENV=production 跳装 devDeps | Build Command 确认是 `npm install --include=dev`，或把 tsx 移进 dependencies |
| 前端能开但一点辩论就转圈 | `agora.config.js` 没回填或没 push | 回填 Render 域名并 push，等 Vercel 重新部署完用无痕验证 |
| 深度模式报 429 | `RATE_LIMIT_PER_IP` 还是默认 30，校园 NAT 打满 | Render 后台改成 300 |
| 深度模式报「LLM_PROVIDER=openai 时必须设置 LLM_API_KEY」 | Key 没配或配错变量名 | Render 后台检查 8 个变量拼写 |
| 国内访问奇慢 | 免费区在境外 | Region 选 Singapore；只影响深度模式，试玩无感 |
| 改了代码没生效 | Vercel 缓存静态文件 | 无痕窗口验证；或 Vercel 项目里 Redeploy |
| 重启 Render 后对局全丢 | 对局在内存里 | 正常，免费单实例的预期；想持久化以后接数据库（超出本次范围） |

---

## 10. 附：本项目的部署相关事实（审计结论）

- 密钥：全仓无硬编码，`env.ts` 统一读 `process.env`，`.gitignore` 双层拦截 `.env`
- 单实例内存态：`MemoryDebateStore` 200 活跃对局上限，Render 免费档恰为单实例，自洽
- 免费额度估算：glm-4-flash 一局约 3-5k tokens，`DAILY_TOKEN_CAP=200000` ≈ 每天 40-60 局封顶，演示够用
- 回滚：Render/Vercel 都有一键回滚到上一个 Deploy，改砸了点一下即可
