// ============================================================
// خدمة خطة الفحوصات — تشغيل المحرك على البروتوكولات المعتمدة فقط.
// ============================================================
import { db } from "@/lib/db";
import { evaluateProtocol, extractRiskFactors, RISK_ENGINE_VERSION, type EngineProfileInput } from "@/lib/screening/engine";
import { safeJsonParse, calcAge } from "@/lib/helpers";
import { logAgentRun } from "@/lib/api-utils";

function profileToEngineInput(
  p: {
    gender: string | null;
    smokingStatus: string | null;
    quitYearsAgo: number | null;
    chronicConditions: string;
    familyHistory: string;
    personalCancerHistory: boolean;
    heightCm: number | null;
    weightKg: number | null;
    bpSystolic: number | null;
    bpDiastolic: number | null;
    dateOfBirth: Date | null;
  },
  reproductiveInfo: string,
  lastDone: Record<string, string | null>
): EngineProfileInput | null {
  const age = calcAge(p.dateOfBirth);
  if (age === null) return null;
  const chronic = safeJsonParse<Array<{ key: string }>>(p.chronicConditions, []).map((c) => c.key);
  const family = safeJsonParse<Array<{ condition: string; relation: string }>>(p.familyHistory, []);
  const repro = safeJsonParse<{ pregnant?: boolean }>(reproductiveInfo, {});
  return {
    age,
    gender: p.gender,
    smokingStatus: p.smokingStatus,
    quitYearsAgo: p.quitYearsAgo,
    chronicConditions: chronic,
    familyHistory: family,
    personalCancerHistory: p.personalCancerHistory,
    pregnant: !!repro.pregnant,
    heightCm: p.heightCm,
    weightKg: p.weightKg,
    bpSystolic: p.bpSystolic,
    bpDiastolic: p.bpDiastolic,
    lastDone,
  };
}

function familyToEngineInput(
  m: { dateOfBirth: Date | null; gender: string | null; heightCm: number | null; weightKg: number | null; healthData: string },
  lastDone: Record<string, string | null>
): EngineProfileInput | null {
  const age = calcAge(m.dateOfBirth);
  if (age === null) return null;
  const hd = safeJsonParse<{
    smokingStatus?: string;
    quitYearsAgo?: number;
    chronicConditions?: Array<{ key: string }>;
    familyHistory?: Array<{ condition: string; relation: string }>;
    personalCancerHistory?: boolean;
    bpSystolic?: number;
    bpDiastolic?: number;
  }>(m.healthData, {});
  return {
    age,
    gender: m.gender,
    smokingStatus: hd.smokingStatus ?? null,
    quitYearsAgo: hd.quitYearsAgo ?? null,
    chronicConditions: (hd.chronicConditions ?? []).map((c) => c.key),
    familyHistory: hd.familyHistory ?? [],
    personalCancerHistory: !!hd.personalCancerHistory,
    pregnant: false,
    heightCm: m.heightCm,
    weightKg: m.weightKg,
    bpSystolic: hd.bpSystolic ?? null,
    bpDiastolic: hd.bpDiastolic ?? null,
    lastDone,
  };
}

