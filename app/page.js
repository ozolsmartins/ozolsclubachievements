// app/page.js
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

function buildQuery(params) {
  const clean = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  );
  return new URLSearchParams(clean).toString();
}

export default async function Page({ searchParams }) {
  const page   = searchParams?.page ?? '1';
  const date   = searchParams?.date ?? '';
  const lockId = searchParams?.lockId ?? '';
  const limit  = searchParams?.limit ?? '50';

  const qs = buildQuery({ page, date, lockId, limit });

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

  const { entries = [], pagination = {}, filters = {} } = data;
  const totalPages = pagination.totalPages ?? 1;
  const dayISO = filters?.date ? new Date(filters.date).toISOString().slice(0, 10) : '';

  const linkWith = (patch) => {
    const next = { page, date, lockId, limit, ...patch };
    return `/?${buildQuery(next)}`;
  };

  return (
      <main className="p-6 space-y-6">
        <h1 className="text-2xl font-semibold">Entries</h1>

        {/* Filters */}
        <form action="/" method="get" className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-sm">Date</label>
            <input
                type="date"
                name="date"
                defaultValue={dayISO || date}
                className="border rounded px-3 py-1"
            />
          </div>
          <div>
            <label className="block text-sm">Lock ID</label>
            <select name="lockId" defaultValue={lockId} className="border rounded px-3 py-1">
              <option value="">All</option>
              {(filters?.availableLockIds ?? []).map((id) => (
                  <option key={id} value={id}>{id}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm">Per page</label>
            <select name="limit" defaultValue={limit} className="border rounded px-3 py-1">
              {[25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <button type="submit" className="px-4 py-2 rounded bg-black text-white">
            Apply
          </button>
        </form>

        {/* Quick date jump */}
        <div className="flex gap-3">
          {filters?.previousDateCounts && (
              <a
                  className="underline"
                  href={linkWith({
                    date: new Date(filters.previousDateCounts.date).toISOString().slice(0, 10),
                    page: '1'
                  })}
              >
                ← {new Date(filters.previousDateCounts.date).toLocaleDateString()} ({filters.previousDateCounts.count})
              </a>
          )}
          {filters?.nextDateCounts && (
              <a
                  className="underline"
                  href={linkWith({
                    date: new Date(filters.nextDateCounts.date).toISOString().slice(0, 10),
                    page: '1'
                  })}
              >
                {new Date(filters.nextDateCounts.date).toLocaleDateString()} ({filters.nextDateCounts.count}) →
              </a>
          )}
        </div>

        {/* Summary */}
        <div className="text-sm text-gray-600">
          Showing page <strong>{pagination?.page}</strong> of <strong>{totalPages}</strong>, total{' '}
          <strong>{pagination?.total}</strong> entries for{' '}
          <strong>{dayISO ? new Date(dayISO).toLocaleDateString() : (date || 'today')}</strong>.
        </div>

        {/* Table */}
        <div className="overflow-auto border rounded">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-2">Time</th>
              <th className="text-left p-2">User</th>
              <th className="text-left p-2">Full name</th>
              <th className="text-left p-2">Lock</th>
              <th className="text-left p-2">MAC</th>
              <th className="text-left p-2">Type</th>
              <th className="text-left p-2">Battery</th>
            </tr>
            </thead>
            <tbody>
            {entries.length === 0 && (
                <tr>
                  <td className="p-3" colSpan={7}>No entries found.</td>
                </tr>
            )}
            {entries.map((e) => (
                <tr key={e._id} className="border-t">
                  <td className="p-2">{e.entryTime ? new Date(e.entryTime).toLocaleTimeString() : ''}</td>
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

        {/* Per-lock counts */}
        {filters?.entryCounts && (
            <div className="text-sm text-gray-700">
              <h2 className="font-medium mb-1">Entries by lock (selected day)</h2>
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
