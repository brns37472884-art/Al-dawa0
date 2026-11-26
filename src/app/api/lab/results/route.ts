import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireLab } from "@/lib/permissions";
import { jsonError, jsonOk } from "@/lib/auth";
import { logAudit } from "@/lib/api-utils";
import { rateLimit } from "@/lib/rate-limit";
import { recordAndPublish } from "@/lib/events";
import { notifyLabStaff, runImmediateSafetyCheck } from "@/lib/safety/flow";
import { processReport, saveManualValues } from "@/lib/agents/reader";
import { encryptBuffer, encryptText, hashPhone, claimToken } from "@/lib/crypto-file";
import { detectRealType, REPORT_ALLOWED_EXT, REPORT_MAX_SIZE, REPORT_MAX_FILES } from "@/lib/files";
import { storage, generatedFileName } from "@/lib/storage";
import { getSettingNumber } from "@/lib/settings";
import { normalizePhone, nameMatches } from "@/lib/helpers";
import { createInitialVersion } from "@/lib/report-versions";
import { originAllowed } from "@/lib/origin";

/**
 * POST /api/lab/results — رفع نتيجة (ملفات متعددة أو قيم يدوية).
 * مساران: برقم الطلب/الكود (LabOrder) أو برقم موبايل العميل (مسار المرجع).
 * منع الغلط: اسم التقرير ≠ اسم الطلب → IdentityHold — الإرسال متوقف حتى مراجعة مشرف المعمل.
 */
