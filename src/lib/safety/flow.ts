// ============================================================
// قواعد الأمان الطبي التنفيذية — تشتغل فورًا، والعاجل لا ينتظر أبدًا.
// القواعد من قاعدة البيانات (APPROVED فقط) — التنبيهات بلا أي قيمة طبية.
// ============================================================
import { db } from "@/lib/db";
import { matchCriticalRule, getApprovedCriticalRules, EMERGENCY_INSTRUCTIONS_AR, EMERGENCY_INSTRUCTIONS_EN } from "@/lib/safety/critical";
import { recordAndPublish } from "@/lib/events";
import { notify, logAudit } from "@/lib/api-utils";
import { notifyResultReady } from "@/lib/notifications";
import { safeJsonParse } from "@/lib/helpers";

/** إشعار موظفي معمل بنتيجة تحتاج مراجعة — بلا قيم */
export async function notifyLabStaff(labId: string, kind: "VERIFY" | "CORRECTION" | "HOLD" | "CRITICAL"): Promise<void> {
  const staff = await db.user.findMany({ where: { labId, isActive: true }, select: { id: true } });
  const copy: Record<string, { titleAr: string; titleEn: string; bodyAr: string; bodyEn: string; severity: "INFO" | "WARNING" | "URGENT" }> = {
    VERIFY: {
      titleAr: "نتيجة جاهزة لمراجعتكم", titleEn: "Result ready for your verification",
      bodyAr: "اكتمل الاستخراج الآلي لنتيجة رفعها المعمل — راجعوا القيم وأكدوها قبل إشعار العميل.",
      bodyEn: "Extraction finished for an uploaded result — verify the values before notifying the client.",
      severity: "INFO",
    },
    CORRECTION: {
      titleAr: "طلب تصحيح جديد", titleEn: "New correction request",
      bodyAr: "وصل طلب تصحيح على إحدى نتائجكم — عالجوه من بوابة المعمل.",
      bodyEn: "A correction request arrived for one of your results — handle it in the lab portal.",
      severity: "WARNING",
    },
    HOLD: {
      titleAr: "تعارضة اسم — الإرسال متوقف", titleEn: "Name mismatch — sending blocked",
      bodyAr: "أُنشئت تعارضة اسم على نتيجة — الإرسال متوقف حتى مراجعة مشرف المعمل.",
      bodyEn: "A name mismatch hold was created — sending is blocked until the lab supervisor reviews.",
      severity: "WARNING",
    },
    CRITICAL: {
      titleAr: "قيمة حرجة في نتيجة رفعتموها", titleEn: "Critical value in an uploaded result",
      bodyAr: "فُعّلت قاعدة قيمة حرجة — اتبعوا بروتوكول الطوارئ لديكم. راجعوا النتيجة في البوابة.",
      bodyEn: "A critical-value rule was triggered — follow your emergency protocol. Review the result in the portal.",
      severity: "URGENT",
    },
  };
  for (const s of staff) {
    await notify(s.id, { type: "LAB_ALERT", ...copy[kind], link: "/lab" });
  }
}

/** إحالة تلقائية لأقل الأطباء عبئًا — التصعيد العاجل لا ينتظر */
export async function ensureDoctorReferral(patientId: string, reportId: string, urgency: "ROUTINE" | "ATTENTION" | "URGENT", reason: string): Promise<void> {
  const existing = await db.doctorReview.findFirst({ where: { reportId, status: { not: "COMPLETED" } } });
  if (existing) return;
  const report = await db.medicalReport.findUnique({ where: { id: reportId }, select: { status: true, assignedDoctorId: true } });
  if (!report) return;
  if (["UNDER_REVIEW", "REVIEWED"].includes(report.status)) return;

  // أقل الأطباء عبئًا (حالات مفتوحة) — بلا أي قيمة طبية في القرار
  const doctors = await db.user.findMany({
    where: { role: "DOCTOR", isActive: true, doctorProfile: { isVerified: true } },
    select: { id: true },
    take: 50,
  });
  if (!doctors.length) return;
  const open = await db.doctorReview.groupBy({
    by: ["doctorId"],
    where: { doctorId: { in: doctors.map((d) => d.id) }, status: { not: "COMPLETED" } },
    _count: { doctorId: true },
  });
  const loadMap = new Map(open.map((o) => [o.doctorId, o._count.doctorId]));
  const doctorId = doctors.sort((a, b) => (loadMap.get(a.id) ?? 0) - (loadMap.get(b.id) ?? 0))[0].id;

  await db.$transaction(async (tx) => {
    await tx.doctorReview.create({
      data: {
        reportId,
        doctorId,
        status: "PENDING",
        urgency,
        log: JSON.stringify([{ action: urgency === "URGENT" ? "AUTO_ESCALATED" : "AUTO_REFERRED", at: new Date().toISOString(), note: reason }]),
      },
    });
    await tx.medicalReport.update({ where: { id: reportId }, data: { assignedDoctorId: doctorId, status: "UNDER_REVIEW", version: { increment: 1 } } });
    await tx.domainEvent.create({
      data: { type: "REVIEW_STATE", reportId, patientId, doctorId, version: 1, payload: JSON.stringify({ status: "PENDING", urgency }) },
    });
  });
}

