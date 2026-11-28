/**
 * مفاتيح تشغيل بيئية (Railway Variables).
 *
 * القيم تُقرأ بتسامح: تُزال المسافات وعلامات الاقتباس ("false" و 'false' و False كلها = false).
 *
 * EMAIL_VERIFICATION_REQUIRED (افتراضي false):
 *   true  → التسجيل يتطلب رمز OTP بالبريد. false → التسجيل بلا تحقق (emailVerifiedAt يبقى فارغًا).
 *
 * MFA_EMAIL_REQUIRED (رمز MFA بالبريد لحسابات ADMIN/LAB/OFFICER/DOCTOR):
 *   true  → إلزامي دائمًا (بلا مزود بريد لن يستطيع أحد الدخول).
 *   false → معطّل.
 *   غير مضبوط → يتفعّل تلقائيًا فقط إذا كان هناك مزود بريد (SMTP_HOST) أو وضع DEMO (الرمز يظهر على الشاشة)،
 *               وإلا يتعطل لأن الرمز لا يمكن أن يصل أصلًا وسيقفل الدخول.
 */
function clean(v: string | undefined): string {
  return (v ?? "").trim().replace(/^["'`]+|["'`]+$/g, "").trim().toLowerCase();
}

const TRUE = new Set(["true", "1", "yes", "on"]);
const FALSE = new Set(["false", "0", "no", "off"]);

export function emailVerificationRequired(): boolean {
  return TRUE.has(clean(process.env.EMAIL_VERIFICATION_REQUIRED));
}

export function mfaEmailRequired(): boolean {
  const v = clean(process.env.MFA_EMAIL_REQUIRED);
  if (FALSE.has(v)) return false;
  if (TRUE.has(v)) return true;
  return Boolean((process.env.SMTP_HOST ?? "").trim()) || clean(process.env.DEMO_MODE) === "true";
}

/** سطر تشخيصي آمن للّوج عند الإقلاع (لا أسرار) */
export function describeFlags(): string {
  return `MFA بالبريد=${mfaEmailRequired() ? "مفعّل" : "معطّل"} (MFA_EMAIL_REQUIRED=${JSON.stringify(process.env.MFA_EMAIL_REQUIRED ?? null)}، SMTP=${(process.env.SMTP_HOST ?? "").trim() ? "مضبوط" : "غير مضبوط"}) | تحقق البريد عند التسجيل=${emailVerificationRequired() ? "مفعّل" : "معطّل"}`;
}
