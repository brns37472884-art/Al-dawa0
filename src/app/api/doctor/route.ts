import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireCapability } from "@/lib/permissions";
import { jsonError, jsonOk } from "@/lib/auth";
import { readJson, logAudit, notify } from "@/lib/api-utils";
import { rateLimit } from "@/lib/rate-limit";
import { recordAndPublish } from "@/lib/events";
import { getSettingNumber } from "@/lib/settings";
import { safeJsonParse } from "@/lib/helpers";

const ACTIVE_STATUSES = ["UPLOADED", "PROCESSING", "EXTRACTED", "CONFIRMED", "CONFIRMED_LAB", "UNDER_REVIEW", "NEEDS_INFO"];

/** GET /api/doctor — صندوق الحالات مرتب بالأهمية: حرج ← تغيّر مهم ← بانتظار رد ← متأخر ← عادي */
export async function GET(req: NextRequest) {
  const user = await requireCapability("doctor:inbox");
  if (user instanceof Response) return user;
  const filter = req.nextUrl.searchParams.get("filter") || "ALL";
  const slaHours = await getSettingNumber("DOCTOR_SLA_HOURS");

  const reviews = await db.doctorReview.findMany({
    where: { doctorId: user.id },
    orderBy: { createdAt: "asc" },
    take: 300,
    include: {
      report: {
        include: {
          owner: { select: { id: true, fullName: true } },
          familyMember: { select: { name: true } },
          values: { select: { flag: true } },
          lab: { select: { name: true } },
        },
      },
    },
  });

  // المرضى المتاحون للمتابعة: DOCTOR_SHARE فقط
  const consented = new Set(
    (await db.consent.findMany({ where: { type: "DOCTOR_SHARE", granted: true }, select: { userId: true } })).map((c) => c.userId)
  );

  const cases = reviews.map((r) => {
    const criticalCount = r.report.values.filter((v) => v.flag.startsWith("CRITICAL")).length;
    const abnormalCount = r.report.values.filter((v) => !["NORMAL", "UNKNOWN"].includes(v.flag)).length;
    const open = r.status !== "COMPLETED";
    const ageHours = (Date.now() - r.createdAt.getTime()) / 3600_000;
    const slaBreached = open && ageHours > slaHours;
    let priority = 4;
    if (open && (criticalCount > 0 || r.urgency === "URGENT")) priority = 0;
    else if (open && r.status === "PENDING" && abnormalCount > 0) priority = 1;
    else if (open && r.status === "NEEDS_INFO") priority = 2;
    else if (slaBreached) priority = 3;
    return {
      reviewId: r.id,
      reportId: r.reportId,
      reportName: r.report.fileName,
      reportType: r.report.reportType,
      reportStatus: r.report.status,
      patientName: r.report.familyMember?.name ?? r.report.owner.fullName,
      patientId: r.report.owner.id,
      labName: r.report.lab?.name ?? r.report.labName,
      testDate: r.report.testDate,
      uploadedAt: r.report.uploadedAt,
      status: r.status,
      urgency: r.urgency,
      abnormalCount,
      criticalCount,
      priority,
      ageHours: Math.floor(ageHours),
      slaBreached,
      needsReview: r.needsReview,
      open,
    };
  });

  const filtered = cases.filter((c) => {
    if (filter === "ALL") return true;
    if (filter === "NEW") return c.status === "PENDING" && c.reportStatus !== "REVIEWED";
    if (filter === "PENDING") return c.open;
    if (filter === "URGENT") return c.urgency === "URGENT" || c.criticalCount > 0;
    if (filter === "IN_REVIEW") return c.status === "IN_REVIEW";
    if (filter === "COMPLETED") return c.status === "COMPLETED";
    return true;
  });
  filtered.sort((a, b) => a.priority - b.priority || a.uploadedAt.getTime() - b.uploadedAt.getTime());

  const openDurations = cases.filter((c) => c.status === "COMPLETED" && c.ageHours < 720).map((c) => c.ageHours);
  const followUpPatients = await db.medicalReport.findMany({
    where: { assignedDoctorId: user.id, ownerUserId: { in: [...consented] } },
    select: { owner: { select: { id: true, fullName: true } }, status: true },
    take: 2000,
  });
  const patientMap = new Map<string, { id: string; name: string; openCases: number }>();
  for (const fr of followUpPatients) {
    const rec = patientMap.get(fr.owner.id) ?? { id: fr.owner.id, name: fr.owner.fullName, openCases: 0 };
    if (ACTIVE_STATUSES.includes(fr.status)) rec.openCases += 1;
    patientMap.set(fr.owner.id, rec);
  }

  return jsonOk({
    cases: filtered,
    summary: {
      assignedPatients: patientMap.size,
      newCases: cases.filter((c) => c.status === "PENDING").length,
      pendingReview: cases.filter((c) => c.status === "PENDING" || c.status === "IN_REVIEW").length,
      urgentCases: cases.filter((c) => c.urgency === "URGENT" || c.criticalCount > 0).length,
      completedReviews: cases.filter((c) => c.status === "COMPLETED").length,
      avgReviewMinutes: openDurations.length ? Math.round((openDurations.reduce((a, b) => a + b, 0) / openDurations.length) * 60) : null,
      lateCases: cases.filter((c) => c.slaBreached).length,
      slaHours,
    },
    followUpPatients: [...patientMap.values()].sort((a, b) => b.openCases - a.openCases).slice(0, 20),
  });
}

