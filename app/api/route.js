// app/api/route.js
import mongoose from 'mongoose';
import { NextResponse } from 'next/server';
import { startOfDay, endOfDay, startOfMonth, endOfMonth } from 'date-fns';
import { connectToDatabase } from '@/lib/mongodb';

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
    try {
        await connectToDatabase();

        const { searchParams } = new URL(request.url);
        const page  = parseInt(searchParams.get('page')  || '1', 10);
        const limit = parseInt(searchParams.get('limit') || '50', 10);
        const lockId = searchParams.get('lockId') || '';
        const userId = (searchParams.get('userId') || '').trim(); // used as username filter
        const dateParam = searchParams.get('date');
        const period = (searchParams.get('period') || 'day').toLowerCase() === 'month' ? 'month' : 'day';
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

        // Determine time window based on period
        const rangeStart = period === 'month' ? startOfMonth(date) : startOfDay(date);
        const rangeEnd   = period === 'month' ? endOfMonth(date)   : endOfDay(date);

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
        const entries = await Entry.find(query)
            // Ensure deterministic ordering even when entryTime values are equal
            .sort({ entryTime: -1, _id: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean();

        // Total for pagination
        const total = await Entry.countDocuments(query);

        // Distinct lock IDs (for filters)
        const availableLockIds = await Entry.distinct('lockId');

        // Counts by lockId for the selected day (aggregate on Entry only)
        const countsAgg = await Entry.aggregate([
            { $match: { entryTime: { $gte: rangeStart, $lte: rangeEnd } } },
            { $group: { _id: '$lockId', count: { $sum: 1 } } },
        ]);
        const entryCounts = Object.fromEntries(countsAgg.map(d => [d._id, d.count]));

        // Previous date with entries
        const previousDateEntry = await Entry.findOne(
            { entryTime: { $lt: rangeStart } },
            { entryTime: 1 }
        )
            // Tie-break by _id for stable selection
            .sort({ entryTime: -1, _id: -1 });

        let previousDateCounts = null;
        if (previousDateEntry?.entryTime) {
            const prevStart = period === 'month' ? startOfMonth(previousDateEntry.entryTime) : startOfDay(previousDateEntry.entryTime);
            const prevEnd   = period === 'month' ? endOfMonth(previousDateEntry.entryTime)   : endOfDay(previousDateEntry.entryTime);
            const prevTotal = await Entry.countDocuments({ entryTime: { $gte: prevStart, $lte: prevEnd } });
            previousDateCounts = { date: prevStart, count: prevTotal };
        }

        // Next date with entries
        const nextDateEntry = await Entry.findOne(
            { entryTime: { $gt: rangeEnd } },
            { entryTime: 1 }
        )
            // Tie-break by _id for stable selection
            .sort({ entryTime: 1, _id: 1 });

        let nextDateCounts = null;
        if (nextDateEntry?.entryTime) {
            const nextStart = period === 'month' ? startOfMonth(nextDateEntry.entryTime) : startOfDay(nextDateEntry.entryTime);
            const nextEnd   = period === 'month' ? endOfMonth(nextDateEntry.entryTime)   : endOfDay(nextDateEntry.entryTime);
            const nextTotal = await Entry.countDocuments({ entryTime: { $gte: nextStart, $lte: nextEnd } });
            nextDateCounts = { date: nextStart, count: nextTotal };
        }

        // Day/Month-level aggregates across ALL pages (for the selected range and filters)
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
                    // locks/hour are not part of month achievements; still compute for day for compatibility
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

        const aggResult = await Entry.aggregate(aggPipelines);
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
        const leaderboardAgg = await Entry.aggregate([
            { $match: { entryTime: { $gte: rangeStart, $lte: rangeEnd }, ...(lockId ? { lockId } : {}) } },
            {
                $facet: (
                    period === 'month'
                        ? {
                            // Users ranked by number of distinct active days during the month
                            topUsers: [
                                { $project: { username: 1, day: { $dateToString: { format: '%Y-%m-%d', date: '$entryTime', timezone: timeZone } } } },
                                { $group: { _id: { u: '$username', d: '$day' } } },
                                { $group: { _id: '$_id.u', count: { $sum: 1 } } },
                                { $sort: { count: -1, _id: 1 } },
                                { $limit: 5 },
                            ],
                            // Early birds by number of days where the FIRST entry was before 08:00
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
                            // Night owls by number of days where the FIRST entry AFTER 22:00 exists for the user
                            // Implementation: restrict to entries with hour >= 22, then pick the earliest (first) such entry per user-day,
                            // then count days per user.
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
                            // Longest streak in days per user within the month (consecutive active days)
                            topLongestStreaks: [
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
        ]);
        const lbFacet = leaderboardAgg?.[0] || {};
        const leaderboards = {
            topUsers: (lbFacet.topUsers || []).map(x => ({ id: x._id, count: x.count })),
            topLocks: period === 'month' ? [] : (lbFacet.topLocks || []).map(x => ({ id: x._id, count: x.count })),
            topEarlyBirds: (lbFacet.topEarlyBirds || []).map(x => ({ id: x._id, count: x.count })),
            topNightOwls: (lbFacet.topNightOwls || []).map(x => ({ id: x._id, count: x.count })),
            topLongestStreaks: (lbFacet.topLongestStreaks || []).map(x => ({ id: x._id, count: x.count })),
        };

        // Global leaderboards (lifetime, all entries, user-centric only)
        const globalLbAgg = await Entry.aggregate([
            {
                $facet: {
                    // Distinct active days across all time per user
                    topUsers: [
                        { $project: { username: 1, day: { $dateToString: { format: '%Y-%m-%d', date: '$entryTime', timezone: timeZone } } } },
                        { $group: { _id: { u: '$username', d: '$day' } } },
                        { $group: { _id: '$_id.u', count: { $sum: 1 } } },
                        { $sort: { count: -1, _id: 1 } },
                        { $limit: 5 },
                    ],
                    // Days where FIRST entry was before 08:00
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
                    // Days where FIRST entry AFTER 22:00 exists
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
                    // Longest consecutive active day streak across lifetime
                    topLongestStreaks: [
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
        ]);
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
            const sampleUserDoc = await Entry.findOne({ username: { $regex: usernameRegex } }, { username: 1 })
                .sort({ _id: 1 })
                .lean();

            const now = new Date();
            const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

            const lifetimeAgg = await Entry.aggregate([
                { $match: { username: { $regex: usernameRegex } } },
                {
                    $facet: {
                        stats: [
                            {
                                $group: {
                                    _id: null,
                                    total: { $sum: 1 },
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
                                    total: 1,
                                    first: 1,
                                    last: 1,
                                    uniqueLocks: { $size: '$locks' },
                                    early: 1,
                                    night: 1,
                                },
                            },
                        ],
                        recent30: [
                            { $match: { entryTime: { $gte: thirtyDaysAgo } } },
                            { $count: 'count' },
                        ],
                        // Lifetime longest streak in days for this user
                        longestStreak: [
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
                            } }
                        ],
                    },
                },
            ]);

            const lf = lifetimeAgg?.[0] || {};
            const stats = lf.stats?.[0] || null;
            const recent30 = lf.recent30?.[0]?.count || 0;
            const lifetimeStreak = lf.longestStreak?.[0]?.count || 0;

            if (stats) {
                const total = stats.total || 0;
                const uniqueLocks = stats.uniqueLocks || 0;
                const first = stats.first || null;
                const last = stats.last || null;
                const early = (stats.early || 0) > 0;
                const night = (stats.night || 0) > 0;
                const activeThisMonth = recent30 >= 5;

                const achievements = [];
                if (total >= 10) achievements.push({ key: 'milestone_10', title: 'Visitor I', description: '10+ visits' });
                if (total >= 50) achievements.push({ key: 'milestone_50', title: 'Visitor II', description: '50+ visits' });
                if (total >= 100) achievements.push({ key: 'milestone_100', title: 'Visitor III', description: '100+ visits' });
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

        // Response only relies on Entry collection
        return NextResponse.json({
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
        });
    } catch (error) {
        console.error('Error fetching entries:', error);
        return NextResponse.json(
            { error: 'Failed to fetch entries', details: String(error?.message ?? error) },
            { status: 500 }
        );
    }
}
