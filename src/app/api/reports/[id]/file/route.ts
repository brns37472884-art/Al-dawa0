import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireCapability } from "@/lib/permissions";
import { jsonError } from "@/lib/auth";
import { logAudit } from "@/lib/api-utils";
import { storage } from "@/lib/storage";

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  json: "application/json",
};

/** GET /api/reports/[id]/file — الملف الأصلي لمن يحق له فقط، بلا تخزين مؤقت */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireCapability("patient:self");
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const report = await db.medicalReport.findUnique({ where: { id } });
  if (!report) return jsonError("NOT_FOUND", 404);
  const isOwner = report.ownerUserId === user.id;
  const isDoctor = user.role === "DOCTOR" && (report.assignedDoctorId === user.id || !!(await db.doctorReview.findFirst({ where: { reportId: id, doctorId: user.id } })));
  if (!isOwner && !isDoctor) return jsonError("FORBIDDEN", 403);
  if (!report.filePath) return jsonError("NO_ORIGINAL_FILE", 404);

  if (!isOwner) {
    await logAudit("ORIGINAL_FILE_VIEW", { actorUserId: user.id, actorRole: user.role, entityType: "MedicalReport", entityId: id });
  }
  try {
    const buf = await storage().read(report.filePath);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": MIME[report.fileType] ?? "application/octet-stream",
        "Content-Disposition": `inline; filename="report.${report.fileType}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return jsonError("FILE_NOT_FOUND", 404);
  }
}
