// ============================================================
// محرك الفحوصات الوقائية — قواعد طبية حتمية من بروتوكولات مخزنة كبيانات.
// يحتسب فقط المعتمد (APPROVED) من المسؤول الطبي — لا توصية قبل الاعتماد.
// ممنوع أي درجات خطورة أو نسب احتمال — عوامل فقط.
// ============================================================
import { safeJsonParse, calcBmi } from "@/lib/helpers";

export interface EngineProfileInput {
  age: number;
  gender: string | null;
  smokingStatus: string | null;
  quitYearsAgo: number | null;
  chronicConditions: string[];
  familyHistory: Array<{ condition: string; relation: string }>;
  personalCancerHistory: boolean;
  pregnant: boolean;
  heightCm: number | null;
  weightKg: number | null;
  bpSystolic: number | null;
  bpDiastolic: number | null;
  lastDone: Record<string, string | null>; // protocolKey → آخر تاريخ إجراء
}

export interface ProtocolLike {
  key: string;
  gender: string | null;
  minAge: number;
  maxAge: number | null;
  intervalMonths: number | null;
  riskFactors: string;
  requiresRisk: boolean;
  protocolType?: string;
  exclusionsAr?: string | null;
  exclusionsEn?: string | null;
  seeDoctorAr?: string | null;
  seeDoctorEn?: string | null;
  sourceOrg: string;
  guidelineVersion: string;
  guidelineDate: string;
  doctorDiscussion: boolean;
  titleAr: string;
  titleEn: string;
}

export interface EngineResult {
  key: string;
  eligible: boolean;
  status: "DUE" | "OVERDUE" | "UPCOMING" | "COMPLETED" | "NOT_ELIGIBLE";
  lastDoneAt: Date | null;
  nextDueAt: Date | null;
  reasonAr: string;
  reasonEn: string;
  metRiskFactors: string[];
}

export const RISK_ENGINE_VERSION = "2";

/** قواعد أهلية مركبة خاصة (منطق حسابي لا محتوى طبي جديد — كما في المرجع) */
function specialEligibility(key: string, p: EngineProfileInput): { ok: boolean; ar: string; en: string } | null {
  if (key === "LUNG_LDCT") {
    // USPSTF 2021: 50-80 سنة، 20 عبوة سنة فأكثر، مدخن حالي أو أقلع خلال آخر 15 سنة
    if (p.age < 50 || p.age > 80)
      return { ok: false, ar: "الفئة العمرية المؤهلة للفحص هي 50 إلى 80 سنة وفق إرشادات USPSTF.", en: "The eligible age range is 50–80 per USPSTF." };
    if (p.smokingStatus === "NEVER" || !p.smokingStatus)
      return { ok: false, ar: "الفحص موجّه لمن لديهم تاريخ تدخين كثيف (20 عبوة سنة فأكثر).", en: "Screening targets a heavy smoking history (≥20 pack-years)." };
    if (p.smokingStatus === "FORMER" && (p.quitYearsAgo ?? 0) > 15)
      return { ok: false, ar: "الفحص موجّه لمن أقلع خلال آخر 15 سنة فقط.", en: "Screening targets those who quit within the last 15 years." };
    return { ok: true, ar: "", en: "" };
  }
  return null;
}

function hasCondition(p: EngineProfileInput, key: string): boolean {
  return p.chronicConditions.includes(key);
}

function hasFamilyHistory(p: EngineProfileInput, key: string): boolean {
  return p.familyHistory.some((f) => f.condition === key);
}

