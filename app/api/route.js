// app/api/route.js
import mongoose from 'mongoose';
import { NextResponse } from 'next/server';
import { createLogger, getRequestIdFromHeaders, timed } from '@/lib/logger';
import { rateLimitKeyFromRequest, rateLimitConsume, getRateLimitConfig } from '@/lib/rateLimit';
import { startOfDay, endOfDay, startOfMonth, endOfMonth } from 'date-fns';
import { connectToDatabase } from '@/lib/mongodb';

// In-memory Seasons catalog (can be moved to DB later)
const SEASONS = [
    {
        key: '2025Q4',
        name: 'Season Q4 2025',
        startAt: new Date(2025, 9, 1), // Oct 1, 2025
        endAt: new Date(2025, 11, 31, 23, 59, 59, 999), // Dec 31, 2025
    },
    {
        key: '2025Q3',
        name: 'Season Q3 2025',
        startAt: new Date(2025, 6, 1), // Jul 1, 2025
        endAt: new Date(2025, 8, 30, 23, 59, 59, 999), // Sep 30, 2025
    },
];

// Primary lock for day-counting logic (distinct active days, first-of-day calculations)
const PRIMARY_LOCK = '19228015';

// ----- Entry model only (no Customer usage at all) -----
const Entry =
    mongoose.models.Entry ||
    mongoose.model(
        'Entry',
        new mongoose.Schema(
            {
                username: String,      // stored as string
                lockId: String,
                entryTime: Date,
                lockMac: String,
                recordType: Number,
                electricQuantity: Number,
            },
            { timestamps: true }
        )
    );

