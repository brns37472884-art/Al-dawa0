import { NextRequest } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { getSessionUser, jsonError, jsonOk } from "@/lib/auth";
import { logAudit, readJson } from "@/lib/api-utils";
import { recordAndPublish } from "@/lib/events";
import { decryptBuffer, hashPhone, tokenMatches } from "@/lib/crypto-file";
import { storage, generatedFileName } from "@/lib/storage";
import { processReport } from "@/lib/agents/reader";
import { getSettingNumber } from "@/lib/settings";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { normalizePhone, nameMatches } from "@/lib/helpers";

function phoneOf(user: { id: string }): Promise<string | null> {
  return db.user.findUnique({ where: { id: user.id }, select: { phone: true } }).then((u) => u?.phone ?? null);
}

/** GET /api/claim — نتائج «بانتظار الاستلام» المرتبطة برقم موبايل المستخدم */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return jsonError("UNAUTHORIZED", 401);
  const phone = normalizePhone(await phoneOf(user));
  if (!phone) return jsonOk({ phoneOnFile: false, pending: [] });
  await expirePending();
  const pending = await db.pendingLabResult.findMany({
    where: {
      status: "PENDING",
      expiresAt: { gt: new Date() },
      OR: [{ phoneHash: hashPhone(phone) }, { patientPhone: phone }],
    },
    include: { lab: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return jsonOk({
    phoneOnFile: true,
    phoneMasked: `${phone.slice(0, -4)}****`,
    pending: pending.map((p) => ({
      id: p.id,
      labName: p.lab.name,
      patientNameOnFile: p.patientName,
      fileName: p.fileName,
      reportType: p.reportType,
      testDate: p.testDate,
      createdAt: p.createdAt,
      expiresAt: p.expiresAt,
    })),
  });
}

/**
 * POST /api/claim — استلام بتحقق ثلاثي: رمز الاستلام + رقم الموبايل (HMAC) + مطابقة الاسم (تطبيع عربي).
 * الملف مشفر AES-256-GCM حتى هذه اللحظة — والقفل السباقي يمنع استلامًا مزدوجًا.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return jsonError("UNAUTHORIZED", 401);
  const body = await readJson(req);
  const pendingId = String(body?.pendingId || "");
  const nameConfirm = String(body?.nameConfirm || "").trim();
  const claimTokenIn = String(body?.claimToken || "").trim();
  if (!pendingId || !nameConfirm || !claimTokenIn) return jsonError("MISSING_FIELDS", 400);

  const ip = clientIp(req);
  if (!(await rateLimit(`claim:${user.id}`, 10, 15 * 60 * 1000)) || !(await rateLimit(`claim-ip:${ip}`, 30, 60 * 60 * 1000))) {
    await logAudit("CLAIM_RATE_LIMITED", { req, actorUserId: user.id, actorRole: user.role });
    return jsonError("RATE_LIMITED", 429);
  }
  const phone = normalizePhone(await phoneOf(user));
  if (!phone) return jsonError("PHONE_NOT_VERIFIED", 403);
  await expirePending();

  const pending = await db.pendingLabResult.findUnique({ where: { id: pendingId }, include: { lab: { select: { id: true, name: true } } } });
  if (!pending || pending.status !== "PENDING" || pending.expiresAt <= new Date()) return jsonError("NOT_FOUND_OR_EXPIRED", 404);
  // الطرف 1: رمز الاستلام (سلّمه موظف المعمل شخصيًا)
  if (!pending.claimToken || !tokenMatches(pending.claimToken, claimTokenIn)) {
    await logAudit("CLAIM_TOKEN_MISMATCH", { req, actorUserId: user.id, actorRole: user.role, entityType: "PendingLabResult", entityId: pending.id });
    return jsonError("CLAIM_TOKEN_INVALID", 403);
  }
  // الطرف 2: رقم الموبايل بالهاش
  const phoneOk = pending.phoneHash ? pending.phoneHash === hashPhone(phone) : pending.patientPhone === phone;
  if (!phoneOk) return jsonError("PHONE_MISMATCH", 403);
  // الطرف 3: مطابقة الاسم بالتطبيع العربي
  if (!nameMatches(pending.patientName, nameConfirm)) return jsonError("NAME_MISMATCH", 403);

  // قفل سباقي: طلب واحد فقط يستلم النتيجة
  const claimedNow = await db.pendingLabResult.updateMany({
    where: { id: pending.id, status: "PENDING" },
    data: { status: "CLAIMED", claimedUserId: user.id, claimedAt: new Date() },
  });
  if (claimedNow.count === 0) return jsonError("NOT_FOUND_OR_EXPIRED", 404);

  // فك التشفير ونقل الملف — يفشل بأمان لو تعدّي بالملف
  let buffer: Buffer;
  try {
    const envelope = (await storage().read(pending.filePath)).toString("utf-8");
    buffer = decryptBuffer(envelope);
  } catch {
    await db.pendingLabResult.updateMany({
      where: { id: pending.id, status: "CLAIMED", claimedUserId: user.id },
      data: { status: "PENDING", claimedUserId: null, claimedAt: null },
    });
    await logAudit("CLAIM_DECRYPT_FAILED", { req, actorUserId: user.id, actorRole: user.role, entityId: pending.id });
    return jsonError("FILE_CORRUPT", 500);
  }

  const ext = (pending.fileName.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const safeName = generatedFileName(ext);
  const filePath = await storage().save(user.id, safeName, buffer);
  const report = await db.medicalReport.create({
    data: {
      ownerUserId: user.id,
      fileName: pending.fileName,
      filePath,
      fileType: ext,
      mimeType: pending.mimeType,
      fileSize: pending.fileSize,
      reportType: pending.reportType,
      labName: pending.lab.name,
      testDate: pending.testDate,
      issuedAt: pending.testDate,
      notes: pending.notes,
      status: "UPLOADED",
      source: "LAB_DIRECT",
      labId: pending.labId,
      labReportNo: pending.labReportNo,
    },
  });
  await db.pendingLabResult.update({ where: { id: pending.id }, data: { claimedReportId: report.id } });
  await logAudit("CLAIM_RESULT", {
    req,
    actorUserId: user.id,
    actorRole: user.role,
    entityType: "MedicalReport",
    entityId: report.id,
    meta: { pendingId: pending.id, labId: pending.labId, doubleCheck: "TOKEN+PHONE+NAME" },
  });
  await recordAndPublish({ type: "REPORT_UPLOADED", reportId: report.id, patientId: user.id, labId: pending.labId, payload: { source: "LAB_DIRECT", delivery: "CLAIMED" } });
  processReport(report.id).catch((e) => console.error("[CLAIM-PIPELINE]", e));
  return jsonOk({ id: report.id, status: "PROCESSING" });
}

/** إنهاء صلاحية النتائج غير المستلمة (المدة من إعدادات المدير) */
async function expirePending(): Promise<number> {
  const days = await getSettingNumber("PENDING_CLAIM_EXPIRY_DAYS");
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);
  const expired = await db.pendingLabResult.findMany({
    where: { status: "PENDING", createdAt: { lt: cutoff } },
    select: { id: true, filePath: true },
  });
  const store = storage();
  for (const p of expired) {
    if (p.filePath) await store.delete(p.filePath).catch(() => {});
    await db.pendingLabResult.update({ where: { id: p.id }, data: { status: "EXPIRED", filePath: "" } });
    await logAudit("PENDING_EXPIRED", { actorRole: "SYSTEM", entityType: "PendingLabResult", entityId: p.id, meta: { days } });
  }
  return expired.length;
}

void crypto;
