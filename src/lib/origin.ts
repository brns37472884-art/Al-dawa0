/**
 * فحص Origin/Host للطلبات المُعدِّلة — حماية CSRF.
 * لو Origin موجود ومختلف عن PUBLIC_BASE_URL → مرفوض.
 * بلا PUBLIC_BASE_URL يُقارن host الـ Origin مع host الطلب.
 * الطلبات بلا Origin (عملاء غير متصفحين) تمر.
 * دالة نقية (بلا اعتماديات) — تعمل في middleware وفي مسارات Node.
 */
export function originAllowed(headers: { get(name: string): string | null }): boolean {
  const origin = headers.get("origin");
  if (!origin) return true;
  let originHost = "";
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false; // Origin تالف
  }
  const base = (process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "").toLowerCase();
  if (base) {
    let baseHost = "";
    try {
      baseHost = new URL(base).host.toLowerCase();
    } catch {
      baseHost = base; // قيمة بلا scheme — قارنها كما هي
    }
    return originHost === baseHost || origin.toLowerCase().replace(/\/+$/, "") === base;
  }
  const host = (headers.get("host") || "").toLowerCase();
  return host ? originHost === host : true;
}
