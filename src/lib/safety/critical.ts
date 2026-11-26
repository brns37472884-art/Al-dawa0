// ============================================================
// قواعد الأمان الطبي — تُقرأ من قاعدة البيانات (CriticalRule) كبيانات معتمدة.
// القاعدة الذهبية: لا يُحسب إلا المعتمد من المسؤول الطبي (status=APPROVED).
// ============================================================
import { db } from "@/lib/db";

export interface SafetyRule {
  key: string;
  testKey: string;
  op: "<" | ">";
  threshold: number;
  severity: "HIGH" | "URGENT";
  messageAr: string;
  messageEn: string;
  unit: string;
}

/**
 * القواعد الحرجة المعتمدة — من القاعدة (بيانات) لا من الكود.
 * كاش قصير داخل العملية لتقليل الاستعلام على المسار الساخن.
 */
let rulesCache: { rules: SafetyRule[]; at: number } | null = null;
const CACHE_MS = 30_000;

export async function getApprovedCriticalRules(): Promise<SafetyRule[]> {
  if (rulesCache && Date.now() - rulesCache.at < CACHE_MS) return rulesCache.rules;
  try {
    const rows = await db.criticalRule.findMany({ where: { status: "APPROVED" } });
    const rules: SafetyRule[] = rows.map((r) => ({
      key: r.key,
      testKey: r.testKey,
      op: r.op === "<" ? "<" : ">",
      threshold: r.threshold,
      severity: r.severity === "URGENT" ? "URGENT" : "HIGH",
      messageAr: r.messageAr,
      messageEn: r.messageEn,
      unit: r.unit,
    }));
    rulesCache = { rules, at: Date.now() };
    return rules;
  } catch {
    return [];
  }
}

export function invalidateCriticalRulesCache(): void {
  rulesCache = null;
}

/** فحص قيمة واحدة مقابل القواعد المعتمدة — null عند عدم التطابق */
export async function matchCriticalRule(
  testKey: string | null,
  value: number | null,
  approved?: SafetyRule[]
): Promise<SafetyRule | null> {
  if (!testKey || value === null || Number.isNaN(value)) return null;
  const rules = approved ?? (await getApprovedCriticalRules());
  for (const rule of rules) {
    if (rule.testKey !== testKey) continue;
    if (rule.op === "<" && value < rule.threshold) return rule;
    if (rule.op === ">" && value > rule.threshold) return rule;
  }
  return null;
}

/** رسالة التعليمات عند القيم الحرجة — الإسعاف 123 */
export const EMERGENCY_INSTRUCTIONS_AR =
  "إذا كنت تعاني أعراضًا حادة الآن (ألم صدر، ضيق نفس، إغماء، نزيف، تشوش وعي): اتصل بالإسعاف 123 فورًا أو توجه لأقرب طوارئ. لا تنتظر معالجة المنصة أو موعد المتابعة.";
export const EMERGENCY_INSTRUCTIONS_EN =
  "If you have acute symptoms right now (chest pain, shortness of breath, fainting, bleeding, confusion): call emergency 123 immediately or go to the nearest ER.";

/** قرار الإحالة الطبية بعد تأكيد القيم */
export function referralDecision(values: Array<{ flag: string; critical: boolean }>): {
  refer: boolean;
  urgency: "ROUTINE" | "ATTENTION" | "URGENT";
} {
  if (values.some((v) => v.critical)) return { refer: true, urgency: "URGENT" };
  const abnormal = values.filter((v) => v.flag === "HIGH" || v.flag === "LOW").length;
  if (abnormal >= 2) return { refer: true, urgency: "ATTENTION" };
  if (abnormal === 1) return { refer: true, urgency: "ROUTINE" };
  return { refer: false, urgency: "ROUTINE" };
}
