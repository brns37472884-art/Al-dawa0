import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireCapability } from "@/lib/permissions";
import { jsonError, jsonOk } from "@/lib/auth";
import { readJson, logAudit, notify } from "@/lib/api-utils";
import { normalizePhone, calcAge, safeJsonParse } from "@/lib/helpers";
import { recomputePlan } from "@/lib/screening/service";
import { extractRiskFactors, type EngineProfileInput } from "@/lib/screening/engine";

const HEALTH_KEYS = ["dateOfBirth", "gender", "smokingStatus", "chronicConditions", "familyHistory", "heightCm", "weightKg", "personalCancerHistory", "bpSystolic"];

function completeness(p: Record<string, unknown> | null): number {
  if (!p) return 0;
  const fields = ["dateOfBirth", "gender", "gov", "heightCm", "weightKg", "bpSystolic", "bpDiastolic", "chronicConditions", "medications", "allergies", "familyHistory", "smokingStatus"];
  const done = fields.filter((f) => {
    const v = p[f];
    if (v === null || v === undefined) return false;
    if (typeof v === "string" && v.trim() === "") return false;
    if (typeof v === "string" && ["[]", "{}"].includes(v.trim())) return false;
    return true;
  }).length;
  return Math.round((done / fields.length) * 100);
}

export async function GET() {
  const user = await requireCapability("patient:self");
  if (user instanceof Response) return user;
  const profile = await db.patientProfile.findUnique({ where: { userId: user.id } });
  const consents = await db.consent.findMany({ where: { userId: user.id } });
  const dbUser = await db.user.findUnique({ where: { id: user.id }, select: { phone: true, email: true, fullName: true } });
  const rf = await db.riskFactorAssessment.findUnique({ where: { userId: user.id } });
  return jsonOk({
    profile,
    consents,
    user: dbUser,
    completeness: completeness(profile as unknown as Record<string, unknown>),
    riskFactors: rf ? safeJsonParse<Array<{ key: string; labelAr: string; labelEn: string; whyAr: string; whyEn: string }>>(rf.factors, []) : [],
  });
}

