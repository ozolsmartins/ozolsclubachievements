// app/page.js
import { headers } from 'next/headers';
import AutoSubmitSelect from './components/AutoSubmitSelect';
import AutoSubmitCheckbox from './components/AutoSubmitCheckbox';

export const dynamic = 'force-dynamic';

function buildQuery(params) {
  const clean = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  );
  return new URLSearchParams(clean).toString();
}

// Format a Date object as YYYY-MM-DD in LOCAL time (no UTC shift)
function formatLocalYMD(d) {
  if (!(d instanceof Date) || isNaN(d)) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Compute simple "achievements" style aggregates from the loaded entries
function computeAchievements(entries = []) {
  const result = {
    totalEntries: entries.length,
    uniqueUsers: 0,
    mostActiveUser: null, // { id, count }
    firstEntryTime: null,
    lastEntryTime: null,
    busiestHour: null, // { hour, count }
    mostUsedLock: null, // { id, count }
  };

  if (!entries.length) return result;

  const userCounts = new Map();
  const lockCounts = new Map();
  const hourCounts = new Map(); // 0..23
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

  // Unique users
  result.uniqueUsers = userCounts.size;

  // Most active user
  if (userCounts.size) {
    let maxU = null, maxC = -1;
    for (const [u, c] of userCounts) {
      if (c > maxC) { maxC = c; maxU = u; }
    }
    result.mostActiveUser = { id: maxU, count: maxC };
  }

  // First/last time
  result.firstEntryTime = Number.isFinite(first) ? new Date(first) : null;
  result.lastEntryTime = Number.isFinite(last) ? new Date(last) : null;

  // Busiest hour
  if (hourCounts.size) {
    let maxH = null, maxHC = -1;
    for (const [h, c] of hourCounts) {
      if (c > maxHC) { maxHC = c; maxH = h; }
    }
    result.busiestHour = { hour: maxH, count: maxHC };
  }

  // Most used lock
  if (lockCounts.size) {
    let maxL = null, maxLC = -1;
    for (const [l, c] of lockCounts) {
      if (c > maxLC) { maxLC = c; maxL = l; }
    }
    result.mostUsedLock = { id: maxL, count: maxLC };
  }

  return result;
}

// Nicely format a duration in milliseconds as Hh Mm (e.g., 2h 15m). Falls back to minutes if <1h.
function formatDurationHM(ms) {
  if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) return '—';
  const totalMinutes = Math.floor(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h <= 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export default async function Page({ searchParams }) {
  const page   = searchParams?.page ?? '1';
  const date   = searchParams?.date ?? '';
  const lockId = searchParams?.lockId ?? '';
  const limit  = searchParams?.limit ?? '50';
  const userId = searchParams?.userId ?? '';
  const period = (searchParams?.period ?? 'day');
  const showGlobal = searchParams?.showGlobal ?? '';

  const qs = buildQuery({ page, date, lockId, limit, userId, period, showGlobal });

  // Absolute base URL for server-side fetch (Next 15/Turbopack)
  const h = headers();
  const host  = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') ?? 'http';
  const base  = `${proto}://${host}`;

  let data, status = 200, errText = '';
  try {
    const res = await fetch(`${base}/api?${qs}`, { cache: 'no-store' });
    status = res.status;
    if (!res.ok) errText = await res.text();
    else data = await res.json();
  } catch (e) {
    status = 0;
    errText = String(e?.message || e);
  }

  if (!data) {
    return (
        <main className="p-6 space-y-3">
          <h1 className="text-2xl font-semibold">Entries</h1>
          <p>Failed to load entries.</p>
          <pre className="text-xs bg-gray-100 p-3 rounded overflow-auto">
{`status: ${status}
error: ${errText}`}
        </pre>
        </main>
    );
  }

  const { entries = [], pagination = {}, filters = {}, dayAggregates = null, userProfile = null, leaderboards = null, globalLeaderboards = null } = data;
  const totalPages = pagination.totalPages ?? 1;
  // Use LOCAL date formatting to avoid the date going back a day when pressing search
  const dayISO = filters?.date ? formatLocalYMD(new Date(filters.date)) : '';
  // Ensure a visible default date on very first load even if no query string exists
  const initialDayISO = dayISO || (date ? String(date) : '') || formatLocalYMD(new Date());
  const effectivePeriod = (filters?.period ?? period ?? 'day');
  // For month picker default value we need YYYY-MM
  const initialMonthYM = (initialDayISO || '').slice(0, 7);

  const achievementsFromServer = dayAggregates || null;
  const trimmedUserId = String(userId || '').trim();
  const entriesForUser = trimmedUserId
    ? entries.filter(e => String(e.userId ?? e.username ?? '').toLowerCase() === trimmedUserId.toLowerCase())
    : entries;
  // When a user is searched, the API already filters by userId and dayAggregates reflects the entire day for that user
  const userAchievements = achievementsFromServer;
  // Whether we truly have multiple pages in the current view (used for labeling)
  const showAllPagesLabel = (pagination?.totalPages ?? totalPages) > 1;
  // Today in local time, used to prevent selecting future dates in the date picker
  const todayISO = formatLocalYMD(new Date());
  const thisMonthYM = todayISO.slice(0, 7);

  const linkWith = (patch) => {
    const next = { page, date, lockId, limit, userId, period: effectivePeriod, showGlobal, ...patch };
    return `/?${buildQuery(next)}`;
  };

  return (
      <main className="p-6 space-y-6">
        <h1 className="text-2xl font-semibold">Entries</h1>

        {/* Filters */}
        <form action="/" method="get" className="flex flex-wrap gap-3 items-end">
          {/** Consistent sizing for all controls */}
          {(() => { return null; })()}
          {/** Shared class to unify sizing across different input/select types */}
          {(() => { return null; })()}
          {/** Use a constant class to enforce same height/width */}
          {/** Note: date inputs can render slightly differently per browser; we pin height with h-10 */}
          {/** and unify width to w-52 for all controls. */}
          {/** We keep styles simple to avoid theme-specific overrides. */}
          {/** The variable is inlined by reusing the same string. */}
          <div>
            <label className="block text-sm">{effectivePeriod === 'month' ? 'Month' : 'Date'}</label>
            {effectivePeriod === 'month' ? (
              <input
                type="month"
                name="date"
                defaultValue={initialMonthYM}
                max={thisMonthYM}
                className="border rounded px-3 py-2 h-10 w-52 bg-white text-gray-900"
              />
            ) : (
              <input
                type="date"
                name="date"
                defaultValue={initialDayISO}
                max={todayISO}
                className="border rounded px-3 py-2 h-10 w-52 bg-white text-gray-900"
              />
            )}
          </div>
          <div>
            <label className="block text-sm">Range</label>
            <AutoSubmitSelect name="period" defaultValue={effectivePeriod} className="border rounded px-3 py-2 h-10 w-52 bg-white text-gray-900">
              <option value="day">Day</option>
              <option value="month">Month</option>
            </AutoSubmitSelect>
          </div>
          <div>
            <label className="block text-sm">Lock ID</label>
            <select name="lockId" defaultValue={lockId} className="border rounded px-3 py-2 h-10 w-52 bg-white text-gray-900">
              <option value="">All</option>
              {(filters?.availableLockIds ?? []).map((id) => (
                  <option key={id} value={id}>{id}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm">User ID</label>
            <input
              type="text"
              name="userId"
              placeholder="Enter user ID or username"
              defaultValue={userId}
              className="border rounded px-3 py-2 h-10 w-52 bg-white text-gray-900"
            />
          </div>
          <div>
            <label className="block text-sm">Per page</label>
            <select name="limit" defaultValue={limit} className="border rounded px-3 py-2 h-10 w-52 bg-white text-gray-900">
              {[25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <button type="submit" className="px-4 py-2 rounded bg-black text-white">
            Apply
          </button>
        </form>

        {/* Quick date/month jump: hide when searching by user remains same; hide when period is month? We still show prev/next but they will jump by month */}
        <div className="flex gap-3">
          {filters?.previousDateCounts && (
              <a
                  className="underline"
                  href={linkWith({
                    date: formatLocalYMD(new Date(filters.previousDateCounts.date)),
                    page: '1'
                  })}
              >
                ← {new Date(filters.previousDateCounts.date).toLocaleDateString(undefined, effectivePeriod === 'month' ? { year: 'numeric', month: 'long' } : undefined)} ({filters.previousDateCounts.count})
              </a>
          )}
          {filters?.nextDateCounts && (
              <a
                  className="underline"
                  href={linkWith({
                    date: formatLocalYMD(new Date(filters.nextDateCounts.date)),
                    page: '1'
                  })}
              >
                {new Date(filters.nextDateCounts.date).toLocaleDateString(undefined, effectivePeriod === 'month' ? { year: 'numeric', month: 'long' } : undefined)} ({filters.nextDateCounts.count}) →
              </a>
          )}
        </div>

        {/* Summary */}
        <div className="text-sm text-gray-600">
          Showing page <strong>{pagination?.page}</strong> of <strong>{totalPages}</strong>, total{' '}
          <strong>{pagination?.total}</strong> entries for{' '}
          <strong>
            {effectivePeriod === 'month'
              ? (initialDayISO ? new Date(initialDayISO).toLocaleDateString(undefined, { year: 'numeric', month: 'long' }) : '')
              : (initialDayISO ? new Date(initialDayISO).toLocaleDateString() : 'today')}
          </strong>.
        </div>

        {/* Achievements (only when not searching for a specific user) */}
        {!trimmedUserId && (
          <div className="rounded border p-4 bg-gray-50 text-gray-900">
            <h2 className="font-medium mb-2">Achievements (for this {effectivePeriod})</h2>
            {!achievementsFromServer || (achievementsFromServer.totalEntries ?? 0) === 0 ? (
              <p className="text-sm text-gray-600">No data for achievements yet.</p>
            ) : (
              <ul className="list-disc ml-5 text-sm space-y-1">
                <li>
                  Total entries{showAllPagesLabel ? ' (all pages)' : ''}: <strong>{achievementsFromServer.totalEntries}</strong>
                </li>
                <li>
                  Unique users{showAllPagesLabel ? ' (all pages)' : ''}: <strong>{achievementsFromServer.uniqueUsers}</strong>
                </li>
                {achievementsFromServer.mostActiveUser && (
                  <li>
                    Most active user: <strong>{achievementsFromServer.mostActiveUser.id}</strong> ({achievementsFromServer.mostActiveUser.count})
                  </li>
                )}
                {/* Hide lock-related and hour achievements in month mode */}
                {effectivePeriod !== 'month' && achievementsFromServer.mostUsedLock && (
                  <li>
                    Most used lock: <strong>{achievementsFromServer.mostUsedLock.id}</strong> ({achievementsFromServer.mostUsedLock.count})
                  </li>
                )}
                {effectivePeriod !== 'month' && achievementsFromServer.busiestHour && (
                  <li>
                    Busiest hour: <strong>{String(achievementsFromServer.busiestHour.hour).padStart(2, '0')}:00</strong> ({achievementsFromServer.busiestHour.count})
                  </li>
                )}
                {(achievementsFromServer.firstEntryTime || achievementsFromServer.lastEntryTime) && (
                  <li>
                    Time span: {achievementsFromServer.firstEntryTime ? (effectivePeriod === 'month' ? new Date(achievementsFromServer.firstEntryTime).toLocaleString() : new Date(achievementsFromServer.firstEntryTime).toLocaleTimeString()) : '—'}
                    {' '}–{' '}
                    {achievementsFromServer.lastEntryTime ? (effectivePeriod === 'month' ? new Date(achievementsFromServer.lastEntryTime).toLocaleString() : new Date(achievementsFromServer.lastEntryTime).toLocaleTimeString()) : '—'}
                  </li>
                )}
              </ul>
            )}
          </div>
        )}

        {/* Leaderboards (only in month mode and not during user search). Month leaderboard is user-centric */}
        {effectivePeriod === 'month' && !trimmedUserId && leaderboards && (
          <div className="rounded border p-4 bg-white text-gray-900">
            <h2 className="font-medium mb-3">Leaderboard (this {effectivePeriod})</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {/* Top users */}
              <div>
                <div className="font-medium mb-1">Top users</div>
                {(!leaderboards.topUsers || leaderboards.topUsers.length === 0) ? (
                  <div className="text-sm text-gray-600">No data.</div>
                ) : (
                  <ol className="list-decimal ml-5 text-sm space-y-1">
                    {leaderboards.topUsers.map(u => (
                      <li key={u.id}>
                        <a className="underline" href={linkWith({ userId: u.id, page: '1' })}>{u.id}</a>
                        {' '}— {u.count} {effectivePeriod === 'month' ? 'days' : 'entries'}
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              {/* In month mode, do not show a locks leaderboard */}
              {effectivePeriod !== 'month' && leaderboards.topLocks && (
                <div>
                  <div className="font-medium mb-1">Top locks</div>
                  {leaderboards.topLocks.length === 0 ? (
                    <div className="text-sm text-gray-600">No data.</div>
                  ) : (
                    <ol className="list-decimal ml-5 text-sm space-y-1">
                      {leaderboards.topLocks.map(l => (
                        <li key={l.id}>
                          <a className="underline" href={linkWith({ lockId: l.id, page: '1' })}>{l.id}</a>
                          {' '}— {l.count} entries
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}

              {/* Top early visitors */}
              {leaderboards.topEarlyBirds && (
                <div>
                  <div className="font-medium mb-1">Top early visitors (before 08:00)</div>
                  {leaderboards.topEarlyBirds.length === 0 ? (
                    <div className="text-sm text-gray-600">No data.</div>
                  ) : (
                    <ol className="list-decimal ml-5 text-sm space-y-1">
                      {leaderboards.topEarlyBirds.map(u => (
                        <li key={u.id}>
                          <a className="underline" href={linkWith({ userId: u.id, page: '1' })}>{u.id}</a>
                          {' '}— {u.count} days
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}

              {/* Top night visitors */}
              {leaderboards.topNightOwls && (
                <div>
                  <div className="font-medium mb-1">Top night visitors (22:00+)</div>
                  {leaderboards.topNightOwls.length === 0 ? (
                    <div className="text-sm text-gray-600">No data.</div>
                  ) : (
                    <ol className="list-decimal ml-5 text-sm space-y-1">
                      {leaderboards.topNightOwls.map(u => (
                        <li key={u.id}>
                          <a className="underline" href={linkWith({ userId: u.id, page: '1' })}>{u.id}</a>
                          {' '}— {u.count} days
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}

              {/* Longest streak in days (consecutive active days) */}
              {leaderboards.topLongestStreaks && (
                <div>
                  <div className="font-medium mb-1">Longest streak (days)</div>
                  {leaderboards.topLongestStreaks.length === 0 ? (
                    <div className="text-sm text-gray-600">No data.</div>
                  ) : (
                    <ol className="list-decimal ml-5 text-sm space-y-1">
                      {leaderboards.topLongestStreaks.map(u => (
                        <li key={u.id}>
                          <a className="underline" href={linkWith({ userId: u.id, page: '1' })}>{u.id}</a>
                          {' '}— {u.count} days
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}

              {null}
            </div>
            {/* Toggle for Global Leaderboard appears under the monthly leaderboard, only when not searching a user */}
            <div className="mt-4 border-t pt-3">
              <form action="/" method="get" className="flex items-center gap-3">
                {/* Preserve current filters */}
                <input type="hidden" name="date" value={initialDayISO} />
                <input type="hidden" name="period" value={effectivePeriod} />
                {lockId ? (<input type="hidden" name="lockId" value={lockId} />) : null}
                <input type="hidden" name="limit" value={limit} />
                <input type="hidden" name="page" value={page} />
                {/* userId intentionally omitted (no toggle in user search); here it's blank by condition */}
                <AutoSubmitCheckbox
                  id="showGlobal2"
                  name="showGlobal"
                  defaultChecked={String(showGlobal) === '1'}
                  label="Show global leaderboard"
                />
              </form>
            </div>
          </div>
        )}

        {/* Global Leaderboard (lifetime) - shown below the monthly leaderboard area when toggled, not during user search */}
        {String(showGlobal) === '1' && !trimmedUserId && globalLeaderboards && (
          <div className="rounded border p-4 bg-white text-gray-900">
            <h2 className="font-medium mb-3">Global leaderboard (all time)</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {/* Top users (lifetime distinct active days) */}
              <div>
                <div className="font-medium mb-1">Top users</div>
                {(!globalLeaderboards.topUsers || globalLeaderboards.topUsers.length === 0) ? (
                  <div className="text-sm text-gray-600">No data.</div>
                ) : (
                  <ol className="list-decimal ml-5 text-sm space-y-1">
                    {globalLeaderboards.topUsers.map(u => (
                      <li key={u.id}>
                        <a className="underline" href={linkWith({ userId: u.id, page: '1' })}>{u.id}</a>
                        {' '}— {u.count} days
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              {/* Top early visitors (days) */}
              <div>
                <div className="font-medium mb-1">Top early visitors (before 08:00)</div>
                {(!globalLeaderboards.topEarlyBirds || globalLeaderboards.topEarlyBirds.length === 0) ? (
                  <div className="text-sm text-gray-600">No data.</div>
                ) : (
                  <ol className="list-decimal ml-5 text-sm space-y-1">
                    {globalLeaderboards.topEarlyBirds.map(u => (
                      <li key={u.id}>
                        <a className="underline" href={linkWith({ userId: u.id, page: '1' })}>{u.id}</a>
                        {' '}— {u.count} days
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              {/* Top night visitors (days) */}
              <div>
                <div className="font-medium mb-1">Top night visitors (22:00+)</div>
                {(!globalLeaderboards.topNightOwls || globalLeaderboards.topNightOwls.length === 0) ? (
                  <div className="text-sm text-gray-600">No data.</div>
                ) : (
                  <ol className="list-decimal ml-5 text-sm space-y-1">
                    {globalLeaderboards.topNightOwls.map(u => (
                      <li key={u.id}>
                        <a className="underline" href={linkWith({ userId: u.id, page: '1' })}>{u.id}</a>
                        {' '}— {u.count} days
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              {/* Longest streak (days) */}
              <div>
                <div className="font-medium mb-1">Longest streak (days)</div>
                {(!globalLeaderboards.topLongestStreaks || globalLeaderboards.topLongestStreaks.length === 0) ? (
                  <div className="text-sm text-gray-600">No data.</div>
                ) : (
                  <ol className="list-decimal ml-5 text-sm space-y-1">
                    {globalLeaderboards.topLongestStreaks.map(u => (
                      <li key={u.id}>
                        <a className="underline" href={linkWith({ userId: u.id, page: '1' })}>{u.id}</a>
                        {' '}— {u.count} days
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </div>
        )}

        {/* User profile with lifetime achievements (shown only after search) */}
        {trimmedUserId && (
          <div className="rounded border p-4 bg-gray-50 text-gray-900">
            <h2 className="font-medium mb-2">User profile: “{userProfile?.username || trimmedUserId}”</h2>
            {!userProfile ? (
              <p className="text-sm text-gray-600">No lifetime data found for this user.</p>
            ) : (
              <div className="space-y-3">
                <div className="text-sm text-gray-700">
                  <div className="flex flex-wrap gap-4">
                    <div>
                      <div className="text-xs text-gray-500">Total visits (all time)</div>
                      <div className="font-semibold">{userProfile.totalEntriesAllTime}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Longest streak (days)</div>
                      <div className="font-semibold">{userProfile.longestStreakDays ?? 0}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">First seen</div>
                      <div className="font-semibold">{userProfile.firstSeen ? new Date(userProfile.firstSeen).toLocaleString() : '—'}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Last seen</div>
                      <div className="font-semibold">{userProfile.lastSeen ? new Date(userProfile.lastSeen).toLocaleString() : '—'}</div>
                    </div>
                  </div>
                </div>
                <div>
                  <div className="text-sm font-medium mb-1">Achievements</div>
                  {(!userProfile.achievements || userProfile.achievements.length === 0) ? (
                    <p className="text-sm text-gray-600">No achievements earned yet.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {userProfile.achievements.map((a) => (
                        <span key={a.key} className="inline-flex items-center gap-2 border rounded-full px-3 py-1 bg-white text-gray-900 shadow-sm">
                          <span className="text-xs font-semibold">{a.title}</span>
                          <span className="text-[11px] text-gray-500">{a.description}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Table */}
        <div className="overflow-auto border rounded">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-700 text-white">
              <tr>
                <th className="text-left p-2">{effectivePeriod === 'month' ? 'Date & Time' : 'Time'}</th>
                <th className="text-left p-2">User</th>
                <th className="text-left p-2">Full name</th>
                <th className="text-left p-2">Lock</th>
                <th className="text-left p-2">MAC</th>
                <th className="text-left p-2">Type</th>
                <th className="text-left p-2">Battery</th>
              </tr>
              </thead>
            <tbody>
            {entriesForUser.length === 0 && (
                <tr>
                  <td className="p-3" colSpan={7}>No entries found.</td>
                </tr>
            )}
            {entriesForUser.map((e) => (
                <tr key={e._id} className="border-t">
                  <td className="p-2">{e.entryTime ? (effectivePeriod === 'month' ? new Date(e.entryTime).toLocaleString() : new Date(e.entryTime).toLocaleTimeString()) : ''}</td>
                  <td className="p-2">{e.userId || e.username}</td>
                  <td className="p-2">{e.fullName || '—'}</td>
                  <td className="p-2">{e.lockId}</td>
                  <td className="p-2">{e.lockMac}</td>
                  <td className="p-2">{e.recordType}</td>
                  <td className="p-2">{e.electricQuantity ?? '—'}</td>
                </tr>
            ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center gap-2">
          <a
              aria-disabled={Number(page) <= 1}
              className={`px-3 py-1 rounded border ${Number(page) <= 1 ? 'pointer-events-none opacity-50' : ''}`}
              href={linkWith({ page: String(Math.max(1, Number(page) - 1)) })}
          >
            Prev
          </a>
          <span className="text-sm">
          Page {pagination?.page} / {totalPages}
        </span>
          <a
              aria-disabled={Number(page) >= totalPages}
              className={`px-3 py-1 rounded border ${Number(page) >= totalPages ? 'pointer-events-none opacity-50' : ''}`}
              href={linkWith({ page: String(Math.min(totalPages, Number(page) + 1)) })}
          >
            Next
          </a>
        </div>

        {/* Per-lock counts: hidden during user search */}
        {filters?.entryCounts && !trimmedUserId && (
            <div className="text-sm text-gray-700">
              <h2 className="font-medium mb-1">Entries by lock (selected {effectivePeriod})</h2>
              <ul className="list-disc ml-5">
                {Object.entries(filters.entryCounts).map(([id, count]) => (
                    <li key={id}>
                      <a className="underline" href={linkWith({ lockId: id, page: '1' })}>
                        {id}
                      </a>: {count}
                    </li>
                ))}
              </ul>
            </div>
        )}
      </main>
  );
}
