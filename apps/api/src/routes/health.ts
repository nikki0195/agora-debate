import { Hono } from 'hono';
import type { HonoVars } from '../context.js';

/**
 * 健康检查。
 * 两个用途：
 *   1. 免费云保活 —— 用 UptimeRobot / cron-job.org 每 5-10 分钟打一次，防休眠冷启动
 *   2. 现场排障 —— 一眼看清 provider、额度、活跃对局数
 *
 * 注意：绝不能暴露 API Key 与上游地址。模型名可暴露，便于确认档位是否生效。
 */
export const healthRoutes = new Hono<HonoVars>()
  .get('/healthz', (c) => {
    const { store, router, env, turns, startedAt, policy } = c.var.ctx;
    return c.json({
      ok: true,
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      deployment: {
        // ★ 内存态 = 必须单实例。多实例会导致对局在不同实例间查不到。
        mode: 'single-instance',
        stateStore: 'memory',
        warning: store.stats().active > 0
          ? '当前为内存态，请确保部署为单实例；横向扩容前请先替换 MemoryDebateStore。'
          : undefined,
      },
      llm: router.describe(),
      quota: router.usage(),
      debates: store.stats(),
      turnsInFlight: turns.size(),
      policy,
      limits: { ratePerIpPerHour: env.RATE_LIMIT_PER_IP },
    });
  })
  .get('/health', (c) => c.redirect('/api/healthz', 302));