/** فحص الأمان الفوري — يعمل بعد الاستخراج وبعد التأكيد مباشرة */
export async function runImmediateSafetyCheck(reportId: string): Promise<void> {
  const report = await db.medicalReport.findUnique({
    where: { id: reportId },
    include: { values: true, lab: { select: { id: true, name: true } } },
  });
  if (!report) return;
  const approved = await getApprovedCriticalRules();
  for (const v of report.values) {
    if (!v.canonicalKey || v.value === null) continue;
    const rule = await matchCriticalRule(v.canonicalKey, v.value, approved);
    if (!rule) continue;

    const flag = rule.op === ">" ? "CRITICAL_HIGH" : "CRITICAL_LOW";
    if (v.flag !== flag) {
      await db.extractedValue.update({ where: { id: v.id }, data: { flag } });
    }
    // إزالة التكرار: تنبيه مفتوح واحد لكل (مريض + قاعدة + تقرير)
    const dup = await db.criticalAlert.findFirst({
      where: { userId: report.ownerUserId, ruleKey: rule.key, reportId: report.id, status: "OPEN" },
    });
    if (dup) continue;

    await db.criticalAlert.create({
      data: {
        userId: report.ownerUserId,
        reportId: report.id,
        extractedValueId: v.id,
        ruleKey: rule.key,
        severity: rule.severity,
        messageAr: `${rule.messageAr} ${EMERGENCY_INSTRUCTIONS_AR}`,
        messageEn: `${rule.messageEn} ${EMERGENCY_INSTRUCTIONS_EN}`,
      },
    });
    // إشعار العميل — بلا أي قيمة طبية، مع الإسعاف 123
    await notifyResultReady(report.ownerUserId, `/app/records/${report.id}`, "URGENT");
    // إشعار المعمل — بلا قيم
    if (report.labId) await notifyLabStaff(report.labId, "CRITICAL");
    await logAudit("CRITICAL_RULE_TRIGGERED", {
      actorRole: "SYSTEM",
      entityType: "MedicalReport",
      entityId: report.id,
      meta: { ruleKey: rule.key, severity: rule.severity },
    });
    await recordAndPublish({ type: "CRITICAL_FLAG", reportId: report.id, patientId: report.ownerUserId, labId: report.labId });
    await ensureDoctorReferral(report.ownerUserId, report.id, "URGENT", "تصعيد تلقائي بواسطة قاعدة قيمة حرجة معتمدة");
  }
}

