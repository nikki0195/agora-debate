import type { Mood } from '../types.js';

/**
 * P0：关键词启发式，零延迟零成本。
 * M2 可换成 cheap 模型分类——与 LLM 主请求并行发起，不占用首字延迟。
 */
const RULES: Array<{ mood: Mood; words: string[] }> = [
  {
    mood: 'impressed',
    words: ['你说得对', '有道理', '我明白了', '受教了', '确实如此', '我同意', '好问题', '厉害'],
  },
  {
    mood: 'irritated',
    words: ['无聊', '废话', '你根本没回答', '胡说', '答非所问', '别绕了', '装什么', '垃圾', '蠢'],
  },
  {
    mood: 'amused',
    words: ['按你这么说', '照你的逻辑', '那岂不是', '如果这样', '换句话说', '有趣', '有意思', '哈哈'],
  },
];

export function classifyMood(text: string): Mood {
  for (const rule of RULES) {
    if (rule.words.some((w) => text.includes(w))) return rule.mood;
  }
  return 'calm';
}
