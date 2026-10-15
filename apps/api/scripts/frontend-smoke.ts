/**
 * 前端冒烟：node 内以最小 DOM shim 加载 public/app.js，打真实后端（127.0.0.1:8787），
 * 完整跑通「init → 大厅渲染 → 开局 → 开场 → 发言 → 裁判 → 结算分享卡」。
 * 目的：抓住 null 元素、选择器写错、事件绑定缺失等 curl 测不到的运行时错误。
 * 运行：先起服务（npm start），再 npm run fe-smoke
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8787';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ── 最小 DOM ── */
class El {
  tagName: string;
  parent: El | null = null;
  children: El[] = [];
  dataset: Record<string, string> = {};
  style: Record<string, unknown> & { setProperty: (k: string, v: string) => void } = {
    setProperty: () => {},
  };
  textContent = '';
  value = '';
  placeholder = '';
  disabled = false;
  hidden = false;
  scrollTop = 0;
  scrollHeight = 0;
  onclick: (() => void) | null = null;
  _cls = new Set<string>();
  _attrs: Record<string, string> = {};
  _html = '';

  constructor(tag: string) {
    this.tagName = tag;
  }
  get innerHTML() {
    return this._html;
  }
  set innerHTML(v: string) {
    this._html = v;
    // 真实 DOM 语义：赋空串即清空子节点；children 是活集合（同数组清空，
    // 不换数组引用），否则外部持有旧引用的断言会读到清空前的数据
    if (v === '') this.children.length = 0;
  }
  get classList() {
    const s = this._cls;
    return {
      add: (c: string) => s.add(c),
      remove: (c: string) => s.delete(c),
      toggle: (c: string, f?: boolean) => {
        const on = f === undefined ? !s.has(c) : f;
        if (on) s.add(c);
        else s.delete(c);
      },
      contains: (c: string) => s.has(c),
    };
  }
  get className() {
    return [...this._cls].join(' ');
  }
  set className(v: string) {
    this._cls = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  appendChild(c: El) {
    c.parent = this;
    this.children.push(c);
    return c;
  }
  append(...cs: El[]) {
    cs.forEach((c) => this.appendChild(c));
  }
  remove() {}
  setAttribute(k: string, v: string) {
    this._attrs[k] = v;
  }
  addEventListener() {}
  querySelectorAll(sel: string): El[] {
    // 真实 DOM 语义：只匹配 this 的后代（matches 的祖先链仍在全树上走）。
    // 曾写成全局过滤：bind() 给懒创建容器查 'button' 时把全页面按钮的 onclick
    // 覆盖成了 stance/rounds handler，tab 与卡片点击全部失灵。
    const out: El[] = [];
    const walk = (node: El) => {
      for (const c of node.children) {
        if (matches(c, sel)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  focus() {}
}

const allEls: El[] = [];

/** 极简选择器匹配：支持 ".cls" "tag" ".cls tag" 后代组合 */
function matches(el: El, sel: string): boolean {
  const parts = sel.trim().split(/\s+/);
  let node: El | null = el;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]!;
    let found: El | null = null;
    let cur: El | null = node;
    while (cur) {
      if (p.startsWith('.') ? cur._cls.has(p.slice(1)) : cur.tagName === p) {
        found = cur;
        break;
      }
      cur = cur.parent;
    }
    if (!found) return false;
    node = found.parent;
  }
  return true;
}

const byId = new Map<string, El>();
function mk(tag: string, cls?: string, attrs: Record<string, string> = {}): El {
  const e = new El(tag);
  if (cls) cls.split(/\s+/).filter(Boolean).forEach((c) => e._cls.add(c));
  for (const [k, v] of Object.entries(attrs)) {
    e._attrs[k] = v;
    if (k.startsWith('data-')) e.dataset[k.slice(5)] = v;
    if (k === 'id') byId.set(v, e);
  }
  allEls.push(e);
  return e;
}

/** 按 index.html 预建静态结构（id 容器懒创建，动态内容由 app.js 填） */
function buildDom() {
  const html = mk('html');
  const body = mk('body');
  html.appendChild(body);
  mk('head');

  const tabs = mk('div', 'topic-tabs');
  for (const cat of ['all', 'traditional', 'contemporary']) {
    const b = mk('button', cat === 'all' ? 'on' : '');
    b.dataset.cat = cat;
    tabs.appendChild(b);
  }
  body.appendChild(tabs);

  const stance = mk('div', 'seg', { id: 'stance-pick' });
  for (const v of ['pro', 'con']) {
    const b = mk('button', v === 'pro' ? 'on' : '');
    b.dataset.v = v;
    stance.appendChild(b);
  }
  body.appendChild(stance);

  const rounds = mk('div', 'seg', { id: 'rounds-pick' });
  for (const v of ['6', '8', '10']) {
    const b = mk('button', v === '6' ? 'on' : '');
    b.dataset.v = v;
    rounds.appendChild(b);
  }
  body.appendChild(rounds);

  // 双模式：模式卡 + 锁定提示 + 深度区容器（试玩模式下 #deep-picks 加 .locked）
  const modePick = mk('div', 'mode-pick', { id: 'mode-pick' });
  for (const mode of ['demo', 'deep']) {
    const c = mk('button', 'mode-card' + (mode === 'demo' ? ' on' : ''));
    c.dataset.mode = mode;
    modePick.appendChild(c);
  }
  body.appendChild(modePick);
  body.appendChild(mk('p', 'mode-hint', { id: 'mode-hint' }));
  body.appendChild(mk('div', '', { id: 'deep-picks' }));

  // 忠实还原 index.html 的初始态：shim 的 El 默认 disabled=false / hidden=false，
  // 若不预建这些元素，bind() 里 $('input') 懒创建出的永远是「可用」态，
  // 「等输入框解锁」会瞬间假阳性——开局 POST 还在途中就往后跑，随后 log 未注册而崩。
  const beginBtn = mk('button', 'primary big', { id: 'btn-begin' });
  beginBtn.disabled = true; // index.html: <button id="btn-begin" ... disabled>
  beginBtn.textContent = '开始辩论';
  body.appendChild(beginBtn);

  const input = mk('textarea', '', { id: 'input' });
  input.disabled = true; // index.html: <textarea id="input" ... disabled>
  body.appendChild(input);
  const sendBtn = mk('button', 'primary', { id: 'send' });
  sendBtn.disabled = true; // index.html: <button id="send" ... disabled>
  body.appendChild(sendBtn);
  const judgeBtn = mk('button', 'ghost', { id: 'judge' });
  judgeBtn.hidden = true; // index.html: <button id="judge" hidden>
  body.appendChild(judgeBtn);

  // 试玩/深度两套底部 chrome + 深度小字
  body.appendChild(mk('footer', 'composer', { id: 'composer' }));
  const demoOpts = mk('div', 'demo-options', { id: 'demo-options' });
  demoOpts.hidden = true; // index.html: <div id="demo-options" hidden>
  body.appendChild(demoOpts);
  const deepHint = mk('p', 'debate-foot-note', { id: 'deep-hint' });
  deepHint.hidden = true; // index.html: <p id="deep-hint" hidden>
  body.appendChild(deepHint);

  const documentShim = {
    getElementById: (id: string): El => {
      let e = byId.get(id);
      if (!e) {
        e = new El('div');
        byId.set(id, e);
        allEls.push(e);
      }
      return e;
    },
    createElement: (tag: string) => mk(tag),
    querySelectorAll: (sel: string) => allEls.filter((e) => matches(e, sel)),
    documentElement: mk('html'),
    body,
  };
  return documentShim;
}

/* ── canvas 打桩 ── */
function stubCanvas(): El {
  const cv = mk('canvas');
  const ctx2d = {
    createLinearGradient: () => ({ addColorStop: () => {} }),
    measureText: (t: string) => ({ width: String(t).length * 14 }),
    fillRect: () => {},
    beginPath: () => {},
    arc: () => {},
    fill: () => {},
    stroke: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arcTo: () => {},
    closePath: () => {},
    fillText: () => {},
    clearRect: () => {},
  };
  (cv as unknown as { getContext: () => unknown }).getContext = () => ctx2d;
  (cv as unknown as { toBlob: (cb: (b: unknown) => void) => void }).toBlob = (cb) => cb({ size: 1 });
  return cv;
}

/* ── localStorage shim ── */
function makeLocalStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
}

/* ── 断言 ── */
let failures = 0;
function check(name: string, ok: boolean, extra = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  → ' + extra : ''}`);
  if (!ok) failures += 1;
}

/** 轮询等待条件成立（压缩轮会多一次 LLM 往返，固定 sleep 不可靠） */
async function waitFor(fn: () => boolean, timeoutMs = 20000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (fn()) return true;
    await sleep(300);
  }
  return false;
}

async function main() {
  // 服务必须已在跑
  const health = (await fetch(BASE + '/api/healthz').then((r) => r.json()).catch(() => null)) as {
    ok?: boolean;
    deployment?: { mode?: string };
  } | null;
  if (!health?.ok) {
    console.error('后端未就绪：请先 npm start');
    process.exit(1);
  }
  check('后端 healthz 正常', true, health.deployment?.mode);

  const src = readFileSync(path.resolve(process.cwd(), 'public', 'app.js'), 'utf8');
  const dom = buildDom();
  const storage = makeLocalStorage();

  // 统计 POST /api/debate 次数：试玩模式必须为零（不碰后端、不耗 Key）
  let apiDebatePosts = 0;

  const sandbox = {
    document: dom,
    window: { scrollTo: () => {} },
    localStorage: storage,
    location: { origin: BASE },
    fetch: async (url: string, init?: RequestInit) => {
      if (String(url).includes('/api/debate') && init?.method === 'POST') apiDebatePosts += 1;
      if (process.env.TRACE && String(url).endsWith('/api/debate') && init?.method === 'POST') {
        console.log('  [dbg] POST body =', init.body);
      }
      return fetch(new URL(url, BASE).href, init);
    },
    URL: { createObjectURL: () => 'blob:stubbed' },
    confirm: () => true,
    AbortController,
    setTimeout,
    clearTimeout,
    console,
  };

  // app.js 是 IIFE：以函数体方式注入依赖执行
  const run = new Function(
    'document', 'window', 'localStorage', 'location', 'fetch', 'URL', 'confirm', 'AbortController',
    src,
  );
  // createElement('canvas') 需要返回打桩 canvas：包装 document
  const origCreate = dom.createElement.bind(dom);
  (dom as unknown as { createElement: (t: string) => El }).createElement = (t: string) =>
    t === 'canvas' ? stubCanvas() : origCreate(t);

  run(
    sandbox.document,
    sandbox.window,
    sandbox.localStorage,
    sandbox.location,
    sandbox.fetch,
    sandbox.URL,
    sandbox.confirm,
    sandbox.AbortController,
  );

  // ── 1. 大厅渲染 ──
  await sleep(1500);
  const cards = byId.get('persona-cards')!;
  check('先贤卡渲染 5 张', cards.children.length === 5, String(cards.children.length));
  const topics = byId.get('topic-list')!;
  check('辩题渲染 20 条', topics.children.length === 20, String(topics.children.length));
  check('历史空态提示', byId.get('history-list')!.children.length === 1);
  check('开始按钮可用', byId.get('btn-begin')!.disabled === false);

  // tab 切换：当代
  const contemporaryTab = allEls.find((e) => e.tagName === 'button' && e.dataset.cat === 'contemporary')!;
  contemporaryTab.onclick!();
  await sleep(200);
  check('当代 tab 过滤为 10 条', topics.children.length === 10, String(topics.children.length));
  const allTab = allEls.find((e) => e.tagName === 'button' && e.dataset.cat === 'all')!;
  allTab.onclick!();
  await sleep(200);

  // 选 8 回合 + 第二个先贤 + 第一个题（回合选项须对齐后端 LIMITS.MIN_ROUNDS=6）
  const rounds8 = allEls.find((e) => e.tagName === 'button' && e.dataset.v === '8')!;
  rounds8.onclick!();
  byId.get('persona-cards')!.children[1]!.onclick!(); // 亚里士多德（renderPersonas 会重建卡片）
  byId.get('topic-list')!.children[10]!.onclick!(); // 当代题 t11 内卷
  const cardsAfter = byId.get('persona-cards')!.children;
  check('选中态切换', cardsAfter[1]?._cls.has('on') === true, cardsAfter.map((c) => c.children[1]?.textContent).join('/'));

  // ── 1D. 试玩模式（零 API 消耗：本地剧本 + 打字机 + A/B/C 选项）──
  const demoCard = allEls.find((e) => e.tagName === 'button' && e.dataset.mode === 'demo')!;
  demoCard.onclick!();
  await sleep(200);
  check('试玩：锁定区置灰', byId.get('deep-picks')!._cls.has('locked'));
  check('试玩：提示条可见', byId.get('mode-hint')!.hidden === false);
  check('试玩：按钮文案为开始试玩', byId.get('btn-begin')!.textContent === '开始试玩', byId.get('btn-begin')!.textContent);

  const postsBeforeDemo = apiDebatePosts;
  byId.get('btn-begin')!.onclick!();
  // 开场 = 1.5s 思考中动画 + 逐字流式，播完才出 3 个选项
  const optsShown = await waitFor(() => (byId.get('demo-options')?.children.length ?? 0) === 3, 40_000);
  check('试玩：开场流完出现 3 个选项', optsShown, `${byId.get('demo-options')?.children.length ?? 0} 个`);
  const demoSage = byId.get('log')!.children
    .filter((c) => c._cls.has('row') && c._cls.has('sage'))
    .map((c) => c.children[1]?.children[1]?.textContent ?? '')
    .filter((t) => t.length > 0);
  check('试玩：开场白逐字流式生成', demoSage.length === 1 && (demoSage[0]?.length ?? 0) > 100, `${demoSage[0]?.length ?? 0} 字`);
  check('试玩：全程零 API 请求', apiDebatePosts === postsBeforeDemo, `POST /api/debate ×${apiDebatePosts - postsBeforeDemo}`);
  check('试玩：回合 pill 显示试玩', byId.get('dh-rounds')?.textContent === '试玩', byId.get('dh-rounds')?.textContent);
  check('试玩：composer 隐藏 / 选项区显示', byId.get('composer')!.hidden === true && byId.get('demo-options')!.hidden === false);

  const optA = byId.get('demo-options')!.children[0]!;
  check('试玩：选项带舞台提示', optA.children[0]?._cls.has('stage') === true, optA.children[0]?.textContent ?? '');
  optA.onclick!();
  // 玩家气泡 → 1.5s 思考 + 流式回应 → 第二轮选项
  const round2 = await waitFor(() => {
    const box = byId.get('demo-options');
    const meRows = byId.get('log')!.children.filter((c) => c._cls.has('row') && c._cls.has('me'));
    return (box?.children.length ?? 0) === 3 && meRows.length === 1;
  }, 40_000);
  check('试玩：第一轮答完出第二轮选项', round2);
  const meBubble = byId.get('log')!.children.find((c) => c._cls.has('row') && c._cls.has('me'));
  check('试玩：玩家气泡带舞台提示', meBubble?.children[1]?.children[1]?.children[0]?._cls.has('stage') === true);

  byId.get('demo-options')!.children[1]!.onclick!(); // 第二轮选 B
  const ended = await waitFor(() => {
    const vc = byId.get('verdict-card');
    return !!vc && vc.children.some((c) => c._cls.has('upgrade'));
  }, 40_000);
  check('试玩：closing 后弹出引流卡', ended);
  const up = byId.get('verdict-card')!.children.find((c) => c._cls.has('upgrade'));
  const upBtn = up?.children.find((c) => c.tagName === 'button');
  check('试玩：引流卡含进入深度体验按钮', !!upBtn && (upBtn.textContent ?? '').includes('进入深度体验'), upBtn?.textContent ?? '');
  check('试玩：分享卡图片已生成', (byId.get('share-img') as unknown as { src: string }).src === 'blob:stubbed');
  check('试玩：不写历史', !(storage.getItem('agora.history.v1') ?? '').includes('demo'));

  upBtn?.onclick!(); // 引流按钮 → 回大厅并切深度模式
  await sleep(200);
  check('引流后回到大厅（深度模式）', byId.get('btn-begin')!.textContent === '开始辩论' && !byId.get('deep-picks')!._cls.has('locked'));

  // ── 2. 开局 + 开场 ──
  byId.get('btn-begin')!.onclick!();
  // 开场流完的标志是输入框解锁（runTurn 的 finally 恢复），轮询代替固定 sleep
  const opened = await waitFor(() => byId.get('input')!.disabled === false, 30_000);
  check('开场流完结（输入框解锁）', opened);
  const log = byId.get('log')!;
  const sageRows = log.children.filter((c) => c._cls.has('row') && c._cls.has('sage'));
  check('开场生成 sage 气泡', sageRows.length >= 1);
  // 气泡结构：row → [avatar, col]，col → [who, body]
  const openingBubble = sageRows[0]?.children[1]?.children[1];
  const openingText = openingBubble?.textContent ?? '';
  check('开场有文本', openingText.length > 20, `${openingText.length} 字`);
  check('输入框解锁', byId.get('input')!.disabled === false);
  check(
    '顶栏回合显示',
    /^\d+\/8$/.test(byId.get('dh-rounds')?.textContent ?? ''),
    byId.get('dh-rounds')?.textContent ?? '(未创建)',
  );
  check('历史条目已写入', (storage.getItem('agora.history.v1') ?? '').includes('tpc_t11'));

  // ── 3. 发言 ×8（打满 8 回合触发裁判入口）──
  const lines = [
    '我认为内卷本质上是一种筛选机制，竞赛中的人都在变得更强。',
    '你说这是无意义消耗，可没有竞争，标准又从何而来？',
    '我承认有些竞争确实在空转，但彻底躺平连选择权都会失去。',
    '好吧，最后一问：如果竞争不可避免，怎样才算合理的度？',
    '你总把问题推给理念，可理念不能当饭吃，也不能当标准用。',
    '若按你的说法，失败的竞争都是偏离了本质，那成功又证明了什么？',
    '我换个角度：竞争即使痛苦，它也确实筛出了更优秀的人。',
    '明白了，你要我先定义「合理」本身——我认为是不伤人的筛选。',
  ];
  for (const text of lines) {
    // 先等上一轮真正流完再发：sendTurn 的 busy 守卫会静默丢弃发言，
    // 而压缩轮（COMPRESS_AFTER_ROUNDS=6）会多一次 LLM 往返，固定 sleep 不可靠。
    // 按钮在 finally 里必定恢复（成功或失败皆然），是可靠的「本轮完结」信号。
    const idle = await waitFor(() => byId.get('send')!.disabled === false, 30_000);
    if (!idle) {
      check('等待上一轮完结超时', false, `第 ${lines.indexOf(text) + 1} 轮前`);
      break;
    }
    byId.get('input')!.value = text;
    byId.get('send')!.onclick!();
  }
  // 时序说明：逐轮断言行数会因追赶时序误判——轮询等完整：1 开场 + 8×2 = 17 行
  const full = await waitFor(() => byId.get('log')!.children.filter((c) => c._cls.has('row')).length === 17);
  const rowsAll = byId.get('log')!.children.filter((c) => c._cls.has('row'));
  check('八轮交锋行数完整（1 开场 + 8×2）', full, `${rowsAll.length} 行`);

  // ── 4. 裁判点评 ──
  const judgeShown = await waitFor(() => byId.get('judge')!.hidden === false);
  check('裁判按钮在回合尽后出现', judgeShown);
  byId.get('judge')!.onclick!();
  // 必须等「真点评卡」（.verdict-card）落地：试玩收尾往 verdict-card 塞过引流卡，
  // 若只判断「有任意子节点」会假阳性——裁判 SSE 未完就回大厅，历史状态还是进行中。
  const verdictReady = await waitFor(() =>
    (byId.get('verdict-card')?.children ?? []).some((c) => c._cls.has('verdict-card')),
  );
  check('点评卡片渲染', verdictReady, `${byId.get('verdict-card')?.children.length ?? 0} 块`);
  const shareImg = byId.get('share-img')!;
  check('分享卡图片已生成', shareImg.innerHTML.length === 0 && (shareImg as unknown as { src: string }).src === 'blob:stubbed');
  check('分享卡保存按钮有绑定', typeof byId.get('btn-save')!.onclick === 'function');

  // ── 5. 历史 ──
  byId.get('btn-home')!.onclick!();
  await sleep(300);
  const hist = byId.get('history-list')!;
  check('大厅历史出现 1 条', hist.children.length === 1);
  const histItem = hist.children[0]!;
  check('历史标记为已终结', histItem.children[2]?.textContent === '已终结', histItem.children[2]?.textContent);

  // ── 6. 恢复已终结对局 ──
  histItem.onclick!();
  const resumed = await waitFor(() => byId.get('log')!.children.some((c) => c._cls.has('verdict-card')));
  const log2 = byId.get('log')!;
  const verdictCards = log2.children.filter((c) => c._cls.has('verdict-card'));
  check('恢复后点评卡片在流内', resumed && verdictCards.length >= 1, `${verdictCards.length} 张`);
  check('恢复后输入禁用', byId.get('input')!.disabled === true);
  const goBtn = log2.children.find((c) => c.tagName === 'button' && c.textContent.includes('查看点评'));
  check('恢复后提供查看点评入口', !!goBtn);

  console.log(`\n${failures === 0 ? '前端冒烟全部通过' : failures + ' 项失败'}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('前端冒烟异常：', e);
  process.exit(1);
});
