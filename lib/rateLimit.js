// lib/rateLimit.js
// Simple in-memory token bucket rate limiter per key (e.g., IP+route)

const buckets = new Map();

function now() { return Date.now(); }

export function rateLimitKeyFromRequest(req, route = 'api') {
  const h = req.headers;
  let ip = h.get('x-forwarded-for') || h.get('x-real-ip') || '';
  if (ip.includes(',')) ip = ip.split(',')[0].trim();
  if (!ip) ip = 'unknown';
  return `${route}:${ip}`;
}

export function rateLimitConsume(key, { capacity, refillPerSec }) {
  const t = now();
  let b = buckets.get(key);
  if (!b) {
    b = { tokens: capacity, updatedAt: t };
  } else {
    const elapsed = (t - b.updatedAt) / 1000;
    const refill = elapsed * refillPerSec;
    b.tokens = Math.min(capacity, b.tokens + refill);
    b.updatedAt = t;
  }
  if (b.tokens >= 1) {
    b.tokens -= 1;
    buckets.set(key, b);
    return { ok: true, remaining: Math.floor(b.tokens), resetSec: 1 / refillPerSec };
  } else {
    // Estimate retry-after as time to next full token
    const missing = 1 - b.tokens;
    const retryAfter = Math.ceil(missing / refillPerSec);
    buckets.set(key, b);
    return { ok: false, remaining: 0, retryAfter };
  }
}

export function getRateLimitConfig() {
  const perMin = Number(process.env.RATE_LIMIT_PER_MIN || 60);
  const capacity = perMin; // burst equals per-minute budget
  const refillPerSec = perMin / 60; // tokens per second
  return { capacity, refillPerSec };
}

export default { rateLimitKeyFromRequest, rateLimitConsume, getRateLimitConfig };
