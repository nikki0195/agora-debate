import { Hono } from 'hono';
import { TOPICS, findTopic } from '../data/topics.js';
import type { HonoVars } from '../context.js';

export const topicRoutes = new Hono<HonoVars>()
  .get('/topics', (c) => {
    const category = c.req.query('category');
    const items = category ? TOPICS.filter((t) => t.category === category) : TOPICS;
    return c.json({ items });
  })
  .get('/topics/:id', (c) => {
    const t = findTopic(c.req.param('id'));
    if (!t) return c.json({ error: 'TOPIC_NOT_FOUND' }, 404);
    return c.json(t);
  });
