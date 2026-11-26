import type Redis from "ioredis";

/**
 * عميل Redis مشترك — OTP، rate-limit، الطوابير، pub/sub.
 * في التطوير بدون REDIS_URL: تعمل الذاكرة المحلية (سلوك متطابق) —
 * في الإنتاج env.ts يفشل مبكرًا بدون REDIS_URL.
 * الإنتاج: بلا fallback صامت للذاكرة — ioredis يعيد الاتصال تلقائيًا (retryStrategy)
 * وعمليات KV تفشل بخطأ واضح بدل تخزين OTP/rate-limit محليًا على نسخة واحدة.
 */

const IS_PROD = process.env.NODE_ENV === "production";

let client: Redis | null = null;
let broken = false;

/** الإنتاج: خطأ صريح بدل الذاكرة المحلية (لا قيم OTP/rate-limit خارج Redis) */
function redisUnavailable(op: string): never {
  throw new Error(`REDIS_UNAVAILABLE: ${op} — Redis غير متاح. في الإنتاج لا يُسمح بالتخزين المحلي؛ تحقق من REDIS_URL وخدمة Redis (الاتصال يعيد المحاولة تلقائيًا).`);
}

export async function redis(): Promise<Redis | null> {
  const url = process.env.REDIS_URL || "";
  if (!url) return null;
  if (broken) return null;
  if (client) return client;
  try {
    const { default: RedisCtor } = await import("ioredis");
    client = new RedisCtor(url, {
      // family 0 = IPv4+IPv6 — شبكة Railway الخاصة (*.railway.internal) قد تكون IPv6 فقط
      family: 0,
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 5000,
      // الإنتاج: طابور الأوامر مفعّل — وإلا فشل أول طلب بعد الإقلاع قبل اكتمال الاتصال
      enableOfflineQueue: IS_PROD,
      // إعادة اتصال دائمة بتراجع متزايد — التعطل المؤقت لا يوقف العملية للأبد
      retryStrategy: (times: number) => Math.min(times * 200, 5000),
    });
    client.on("error", (e: Error) => {
      if (IS_PROD) {
        // الإنتاج: لا نعلّم العميل مكسورًا للأبد — ioredis يعيد الاتصال والعمليات تفشل صراحة
        console.error(`[REDIS] غير متاح — جارٍ إعادة الاتصال تلقائيًا: ${e.message}`);
        return;
      }
      if (!broken) {
        broken = true;
        console.error(`[REDIS] غير متاح — التخزين المحلي حتى إعادة التشغيل: ${e.message}`);
      }
    });
    return client;
  } catch (e) {
    broken = true;
    console.error(`[REDIS] تعذر تحميل ioredis: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

// ---------- مخزن KV بسيط (OTP/MFA وغيره) ----------
interface KvEntry {
  value: string;
  exp: number;
}
const kvMemory = new Map<string, KvEntry>();

function kvPrune(now: number) {
  if (kvMemory.size < 5000) return;
  for (const [k, v] of kvMemory) {
    if (v.exp < now) kvMemory.delete(k);
  }
}

export async function kvSet(key: string, value: string, ttlMs: number): Promise<void> {
  const r = await redis();
  if (r) {
    try {
      await r.set(`aldawa:kv:${key}`, value, "PX", ttlMs);
      return;
    } catch {
      if (IS_PROD) redisUnavailable("kvSet");
      /* تطوير: فشل عابر → الذاكرة */
    }
  }
  if (IS_PROD) redisUnavailable("kvSet");
  kvPrune(Date.now());
  kvMemory.set(key, { value, exp: Date.now() + ttlMs });
}

export async function kvGet(key: string): Promise<string | null> {
  const r = await redis();
  if (r) {
    try {
      return await r.get(`aldawa:kv:${key}`);
    } catch {
      if (IS_PROD) redisUnavailable("kvGet");
      /* تطوير: فشل عابر → الذاكرة */
    }
  }
  if (IS_PROD) redisUnavailable("kvGet");
  const v = kvMemory.get(key);
  if (!v) return null;
  if (v.exp < Date.now()) {
    kvMemory.delete(key);
    return null;
  }
  return v.value;
}

export async function kvDel(key: string): Promise<void> {
  kvMemory.delete(key);
  const r = await redis();
  if (r) {
    try {
      await r.del(`aldawa:kv:${key}`);
    } catch (e) {
      // الحذف لا يخزن شيئًا محليًا — تكفي رسالة واضحة بلا انهيار مسارات الخروج
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[REDIS] kvDel فشل: ${msg}`);
    }
  } else if (IS_PROD) {
    console.error("[REDIS] kvDel — Redis غير متاح في الإنتاج (لا شيء محليًا يُحذف)");
  }
}

/** ناشر/مشترك pub/sub — بث الأحداث بين النسخ */
let subClient: Redis | null = null;

export async function publisher(): Promise<Redis | null> {
  return redis();
}

export async function subscriber(): Promise<Redis | null> {
  const r = await redis();
  if (!r) return null;
  if (!subClient) {
    subClient = r.duplicate();
    subClient.on("error", () => {});
  }
  return subClient;
}
