import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('rateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
    vi.resetModules();
    delete process.env.RATE_LIMIT_PER_MIN;
  });

  // Simulates consuming tokens from a bucket until it's empty, then verifies a token
  // becomes available again after advancing fake timers to trigger refill.
  it('consumes tokens and eventually denies until refill', async () => {
    const mod = await import('../lib/rateLimit.js');
    const { rateLimitConsume } = mod;
    const key = 'api:1.2.3.4';
    // capacity 2 tokens, refill 1/sec
    const conf = { capacity: 2, refillPerSec: 1 };
    const r1 = rateLimitConsume(key, conf);
    const r2 = rateLimitConsume(key, conf);
    const r3 = rateLimitConsume(key, conf);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r3.ok).toBe(false); // exhausted

    // Advance 1 second to refill one token
    vi.advanceTimersByTime(1000);
    const r4 = rateLimitConsume(key, conf);
    expect(r4.ok).toBe(true);
  });

  // Ensures separate keys (e.g., different IPs) have isolated buckets and do not
  // consume each other's tokens.
  it('is isolated per key', async () => {
    const mod = await import('../lib/rateLimit.js');
    const { rateLimitConsume } = mod;
    const conf = { capacity: 1, refillPerSec: 0.5 };
    const a1 = rateLimitConsume('k:A', conf);
    const b1 = rateLimitConsume('k:B', conf);
    const a2 = rateLimitConsume('k:A', conf);
    expect(a1.ok).toBe(true);
    expect(b1.ok).toBe(true);
    expect(a2.ok).toBe(false);
  });

  // Builds limiter configuration from environment (per-minute budget), verifying
  // capacity and per-second refill derived from RATE_LIMIT_PER_MIN.
  it('builds config from env vars', async () => {
    process.env.RATE_LIMIT_PER_MIN = '120';
    const mod = await import('../lib/rateLimit.js');
    const { getRateLimitConfig } = mod;
    const c = getRateLimitConfig();
    expect(c.capacity).toBe(120);
    expect(c.refillPerSec).toBeCloseTo(2);
  });
});
