import { describe, it, expect } from 'vitest';
import { buildQuery, formatLocalYMD, computeAchievements, formatDurationHM } from '../lib/utils.js';

describe('buildQuery', () => {
  // Ensures buildQuery builds a query string and omits empty/null/undefined values
  it('builds query string and skips empty values', () => {
    const qs = buildQuery({ a: 1, b: '', c: null, d: undefined, e: 'x y' });
    expect(qs).toBe('a=1&e=x+y');
  });

  // Verifies function is resilient to empty or missing input objects
  it('handles empty/undefined input', () => {
    expect(buildQuery()).toBe('');
    expect(buildQuery({})).toBe('');
  });

  // Confirms special characters are URL-encoded and key order matches insertion order
  it('encodes special characters and is deterministic by key insertion order', () => {
    const qs = buildQuery({ z: 'a&b=c', a: 'hello/world', m: 'a+b' });
    // URLSearchParams preserves insertion order
    expect(qs).toBe('z=a%26b%3Dc&a=hello%2Fworld&m=a%2Bb');
  });
});

describe('formatLocalYMD', () => {
  // Checks valid Date is formatted as local YYYY-MM-DD without timezone shifting
  it('formats a valid date as YYYY-MM-DD (local)', () => {
    const d = new Date(2025, 0, 5, 23, 59, 0); // Jan 5, 2025 local
    expect(formatLocalYMD(d)).toBe('2025-01-05');
  });

  // Returns empty string for invalid dates or non-Date inputs
  it('returns empty string for invalid date', () => {
    expect(formatLocalYMD(new Date('invalid'))).toBe('');
    // @ts-ignore
    expect(formatLocalYMD('2025-01-01')).toBe('');
  });

  // Ensures DST edge times still produce valid local Y-M-D strings
  it('handles DST boundary dates (still local Y-M-D parts)', () => {
    // Just assert it returns the local parts without throwing
    const d = new Date(2025, 2, 30, 2, 30, 0); // around DST changes in many locales
    const s = formatLocalYMD(d);
    expect(/^\d{4}-\d{2}-\d{2}$/.test(s)).toBe(true);
  });
});

describe('computeAchievements', () => {
  // Verifies all metrics are neutral when there is no input data
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

  // Aggregates counts for users, hours, and locks and detects first/last entry times
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

  // Confirms tie-breaking prefers the first max encountered and counts unknown users distinctly
  it('handles ties deterministically by first max encountered and unknown user fallback', () => {
    const base = new Date(2025, 0, 1, 10, 0, 0).getTime();
    const entries = [
      { username: 'alice', entryTime: new Date(base) },
      { username: 'bob', entryTime: new Date(base) },
      { username: 'alice', entryTime: new Date(base + 1000) },
      { userId: undefined, entryTime: new Date(base + 2000) },
      { username: 'bob', entryTime: new Date(base + 3000) },
    ];
    const a = computeAchievements(entries);
    expect(a.uniqueUsers).toBe(3); // alice, bob, unknown
    // counts: alice=2, bob=2, unknown=1 -> first max encountered should be 'alice'
    expect(a.mostActiveUser.id).toBe('alice');
  });
});

describe('formatDurationHM', () => {
  // Formats durations under an hour as minutes only
  it('formats minutes when < 1h', () => {
    expect(formatDurationHM(30 * 60 * 1000)).toBe('30m');
  });

  // Formats exact hours with no minutes suffix
  it('formats exact hours', () => {
    expect(formatDurationHM(2 * 60 * 60 * 1000)).toBe('2h');
  });

  // Formats composite durations with hours and minutes
  it('formats hours and minutes', () => {
    expect(formatDurationHM(2 * 60 * 60 * 1000 + 15 * 60 * 1000)).toBe('2h 15m');
  });

  // Returns em-dash for invalid, negative, or non-finite inputs
  it('returns dash for invalid input', () => {
    // @ts-ignore
    expect(formatDurationHM('x')).toBe('—');
    expect(formatDurationHM(-1)).toBe('—');
    expect(formatDurationHM(Number.NaN)).toBe('—');
  });

  // Handles long multi-hour durations retaining minute precision
  it('handles long durations with hours and minutes', () => {
    expect(formatDurationHM(25 * 60 * 60 * 1000 + 5 * 60 * 1000)).toBe('25h 5m');
  });
});
