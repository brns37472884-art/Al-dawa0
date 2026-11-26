import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireLab } from "@/lib/permissions";
import { jsonError, jsonOk } from "@/lib/auth";
import { readJson, logAudit } from "@/lib/api-utils";
import { recordAndPublish, EventRecorder } from "@/lib/events";
import { runImmediateSafetyCheck, notifyDoctorOnMeaningfulChange } from "@/lib/safety/flow";
import { matchCriticalRule } from "@/lib/safety/critical";
import { notifyResultReady } from "@/lib/notifications";
import { createCorrectionVersion } from "@/lib/report-versions";

/** GET /api/lab/results/[id] — قيم تقرير المعمل (من نتائجه فقط — عزل) */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const lab = await requireLab();
  if (lab instanceof Response) return lab;
  const { id } = await ctx.params;
  const report = await db.medicalReport.findFirst({
    where: { id, labId: lab.labId, source: "LAB_DIRECT" },
    include: {
      owner: { select: { fullName: true, phone: true } },
      values: { orderBy: { createdAt: "asc" } },
      corrections: { where: { status: "OPEN" }, select: { id: true } },
      reviews: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, needsReview: true } },
    },
  });
  if (!report) return jsonError("NOT_FOUND", 404);
  return jsonOk({
    report: {
      id: report.id,
      fileName: report.fileName,
      status: report.status,
      uploadedAt: report.uploadedAt,
      testDate: report.testDate,
      patientName: report.owner.fullName,
      phoneMasked: report.owner.phone ? `${report.owner.phone.slice(0, -4)}****` : null,
      openedByPatient: !!report.patientOpenedAt,
      patientOpenedAt: report.patientOpenedAt,
      currentVersion: report.currentVersion,
      labVerifiedAt: report.labVerifiedAt,
    },
    values: report.values,
    reviewStatus: report.reviews[0]?.status ?? null,
    doctorNeedsReview: report.reviews[0]?.needsReview ?? false,
    openCorrections: report.corrections.length,
  });
}

