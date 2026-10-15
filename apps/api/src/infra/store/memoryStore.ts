import type { Debate } from '../../types.js';

export interface StoreStats {
  active: number;
  /** 已因 TTL 或容量上限被清理的对局数 */
  evicted: number;
  ttlMs: number;
  cap: number;
}

/**
 * 单实例内存态存储。
 *
 * ⚠️ 部署前提：必须单实例。免费云（Render / Fly / Koyeb 单容器）默认即单实例。
 *    一旦横向扩容，A 实例的对局在 B 实例上查不到，会出现 404 或状态错乱。
 *    需要多实例时，把这里换成 Redis / D1 / Turso 实现，接口不变。
 *
 * P0 只维持「当前活跃对局」：TTL 到期或超出容量上限即清理，不落盘。
 */
export class MemoryDebateStore {
  private readonly map = new Map<string, Debate>();
  private evicted = 0;

  constructor(
    private readonly ttlMs: number,
    private readonly cap: number,
  ) {}

  private sweep(now = Date.now()): void {
    for (const [id, d] of this.map) {
      if (now - d.updatedAt > this.ttlMs) {
        this.map.delete(id);
        this.evicted += 1;
      }
    }
    // 容量兜底：仍超限则淘汰最久未更新的
    if (this.map.size > this.cap) {
      const sorted = [...this.map.values()].sort((a, b) => a.updatedAt - b.updatedAt);
      const drop = this.map.size - this.cap;
      for (let i = 0; i < drop; i++) {
        const victim = sorted[i];
        if (victim) {
          this.map.delete(victim.id);
          this.evicted += 1;
        }
      }
    }
  }

  create(debate: Debate): Debate {
    this.sweep();
    this.map.set(debate.id, debate);
    return debate;
  }

  get(id: string): Debate | undefined {
    this.sweep();
    return this.map.get(id);
  }

  update(id: string, patch: Partial<Debate>): Debate | undefined {
    const cur = this.map.get(id);
    if (!cur) return undefined;
    const next: Debate = { ...cur, ...patch, updatedAt: Date.now() };
    this.map.set(id, next);
    return next;
  }

  delete(id: string): boolean {
    return this.map.delete(id);
  }

  stats(): StoreStats {
    this.sweep();
    return { active: this.map.size, evicted: this.evicted, ttlMs: this.ttlMs, cap: this.cap };
  }
}
