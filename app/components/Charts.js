'use client';

import { useMemo, useRef } from 'react';
import { t as tRaw } from '@/lib/i18n';

// Helpers
function toCSV(rows, headers) {
  const head = headers.map(h => '"' + h + '"').join(',');
  const body = rows.map(r => headers.map(h => '"' + String(r[h] ?? '') + '"').join(',')).join('\n');
  return head + '\n' + body + '\n';
}

function download(filename, dataUrl) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function svgToPng(svgOrContainer, filename, opts = {}) {
  // Accept either an <svg> element or a container that holds one
  if (!svgOrContainer) return;
  let svgEl = svgOrContainer;
  if (!(svgEl instanceof SVGSVGElement)) {
    svgEl = svgOrContainer.querySelector?.('svg') || null;
  }
  if (!svgEl) {
    throw new Error('PNG export failed: No SVG element found to export.');
  }

  // Ensure xmlns attributes exist so the serialized SVG is valid
  if (!svgEl.getAttribute('xmlns')) svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  if (!svgEl.getAttribute('xmlns:xlink')) svgEl.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(svgEl);
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const img = new Image();

  // Prefer viewBox, then client sizes as a fallback
  const vb = svgEl.viewBox?.baseVal;
  const width = (vb && vb.width) || svgEl.clientWidth || Number(svgEl.getAttribute('width')) || 600;
  const height = (vb && vb.height) || svgEl.clientHeight || Number(svgEl.getAttribute('height')) || 200;

  await new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = (e) => reject(new Error('PNG export failed: Could not load SVG into image.'));
    img.src = url;
  });

  // Compute export size: at least Full HD by default, preserving aspect ratio
  const minW = Number(opts.minWidth || 1920);
  const minH = Number(opts.minHeight || 1080);
  const scale = Math.max(minW / width, minH / height, 1);
  const targetW = Math.round(width * scale);
  const targetH = Math.round(height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  // Improve quality for any intermediate raster operations
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // Solid background to match on-screen charts
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, targetW, targetH);
  // When drawing an SVG image, browsers rasterize at the destination size – crisp output at higher res
  ctx.drawImage(img, 0, 0, targetW, targetH);
  URL.revokeObjectURL(url);
  const dataUrl = canvas.toDataURL('image/png');
  download(filename, dataUrl);
}

function useMinMax(series) {
  return useMemo(() => {
    let min = Infinity, max = -Infinity;
    for (const v of series) {
      if (typeof v !== 'number' || !isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!isFinite(min)) min = 0;
    if (!isFinite(max)) max = 1;
    if (min === max) { max = min + 1; }
    return [min, max];
  }, [series]);
}

function BarChart({ data, xKey, yKey, width = 420, height = 140, color = '#0ea5e9', yUnit = '' }) {
  const padding = 22;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;
  const values = data.map(d => Number(d[yKey] || 0));
  const [min, max] = useMinMax(values);
  const barW = data.length ? innerW / data.length : innerW;
  const rects = data.map((d, i) => {
    const v = Number(d[yKey] || 0);
    const h = max === min ? 0 : ((v - min) / (max - min)) * innerH;
    const x = padding + i * barW;
    const y = padding + (innerH - h);
    return <rect key={i} x={x} y={y} width={Math.max(1, barW - 2)} height={h} fill={color} />;
  });
  // simple Y axis and X labels sparse
  const xLabels = data.map((d, i) => (i % Math.ceil(data.length / 6) === 0 ? String(d[xKey]) : ''));
  const ticks = [0, Math.round(max/2), max];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="auto" role="img" aria-label="bar chart">
      <rect x="0" y="0" width={width} height={height} fill="#ffffff" />
      {/* Y-axis */}
      <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#9ca3af" strokeWidth="1" />
      {ticks.map((tv, i) => {
        const ty = padding + (innerH - (tv/(max||1))*innerH);
        return <text key={i} x={2} y={ty+3} fontSize="9" fill="#6b7280">{tv}</text>;
      })}
      {yUnit ? <text x={padding + 4} y={padding - 6} fontSize="9" fill="#374151">{yUnit}</text> : null}
      <g>{rects}</g>
      <g fill="#6b7280" fontSize="9">
        {xLabels.map((txt, i) => txt ? (
          <text key={i} x={padding + i * (data.length ? innerW / data.length : innerW)} y={height - 6}>{txt}</text>
        ) : null)}
      </g>
    </svg>
  );
}

