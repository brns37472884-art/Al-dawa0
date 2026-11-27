/**
 * مفاتيح تشغيل بيئية (Railway Variables) — الافتراضي آمن حيثما أمكن.
 *
 * EMAIL_VERIFICATION_REQUIRED (افتراضي false):
 *   true  → التسجيل يتطلب رمز OTP بالبريد (السلوك الأصلي).
 *   false → التسجيل بلا تحقق من البريد (emailVerifiedAt يبقى فارغًا).
 *
 * MFA_EMAIL_REQUIRED (افتراضي true):
 *   false → يُعطَّل رمز MFA بالبريد لحسابات ADMIN/LAB/OFFICER/DOCTOR.
 *   استخدمه مؤقتًا فقط حتى يُضبط مزود بريد حقيقي — الافتراضي true آمن.
 */
export function emailVerificationRequired(): boolean {
  return (process.env.EMAIL_VERIFICATION_REQUIRED || "").trim().toLowerCase() === "true";
}

export function mfaEmailRequired(): boolean {
  return (process.env.MFA_EMAIL_REQUIRED || "").trim().toLowerCase() !== "false";
}
