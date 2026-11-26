import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireCapability } from "@/lib/permissions";
import { jsonError, jsonOk } from "@/lib/auth";
import { readJson, logAudit } from "@/lib/api-utils";
import { recordAndPublish } from "@/lib/events";
import { runImmediateSafetyCheck, ensureDoctorReferral } from "@/lib/safety/flow";
import { referralDecision } from "@/lib/safety/critical";

/** ACL: العميل مالكه، الطبيب المسند له، الإدارة أرقام فقط (لا محتوى) */
async function canAccess(userId: string, role: string, reportId: string) {
  const report = await db.medicalReport.findUnique({ where: { id: reportId } });
  if (!report) return { report: null };
  if (role === "PATIENT" && report.ownerUserId === userId) return { report };
  if (role === "DOCTOR" && (report.assignedDoctorId === userId)) return { report };
  const review = role === "DOCTOR" ? await db.doctorReview.findFirst({ where: { reportId, doctorId: userId } }) : null;
  if (review) return { report };
  return { report: null };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireCapability("patient:self");
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const { report } = await canAccess(user.id, user.role, id);
  if (!report) return jsonError("NOT_FOUND", 404);

  // أول فتح للعميل — مؤشر الشبكة للمعمل
  if (report.ownerUserId === user.id && !report.patientOpenedAt) {
    await db.medicalReport.update({ where: { id }, data: { patientOpenedAt: new Date() } });
    await recordAndPublish({ type: "REPORT_OPENED", reportId: id, patientId: user.id, labId: report.labId });
  }

  const values = await db.extractedValue.findMany({ where: { reportId: id }, orderBy: { createdAt: "asc" } });
  const review = await db.doctorReview.findFirst({
    where: { reportId: id },
    orderBy: { createdAt: "desc" },
    include: { doctor: { select: { fullName: true } } },
  });
  const corrections = await db.reportCorrection.findMany({
    where: { reportId: id },
    orderBy: { createdAt: "desc" },
    include: { lab: { select: { name: true } } },
  });
  const versions = await db.reportVersion.findMany({ where: { reportId: id }, orderBy: { version: "desc" } });

  // مقارنة بالسابق — نفس الوحدة فقط
  const prevReports = await db.medicalReport.findMany({
    where: {
      ownerUserId: report.ownerUserId,
      familyMemberId: report.familyMemberId,
      id: { not: id },
      status: { in: ["CONFIRMED", "CONFIRMED_LAB", "UNDER_REVIEW", "REVIEWED"] },
    },
    include: { values: true },
    orderBy: { uploadedAt: "desc" },
    take: 5,
  });
  const prevMap = new Map<string, { value: number; unit: string; date: Date; reportId: string }>();
  for (const pr of prevReports) {
    for (const v of pr.values) {
      if (!v.canonicalKey || v.value === null) continue;
      const d = v.testDate ?? pr.uploadedAt;
      if (!prevMap.has(v.canonicalKey) || d > (prevMap.get(v.canonicalKey)!.date)) {
        prevMap.set(v.canonicalKey, { value: v.value, unit: v.unit ?? "", date: d, reportId: pr.id });
      }
    }
  }
  const comparisons = values
    .filter((v) => v.canonicalKey && v.value !== null && prevMap.has(v.canonicalKey))
    .map((v) => {
      const prev = prevMap.get(v.canonicalKey!)!;
      if ((v.unit ?? "").toLowerCase() !== prev.unit.toLowerCase()) return null;
      const deltaPct = prev.value === 0 ? 0 : ((v.value! - prev.value) / prev.value) * 100;
      return { key: v.canonicalKey, name: v.rawName, unit: v.unit, prev: prev.value, last: v.value, deltaPct, direction: v.value! > prev.value ? "UP" : v.value! < prev.value ? "DOWN" : "FLAT", meaningful: Math.abs(deltaPct) >= 15 };
    })
    .filter(Boolean);

  const extractionMeta = (() => {
    try {
      return JSON.parse(report.extractionMeta);
    } catch {
      return {};
    }
  })();

  return jsonOk({
    report: {
      id: report.id,
      fileName: report.fileName,
      fileType: report.fileType,
      reportType: report.reportType,
      status: report.status,
      labName: report.labName,
      labReportNo: report.labReportNo,
      testDate: report.testDate,
      issuedAt: report.issuedAt,
      notes: report.notes,
      source: report.source,
      currentVersion: report.currentVersion,
      demo: report.demo,
      uploadedAt: report.uploadedAt,
      labVerifiedAt: report.labVerifiedAt,
      labVerified: values.some((v) => v.verification === "VERIFIED_LAB" || v.verification === "CORRECTED_LAB"),
      extractionMeta,
      ownerName: report.ownerUserId === user.id ? null : undefined,
    },
    values,
    review: review
      ? {
          id: review.id,
          status: review.status,
          urgency: review.urgency,
          notes: review.notes,
          recommendation: review.recommendation,
          requestedInfo: review.requestedInfo,
          needsReview: review.needsReview,
          completedAt: review.completedAt,
          doctorName: review.doctor.fullName,
        }
      : null,
    corrections: corrections.map((c) => ({
      id: c.id, field: c.field, details: c.details, status: c.status, resolution: c.resolution,
      oldValue: c.oldValue, newValue: c.newValue, createdAt: c.createdAt, labName: c.lab.name,
    })),
    versions: versions.map((v) => ({ id: v.id, version: v.version, changeNote: v.changeNote, createdAt: v.createdAt, valuesCount: (() => { try { return (JSON.parse(v.valuesJson) as unknown[]).length; } catch { return 0; } })() })),
    comparisons,
    isOwner: report.ownerUserId === user.id,
  });
}

