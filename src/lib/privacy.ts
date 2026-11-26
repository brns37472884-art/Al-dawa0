// ============================================================
// الخصوصية — إخفاء بيانات التعريف قبل إرسال أي نص لمزود AI خارجي.
// لا نرسل أبدًا: اسم المريض، رقم الموبايل، الرقم القومي، العناوين.
// ============================================================
import { db } from "@/lib/db";

const REDACTED = "[بيانات محجوبة]";

export function redactPii(text: string, opts: { names?: string[] } = {}): string {
  let out = text;
  for (const n of opts.names ?? []) {
    const trimmed = typeof n === "string" ? n.trim() : "";
    if (trimmed.length >= 3) out = out.split(trimmed).join(REDACTED);
  }
  out = out.replace(/\b[23]\d{13}\b/g, REDACTED); // الرقم القومي المصري
  out = out.replace(/(?:\+?20|0)?1[0125]\d{8}/g, REDACTED); // الموبايل
  out = out.replace(/\b(?:\+?20|0)?\s?1[0125](?:[\s-]?\d){8}\b/g, REDACTED);
  out = out.replace(/\b0\d{8,9}\b/g, REDACTED); // أرضي
  out = out.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, REDACTED); // بريد
  out = out.replace(/(شارع|عنوان|عمارة|دور|شقة)\s*:?\s*\S{2,30}/g, `$1 ${REDACTED}`);
  out = out.replace(/(اسم المريض|اسم الموظف|المريض|الاسم)\s*[:\-]\s*\S{2,40}/g, `$1 ${REDACTED}`);
  return out;
}

/** كشف ترويسة الصور — الصورة نفسها لا يمكن تجريدها، نسجل ملاحظة شفافية فقط */
export function flagImagePii(): { caution: boolean; noteAr: string; noteEn: string } {
  return {
    caution: true,
    noteAr: "الصور تُرسل لمزود التحليل كما هي؛ قد تحتوي ترويسة التقرير على بيانات المريض — يُفضّل رفع PDF نصي أو الإدخال المباشر من المعمل.",
    noteEn: "Images are sent to the analysis provider as-is; the header may contain patient data — prefer text PDF or direct lab entry.",
  };
}

/** بوابة الموافقة: AI_ANALYSIS شرط لأي إرسال لمزود خارجي */
export async function hasAiConsent(userId: string): Promise<boolean> {
  const c = await db.consent.findUnique({
    where: { userId_type: { userId, type: "AI_ANALYSIS" } },
  });
  return !!c?.granted;
}

/** موافقة مشاركة النتائج مع الطبيب */
export async function hasDoctorShareConsent(userId: string): Promise<boolean> {
  const c = await db.consent.findUnique({
    where: { userId_type: { userId, type: "DOCTOR_SHARE" } },
  });
  return !!c?.granted;
}
