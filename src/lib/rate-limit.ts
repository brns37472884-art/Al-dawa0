import { redis } from "./redis";

/**
 * محدد معدل الطلبات — نافذة ثابتة على Redis (مشتركة بين النسخ)
 * بلا Redis (تطوير): عدادات الذاكرة المحلية بنفس السلوك.
 * IP العميل: لا ثقة بـ X-Forwarded-For إلا عند TRUSTED_PROXY=true.
 */

interface Bucket {
  count: number;
  reset: number;
}
const buckets = new Map<string, Bucket>();

function prune(now: number) {
  if (buckets.size < 5000) return;
  for (const [k, v] of buckets) {
    if (v.reset < now) buckets.delete(k);
  }
}

/** true = مسموح، false = تجاوز الحد */
export async function rateLimit(key: string, max: number, windowMs: number): Promise<boolean> {
  const now = Date.now();
  prune(now);
  const r = await redis();
  if (r) {
    try {
      const k = `aldawa:rl:${key}`;
      const pipe = r.multi();
      pipe.incr(k);
      pipe.pexpire(k, windowMs, "NX");
      const res = await pipe.exec();
      const n = Number(res?.[0]?.[1] ?? 1);
      return n <= max;
    } catch {
      /* فشل عابر → الذاكرة */
    }
  }
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  b.count += 1;
  return b.count <= max;
}

export async function rateLimitReset(key: string): Promise<void> {
  buckets.delete(key);
  const r = await redis();
  if (r) {
    try {
      await r.del(`aldawa:rl:${key}`);
    } catch {
      /* تجاهل */
    }
  }
}

/**
 * TRUSTED_PROXY=true (خلف Caddy/Nginx موثوق) → ثقة X-Forwarded-For ثم x-real-ip.
 * غير ذلك: لا ثقة بأي هيدر يرسله العميل — هوية مشتركة "direct".
 */
export function ipFromHeaders(get: (k: string) => string | null | undefined): string {
  if (process.env.TRUSTED_PROXY === "true") {
    // TRUSTED_IP_HEADER (اختياري): هيدر يضبطه الـ proxy نفسه (مثل x-real-ip على Railway)
    // — أأمن من أول عنصر في X-Forwarded-For الذي قد يرسله العميل بنفسه.
    const custom = (process.env.TRUSTED_IP_HEADER || "").trim().toLowerCase();
    if (custom) {
      const v = get(custom);
      if (v) return v.split(",")[0].trim();
    }
    const fwd = get("x-forwarded-for");
    if (fwd) return fwd.split(",")[0].trim();
    return get("x-real-ip") || "proxy";
  }
  return "direct";
}

export function clientIp(req: Request): string {
  return ipFromHeaders((k) => req.headers.get(k));
}
