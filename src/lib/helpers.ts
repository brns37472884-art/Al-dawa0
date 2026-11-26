export function safeJsonParse<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** حساب العمر بالسنين الكاملة */
export function calcAge(dob: Date | null | undefined): number | null {
  if (!dob) return null;
  const diff = Date.now() - dob.getTime();
  if (diff < 0) return null;
  return Math.floor(diff / (365.25 * 24 * 3600 * 1000));
}

export function calcBmi(heightCm?: number | null, weightKg?: number | null): number | null {
  if (!heightCm || !weightKg) return null;
  const m = heightCm / 100;
  return weightKg / (m * m);
}

/** توحيد رقم الموبايل المصري → +201xxxxxxxxx */
export function normalizePhone(p: string | null | undefined): string | null {
  const t = String(p || "").replace(/[\s-]/g, "");
  const m = t.match(/^(?:\+?20)?0?(1[0125]\d{8})$/);
  return m ? `+20${m[1]}` : null;
}

/**
 * تطبيع الاسم العربي للمطابقة — إزالة التشكيل والتطويل، توحيد الحروف المتشابهة.
 * تُستخدم في منع الغلط: مقارنة اسم التقرير باسم الطلب قبل الإرسال.
 */
export function normalizeArabicName(s: string): string {
  return String(s || "")
    .trim()
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "") // التشكيل
    .replace(/\u0640/g, "") // التطويل ـ
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** هل الاسمان متطابقان بعد التطبيع؟ (المطابقة على الاسم كاملًا) */
export function nameMatches(a: string, b: string): boolean {
  const na = normalizeArabicName(a);
  const nb = normalizeArabicName(b);
  if (!na || !nb) return false;
  return na === nb;
}

/** قناع رقم الموبايل — آخر 4 أرقام فقط */
export function maskPhone(p: string | null | undefined): string {
  if (!p || p.length < 4) return "***";
  return p.slice(0, -4).replace(/\d/g, "*") + p.slice(-4);
}

export function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || "").trim());
}

export function isStrongPassword(pw: string): boolean {
  return String(pw || "").length >= 8 && /[a-zA-Z]/.test(pw) && /\d/.test(pw);
}

/** توليد رقم طلب فريد: DW-YYMM-XXXXXX */
export function generateOrderNumber(seq: number): string {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `DW-${yy}${mm}-${String(seq).padStart(6, "0")}`;
}
