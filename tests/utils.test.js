import { describe, it, expect } from 'vitest';
import { buildQuery, formatLocalYMD, computeAchievements, formatDurationHM } from '../lib/utils.js';

describe('buildQuery', () => {
  it('builds query string and skips empty values', () => {
    const qs = buildQuery({ a: 1, b: '', c: null, d: undefined, e: 'x y' });
    expect(qs).toBe('a=1&e=x+y');
  });

  it('handles empty/undefined input', () => {
    expect(buildQuery()).toBe('');
    expect(buildQuery({})).toBe('');
  });
});

describe('formatLocalYMD', () => {
  it('formats a valid date as YYYY-MM-DD (local)', () => {
    const d = new Date(2025, 0, 5, 23, 59, 0); // Jan 5, 2025 local
    expect(formatLocalYMD(d)).toBe('2025-01-05');
  });

  it('returns empty string for invalid date', () => {
    expect(formatLocalYMD(new Date('invalid'))).toBe('');
    // @ts-ignore
    expect(formatLocalYMD('2025-01-01')).toBe('');
  });
});

describe('computeAchievements', () => {
  it('handles empty input', () => {
    const a = computeAchievements([]);
    expect(a.totalEntries).toBe(0);
    expect(a.uniqueUsers).toBe(0);
    expect(a.mostActiveUser).toBeNull();
    expect(a.firstEntryTime).toBeNull();
    expect(a.lastEntryTime).toBeNull();
    expect(a.busiestHour).toBeNull();
    expect(a.mostUsedLock).toBeNull();
  });

  it('aggregates basic metrics', () => {
    const base = new Date(2025, 0, 1, 7, 0, 0).getTime();
    const entries = [
      { username: 'alice', lockId: 'L1', entryTime: new Date(base + 0) },           // 07:00
      { username: 'bob',   lockId: 'L1', entryTime: new Date(base + 60*60*1000) },  // 08:00
      { username: 'alice', lockId: 'L2', entryTime: new Date(base + 2*60*60*1000) },// 09:00
      { username: 'carol', lockId: 'L1', entryTime: new Date(base + 2*60*60*1000) },// 09:00
      { username: 'alice', lockId: 'L1', entryTime: new Date(base + 2*60*60*1000) },// 09:00
    ];

    const a = computeAchievements(entries);
    expect(a.totalEntries).toBe(5);
    expect(a.uniqueUsers).toBe(3);
    expect(a.mostActiveUser).toEqual({ id: 'alice', count: 3 });
    expect(a.firstEntryTime instanceof Date).toBe(true);
    expect(a.lastEntryTime   instanceof Date).toBe(true);

    // busiest hour should be 9 (three entries)
    expect(a.busiestHour).toEqual({ hour: 9, count: 3 });

    // most used lock should be L1 with 4 entries
    expect(a.mostUsedLock).toEqual({ id: 'L1', count: 4 });
  });
});

describe('formatDurationHM', () => {
  it('formats minutes when < 1h', () => {
    expect(formatDurationHM(30 * 60 * 1000)).toBe('30m');
  });

  it('formats exact hours', () => {
    expect(formatDurationHM(2 * 60 * 60 * 1000)).toBe('2h');
  });

  it('formats hours and minutes', () => {
    expect(formatDurationHM(2 * 60 * 60 * 1000 + 15 * 60 * 1000)).toBe('2h 15m');
  });

  it('returns dash for invalid input', () => {
    // @ts-ignore
    expect(formatDurationHM('x')).toBe('—');
    expect(formatDurationHM(-1)).toBe('—');
    expect(formatDurationHM(Number.NaN)).toBe('—');
  });
});
