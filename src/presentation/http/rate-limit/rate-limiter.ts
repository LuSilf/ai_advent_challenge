export type RateLimitDecision = { ok: true } | { ok: false; retryAfterMs: number };

export type RateLimiterOptions = {
  capacity: number;
  refillPerSec: number;
  now?: () => number;
};

type Bucket = { tokens: number; lastMs: number };

export class RateLimiter {
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly now: () => number;
  private readonly buckets = new Map<string, Bucket>();

  constructor(opts: RateLimiterOptions) {
    if (!Number.isFinite(opts.capacity) || opts.capacity <= 0) {
      throw new Error(`RateLimiter capacity must be > 0, got ${opts.capacity}`);
    }
    if (!Number.isFinite(opts.refillPerSec) || opts.refillPerSec <= 0) {
      throw new Error(`RateLimiter refillPerSec must be > 0, got ${opts.refillPerSec}`);
    }
    this.capacity = opts.capacity;
    this.refillPerMs = opts.refillPerSec / 1000;
    this.now = opts.now ?? Date.now;
  }

  tryConsume(keyId: string): RateLimitDecision {
    const ts = this.now();
    let bucket = this.buckets.get(keyId);
    if (!bucket) {
      bucket = { tokens: this.capacity, lastMs: ts };
      this.buckets.set(keyId, bucket);
    } else {
      const elapsed = Math.max(0, ts - bucket.lastMs);
      bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillPerMs);
      bucket.lastMs = ts;
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { ok: true };
    }
    const deficit = 1 - bucket.tokens;
    const retryAfterMs = Math.ceil(deficit / this.refillPerMs);
    return { ok: false, retryAfterMs };
  }
}