export function evaluateProtocol(protocol: ProtocolLike, p: EngineProfileInput): EngineResult {
  const riskFactors = safeJsonParse<string[]>(protocol.riskFactors, []);
  let eligible = true;
  const reasonsAr: string[] = [];
  const reasonsEn: string[] = [];
  const metRiskFactors: string[] = [];

  if (protocol.gender && p.gender && protocol.gender !== p.gender) {
    eligible = false;
    reasonsAr.push("هذا الفحص خاص بـ" + (protocol.gender === "FEMALE" ? "الإناث" : "الذكور") + ".");
    reasonsEn.push("This screening applies to " + (protocol.gender === "FEMALE" ? "females" : "males") + " only.");
  }

  if (eligible && (p.age < protocol.minAge || (protocol.maxAge !== null && p.age > protocol.maxAge))) {
    eligible = false;
    const rangeAr = protocol.maxAge !== null ? `الفئة العمرية المستهدفة ${protocol.minAge}-${protocol.maxAge} سنة` : `الفئة العمرية المستهدفة من ${protocol.minAge} سنة فأكثر`;
    reasonsAr.push(`${rangeAr}، وعمرك الحالي ${p.age} سنة.`);
    reasonsEn.push(
      protocol.maxAge !== null
        ? `Target age is ${protocol.minAge}-${protocol.maxAge}; your age is ${p.age}.`
        : `Target age is ${protocol.minAge}+; your age is ${p.age}.`
    );
  }

  if (eligible) {
    const special = specialEligibility(protocol.key, p);
    if (special && !special.ok) {
      eligible = false;
      reasonsAr.push(special.ar);
      reasonsEn.push(special.en);
    }
  }

  if (eligible && protocol.requiresRisk) {
    const met: string[] = [];
    for (const rf of riskFactors) {
      let ok = false;
      switch (rf) {
        case "DIABETES": ok = hasCondition(p, "DIABETES") || hasCondition(p, "PREDIABETES"); break;
        case "HYPERTENSION": ok = hasCondition(p, "HYPERTENSION") || (p.bpSystolic !== null && p.bpSystolic >= 130); break;
        case "OBESITY": {
          const bmi = calcBmi(p.heightCm, p.weightKg);
          ok = bmi !== null && bmi >= 30;
          break;
        }
        case "DYSLIPIDEMIA": ok = hasCondition(p, "DYSLIPIDEMIA"); break;
        case "CKD": ok = hasCondition(p, "CKD"); break;
        case "HEART_DISEASE": ok = hasCondition(p, "HEART_DISEASE"); break;
        case "SMOKING": ok = p.smokingStatus === "CURRENT"; break;
        case "FAMILY_BREAST_CANCER": ok = hasFamilyHistory(p, "BREAST_CANCER"); break;
        case "FAMILY_COLORECTAL_CANCER": ok = hasFamilyHistory(p, "COLORECTAL_CANCER"); break;
        case "FAMILY_PROSTATE_CANCER": ok = hasFamilyHistory(p, "PROSTATE_CANCER"); break;
        case "FAMILY_ANY_CANCER": ok = p.familyHistory.length > 0; break;
        case "PERSONAL_CANCER": ok = p.personalCancerHistory || hasCondition(p, "CANCER"); break;
        case "OSTEOPOROSIS_RISK":
          ok = hasCondition(p, "OSTEOPOROSIS") || (p.gender === "FEMALE" && p.age >= 65) || hasFamilyHistory(p, "OSTEOPOROSIS");
          break;
        default: ok = false;
      }
      if (ok) met.push(rf);
    }
    if (!met.length) {
      eligible = false;
      reasonsAr.push("لا يوجد لديك حاليًا عوامل خطورة تستدعي هذا الفحص وفق الإرشادات — لذلك لا نقترحه لك تجنبًا للفحوصات غير الضرورية.");
      reasonsEn.push("You currently have no risk factors that call for this screening — we avoid unnecessary testing.");
    } else {
      metRiskFactors.push(...met);
      reasonsAr.push(`عوامل الخطورة الموجودة: ${met.join("، ")}.`);
      reasonsEn.push(`Present risk factors: ${met.join(", ")}.`);
    }
  }

  const lastStr = p.lastDone[protocol.key] ?? null;
  const lastDoneAt = lastStr ? new Date(lastStr) : null;
  let status: EngineResult["status"] = "DUE";
  let nextDueAt: Date | null = null;
  if (!eligible) {
    status = "NOT_ELIGIBLE";
  } else if (lastDoneAt && protocol.intervalMonths) {
    nextDueAt = new Date(lastDoneAt);
    nextDueAt.setMonth(nextDueAt.getMonth() + protocol.intervalMonths);
    const now = new Date();
    const dueWindow = new Date(nextDueAt);
    dueWindow.setDate(dueWindow.getDate() - 60);
    if (now >= nextDueAt) status = "OVERDUE";
    else if (now >= dueWindow) status = "DUE";
    else status = "UPCOMING";
  } else if (lastDoneAt && !protocol.intervalMonths) {
    status = "COMPLETED";
  }

  const orgNames: Record<string, { ar: string; en: string }> = {
    USPSTF: { ar: "فريق العمل الوقائي الأمريكي USPSTF", en: "the US Preventive Services Task Force (USPSTF)" },
    WHO: { ar: "منظمة الصحة العالمية WHO", en: "the World Health Organization (WHO)" },
    IARC: { ar: "الوكالة الدولية لأبحاث السرطان IARC", en: "the International Agency for Research on Cancer (IARC)" },
    MOH_EG: { ar: "وزارة الصحة المصرية", en: "the Egyptian Ministry of Health" },
    ACS: { ar: "الجمعية الأمريكية للسرطان ACS", en: "the American Cancer Society (ACS)" },
    NICE: { ar: "المعهد الوطني البريطاني NICE", en: "the UK National Institute for Health and Care Excellence (NICE)" },
  };
  const org = orgNames[protocol.sourceOrg] || { ar: protocol.sourceOrg, en: protocol.sourceOrg };
  let reasonAr: string;
  let reasonEn: string;
  if (eligible) {
    const intervalAr = protocol.intervalMonths ? `المدى الزمني المعتمد: كل ${protocol.intervalMonths} شهرًا.` : "فحص يُجرى مرة واحدة وفق الإرشاد.";
    reasonAr =
      `بناءً على عمرك (${p.age} سنة)${p.gender === "FEMALE" ? " وجنسك (أنثى)" : p.gender === "MALE" ? " وجنسك (ذكر)" : ""}` +
      (protocol.requiresRisk ? " وعوامل خطورتك" : "") +
      `، توصي إرشادات ${org.ar} (إصدار ${protocol.guidelineVersion} — ${protocol.guidelineDate}) بهذا الفحص. ${intervalAr}` +
      (protocol.doctorDiscussion ? " هذا الفحص قرار طبي مشترك يُناقش مع طبيبك قبل اتخاذه." : "") +
      (reasonsAr.length ? ` ${reasonsAr.join(" ")}` : "");
    reasonEn =
      `Based on your age (${p.age})${p.gender === "FEMALE" ? " and sex (female)" : p.gender === "MALE" ? " and sex (male)" : ""}` +
      (protocol.requiresRisk ? " and your risk factors" : "") +
      `, ${org.en} guidelines (version ${protocol.guidelineVersion} — ${protocol.guidelineDate}) recommend this screening. ` +
      (protocol.intervalMonths ? `Approved interval: every ${protocol.intervalMonths} months.` : "One-time screening per the guideline.") +
      (protocol.doctorDiscussion ? " This is a shared decision to discuss with your doctor." : "") +
      (reasonsEn.length ? ` ${reasonsEn.join(" ")}` : "");
  } else {
    reasonAr = `لا نوصي بهذا الفحص لك حاليًا. ${reasonsAr.join(" ")} هذه الفئات للتنظيم الأولي وليست أوامر إجراء تحاليل، والقرار النهائي للطبيب.`;
    reasonEn = `We do not recommend this screening for you now. ${reasonsEn.join(" ")} The final decision belongs to your doctor.`;
  }

  return { key: protocol.key, eligible, status, lastDoneAt, nextDueAt, reasonAr, reasonEn, metRiskFactors };
}

