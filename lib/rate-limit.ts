const buckets = new Map<
  string,
  { count: number; resetAt: number; warned: boolean }
>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size > 100_000) buckets.clear();
    buckets.set(key, { count: 1, resetAt: now + windowMs, warned: false });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

// Like rateLimit but reports WHY the call was limited so callers can send
// exactly one "slow down" notice per bucket window:
//   "ok"   -> within the limit, proceed
//   "warn" -> first violation of this window, send the notice once
//   "skip" -> already warned this window, stay silent
export function rateLimitOnce(
  key: string,
  limit: number,
  windowMs: number,
): "ok" | "warn" | "skip" {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size > 100_000) buckets.clear();
    buckets.set(key, { count: 1, resetAt: now + windowMs, warned: false });
    return "ok";
  }
  bucket.count += 1;
  if (bucket.count <= limit) return "ok";
  if (!bucket.warned) {
    bucket.warned = true;
    return "warn";
  }
  return "skip";
}