/** LengthFit 边界测试：刚才就是它出错（字符索引当中文字数用），必须钉死 */
import { fitLength, isTooShort } from '../src/domain/LengthFit.js';

const cjk = (s: string) => (s.match(/[\u4e00-\u9fa5]/g) ?? []).length;
// 注意：unit 是 8 个中文字 + 1 个句号
const rep = (n: number, unit = '理念是永恒不变的。') => unit.repeat(n);

let fail = 0;
function check(label: string, ok: boolean, extra = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? '  → ' + extra : ''}`);
  if (!ok) fail += 1;
}

console.log('\n── 不应截断 ──');
{
  const t = rep(12); // 96 字
  const r = fitLength(t);
  check('96 字原样返回', !r.truncated && r.text === t, `${cjk(r.text)} 字`);
}

console.log('\n── 应软截断到句号 ──');
{
  const t = rep(26); // 208 字
  const r = fitLength(t);
  check('208 字被截断', r.truncated);
  check('截断后 ≤ 200 中文字', cjk(r.text) <= 200, `${cjk(r.text)} 字`);
  check('结尾是句读符号', /[。？！]$/.test(r.text), r.text.slice(-12));
}

console.log('\n── 句号过近时硬截 ──');
{
  // 前 48 字有句号，之后 220 字无句号
  const t = rep(6) + '甲'.repeat(220);
  const r = fitLength(t);
  check('无可用句号时仍被截断', r.truncated, `${cjk(r.text)} 字`);
  check('硬截后 ≤ 200 中文字', cjk(r.text) <= 200, `${cjk(r.text)} 字`);
}

console.log('\n── 硬截断残留的孤立序号被清掉 ──');
{
  // 199 个中文字 + "1." + 30 个中文字，全程无中文句号 → 必然硬截，
  // 且截断点正好落在 "1." 里面，用来验证清尾正则
  const t = '甲'.repeat(199) + '1.' + '乙'.repeat(30);
  const r = fitLength(t);
  check('不剩孤立序号', !/[、.．:：\d]\s*$/.test(r.text), JSON.stringify(r.text.slice(-14)));
  check('长度受控', cjk(r.text) <= 200, `${cjk(r.text)} 字`);
}

console.log('\n── 中英混合正确定位 ──');
{
  const t = 'DeepSeek 与 GLM-4-Flash 的对比。'.repeat(30); // 约 270 中文字 + 大量英文
  const r = fitLength(t);
  check('含英文也能按中文字数截断', cjk(r.text) <= 200, `${cjk(r.text)} 中文字 / 总长 ${r.text.length}`);
}

console.log('\n── 极端输入 ──');
{
  const r1 = fitLength('');
  check('空串不炸', !r1.truncated && r1.text === '');
  const r2 = fitLength('。'.repeat(500)); // 0 个中文字，本就不该截
  check('纯标点不炸', !r2.truncated && r2.text.length === 500);
  const r3 = fitLength('。'.repeat(500) + '甲'.repeat(300)); // 300 中文字，但句号都在前 500 字符
  check('句号全在前面时硬截', r3.truncated && cjk(r3.text) <= 200, `${cjk(r3.text)} 字`);
}

console.log('\n── 短文本判定（isTooShort）──');
{
  check('119 中文字判短', isTooShort(rep(14) + '甲乙丙丁戊己庚'), '119 字');
  check('120 中文字不判短（边界）', !isTooShort(rep(15)), '120 字');
  check('121 中文字不判短', !isTooShort(rep(15) + '甲'), '121 字');
  check('空串判短', isTooShort(''));
  check('纯标点判短（0 中文字）', isTooShort('。'.repeat(50)));
  check('长英文仍判短（本项目按中文字数计）', isTooShort('a'.repeat(500)));
  check('200 中文字不判短', !isTooShort(rep(25)), '200 字');
}

console.log(`\n${fail === 0 ? 'LengthFit 全部通过' : fail + ' 项失败'}\n`);
process.exit(fail === 0 ? 0 : 1);
