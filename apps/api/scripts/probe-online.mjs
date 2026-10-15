/**
 * 线上部署验收脚本（部署成功后跑，本地跑没意义）。
 * 用法：
 *   node scripts/probe-online.mjs https://agora-api-xxx.onrender.com            # 只测后端
 *   node scripts/probe-online.mjs https://agora-api-xxx.onrender.com https://agora-xxx.vercel.app   # 后端+前端一起测
 * 判定：全 PASS = 部署达标；任一 FAIL = 按提示回 DEPLOY.md 第 9 节查坑。
 * 说明：只发 GET 请求，不消耗智谱额度，不建对局，可反复跑。
 */
const [backendArg, frontendArg] = process.argv.slice(2);

if (!backendArg) {
  console.log('用法: node scripts/probe-online.mjs <Render域名> [Vercel域名]');
  console.log('示例: node scripts/probe-online.mjs https://agora-api-xxx.onrender.com https://agora-xxx.vercel.app');
  process.exit(1);
}

const backend = backendArg.replace(/\/+$/, '');
const frontend = frontendArg ? frontendArg.replace(/\/+$/, '') : null;

let failures = 0;
function check(name, ok, extra = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  → ' + extra : ''}`);
  if (!ok) failures += 1;
}

async function getJson(url, timeoutMs = 60000) {
  // 冷启动首次可能 30-60 秒，默认给 60s
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'agora-probe/1.0' } });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* 非 JSON 也行 */ }
    return { status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log(`\n探测后端: ${backend}`);
  if (frontend) console.log(`探测前端: ${frontend}`);
  console.log('（Render 免费版冷启动首次可能要 30-60 秒，请耐心）\n');

  // 1. 健康检查（Render 是否活着 + CORS 是否放行）
  try {
    const r = await getJson(`${backend}/api/healthz`);
    check('后端 /api/healthz 返回 200', r.status === 200, `status=${r.status}`);
    check('healthz 是 JSON 且无报错', !!r.json && !r.text.includes('Internal Server Error'));
  } catch (e) {
    check('后端可达', false, `${e.name}: ${e.message}（冷启动中？60 秒后重试）`);
  }

  // 2. 五位先贤接口（核心路由挂载正确）
  try {
    const r = await getJson(`${backend}/api/personas`);
    const items = r.json?.items ?? [];
    check('GET /api/personas 返回 5 位先贤', r.status === 200 && items.length === 5, `status=${r.status} count=${items.length}`);
  } catch (e) {
    check('GET /api/personas', false, e.message);
  }

  // 3. 辩题接口（前端大厅的 20 道辩题）
  try {
    const r = await getJson(`${backend}/api/topics`);
    const items = r.json?.items ?? r.json?.data ?? [];
    check('GET /api/topics 返回辩题（20 道）', r.status === 200 && items.length >= 20, `status=${r.status} count=${items.length}`);
  } catch (e) {
    check('GET /api/topics', false, e.message);
  }

  // 4. 试玩脚本静态资源（试玩模式的数据源）
  try {
    const r = await getJson(`${backend}/demo-dialogues.json`, 15000);
    check('GET /demo-dialogues.json 返回 200', r.status === 200, `status=${r.status}`);
    const scripts = r.json?.scripts ?? {};
    const keys = Object.keys(scripts);
    check(
      '剧本含 5 位先贤数据',
      keys.length >= 5 && ['plato', 'aristotle', 'pythagoras', 'confucius', 'laozi'].every((k) => keys.includes(k)),
      `命中 ${keys.length} 位: ${keys.join(',')}`,
    );
  } catch (e) {
    check('GET /demo-dialogues.json', false, e.message);
  }

  // 4. 前端页面（可选，传了 Vercel 域名才测）
  if (frontend) {
    try {
      const r = await getJson(frontend, 15000);
      check('前端首页返回 200', r.status === 200, `status=${r.status}`);
      check('页面引用了 app.js', r.text.includes('/app.js'));
      check('页面引用了 agora.config.js', r.text.includes('agora.config.js'));
      const cfg = await getJson(`${frontend}/agora.config.js`, 15000);
      check('agora.config.js 可访问', cfg.status === 200, `status=${cfg.status}`);
      check(
        'config 已回填 Render 域名（非占位 xxx）',
        cfg.text.includes('__AGORA_API_BASE__') && cfg.text.includes(backend.replace('https://', '')) && !cfg.text.includes('agora-api-xxx'),
        '若 FAIL：回填域名后 git push，等 Vercel 重新部署',
      );
    } catch (e) {
      check('前端可达', false, e.message);
    }
  }

  console.log(`\n${failures === 0 ? '全部通过，部署达标' : failures + ' 项未过，对照 DEPLOY.md 第 9 节排查'}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
