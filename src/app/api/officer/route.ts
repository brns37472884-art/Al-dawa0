import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireCapability } from "@/lib/permissions";
import { jsonError, jsonOk } from "@/lib/auth";
import { readJson, logAudit } from "@/lib/api-utils";
import { recordAndPublish } from "@/lib/events";
import { invalidateCriticalRulesCache } from "@/lib/safety/critical";

const SNAPSHOT_FIELDS = ["titleAr", "titleEn", "summaryAr", "summaryEn", "category", "gender", "minAge", "maxAge", "intervalMonths", "riskFactors", "requiresRisk", "protocolType", "sourceOrg", "guidelineVersion", "guidelineDate", "doctorDiscussion", "exclusionsAr", "exclusionsEn", "seeDoctorAr", "seeDoctorEn"] as const;

/** GET /api/officer — بروتوكولات + قواعد حرجة + سجل المراجعات (المسؤول الطبي فقط) */
export async function GET() {
  const user = await requireCapability("officer:approve");
  if (user instanceof Response) return user;

  const protocols = await db.screeningProtocol.findMany({
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    include: {
      reviews: { orderBy: { createdAt: "desc" }, take: 8 },
      versions: { orderBy: { version: "desc" }, take: 3 },
    },
  });
  const rules = await db.criticalRule.findMany({ orderBy: { key: "asc" } });
  const reviews = await db.protocolReview.findMany({ orderBy: { createdAt: "desc" }, take: 50 });

  const counts = { DRAFT: 0, IN_REVIEW: 0, APPROVED: 0, RETIRED: 0 } as Record<string, number>;
  for (const p of protocols) counts[p.status] = (counts[p.status] ?? 0) + 1;

  return jsonOk({
    counts,
    total: protocols.length,
    protocols: protocols.map((p) => ({
      ...p,
      reviews: p.reviews,
      versions: p.versions.map((v) => ({ id: v.id, version: v.version, publishedAt: v.publishedAt, note: v.note, snapshot: v.snapshot })),
    })),
    rules: rules.map((r) => ({
      id: r.id, key: r.key, testKey: r.testKey, op: r.op, threshold: r.threshold, severity: r.severity, unit: r.unit,
      messageAr: r.messageAr, messageEn: r.messageEn, status: r.status, version: r.version, approvedAt: r.approvedAt,
    })),
    reviews: reviews.map((r) => ({ id: r.id, protocolId: r.protocolId, officerName: r.officerName, action: r.action, fromStatus: r.fromStatus, toStatus: r.toStatus, note: r.note, createdAt: r.createdAt })),
    approvedRulesCount: rules.filter((r) => r.status === "APPROVED").length,
  });
}

/**
 * POST ops:
 * - protocol: start-review / approve / return / retire — الاعتماد بيد المسؤول الطبي حصرًا
 * - rule: start-review / approve / return — القواعد بيانات تُعتمد هنا
 */
