/**
 * 长度拟合：把超长输出截到句读符号处。
 *
 * 为什么需要它：max_tokens 对中文几乎无效（实测 GLM-4-Flash 200 token 能吐出 298 中文字，
 * 约 1.5 字/token），而且即使卡住也是在中途硬截，产出「以下是一个可能的方案：\n\n1.」
 * 这种断句——课堂上直接暴露。所以在生成结束后做一次软截断。
 *
 * 关键：定位截断点必须按【中文字数】累计，不能直接用字符下标——
 * 否则 floor=maxCjk*0.7 会被当成字符位置，在含标点的长文本里完全对不上。
 */
const MAX_CJK = 200;

const CJK = /[\u4e00-\u9fa5]/;

function countCjk(s: string): number {
  return (s.match(/[\u4e00-\u9fa5]/g) ?? []).length;
}

export function fitLength(
  text: string,
  maxCjk: number = MAX_CJK,
): { text: string; truncated: boolean } {
  if (countCjk(text) <= maxCjk) return { text, truncated: false };

  // 1) 中文字数首次超过 maxCjk 的字符下标
  let cjk = 0;
  let limitIdx = text.length;
  for (let i = 0; i < text.length; i++) {
    if (CJK.test(text[i]!)) {
      cjk += 1;
      if (cjk > maxCjk) {
        limitIdx = i;
        break;
      }
    }
  }

  // 2) 中文字数达到 0.7*maxCjk 的字符下标，作为向前搜索的下界
  let cjk2 = 0;
  let floorIdx = 0;
  for (let i = 0; i < limitIdx; i++) {
    if (CJK.test(text[i]!)) {
      cjk2 += 1;
      if (cjk2 >= Math.floor(maxCjk * 0.7)) {
        floorIdx = i;
        break;
      }
    }
  }

  // 3) 在 [floorIdx, limitIdx] 里从后往前找最后一个句读符号
  let cut = -1;
  for (let i = limitIdx; i >= floorIdx; i--) {
    const ch = text[i];
    if (ch === '。' || ch === '？' || ch === '！') {
      cut = i;
      break;
    }
  }

  let out = cut >= 0 ? text.slice(0, cut + 1) : text.slice(0, limitIdx);
  // 清掉截断可能留下的孤立序号 / 破折号 / 省略号尾巴
  out = out
    .replace(/[\s\-—…]*\d+\s*[.、．:：]?\s*$/, '')
    .replace(/[\s\-—…]+$/, '')
    .trim();

  return { text: out, truncated: true };
}

/**
 * 短文本下限。取值逻辑：
 *   - prompt 要求每次发言 150–200 字，但提示词管不住模型（实测开场偶发掉到 90 字）；
 *   - 120 与 persona-probe 的长度判定下界一致，留 30 字容差——
 *     截断后低于这条线，宁可花一次生成预算重写，也不把半句话端上课堂。
 */
export const MIN_CJK = 120;

/** 生成后兜底判定：中文字数不足 minCjk 即视为过短（空串、纯标点同样算短） */
export function isTooShort(text: string, minCjk: number = MIN_CJK): boolean {
  return countCjk(text) < minCjk;
}