/**
 * POST ops: verify-all / edit-value / resolve-correction
 * verify-all: تأكيد وإرسال — تصل النتيجة للعميل والدكتور في نفس اللحظة.
 * لكن: تعارضة اسم مفتوحة على هذا التقرير → الإرسال متوقف (HOLD_BLOCKED).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const lab = await requireLab();
  if (lab instanceof Response) return lab;
  const { id } = await ctx.params;
  const report = await db.medicalReport.findFirst({
    where: { id, labId: lab.labId, source: "LAB_DIRECT" },
    include: { owner: { select: { id: true, phone: true, locale: true } }, lab: { select: { name: true } } },
  });
  if (!report) return jsonError("NOT_FOUND", 404);
  const body = await readJson(req);
  const op = String(body?.op ?? "");

  // ---------- verify-all: تأكيد القيم وإشعار العميل ----------
  if (op === "verify-all") {
    const values = await db.extractedValue.findMany({ where: { reportId: id } });
    if (!values.length) return jsonError("NO_VALUES", 400);
    // منع الغلط: تعارضة اسم مفتوحة توقف الإرسال
    const openHold = await db.identityHold.findFirst({ where: { reportId: id, status: "OPEN" } });
    if (openHold) return jsonError("HOLD_BLOCKED", 409, { holdId: openHold.id });
    // منع الغلط 2: سحب موافقة استلام النتائج → يتوقف الاستقبال فورًا
    const consent = await db.consent.findUnique({ where: { userId_type: { userId: report.ownerUserId, type: "LAB_RESULT_SHARING" } } });
    if (!consent?.granted) return jsonError("CONSENT_WITHDRAWN", 409);

    const recorder = new EventRecorder();
    await db.$transaction(async (tx) => {
      for (const v of values) {
        if (v.verification !== "CORRECTED_LAB") {
          await tx.extractedValue.update({ where: { id: v.id }, data: { verification: "VERIFIED_LAB" } });
        }
      }
      await tx.medicalReport.update({
        where: { id },
        data: { status: "CONFIRMED_LAB", labVerifiedById: lab.user.id, labVerifiedAt: new Date(), deliveredAt: new Date(), version: { increment: 1 } },
      });
      recorder.bind(tx);
      await recorder.add({ type: "REPORT_CONFIRMED", reportId: id, patientId: report.ownerUserId, labId: lab.labId, version: report.version + 1, payload: { by: "LAB" } });
      await recorder.add({ type: "REPORT_DELIVERED", reportId: id, patientId: report.ownerUserId, labId: lab.labId, version: report.version + 1, payload: { labName: report.lab?.name ?? null } });
    });
    await recorder.flush();
    await logAudit("LAB_VERIFY_VALUES", { req, actorUserId: lab.user.id, actorRole: lab.user.role, entityType: "MedicalReport", entityId: id });
    // إشعار العميل — «نتيجتك جاهزة» فقط بلا أي قيمة طبية
    await notifyResultReady(report.ownerUserId, `/app/records/${id}`);
    void notifyDoctorOnMeaningfulChange(id).catch(() => {});
    return jsonOk({ status: "CONFIRMED_LAB" });
  }

  // ---------- edit-value: تصحيح قيمة قبل التأكيد ----------
  if (op === "edit-value") {
    const valueId = String(body?.valueId ?? "");
    const v = await db.extractedValue.findFirst({ where: { id: valueId, reportId: id } });
    if (!v) return jsonError("NOT_FOUND", 404);
    const newValue = body?.value === null || body?.value === "" ? null : Number(body?.value);
    if (newValue !== null && !Number.isFinite(newValue)) return jsonError("INVALID_NUMBER", 400);
    const refLow = v.refLow;
    const refHigh = v.refHigh;
    let flag = v.flag;
    if (newValue !== null && refLow !== null && refHigh !== null) {
      flag = newValue > refHigh ? "HIGH" : newValue < refLow ? "LOW" : "NORMAL";
      const rule = await matchCriticalRule(v.canonicalKey, newValue);
      if (rule) flag = rule.op === ">" ? "CRITICAL_HIGH" : "CRITICAL_LOW";
    }
    await db.extractedValue.update({
      where: { id: valueId },
      data: { value: newValue, flag, verification: "CORRECTED_LAB", notes: `قديمة: ${v.value ?? "—"} → جديدة: ${newValue ?? "—"}` },
    });
    await logAudit("LAB_CORRECT_VALUE", { req, actorUserId: lab.user.id, actorRole: lab.user.role, entityType: "ExtractedValue", entityId: valueId, meta: { from: v.value, to: newValue } });
    await recordAndPublish({ type: "REPORT_EXTRACTED", reportId: id, patientId: report.ownerUserId, labId: lab.labId, payload: { reason: "LAB_EDIT" } });
    return jsonOk({ ok: true });
  }

  // ---------- resolve-correction: معالجة طلب تصحيح → إصدار جديد غير قابل للمسح ----------
  if (op === "resolve-correction") {
    const correctionId = String(body?.correctionId ?? "");
    const decision = String(body?.decision ?? "");
    if (!["RESOLVED", "REJECTED"].includes(decision)) return jsonError("INVALID_DECISION", 400);
    const correction = await db.reportCorrection.findFirst({ where: { id: correctionId, labId: lab.labId } });
    if (!correction || correction.status !== "OPEN") return jsonError("NOT_FOUND", 404);
    const resolution = String(body?.resolution ?? "").trim().slice(0, 600) || null;

    if (decision === "RESOLVED" && correction.valueId) {
      const v = await db.extractedValue.findFirst({ where: { id: correction.valueId, reportId: id } });
      if (v) {
        const newValue = body?.newValue === undefined || body?.newValue === "" ? null : Number(body?.newValue);
        if (newValue !== null && !Number.isFinite(newValue)) return jsonError("INVALID_NUMBER", 400);
        let flag = v.flag;
        if (newValue !== null && v.refLow !== null && v.refHigh !== null) {
          flag = newValue > v.refHigh ? "HIGH" : newValue < v.refLow ? "LOW" : "NORMAL";
          const rule = await matchCriticalRule(v.canonicalKey, newValue);
          if (rule) flag = rule.op === ">" ? "CRITICAL_HIGH" : "CRITICAL_LOW";
        }
        await db.extractedValue.update({
          where: { id: v.id },
          data: { value: newValue, flag, verification: "CORRECTED_LAB" },
        });
      }
    }

    await db.reportCorrection.update({
      where: { id: correction.id },
      data: {
        status: decision,
        resolution,
        oldValue: correction.oldValue,
        newValue: decision === "RESOLVED" && body?.newValue !== undefined ? String(body.newValue) : null,
        resolvedAt: new Date(),
        resolvedBy: lab.user.id,
      },
    });

    if (decision === "RESOLVED") {
      // إصدار جديد في السلسلة — الأصل محفوظ أبدًا، ورأي الطبيب القديم يُعلّم «يحتاج مراجعة»
      await createCorrectionVersion(id, `تصحيح معمل: ${correction.details.slice(0, 120)}`, lab.user.id);
      await runImmediateSafetyCheck(id);
      await recordAndPublish({ type: "REPORT_CORRECTED", reportId: id, patientId: report.ownerUserId, labId: lab.labId, payload: { correctionId: correction.id } });
      // إبلاغ العميل — وصف النتيجة بلا قيم طبية
      const { notify } = await import("@/lib/api-utils");
      await notify(report.ownerUserId, {
        type: "REVIEW_COMPLETED",
        titleAr: "عولج طلب التصحيح", titleEn: "Correction request handled",
        bodyAr: "راجع المعمل طلب التصحيح وحدّث نتيجتك — الإصدار الجديد متاح والأصل محفوظ. إن كان لرأي الطبيب رأيًا سابقًا فسيُعلَّم للمراجعة.",
        bodyEn: "The lab handled your correction request and updated the result — a new version is available and the original is preserved.",
        severity: "INFO",
        link: `/app/records/${id}`,
      });
    }
    await logAudit("LAB_CORRECTION_RESOLVED", { req, actorUserId: lab.user.id, actorRole: lab.user.role, entityType: "ReportCorrection", entityId: correction.id, meta: { decision } });
    await recordAndPublish({ type: "CORRECTION_RESOLVED", reportId: id, patientId: report.ownerUserId, labId: lab.labId, payload: { decision } });
    return jsonOk({ ok: true });
  }

  return jsonError("UNKNOWN_OP", 400);
}
