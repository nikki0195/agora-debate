import { LlmError, type ChatOptions, type LlmClient, type LlmMessage } from './types.js';

export interface OpenAICompatConfig {
  baseUrl: string;
  apiKey: string;
  models: Record<'strong' | 'fast' | 'cheap', string>;
  timeoutMs: { strong: number; cheap: number };
}

/** 中文约 1.5 字/token，英文约 4 字符/token；供应商不返回 usage 时用它兜底 */
export function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fa5]/g) ?? []).length;
  const rest = text.length - cjk;
  return Math.ceil(cjk / 1.5 + rest / 4);
}

/**
 * 供应商差异兜底：智谱 GLM 要求 messages 必须以 user 角色结尾，
 * 否则报 400/1214「messages 参数非法」；OpenAI 与 DeepSeek 却允许 system 结尾。
 * 在适配器层统一补齐，避免每条调用路径各自踩一遍坑。
 */
function normalizeMessages(msgs: LlmMessage[]): LlmMessage[] {
  const out = [...msgs];
  if (out.length === 0) {
    out.push({ role: 'user', content: '请说。' });
  } else if (out[out.length - 1]!.role !== 'user') {
    out.push({ role: 'user', content: '请继续。' });
  }
  return out;
}

function buildBody(opts: ChatOptions, model: string, stream: boolean): string {
  const body: Record<string, unknown> = {
    model,
    messages: normalizeMessages(opts.messages),
    stream,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 800,
  };
  // 并非所有兼容端都支持 json_object；失败时调用方会去掉该字段重试一次
  if (opts.responseFormat === 'json') body.response_format = { type: 'json_object' };
  return JSON.stringify(body);
}

async function readError(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, 300);
  } catch {
    return `HTTP ${res.status}`;
  }
}

export function createOpenAICompatClient(cfg: OpenAICompatConfig): LlmClient {
  const endpoint = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  async function call(opts: ChatOptions, stream: boolean): Promise<Response> {
    const model = cfg.models[opts.tier];
    const timeout = opts.tier === 'cheap' ? cfg.timeoutMs.cheap : cfg.timeoutMs.strong;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error('timeout')), timeout);
    // 外部取消（客户端断开）也要能中止上游
    opts.signal?.addEventListener('abort', () => ctrl.abort());

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: buildBody(opts, model, stream),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const detail = await readError(res);
        // json_object 不被支持时，去掉该字段重试一次
        if (res.status === 400 && opts.responseFormat === 'json' && detail.includes('response_format')) {
          const retryBody: Record<string, unknown> = JSON.parse(buildBody(opts, model, stream));
          delete retryBody.response_format;
          const retry = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
            body: JSON.stringify(retryBody),
            signal: ctrl.signal,
          });
          if (!retry.ok) throw new LlmError(`上游 ${retry.status}: ${await readError(retry)}`, retry.status >= 500);
          return retry;
        }
        const retryable = res.status === 429 || res.status >= 500;
        throw new LlmError(`上游 ${res.status}: ${detail}`, retryable);
      }
      return res;
    } catch (err) {
      if (err instanceof LlmError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new LlmError('上游请求超时', true);
      }
      throw new LlmError(`网络错误: ${(err as Error).message}`, true);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    name: 'openai-compat',

    async *stream(opts: ChatOptions): AsyncIterable<string> {
      const res = await call(opts, true);
      if (!res.body) throw new LlmError('上游未返回可读流', true);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const raw of lines) {
            const line = raw.trim();
            if (!line || line.startsWith(':')) continue;
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') return;
            try {
              const json = JSON.parse(payload) as {
                choices?: Array<{ delta?: { content?: string } }>;
              };
              const delta = json.choices?.[0]?.delta?.content;
              if (delta) yield delta;
            } catch {
              // 忽略半包 / 非 JSON 行
            }
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
    },

    async complete(opts: ChatOptions): Promise<string> {
      const res = await call(opts, false);
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return json.choices?.[0]?.message?.content ?? '';
    },
  };
}

export function toLlmMessages(messages: LlmMessage[]): LlmMessage[] {
  return messages;
}
