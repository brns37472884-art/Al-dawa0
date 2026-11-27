import { db } from "@/lib/db";

/**
 * إعدادات النظام القابلة للضبط من لوحة المدير — قيم افتراضية آمنة.
 */
export const SETTING_DEFAULTS = {
  ALLOW_PATIENT_UPLOAD: {
    value: "false",
    noteAr: "السماح للعملاء برفع تقاريرهم بأنفسهم — في فترة التجربة يكون الاستلام من المعمل فقط",
    noteEn: "Allow patients to upload their own reports — during pilot, intake is lab-only",
  },
  LAB_RESULTS_EXEMPT_FROM_LIMIT: {
    value: "true",
    noteAr: "نتائج المعامل (LAB_DIRECT) لا تُحسب ضمن حد تقارير الباقة",
    noteEn: "Lab-direct results don't count against plan report limits",
  },
  DOCTOR_SLA_HOURS: {
    value: "24",
    noteAr: "سقف زمن استجابة الطبيب لمراجعة الحالة بالساعات — تجاوزه يظهر في صندوق الأولويات",
    noteEn: "Doctor review SLA in hours — breaches surface in the priority inbox",
  },
  LAB_SLA_HOURS: {
    value: "2",
    noteAr: "أقصى مدة لمراجعة نتيجة قبل التأكيد بالساعات — تجاوزها يرفعها أعلى القائمة",
    noteEn: "Max hours to verify a result before confirmation",
  },
  PENDING_CLAIM_EXPIRY_DAYS: {
    value: "30",
    noteAr: "تُحذف النتائج غير المستلمة تلقائيًا بعد هذه المدة (يوم)",
    noteEn: "Unclaimed pending results expire after this many days",
  },
  PAY_CASH_INFO: {
    value: "",
    noteAr: "تعليمات الدفع كاش (رقم المحفظة الإلكترونية واسم المستلم) — تظهر للعميل عند الاشتراك",
    noteEn: "Cash / e-wallet payment instructions shown to the customer",
  },
  PAY_INSTAPAY_INFO: {
    value: "",
    noteAr: "تعليمات الدفع عبر إنستا باي (عنوان الدفع IPA أو الرقم) — تظهر للعميل عند الاشتراك",
    noteEn: "InstaPay payment instructions shown to the customer",
  },
  PAY_BANK_INFO: {
    value: "",
    noteAr: "بيانات التحويل البنكي (اسم البنك، اسم الحساب، رقم الحساب/IBAN) — تظهر للعميل عند الاشتراك",
    noteEn: "Bank transfer details shown to the customer",
  },
  LAB_DAILY_UPLOAD_LIMIT: {
    value: "200",
    noteAr: "أقصى عدد نتائج يمكن للمعمل رفعها يوميًا",
    noteEn: "Max daily uploads per lab",
  },
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

export async function getSetting(key: SettingKey): Promise<string> {
  try {
    const row = await db.systemSetting.findUnique({ where: { key } });
    return row?.value ?? SETTING_DEFAULTS[key].value;
  } catch {
    return SETTING_DEFAULTS[key].value;
  }
}

export async function getSettingNumber(key: SettingKey): Promise<number> {
  const v = Number(await getSetting(key));
  return Number.isFinite(v) ? v : Number(SETTING_DEFAULTS[key].value);
}

export async function getSettingBool(key: SettingKey): Promise<boolean> {
  return (await getSetting(key)) === "true";
}

export async function setSetting(key: SettingKey, value: string): Promise<void> {
  await db.systemSetting.upsert({
    where: { key },
    create: { key, value, noteAr: SETTING_DEFAULTS[key].noteAr, noteEn: SETTING_DEFAULTS[key].noteEn },
    update: { value },
  });
}

export async function getAllSettings(): Promise<
  Array<{ key: string; value: string; noteAr: string | null; noteEn: string | null; isDefault: boolean }>
> {
  const rows = await db.systemSetting.findMany();
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return (Object.keys(SETTING_DEFAULTS) as SettingKey[]).map((k) => ({
    key: k,
    value: byKey.get(k)?.value ?? SETTING_DEFAULTS[k].value,
    noteAr: byKey.get(k)?.noteAr ?? SETTING_DEFAULTS[k].noteAr ?? null,
    noteEn: byKey.get(k)?.noteEn ?? SETTING_DEFAULTS[k].noteEn ?? null,
    isDefault: !byKey.has(k),
  }));
}