/** PATCH ops: confirm / reply-info / request-correction */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireCapability("patient:self");
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const { report } = await canAccess(user.id, user.role, id);
  if (!report || report.ownerUserId !== user.id) return jsonError("NOT_FOUND", 404);
  const body = await readJson(req);
  const op = String(body?.op ?? "");

  // ---------- confirm: تأكيد/إقرار ----------
  if (op === "confirm") {
    if (!["UPLOADED", "PROCESSING", "EXTRACTED", "FAILED", "CONFIRMED", "CONFIRMED_LAB", "NEEDS_INFO"].includes(report.status)) {
      return jsonError("INVALID_STATUS", 409, { status: report.status });
    }
    // نتائج المعمل الموثقة: إقرار فقط — لا تعديل قيم
    if (report.source === "LAB_DIRECT") {
      await db.medicalReport.update({ where: { id }, data: { status: "CONFIRMED_LAB", version: { increment: 1 } } });
      await logAudit("REPORT_ACK_LAB", { req, actorUserId: user.id, actorRole: user.role, entityType: "MedicalReport", entityId: id });
      await recordAndPublish({ type: "PATIENT_CONFIRMED", reportId: id, patientId: user.id, labId: report.labId });
      await runImmediateSafetyCheck(id);
      return jsonOk({ status: "CONFIRMED_LAB", acknowledged: true });
    }
    // رفع العميل: تعديل القيم مسموح
    const edits = Array.isArray(body?.values) ? (body.values as Array<{ id: string; value?: unknown; unit?: string; refLow?: unknown; refHigh?: unknown }>) : [];
    if (edits.length > 200) return jsonError("TOO_MANY_EDITS", 400);
    for (const e of edits) {
      const v = await db.extractedValue.findFirst({ where: { id: String(e.id), reportId: id } });
      if (!v) continue;
      const data: Record<string, unknown> = {};
      if (e.value !== undefined) {
        const n = e.value === null || e.value === "" ? null : Number(e.value);
        if (n !== null && !Number.isFinite(n)) return jsonError("INVALID_VALUE", 400, { field: "value" });
        data.value = n;
      }
      if (e.unit !== undefined) data.unit = String(e.unit).slice(0, 30) || null;
      if (e.refLow !== undefined) data.refLow = e.refLow === null || e.refLow === "" ? null : Number(e.refLow);
      if (e.refHigh !== undefined) data.refHigh = e.refHigh === null || e.refHigh === "" ? null : Number(e.refHigh);
      const changed = Object.keys(data).length > 0;
      const value = (data.value ?? v.value) as number | null;
      const refLow = (data.refLow ?? v.refLow) as number | null;
      const refHigh = (data.refHigh ?? v.refHigh) as number | null;
      let flag = v.flag;
      if (value !== null && refLow !== null && refHigh !== null) {
        flag = value > refHigh ? "HIGH" : value < refLow ? "LOW" : "NORMAL";
      }
      await db.extractedValue.update({
        where: { id: v.id },
        data: { ...data, flag, verification: changed ? "CORRECTED_USER" : "CONFIRMED_USER", confirmedAt: new Date() },
      });
    }
    await db.medicalReport.update({ where: { id }, data: { status: "CONFIRMED", version: { increment: 1 } } });
    await logAudit("REPORT_CONFIRM", { req, actorUserId: user.id, actorRole: user.role, entityType: "MedicalReport", entityId: id, meta: { edits: edits.length } });
    await recordAndPublish({ type: "PATIENT_CONFIRMED", reportId: id, patientId: user.id });
    await runImmediateSafetyCheck(id);
    const valuesNow = await db.extractedValue.findMany({ where: { reportId: id } });
    const referral = referralDecision(valuesNow.map((v) => ({ flag: v.flag, critical: v.flag.startsWith("CRITICAL") })));
    if (referral.refer) {
      await ensureDoctorReferral(user.id, id, referral.urgency, referral.urgency === "URGENT" ? "إحالة تلقائية: قيمة حرجة" : "إحالة تلقائية: قيم غير طبيعية");
    }
    return jsonOk({ status: "CONFIRMED", referral });
  }

  // ---------- reply-info: رد على طلب معلومات ----------
  if (op === "reply-info") {
    const message = String(body?.message ?? "").trim().slice(0, 1000);
    if (message.length < 2) return jsonError("INVALID_MESSAGE", 400);
    const review = await db.doctorReview.findFirst({ where: { reportId: id, status: "NEEDS_INFO" } });
    if (!review) return jsonError("NO_PENDING_INFO_REQUEST", 409);
    const ts = new Date().toISOString();
    await db.medicalReport.update({
      where: { id },
      data: { notes: `${report.notes ? report.notes + "\n" : ""}[رد العميل ${ts}]: ${message}`, status: "UNDER_REVIEW", version: { increment: 1 } },
    });
    const log = (() => {
      try {
        return JSON.parse(review.log) as Array<{ action: string; at: string; note: string }>;
      } catch {
        return [];
      }
    })();
    log.push({ action: "PATIENT_REPLIED", at: ts, note: "رد العميل على طلب المعلومات" });
    await db.doctorReview.update({ where: { id: review.id }, data: { status: "PENDING", log: JSON.stringify(log) } });
    await recordAndPublish({ type: "REVIEW_STATE", reportId: id, patientId: user.id, doctorId: review.doctorId, payload: { status: "PATIENT_REPLIED" } });
    return jsonOk({ ok: true });
  }

  // ---------- request-correction: طلب تصحيح من المعمل ----------
  if (op === "request-correction") {
    if (report.source !== "LAB_DIRECT" || !report.labId) return jsonError("NOT_LAB_REPORT", 400);
    const field = String(body?.field ?? "");
    if (!["VALUE", "REFERENCE", "DATE", "OTHER"].includes(field)) return jsonError("INVALID_FIELD", 400);
    const details = String(body?.details ?? "").trim().slice(0, 1000);
    if (details.length < 5) return jsonError("INVALID_DETAILS", 400);
    const openCount = await db.reportCorrection.count({ where: { reportId: id, status: "OPEN", requestedBy: user.id } });
    if (openCount >= 3) return jsonError("TOO_MANY_OPEN_REQUESTS", 429);
    const correction = await db.reportCorrection.create({
      data: { reportId: id, labId: report.labId, requestedBy: user.id, valueId: body?.valueId ? String(body.valueId) : null, field, details, status: "OPEN" },
    });
    await logAudit("CORRECTION_REQUEST", { req, actorUserId: user.id, actorRole: user.role, entityType: "ReportCorrection", entityId: correction.id });
    await recordAndPublish({ type: "CORRECTION_OPENED", reportId: id, patientId: user.id, labId: report.labId, payload: { by: "PATIENT", field } });
    const { notifyLabStaff } = await import("@/lib/safety/flow");
    await notifyLabStaff(report.labId, "CORRECTION");
    return jsonOk({ id: correction.id }, 201);
  }

  return jsonError("UNKNOWN_OP", 400);
}

/** POST — نسخة أولية عند الرفع الأول (يُستدعى من مسار الرفع) */
export async function POST(_req: NextRequest, _ctx: { params: Promise<{ id: string }> }) {
  return jsonError("UNKNOWN_OP", 400);
}

