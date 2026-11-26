import crypto from "crypto";

/**
 * تشفير الملفات المعلّقة «بانتظار الاستلام» — AES-256-GCM.
 * المفتاح: LAB_ENC_KEY (32+) أو اشتقاق من JWT_SECRET في التطوير فقط.
 * الملف لا يُخزن أبدًا صريحًا — فك التشفير فقط بعد التحقق الموثّق.
 */
const ALGO = "aes-256-gcm";

function encKey(): Buffer {
  const secret = process.env.LAB_ENC_KEY || process.env.JWT_SECRET || "";
  if (secret.length < 32) throw new Error("ENC_KEY_MISSING: اضبط LAB_ENC_KEY أو JWT_SECRET (32+ حرفًا)");
  return crypto.createHash("sha256").update(`aldawa-v2-pending:${secret}`).digest();
}

/** تشفير بايتات — الإخراج: iv:tag:ciphertext (base64url لكل جزء) */
export function encryptBuffer(data: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, encKey(), iv);
  const ct = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}:${tag.toString("base64url")}:${ct.toString("base64url")}`;
}

export function decryptBuffer(payload: string): Buffer {
  const [ivB, tagB, ctB] = payload.split(":");
  if (!ivB || !tagB || !ctB) throw new Error("INVALID_ENVELOPE");
  const decipher = crypto.createDecipheriv(ALGO, encKey(), Buffer.from(ivB, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ctB, "base64url")), decipher.final()]);
}

export function encryptText(plain: string): string {
  return encryptBuffer(Buffer.from(plain, "utf-8"));
}

export function decryptText(payload: string): string {
  try {
    return decryptBuffer(payload).toString("utf-8");
  } catch {
    return "";
  }
}

export function claimToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function qrToken(): string {
  return crypto.randomBytes(18).toString("base64url");
}

/** هاش رقم الموبايل — HMAC-SHA256 بمفتاح مشتق (الرقم المصري مساحة صغيرة — لا SHA مجرد) */
export function hashPhone(normalized: string): string {
  const secret = process.env.LAB_ENC_KEY || process.env.JWT_SECRET || "";
  if (secret.length < 32) throw new Error("ENC_KEY_MISSING");
  const pepper = crypto.createHash("sha256").update(`aldawa-v2-phone-pepper:${secret}`).digest();
  return crypto.createHmac("sha256", pepper).update(normalized).digest("hex");
}

/** هاش كود OTP/MFA — sha256 + مقارنة زمنية-ثابتة */
export function hashCode(code: string): string {
  return crypto.createHash("sha256").update(`aldawa-v2-code:${code}`).digest("hex");
}

export function codeMatches(provided: string, storedHash: string): boolean {
  const a = Buffer.from(hashCode(String(provided).trim()));
  const b = Buffer.from(storedHash);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** مقارنة رمز استلام زمنية-ثابتة */
export function tokenMatches(stored: string, provided: string): boolean {
  const a = crypto.createHash("sha256").update(stored).digest();
  const b = crypto.createHash("sha256").update(String(provided || "").trim()).digest();
  return crypto.timingSafeEqual(a, b);
}
