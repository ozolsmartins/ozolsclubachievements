import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock NextResponse from next/server to avoid bringing Next runtime
vi.mock('next/server', () => ({
  NextResponse: {
    json: (obj, init = {}) => new Response(JSON.stringify(obj), { status: init.status ?? 200, headers: init.headers }),
  },
}));

// Mock mongoose with a simple in-memory model for Entry
const fakeData = [
  { _id: '1', username: 'alice', lockId: 'L1', entryTime: new Date(), lockMac: 'AA:BB', recordType: 1, electricQuantity: 90 },
];

function makeEntryModel() {
  return {
    find: (q) => ({
      sort: () => ({ skip: () => ({ limit: () => ({ lean: () => Promise.resolve(fakeData) }) }) }),
    }),
    countDocuments: () => Promise.resolve(fakeData.length),
    distinct: () => Promise.resolve(['L1']),
    aggregate: () => Promise.resolve([{}]),
    findOne: () => ({ sort: () => Promise.resolve(null) }),
  };
}

vi.mock('mongoose', () => {
  const Entry = makeEntryModel();
  return {
    default: { models: { Entry }, model: () => Entry, Schema: function(){} },
    models: { Entry },
    model: () => Entry,
    Schema: function(){},
  };
});

// Mock database connector to no-op
vi.mock('../lib/mongodb.js', () => ({ connectToDatabase: vi.fn().mockResolvedValue(undefined) }));
// Also support alias path used in route
vi.mock('@/lib/mongodb', () => ({ connectToDatabase: vi.fn().mockResolvedValue(undefined) }));

// Mock logger to avoid console noise and to pass through timed()
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info(){}, warn(){}, error(){}, debug(){} }),
  getRequestIdFromHeaders: () => undefined,
  timed: async (_logger, _name, fn) => await fn(),
}));

// Default rate limit mock: allow
vi.mock('@/lib/rateLimit', () => ({
  rateLimitKeyFromRequest: () => 'test:ip',
  rateLimitConsume: () => ({ ok: true, remaining: 1, resetSec: 1 }),
  getRateLimitConfig: () => ({ capacity: 60, refillPerSec: 1 }),
}));

describe('API contract', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.RATE_LIMIT_PER_MIN = '100';
    process.env.SLOW_QUERY_MS = '1';
  });

  it('returns the expected JSON structure and headers', async () => {
    const mod = await import('../app/api/route.js');
    const { GET } = mod;
    const req = new Request('http://test/api?page=1&limit=50&period=day');
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Request-ID')).toBeTruthy();
    const json = await res.json();
    expect(json).toHaveProperty('entries');
    expect(json).toHaveProperty('pagination');
    expect(json).toHaveProperty('filters');
    expect(json).toHaveProperty('dayAggregates');
    expect(json).toHaveProperty('leaderboards');
    expect(json).toHaveProperty('globalLeaderboards');
    expect(json).toHaveProperty('analytics');
    expect(json.analytics).toHaveProperty('entriesPerDay');
    expect(json.analytics).toHaveProperty('dauPerDay');
    expect(json.analytics).toHaveProperty('wauByWeek');
    expect(json.analytics).toHaveProperty('mauByMonth');
    expect(json.analytics).toHaveProperty('retentionBuckets');
    expect(json.analytics).toHaveProperty('streakBuckets');
    expect(json.analytics).toHaveProperty('cohortByMonth');
  });

  it('enforces rate limiting with 429', async () => {
    vi.resetModules();
    // Remock to force rate limit denial
    vi.doMock('@/lib/rateLimit', () => ({
      rateLimitKeyFromRequest: () => 'test:ip',
      rateLimitConsume: () => ({ ok: false, retryAfter: 2 }),
      getRateLimitConfig: () => ({ capacity: 0, refillPerSec: 1 }),
    }));
    const mod = await import('../app/api/route.js');
    const { GET } = mod;
    const req = new Request('http://test/api');
    const res = await GET(req);
    expect(res.status).toBe(429);
    expect(res.headers.get('X-Request-ID')).toBeTruthy();
    expect(res.headers.get('Retry-After')).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});
