import type { PersonaCard } from '../domain/PromptBuilder.js';
import { PLATO } from './plato.js';
import { ARISTOTLE } from './aristotle.js';
import { PYTHAGORAS } from './pythagoras.js';
import { CONFUCIUS } from './confucius.js';
import { LAOZI } from './laozi.js';

/**
 * 先贤注册表。
 * 新增一位先贤 = ①新建 src/personas/<key>.ts ②在此登记 ③新建 prompts/<key>.system.md。
 * 路由（personas.ts / debate.ts）只依赖本表，不感知具体先贤。
 */
export const PERSONAS: Record<string, PersonaCard> = {
  plato: PLATO,
  aristotle: ARISTOTLE,
  pythagoras: PYTHAGORAS,
  confucius: CONFUCIUS,
  laozi: LAOZI,
};
