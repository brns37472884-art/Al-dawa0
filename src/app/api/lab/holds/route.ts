import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireLab } from "@/lib/permissions";
import { jsonError, jsonOk } from "@/lib/auth";
import { readJson, logAudit } from "@/lib/api-utils";
import { recordAndPublish } from "@/lib/events";

/**
 * POST /api/lab/holds — قرار المشرف على تعارضة اسم.
 * LAB_SUPERVISOR فقط (الإدارة لا ترى بيانات مرضى — والمعالجة داخل حساب المعمل).
 * APPROVED → يستأنف الإرسال · REJECTED → تُرجع النتيجة (تظل محفوظة بلا تسليم).
 */
export async function POST(req: NextRequest) {
  const ctx = await requireLab();
  if (ctx instanceof Response) return ctx;
  if (!ctx.canReviewHolds) return jsonError("SUPERVISOR_REQUIRED", 403);
  const body = await readJson(req);
  const id = String(body?.id ?? "");
  const decision = String(body?.decision ?? "");
  if (!["APPROVED", "REJECTED"].includes(decision)) return jsonError("INVALID_DECISION", 400);
  const note = String(body?.note ?? "").trim().slice(0, 600) || null;
  const hold = await db.identityHold.findFirst({ where: { id, labId: ctx.labId } });
  if (!hold) return jsonError("NOT_FOUND", 404);
  if (hold.status !== "OPEN") return jsonError("ALREADY_RESOLVED", 409);

  await db.identityHold.update({
    where: { id },
    data: { status: decision as never, reviewedById: ctx.user.id, reviewedAt: new Date(), note },
  });
  await logAudit(decision === "APPROVED" ? "IDENTITY_HOLD_APPROVED" : "IDENTITY_HOLD_REJECTED", {
    req,
    actorUserId: ctx.user.id,
    actorRole: ctx.user.role,
    entityType: "IdentityHold",
    entityId: id,
    meta: { reportId: hold.reportId, orderNumber: hold.orderNumber },
  });
  await recordAndPublish({
    type: "IDENTITY_HOLD",
    labId: ctx.labId,
    reportId: hold.reportId,
    payload: { holdId: id, decision },
  });
  return jsonOk({ ok: true, decision });
}