export async function GET(request) {
    // Generate request ID and logger up-front so we can use in any early returns
    const reqId = getRequestIdFromHeaders(request.headers) || (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2));
    const log = createLogger({ requestId: reqId, route: 'GET /api' });

    // Basic token-bucket rate limiting per IP
    const rlKey = rateLimitKeyFromRequest(request, 'api');
    const rl = rateLimitConsume(rlKey, getRateLimitConfig());
    if (!rl.ok) {
        log.warn('rate_limited', { key: rlKey, retryAfter: rl.retryAfter });
        const resp = NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
        resp.headers.set('Retry-After', String(rl.retryAfter));
        resp.headers.set('X-Request-ID', reqId);
        return resp;
    }

    try {
        log.info('request_start');
        await connectToDatabase();

        const { searchParams } = new URL(request.url);
        const page  = parseInt(searchParams.get('page')  || '1', 10);
        const limit = parseInt(searchParams.get('limit') || '50', 10);
        const lockId = searchParams.get('lockId') || '';
        const userId = (searchParams.get('userId') || '').trim(); // used as username filter
        const dateParam = searchParams.get('date');
        const periodRaw = (searchParams.get('period') || 'day').toLowerCase();
        let period = ['day', 'month', 'last7', 'last30', 'mtd'].includes(periodRaw) ? periodRaw : 'day';
        const seasonKey = (searchParams.get('season') || '').trim();
        const activeSeason = SEASONS.find(s => s.key.toLowerCase() === seasonKey.toLowerCase());
        // Parse YYYY-MM-DD as a LOCAL date to avoid UTC shifting the day
        let date;
        if (dateParam) {
            const m3 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateParam);
            const m2 = /^(\d{4})-(\d{2})$/.exec(dateParam);
            if (m3) {
                const y = Number(m3[1]);
                const mo = Number(m3[2]) - 1;
                const d = Number(m3[3]);
                date = new Date(y, mo, d);
            } else if (m2) {
                const y = Number(m2[1]);
                const mo = Number(m2[2]) - 1;
                date = new Date(y, mo, 1);
            } else {
                // Fallback for any other format
                date = new Date(dateParam);
            }
        } else {
            date = new Date();
        }

        // Determine time window based on period or season
        let rangeStart, rangeEnd;
        if (period === 'month') {
            rangeStart = startOfMonth(date);
            rangeEnd = endOfMonth(date);
        } else if (period === 'last7') {
            const now = new Date();
            rangeEnd = endOfDay(now);
            rangeStart = startOfDay(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000));
        } else if (period === 'last30') {
            const now = new Date();
            rangeEnd = endOfDay(now);
            rangeStart = startOfDay(new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000));
        } else if (period === 'mtd') {
            const now = new Date();
            rangeStart = startOfMonth(now);
            rangeEnd = endOfDay(now);
        } else {
            rangeStart = startOfDay(date);
            rangeEnd = endOfDay(date);
        }
        let seasonActive = false;
        if (activeSeason) {
            rangeStart = activeSeason.startAt;
            rangeEnd = activeSeason.endAt;
            seasonActive = true;
            // Treat season like month for user-centric aggregates
            period = 'month';
        }

        // Use the server's local timezone for all MongoDB date part operations
        // MongoDB date operators default to UTC; providing timezone keeps logic consistent
        // with UI and rangeStart/rangeEnd which are computed in local time.
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

        // Build query
        // Optional case-insensitive exact match for username when userId is provided
        const usernameFilter = userId
            ? { username: { $regex: `^${userId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }
            : {};

        const query = {
            entryTime: { $gte: rangeStart, $lte: rangeEnd },
            ...(lockId ? { lockId } : {}),
            ...usernameFilter,
        };

        // Fetch paginated entries
        const entries = await timed(log, 'find_entries', () => Entry.find(query)
            // Ensure deterministic ordering even when entryTime values are equal
            .sort({ entryTime: -1, _id: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean());

        // Total for pagination
        const total = await timed(log, 'count_total', () => Entry.countDocuments(query));

        // Distinct lock IDs (for filters)
        const availableLockIds = await timed(log, 'distinct_lockIds', () => Entry.distinct('lockId'));

        // Counts by lockId for the selected range and current filters (consistent with query)
        const countsAgg = await timed(log, 'agg_counts_by_lock', () => Entry.aggregate([
            { $match: query },
            { $group: { _id: '$lockId', count: { $sum: 1 } } },
        ]));
        const entryCounts = Object.fromEntries(countsAgg.map(d => [d._id, d.count]));

        // Previous/Next date with entries (disabled in season mode)
        let previousDateCounts = null;
        let nextDateCounts = null;
        if (!seasonActive) {
            const previousDateEntry = await timed(log, 'find_prev_date', () => Entry.findOne(
                { entryTime: { $lt: rangeStart } },
                { entryTime: 1 }
            )
                // Tie-break by _id for stable selection
                .sort({ entryTime: -1, _id: -1 }));

            if (previousDateEntry?.entryTime) {
                const prevStart = period === 'month' ? startOfMonth(previousDateEntry.entryTime) : startOfDay(previousDateEntry.entryTime);
                const prevEnd   = period === 'month' ? endOfMonth(previousDateEntry.entryTime)   : endOfDay(previousDateEntry.entryTime);
                const prevTotal = await Entry.countDocuments({ entryTime: { $gte: prevStart, $lte: prevEnd } });
                previousDateCounts = { date: prevStart, count: prevTotal };
            }

            const nextDateEntry = await timed(log, 'find_next_date', () => Entry.findOne(
                { entryTime: { $gt: rangeEnd } },
                { entryTime: 1 }
            )
                // Tie-break by _id for stable selection
                .sort({ entryTime: 1, _id: 1 }));

            if (nextDateEntry?.entryTime) {
                const nextStart = period === 'month' ? startOfMonth(nextDateEntry.entryTime) : startOfDay(nextDateEntry.entryTime);
                const nextEnd   = period === 'month' ? endOfMonth(nextDateEntry.entryTime)   : endOfDay(nextDateEntry.entryTime);
                const nextTotal = await Entry.countDocuments({ entryTime: { $gte: nextStart, $lte: nextEnd } });
                nextDateCounts = { date: nextStart, count: nextTotal };
            }
        }

        // Day/Month/Season-level aggregates across ALL pages (for the selected range and filters)
        const aggPipelines = [
            { $match: query },
            {
                $facet: {
                    uniqueUsers: [
                        { $group: { _id: null, users: { $addToSet: '$username' } } },
                        { $project: { _id: 0, count: { $size: '$users' } } },
                    ],
                    // mostActiveUser differs by period: for month we count distinct active days per user
                    mostActiveUser: (
                        period === 'month'
                            ? [
                                // Only count distinct days from the primary lock
                                { $match: { lockId: PRIMARY_LOCK } },
                                { $project: { username: 1, day: { $dateToString: { format: '%Y-%m-%d', date: '$entryTime', timezone: timeZone } } } },
                                { $group: { _id: { u: '$username', d: '$day' } } },
                                { $group: { _id: '$_id.u', count: { $sum: 1 } } },
                                { $sort: { count: -1, _id: 1 } },
                                { $limit: 1 },
                              ]
                            : [
                                { $group: { _id: '$username', count: { $sum: 1 } } },
                                { $sort: { count: -1, _id: 1 } },
                                { $limit: 1 },
                              ]
                    ),
                    // locks/hour are not part of month/season achievements; still compute for day for compatibility
                    mostUsedLock: (
                        period === 'month'
                            ? []
                            : [
                                { $match: { lockId: { $ne: null } } },
                                { $group: { _id: '$lockId', count: { $sum: 1 } } },
                                { $sort: { count: -1, _id: 1 } },
                                { $limit: 1 },
                              ]
                    ),
                    busiestHour: (
                        period === 'month'
                            ? []
                            : [
                                { $project: { hour: { $hour: { date: '$entryTime', timezone: timeZone } } } },
                                { $group: { _id: '$hour', count: { $sum: 1 } } },
                                { $sort: { count: -1, _id: 1 } },
                                { $limit: 1 },
                              ]
                    ),
                    span: [
                        { $group: { _id: null, first: { $min: '$entryTime' }, last: { $max: '$entryTime' } } },
                        { $project: { _id: 0, first: 1, last: 1 } },
                    ],
                },
            },
        ];

        const aggResult = await timed(log, 'agg_achievements', () => Entry.aggregate(aggPipelines));
        const facet = aggResult?.[0] || {};
        const uniqueUsers = facet.uniqueUsers?.[0]?.count ?? 0;
        const mostActiveUser = facet.mostActiveUser?.[0]
            ? { id: facet.mostActiveUser[0]._id, count: facet.mostActiveUser[0].count }
            : null;
        const mostUsedLock = facet.mostUsedLock?.[0]
            ? { id: facet.mostUsedLock[0]._id, count: facet.mostUsedLock[0].count }
            : null;
        const busiestHour = facet.busiestHour?.[0]
            ? { hour: facet.busiestHour[0]._id, count: facet.busiestHour[0].count }
            : null;
        const firstEntryTime = facet.span?.[0]?.first ?? null;
        const lastEntryTime = facet.span?.[0]?.last ?? null;

        // Leaderboards for current range
        const leaderboardAgg = await timed(log, 'agg_leaderboards', () => Entry.aggregate([
            { $match: { entryTime: { $gte: rangeStart, $lte: rangeEnd }, ...(lockId ? { lockId } : {}) } },
            {
                $facet: (
                    period === 'month'
                        ? {
                            // Users ranked by number of distinct active days during the month
                            topUsers: [
                                { $match: { lockId: PRIMARY_LOCK } },
                                { $project: { username: 1, day: { $dateToString: { format: '%Y-%m-%d', date: '$entryTime', timezone: timeZone } } } },
                                { $group: { _id: { u: '$username', d: '$day' } } },
                                { $group: { _id: '$_id.u', count: { $sum: 1 } } },
                                { $sort: { count: -1, _id: 1 } },
                                { $limit: 5 },
                            ],
                            // Early birds by number of days where the FIRST entry was before 08:00
                            topEarlyBirds: [
                                { $match: { lockId: PRIMARY_LOCK } },
                                { $addFields: { day: { $dateToString: { format: '%Y-%m-%d', date: '$entryTime', timezone: timeZone } } } },
                                { $sort: { entryTime: 1, _id: 1 } },
                                { $group: { _id: { u: '$username', d: '$day' }, firstTime: { $first: '$entryTime' } } },
                                { $project: { u: '$_id.u', hour: { $hour: { date: '$firstTime', timezone: timeZone } } } },
                                { $match: { hour: { $lt: 8 } } },
                                { $group: { _id: '$u', count: { $sum: 1 } } },
                                { $sort: { count: -1, _id: 1 } },
                                { $limit: 5 },
                            ],
                            // Night owls by number of days where the FIRST entry AFTER 22:00 exists for the user
                            // Implementation: restrict to entries with hour >= 22, then pick the earliest (first) such entry per user-day,
                            // then count days per user.
                            topNightOwls: [
                                { $match: { lockId: PRIMARY_LOCK } },
                                { $addFields: { 
                                    day: { $dateToString: { format: '%Y-%m-%d', date: '$entryTime', timezone: timeZone } },
                                    hour: { $hour: { date: '$entryTime', timezone: timeZone } }
                                } },
                                { $match: { hour: { $gte: 22 } } },
                                { $sort: { entryTime: 1, _id: 1 } },
                                { $group: { _id: { u: '$username', d: '$day' }, firstAfter22: { $first: '$entryTime' } } },
                                { $group: { _id: '$_id.u', count: { $sum: 1 } } },
                                { $sort: { count: -1, _id: 1 } },
                                { $limit: 5 },
                            ],
                            // Longest streak in days per user within the month (consecutive active days)
                            topLongestStreaks: [
                                { $match: { lockId: PRIMARY_LOCK } },
                                // Truncate to local day to build day Date values
                                { $addFields: { day: { $dateTrunc: { date: '$entryTime', unit: 'day', timezone: timeZone } } } },
                                // Distinct user-day pairs
                                { $group: { _id: { u: '$username', d: '$day' } } },
                                // Sort by user, then day
                                { $sort: { '_id.u': 1, '_id.d': 1 } },
                                // Collect ordered array of days per user
                                { $group: { _id: '$_id.u', days: { $push: '$_id.d' } } },
                                // Compute longest consecutive streak using $reduce
                                { $project: {
                                    count: {
                                        $let: {
                                            vars: { arr: '$days' },
                                            in: {
                                                $let: {
                                                    vars: {
                                                        res: {
                                                            $reduce: {
                                                                input: '$$arr',
                                                                initialValue: { last: null, curr: 0, best: 0 },
                                                                in: {
                                                                    $let: {
                                                                        vars: {
                                                                            isConsecutive: {
                                                                                $cond: [
                                                                                    { $and: [
                                                                                        { $ne: ['$$value.last', null] },
                                                                                        { $eq: [
                                                                                            { $divide: [ { $subtract: ['$$this', '$$value.last'] }, 86400000 ] },
                                                                                            1
                                                                                        ] }
                                                                                    ] },
                                                                                    true,
                                                                                    false
                                                                                ]
                                                                            },
                                                                            nextCurr: {
                                                                                $cond: [
                                                                                    { $and: [
                                                                                        { $ne: ['$$value.last', null] },
                                                                                        { $eq: [
                                                                                            { $divide: [ { $subtract: ['$$this', '$$value.last'] }, 86400000 ] },
                                                                                            1
                                                                                        ] }
                                                                                    ] },
                                                                                    { $add: ['$$value.curr', 1] },
                                                                                    1
                                                                                ]
                                                                            }
                                                                        },
                                                                        in: {
                                                                            last: '$$this',
                                                                            curr: '$$nextCurr',
                                                                            best: { $cond: [ { $gt: ['$$nextCurr', '$$value.best'] }, '$$nextCurr', '$$value.best' ] }
                                                                        }
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    },
                                                    in: '$$res.best'
                                                }
                                            }
                                        }
                                    }
                                } },
                                { $sort: { count: -1, _id: 1 } },
                                { $limit: 5 }
                            ],
                          }
                        : {
                            topUsers: [
                                { $group: { _id: '$username', count: { $sum: 1 } } },
                                { $sort: { count: -1, _id: 1 } },
                                { $limit: 5 },
                            ],
                            topLocks: [
                                { $match: { lockId: { $ne: null } } },
                                { $group: { _id: '$lockId', count: { $sum: 1 } } },
                                { $sort: { count: -1, _id: 1 } },
                                { $limit: 5 },
                            ],
                            // Day-mode early birds: number of users' days (within the single day range) where FIRST entry was before 08:00
                            topEarlyBirds: [
                                { $addFields: { day: { $dateToString: { format: '%Y-%m-%d', date: '$entryTime', timezone: timeZone } } } },
                                { $sort: { entryTime: 1, _id: 1 } },
                                { $group: { _id: { u: '$username', d: '$day' }, firstTime: { $first: '$entryTime' } } },
                                { $project: { u: '$_id.u', hour: { $hour: { date: '$firstTime', timezone: timeZone } } } },
                                { $match: { hour: { $lt: 8 } } },
                                { $group: { _id: '$u', count: { $sum: 1 } } },
                                { $sort: { count: -1, _id: 1 } },
                                { $limit: 5 },
                            ],
                            // Day-mode night owls: count users' days where the FIRST entry AFTER 22:00 exists (same logic as month)
                            topNightOwls: [
                                { $addFields: { 
                                    day: { $dateToString: { format: '%Y-%m-%d', date: '$entryTime', timezone: timeZone } },
                                    hour: { $hour: { date: '$entryTime', timezone: timeZone } }
                                } },
                                { $match: { hour: { $gte: 22 } } },
                                { $sort: { entryTime: 1, _id: 1 } },
                                { $group: { _id: { u: '$username', d: '$day' }, firstAfter22: { $first: '$entryTime' } } },
                                { $group: { _id: '$_id.u', count: { $sum: 1 } } },
                                { $sort: { count: -1, _id: 1 } },
                                { $limit: 5 },
                            ],
                          }
                ),
            },
        ]));
        const lbFacet = leaderboardAgg?.[0] || {};
        const leaderboards = {
            topUsers: (lbFacet.topUsers || []).map(x => ({ id: x._id, count: x.count })),
            topLocks: period === 'month' ? [] : (lbFacet.topLocks || []).map(x => ({ id: x._id, count: x.count })),
            topEarlyBirds: (lbFacet.topEarlyBirds || []).map(x => ({ id: x._id, count: x.count })),
            topNightOwls: (lbFacet.topNightOwls || []).map(x => ({ id: x._id, count: x.count })),
            topLongestStreaks: (lbFacet.topLongestStreaks || []).map(x => ({ id: x._id, count: x.count })),
        };

        // ----- Analytics (trends, retention/streak distributions, cohorts) -----
        // Respect current filters (lockId, userId if provided) and the current range window.
        // Charts will be rendered only when not searching a single user in the UI, but we still compute here
        // based on the current filters for consistency.
        // Analytics must be based ONLY on the primary lock, regardless of the UI-selected lock filter
        const analyticsQuery = {
            ...query,
            lockId: PRIMARY_LOCK,
        };
        const analyticsAgg = await timed(log, 'agg_analytics', () => Entry.aggregate([
            { $match: analyticsQuery },
            {
                $facet: {
                    // Entries per day (counts)
                    entriesPerDay: [
                        { $project: { day: { $dateToString: { format: '%Y-%m-%d', date: '$entryTime', timezone: timeZone } } } },
                        { $group: { _id: '$day', count: { $sum: 1 } } },
                        { $sort: { _id: 1 } },
                    ],
                    // Entries per hour (for Day mode visualizations)
                    entriesPerHour: [
                        { $project: { h: { $hour: { date: '$entryTime', timezone: timeZone } } } },
                        { $group: { _id: '$h', count: { $sum: 1 } } },
                        { $sort: { _id: 1 } },
                    ],
                    // Distinct active users per day (DAU series)
                    dauPerDay: [
                        { $project: { u: '$username', d: { $dateToString: { format: '%Y-%m-%d', date: '$entryTime', timezone: timeZone } } } },
                        { $group: { _id: { u: '$u', d: '$d' } } },
                        { $group: { _id: '$_id.d', count: { $sum: 1 } } },
                        { $sort: { _id: 1 } },
                    ],
                    // Distinct active users per hour (for Day mode)
                    dauPerHour: [
                        { $project: { u: '$username', h: { $hour: { date: '$entryTime', timezone: timeZone } } } },
                        { $group: { _id: { u: '$u', h: '$h' } } },
                        { $group: { _id: '$_id.h', count: { $sum: 1 } } },
                        { $sort: { _id: 1 } },
                    ],
                    // Distinct active users per week (WAU series)
                    wauByWeek: [
                        { $project: { u: '$username', w: { $dateTrunc: { date: '$entryTime', unit: 'week', timezone: timeZone } } } },
                        { $group: { _id: { u: '$u', w: '$w' } } },
                        { $group: { _id: '$_id.w', count: { $sum: 1 } } },
                        { $sort: { _id: 1 } },
                    ],
                    // Distinct active users per month (MAU series)
                    mauByMonth: [
                        { $project: { u: '$username', m: { $dateTrunc: { date: '$entryTime', unit: 'month', timezone: timeZone } } } },
                        { $group: { _id: { u: '$u', m: '$m' } } },
                        { $group: { _id: '$_id.m', count: { $sum: 1 } } },
                        { $sort: { _id: 1 } },
                    ],
                    // Retention distribution: number of users by active days within the range
                    retention: [
                        { $project: { u: '$username', d: { $dateTrunc: { date: '$entryTime', unit: 'day', timezone: timeZone } } } },
                        { $group: { _id: { u: '$u', d: '$d' } } },
                        { $group: { _id: '$_id.u', days: { $sum: 1 } } },
                        { $project: {
                            bucket: {
                                $cond: [
                                    { $gt: ['$days', 19] },
                                    '20+',
                                    { $toString: '$days' }
                                ]
                            }
                        } },
                        { $group: { _id: '$bucket', count: { $sum: 1 } } },
                    ],
                    // Streak distribution: per-user longest streak within the range, bucketed
                    streaks: [
                        { $addFields: { day: { $dateTrunc: { date: '$entryTime', unit: 'day', timezone: timeZone } } } },
                        { $group: { _id: { u: '$username', d: '$day' } } },
                        { $sort: { '_id.u': 1, '_id.d': 1 } },
                        { $group: { _id: '$_id.u', days: { $push: '$_id.d' } } },
                        { $project: {
                            longest: {
                                $let: {
                                    vars: { arr: '$days' },
                                    in: {
                                        $let: {
                                            vars: {
                                                res: {
                                                    $reduce: {
                                                        input: '$$arr',
                                                        initialValue: { last: null, curr: 0, best: 0 },
                                                        in: {
                                                            $let: {
                                                                vars: {
                                                                    nextCurr: {
                                                                        $cond: [
                                                                            { $and: [ { $ne: ['$$value.last', null] }, { $eq: [ { $divide: [ { $subtract: ['$$this', '$$value.last'] }, 86400000 ] }, 1 ] } ] },
                                                                            { $add: ['$$value.curr', 1] },
                                                                            1
                                                                        ]
                                                                    }
                                                                },
                                                                in: {
                                                                    last: '$$this',
                                                                    curr: '$$nextCurr',
                                                                    best: { $cond: [ { $gt: ['$$nextCurr', '$$value.best'] }, '$$nextCurr', '$$value.best' ] }
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            },
                                            in: '$$res.best'
                                        }
                                    }
                                }
                            }
                        } },
                        { $project: {
                            bucket: {
                                $switch: {
                                    branches: [
                                        { case: { $eq: ['$longest', 1] }, then: '1' },
                                        { case: { $and: [ { $gte: ['$longest', 2] }, { $lte: ['$longest', 3] } ] }, then: '2-3' },
                                        { case: { $and: [ { $gte: ['$longest', 4] }, { $lte: ['$longest', 7] } ] }, then: '4-7' },
                                        { case: { $and: [ { $gte: ['$longest', 8] }, { $lte: ['$longest', 15] } ] }, then: '8-15' },
                                    ],
                                    default: '16+',
                                }
                            }
                        } },
                        { $group: { _id: '$bucket', count: { $sum: 1 } } },
                    ],
                }
            }
        ]));

        const aFacet = analyticsAgg?.[0] || {};
        const entriesPerDay = (aFacet.entriesPerDay || []).map(x => ({ day: x._id, count: x.count }));
        const entriesPerHour = (aFacet.entriesPerHour || []).map(x => ({ hour: x._id, count: x.count }));
        const dauPerDay = (aFacet.dauPerDay || []).map(x => ({ day: x._id, count: x.count }));
        const dauPerHour = (aFacet.dauPerHour || []).map(x => ({ hour: x._id, count: x.count }));
        const wauByWeek = (aFacet.wauByWeek || []).map(x => ({ week: x._id, count: x.count }));
        const mauByMonth = (aFacet.mauByMonth || []).map(x => ({ month: x._id, count: x.count }));
        const retentionBucketsRaw = Object.fromEntries((aFacet.retention || []).map(x => [x._id, x.count]));
        const streakBucketsRaw = Object.fromEntries((aFacet.streaks || []).map(x => [x._id, x.count]));
        // Build default retention buckets for discrete days 1..19 and '20+'
        const retentionDefault = (() => {
            const obj = {};
            for (let i = 1; i <= 19; i++) obj[String(i)] = 0;
            obj['20+'] = 0;
            return obj;
        })();
        const retentionBuckets = { ...retentionDefault, ...retentionBucketsRaw };
        const streakBuckets = { '1': 0, '2-3': 0, '4-7': 0, '8-15': 0, '16+': 0, ...streakBucketsRaw };

        // Cohort: new vs returning by month for months within [rangeStart, rangeEnd]
        // Compute users' first month (respecting lockId filter but across all time), and distinct users per month in the selected range.
        const cohortAgg = await timed(log, 'agg_cohorts', () => Entry.aggregate([
            {
                $facet: {
                    firstMonthPerUser: [
                        { $match: { lockId: PRIMARY_LOCK } },
                        { $project: { u: '$username', m: { $dateToString: { format: '%Y-%m', date: '$entryTime', timezone: timeZone } } } },
                        { $sort: { m: 1 } },
                        { $group: { _id: '$u', first: { $first: '$m' } } },
                    ],
                    monthlyDistinctInRange: [
                        { $match: { entryTime: { $gte: rangeStart, $lte: rangeEnd }, lockId: PRIMARY_LOCK } },
                        { $project: { u: '$username', m: { $dateToString: { format: '%Y-%m', date: '$entryTime', timezone: timeZone } } } },
                        { $group: { _id: { u: '$u', m: '$m' } } },
                        { $group: { _id: '$_id.m', users: { $addToSet: '$_id.u' }, count: { $sum: 1 } } },
                        { $sort: { _id: 1 } },
                    ],
                }
            }
        ]));

        const cFacet = cohortAgg?.[0] || {};
        const firstMonthMap = new Map((cFacet.firstMonthPerUser || []).map(x => [x._id, x.first]));
        const cohortByMonth = (cFacet.monthlyDistinctInRange || []).map((m) => {
            const users = m.users || [];
            let newCount = 0;
            for (const u of users) {
                if (firstMonthMap.get(u) === m._id) newCount += 1;
            }
            const total = users.length;
            return { month: m._id, new: newCount, returning: Math.max(0, total - newCount) };
        });

        // Global leaderboards (lifetime, all entries, user-centric only)
        const globalLbAgg = await timed(log, 'agg_global_leaderboards', () => Entry.aggregate([
            {
                $facet: {
                    // Distinct active days across all time per user
                    topUsers: [
                        { $match: { lockId: PRIMARY_LOCK } },
                        { $project: { username: 1, day: { $dateToString: { format: '%Y-%m-%d', date: '$entryTime', timezone: timeZone } } } },
                        { $group: { _id: { u: '$username', d: '$day' } } },
                        { $group: { _id: '$_id.u', count: { $sum: 1 } } },
                        { $sort: { count: -1, _id: 1 } },
                        { $limit: 5 },
                    ],
                    // Days where FIRST entry was before 08:00
                    topEarlyBirds: [
                        { $match: { lockId: PRIMARY_LOCK } },
                        { $addFields: { day: { $dateToString: { format: '%Y-%m-%d', date: '$entryTime', timezone: timeZone } } } },
                        { $sort: { entryTime: 1, _id: 1 } },
                        { $group: { _id: { u: '$username', d: '$day' }, firstTime: { $first: '$entryTime' } } },
                        { $project: { u: '$_id.u', hour: { $hour: { date: '$firstTime', timezone: timeZone } } } },
                        { $match: { hour: { $lt: 8 } } },
                        { $group: { _id: '$u', count: { $sum: 1 } } },
                        { $sort: { count: -1, _id: 1 } },
                        { $limit: 5 },
                    ],
                    // Days where FIRST entry AFTER 22:00 exists
                    topNightOwls: [
                        { $match: { lockId: PRIMARY_LOCK } },
                        { $addFields: { 
                            day: { $dateToString: { format: '%Y-%m-%d', date: '$entryTime', timezone: timeZone } },
                            hour: { $hour: { date: '$entryTime', timezone: timeZone } }
                        } },
                        { $match: { hour: { $gte: 22 } } },
                        { $sort: { entryTime: 1, _id: 1 } },
                        { $group: { _id: { u: '$username', d: '$day' }, firstAfter22: { $first: '$entryTime' } } },
                        { $group: { _id: '$_id.u', count: { $sum: 1 } } },
                        { $sort: { count: -1, _id: 1 } },
                        { $limit: 5 },
                    ],
                    // Longest consecutive active day streak across lifetime
                    topLongestStreaks: [
                        { $match: { lockId: PRIMARY_LOCK } },
                        { $addFields: { day: { $dateTrunc: { date: '$entryTime', unit: 'day', timezone: timeZone } } } },
                        { $group: { _id: { u: '$username', d: '$day' } } },
                        { $sort: { '_id.u': 1, '_id.d': 1 } },
                        { $group: { _id: '$_id.u', days: { $push: '$_id.d' } } },
                        { $project: {
                            count: {
                                $let: {
                                    vars: { arr: '$days' },
                                    in: {
                                        $let: {
                                            vars: {
                                                res: {
                                                    $reduce: {
                                                        input: '$$arr',
                                                        initialValue: { last: null, curr: 0, best: 0 },
                                                        in: {
                                                            $let: {
                                                                vars: {
                                                                    isConsecutive: {
                                                                        $cond: [
                                                                            { $and: [
                                                                                { $ne: ['$$value.last', null] },
                                                                                { $eq: [ { $divide: [ { $subtract: ['$$this', '$$value.last'] }, 86400000 ] }, 1 ] }
                                                                            ] },
                                                                            true,
                                                                            false
                                                                        ]
                                                                    },
                                                                    nextCurr: {
                                                                        $cond: [
                                                                            { $and: [
                                                                                { $ne: ['$$value.last', null] },
                                                                                { $eq: [ { $divide: [ { $subtract: ['$$this', '$$value.last'] }, 86400000 ] }, 1 ] }
                                                                            ] },
                                                                            { $add: ['$$value.curr', 1] },
                                                                            1
                                                                        ]
                                                                    }
                                                                },
                                                                in: {
                                                                    last: '$$this',
                                                                    curr: '$$nextCurr',
                                                                    best: { $cond: [ { $gt: ['$$nextCurr', '$$value.best'] }, '$$nextCurr', '$$value.best' ] }
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            },
                                            in: '$$res.best'
                                        }
                                    }
                                }
                            }
                        } },
                        { $sort: { count: -1, _id: 1 } },
                        { $limit: 5 }
                    ],
                }
            }
        ]));
        const glbFacet = globalLbAgg?.[0] || {};
        const globalLeaderboards = {
            topUsers: (glbFacet.topUsers || []).map(x => ({ id: x._id, count: x.count })),
            topEarlyBirds: (glbFacet.topEarlyBirds || []).map(x => ({ id: x._id, count: x.count })),
            topNightOwls: (glbFacet.topNightOwls || []).map(x => ({ id: x._id, count: x.count })),
            topLongestStreaks: (glbFacet.topLongestStreaks || []).map(x => ({ id: x._id, count: x.count })),
        };

        // ----- Optional: Lifetime user profile when userId is provided -----
        let userProfile = null;
        if (userId) {
            // Case-insensitive exact username regex
            const escaped = userId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const usernameRegex = new RegExp(`^${escaped}$`, 'i');

            // A canonical display username from any matching doc
            const sampleUserDoc = await timed(log, 'find_sample_user', () => Entry.findOne({ username: { $regex: usernameRegex } }, { username: 1 })
                .sort({ _id: 1 })
                .lean());

            const now = new Date();
            const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

            const lifetimeAgg = await timed(log, 'agg_user_profile', () => Entry.aggregate([
                { $match: { username: { $regex: usernameRegex } } },
                {
                    $facet: {
                        // General stats (first/last seen, locks, early/night flags)
                        stats: [
                            {
                                $group: {
                                    _id: null,
                                    first: { $min: '$entryTime' },
                                    last: { $max: '$entryTime' },
                                    locks: { $addToSet: '$lockId' },
                                    early: {
                                        $sum: {
                                            $cond: [{ $lt: [{ $hour: '$entryTime' }, 8] }, 1, 0],
                                        },
                                    },
                                    night: {
                                        $sum: {
                                            $cond: [{ $gte: [{ $hour: '$entryTime' }, 22] }, 1, 0],
                                        },
                                    },
                                },
                            },
                            {
                                $project: {
                                    _id: 0,
                                    first: 1,
                                    last: 1,
                                    uniqueLocks: { $size: '$locks' },
                                    early: 1,
                                    night: 1,
                                },
                            },
                        ],
                        // Visits (all time) based on distinct days with PRIMARY_LOCK activity
                        visitsDaysPrimary: [
                            { $match: { lockId: PRIMARY_LOCK } },
                            { $project: { d: { $dateTrunc: { date: '$entryTime', unit: 'day', timezone: timeZone } } } },
                            { $group: { _id: '$d' } },
                            { $count: 'count' },
                        ],
                        // Recent 30 days visits (for Active This Month) based on PRIMARY_LOCK distinct days
                        recent30DaysPrimary: [
                            { $match: { lockId: PRIMARY_LOCK, entryTime: { $gte: thirtyDaysAgo } } },
                            { $project: { d: { $dateTrunc: { date: '$entryTime', unit: 'day', timezone: timeZone } } } },
                            { $group: { _id: '$d' } },
                            { $count: 'count' },
                        ],
                        // Lifetime longest streak in days for this user (PRIMARY_LOCK only, to match leaderboards)
                        longestStreak: [
                            { $match: { lockId: PRIMARY_LOCK } },
                            { $addFields: { day: { $dateTrunc: { date: '$entryTime', unit: 'day', timezone: timeZone } } } },
                            { $group: { _id: '$day' } },
                            { $sort: { _id: 1 } },
                            { $group: { _id: null, days: { $push: '$_id' } } },
                            { $project: {
                                _id: 0,
                                count: {
                                    $let: {
                                        vars: { arr: '$days' },
                                        in: {
                                            $let: {
                                                vars: {
                                                    res: {
                                                        $reduce: {
                                                            input: '$$arr',
                                                            initialValue: { last: null, curr: 0, best: 0 },
                                                            in: {
                                                                $let: {
                                                                    vars: {
                                                                        nextCurr: {
                                                                            $cond: [
                                                                                { $and: [ { $ne: ['$$value.last', null] }, { $eq: [ { $divide: [ { $subtract: ['$$this', '$$value.last'] }, 86400000 ] }, 1 ] } ] },
                                                                                { $add: ['$$value.curr', 1] },
                                                                                1
                                                                            ]
                                                                        }
                                                                    },
                                                                    in: {
                                                                        last: '$$this',
                                                                        curr: '$$nextCurr',
                                                                        best: { $cond: [ { $gt: ['$$nextCurr', '$$value.best'] }, '$$nextCurr', '$$value.best' ] }
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    }
                                                },
                                                in: '$$res.best'
                                            }
                                        }
                                    }
                                }
                            } }
                        ],
                    },
                },
            ]));

            const lf = lifetimeAgg?.[0] || {};
            const stats = lf.stats?.[0] || null;
            const visitsAllTime = lf.visitsDaysPrimary?.[0]?.count || 0;
            const recent30 = lf.recent30DaysPrimary?.[0]?.count || 0;
            const lifetimeStreak = lf.longestStreak?.[0]?.count || 0;

            if (stats) {
                const total = visitsAllTime; // redefine: visits = distinct PRIMARY_LOCK days
                const uniqueLocks = stats.uniqueLocks || 0;
                const first = stats.first || null;
                const last = stats.last || null;
                const early = (stats.early || 0) > 0;
                const night = (stats.night || 0) > 0;
                const activeThisMonth = recent30 >= 5;

                const achievements = [];
                if (total >= 10) achievements.push({ key: 'milestone_10', title: 'Visitor I', description: '10+ visits (distinct days on primary lock)' });
                if (total >= 50) achievements.push({ key: 'milestone_50', title: 'Visitor II', description: '50+ visits (distinct days on primary lock)' });
                if (total >= 100) achievements.push({ key: 'milestone_100', title: 'Visitor III', description: '100+ visits (distinct days on primary lock)' });
                if (early) achievements.push({ key: 'early_bird', title: 'Early Bird', description: 'Visited before 08:00' });
                if (night) achievements.push({ key: 'night_owl', title: 'Night Owl', description: 'Visited at or after 22:00' });
                if (activeThisMonth) achievements.push({ key: 'active_month', title: 'Active This Month', description: '5+ visits in the last 30 days' });

                userProfile = {
                    username: sampleUserDoc?.username || userId,
                    totalEntriesAllTime: total,
                    uniqueLocks,
                    firstSeen: first,
                    lastSeen: last,
                    longestStreakDays: lifetimeStreak,
                    achievements,
                };
            } else {
                userProfile = null;
            }
        }

        // ----- Season progression (per-user in active season) -----
        let userSeasonProgress = null;
        if (seasonActive) {
            // Standings: distinct active days per user within the season window
            const standingsAgg = await timed(log, 'agg_season_standings', () => Entry.aggregate([
                { $match: { entryTime: { $gte: rangeStart, $lte: rangeEnd }, lockId: PRIMARY_LOCK } },
                { $project: { username: 1, day: { $dateToString: { format: '%Y-%m-%d', date: '$entryTime', timezone: timeZone } } } },
                { $group: { _id: { u: '$username', d: '$day' } } },
                { $group: { _id: '$_id.u', count: { $sum: 1 } } },
                { $sort: { count: -1, _id: 1 } },
            ]));

            const standings = standingsAgg.map((x) => ({ user: x._id, points: x.count }));

            if (userId) {
                // Find canonical username casing
                const target = standings.find(s => s.user.toLowerCase() === userId.toLowerCase());
                const points = target?.points || 0;
                const rank = target ? (standings.findIndex(s => s.user === target.user) + 1) : null;

                // Current and longest streak for this user within season
                const streakAgg = await timed(log, 'agg_season_streak_user', () => Entry.aggregate([
                    { $match: { entryTime: { $gte: rangeStart, $lte: rangeEnd }, lockId: PRIMARY_LOCK, username: { $regex: new RegExp(`^${userId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } } },
                    { $addFields: { day: { $dateTrunc: { date: '$entryTime', unit: 'day', timezone: timeZone } } } },
                    { $group: { _id: '$day' } },
                    { $sort: { _id: 1 } },
                    { $group: { _id: null, days: { $push: '$_id' } } },
                    { $project: {
                        _id: 0,
                        longest: {
                            $let: {
                                vars: { arr: '$days' },
                                in: {
                                    $let: {
                                        vars: {
                                            res: {
                                                $reduce: {
                                                    input: '$$arr',
                                                    initialValue: { last: null, curr: 0, best: 0 },
                                                    in: {
                                                        $let: {
                                                            vars: {
                                                                nextCurr: {
                                                                    $cond: [
                                                                        { $and: [ { $ne: ['$$value.last', null] }, { $eq: [ { $divide: [ { $subtract: ['$$this', '$$value.last'] }, 86400000 ] }, 1 ] } ] },
                                                                        { $add: ['$$value.curr', 1] },
                                                                        1
                                                                    ]
                                                                }
                                                            },
                                                            in: {
                                                                last: '$$this',
                                                                curr: '$$nextCurr',
                                                                best: { $cond: [ { $gt: ['$$nextCurr', '$$value.best'] }, '$$nextCurr', '$$value.best' ] }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        },
                                        in: '$$res'
                                    }
                                }
                            }
                        }
                    } }
                ]));

                const streakObj = streakAgg?.[0]?.longest || { curr: 0, best: 0 };
                const longestStreakDaysSeason = streakObj.best || 0;
                const currentStreakDaysSeason = streakObj.curr || 0; // approximate current run length

                // Simple level thresholds based on points (distinct active days)
                const levels = [
                    { level: 1, at: 1 },
                    { level: 2, at: 5 },
                    { level: 3, at: 10 },
                    { level: 4, at: 20 },
                    { level: 5, at: 30 },
                ];
                let currentLevel = 0;
                let nextAt = null;
                for (const l of levels) {
                    if (points >= l.at) currentLevel = l.level; else { nextAt = l.at; break; }
                }
                if (!nextAt) nextAt = null;

                userSeasonProgress = {
                    season: { key: activeSeason.key, name: activeSeason.name, startAt: activeSeason.startAt, endAt: activeSeason.endAt },
                    points,
                    rank,
                    currentStreakDays: currentStreakDaysSeason,
                    longestStreakDays: longestStreakDaysSeason,
                    level: currentLevel,
                    nextLevelAt: nextAt,
                };
            }
        }

        // Response only relies on Entry collection
        const resp = NextResponse.json({
            entries,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
            filters: {
                availableLockIds,
                entryCounts,
                date: rangeStart,
                previousDateCounts,
                nextDateCounts,
                period,
                seasons: SEASONS,
                season: activeSeason ? activeSeason.key : '',
            },
            dayAggregates: {
                totalEntries: total,
                uniqueUsers,
                mostActiveUser,
                mostUsedLock,
                busiestHour,
                firstEntryTime,
                lastEntryTime,
            },
            leaderboards,
            globalLeaderboards,
            userProfile,
            userSeasonProgress,
            analytics: {
                entriesPerDay,
                entriesPerHour,
                dauPerDay,
                dauPerHour,
                wauByWeek,
                mauByMonth,
                retentionBuckets,
                streakBuckets,
                cohortByMonth,
            },
        });
        resp.headers.set('X-Request-ID', reqId);
        log.info('request_end', { total, page, limit });
        return resp;
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Error fetching entries:', error);
        const resp = NextResponse.json(
            { error: 'Failed to fetch entries', details: String(error?.message ?? error) },
            { status: 500 }
        );
        resp.headers.set('X-Request-ID', reqId);
        return resp;
    }
}