export async function POST(req: NextRequest) {
  if (!originAllowed(req.headers)) return jsonError("ORIGIN_FORBIDDEN", 403);
  const ctx = await requireLab();
  if (ctx instanceof Response) return ctx;
  const { labId, user } = ctx;

  if (!(await rateLimit(`lab-upload:${labId}`, 60, 60 * 60 * 1000))) return jsonError("RATE_LIMITED", 429);
  const dailyLimit = await getSettingNumber("LAB_DAILY_UPLOAD_LIMIT");
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const todayCount = await db.medicalReport.count({ where: { labId, source: "LAB_DIRECT", uploadedAt: { gte: dayStart } } });
  if (todayCount >= dailyLimit) return jsonError("LAB_DAILY_LIMIT_REACHED", 429, { limit: dailyLimit });

  const form = await req.formData().catch(() => null);
  if (!form) return jsonError("INVALID_FORM", 400);

  const reportType = String(form.get("reportType") || "LAB");
  if (!["LAB", "RADIOLOGY", "OTHER"].includes(reportType)) return jsonError("INVALID_REPORT_TYPE", 400);
  const labReportNo = String(form.get("labReportNo") || "").trim().slice(0, 60) || null;
  const notes = String(form.get("notes") || "").trim().slice(0, 1000) || null;
  const manualValuesRaw = String(form.get("manualValues") || "") || null;
  let testDate: Date | null = null;
  const td = String(form.get("testDate") || "");
  if (td) {
    testDate = new Date(td);
    if (Number.isNaN(testDate.getTime()) || testDate.getTime() > Date.now() + 24 * 3600 * 1000) return jsonError("INVALID_TEST_DATE", 400);
  }

  // ---------- الملفات المتعددة ----------
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0).slice(0, REPORT_MAX_FILES);
  const buffers: Array<{ name: string; ext: string; mime: string; buf: Buffer }> = [];
  for (const f of files) {
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    if (!REPORT_ALLOWED_EXT.includes(ext)) return jsonError("UNSUPPORTED_FORMAT", 400, { allowed: REPORT_ALLOWED_EXT });
    if (f.size > REPORT_MAX_SIZE) return jsonError("FILE_TOO_LARGE", 400, { maxMB: 15 });
    const buf = Buffer.from(await f.arrayBuffer());
    if (buf.length === 0) return jsonError("EMPTY_FILE", 400);
    const real = detectRealType(buf);
    const expectedExt = ext === "jpeg" ? "jpg" : ext;
    if (!real || real !== expectedExt) return jsonError("FILE_CONTENT_MISMATCH", 400, { detected: real ?? "unknown" });
    buffers.push({ name: f.name.slice(0, 180), ext: expectedExt, mime: f.type || "application/octet-stream", buf });
  }

  const manualValues = manualValuesRaw ? safeParseArray(manualValuesRaw) : null;
  if (manualValuesRaw && manualValues === null) return jsonError("INVALID_MANUAL_VALUES", 400);
  if (buffers.length === 0 && (!Array.isArray(manualValues) || manualValues.length === 0)) return jsonError("NO_FILE_OR_VALUES", 400);
  if (Array.isArray(manualValues)) {
    for (const mv of manualValues) {
      if (mv.refLow !== undefined && mv.refHigh !== undefined && mv.refLow !== "" && mv.refHigh !== "" && Number(mv.refLow) > Number(mv.refHigh)) {
        return jsonError("INVALID_RANGE", 400);
      }
      if (mv.value !== undefined && mv.value !== null && mv.value !== "" && !mv.valueText) {
        const n = Number(mv.value);
        if (!Number.isFinite(n)) return jsonError("INVALID_VALUE", 400, { field: "value" });
      }
    }
  }

  // ---------- تحديد المسار: طلب أو موبايل ----------
  const orderNumber = String(form.get("orderNumber") || "").trim();
  const qrTokenIn = String(form.get("qrToken") || "").trim();
  const phoneRaw = String(form.get("phone") || "");
  const providedName = String(form.get("patientName") || "").trim();

  let order: { id: string; orderNumber: string; patientId: string; patientName: string; status: string } | null = null;
  let patient: { id: string; fullName: string; consented: boolean } | null = null;
  let phone: string | null = null;

  if (orderNumber || qrTokenIn) {
    // مسار الطلب: التحقق من أن الطلب تابع لهذا المعمل — غير ذلك 404 (بلا تسريب)
    const q = qrTokenIn ? { qrToken: qrTokenIn } : { orderNumber };
    const o = await db.labOrder.findFirst({
      where: { ...q, labId },
      include: { patient: { select: { id: true, fullName: true } } },
    });
    if (!o || o.status === "CANCELLED") return jsonError("NOT_FOUND", 404);
    order = { id: o.id, orderNumber: o.orderNumber, patientId: o.patientId, patientName: o.patient.fullName, status: o.status };
    const consents = await db.consent.findUnique({ where: { userId_type: { userId: o.patientId, type: "LAB_RESULT_SHARING" } } });
    patient = { id: o.patientId, fullName: o.patient.fullName, consented: !!consents?.granted };
  } else {
    phone = normalizePhone(phoneRaw);
    if (!phone) return jsonError("INVALID_PHONE", 400);
    if (providedName.length < 3 || providedName.length > 120) return jsonError("INVALID_NAME", 400);
    const p = await db.user.findFirst({
      where: { phone, role: "PATIENT", isActive: true },
      include: { consents: { where: { type: "LAB_RESULT_SHARING" } } },
    });
    patient = p ? { id: p.id, fullName: p.fullName, consented: !!p.consents.some((c) => c.granted) } : null;
  }

  // ---------- منع الغلط: مقارنة الاسم (تطبيع عربي) → IdentityHold ----------
  let holdId: string | null = null;
  const expectedName = order ? order.patientName : patient?.fullName ?? null;
  if (patient && expectedName && providedName && !nameMatches(providedName, expectedName)) {
    const hold = await db.identityHold.create({
      data: { labId, orderNumber: order?.orderNumber ?? null, expectedName, providedName, reason: "NAME_MISMATCH", status: "OPEN" },
    });
    holdId = hold.id;
    await notifyLabStaff(labId, "HOLD");
    await recordAndPublish({ type: "IDENTITY_HOLD", labId, patientId: patient.id, payload: { holdId: hold.id } });
  }

  const isDirect = !!patient && patient.consented;
  const expiryDays = await getSettingNumber("PENDING_CLAIM_EXPIRY_DAYS");
  const store = storage();

  // ---------- الحالة 1: مسجّل وموافق → تسليم مباشر ----------
  if (isDirect && patient) {
    const primary = buffers[0] ?? null;
    const report = await db.medicalReport.create({
      data: {
        ownerUserId: patient.id,
        fileName: primary?.name ?? `إدخال-معمل-${Date.now()}.json`,
        filePath: "",
        fileType: primary?.ext ?? "json",
        mimeType: primary?.mime ?? "application/json",
        fileSize: primary?.buf.length ?? JSON.stringify(manualValues ?? []).length,
        reportType,
        labName: (await db.lab.findUnique({ where: { id: labId }, select: { name: true } }))?.name ?? null,
        testDate,
        issuedAt: testDate,
        notes,
        status: Array.isArray(manualValues) && manualValues.length > 0 ? "EXTRACTED" : "UPLOADED",
        source: "LAB_DIRECT",
        labId,
        labOrderId: order?.id ?? null,
        labReportNo: order?.orderNumber ?? labReportNo,
      },
    });
    if (holdId) await db.identityHold.update({ where: { id: holdId }, data: { reportId: report.id } });

    if (primary) {
      const safeName = generatedFileName(primary.ext);
      const filePath = await store.save(patient.id, safeName, primary.buf);
      await db.medicalReport.update({ where: { id: report.id }, data: { filePath, status: "UPLOADED" } });
      await createInitialVersion({ id: report.id, fileName: report.fileName, filePath, fileType: primary.ext, mimeType: primary.mime, fileSize: primary.buf.length });
    }
    if (Array.isArray(manualValues) && manualValues.length > 0) {
      await saveManualValues(report.id, manualValues as Array<{ name: string; value?: unknown; valueText?: string; unit?: string; refLow?: unknown; refHigh?: unknown }>, testDate);
      await db.medicalReport.update({
        where: { id: report.id },
        data: {
          status: "EXTRACTED",
          processedAt: new Date(),
          extractionMeta: JSON.stringify({ engine: "lab-manual", pages: 1, reportType: "LAB" }),
        },
      });
      await createInitialVersion({ id: report.id, fileName: report.fileName, filePath: "", fileType: "json", mimeType: "application/json", fileSize: JSON.stringify(manualValues).length });
    }

    await logAudit("LAB_RESULT_UPLOAD", { req, actorUserId: user.id, actorRole: user.role, entityType: "MedicalReport", entityId: report.id, meta: { labId, delivery: "DIRECT", hold: !!holdId } });
    await recordAndPublish({ type: "REPORT_UPLOADED", reportId: report.id, patientId: patient.id, labId, payload: { delivery: "DIRECT", hold: !!holdId } });
    if (order) await db.labOrder.update({ where: { id: order.id }, data: { status: "RESULT_UPLOADED" } });

    if (primary) {
      processReport(report.id).then(() => notifyLabStaff(labId, "VERIFY")).catch((e) => console.error("[LAB-PIPELINE]", e));
    } else {
      await runImmediateSafetyCheck(report.id);
      notifyLabStaff(labId, "VERIFY").catch(() => {});
    }
    return jsonOk({ id: report.id, delivery: "DIRECT", status: primary ? "PROCESSING" : "EXTRACTED", hold: !!holdId, holdId });
  }

  // ---------- الحالة 2: بانتظار الموافقة أو الاستلام ----------
  let pendingPath = "";
  let mimeType = "application/json";
  let fileName = `إدخال-يدوي-${Date.now()}.json`;
  let pendingSize = Array.isArray(manualValues) ? JSON.stringify(manualValues).length : 0;
  if (buffers.length > 0) {
    const primary = buffers[0];
    // التشفير قبل الكتابة — الملف لا يُخزن صريحًا أبدًا
    const envelope = encryptBuffer(primary.buf);
    pendingPath = await store.save("pending", generatedFileName("enc"), Buffer.from(envelope, "utf-8"));
    mimeType = primary.mime;
    fileName = primary.name;
    pendingSize = primary.buf.length;
  }
  const targetPhone = phone ?? (await db.user.findUnique({ where: { id: patient!.id }, select: { phone: true } }))?.phone ?? "";
  const pending = await db.pendingLabResult.create({
    data: {
      labId,
      patientPhone: encryptText(targetPhone),
      phoneHash: hashPhone(targetPhone),
      patientName: providedName || order?.patientName || "غير محدد",
      fileName,
      filePath: pendingPath,
      mimeType,
      fileSize: pendingSize,
      reportType,
      labReportNo: order?.orderNumber ?? labReportNo,
      testDate,
      notes: Array.isArray(manualValues) ? JSON.stringify(manualValues).slice(0, 4000) : notes,
      status: "PENDING",
      claimToken: claimToken(),
      expiresAt: new Date(Date.now() + expiryDays * 24 * 3600 * 1000),
    },
  });
  await logAudit("LAB_RESULT_UPLOAD", { req, actorUserId: user.id, actorRole: user.role, entityType: "PendingLabResult", entityId: pending.id, meta: { labId, delivery: "PENDING", reason: patient ? "NO_CONSENT" : "NOT_REGISTERED" } });
  await recordAndPublish({ type: "REPORT_UPLOADED", labId, payload: { delivery: "PENDING" } });
  if (order) await db.labOrder.update({ where: { id: order.id }, data: { status: "IN_PROGRESS" } });

  if (patient && !patient.consented) {
    const { notify } = await import("@/lib/api-utils");
    const labName = (await db.lab.findUnique({ where: { id: labId }, select: { name: true } }))?.name ?? "المعمل";
    await notify(patient.id, {
      type: "REPORT_UPLOADED",
      titleAr: "نتيجة بانتظار موافقتك", titleEn: "A result is waiting for your consent",
      bodyAr: `رفع ${labName} نتيجة باسمك. لاستلامها فعّل موافقة «استلام نتائج المعامل» من صفحة الموافقات.`,
      bodyEn: `${labName} uploaded a result under your name. Grant the "Lab results sharing" consent in the consents page to receive it.`,
      severity: "INFO",
      link: "/app/consents",
    });
  } else if (!patient) {
    const { sendOutbound } = await import("@/lib/notifications");
    const base = process.env.PUBLIC_BASE_URL || "";
    await sendOutbound(
      { channel: "SMS", to: targetPhone, template: "PENDING_INVITE" },
      { link: `${base}/claim?token=${pending.claimToken}` }
    );
  }
  return jsonOk({
    id: pending.id,
    delivery: "PENDING",
    claimToken: pending.claimToken,
    expiresAt: pending.expiresAt,
    reason: patient ? "NO_CONSENT" : "NOT_REGISTERED",
    hold: !!holdId,
    holdId,
  });
}

