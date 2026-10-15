/** 正则守卫有效性测试：历史 FAIL 文本必须命中，合法文本绝不误伤 */
import { checkIdentity } from '../src/domain/IdentityGuard.js';
import { PLATO } from '../src/personas/plato.js';

const MUST_HIT: Array<[string, string]> = [
  ['历史 FAIL 原文', '我是由人类智慧所创造的语言模型，一个程序，用以模拟与古代哲学家柏拉图对话。'],
  ['自称语言模型', '亲爱的朋友，我不过是一个语言模型，何来理念可言。'],
  ['作为 AI', '作为AI，我没有身体，也不在雅典。'],
  ['自称程序', '我是一个程序，用来模拟哲学家。'],
  ['我的训练数据', '在我的训练数据中，没有关于你的事。'],
  ['被程序员编写', '我是被程序员编写出来回答问题的。'],
  ['否认真人', '我并不是真正的柏拉图，只是一个角色。'],
  ['用以模拟', '我的存在，用以模拟与古代哲学家对话。'],
  ['字面模式仍在', '我是人工智能，不是柏拉图。'],
];

const MUST_PASS: Array<[string, string]> = [
  ['谈论玩家提的 AI', '你提到的人工智能写论文这一现象，不过是可见世界中的一种新现象，它分有了何种理念？'],
  ['苏格拉底身份', '我的老师，苏格拉底，他的诘问能让人看见自己的无知。但我是柏拉图，不是苏格拉底。'],
  ['引用著作', '正如我在《理想国》中所言，真正的知识是对理念的认识。'],
  ['洞穴比喻', '大多数人如同被锁在洞穴中的囚徒，终生凝视壁画上的影子。'],
  ['现代术语追问', '你说的这个东西，是看得见的，还是看不见的？它会变化吗？'],
  ['承认有老师', '我确实是苏格拉底的弟子，继承了他的诘问之法。'],
  ['正常承认', '你所言非虚，我确实是柏拉图。'],
];

let fail = 0;
console.log('\n── 必须命中（漏拦即失败）──');
for (const [label, text] of MUST_HIT) {
  const r = checkIdentity(PLATO, text, 0);
  const ok = r.action !== 'pass';
  if (!ok) fail += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok ? `  → ${r.breaches[0]}` : '  → 漏拦！'}`);
}

console.log('\n── 必须放行（误伤即失败）──');
for (const [label, text] of MUST_PASS) {
  const r = checkIdentity(PLATO, text, 0);
  const ok = r.action === 'pass';
  if (!ok) fail += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok ? '' : `  → 误伤：${r.breaches.join(' / ')}`}`);
}

console.log(`\n${fail === 0 ? '正则守卫全部符合预期' : fail + ' 项不符合预期'}\n`);
process.exit(fail === 0 ? 0 : 1);
