// app/api/route.js
import mongoose from 'mongoose';
import { NextResponse } from 'next/server';
import { startOfDay, endOfDay } from 'date-fns';
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
        const dateParam = searchParams.get('date');
        const date = dateParam ? new Date(dateParam) : new Date();

        const dayStart = startOfDay(date);
        const dayEnd   = endOfDay(date);

        // Build query
        const query = {
            entryTime: { $gte: dayStart, $lte: dayEnd },
            ...(lockId ? { lockId } : {}),
        };

        // Fetch paginated entries
        const entries = await Entry.find(query)
            .sort({ entryTime: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean();

        // Total for pagination
        const total = await Entry.countDocuments(query);

        // Distinct lock IDs (for filters)
        const availableLockIds = await Entry.distinct('lockId');

        // Counts by lockId for the selected day (aggregate on Entry only)
        const countsAgg = await Entry.aggregate([
            { $match: { entryTime: { $gte: dayStart, $lte: dayEnd } } },
            { $group: { _id: '$lockId', count: { $sum: 1 } } },
        ]);
        const entryCounts = Object.fromEntries(countsAgg.map(d => [d._id, d.count]));

        // Previous date with entries
        const previousDateEntry = await Entry.findOne(
            { entryTime: { $lt: dayStart } },
            { entryTime: 1 }
        ).sort({ entryTime: -1 });

        let previousDateCounts = null;
        if (previousDateEntry?.entryTime) {
            const prevStart = startOfDay(previousDateEntry.entryTime);
            const prevEnd   = endOfDay(previousDateEntry.entryTime);
            const prevTotal = await Entry.countDocuments({ entryTime: { $gte: prevStart, $lte: prevEnd } });
            previousDateCounts = { date: prevStart, count: prevTotal };
        }

        // Next date with entries
        const nextDateEntry = await Entry.findOne(
            { entryTime: { $gt: dayEnd } },
            { entryTime: 1 }
        ).sort({ entryTime: 1 });

        let nextDateCounts = null;
        if (nextDateEntry?.entryTime) {
            const nextStart = startOfDay(nextDateEntry.entryTime);
            const nextEnd   = endOfDay(nextDateEntry.entryTime);
            const nextTotal = await Entry.countDocuments({ entryTime: { $gte: nextStart, $lte: nextEnd } });
            nextDateCounts = { date: nextStart, count: nextTotal };
        }

        // ✅ Response only relies on Entry collection
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
                date: dayStart,
                previousDateCounts,
                nextDateCounts,
            },
        });
    } catch (error) {
        console.error('Error fetching entries:', error);
        return NextResponse.json(
            { error: 'Failed to fetch entries', details: String(error?.message ?? error) },
            { status: 500 }
        );
    }
}
