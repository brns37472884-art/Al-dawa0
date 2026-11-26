import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireCapability } from "@/lib/permissions";
import { jsonError, jsonOk } from "@/lib/auth";
import { logAudit } from "@/lib/api-utils";
import { patientFile } from "@/app/api/doctor/route";

/** GET /api/doctor/patient/[id] — ملف متابعة المريض (بشرط الإسناد + DOCTOR_SHARE) */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireCapability("doctor:inbox");
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const patient = await patientFile(user.id, id);
  if (!patient) return jsonError("FORBIDDEN", 403);
  await logAudit("DOCTOR_PATIENT_FILE_VIEW", { actorUserId: user.id, actorRole: user.role, entityType: "User", entityId: id });

  const safeJson = (s: string, f: unknown) => {
    try {
      return JSON.parse(s);
    } catch {
      return f;
    }
  };
  const profile = patient.patientProfile;
  const timeline = await db.extractedValue.findMany({
    where: {
      report: { ownerUserId: id, status: { in: ["EXTRACTED", "CONFIRMED", "CONFIRMED_LAB", "UNDER_REVIEW", "REVIEWED", "NEEDS_INFO"] } },
      canonicalKey: { not: null },
    },
    orderBy: { testDate: "desc" },
    take: 400,
    select: { canonicalKey: true, rawName: true, value: true, unit: true, refLow: true, refHigh: true, flag: true, testDate: true },
  });
  const reports = await db.medicalReport.findMany({
    where: { ownerUserId: id },
    orderBy: { uploadedAt: "desc" },
    take: 30,
    select: { id: true, fileName: true, status: true, testDate: true, uploadedAt: true, reportType: true },
  });
  const plans = await db.followUpPlan.findMany({
    where: { patientId: id, doctorId: user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return jsonOk({
    patient: {
      id: patient.id,
      fullName: patient.fullName,
      age: profile?.dateOfBirth ? Math.floor((Date.now() - profile.dateOfBirth.getTime()) / (365.25 * 24 * 3600 * 1000)) : null,
      gender: profile?.gender ?? null,
      bp: profile?.bpSystolic ? `${profile.bpSystolic}/${profile.bpDiastolic ?? "—"}` : null,
      heightCm: profile?.heightCm ?? null,
      weightKg: profile?.weightKg ?? null,
      chronic: safeJson(profile?.chronicConditions ?? "[]", []),
      medications: safeJson(profile?.medications ?? "[]", []),
      allergies: safeJson(profile?.allergies ?? "[]", []),
      familyHistory: safeJson(profile?.familyHistory ?? "[]", []),
      smokingStatus: profile?.smokingStatus ?? null,
    },
    timeline,
    reports,
    plans,
  });
}