export async function PUT(req: NextRequest) {
  const user = await requireCapability("patient:self");
  if (user instanceof Response) return user;
  const body = await readJson(req);
  if (!body) return jsonError("INVALID_BODY", 400);

  const data: Record<string, unknown> = {};
  // نصوص مقيدة
  for (const k of ["gender", "gov", "city", "emergencyContact", "smokingStatus", "activityLevel"]) {
    if (body[k] !== undefined) {
      const v = String(body[k]).trim().slice(0, 120) || null;
      if (k === "gender" && v && !["MALE", "FEMALE"].includes(v)) return jsonError("INVALID_GENDER", 400);
      if (k === "smokingStatus" && v && !["NEVER", "FORMER", "CURRENT"].includes(v)) return jsonError("INVALID_VALUE", 400);
      if (k === "activityLevel" && v && !["SEDENTARY", "LIGHT", "MODERATE", "ACTIVE"].includes(v)) return jsonError("INVALID_VALUE", 400);
      data[k] = v;
    }
  }
  // أرقام بمدى
  const numRanges: Record<string, [number, number]> = {
    heightCm: [50, 260], weightKg: [2, 500], bpSystolic: [50, 300], bpDiastolic: [30, 200], quitYearsAgo: [0, 100],
  };
  for (const [k, [lo, hi]] of Object.entries(numRanges)) {
    if (body[k] !== undefined && body[k] !== null && body[k] !== "") {
      const n = Number(body[k]);
      if (!Number.isFinite(n) || n < lo || n > hi) return jsonError("INVALID_NUMBER", 400, { field: k });
      data[k] = n;
    }
  }
  if (body.dateOfBirth !== undefined) {
    const d = body.dateOfBirth ? new Date(String(body.dateOfBirth)) : null;
    if (d && (Number.isNaN(d.getTime()) || d.getTime() > Date.now() || d.getTime() < new Date("1900-01-01").getTime())) {
      return jsonError("INVALID_DOB", 400);
    }
    data.dateOfBirth = d;
  }
  // JSON مصفوفات/كائنات
  for (const k of ["chronicConditions", "medications", "allergies", "surgeries", "familyHistory", "geneticRiskFactors", "reproductiveInfo"]) {
    if (body[k] !== undefined) {
      try {
        JSON.stringify(body[k]);
      } catch {
        return jsonError("INVALID_JSON", 400, { field: k });
      }
      data[k] = JSON.stringify(body[k]);
    }
  }
  if (body.personalCancerHistory !== undefined) data.personalCancerHistory = body.personalCancerHistory === true;

  await db.patientProfile.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...data },
    update: data,
  });
  await logAudit("PROFILE_UPDATE", { req, actorUserId: user.id, actorRole: user.role, meta: { keys: Object.keys(data) } });

  // الموبايل والاسم على الحساب
  if (body.phone !== undefined) {
    const phone = normalizePhone(String(body.phone));
    if (!phone) return jsonError("INVALID_PHONE", 400);
    const dupe = await db.user.findFirst({ where: { phone, id: { not: user.id } } });
    if (dupe) return jsonError("PHONE_EXISTS", 409);
    await db.user.update({ where: { id: user.id }, data: { phone, phoneVerifiedAt: new Date() } });
  }
  if (body.fullName !== undefined) {
    const fullName = String(body.fullName).trim().slice(0, 120);
    if (fullName.length < 3) return jsonError("INVALID_NAME", 400);
    await db.user.update({ where: { id: user.id }, data: { fullName } });
  }

  // الموافقات — بولياني صارم، وسحب موفقة يقص استقبال البيانات الجديدة فورًا
  if (body.consents && typeof body.consents === "object") {
    const map: Record<string, string> = {
      data: "DATA_PROCESSING", ai: "AI_ANALYSIS", doctor: "DOCTOR_SHARE",
      notifications: "NOTIFICATIONS", research: "RESEARCH", labShare: "LAB_RESULT_SHARING",
    };
    for (const [k, type] of Object.entries(map)) {
      const v = (body.consents as Record<string, unknown>)[k];
      if (v === undefined) continue;
      if (typeof v !== "boolean") return jsonError("INVALID_CONSENT_VALUE", 400);
      const existing = await db.consent.findUnique({ where: { userId_type: { userId: user.id, type: type as never } } });
      const wasGranted = !!existing?.granted;
      await db.consent.upsert({
        where: { userId_type: { userId: user.id, type: type as never } },
        create: { userId: user.id, type: type as never, granted: v, source: v ? "REGISTER" : "WITHDRAWN", withdrawnAt: v ? null : new Date() },
        update: { granted: v, source: v ? (wasGranted ? existing?.source ?? null : "RE_GRANTED") : "WITHDRAWN", withdrawnAt: v ? null : new Date() },
      });
      if (wasGranted && !v) {
        await logAudit("CONSENT_WITHDRAWN", { req, actorUserId: user.id, actorRole: user.role, meta: { type } });
        await notify(user.id, {
          type: "BROADCAST",
          titleAr: "تم سحب موافقة", titleEn: "Consent withdrawn",
          bodyAr: "سحبت موافقة من موافقاتك — يتوقف استقبال البيانات الجديدة المرتبطة بها فورًا.",
          bodyEn: "You withdrew a consent — new data intake related to it stops immediately.",
          severity: "WARNING",
          link: "/app/consents",
        });
      }
    }
  }

  // إعادة حساب الخطة عند تغيّر مدخلات صحية مؤثرة
  const changedHealth = HEALTH_KEYS.some((k) => k in data);
  if (changedHealth) await recomputePlan(user.id);

  const profile = await db.patientProfile.findUnique({ where: { userId: user.id } });
  return jsonOk({ profile, completeness: completeness(profile as unknown as Record<string, unknown>) });
}

/** POST ops: catalog / risk-preview */
export async function POST(req: NextRequest) {
  const user = await requireCapability("patient:self");
  if (user instanceof Response) return user;
  const body = await readJson(req);
  const op = String(body?.op ?? "");
  if (op === "catalog") {
    const { CHRONIC_CONDITION_KEYS, FAMILY_HISTORY_KEYS, RELATIONS, GOVERNORATES } = await import("@/lib/screening/engine");
    return jsonOk({ chronic: CHRONIC_CONDITION_KEYS, family: FAMILY_HISTORY_KEYS, relations: RELATIONS, governorates: GOVERNORATES });
  }
  if (op === "risk-preview") {
    const profile = await db.patientProfile.findUnique({ where: { userId: user.id } });
    if (!profile?.dateOfBirth) return jsonOk({ factors: [] });
    const chronic = safeJsonParse<Array<{ key: string }>>(profile.chronicConditions, []).map((c) => c.key);
    const repro = safeJsonParse<{ pregnant?: boolean }>(profile.reproductiveInfo, {});
    const input: EngineProfileInput = {
      age: calcAge(profile.dateOfBirth) ?? 0,
      gender: profile.gender,
      smokingStatus: profile.smokingStatus,
      quitYearsAgo: profile.quitYearsAgo,
      chronicConditions: chronic,
      familyHistory: safeJsonParse(profile.familyHistory, []),
      personalCancerHistory: profile.personalCancerHistory,
      pregnant: !!repro.pregnant,
      heightCm: profile.heightCm,
      weightKg: profile.weightKg,
      bpSystolic: profile.bpSystolic,
      bpDiastolic: profile.bpDiastolic,
      lastDone: {},
    };
    return jsonOk({ factors: extractRiskFactors(input) });
  }
  return jsonError("UNKNOWN_OP", 400);
}

