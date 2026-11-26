import { db } from "@/lib/db";
import { requireCapability } from "@/lib/permissions";
import { jsonOk } from "@/lib/auth";
import { safeJsonParse, calcAge, calcBmi } from "@/lib/helpers";
import { generateReminders } from "@/lib/screening/service";

/** GET /api/patient-home — داشبورد العميل بالترتيب الثماني */
export async function GET() {
  const user = await requireCapability("patient:self");
  if (user instanceof Response) return user;

  const profile = await db.patientProfile.findUnique({ where: { userId: user.id } });
  const rf = await db.riskFactorAssessment.findUnique({ where: { userId: user.id } });
  const age = profile?.dateOfBirth ? calcAge(profile.dateOfBirth) : null;
  const bmi = calcBmi(profile?.heightCm, profile?.weightKg);

  // (2) فحوصات قد تكون مؤهلًا — من المعتمد فقط
  const eligible = await db.screeningRecord.findMany({
    where: { userId: user.id, familyMemberId: null, status: { in: ["DUE", "OVERDUE"] } },
    include: { protocol: { select: { titleAr: true, titleEn: true, sourceOrg: true, guidelineVersion: true, guidelineDate: true, approvedAt: true, doctorDiscussion: true } } },
    orderBy: [{ status: "asc" }, { nextDueAt: "asc" }],
    take: 4,
  });

  // (3) ما أتمه
  const completed = await db.screeningRecord.findMany({
    where: { userId: user.id, familyMemberId: null, status: "COMPLETED" },
    include: { protocol: { select: { titleAr: true, titleEn: true } } },
    orderBy: { lastDoneAt: "desc" },
    take: 3,
  });

  // (4) مواعيد قادمة (خطط الطبيب + مستحقات)
  const upcoming = await db.followUpPlan.findMany({
    where: { patientId: user.id, status: "ACTIVE" },
    orderBy: { dueDate: "asc" },
    take: 4,
  });

  // (5) آخر النتائج
  const reports = await db.medicalReport.findMany({
    where: { ownerUserId: user.id, familyMemberId: null },
    orderBy: { uploadedAt: "desc" },
    take: 5,
    select: {
      id: true, fileName: true, reportType: true, status: true, uploadedAt: true, labName: true, testDate: true,
      source: true, currentVersion: true, demo: true,
      values: { select: { flag: true } },
      reviews: { select: { status: true, urgency: true, needsReview: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  // (6) تغيرات المؤشرات — نفس الوحدة فقط، بلا يوم واحد
  const recentValues = await db.extractedValue.findMany({
    where: { report: { ownerUserId: user.id, familyMemberId: null, status: { in: ["EXTRACTED", "CONFIRMED", "CONFIRMED_LAB", "UNDER_REVIEW", "REVIEWED"] } } },
    orderBy: { testDate: "desc" },
    take: 400,
    select: { canonicalKey: true, rawName: true, value: true, unit: true, testDate: true, reportId: true },
  });
  const byKey = new Map<string, Array<{ value: number; unit: string; date: Date }>>();
  for (const v of recentValues) {
    if (!v.canonicalKey || v.value === null) continue;
    const arr = byKey.get(v.canonicalKey) ?? [];
    arr.push({ value: v.value, unit: v.unit ?? "", date: v.testDate ?? new Date(0) });
    byKey.set(v.canonicalKey, arr);
  }
  const changes: Array<{ key: string; nameAr: string; nameEn: string; unit: string; prev: number; last: number; prevDate: string; lastDate: string; direction: "UP" | "DOWN" | "FLAT" }> = [];
  for (const [key, arr] of byKey) {
    if (arr.length < 2) continue;
    const sorted = arr.sort((a, b) => b.date.getTime() - a.date.getTime());
    const last = sorted[0];
    const prev = sorted[1];
    if (last.unit.toLowerCase() !== prev.unit.toLowerCase()) continue;
    if ((last.date.getTime() - prev.date.getTime()) < 20 * 3600 * 1000) continue; // نفس اليوم تقريبًا
    changes.push({
      key,
      nameAr: recentValues.find((v) => v.canonicalKey === key)?.rawName ?? key,
      nameEn: key,
      unit: last.unit,
      prev: prev.value,
      last: last.value,
      prevDate: prev.date.toISOString(),
      lastDate: last.date.toISOString(),
      direction: last.value > prev.value ? "UP" : last.value < prev.value ? "DOWN" : "FLAT",
    });
    if (changes.length >= 4) break;
  }

  // (7) التنبيهات
  const alerts = await db.criticalAlert.findMany({
    where: { userId: user.id, status: "OPEN" },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  // (8) بانتظار مراجعة الطبيب
  const pendingReviews = await db.medicalReport.findMany({
    where: { ownerUserId: user.id, status: { in: ["UNDER_REVIEW", "NEEDS_INFO"] } },
    orderBy: { uploadedAt: "desc" },
    take: 4,
    select: { id: true, fileName: true, status: true, uploadedAt: true },
  });

  const completionFields = profile ? { ...profile } : null;
  void completionFields;
  const completion = profile
    ? Math.round(
        ([profile.dateOfBirth, profile.gender, profile.gov, profile.heightCm, profile.weightKg, profile.bpSystolic, profile.chronicConditions, profile.medications, profile.allergies, profile.familyHistory, profile.smokingStatus].filter(
          (v) => v !== null && v !== undefined && v !== "" && v !== "[]" && v !== "{}"
        ).length /
          11) *
          100
      )
    : 0;

  // حدث الاشتراك (بعد المعالجة)
  await generateReminders(user.id).catch(() => {});

  return jsonOk({
    completion: { percent: completion, missing: [] as string[] },
    profileSummary: { age, gender: profile?.gender ?? null, bmi, chronicCount: safeJsonParse<Array<unknown>>(profile?.chronicConditions ?? "[]", []).length, medsCount: safeJsonParse<string[]>(profile?.medications ?? "[]", []).length, name: user.fullName },
    riskFactors: rf ? safeJsonParse<Array<{ key: string; labelAr: string; labelEn: string; whyAr: string; whyEn: string }>>(rf.factors, []).slice(0, 8) : [],
    eligible: eligible.map((e) => ({
      id: e.id,
      status: e.status,
      nextDueAt: e.nextDueAt,
      reasonAr: e.reasonAr,
      reasonEn: e.reasonEn,
      protocol: { key: e.protocol.titleAr, titleAr: e.protocol.titleAr, titleEn: e.protocol.titleEn, sourceOrg: e.protocol.sourceOrg, guidelineVersion: e.protocol.guidelineVersion, guidelineDate: e.protocol.guidelineDate, approvedAt: e.protocol.approvedAt, doctorDiscussion: e.protocol.doctorDiscussion },
    })),
    completed: completed.map((c) => ({ id: c.id, lastDoneAt: c.lastDoneAt, titleAr: c.protocol.titleAr, titleEn: c.protocol.titleEn })),
    upcoming,
    reports: reports.map((r) => ({
      id: r.id,
      fileName: r.fileName,
      reportType: r.reportType,
      status: r.status,
      uploadedAt: r.uploadedAt,
      labName: r.labName,
      testDate: r.testDate,
      source: r.source,
      currentVersion: r.currentVersion,
      demo: r.demo,
      valuesCount: r.values.length,
      abnormalCount: r.values.filter((v) => !["NORMAL", "UNKNOWN"].includes(v.flag)).length,
      review: r.reviews[0] ?? null,
    })),
    changes,
    alerts: alerts.map((a) => ({ id: a.id, severity: a.severity, messageAr: a.messageAr, messageEn: a.messageEn, reportId: a.reportId, createdAt: a.createdAt })),
    pendingReviews,
  });
}
