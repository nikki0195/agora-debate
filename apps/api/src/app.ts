import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppContext, HonoVars } from './context.js';
import { healthRoutes } from './routes/health.js';
import { personaRoutes } from './routes/personas.js';
import { topicRoutes } from './routes/topics.js';
import { debateRoutes } from './routes/debate.js';

const PUBLIC_DIR = path.resolve(process.cwd(), 'public');
const INDEX_HTML = path.join(PUBLIC_DIR, 'index.html');

/** 静态资源：零构建三件套（index.html + app.js + style.css），免费部署无 build 步骤 */
const STATIC_ASSETS: Record<string, { file: string; type: string }> = {
  '/app.js': { file: 'app.js', type: 'text/javascript' },
  '/agora.config.js': { file: 'agora.config.js', type: 'text/javascript' },
  '/style.css': { file: 'style.css', type: 'text/css' },
  '/demo-dialogues.json': { file: 'demo-dialogues.json', type: 'application/json' },
};

function readPublic(file: string): string | null {
  try {
    return readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
  } catch {
    return null;
  }
}

export function buildApp(ctx: AppContext): Hono<HonoVars> {
  const app = new Hono<HonoVars>();

  app.use('*', logger());
  app.use('/api/*', cors({ origin: '*', allowHeaders: ['Content-Type', 'X-Resume-Seq'], exposeHeaders: ['Content-Type'] }));

  app.use('*', async (c, next) => {
    c.set('ctx', ctx);
    await next();
  });

  app.route('/api', healthRoutes);
  app.route('/api', personaRoutes);
  app.route('/api', topicRoutes);
  app.route('/api', debateRoutes);

  // 正式前端：大厅 → 辩论室 → 结算 三视图单页应用（原生 JS，无框架无构建）
  app.get('/', (c) => {
    const html = readPublic('index.html');
    if (html === null) return c.text('public/index.html 缺失', 404);
    return c.html(html);
  });

  for (const [route, asset] of Object.entries(STATIC_ASSETS)) {
    app.get(route, (c) => {
      const body = readPublic(asset.file);
      if (body === null) return c.text(`${asset.file} 缺失`, 404);
      return c.body(body, 200, {
        'Content-Type': `${asset.type}; charset=utf-8`,
        'Cache-Control': 'no-cache',
      });
    });
  }

  app.notFound((c) => c.json({ error: 'NOT_FOUND', path: c.req.path }, 404));

  app.onError((err, c) => {
    const code = (err as { code?: string }).code;
    const status = ((err as { httpStatus?: number }).httpStatus ?? 500) as ContentfulStatusCode;
    // 错误详情不含 provider / model / Key 信息
    return c.json({ error: code ?? 'INTERNAL', message: err.message }, status);
  });

  return app;
}
