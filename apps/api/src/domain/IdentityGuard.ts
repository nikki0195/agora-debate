import type { PersonaCard } from './PromptBuilder.js';

export type GuardAction = 'pass' | 'regenerate' | 'fallback';

export interface GuardResult {
  action: GuardAction;
  breaches: string[];
  regenerateCount: number;
}

/**
 * 标记语言检测。曾踩过的坑：GLM-4-Flash 答「内卷」题时输出过
 * 「1. **教育改革**：……」——有序列表 + 加粗，而旧正则只查 `#` 标题和代码块，
 * 全部漏判，脏输出直接流到了前端。这里按 GLM 的实际失败模式补齐。
 */
const MARKDOWN_PATTERNS: RegExp[] = [
  /```/, // 代码块
  /^\s*#{1,3}\s/m, // ATX 标题
  /\*\*/, // 加粗（对话体里几乎不会出现，出现即模型在排版）
  /^\s*\d+\s*[.、]\s*\S/m, // 有序列表：「1. xxx」「2、xxx」
  /^\s*[-*•]\s+\S/m, // 无序列表：「- xxx」「* xxx」
];

/**
 * 人设守护：防「出戏」。
 * 典型失败模式有三类，全部要拦：
 *   1. 自称 AI / 语言模型
 *   2. 泄露现代知识（现代术语的技术语境）
 *   3. 身份混淆 —— 柏拉图被当成苏格拉底（本项目重点）
 */
export function checkIdentity(card: PersonaCard, text: string, regenerateCount: number): GuardResult {
  const breaches: string[] = [];
  const lower = text.toLowerCase();

  for (const pattern of card.identityGuard.breachPatterns) {
    if (lower.includes(pattern.toLowerCase())) breaches.push(pattern);
  }

  // 正则层：按语义结构匹配，防同义改写绕过字面模式
  for (const pattern of card.identityGuard.breachRegex ?? []) {
    try {
      if (new RegExp(pattern, 'i').test(text)) breaches.push(`/${pattern}/`);
    } catch {
      // 配置写错的正则不应当让服务崩，跳过即可
    }
  }

  if (MARKDOWN_PATTERNS.some((re) => re.test(text))) breaches.push('输出了标记语言');

  if (breaches.length === 0) return { action: 'pass', breaches, regenerateCount };

  if (regenerateCount < card.identityGuard.maxRegenerate) {
    return { action: 'regenerate', breaches, regenerateCount: regenerateCount + 1 };
  }
  return { action: 'fallback', breaches, regenerateCount };
}

export function fallbackText(card: PersonaCard): string {
  return card.identityGuard.fallbackUtterance;
}
