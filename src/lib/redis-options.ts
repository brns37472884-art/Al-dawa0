import type { RedisOptions } from "ioredis";

/**
 * خيارات اتصال Redis لـ BullMQ (Queue/Worker) من REDIS_URL.
 * ioredis لا يقرأ مفتاح `url` داخل كائن الخيارات — فيتصل بـ 127.0.0.1 بصمت،
 * لذا نفكّك الرابط صراحة. family:0 = IPv4+IPv6 (شبكة Railway الداخلية).
 */
export function redisConnectionOptions(url: string, opts?: { producer?: boolean }): RedisOptions {
  const u = new URL(url);
  const out: RedisOptions = {
    host: u.hostname,
    port: Number(u.port || 6379),
    family: 0,
    connectTimeout: 5000,
  };
  if (u.username) out.username = decodeURIComponent(u.username);
  if (u.password) out.password = decodeURIComponent(u.password);
  const db = Number((u.pathname || "").replace(/^\//, ""));
  if (Number.isInteger(db) && db > 0) out.db = db;
  if (u.protocol === "rediss:") out.tls = { servername: u.hostname };
  // المنتج (Queue): فشل سريع ثم تنفيذ مباشر بدل التعليق عند تعطل Redis
  if (opts?.producer) out.maxRetriesPerRequest = 2;
  return out;
}