/** إعادة حساب خطة الفحوصات وحفظها — لا يحتسب إلا active + APPROVED */
export async function recomputePlan(userId: string, familyMemberId: string | null = null): Promise<void> {
  const started = Date.now();
  const protocols = await db.screeningProtocol.findMany({
    where: { active: true, status: "APPROVED" },
  });

  let engineInput: EngineProfileInput | null = null;
  if (familyMemberId) {
    const member = await db.familyMember.findFirst({ where: { id: familyMemberId, ownerUserId: userId } });
    if (!member) return;
    const existing = await db.screeningRecord.findMany({
      where: { userId, familyMemberId },
      select: { protocolId: true, lastDoneAt: true },
    });
    const lastDone: Record<string, string | null> = {};
    for (const r of existing) if (r.lastDoneAt) lastDone[r.protocolId] = r.lastDoneAt.toISOString();
    engineInput = familyToEngineInput(member, lastDone);
  } else {
    const profile = await db.patientProfile.findUnique({ where: { userId } });
    if (!profile) return;
    const existing = await db.screeningRecord.findMany({
      where: { userId, familyMemberId: null },
      select: { protocolId: true, lastDoneAt: true },
    });
    const lastDone: Record<string, string | null> = {};
    for (const r of existing) if (r.lastDoneAt) lastDone[r.protocolId] = r.lastDoneAt.toISOString();
    engineInput = profileToEngineInput(profile, profile.reproductiveInfo, lastDone);
  }
  if (!engineInput) return;

  const slotKey = familyMemberId ?? "main";
  let eligibleCount = 0;
  for (const protocol of protocols) {
    const result = evaluateProtocol(protocol, engineInput);
    if (result.eligible) eligibleCount++;
    await db.screeningRecord.upsert({
      where: { userId_protocolId_slotKey: { userId, protocolId: protocol.id, slotKey } },
      create: {
        userId,
        familyMemberId,
        slotKey,
        protocolId: protocol.id,
        lastDoneAt: result.lastDoneAt,
        demo: false,
        status: result.status,
        eligible: result.eligible,
        nextDueAt: result.nextDueAt,
        reasonAr: result.reasonAr,
        reasonEn: result.reasonEn,
      },
      update: {
        status: result.status,
        eligible: result.eligible,
        nextDueAt: result.nextDueAt,
        reasonAr: result.reasonAr,
        reasonEn: result.reasonEn,
      },
    });
  }

  if (!familyMemberId) {
    const factors = extractRiskFactors(engineInput);
    await db.riskFactorAssessment.upsert({
      where: { userId },
      create: { userId, factors: JSON.stringify(factors), factorsCount: factors.length, engineVersion: RISK_ENGINE_VERSION },
      update: { factors: JSON.stringify(factors), factorsCount: factors.length, engineVersion: RISK_ENGINE_VERSION, computedAt: new Date() },
    });
  }

  await logAgentRun("SCREENING", {
    userId,
    inputSummary: `age=${engineInput.age} gender=${engineInput.gender}`,
    outputSummary: `${protocols.length} protocols evaluated, ${eligibleCount} eligible`,
    durationMs: Date.now() - started,
    meta: { familyMemberId },
  });
}

/** تذكيرات الفحوصات — بلا قيم طبية، نص عام فقط */
export async function generateReminders(userId: string): Promise<void> {
  const { notify } = await import("@/lib/api-utils");
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const recent = await db.notification.findMany({
    where: { userId, type: "SCREENING_REMINDER", createdAt: { gte: weekAgo } },
    select: { link: true },
  });
  const reminded = new Set(recent.map((r) => r.link));
  const due = await db.screeningRecord.findMany({
    where: { userId, status: { in: ["DUE", "OVERDUE"] }, user: { isActive: true } },
    include: { protocol: { select: { titleAr: true, titleEn: true } } },
    take: 3,
    orderBy: { updatedAt: "desc" },
  });
  for (const r of due) {
    const link = "/app/screenings";
    if (reminded.has(link)) continue;
    await notify(userId, {
      type: "SCREENING_REMINDER",
      titleAr: "فحص وقائي مستحق",
      titleEn: "Preventive screening due",
      bodyAr: `حان موعد «${r.protocol.titleAr}» وفق خطتك — راجع خطتك وسجّل الموعد.`,
      bodyEn: `\"${r.protocol.titleEn}\" is due per your plan — check your plan and book.`,
      severity: "WARNING",
      link,
    });
  }
  const pendingReviews = await db.medicalReport.count({ where: { ownerUserId: userId, status: "UNDER_REVIEW" } });
  if (pendingReviews > 0 && !reminded.has("/app/records")) {
    await notify(userId, {
      type: "DOCTOR_REVIEW_WAIT",
      titleAr: "نتيجتك في مراجعة الطبيب",
      titleEn: "Your result is under medical review",
      bodyAr: `لديك ${pendingReviews} نتيجة قيد المراجعة الطبية — سنخطرك فور جاهزية الرأي.`,
      bodyEn: `${pendingReviews} result(s) are under medical review — we'll notify you when the opinion is ready.`,
      severity: "INFO",
      link: "/app/records",
    });
  }
}
