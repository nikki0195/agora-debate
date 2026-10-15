export interface SseEmitter {
  send(event: string, data: unknown, id?: number): void;
  close(): void;
}

export const SSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  // 关键：禁止中间代理（含部分微信链路）缓冲，否则流式会变成一次性抵达
  'X-Accel-Buffering': 'no',
};

export const HEARTBEAT_INTERVAL_MS = 5_000;

export function encodeFrame(event: string, data: unknown, id?: number): string {
  let out = '';
  if (id !== undefined) out += `id: ${id}\n`;
  out += `event: ${event}\n`;
  out += `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;
  return out;
}

/**
 * 构造 SSE 响应。内置 5s 心跳与客户端断开清理。
 * run() 抛出时自动补发一个 error 帧，避免客户端挂在那里不知道发生了什么。
 */
export function sseResponse(
  run: (emit: SseEmitter) => Promise<void>,
  abortSignal?: AbortSignal,
): Response {
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };

      const cleanup = (): void => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* 已关闭 */
        }
      };

      heartbeat = setInterval(() => write(': ping\n\n'), HEARTBEAT_INTERVAL_MS);
      abortSignal?.addEventListener('abort', cleanup);

      const emit: SseEmitter = {
        send(event, data, id) {
          write(encodeFrame(event, data, id));
        },
        close: cleanup,
      };

      run(emit)
        .catch((err: unknown) => {
          const code = (err as { code?: string }).code ?? 'LLM_UNAVAILABLE';
          const retryable = (err as { retryable?: boolean }).retryable ?? true;
          const message = err instanceof Error ? err.message : '未知错误';
          write(encodeFrame('error', { code, message, retryable }));
        })
        .finally(cleanup);
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