// ---------------- عوامل الخطورة — عوامل فقط بلا درجات ولا نسب ----------------
export interface RiskFactorItem {
  key: string;
  labelAr: string;
  labelEn: string;
  whyAr: string;
  whyEn: string;
}

export const CHRONIC_CONDITION_KEYS: Array<{ key: string; ar: string; en: string }> = [
  { key: "DIABETES", ar: "السكري", en: "Diabetes" },
  { key: "PREDIABETES", ar: "ما قبل السكري", en: "Prediabetes" },
  { key: "HYPERTENSION", ar: "ارتفاع ضغط الدم", en: "Hypertension" },
  { key: "DYSLIPIDEMIA", ar: "ارتفاع الدهون", en: "Dyslipidemia" },
  { key: "HEART_DISEASE", ar: "أمراض القلب", en: "Heart disease" },
  { key: "CKD", ar: "أمراض الكلى المزمنة", en: "Chronic kidney disease" },
  { key: "THYROID", ar: "أمراض الغدة الدرقية", en: "Thyroid disorders" },
  { key: "OSTEOPOROSIS", ar: "هشاشة العظام", en: "Osteoporosis" },
  { key: "ASTHMA", ar: "الربو", en: "Asthma" },
  { key: "CANCER", ar: "السرطان", en: "Cancer" },
  { key: "LIVER_DISEASE", ar: "أمراض الكبد", en: "Liver disease" },
  { key: "OTHER", ar: "أخرى", en: "Other" },
];