function LineChart({ series, width = 420, height = 140, t, yUnit = '' }) {
  // series: [{ label, data: [{ x, y }], color?: '#hex' }]
  // Hide legend/lines for empty series
  const palette = ['#0ea5e9', '#f59e0b', '#f43f5e']; // blue, orange, red
  const filtered = (series || []).filter(s => Array.isArray(s.data) && s.data.length > 0);
  const padding = 22;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;
  const flat = filtered.flatMap(s => s.data);
  const ys = flat.map(p => Number(p.y || 0));
  const [min, max] = useMinMax(ys);
  const xs = flat.map(p => p.x);
  const uniqueX = Array.from(new Set(xs));
  const xIndex = new Map(uniqueX.map((x, i) => [x, i]));
  const xStep = uniqueX.length ? innerW / (uniqueX.length - 1 || 1) : innerW;

  const lines = filtered.map((s, si) => {
    const path = s.data.map((p, i) => {
      const xi = xIndex.get(p.x) ?? i;
      const x = padding + xi * xStep;
      const y = padding + (innerH - ((Number(p.y || 0) - min) / (max - min || 1)) * innerH);
      return `${i === 0 ? 'M' : 'L'}${x},${y}`;
    }).join(' ');
    const color = s.color || palette[si % palette.length];
    return (
      <g key={si}>
        <path d={path} fill="none" stroke={color} strokeWidth="2" />
        {s.data.map((p, i) => {
          const xi = xIndex.get(p.x) ?? i;
          const cx = padding + xi * xStep;
          const cy = padding + (innerH - ((Number(p.y || 0) - min) / (max - min || 1)) * innerH);
          return <circle key={i} cx={cx} cy={cy} r={1.6} fill={color} />;
        })}
      </g>
    );
  });

  // simple x labels
  const xLabels = uniqueX.map((x, i) => (i % Math.ceil(uniqueX.length / 6) === 0 ? String(x) : ''));
  const ticks = [0, Math.round(max/2), max];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="auto" role="img" aria-label="line chart">
      <rect x="0" y="0" width={width} height={height} fill="#ffffff" />
      {/* Y-axis */}
      <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#9ca3af" strokeWidth="1" />
      {ticks.map((tv, i) => {
        const ty = padding + (innerH - (tv/(max||1))*innerH);
        return <text key={i} x={2} y={ty+3} fontSize="9" fill="#6b7280">{tv}</text>;
      })}
      {yUnit ? <text x={padding + 4} y={padding - 6} fontSize="9" fill="#374151">{yUnit}</text> : null}
      <g>{lines}</g>
      <g fill="#6b7280" fontSize="9">
        {xLabels.map((txt, i) => txt ? (
          <text key={i} x={padding + i * xStep} y={height - 6}>{txt}</text>
        ) : null)}
      </g>
      {/* legend for visible series only */}
      <g>
        {filtered.map((s, i) => {
          const color = s.color || palette[i % palette.length];
          const lblKey = (s.label || '').toLowerCase();
          return (
            <g key={i} transform={`translate(${width - padding - 90}, ${padding + i * 14})`}>
              <rect x="0" y="0" width="10" height="4" fill={color} />
              <text x="14" y="4" fontSize="9" fill="#374151">{t ? t(lblKey) : s.label}</text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function ChartBlock({ title, subtitle, note, rows, headers, renderSvg, t, fileKey }) {
  const svgRef = useRef(null);
  const onCSV = () => {
    const csv = toCSV(rows, headers);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    download(`${fileKey}.csv`, url);
    URL.revokeObjectURL(url);
  };
  const onPNG = async () => {
    try {
      await svgToPng(svgRef.current, `${fileKey}.png`);
    } catch (err) {
      // Avoid unhandled promise rejections and provide a helpful message
      console.error('[PNG Export] Error:', err);
      try {
        alert((err && err.message) ? err.message : 'PNG export failed.');
      } catch {}
    }
  };
  return (
    <div className="border rounded p-3 bg-white text-gray-900">
      <div className="flex items-center justify-between mb-2">
        <div className="font-medium text-sm">{title}</div>
        <div className="flex gap-2">
          <button type="button" className="px-2 py-1 text-xs border rounded" onClick={onCSV}>{t('export_csv')}</button>
          <button type="button" className="px-2 py-1 text-xs border rounded" onClick={onPNG}>{t('export_png')}</button>
        </div>
      </div>
      {subtitle ? <div className="text-[11px] text-gray-500 mb-1">{subtitle}</div> : null}
      {note ? <div className="text-[11px] text-gray-600 mb-2">{note}</div> : null}
      <div ref={svgRef}>
        {renderSvg()}
      </div>
    </div>
  );
}

export default function Charts({ analytics, lang = 'lv', meta }) {
  const t = (key, vars = {}) => tRaw(key, vars, lang);
  if (!analytics) return null;
  const entriesPerDay = analytics.entriesPerDay || [];
  const entriesPerHour = analytics.entriesPerHour || [];
  const dauPerDay = analytics.dauPerDay || [];
  const dauPerHour = analytics.dauPerHour || [];
  const retentionBuckets = analytics.retentionBuckets || {};
  const streakBuckets = analytics.streakBuckets || {};
  const cohortByMonth = analytics.cohortByMonth || [];

  const retentionKeys = Array.from({ length: 19 }, (_, i) => String(i + 1)).concat(['20+']);
  const retentionRows = retentionKeys.map(k => ({ bucket: k, count: retentionBuckets[k] || 0 }));
  const streakRows = ['1', '2-3', '4-7', '8-15', '16+'].map(k => ({ bucket: k, count: streakBuckets[k] || 0 }));

  const totalEntries = entriesPerDay.reduce((sum, d) => sum + Number(d.count || 0), 0);
  const daysCount = entriesPerDay.length;
  const contextParts = [];
  if (meta?.rangeLabel) contextParts.push(`${t('for')} ${meta.rangeLabel}`);
  if (meta?.lockId) contextParts.push(`${t('lock_id')}: ${meta.lockId}`);
  contextParts.push(`${daysCount} ${t('days')}`);
  contextParts.push(`${totalEntries} ${t('entries_word')}`);
  const commonSubtitle = contextParts.join(' · ');

  const isDay = String(meta?.period || '').toLowerCase() === 'day';

  return (
    <div className="space-y-3">
      {/* Entries per day (or per hour in Day mode) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {isDay ? (
          <ChartBlock
            title={t('chart_entries_per_hour')}
            subtitle={commonSubtitle}
            t={t}
            fileKey="entries_per_hour"
            rows={entriesPerHour}
            headers={[ 'hour', 'count' ]}
            renderSvg={() => (
              <BarChart
                data={entriesPerHour.map(d => ({ hour: String(d.hour).padStart(2, '0'), count: d.count }))}
                xKey="hour"
                yKey="count"
                width={320}
                height={110}
                yUnit={t('y_entries')}
              />
            )}
          />
        ) : (
          <ChartBlock
            title={t('chart_entries_per_day')}
            subtitle={commonSubtitle}
            t={t}
            fileKey="entries_per_day"
            rows={entriesPerDay}
            headers={[ 'day', 'count' ]}
            renderSvg={() => <BarChart data={entriesPerDay} xKey="day" yKey="count" width={320} height={110} yUnit={t('y_entries')} />}
          />
        )}
        {/* DAU only — show in both Day and Month/Season modes */}
        {isDay ? (
          <ChartBlock
            title={t('chart_dau_hour')}
            subtitle={commonSubtitle}
            note={t('dau_def')}
            t={t}
            fileKey="dau_hour"
            rows={dauPerHour.map(d => ({ x: d.hour, dau: d.count }))}
            headers={[ 'x', 'dau' ]}
            renderSvg={() => (
              <LineChart
                series={[{ label: 'DAU', color: '#0ea5e9', data: dauPerHour.map(d => ({ x: String(d.hour).padStart(2, '0'), y: d.count })) }]}
                t={t}
                width={320}
                height={110}
                yUnit={t('y_users')}
              />
            )}
          />
        ) : (
          <ChartBlock
            title={t('chart_dau')}
            subtitle={commonSubtitle}
            note={t('dau_def')}
            t={t}
            fileKey="dau"
            rows={dauPerDay.map(d => ({ x: d.day, dau: d.count }))}
            headers={[ 'x', 'dau' ]}
            renderSvg={() => (
              <LineChart
                series={[
                  { label: 'DAU', color: '#0ea5e9', data: dauPerDay.map(d => ({ x: d.day, y: d.count })) },
                ]}
                t={t}
                width={320}
                height={110}
                yUnit={t('y_users')}
              />
            )}
          />
        )}
      </div>

      {/* Retention/Streaks — also hide in Day mode (need multiple days) */}
      {!isDay && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <ChartBlock
            title={t('chart_retention')}
            subtitle={commonSubtitle}
            t={t}
            fileKey="retention_distribution"
            rows={retentionRows}
            headers={[ 'bucket', 'count' ]}
            renderSvg={() => <BarChart data={retentionRows} xKey="bucket" yKey="count" color="#22c55e" width={320} height={110} yUnit={t('y_users')} />}
          />
          <ChartBlock
            title={t('chart_streaks')}
            subtitle={commonSubtitle}
            t={t}
            fileKey="streak_distribution"
            rows={streakRows}
            headers={[ 'bucket', 'count' ]}
            renderSvg={() => <BarChart data={streakRows} xKey="bucket" yKey="count" color="#f43f5e" width={320} height={110} yUnit={t('y_users')} />}
          />
        </div>
      )}

      {/* Cohort — month/season only */}
      {!isDay && (
        <ChartBlock
          title={t('chart_cohort')}
          subtitle={commonSubtitle}
          note={t('cohort_def')}
          t={t}
          fileKey="cohort_new_returning"
          rows={cohortByMonth}
          headers={[ 'month', 'new', 'returning' ]}
          renderSvg={() => {
            const width = 320, height = 120, padding = 22;
            const innerW = width - padding * 2;
            const innerH = height - padding * 2;
            const data = cohortByMonth;
            const max = Math.max(1, ...data.map(d => (Number(d.new||0)+Number(d.returning||0))));
            const barW = data.length ? innerW / data.length : innerW;
            // simple y-axis with ticks
            const ticks = [0, Math.round(max/2), max];
            return (
              <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="auto" role="img" aria-label="stacked bar chart">
                <rect x="0" y="0" width={width} height={height} fill="#ffffff" />
                {/* Y-axis */}
                <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#9ca3af" strokeWidth="1" />
                {ticks.map((tv, i) => {
                  const ty = padding + (innerH - (tv/max)*innerH);
                  return <text key={i} x={2} y={ty+3} fontSize="9" fill="#6b7280">{tv}</text>;
                })}
                {/* Unit label */}
                <text x={padding + 4} y={padding - 6} fontSize="9" fill="#374151">{t('y_users')}</text>
                {/* Legend: New (blue) and Returning (green) */}
                <g transform={`translate(${width - padding - 120}, ${padding - 12})`}>
                  <rect x="0" y="0" width="10" height="4" fill="#0ea5e9" />
                  <text x="14" y="4" fontSize="9" fill="#374151">{t('cohort_new_label')}</text>
                  <rect x="70" y="0" width="10" height="4" fill="#22c55e" />
                  <text x="84" y="4" fontSize="9" fill="#374151">{t('cohort_returning_label')}</text>
                </g>
                <g>
                  {data.map((d, i) => {
                    const total = Number(d.new||0)+Number(d.returning||0);
                    const x = padding + 4 + i * barW;
                    const hTotal = (total / max) * innerH;
                    const hNew = total ? (Number(d.new||0)/total) * hTotal : 0;
                    const hReturning = total ? (Number(d.returning||0)/total) * hTotal : 0;
                    const yStart = padding + (innerH - hTotal);
                    return (
                      <g key={i}>
                        <rect x={x} y={yStart} width={Math.max(1, barW - 6)} height={hNew} fill="#0ea5e9" />
                        <rect x={x} y={yStart + hNew} width={Math.max(1, barW - 6)} height={hReturning} fill="#22c55e" />
                      </g>
                    );
                  })}
                </g>
                <g fill="#6b7280" fontSize="9">
                  {data.map((d, i) => (i % Math.ceil(data.length / 6) === 0 ? (
                    <text key={i} x={padding + 4 + i * barW} y={height - 6}>{d.month}</text>
                  ) : null))}
                </g>
              </svg>
            );
          }}
        />
      )}
    </div>
  );
}
