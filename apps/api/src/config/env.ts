// 读取项目根目录的 .env（dotenv 默认不覆盖已存在的 process.env，
// 因此命令行 `LLM_PROVIDER=mock npm start` 优先级高于 .env 文件——这正是我们要的）
import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),

  LLM_PROVIDER: z.enum(['openai', 'mock']).default('openai'),
  LLM_BASE_URL: z.string().default('https://api.deepseek.com/v1'),
  LLM_API_KEY: z.string().default(''),
  LLM_MODEL_STRONG: z.string().default('deepseek-chat'),
  LLM_MODEL_FAST: z.string().default('deepseek-chat'),
  LLM_MODEL_CHEAP: z.string().default('deepseek-chat'),
  LLM_TIMEOUT_MS_STRONG: z.coerce.number().int().positive().default(45_000),
  LLM_TIMEOUT_MS_CHEAP: z.coerce.number().int().positive().default(15_000),

  DAILY_TOKEN_CAP: z.coerce.number().int().nonnegative().default(200_000),
  RATE_LIMIT_PER_IP: z.coerce.number().int().positive().default(30),

  COMPRESS_AFTER_ROUNDS: z.coerce.number().int().positive().default(6),
  KEEP_RECENT_ROUNDS: z.coerce.number().int().positive().default(3),
  DEBATE_TTL_MS: z.coerce.number().int().positive().default(7_200_000),
  MAX_ACTIVE_DEBATES: z.coerce.number().int().positive().default(200),
});

export type Env = z.infer<typeof schema>;

/**
 * overrides 与 process.env 【合并】，不是替换。
 * 曾踩过的坑：早期实现用 `source = overrides ?? process.env`，
 * 一旦脚本传入 overrides（如 { RATE_LIMIT_PER_IP: '1000' }），
 * 命令行设的 LLM_PROVIDER=mock 就被整个丢弃，脚本随即报「缺 Key」。
 */
export function loadEnv(overrides: Record<string, string | undefined> = {}): Env {
  const source: Record<string, string | undefined> = { ...process.env };
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) source[k] = v;
  }
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`环境变量校验失败:\n${detail}`);
  }

  const env = parsed.data;
  if (env.LLM_PROVIDER === 'openai' && !env.LLM_API_KEY) {
    throw new Error(
      'LLM_PROVIDER=openai 时必须设置 LLM_API_KEY。\n' +
        '若只是想本地跑通流程（或课堂断网兜底），请设 LLM_PROVIDER=mock。',
    );
  }
  return env;
}
