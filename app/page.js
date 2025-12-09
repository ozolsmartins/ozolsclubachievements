// app/page.js
import { headers } from 'next/headers';
import AutoSubmitSelect from './components/AutoSubmitSelect';
import AutoSubmitCheckbox from './components/AutoSubmitCheckbox';
import AutoSubmitInput from './components/AutoSubmitInput';
import AutoSubmitClearableInput from './components/AutoSubmitClearableInput';
import Charts from './components/Charts';
import { buildQuery, formatLocalYMD } from '@/lib/utils';
import { t as tRaw } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }) {
  // Next.js 15: searchParams is async — await before using its properties
  const sp = await searchParams;
  const page   = sp?.page ?? '1';
  const date   = sp?.date ?? '';
  const lockId = sp?.lockId ?? '';
  const limit  = sp?.limit ?? '50';
  const userId = sp?.userId ?? '';
  const period = (sp?.period ?? 'day');
  const showGlobal = sp?.showGlobal ?? '';
  const season = sp?.season ?? '';
  const lang = (sp?.lang ?? 'lv');

  const t = (key, vars = {}) => tRaw(key, vars, lang);

  const qs = buildQuery({ page, date, lockId, limit, userId, period, showGlobal, season, lang });

  // Absolute base URL for server-side fetch (Next 15/Turbopack)
  // headers() is async in Next 15 — await it first
  const h = await headers();
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
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p>Failed to load entries.</p>
          <pre className="text-xs bg-gray-100 p-3 rounded overflow-auto">
{`status: ${status}
error: ${errText}`}
        </pre>
        </main>
    );
  }

  const { entries = [], pagination = {}, filters = {}, dayAggregates = null, userProfile = null, leaderboards = null, globalLeaderboards = null, userSeasonProgress = null, analytics = null } = data;
  const totalPages = pagination.totalPages ?? 1;
  // Use LOCAL date formatting to avoid the date going back a day when pressing search
  const dayISO = filters?.date ? formatLocalYMD(new Date(filters.date)) : '';
  // Ensure a visible default date on very first load even if no query string exists
  const initialDayISO = dayISO || (date ? String(date) : '') || formatLocalYMD(new Date());
  const effectivePeriod = (filters?.period ?? period ?? 'day');
  const seasons = filters?.seasons ?? [];
  const activeSeasonKey = filters?.season ?? (season || '');
  const activeSeason = seasons.find(s => String(s.key) === String(activeSeasonKey));
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
    const next = { page, date, lockId, limit, userId, period: effectivePeriod, showGlobal, season: activeSeasonKey, lang, ...patch };
    return `/?${buildQuery(next)}`;
  };

  // Helper: translate known lock IDs to friendly names
  const lockName = (id) => {
    const s = String(id || '');
    if (s === '19228015') return t('lock_gym');
    if (s === '21920074') return t('lock_dressing');
    return id;
  };

  // Helper: Latvian singular for 1 day
  const dayLabel = (n) => {
    const num = Number(n || 0);
    if (String(lang) === 'lv' && num === 1) return t('day');
    return t('days');
  };

  // Helper: Leaderboards day word — use singular when count is 1 or ends with digit 1 (per request)
  const dayWordForCount = (n) => {
    const s = String(Number(n || 0));
    // Exception: numbers ending with '11' should NOT use singular
    if (s.endsWith('11')) return t('days');
    return s.endsWith('1') ? t('day') : t('days');
  };

  // Helper: Localized month label (month name + year) honoring selected language
  const formatMonthYear = (dateObj) => {
    if (!(dateObj instanceof Date) || isNaN(dateObj)) return '';
    const y = dateObj.getFullYear();
    const m = dateObj.getMonth();
    if (String(lang) === 'lv') {
      const monthsLv = ['janvāris', 'februāris', 'marts', 'aprīlis', 'maijs', 'jūnijs', 'jūlijs', 'augusts', 'septembris', 'oktobris', 'novembris', 'decembris'];
      return `${monthsLv[m]} ${y}`;
    }
    // default/en
    const monthsEn = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return `${monthsEn[m]} ${y}`;
  };

  // Build a friendly range label for reuse (achievements, summary, charts)
  const rangeLabel = (
    activeSeason
      ? (activeSeason.name || activeSeason.key)
      : (effectivePeriod === 'month'
          ? (initialDayISO ? formatMonthYear(new Date(initialDayISO)) : '')
          : (effectivePeriod === 'last7' ? t('range_last7_label')
            : (effectivePeriod === 'last30' ? t('range_last30_label')
              : (effectivePeriod === 'mtd' ? t('range_mtd_label')
                : (initialDayISO ? new Date(initialDayISO).toLocaleDateString() : t('today'))))))
  );

  return (
      <main className="p-6 space-y-6">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>

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
          {!activeSeason && (
            <>
              {(effectivePeriod === 'day' || effectivePeriod === 'month') && (
                <div>
                  <label className="block text-sm">{effectivePeriod === 'month' ? t('month') : t('date')}</label>
                  {effectivePeriod === 'day' && (
                    <AutoSubmitInput
                      type="date"
                      name="date"
                      defaultValue={initialDayISO}
                      max={todayISO}
                      lang={String(lang) || 'lv'}
                      className="border rounded px-3 py-2 h-10 w-52 bg-white text-gray-900"
                    />
                  )}
                  {effectivePeriod === 'month' && (
                    <AutoSubmitInput
                      type="month"
                      name="date"
                      defaultValue={initialMonthYM}
                      max={thisMonthYM}
                      lang={String(lang) || 'lv'}
                      className="border rounded px-3 py-2 h-10 w-52 bg-white text-gray-900"
                    />
                  )}
                </div>
              )}
              <div>
                <label className="block text-sm">{t('range')}</label>
                <AutoSubmitSelect name="period" defaultValue={effectivePeriod} className="border rounded px-3 py-2 h-10 w-52 bg-white text-gray-900">
                  <option value="day">{t('range_day')}</option>
                  <option value="month">{t('range_month')}</option>
                  <option value="last7">{t('range_last7')}</option>
                  <option value="mtd">{t('range_mtd')}</option>
                  <option value="last30">{t('range_last30')}</option>
                </AutoSubmitSelect>
              </div>
            </>
          )}
          <div>
            <label className="block text-sm">{t('season')}</label>
            <AutoSubmitSelect name="season" defaultValue={activeSeasonKey} className="border rounded px-3 py-2 h-10 w-52 bg-white text-gray-900">
              <option value="">{t('season_none')}</option>
              {seasons.map(s => (
                <option key={s.key} value={s.key}>{s.name || s.key}</option>
              ))}
            </AutoSubmitSelect>
          </div>
          <div>
            <label className="block text-sm">{t('lock_id')}</label>
            <AutoSubmitSelect name="lockId" defaultValue={lockId} className="border rounded px-3 py-2 h-10 w-52 bg-white text-gray-900">
              <option value="">{t('all')}</option>
              {(filters?.availableLockIds ?? []).map((id) => (
                  <option key={id} value={id}>{lockName(id)}</option>
              ))}
            </AutoSubmitSelect>
          </div>
          <div>
            <label className="block text-sm">{t('user_id')}</label>
            <AutoSubmitClearableInput
              name="userId"
              placeholder={t('user_id_placeholder')}
              defaultValue={userId}
              className="border rounded px-3 py-2 h-10 w-52 bg-white text-gray-900"
            />
          </div>
          <div>
            <label className="block text-sm">{t('per_page')}</label>
            <AutoSubmitSelect name="limit" defaultValue={limit} className="border rounded px-3 py-2 h-10 w-52 bg-white text-gray-900">
              {[25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </AutoSubmitSelect>
          </div>
          <div>
            <label className="block text-sm">{t('language')}</label>
            <AutoSubmitSelect name="lang" defaultValue={lang} className="border rounded px-3 py-2 h-10 w-52 bg-white text-gray-900">
              <option value="lv">{t('lang_lv')}</option>
              <option value="en">{t('lang_en')}</option>
            </AutoSubmitSelect>
          </div>
          <button type="submit" className="px-4 py-2 rounded">
            {t('apply')}
          </button>
        </form>

        {/* Quick date/month jump: hidden during season mode */}
        {!activeSeason && (
        <div className="flex gap-3">
          {filters?.previousDateCounts && (
              <a
                  className="underline"
                  href={linkWith({
                    date: formatLocalYMD(new Date(filters.previousDateCounts.date)),
                    page: '1'
                  })}
              >
                ← {effectivePeriod === 'month' ? formatMonthYear(new Date(filters.previousDateCounts.date)) : new Date(filters.previousDateCounts.date).toLocaleDateString()} ({filters.previousDateCounts.count})
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
                {effectivePeriod === 'month' ? formatMonthYear(new Date(filters.nextDateCounts.date)) : new Date(filters.nextDateCounts.date).toLocaleDateString()} ({filters.nextDateCounts.count}) →
              </a>
          )}
        </div>
        )}

        {/* Summary */}
        <div className="text-sm text-gray-600">
          {t('summary_showing', { page: pagination?.page, pages: totalPages, total: pagination?.total, label: rangeLabel })}
          {activeSeason ? (
            <> — <span className="text-gray-500">{new Date(activeSeason.startAt).toLocaleDateString()} – {new Date(activeSeason.endAt).toLocaleDateString()}</span></>
          ) : null}
        </div>

        {/* Achievements (only when not searching for a specific user) */}
        {!trimmedUserId && (
          <div className="rounded border p-4 achievements">
            <h2 className="font-medium mb-2">{t('achievements_for_label', { label: rangeLabel })}</h2>
            {!achievementsFromServer || (achievementsFromServer.totalEntries ?? 0) === 0 ? (
              <p className="text-sm text-gray-600">{t('achievements_none')}</p>
            ) : (
              <ul className="list-disc ml-5 text-sm space-y-1">
                <li>
                  {t('total_entries', { suffix: showAllPagesLabel ? t('all_pages_suffix') : '' })} <strong>{achievementsFromServer.totalEntries}</strong>
                </li>
                <li>
                  {t('unique_users', { suffix: showAllPagesLabel ? t('all_pages_suffix') : '' })} <strong>{achievementsFromServer.uniqueUsers}</strong>
                </li>
                {achievementsFromServer.mostActiveUser && (
                  <li>
                    {t('most_active_user')} <strong>{achievementsFromServer.mostActiveUser.id}</strong> ({achievementsFromServer.mostActiveUser.count})
                  </li>
                )}
                {/* Hide lock-related and hour achievements in month mode */}
                {effectivePeriod !== 'month' && achievementsFromServer.mostUsedLock && (
                  <li>
                    {t('most_used_lock')} <strong>{lockName(achievementsFromServer.mostUsedLock.id)}</strong> ({achievementsFromServer.mostUsedLock.count})
                  </li>
                )}
                {effectivePeriod !== 'month' && achievementsFromServer.busiestHour && (
                  <li>
                    {t('busiest_hour')} <strong>{String(achievementsFromServer.busiestHour.hour).padStart(2, '0')}:00</strong> ({achievementsFromServer.busiestHour.count})
                  </li>
                )}
                {(achievementsFromServer.firstEntryTime || achievementsFromServer.lastEntryTime) && (
                  <li>
                    {t('time_span')} {achievementsFromServer.firstEntryTime ? (effectivePeriod === 'month' ? new Date(achievementsFromServer.firstEntryTime).toLocaleString() : new Date(achievementsFromServer.firstEntryTime).toLocaleTimeString()) : '—'}
                    {' '}–{' '}
                    {achievementsFromServer.lastEntryTime ? (effectivePeriod === 'month' ? new Date(achievementsFromServer.lastEntryTime).toLocaleString() : new Date(achievementsFromServer.lastEntryTime).toLocaleTimeString()) : '—'}
                  </li>
                )}
              </ul>
            )}
          </div>
        )}

        {/* User profile with lifetime achievements (shown only after search) */}
        {trimmedUserId && (
          <div className="rounded border p-4 user-profile">
            <h2 className="font-medium mb-2">{t('user_profile')} “{userProfile?.username || trimmedUserId}”</h2>
            {!userProfile ? (
              <p className="text-sm text-gray-600">{t('no_user_lifetime')}</p>
            ) : (
              <div className="space-y-3">
                <div className="text-sm text-gray-700">
                  <div className="flex flex-wrap gap-4">
                    <div>
                      <div className="text-xs text-gray-500">{t('total_visits_all_time')}</div>
                      <div className="font-semibold">{userProfile.totalEntriesAllTime}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">{t('longest_streak_days')}</div>
                      <div className="font-semibold">{userProfile.longestStreakDays ?? 0}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">{t('first_seen')}</div>
                      <div className="font-semibold">{userProfile.firstSeen ? new Date(userProfile.firstSeen).toLocaleString() : '—'}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">{t('last_seen')}</div>
                      <div className="font-semibold">{userProfile.lastSeen ? new Date(userProfile.lastSeen).toLocaleString() : '—'}</div>
                    </div>
                  </div>
                </div>
                <div>
                  <div className="text-sm font-medium mb-1">{t('achievements')}</div>
                  {(!userProfile.achievements || userProfile.achievements.length === 0) ? (
                    <p className="text-sm text-gray-600">{t('none_yet')}</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {userProfile.achievements.map((a) => {
                        const titleKey = `ach_title_${a.key}`;
                        const descKey = `ach_desc_${a.key}`;
                        const title = t(titleKey) || a.title;
                        const desc = t(descKey) || a.description;
                        return (
                          <span key={a.key} className="inline-flex items-center gap-2 border rounded-full px-3 py-1 bg-white text-gray-900 shadow-sm">
                            <span className="text-xs font-semibold">{title}</span>
                            <span className="text-[11px] text-gray-500">{desc}</span>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
                {activeSeason && (
                  <div className="rounded border p-3 bg-white text-gray-900">
                    <div className="text-sm font-medium mb-1">{t('season_progress', { season: activeSeason.name || activeSeason.key })}</div>
                    {!userSeasonProgress ? (
                      <div className="text-sm text-gray-600">{t('no_season_activity')}</div>
                    ) : (
                      <div className="flex flex-wrap gap-4 text-sm">
                        <div>
                          <div className="text-xs text-gray-500">{t('points_distinct_days')}</div>
                          <div className="font-semibold">{userSeasonProgress.points}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">{t('rank')}</div>
                          <div className="font-semibold">{userSeasonProgress.rank ?? '—'}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">{t('current_streak')}</div>
                          <div className="font-semibold">{userSeasonProgress.currentStreakDays ?? 0} {dayLabel(userSeasonProgress.currentStreakDays ?? 0)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">{t('longest_streak_days')}</div>
                          <div className="font-semibold">{userSeasonProgress.longestStreakDays ?? 0} {dayLabel(userSeasonProgress.longestStreakDays ?? 0)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">{t('level')}</div>
                          <div className="font-semibold">{userSeasonProgress.level ?? 0}{userSeasonProgress.nextLevelAt ? ` (next at ${userSeasonProgress.nextLevelAt})` : ''}</div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Leaderboards (Month or Season). User-centric — also show when searching a user */}
        {effectivePeriod === 'month' && leaderboards && (
          <div className="rounded border p-4 leaderboard">
            <h2 className="font-medium mb-3">{t('leaderboard', { period: activeSeason ? 'season' : effectivePeriod })}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {/* Top users */}
              <div>
                <div className="font-medium mb-1">{t('top_users')}</div>
                {(!leaderboards.topUsers || leaderboards.topUsers.length === 0) ? (
                  <div className="text-sm text-gray-600">{t('no_data')}</div>
                ) : (
                  <ol className="list-decimal ml-5 text-sm space-y-1">
                    {leaderboards.topUsers.map(u => (
                      <li key={u.id}>
                        <a className="underline" href={linkWith({ userId: u.id, page: '1' })}>{u.id}</a>
                        {' '}— {u.count} {effectivePeriod === 'month' ? dayWordForCount(u.count) : t('entries_word')}
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              {/* In month mode, do not show a locks leaderboard */}
              {effectivePeriod !== 'month' && leaderboards.topLocks && (
                <div>
                  <div className="font-medium mb-1">{t('top_locks')}</div>
                  {leaderboards.topLocks.length === 0 ? (
                    <div className="text-sm text-gray-600">{t('no_data')}</div>
                  ) : (
                    <ol className="list-decimal ml-5 text-sm space-y-1">
                      {leaderboards.topLocks.map(l => (
                        <li key={l.id}>
                          <a className="underline" href={linkWith({ lockId: l.id, page: '1' })}>{lockName(l.id)}</a>
                          {' '}— {l.count} {t('entries_word')}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}

              {/* Top early visitors */}
              {leaderboards.topEarlyBirds && (
                <div>
                  <div className="font-medium mb-1">{t('top_early')}</div>
                  {leaderboards.topEarlyBirds.length === 0 ? (
                    <div className="text-sm text-gray-600">{t('no_data')}</div>
                  ) : (
                    <ol className="list-decimal ml-5 text-sm space-y-1">
                      {leaderboards.topEarlyBirds.map(u => (
                        <li key={u.id}>
                          <a className="underline" href={linkWith({ userId: u.id, page: '1' })}>{u.id}</a>
                          {' '}— {u.count} {dayWordForCount(u.count)}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}

              {/* Top night visitors */}
              {leaderboards.topNightOwls && (
                <div>
                  <div className="font-medium mb-1">{t('top_night')}</div>
                  {leaderboards.topNightOwls.length === 0 ? (
                    <div className="text-sm text-gray-600">{t('no_data')}</div>
                  ) : (
                    <ol className="list-decimal ml-5 text-sm space-y-1">
                      {leaderboards.topNightOwls.map(u => (
                        <li key={u.id}>
                          <a className="underline" href={linkWith({ userId: u.id, page: '1' })}>{u.id}</a>
                          {' '}— {u.count} {dayWordForCount(u.count)}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}

              {/* Longest streak in days (consecutive active days) */}
              {leaderboards.topLongestStreaks && (
                <div>
                  <div className="font-medium mb-1">{t('longest_streak')}</div>
                  {leaderboards.topLongestStreaks.length === 0 ? (
                    <div className="text-sm text-gray-600">{t('no_data')}</div>
                  ) : (
                    <ol className="list-decimal ml-5 text-sm space-y-1">
                      {leaderboards.topLongestStreaks.map(u => (
                        <li key={u.id}>
                          <a className="underline" href={linkWith({ userId: u.id, page: '1' })}>{u.id}</a>
                          {' '}— {u.count} {dayWordForCount(u.count)}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}

              {null}
            </div>
            {/* Toggle for Global Leaderboard appears under the monthly/season leaderboard (also when searching a user) */}
            <div className="mt-4 border-t pt-3">
              <form action="/" method="get" className="flex items-center gap-3">
                {/* Preserve current filters */}
                <input type="hidden" name="date" value={initialDayISO} />
                <input type="hidden" name="period" value={effectivePeriod} />
                {lockId ? (<input type="hidden" name="lockId" value={lockId} />) : null}
                <input type="hidden" name="limit" value={limit} />
                <input type="hidden" name="page" value={page} />
                <input type="hidden" name="lang" value={lang} />
                {/* Preserve userId during search so toggling doesn't clear user context */}
                {trimmedUserId ? (<input type="hidden" name="userId" value={trimmedUserId} />) : null}
                {activeSeasonKey ? (<input type="hidden" name="season" value={activeSeasonKey} />) : null}
                <AutoSubmitCheckbox
                  id="showGlobal2"
                  name="showGlobal"
                  defaultChecked={String(showGlobal) === '1'}
                  label={t('show_global')}
                />
              </form>
            </div>
          </div>
        )}

        {/* Global Leaderboard (lifetime) - shown below the monthly leaderboard area when toggled */}
        {String(showGlobal) === '1' && globalLeaderboards && (
          <div className="rounded border p-4 leaderboard">
            <h2 className="font-medium mb-3">{t('global_leaderboard')}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {/* Top users (lifetime distinct active days) */}
              <div>
                <div className="font-medium mb-1">{t('top_users')}</div>
                {(!globalLeaderboards.topUsers || globalLeaderboards.topUsers.length === 0) ? (
                  <div className="text-sm text-gray-600">{t('no_data')}</div>
                ) : (
                  <ol className="list-decimal ml-5 text-sm space-y-1">
                    {globalLeaderboards.topUsers.map(u => (
                      <li key={u.id}>
                        <a className="underline" href={linkWith({ userId: u.id, page: '1' })}>{u.id}</a>
                        {' '}— {u.count} {dayWordForCount(u.count)}
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              {/* Top early visitors (days) */}
              <div>
                <div className="font-medium mb-1">{t('top_early')}</div>
                {(!globalLeaderboards.topEarlyBirds || globalLeaderboards.topEarlyBirds.length === 0) ? (
                  <div className="text-sm text-gray-600">{t('no_data')}</div>
                ) : (
                  <ol className="list-decimal ml-5 text-sm space-y-1">
                    {globalLeaderboards.topEarlyBirds.map(u => (
                      <li key={u.id}>
                        <a className="underline" href={linkWith({ userId: u.id, page: '1' })}>{u.id}</a>
                        {' '}— {u.count} {dayWordForCount(u.count)}
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              {/* Top night visitors (days) */}
              <div>
                <div className="font-medium mb-1">{t('top_night')}</div>
                {(!globalLeaderboards.topNightOwls || globalLeaderboards.topNightOwls.length === 0) ? (
                  <div className="text-sm text-gray-600">{t('no_data')}</div>
                ) : (
                  <ol className="list-decimal ml-5 text-sm space-y-1">
                    {globalLeaderboards.topNightOwls.map(u => (
                      <li key={u.id}>
                        <a className="underline" href={linkWith({ userId: u.id, page: '1' })}>{u.id}</a>
                        {' '}— {u.count} {dayWordForCount(u.count)}
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              {/* Longest streak (days) */}
              <div>
                <div className="font-medium mb-1">{t('longest_streak')}</div>
                {(!globalLeaderboards.topLongestStreaks || globalLeaderboards.topLongestStreaks.length === 0) ? (
                  <div className="text-sm text-gray-600">{t('no_data')}</div>
                ) : (
                  <ol className="list-decimal ml-5 text-sm space-y-1">
                    {globalLeaderboards.topLongestStreaks.map(u => (
                      <li key={u.id}>
                        <a className="underline" href={linkWith({ userId: u.id, page: '1' })}>{u.id}</a>
                        {' '}— {u.count} {dayWordForCount(u.count)}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="overflow-auto border rounded">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-700 text-white">
              <tr>
                <th className="text-left p-2">{effectivePeriod === 'month' ? t('table_datetime') : t('table_time')}</th>
                <th className="text-left p-2">{t('table_user')}</th>
                <th className="text-left p-2">{t('table_lock')}</th>
              </tr>
              </thead>
              <tbody>
            {entriesForUser.length === 0 && (
                <tr>
                  <td className="p-3" colSpan={3}>{t('no_entries_found')}</td>
                </tr>
            )}
            {entriesForUser.map((e) => (
                <tr key={e._id} className="border-t">
                  <td className="p-2">{e.entryTime ? (effectivePeriod === 'month' ? new Date(e.entryTime).toLocaleString() : new Date(e.entryTime).toLocaleTimeString()) : ''}</td>
                  <td className="p-2">{e.userId || e.username}</td>
                  <td className="p-2">{/** lock name translation */}{(function(id){
                    if (String(id) === '19228015') return t('lock_gym');
                    if (String(id) === '21920074') return t('lock_dressing');
                    return id;
                  })(e.lockId)}</td>
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
            {t('prev')}
          </a>
          <span className="text-sm">
          {t('page')} {pagination?.page} / {totalPages}
        </span>
          <a
              aria-disabled={Number(page) >= totalPages}
              className={`px-3 py-1 rounded border ${Number(page) >= totalPages ? 'pointer-events-none opacity-50' : ''}`}
              href={linkWith({ page: String(Math.min(totalPages, Number(page) + 1)) })}
          >
            {t('next')}
          </a>
        </div>

        {/* Per-lock counts: hidden during user search */}
        {filters?.entryCounts && !trimmedUserId && (
            <div className="text-sm text-gray-700">
              <h2 className="font-medium mb-1">{t('entries_by_lock', { period: effectivePeriod })}</h2>
              <ul className="list-disc ml-5">
                {Object.entries(filters.entryCounts).map(([id, count]) => (
                    <li key={id}>
                      <a className="underline" href={linkWith({ lockId: id, page: '1' })}>
                        {lockName(id)}
                      </a>: {count}
                    </li>
                ))}
              </ul>
            </div>
        )}

        {/* Charts: visible when not searching a user; hide multi-day charts in Day mode (handled inside component) */}
        {!trimmedUserId && (
          <div className="space-y-3">
            <h2 className="font-medium">{t('charts')}</h2>
            <Charts
              analytics={analytics}
              lang={lang}
              meta={{
                  rangeLabel: rangeLabel,
                  // Charts are computed for the primary lock (19228015) regardless of UI lock filter
                  lockId: lockName('19228015'),
                  period: activeSeason ? 'month' : effectivePeriod
                }}
              />
          </div>
        )}
      </main>
  );
}