/** GET /api/doctor/patient/[id] — ملف متابعة (بشرط DOCTOR_SHARE + حالة مسندة) */
export async function patientFile(doctorId: string, patientId: string) {
  const hasAssigned = await db.medicalReport.findFirst({ where: { assignedDoctorId: doctorId, ownerUserId: patientId } });
  if (!hasAssigned) return null;
  const consent = await db.consent.findUnique({ where: { userId_type: { userId: patientId, type: "DOCTOR_SHARE" } } });
  if (!consent?.granted) return null;
  return db.user.findUnique({
    where: { id: patientId },
    include: { patientProfile: true },
  });
}

/** POST ops: start / complete / request-info / escalate / follow-up-create / follow-up-update / request-lab-correction */
export async function POST(req: NextRequest) {
  const user = await requireCapability("doctor:review");
  if (user instanceof Response) return user;
  const body = await readJson(req);
  const op = String(body?.op ?? "");
  const reportId = String(body?.reportId ?? "");

  const resolveCase = async () => {
    const report = await db.medicalReport.findUnique({ where: { id: reportId } });
    if (!report || report.assignedDoctorId !== user.id) return null;
    const review =
      (await db.doctorReview.findFirst({ where: { reportId, status: { not: "COMPLETED" } }, orderBy: { createdAt: "asc" } })) ??
      (await db.doctorReview.findFirst({ where: { reportId }, orderBy: { createdAt: "desc" } }));
    return { report, review };
  };

  // ---------- start ----------
  if (op === "start") {
    const found = await resolveCase();
    if (!found?.review) return jsonError("NO_REVIEW", 404);
    const { report, review } = found;
    await db.doctorReview.update({ where: { id: review.id }, data: { status: "IN_REVIEW" } });
    const log = safeJsonParse<Array<{ action: string; at: string; note: string }>>(review.log, []);
    log.push({ action: "START_REVIEW", at: new Date().toISOString(), note: "بدأ الطبيب المراجعة" });
    await db.doctorReview.update({ where: { id: review.id }, data: { log: JSON.stringify(log) } });
    await logAudit("REVIEW_START", { req, actorUserId: user.id, actorRole: user.role, entityType: "DoctorReview", entityId: review.id });
    await recordAndPublish({ type: "REVIEW_STATE", reportId, patientId: report.ownerUserId, doctorId: user.id, payload: { status: "IN_REVIEW" } });
    return jsonOk({ ok: true });
  }

  // ---------- complete: رأي الطبيب + خطة المتابعة → يصل العميل فورًا ----------
  if (op === "complete") {
    const found = await resolveCase();
    if (!found?.review) return jsonError("NO_REVIEW", 404);
    const { report, review } = found;
    const notes = String(body?.notes ?? "").trim().slice(0, 3000);
    const recommendation = String(body?.recommendation ?? "").trim().slice(0, 500) || null;
    if (notes.length < 5) return jsonError("INVALID_NOTES", 400);
    const log = safeJsonParse<Array<{ action: string; at: string; note: string }>>(review.log, []);
    log.push({ action: "COMPLETE_REVIEW", at: new Date().toISOString(), note: "اكتملت المراجعة الطبية" });
    await db.$transaction(async (tx) => {
      await tx.doctorReview.update({
        where: { id: review.id },
        data: { status: "COMPLETED", notes, recommendation, needsReview: false, completedAt: new Date(), log: JSON.stringify(log) },
      });
      await tx.medicalReport.update({ where: { id: reportId }, data: { status: "REVIEWED", version: { increment: 1 } } });
      // القيم المراجعة تُعلّم VERIFIED_DOCTOR
      await tx.extractedValue.updateMany({ where: { reportId, verification: { in: ["CONFIRMED_USER", "CORRECTED_USER"] } }, data: { verification: "VERIFIED_DOCTOR" } });
      await tx.domainEvent.create({ data: { type: "REVIEW_STATE", reportId, patientId: report.ownerUserId, doctorId: user.id, version: report.version + 1, payload: JSON.stringify({ status: "REVIEWED" }) } });
    });
    await logAudit("REVIEW_COMPLETE", { req, actorUserId: user.id, actorRole: user.role, entityType: "MedicalReport", entityId: reportId });
    await notify(report.ownerUserId, {
      type: "REVIEW_COMPLETED",
      titleAr: "اكتملت المراجعة الطبية", titleEn: "Medical review completed",
      bodyAr: "راجع الطبيب المشرف نتيجتك ووصل رأيه وخطة المتابعة — افتح التقرير للاطلاع.",
      bodyEn: "The supervising doctor reviewed your result — open the report to see the opinion and follow-up plan.",
      severity: "INFO",
      link: `/app/records/${reportId}`,
    });
    return jsonOk({ ok: true });
  }

  // ---------- request-info ----------
  if (op === "request-info") {
    const found = await resolveCase();
    if (!found?.review) return jsonError("NO_REVIEW", 404);
    const { report, review } = found;
    const message = String(body?.message ?? "").trim().slice(0, 1000);
    if (message.length < 2) return jsonError("INVALID_MESSAGE", 400);
    await db.doctorReview.update({ where: { id: review.id }, data: { status: "NEEDS_INFO", requestedInfo: message } });
    await db.medicalReport.update({ where: { id: reportId }, data: { status: "NEEDS_INFO", version: { increment: 1 } } });
    await logAudit("REVIEW_REQUEST_INFO", { req, actorUserId: user.id, actorRole: user.role, entityType: "MedicalReport", entityId: reportId });
    await notify(report.ownerUserId, {
      type: "INFO_REQUESTED",
      titleAr: "الطبيب طلب معلومات إضافية", titleEn: "The doctor requested more information",
      bodyAr: "راجع طلب الطبيب وأجب من صفحة التقرير لتتمكن المراجعة من المتابعة.",
      bodyEn: "The doctor requested more info — reply from the report page so the review can continue.",
      severity: "WARNING",
      link: `/app/records/${reportId}`,
    });
    await recordAndPublish({ type: "INFO_REQUESTED", reportId, patientId: report.ownerUserId, doctorId: user.id });
    return jsonOk({ ok: true });
  }

  // ---------- escalate ----------
  if (op === "escalate") {
    const found = await resolveCase();
    if (!found?.review) return jsonError("NO_REVIEW", 404);
    const { report, review } = found;
    await db.doctorReview.update({ where: { id: review.id }, data: { status: "ESCALATED", urgency: "URGENT" } });
    await logAudit("REVIEW_ESCALATE", { req, actorUserId: user.id, actorRole: user.role, entityType: "DoctorReview", entityId: review.id });
    await notify(report.ownerUserId, {
      type: "RESULT_ATTENTION",
      titleAr: "تم تصعيد حالتك بأولوية قصوى", titleEn: "Your case was escalated with top priority",
      bodyAr: "صعّد الطبيب حالتك للمراجعة العاجلة. للأعراض الحادة: الإسعاف 123 فورًا.",
      bodyEn: "Your case was escalated for urgent review. For acute symptoms: call emergency 123 immediately.",
      severity: "URGENT",
      link: `/app/records/${reportId}`,
    });
    await recordAndPublish({ type: "REVIEW_STATE", reportId, patientId: report.ownerUserId, doctorId: user.id, payload: { status: "ESCALATED", urgency: "URGENT" } });
    return jsonOk({ ok: true });
  }

  // ---------- follow-up-create: خطة متابعة تتحول لتذكير ----------
  if (op === "follow-up-create") {
    const report = await db.medicalReport.findUnique({ where: { id: reportId }, select: { ownerUserId: true, assignedDoctorId: true } });
    if (!report || report.assignedDoctorId !== user.id) return jsonError("FORBIDDEN", 403);
    const consent = await db.consent.findUnique({ where: { userId_type: { userId: report.ownerUserId, type: "DOCTOR_SHARE" } } });
    if (!consent?.granted) return jsonError("FORBIDDEN", 403);
    if (!(await rateLimit(`followup:${user.id}:${report.ownerUserId}`, 10, 24 * 3600 * 1000))) return jsonError("RATE_LIMITED", 429);
    const titleAr = String(body?.titleAr ?? "").trim().slice(0, 160);
    if (titleAr.length < 3) return jsonError("INVALID_TITLE", 400);
    let dueDate: Date | null = null;
    if (body?.dueDate) {
      dueDate = new Date(String(body.dueDate));
      if (Number.isNaN(dueDate.getTime())) return jsonError("INVALID_DATE", 400);
    }
    const note = String(body?.note ?? "").trim().slice(0, 600) || null;
    const plan = await db.followUpPlan.create({
      data: { patientId: report.ownerUserId, doctorId: user.id, reportId, titleAr, dueDate, note },
    });
    await logAudit("FOLLOW_UP_PLAN_CREATE", { req, actorUserId: user.id, actorRole: user.role, entityType: "FollowUpPlan", entityId: plan.id });
    await notify(report.ownerUserId, {
      type: "SCREENING_REMINDER",
      titleAr: "خطة متابعة جديدة من طبيبك", titleEn: "New follow-up plan from your doctor",
      bodyAr: `حدد طبيبك «${titleAr}» — راجع خطة الفحوصات وتذكيراتها.`,
      bodyEn: `Your doctor set \"${titleAr}\" — check your screening plan and reminders.`,
      severity: "INFO",
      link: "/app/screenings",
    });
    return jsonOk({ id: plan.id }, 201);
  }

  // ---------- follow-up-update ----------
  if (op === "follow-up-update") {
    const id = String(body?.id ?? "");
    const status = String(body?.status ?? "");
    if (!["ACTIVE", "DONE", "CANCELLED"].includes(status)) return jsonError("INVALID_STATUS", 400);
    const plan = await db.followUpPlan.findFirst({ where: { id, doctorId: user.id } });
    if (!plan) return jsonError("NOT_FOUND", 404);
    await db.followUpPlan.update({ where: { id }, data: { status } });
    return jsonOk({ ok: true });
  }

  // ---------- request-lab-correction: الطبيب لا يعدّل نتيجة المعمل بل يطلب تصحيحها ----------
  if (op === "request-lab-correction") {
    const report = await db.medicalReport.findUnique({ where: { id: reportId } });
    if (!report || report.assignedDoctorId !== user.id) return jsonError("FORBIDDEN", 403);
    if (report.source !== "LAB_DIRECT" || !report.labId) return jsonError("NOT_LAB_REPORT", 400);
    const openCount = await db.reportCorrection.count({ where: { reportId, status: "OPEN" } });
    if (openCount >= 3) return jsonError("TOO_MANY_OPEN_CORRECTIONS", 429);
    const field = String(body?.field ?? "");
    if (!["VALUE", "REFERENCE", "DATE", "OTHER"].includes(field)) return jsonError("INVALID_FIELD", 400);
    const details = String(body?.details ?? "").trim().slice(0, 1000);
    if (details.length < 5) return jsonError("INVALID_DETAILS", 400);
    const correction = await db.reportCorrection.create({
      data: { reportId, labId: report.labId, requestedBy: user.id, valueId: body?.valueId ? String(body.valueId) : null, field, details: `طلب من الطبيب: ${details}`, status: "OPEN" },
    });
    await logAudit("DOCTOR_LAB_CORRECTION_REQUEST", { req, actorUserId: user.id, actorRole: user.role, entityType: "ReportCorrection", entityId: correction.id });
    const { notifyLabStaff } = await import("@/lib/safety/flow");
    await notifyLabStaff(report.labId, "CORRECTION");
    await recordAndPublish({ type: "CORRECTION_OPENED", reportId, patientId: report.ownerUserId, labId: report.labId, doctorId: user.id, payload: { by: "DOCTOR", field } });
    return jsonOk({ id: correction.id }, 201);
  }

  return jsonError("UNKNOWN_OP", 400);
}
