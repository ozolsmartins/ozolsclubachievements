// lib/logger.js
// Minimal structured logger with request IDs and slow-operation helpers

export function getRequestIdFromHeaders(h) {
  const hdr = h?.get ? (h.get('x-request-id') || h.get('x-requestid') || h.get('x-amzn-trace-id')) : null;
  return hdr || undefined;
}

export function createLogger({ requestId, route = 'api' } = {}) {
  const base = { requestId, route };
  const log = (level, msg, extra) => {
    // Ensure a single line JSON log
    const rec = { level, msg, time: new Date().toISOString(), ...base, ...(extra || {}) };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(rec));
  };
  return {
    info: (msg, extra) => log('info', msg, extra),
    warn: (msg, extra) => log('warn', msg, extra),
    error: (msg, extra) => log('error', msg, extra),
    debug: (msg, extra) => log('debug', msg, extra),
  };
}

export async function timed(logger, name, fn) {
  const start = Date.now();
  try {
    const res = await fn();
    const durationMs = Date.now() - start;
    const slowMs = Number(process.env.SLOW_QUERY_MS || 300);
    if (durationMs >= slowMs) {
      logger.warn('slow_operation', { op: name, durationMs });
    } else {
      logger.debug('operation_timing', { op: name, durationMs });
    }
    return res;
  } catch (err) {
    const durationMs = Date.now() - start;
    logger.error('operation_failed', { op: name, durationMs, error: String(err?.message || err) });
    throw err;
  }
}

export default { createLogger, getRequestIdFromHeaders, timed };
