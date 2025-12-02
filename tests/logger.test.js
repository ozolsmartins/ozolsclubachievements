import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('logger', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
  });

  // Verifies helper reads common request ID header variants and returns undefined when absent
  it('extracts request id from headers', async () => {
    const { getRequestIdFromHeaders } = await import('../lib/logger.js');
    const h = new Headers({ 'x-request-id': 'abc123' });
    expect(getRequestIdFromHeaders(h)).toBe('abc123');
    const h2 = new Headers({ 'x-requestid': 'xyz' });
    expect(getRequestIdFromHeaders(h2)).toBe('xyz');
    const h3 = new Headers({ 'x-amzn-trace-id': 'root=1-2-3' });
    expect(getRequestIdFromHeaders(h3)).toBe('root=1-2-3');
    const h4 = new Headers({});
    expect(getRequestIdFromHeaders(h4)).toBeUndefined();
  });

  // Ensures createLogger outputs one-line JSON with level, message and base fields
  it('createLogger writes structured JSON lines', async () => {
    const { createLogger } = await import('../lib/logger.js');
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = createLogger({ requestId: 'rid-1', route: 'api' });
    logger.info('hello', { a: 1 });
    expect(spy).toHaveBeenCalledTimes(1);
    const arg = spy.mock.calls[0][0];
    const obj = JSON.parse(arg);
    expect(obj.level).toBe('info');
    expect(obj.msg).toBe('hello');
    expect(obj.requestId).toBe('rid-1');
    expect(obj.route).toBe('api');
    expect(obj.a).toBe(1);
    spy.mockRestore();
  });

  // Uses fake timers to simulate fast/slow operations: expects debug for fast, warn for slow,
  // and error log when the wrapped function throws.
  it('timed logs debug for fast ops and warn for slow ops, and logs error on throw', async () => {
    const { timed, createLogger } = await import('../lib/logger.js');
    const logs = [];
    const logger = createLogger({ requestId: 'rid-2', route: 'api' });
    const spy = vi.spyOn(console, 'log').mockImplementation((s) => logs.push(JSON.parse(s)));
    process.env.SLOW_QUERY_MS = '50';

    // Fast op
    const pFast = timed(logger, 'fast', async () => {
      // 10ms simulated
      await new Promise((r) => setTimeout(r, 10));
      return 42;
    });
    vi.advanceTimersByTime(10);
    await pFast;

    // Slow op
    const pSlow = timed(logger, 'slow', async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    vi.advanceTimersByTime(60);
    await pSlow;

    // Error op
    const pErr = timed(logger, 'boom', async () => {
      await new Promise((_, rej) => setTimeout(() => rej(new Error('kaboom')), 5));
    });
    vi.advanceTimersByTime(5);
    await expect(pErr).rejects.toThrow('kaboom');

    const levels = logs.map((l) => l.level);
    expect(levels).toContain('debug');
    expect(levels).toContain('warn');
    expect(levels).toContain('error');

    const warn = logs.find((l) => l.level === 'warn');
    expect(warn.msg).toBe('slow_operation');
    const dbg = logs.find((l) => l.level === 'debug');
    expect(dbg.msg).toBe('operation_timing');
    const err = logs.find((l) => l.level === 'error');
    expect(err.msg).toBe('operation_failed');
    spy.mockRestore();
  });
});
