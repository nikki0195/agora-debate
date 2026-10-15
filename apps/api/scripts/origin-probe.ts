/**
 * Key 归属探测：同一个 Key 对多个 OpenAI 兼容平台发最小请求。
 * 判读规则：
 *   200                      → Key 属于该平台，直接用
 *   404 / model_not_found    → Key 认证通过但模型名不对 → 仍说明 Key 属于该平台
 *   401 / invalid api key    → Key 不属于该平台
 *   超时 / 网络错误           → 平台不可达或需特殊网络
 * 输出只报状态码与结论，不泄露 Key。
 */
import { loadEnv } from '../src/config/env.js';

const TARGETS: Array<{ name: string; baseUrl: string; model: string }> = [
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
  { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { name: '月之暗面', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { name: '阿里通义', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { name: '火山方舟', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'deepseek-v3-250324' },
  { name: '腾讯混元', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', model: 'hunyuan-turbos-latest' },
];

async function probe(t: { name: string; baseUrl: string; model: string }, key: string) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(`${t.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: t.model,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
        stream: false,
      }),
      signal: ctrl.signal,
    });
    const body = await res.text();
    clearTimeout(timer);
    let verdict: string;
    if (res.status === 200) verdict = '★ Key 属于该平台';
    else if (res.status === 401 || res.status === 403) verdict = 'Key 不属于该平台';
    else if (res.status === 404 || /model|not_found|does not exist/i.test(body)) verdict = '★ 认证通过（仅模型名不符）';
    else verdict = `待人工判断`;
    return { name: t.name, status: res.status, verdict, snippet: body.slice(0, 120) };
  } catch (err) {
    clearTimeout(timer);
    const m = err instanceof Error ? err.message : String(err);
    return { name: t.name, status: -1, verdict: m.includes('abort') ? '超时（>12s）' : '网络不可达', snippet: m.slice(0, 120) };
  }
}

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.LLM_API_KEY) {
    console.log('  .env 里 LLM_API_KEY 为空');
    return;
  }
  console.log(`\n  Key = ${env.LLM_API_KEY.slice(0, 4)}…${env.LLM_API_KEY.slice(-4)}（长度 ${env.LLM_API_KEY.length}）\n`);

  const results: Array<{ name: string; status: number; verdict: string; snippet: string }> = [];
  for (const t of TARGETS) {
    const r = await probe(t, env.LLM_API_KEY);
    results.push(r);
    console.log(`  ${r.name.padEnd(10)} HTTP ${String(r.status).padEnd(5)} ${r.verdict}`);
  }

  const hit = results.filter((r) => r.verdict.startsWith('★'));
  console.log(`\n  ${hit.length ? '命中：' + hit.map((h) => h.name).join('、') : '未命中任何平台 —— Key 可能无效、已删除，或来自其他服务商'}`);
  console.log('\n  详情（用于人工核对）：');
  for (const r of results) console.log(`   [${r.name}] ${r.snippet}`);
  console.log('');
}

main();
