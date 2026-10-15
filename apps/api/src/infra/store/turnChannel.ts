type Listener = (delta: string) => void;

/**
 * 一轮生成的「广播通道」。
 *
 * 存在的理由：微信内 WebView 切后台会被挂起，SSE 必断。若客户端一断就中止 LLM，
 * 用户回来时这一轮就白烧了 token。所以生成在服务端继续跑，把文本缓冲在这里；
 * 客户端重连时按 seq 接回去，先补发已有内容，再继续收新内容。
 */
export class TurnChannel {
  text = '';
  done = false;
  failed: Error | undefined;
  private readonly listeners = new Set<Listener>();
  private readonly doneListeners = new Set<() => void>();
  touchedAt = Date.now();

  push(delta: string): void {
    this.text += delta;
    this.touchedAt = Date.now();
    for (const l of this.listeners) l(delta);
  }

  /** 人设守护触发重写时清空，避免把废稿也缓冲进去 */
  reset(): void {
    this.text = '';
    this.touchedAt = Date.now();
  }

  finish(err?: Error): void {
    this.done = true;
    this.failed = err;
    this.touchedAt = Date.now();
    for (const l of this.doneListeners) l();
  }

  onDelta(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  onDone(l: () => void): () => void {
    this.doneListeners.add(l);
    return () => this.doneListeners.delete(l);
  }
}

export class TurnRegistry {
  private readonly map = new Map<string, TurnChannel>();

  constructor(private readonly ttlMs = 60_000) {}

  key(debateId: string, seq: number): string {
    return `${debateId}:${seq}`;
  }

  create(k: string): TurnChannel {
    const ch = new TurnChannel();
    this.map.set(k, ch);
    return ch;
  }

  get(k: string): TurnChannel | undefined {
    return this.map.get(k);
  }

  delete(k: string): void {
    this.map.delete(k);
  }

  sweep(now = Date.now()): number {
    let n = 0;
    for (const [k, ch] of this.map) {
      if (ch.done ? now - ch.touchedAt > 10_000 : now - ch.touchedAt > this.ttlMs) {
        this.map.delete(k);
        n += 1;
      }
    }
    return n;
  }

  size(): number {
    return this.map.size;
  }
}
