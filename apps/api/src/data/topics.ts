import type { Topic } from '../types.js';

const raw: Array<Omit<Topic, 'id'>> = [
  // ── 传统 10 ──────────────────────────────────────────
  { key: 't01', title: '人性本善还是本恶', category: 'traditional', tags: ['伦理'], difficulty: 1, sensitive: false, stanceHints: { pro: '人性本善', con: '人性本恶' } },
  { key: 't02', title: '美是主观的还是客观的', category: 'traditional', tags: ['美学'], difficulty: 2, sensitive: false, stanceHints: { pro: '美是客观的', con: '美是主观的' } },
  { key: 't03', title: '正义是强者的利益吗', category: 'traditional', tags: ['政治'], difficulty: 2, sensitive: false, stanceHints: { pro: '正义是强者的利益', con: '正义独立于权力' } },
  { key: 't04', title: '知识是否等于美德', category: 'traditional', tags: ['伦理'], difficulty: 2, sensitive: false, stanceHints: { pro: '知识即美德', con: '知识与美德是两回事' } },
  { key: 't05', title: '快乐是不是最高的善', category: 'traditional', tags: ['伦理'], difficulty: 2, sensitive: false, stanceHints: { pro: '快乐是最高的善', con: '还有高于快乐的东西' } },
  { key: 't06', title: '命运是否可以被人力改变', category: 'traditional', tags: ['形而上学'], difficulty: 2, sensitive: false, stanceHints: { pro: '命运可改', con: '命运不可改' } },
  { key: 't07', title: '说谎是否永远不道德', category: 'traditional', tags: ['伦理'], difficulty: 1, sensitive: false, stanceHints: { pro: '说谎永远不道德', con: '有时说谎是正当的' } },
  { key: 't08', title: '法律与道德冲突时应服从哪一个', category: 'traditional', tags: ['政治'], difficulty: 3, sensitive: true, stanceHints: { pro: '服从法律', con: '服从道德' } },
  { key: 't09', title: '人应当追求名声吗', category: 'traditional', tags: ['伦理'], difficulty: 1, sensitive: false, stanceHints: { pro: '应当追求名声', con: '不应追求名声' } },
  { key: 't10', title: '死亡是否值得恐惧', category: 'traditional', tags: ['形而上学'], difficulty: 2, sensitive: false, stanceHints: { pro: '死亡值得恐惧', con: '死亡不值得恐惧' } },

  // ── 当代 10（聚焦年轻人关注）──────────────────────────
  { key: 't11', title: '内卷是必要的竞争还是无意义的消耗', category: 'contemporary', tags: ['教育', '职场'], difficulty: 2, sensitive: false, stanceHints: { pro: '内卷是必要的竞争', con: '内卷是无意义的消耗' } },
  { key: 't12', title: 'AI 会不会取代人类的创造力', category: 'contemporary', tags: ['科技'], difficulty: 2, sensitive: false, stanceHints: { pro: 'AI 会取代人类创造力', con: 'AI 不会取代人类创造力' } },
  { key: 't13', title: '名校文凭还值得拼命追求吗', category: 'contemporary', tags: ['教育'], difficulty: 2, sensitive: false, stanceHints: { pro: '值得追求', con: '不值得拼命追求' } },
  { key: 't14', title: '躺平是理性选择还是自我放弃', category: 'contemporary', tags: ['职场', '生活方式'], difficulty: 2, sensitive: false, stanceHints: { pro: '躺平是理性选择', con: '躺平是自我放弃' } },
  { key: 't15', title: '社交平台上的自我展示是表达还是囚禁', category: 'contemporary', tags: ['社交媒体'], difficulty: 2, sensitive: false, stanceHints: { pro: '是自我表达', con: '是自我囚禁' } },
  { key: 't16', title: '短视频让人更博学还是更浅薄', category: 'contemporary', tags: ['媒体'], difficulty: 1, sensitive: false, stanceHints: { pro: '让人更博学', con: '让人更浅薄' } },
  { key: 't17', title: '父母的职业建议还应该听吗', category: 'contemporary', tags: ['家庭', '职场'], difficulty: 2, sensitive: false, stanceHints: { pro: '应该听', con: '不该盲从' } },
  { key: 't18', title: '恋爱应该讲究门当户对吗', category: 'contemporary', tags: ['情感'], difficulty: 2, sensitive: false, stanceHints: { pro: '应该门当户对', con: '不必门当户对' } },
  { key: 't19', title: '公共讨论在网上变得更理性还是更对立', category: 'contemporary', tags: ['媒体', '社会'], difficulty: 3, sensitive: true, stanceHints: { pro: '变得更理性', con: '变得更对立' } },
  { key: 't20', title: '稳定工作和热爱的事业，哪个更值得选', category: 'contemporary', tags: ['职场'], difficulty: 2, sensitive: false, stanceHints: { pro: '选稳定工作', con: '选热爱的事业' } },
];

export const TOPICS: Topic[] = raw.map((t) => ({ ...t, id: `tpc_${t.key}` }));

export function findTopic(idOrKey: string): Topic | undefined {
  return TOPICS.find((t) => t.id === idOrKey || t.key === idOrKey);
}
