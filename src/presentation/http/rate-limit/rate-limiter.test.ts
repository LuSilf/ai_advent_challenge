import { describe, test, expect } from "bun:test";
import { RateLimiter } from "./rate-limiter";

function fakeClock(initial = 0) {
  let now = initial;
  return {
    now: () => now,
    advance: (deltaMs: number) => {
      now += deltaMs;
    },
  };
}

describe("RateLimiter", () => {
  test("allows up to capacity in immediate burst", () => {
    const clock = fakeClock();
    const rl = new RateLimiter({ capacity: 3, refillPerSec: 1, now: clock.now });
    expect(rl.tryConsume("a").ok).toBe(true);
    expect(rl.tryConsume("a").ok).toBe(true);
    expect(rl.tryConsume("a").ok).toBe(true);
    const denied = rl.tryConsume("a");
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.retryAfterMs).toBeGreaterThan(0);
      expect(denied.retryAfterMs).toBeLessThanOrEqual(1000);
    }
  });

  test("refills tokens over time", () => {
    const clock = fakeClock();
    const rl = new RateLimiter({ capacity: 2, refillPerSec: 1, now: clock.now });
    expect(rl.tryConsume("a").ok).toBe(true);
    expect(rl.tryConsume("a").ok).toBe(true);
    expect(rl.tryConsume("a").ok).toBe(false);

    clock.advance(1000);
    expect(rl.tryConsume("a").ok).toBe(true);
    expect(rl.tryConsume("a").ok).toBe(false);
  });

  test("does not overfill above capacity after long idle", () => {
    const clock = fakeClock();
    const rl = new RateLimiter({ capacity: 3, refillPerSec: 1, now: clock.now });
    clock.advance(60_000);
    expect(rl.tryConsume("a").ok).toBe(true);
    expect(rl.tryConsume("a").ok).toBe(true);
    expect(rl.tryConsume("a").ok).toBe(true);
    expect(rl.tryConsume("a").ok).toBe(false);
  });

  test("isolates buckets per keyId", () => {
    const clock = fakeClock();
    const rl = new RateLimiter({ capacity: 1, refillPerSec: 1, now: clock.now });
    expect(rl.tryConsume("a").ok).toBe(true);
    expect(rl.tryConsume("a").ok).toBe(false);
    expect(rl.tryConsume("b").ok).toBe(true);
    expect(rl.tryConsume("b").ok).toBe(false);
  });

  test("retryAfterMs reflects fractional debt", () => {
    const clock = fakeClock();
    const rl = new RateLimiter({ capacity: 1, refillPerSec: 2, now: clock.now });
    expect(rl.tryConsume("a").ok).toBe(true);
    const denied = rl.tryConsume("a");
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.retryAfterMs).toBeLessThanOrEqual(500);
      expect(denied.retryAfterMs).toBeGreaterThan(0);
    }
    clock.advance(500);
    expect(rl.tryConsume("a").ok).toBe(true);
  });

  test("supports fractional refill, partial replenishment", () => {
    const clock = fakeClock();
    const rl = new RateLimiter({ capacity: 5, refillPerSec: 1, now: clock.now });
    for (let i = 0; i < 5; i++) expect(rl.tryConsume("a").ok).toBe(true);
    expect(rl.tryConsume("a").ok).toBe(false);
    clock.advance(2500);
    expect(rl.tryConsume("a").ok).toBe(true);
    expect(rl.tryConsume("a").ok).toBe(true);
    expect(rl.tryConsume("a").ok).toBe(false);
  });

  test("throws on invalid config", () => {
    expect(() => new RateLimiter({ capacity: 0, refillPerSec: 1 })).toThrow(/capacity/i);
    expect(() => new RateLimiter({ capacity: -1, refillPerSec: 1 })).toThrow(/capacity/i);
    expect(() => new RateLimiter({ capacity: 1, refillPerSec: 0 })).toThrow(/refill/i);
    expect(() => new RateLimiter({ capacity: 1, refillPerSec: -1 })).toThrow(/refill/i);
  });

  test("uses Date.now by default", () => {
    const rl = new RateLimiter({ capacity: 1, refillPerSec: 1 });
    expect(rl.tryConsume("anyone").ok).toBe(true);
    expect(rl.tryConsume("anyone").ok).toBe(false);
  });
});