export const FAMILY_HISTORY_KEYS: Array<{ key: string; ar: string; en: string }> = [
  { key: "BREAST_CANCER", ar: "سرطان الثدي", en: "Breast cancer" },
  { key: "COLORECTAL_CANCER", ar: "سرطان القولون", en: "Colorectal cancer" },
  { key: "PROSTATE_CANCER", ar: "سرطان البروستاتا", en: "Prostate cancer" },
  { key: "LUNG_CANCER", ar: "سرطان الرئة", en: "Lung cancer" },
  { key: "ANY_CANCER", ar: "سرطان (نوع غير محدد)", en: "Cancer (unspecified)" },
  { key: "DIABETES", ar: "السكري", en: "Diabetes" },
  { key: "HEART_DISEASE", ar: "أمراض القلب", en: "Heart disease" },
  { key: "HYPERTENSION", ar: "ارتفاع ضغط الدم", en: "Hypertension" },
  { key: "OSTEOPOROSIS", ar: "هشاشة العظام", en: "Osteoporosis" },
];

export const RELATIONS: Array<{ key: string; ar: string; en: string }> = [
  { key: "MOTHER", ar: "الأم", en: "Mother" },
  { key: "FATHER", ar: "الأب", en: "Father" },
  { key: "BROTHER", ar: "أخ", en: "Brother" },
  { key: "SISTER", ar: "أخت", en: "Sister" },
  { key: "GRANDPARENT", ar: "جد/جدة", en: "Grandparent" },
];

export const GOVERNORATES: string[] = [
  "القاهرة", "الجيزة", "الإسكندرية", "القليوبية", "سوهاج", "أسيوط", "المنيا", "الفيوم", "بني سويف",
  "أسوان", "الأقصر", "قنا", "البحر الأحمر", "الوادي الجديد", "مطروح", "البحيرة", "كفر الشيخ",
  "الغربية", "المنوفية", "الدقهلية", "الشرقية", "الإسماعيلية", "بورسعيد", "السويس", "الساحل الشمالي", "شمال سيناء", "جنوب سيناء",
];

function condLabel(key: string): { ar: string; en: string } | null {
  const c = CHRONIC_CONDITION_KEYS.find((x) => x.key === key);
  return c ? { ar: c.ar, en: c.en } : null;
}

function famLabel(key: string): { ar: string; en: string } | null {
  const c = FAMILY_HISTORY_KEYS.find((x) => x.key === key);
  return c ? { ar: c.ar, en: c.en } : null;
}

