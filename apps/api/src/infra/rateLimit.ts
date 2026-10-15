interface Window {
  count: number;
  resetAt: number;
}

/**
 * 按 IP 的滑动窗口限流（内存）。
 * 免登录 = 匿名公网 API，这道闸是必做项，不是可优化项。
 * 单实例前提同 MemoryDebateStore。
 */
export class IpRateLimiter {
  private readonly map = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number = 3_600_000,
  ) {}

  /** 返回 true 表示放行 */
  hit(key: string, now = Date.now()): boolean {
    const w = this.map.get(key);
    if (!w || now > w.resetAt) {
      this.map.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (w.count >= this.limit) return false;
    w.count += 1;
    return true;
  }

  /** 定期清理过期窗口，避免内存膨胀 */
  sweep(now = Date.now()): void {
    for (const [k, w] of this.map) {
      if (now > w.resetAt) this.map.delete(k);
    }
  }

  size(): number {
    return this.map.size;
  }
}
