// lib/utils.js
// Extracted pure helpers from app/page.js for unit testing without importing Next components.

// Build a query string from an object, excluding empty values
export function buildQuery(params) {
  const clean = Object.fromEntries(
    Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '')
  );
  return new URLSearchParams(clean).toString();
}

// Format a Date as local YYYY-MM-DD without UTC shifting
export function formatLocalYMD(d) {
  if (!(d instanceof Date) || isNaN(d)) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Compute lightweight achievements from an entries array
export function computeAchievements(entries = []) {
  const result = {
    totalEntries: entries.length,
    uniqueUsers: 0,
    mostActiveUser: null,
    firstEntryTime: null,
    lastEntryTime: null,
    busiestHour: null,
    mostUsedLock: null,
  };

  if (!entries.length) return result;

  const userCounts = new Map();
  const lockCounts = new Map();
  const hourCounts = new Map();
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;

  for (const e of entries) {
    const user = e.userId || e.username || 'unknown';
    userCounts.set(user, (userCounts.get(user) || 0) + 1);

    if (e.lockId) lockCounts.set(e.lockId, (lockCounts.get(e.lockId) || 0) + 1);

    if (e.entryTime) {
      const t = new Date(e.entryTime).getTime();
      if (!Number.isNaN(t)) {
        if (t < first) first = t;
        if (t > last) last = t;
        const hour = new Date(t).getHours();
        hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
      }
    }
  }

  result.uniqueUsers = userCounts.size;

  if (userCounts.size) {
    let maxU = null, maxC = -1;
    for (const [u, c] of userCounts) {
      if (c > maxC) { maxC = c; maxU = u; }
    }
    result.mostActiveUser = { id: maxU, count: maxC };
  }

  result.firstEntryTime = Number.isFinite(first) ? new Date(first) : null;
  result.lastEntryTime = Number.isFinite(last) ? new Date(last) : null;

  if (hourCounts.size) {
    let maxH = null, maxHC = -1;
    for (const [h, c] of hourCounts) {
      if (c > maxHC) { maxHC = c; maxH = h; }
    }
    result.busiestHour = { hour: maxH, count: maxHC };
  }

  if (lockCounts.size) {
    let maxL = null, maxLC = -1;
    for (const [l, c] of lockCounts) {
      if (c > maxLC) { maxLC = c; maxL = l; }
    }
    result.mostUsedLock = { id: maxL, count: maxLC };
  }

  return result;
}

// Format duration milliseconds as "Hh Mm" or "Mm"
export function formatDurationHM(ms) {
  if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) return '—';
  const totalMinutes = Math.floor(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h <= 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export default {
  buildQuery,
  formatLocalYMD,
  computeAchievements,
  formatDurationHM,
};