function safeParseArray(s: string): Array<Record<string, unknown>> | null {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** GET /api/lab/results — ما رفعه هذا المعمل فقط (عزل كامل) */
export async function GET(req: NextRequest) {
  const ctx = await requireLab();
  if (ctx instanceof Response) return ctx;
  const { labId } = ctx;
  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get("page") || "1", 10) || 1);
  const pageSize = 50;

  const [reports, total, pending, corrections] = await Promise.all([
    db.medicalReport.findMany({
      where: { labId, source: "LAB_DIRECT" },
      orderBy: { uploadedAt: "desc" },
      take: pageSize,
      skip: (page - 1) * pageSize,
      include: {
        owner: { select: { fullName: true, phone: true } },
        values: { select: { flag: true, verification: true } },
        corrections: { where: { status: "OPEN" }, select: { id: true } },
        reviews: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true } },
        labOrder: { select: { orderNumber: true } },
      },
    }),
    db.medicalReport.count({ where: { labId, source: "LAB_DIRECT" } }),
    db.pendingLabResult.findMany({
      where: { labId, status: { in: ["PENDING", "CLAIMED", "EXPIRED"] } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, patientName: true, patientPhone: true, fileName: true, status: true, createdAt: true, expiresAt: true, claimToken: true, labReportNo: true },
    }),
    db.reportCorrection.findMany({
      where: { labId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { report: { select: { fileName: true, owner: { select: { fullName: true } } } } },
    }),
  ]);
  const holds = await db.identityHold.findMany({ where: { labId }, orderBy: { createdAt: "desc" }, take: 50 });
  const { decryptText } = await import("@/lib/crypto-file");

  return jsonOk({
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
    reports: reports.map((r) => ({
      id: r.id,
      fileName: r.fileName,
      reportType: r.reportType,
      status: r.status,
      uploadedAt: r.uploadedAt,
      orderNumber: r.labOrder?.orderNumber ?? r.labReportNo,
      testDate: r.testDate,
      patientName: r.owner.fullName,
      phoneMasked: r.owner.phone ? `${r.owner.phone.slice(0, -4)}****` : null,
      openedByPatient: !!r.patientOpenedAt,
      valuesCount: r.values.length,
      verifiedCount: r.values.filter((v) => v.verification === "VERIFIED_LAB" || v.verification === "CORRECTED_LAB").length,
      critical: r.values.some((v) => v.flag.startsWith("CRITICAL")),
      reviewStatus: r.reviews[0]?.status ?? null,
      openCorrections: r.corrections.length,
    })),
    pending: pending.map((p) => {
      const plain = decryptText(p.patientPhone) || p.patientPhone;
      return { ...p, patientPhone: undefined, phoneMasked: plain ? `${plain.slice(0, -4)}****` : null };
    }),
    corrections: corrections.map((c) => ({
      id: c.id,
      reportId: c.reportId,
      reportName: c.report.fileName,
      patientName: c.report.owner.fullName,
      field: c.field,
      details: c.details,
      status: c.status,
      resolution: c.resolution,
      oldValue: c.oldValue,
      newValue: c.newValue,
      createdAt: c.createdAt,
      resolvedAt: c.resolvedAt,
    })),
    holds: holds.map((h) => ({
      id: h.id,
      reportId: h.reportId,
      orderNumber: h.orderNumber,
      expectedName: h.expectedName,
      providedName: h.providedName,
      status: h.status,
      note: h.note,
      createdAt: h.createdAt,
      reviewedAt: h.reviewedAt,
    })),
  });
}