/** مقارنة القيم مع التقرير السابق — نفس المفتاح ونفس الوحدة فقط */
export function compareValues(
  current: Array<{ canonicalKey: string | null; value: number | null; unit: string | null; testDate: Date | null }>,
  previous: Array<{ canonicalKey: string | null; value: number | null; unit: string | null; testDate: Date | null }>
): Array<{ key: string; prev: number; last: number; unit: string | null; deltaPct: number; direction: "UP" | "DOWN" | "FLAT" }> {
  const out: Array<{ key: string; prev: number; last: number; unit: string | null; deltaPct: number; direction: "UP" | "DOWN" | "FLAT" }> = [];
  const prevMap = new Map<string, { value: number; unit: string | null; date: Date }>();
  for (const p of previous) {
    if (!p.canonicalKey || p.value === null) continue;
    const d = p.testDate ?? new Date(0);
    const ex = prevMap.get(p.canonicalKey);
    if (!ex || d > ex.date) prevMap.set(p.canonicalKey, { value: p.value, unit: p.unit, date: d });
  }
  for (const c of current) {
    if (!c.canonicalKey || c.value === null) continue;
    const prev = prevMap.get(c.canonicalKey);
    if (!prev) continue;
    if ((c.unit ?? "").trim().toLowerCase() !== (prev.unit ?? "").trim().toLowerCase()) continue; // نفس الوحدة فقط
    const deltaPct: number = prev.value === 0 ? 0 : Math.abs((c.value - prev.value) / prev.value) * 100;
    const direction: "UP" | "DOWN" | "FLAT" = c.value > prev.value ? "UP" : c.value < prev.value ? "DOWN" : "FLAT";
    out.push({ key: c.canonicalKey, prev: prev.value, last: c.value, unit: c.unit, deltaPct, direction });
  }
  return out;
}

/** إشعار الطبيب عند تغيّر مهم — عدّاد فقط بلا قيم */
export async function notifyDoctorOnMeaningfulChange(reportId: string): Promise<void> {
  const report = await db.medicalReport.findUnique({ where: { id: reportId }, select: { assignedDoctorId: true, ownerUserId: true, familyMemberId: true } });
  if (!report?.assignedDoctorId) return;
  const consent = await db.consent.findUnique({ where: { userId_type: { userId: report.ownerUserId, type: "DOCTOR_SHARE" } } });
  if (!consent?.granted) return;
  const current = await db.extractedValue.findMany({ where: { reportId } });
  const prevReports = await db.medicalReport.findMany({
    where: {
      ownerUserId: report.ownerUserId,
      familyMemberId: report.familyMemberId,
      id: { not: reportId },
      status: { in: ["CONFIRMED", "CONFIRMED_LAB", "UNDER_REVIEW", "REVIEWED"] },
    },
    include: { values: true },
    orderBy: { uploadedAt: "desc" },
    take: 5,
  });
  const prev = prevReports.flatMap((r) => r.values.map((v) => ({ canonicalKey: v.canonicalKey, value: v.value, unit: v.unit, testDate: v.testDate })));
  const comparisons = compareValues(
    current.map((v) => ({ canonicalKey: v.canonicalKey, value: v.value, unit: v.unit, testDate: v.testDate })),
    prev
  );
  const meaningful = comparisons.filter((c) => c.deltaPct >= 15);
  if (!meaningful.length) return;
  const doctor = await db.user.findUnique({ where: { id: report.assignedDoctorId }, select: { id: true } });
  if (!doctor) return;
  await notify(doctor.id, {
    type: "RESULT_ATTENTION",
    titleAr: "تغيّر مهم في نتائج أحد عملائك",
    titleEn: "Significant change in a client's results",
    bodyAr: `وصلت نتيجة جديدة فيها ${meaningful.length} مؤشرًا بتغير ذو معنى — راجع الحالة في صندوقك.`,
    bodyEn: `A new result arrived with ${meaningful.length} meaningful indicator change(s) — review the case in your inbox.`,
    severity: "WARNING",
    link: "/doctor",
  });
  await logAudit("FOLLOWUP_MEANINGFUL_CHANGE_NOTIFY", { actorRole: "SYSTEM", entityId: reportId, meta: { meaningfulCount: meaningful.length } });
}

/** تحويل خطة الطبيب لتذكير */
export async function reminderFromFollowUpPlan(planId: string): Promise<void> {
  const plan = await db.followUpPlan.findUnique({ where: { id: planId }, include: { patient: { select: { id: true, isActive: true } } } });
  if (!plan || !plan.patient.isActive || !plan.dueDate) return;
  const { notify } = await import("@/lib/api-utils");
  await notify(plan.patientId, {
    type: "FOLLOWUP",
    titleAr: "تذكير بموعد فحص المتابعة",
    titleEn: "Follow-up test reminder",
    bodyAr: `طبيبك حدد «${plan.titleAr}» — راجع خطة الفحوصات لموعد الفحص الجاي.`,
    bodyEn: `Your doctor set \"${plan.titleAr}\" — check your screening plan for the next date.`,
    severity: "INFO",
    link: "/app/screenings",
  });
}

export { safeJsonParse };
