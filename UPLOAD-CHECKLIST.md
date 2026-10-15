# GitHub 上传清单（Agora 部署版）

> 用法：在项目根目录 `git add .` 一把梭，`.gitignore` 会自动挡掉不该传的。
> 你唯一要做的是：push 前翻一眼 `git status`，确认下面「禁传区」一个都不在。

---

## ✅ 必传区（一个都不能少）

| # | 内容 | 为什么 |
|---|---|---|
| 1 | `apps/api/src/` | 后端源码 |
| 2 | `apps/api/prompts/`（5 份先贤人格 md） | **漏了它真 Key 模式人设全丢** |
| 3 | `apps/api/public/` 全部 6 个文件 | 前端 + `agora.config.js`（回填域名用）+ `vercel.json`（防缓存） |
| 4 | `apps/api/scripts/` | smoke / probe-online 等验收脚本 |
| 5 | `apps/api/package.json` + `package-lock.json` | **锁文件必须一起传**，少了 Render 构建直接失败 |
| 6 | `apps/api/.env.example`（占位符 `sk-xxx`，安全） | 给别人照着配环境变量用 |
| 7 | `apps/api/tsconfig.json`、`README.md`、`docs/`（4 篇）、`DEPLOY.md`、`play.cmd`、两个 `.gitignore` | 文档和一键试玩脚本 |

## ❌ 禁传区（git status 里见到就停）

| 内容 | 风险 |
|---|---|
| **`apps/api/.env`** | **里面有真智谱 Key，传上去 = 泄露**（已被 .gitignore 挡，确认一眼即可） |
| `node_modules/` | 几百 MB，平台自动装 |
| `apps/api/*.txt`（25 个 `p2-*` / `clean-*` / `final-check.txt`） | 调试输出垃圾，无密钥但传了丢人。想清就删：见下 |
| `*.log`、`dist/`、`.vercel/` | 构建产物 |

**清理临时 txt（可选，确认无用时再删）：**

```bash
cd apps/api && rm -f p2-*.txt clean-p*.txt final-check.txt
```

---

## 三步操作

```bash
cd C:\Users\Huawei\WorkBuddy\2026-10-12-23-15-38
git init
git add .
git status        # ← 停一秒：禁传区出现任何一项就别 commit
git commit -m "Agora 部署版"
```

GitHub → New repository → 名字 `agora` → Public/Private 都行 → 然后：

```bash
git remote add origin https://github.com/你的用户名/agora.git
git branch -M main
git push -u origin main
```

---

## ⚠️ 唯一纪律

**别截含 Key 的图**：`.env` 文件内容、Render 后台 Environment Variables 页面，不进截图。贴报错只贴日志文字。

万一 Key 泄露：智谱后台吊销换新，损失上限已被 `DAILY_TOKEN_CAP=200000` 锁死。
