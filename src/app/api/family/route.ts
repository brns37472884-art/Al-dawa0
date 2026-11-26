import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireCapability } from "@/lib/permissions";
import { jsonError, jsonOk } from "@/lib/auth";
import { readJson, logAudit } from "@/lib/api-utils";

const RELATIONS = ["SPOUSE", "SON", "DAUGHTER", "FATHER", "MOTHER", "BROTHER", "SISTER", "OTHER"];

export async function GET() {
  const user = await requireCapability("patient:family");
  if (user instanceof Response) return user;
  const members = await db.familyMember.findMany({ where: { ownerUserId: user.id }, take: 100, orderBy: { createdAt: "asc" } });
  return jsonOk({ members });
}

export async function POST(req: NextRequest) {
  const user = await requireCapability("patient:family");
  if (user instanceof Response) return user;
  const body = await readJson(req);
  if (!body) return jsonError("INVALID_BODY", 400);
  const count = await db.familyMember.count({ where: { ownerUserId: user.id } });
  if (count >= 100) return jsonError("FAMILY_LIMIT_REACHED", 429, { limit: 100 });
  const name = String(body.name ?? "").trim().slice(0, 120);
  const relation = String(body.relation ?? "");
  if (name.length < 2) return jsonError("INVALID_NAME", 400);
  if (!RELATIONS.includes(relation)) return jsonError("INVALID_RELATION", 400);
  const dob = body.dateOfBirth ? new Date(String(body.dateOfBirth)) : null;
  if (dob && (Number.isNaN(dob.getTime()) || dob.getTime() > Date.now())) return jsonError("INVALID_DOB", 400);
  const heightCm = body.heightCm != null && body.heightCm !== "" ? Number(body.heightCm) : null;
  const weightKg = body.weightKg != null && body.weightKg !== "" ? Number(body.weightKg) : null;
  if (heightCm !== null && (!Number.isFinite(heightCm) || heightCm < 30 || heightCm > 260)) return jsonError("INVALID_NUMBER", 400, { field: "heightCm" });
  if (weightKg !== null && (!Number.isFinite(weightKg) || weightKg < 1 || weightKg > 500)) return jsonError("INVALID_NUMBER", 400, { field: "weightKg" });

  const member = await db.familyMember.create({
    data: {
      ownerUserId: user.id,
      name,
      relation,
      dateOfBirth: dob,
      gender: ["MALE", "FEMALE"].includes(String(body.gender ?? "")) ? String(body.gender) : null,
      heightCm,
      weightKg,
    },
  });
  await logAudit("FAMILY_ADD", { req, actorUserId: user.id, actorRole: user.role, entityType: "FamilyMember", entityId: member.id });
  return jsonOk({ member }, 201);
}

export async function PATCH(req: NextRequest) {
  const user = await requireCapability("patient:family");
  if (user instanceof Response) return user;
  const body = await readJson(req);
  if (!body) return jsonError("INVALID_BODY", 400);
  const id = String(body.id ?? "");
  const member = await db.familyMember.findFirst({ where: { id, ownerUserId: user.id } });
  if (!member) return jsonError("NOT_FOUND", 404);
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim().slice(0, 120);
    if (name.length < 2) return jsonError("INVALID_NAME", 400);
    data.name = name;
  }
  if (body.relation !== undefined) {
    if (!RELATIONS.includes(String(body.relation))) return jsonError("INVALID_RELATION", 400);
    data.relation = String(body.relation);
  }
  if (body.healthData !== undefined) data.healthData = JSON.stringify(body.healthData);
  const updated = await db.familyMember.update({ where: { id }, data });
  await logAudit("FAMILY_UPDATE", { req, actorUserId: user.id, actorRole: user.role, entityType: "FamilyMember", entityId: id });
  return jsonOk({ member: updated });
}

export async function DELETE(req: NextRequest) {
  const user = await requireCapability("patient:family");
  if (user instanceof Response) return user;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const member = await db.familyMember.findFirst({ where: { id, ownerUserId: user.id } });
  if (!member) return jsonError("NOT_FOUND", 404);
  await db.familyMember.delete({ where: { id } });
  await logAudit("FAMILY_DELETE", { req, actorUserId: user.id, actorRole: user.role, entityType: "FamilyMember", entityId: id });
  return jsonOk({ ok: true });
}
