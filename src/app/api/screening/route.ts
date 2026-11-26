import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireCapability } from "@/lib/permissions";
import { jsonError, jsonOk } from "@/lib/auth";
import { readJson, logAudit } from "@/lib/api-utils";
import { recomputePlan } from "@/lib/screening/service";

/** GET /api/screening — خطة الفحوصات: المطلوب/اللي اتعمل/الجاي (المعتمد فقط) */
export async function GET(req: NextRequest) {
  const user = await requireCapability("patient:self");
  if (user instanceof Response) return user;
  const member = req.nextUrl.searchParams.get("member") || "me";

  const approvedCount = await db.screeningProtocol.count({ where: { active: true, status: "APPROVED" } });
  let records: Awaited<ReturnType<typeof fetchRecords>>;
  if (member === "me") {
    records = await fetchRecords(user.id, null);
    // أول زيارة بلا سجلات → إعادة حساب تلقائية
    const distinctEvaluated = new Set(records.map((r) => r.protocolId)).size;
    if (records.length === 0 || (approvedCount > 0 && distinctEvaluated < approvedCount)) {
      await recomputePlan(user.id, null);
      records = await fetchRecords(user.id, null);
    }
  } else {
    const m = await db.familyMember.findFirst({ where: { id: member, ownerUserId: user.id } });
    if (!m) return jsonError("NOT_FOUND", 404);
    records = await fetchRecords(user.id, member);
    if (records.length === 0 && approvedCount > 0) {
      await recomputePlan(user.id, member);
      records = await fetchRecords(user.id, member);
    }
  }

  const doctorPlans = await db.followUpPlan.findMany({
    where: { patientId: user.id, status: "ACTIVE" },
    orderBy: { dueDate: "asc" },
    take: 20,
    include: { doctor: { select: { fullName: true } } },
  });

  const grouped: Record<string, typeof records> = { OVERDUE: [], DUE: [], UPCOMING: [], COMPLETED: [], NOT_ELIGIBLE: [] };
  for (const r of records) (grouped[r.status] ??= []).push(r);

  return jsonOk({
    records,
    grouped,
    doctorPlans: doctorPlans.map((p) => ({ id: p.id, titleAr: p.titleAr, titleEn: p.titleEn, dueDate: p.dueDate, note: p.note, doctorName: p.doctor.fullName })),
    protocolsApproved: approvedCount,
    protocolsTotal: await db.screeningProtocol.count({ where: { active: true } }),
  });
}

async function fetchRecords(userId: string, familyMemberId: string | null) {
  return db.screeningRecord.findMany({
    where: { userId, familyMemberId },
    include: {
      protocol: {
        select: {
          key: true, titleAr: true, titleEn: true, summaryAr: true, summaryEn: true, category: true,
          sourceOrg: true, guidelineVersion: true, guidelineDate: true, approvedAt: true,
          doctorDiscussion: true, exclusionsAr: true, exclusionsEn: true, seeDoctorAr: true, seeDoctorEn: true, intervalMonths: true,
        },
      },
    },
    orderBy: [{ status: "asc" }, { nextDueAt: "asc" }],
  });
}

/** POST ops: mark-done / recompute */
export async function POST(req: NextRequest) {
  const user = await requireCapability("patient:self");
  if (user instanceof Response) return user;
  const body = await readJson(req);
  const op = String(body?.op ?? "");
  const member = body?.member && body.member !== "me" ? String(body.member) : null;

  if (op === "mark-done") {
    const id = String(body?.id ?? "");
    const rec = await db.screeningRecord.findFirst({ where: { id, userId: user.id, ...(member ? { familyMemberId: member } : {}) } });
    if (!rec) return jsonError("NOT_FOUND", 404);
    const date = body?.date ? new Date(String(body.date)) : new Date();
    if (Number.isNaN(date.getTime()) || date.getTime() > Date.now() + 24 * 3600 * 1000) return jsonError("INVALID_DATE", 400);
    await db.screeningRecord.update({ where: { id }, data: { lastDoneAt: date } });
    await recomputePlan(user.id, rec.familyMemberId);
    await logAudit("SCREENING_MARK_DONE", { req, actorUserId: user.id, actorRole: user.role, entityType: "ScreeningRecord", entityId: id });
    return jsonOk({ ok: true });
  }
  if (op === "recompute") {
    if (member) {
      const m = await db.familyMember.findFirst({ where: { id: member, ownerUserId: user.id } });
      if (!m) return jsonError("NOT_FOUND", 404);
    }
    await recomputePlan(user.id, member);
    return jsonOk({ ok: true });
  }
  return jsonError("UNKNOWN_OP", 400);
}

