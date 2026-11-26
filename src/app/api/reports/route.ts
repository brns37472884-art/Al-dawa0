import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireCapability } from "@/lib/permissions";
import { jsonOk, jsonError } from "@/lib/auth";
import { logAudit } from "@/lib/api-utils";
import { rateLimit } from "@/lib/rate-limit";
import { detectRealType, REPORT_ALLOWED_EXT, REPORT_MAX_SIZE } from "@/lib/files";
import { storage, generatedFileName } from "@/lib/storage";
import { getSettingBool } from "@/lib/settings";
import { processReport } from "@/lib/agents/reader";
import { createInitialVersion } from "@/lib/report-versions";
import { recordAndPublish } from "@/lib/events";
import { originAllowed } from "@/lib/origin";

/** GET /api/reports — قائمة تقارير العميل (له فقط) */
export async function GET(req: NextRequest) {
  const user = await requireCapability("patient:self");
  if (user instanceof Response) return user;
  const member = req.nextUrl.searchParams.get("member") || "me";
  const type = req.nextUrl.searchParams.get("type");
  const cursor = req.nextUrl.searchParams.get("cursor");
  const familyMemberId = member === "me" ? null : member;

  const where = {
    ownerUserId: user.id,
    familyMemberId,
    ...(type && ["LAB", "RADIOLOGY", "OTHER"].includes(type) ? { reportType: type } : {}),
  };
  const reports = await db.medicalReport.findMany({
    where,
    orderBy: { uploadedAt: "desc" },
    take: 60,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    include: {
      familyMember: { select: { name: true } },
      values: { select: { flag: true } },
      reviews: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, urgency: true, needsReview: true } },
      lab: { select: { name: true } },
    },
  });
  const total = await db.medicalReport.count({ where });
  return jsonOk({
    total,
    hasMore: reports.length === 60,
    nextCursor: reports.length === 60 ? reports[reports.length - 1].id : null,
    reports: reports.map((r) => ({
      id: r.id,
      fileName: r.fileName,
      reportType: r.reportType,
      status: r.status,
      uploadedAt: r.uploadedAt,
      testDate: r.testDate,
      labName: r.lab?.name ?? r.labName,
      labReportNo: r.labReportNo,
      source: r.source,
      currentVersion: r.currentVersion,
      memberName: r.familyMember?.name ?? null,
      demo: r.demo,
      valuesCount: r.values.length,
      abnormalCount: r.values.filter((v) => !["NORMAL", "UNKNOWN"].includes(v.flag)).length,
      review: r.reviews[0] ?? null,
    })),
  });
}

/** POST /api/reports — رفع العميل الذاتي (مغلق خلف ALLOW_PATIENT_UPLOAD + حد الباقة) */
export async function POST(req: NextRequest) {
  if (!originAllowed(req.headers)) return jsonError("ORIGIN_FORBIDDEN", 403);
  const user = await requireCapability("patient:self");
  if (user instanceof Response) return user;
  if (!(await rateLimit(`report-upload:${user.id}`, 30, 10 * 60 * 1000))) return jsonError("RATE_LIMITED", 429);

  const allowUpload = await getSettingBool("ALLOW_PATIENT_UPLOAD");
  if (!allowUpload) {
    await logAudit("PATIENT_UPLOAD_BLOCKED", { req, actorUserId: user.id, actorRole: user.role });
    return jsonError("PATIENT_UPLOAD_DISABLED", 403);
  }

  const form = await req.formData().catch(() => null);
  if (!form) return jsonError("INVALID_FORM", 400);
  const file = form.get("file") as File | null;
  if (!file || !(file instanceof File)) return jsonError("NO_FILE", 400);
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (!REPORT_ALLOWED_EXT.includes(ext)) return jsonError("UNSUPPORTED_FORMAT", 400, { allowed: REPORT_ALLOWED_EXT });
  if (file.size > REPORT_MAX_SIZE) return jsonError("FILE_TOO_LARGE", 400, { maxMB: 15 });

  // حد تقارير الباقة (نتائج المعمل مستثناة بالإعداد)
  const sub = await db.subscription.findFirst({ where: { userId: user.id, status: "ACTIVE" }, orderBy: { startedAt: "desc" } });
  const plan = sub ? await db.plan.findUnique({ where: { key: sub.planKey } }) : null;
  if (plan && plan.reportsLimit >= 0) {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const exempt = await getSettingBool("LAB_RESULTS_EXEMPT_FROM_LIMIT");
    const used = await db.medicalReport.count({
      where: { ownerUserId: user.id, uploadedAt: { gte: monthStart }, ...(exempt ? { source: { not: "LAB_DIRECT" } } : {}) },
    });
    if (used >= plan.reportsLimit) return jsonError("PLAN_LIMIT_REACHED", 402, { limit: plan.reportsLimit, plan: plan.key });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length === 0) return jsonError("EMPTY_FILE", 400);
  const real = detectRealType(buffer);
  const expectedExt = ext === "jpeg" ? "jpg" : ext;
  if (!real || real !== expectedExt) return jsonError("FILE_CONTENT_MISMATCH", 400, { detected: real ?? "unknown" });

  const reportType = String(form.get("reportType") || "LAB");
  if (!["LAB", "RADIOLOGY", "OTHER"].includes(reportType)) return jsonError("INVALID_REPORT_TYPE", 400);
  const member = String(form.get("member") || "me");
  const familyMemberId = member === "me" ? null : member;
  if (familyMemberId) {
    const m = await db.familyMember.findFirst({ where: { id: familyMemberId, ownerUserId: user.id } });
    if (!m) return jsonError("FAMILY_MEMBER_NOT_FOUND", 404);
  }
  const labName = String(form.get("labName") || "").trim().slice(0, 120) || null;
  const notes = String(form.get("notes") || "").trim().slice(0, 1000) || null;
  let testDate: Date | null = null;
  const td = String(form.get("testDate") || "");
  if (td) {
    testDate = new Date(td);
    if (Number.isNaN(testDate.getTime()) || testDate.getTime() > Date.now() + 24 * 3600 * 1000) return jsonError("INVALID_TEST_DATE", 400);
  }

  const safeName = generatedFileName(ext);
  const filePath = await storage().save(user.id, safeName, buffer);
  const report = await db.medicalReport.create({
    data: {
      ownerUserId: user.id,
      familyMemberId,
      fileName: file.name.slice(0, 180),
      filePath,
      fileType: expectedExt,
      mimeType: file.type || "application/octet-stream",
      fileSize: buffer.length,
      reportType,
      labName,
      testDate,
      notes,
      status: "UPLOADED",
      source: "PATIENT_UPLOAD",
      processingStep: "UPLOAD",
    },
  });
  await createInitialVersion({ id: report.id, fileName: report.fileName, filePath, fileType: expectedExt, mimeType: report.mimeType, fileSize: buffer.length });
  await logAudit("REPORT_UPLOAD", { req, actorUserId: user.id, actorRole: user.role, entityType: "MedicalReport", entityId: report.id, meta: { source: "PATIENT_UPLOAD" } });
  await recordAndPublish({ type: "REPORT_UPLOADED", reportId: report.id, patientId: user.id });
  processReport(report.id).catch((e) => console.error("[PATIENT-PIPELINE]", e));
  return jsonOk({ id: report.id, status: "PROCESSING" });
}