export async function POST(req: NextRequest) {
  const user = await requireCapability("officer:approve");
  if (user instanceof Response) return user;
  const body = await readJson(req);
  const kind = String(body?.kind ?? "protocol");
  const op = String(body?.op ?? "");
  const note = String(body?.note ?? "").trim().slice(0, 1000) || null;

  // ================= البروتوكولات =================
  if (kind === "protocol") {
    const id = String(body?.id ?? "");
    const protocol = await db.screeningProtocol.findUnique({ where: { id } });
    if (!protocol) return jsonError("NOT_FOUND", 404);

    if (op === "start-review") {
      if (protocol.status !== "DRAFT") return jsonError("INVALID_TRANSITION", 409);
      await db.screeningProtocol.update({ where: { id }, data: { status: "IN_REVIEW" } });
      await db.protocolReview.create({
        data: { protocolId: id, officerId: user.id, officerName: user.fullName, action: "SUBMIT_REVIEW", fromStatus: "DRAFT", toStatus: "IN_REVIEW" },
      });
      await logAudit("PROTOCOL_REVIEW_START", { req, actorUserId: user.id, actorRole: user.role, entityType: "ScreeningProtocol", entityId: id });
      return jsonOk({ ok: true });
    }

    if (op === "approve") {
      if (!["DRAFT", "IN_REVIEW"].includes(protocol.status)) return jsonError("INVALID_TRANSITION", 409);
      const nextVersion = protocol.version + 1;
      const snapshot: Record<string, unknown> = {};
      for (const f of SNAPSHOT_FIELDS) snapshot[f] = (protocol as unknown as Record<string, unknown>)[f];
      await db.$transaction(async (tx) => {
        await tx.screeningProtocol.update({ where: { id }, data: { status: "APPROVED", approvedById: user.id, approvedAt: new Date(), version: nextVersion } });
        await tx.protocolVersion.create({ data: { protocolId: id, version: nextVersion, snapshot: JSON.stringify(snapshot), publishedById: user.id, note } });
        await tx.protocolReview.create({
          data: { protocolId: id, officerId: user.id, officerName: user.fullName, action: "APPROVE", fromStatus: protocol.status, toStatus: "APPROVED", note, snapshot: JSON.stringify(snapshot) },
        });
      });
      await logAudit("PROTOCOL_APPROVE", { req, actorUserId: user.id, actorRole: user.role, entityType: "ScreeningProtocol", entityId: id, meta: { version: nextVersion } });
      await recordAndPublish({ type: "REVIEW_STATE", payload: { protocolApproved: true, key: protocol.key, version: nextVersion } });
      return jsonOk({ ok: true, version: nextVersion });
    }

    if (op === "return") {
      // الملاحظة إلزامية عند الإرجاع
      if (!note) return jsonError("NOTE_REQUIRED", 400);
      if (!["DRAFT", "IN_REVIEW", "APPROVED"].includes(protocol.status)) return jsonError("INVALID_TRANSITION", 409);
      await db.screeningProtocol.update({ where: { id }, data: { status: "DRAFT", approvedById: null, approvedAt: null } });
      await db.protocolReview.create({
        data: { protocolId: id, officerId: user.id, officerName: user.fullName, action: "RETURN", fromStatus: protocol.status, toStatus: "DRAFT", note },
      });
      await logAudit("PROTOCOL_RETURN", { req, actorUserId: user.id, actorRole: user.role, entityType: "ScreeningProtocol", entityId: id });
      return jsonOk({ ok: true });
    }

    if (op === "retire") {
      if (protocol.status === "RETIRED") return jsonError("INVALID_TRANSITION", 409);
      await db.screeningProtocol.update({ where: { id }, data: { status: "RETIRED", active: false } });
      await db.protocolReview.create({
        data: { protocolId: id, officerId: user.id, officerName: user.fullName, action: "RETIRE", fromStatus: protocol.status, toStatus: "RETIRED", note },
      });
      await logAudit("PROTOCOL_RETIRE", { req, actorUserId: user.id, actorRole: user.role, entityType: "ScreeningProtocol", entityId: id });
      return jsonOk({ ok: true });
    }
    return jsonError("UNKNOWN_OP", 400);
  }

  // ================= قواعد القيم الحرجة =================
  if (kind === "rule") {
    const id = String(body?.id ?? "");
    const rule = await db.criticalRule.findUnique({ where: { id } });
    if (!rule) return jsonError("NOT_FOUND", 404);

    if (op === "start-review") {
      if (rule.status !== "DRAFT") return jsonError("INVALID_TRANSITION", 409);
      await db.criticalRule.update({ where: { id }, data: { status: "IN_REVIEW" } });
      await logAudit("RULE_REVIEW_START", { req, actorUserId: user.id, actorRole: user.role, entityType: "CriticalRule", entityId: id });
      return jsonOk({ ok: true });
    }
    if (op === "approve") {
      if (!["DRAFT", "IN_REVIEW"].includes(rule.status)) return jsonError("INVALID_TRANSITION", 409);
      await db.criticalRule.update({ where: { id }, data: { status: "APPROVED", approvedById: user.id, approvedAt: new Date(), version: rule.version + 1 } });
      invalidateCriticalRulesCache();
      await logAudit("RULE_APPROVE", { req, actorUserId: user.id, actorRole: user.role, entityType: "CriticalRule", entityId: id, meta: { version: rule.version + 1 } });
      await recordAndPublish({ type: "REVIEW_STATE", payload: { ruleApproved: true, key: rule.key } });
      return jsonOk({ ok: true });
    }
    if (op === "return") {
      if (!note) return jsonError("NOTE_REQUIRED", 400);
      if (rule.status === "RETIRED") return jsonError("INVALID_TRANSITION", 409);
      await db.criticalRule.update({ where: { id }, data: { status: "DRAFT", approvedById: null, approvedAt: null } });
      invalidateCriticalRulesCache();
      await logAudit("RULE_RETURN", { req, actorUserId: user.id, actorRole: user.role, entityType: "CriticalRule", entityId: id });
      return jsonOk({ ok: true });
    }
    if (op === "retire") {
      await db.criticalRule.update({ where: { id }, data: { status: "RETIRED" } });
      invalidateCriticalRulesCache();
      await logAudit("RULE_RETIRE", { req, actorUserId: user.id, actorRole: user.role, entityType: "CriticalRule", entityId: id });
      return jsonOk({ ok: true });
    }
    return jsonError("UNKNOWN_OP", 400);
  }

  return jsonError("UNKNOWN_KIND", 400);
}