export function extractRiskFactors(p: EngineProfileInput): RiskFactorItem[] {
  const factors: RiskFactorItem[] = [];

  for (const key of p.chronicConditions) {
    if (key === "OTHER") continue;
    const label = condLabel(key);
    if (!label) continue;
    factors.push({
      key: `CHRONIC_${key}`,
      labelAr: `حالة مزمنة: ${label.ar}`,
      labelEn: `Chronic condition: ${label.en}`,
      whyAr: "وجود مرض مزمن قد يجعل بعض فحوصات المتابعة الدورية مناسبة لك — وفق الإرشاد المعتمد.",
      whyEn: "A chronic condition may make certain periodic monitoring tests appropriate — per approved guidelines.",
    });
  }

  for (const f of p.familyHistory) {
    const label = famLabel(f.condition);
    if (!label) continue;
    factors.push({
      key: `FAMILY_${f.condition}`,
      labelAr: `تاريخ عائلي: ${label.ar}`,
      labelEn: `Family history: ${label.en}`,
      whyAr: "التاريخ العائلي لأمراض معينة عامل يؤثر في توصيات الكشف المبكر وفق الإرشادات.",
      whyEn: "Family history of certain conditions is a factor in early-detection recommendations.",
    });
  }

  if (p.smokingStatus === "CURRENT") {
    factors.push({
      key: "SMOKING",
      labelAr: "تدخين حالي",
      labelEn: "Current smoker",
      whyAr: "التدخين عامل مؤثر في أهلية بعض فحوصات الكشف المبكر (مثل فحص الرئة للمدخنين بكثافة).",
      whyEn: "Smoking affects eligibility for certain early-detection screenings.",
    });
  } else if (p.smokingStatus === "FORMER") {
    factors.push({
      key: "SMOKING_FORMER",
      labelAr: `تدخين سابق (أقلع قبل ${p.quitYearsAgo ?? "—"} سنة)`,
      labelEn: `Former smoker (quit ${p.quitYearsAgo ?? "—"} years ago)`,
      whyAr: "سنوات منذ الإقلاع تُدخل في أهلية بعض الفحوصات، مثل فحص الرئة.",
      whyEn: "Years since quitting are part of eligibility for some screenings, such as lung screening.",
    });
  }

  const bmi = calcBmi(p.heightCm, p.weightKg);
  if (bmi !== null && bmi >= 30) {
    factors.push({
      key: "OBESITY",
      labelAr: `مؤشر كتلة الجسم: ${bmi.toFixed(1)}`,
      labelEn: `BMI: ${bmi.toFixed(1)}`,
      whyAr: "مؤشر كتلة الجسم 30 فأكثر عامل تُعتد به في إرشادات الوقاية من السكري وأمراض القلب.",
      whyEn: "A BMI of 30 or above is a recognized factor in diabetes and heart prevention guidelines.",
    });
  }

  if (p.bpSystolic !== null && p.bpSystolic >= 130) {
    factors.push({
      key: "BP_HIGH",
      labelAr: `قراءة ضغط انقباضي: ${p.bpSystolic}`,
      labelEn: `Systolic reading: ${p.bpSystolic}`,
      whyAr: "قراءة الضغط تُدخل في أهلية فحوصات القلب والسكري وفق الإرشادات.",
      whyEn: "Blood pressure readings feed eligibility for heart and diabetes screenings.",
    });
  }

  if (p.personalCancerHistory) {
    factors.push({
      key: "PERSONAL_CANCER",
      labelAr: "تاريخ شخصي مع السرطان",
      labelEn: "Personal cancer history",
      whyAr: "هذا العامل يغيّر خطة المتابعة المقررة — وتحددها خطط المتابعة مع طبيبك.",
      whyEn: "This factor changes the appropriate follow-up plan — determined with your doctor.",
    });
  }

  if (p.pregnant) {
    factors.push({
      key: "PREGNANT",
      labelAr: "الحمل",
      labelEn: "Pregnancy",
      whyAr: "الحمل يغير الفحوصات المناسبة وتوقيتها — وتُدار متابعات الحمل مع الطبيب المتابع.",
      whyEn: "Pregnancy changes which tests are appropriate and when.",
    });
  }

  factors.push({
    key: "AGE",
    labelAr: `العمر: ${p.age} سنة`,
    labelEn: `Age: ${p.age}`,
    whyAr: "العمر هو أول ما تُبنى عليه أهلية الفحوصات الوقائية في الإرشادات المعتمدة.",
    whyEn: "Age is the first input guidelines use to determine screening eligibility.",
  });

  if (p.gender) {
    factors.push({
      key: "SEX",
      labelAr: p.gender === "FEMALE" ? "الجنس: أنثى" : "الجنس: ذكر",
      labelEn: p.gender === "FEMALE" ? "Sex: female" : "Sex: male",
      whyAr: "بعض الفحوصات الوقائية تخص الإناث فقط وبعضها يخص الذكور فقط.",
      whyEn: "Some preventive screenings apply to females only, others to males only.",
    });
  }

  return factors;
}
