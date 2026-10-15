import { Hono } from 'hono';
import { PERSONAS } from '../personas/index.js';
import type { HonoVars } from '../context.js';

/** 展示字段映射：prompt 与 guard 细节不下发，只给前端大厅/分享卡要用的元数据 */
function publicView(p: (typeof PERSONAS)[string]) {
  return {
    key: p.key,
    name: p.name,
    tagline: p.tagline,
    tier: p.tier,
    era: p.display.era,
    oneLiner: p.display.oneLiner,
    accent: p.display.accent,
    glyph: p.display.glyph,
  };
}

export const personaRoutes = new Hono<HonoVars>()
  .get('/personas', (c) => {
    return c.json({ items: Object.values(PERSONAS).map(publicView) });
  })
  .get('/personas/:key', (c) => {
    const p = PERSONAS[c.req.param('key')];
    if (!p) return c.json({ error: 'PERSONA_NOT_FOUND' }, 404);
    return c.json(publicView(p));
  });
