import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireLab } from "@/lib/permissions";
import { jsonError, jsonOk } from "@/lib/auth";
import { readJson } from "@/lib/api-utils";

/** GET /api/lab — نظرة اليوم للمعمل (طلباته فقط) */
export async function GET() {
  const ctx = await requireLab();
  if (ctx instanceof Response) return ctx;
  const { labId, canReviewHolds } = ctx;
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  const [todayUploads, pendingCount, correctionsCount, criticalCount, openOrders] = await Promise.all([
    db.medicalReport.count({ where: { labId, source: "LAB_DIRECT", uploadedAt: { gte: dayStart } } }),
    db.pendingLabResult.count({ where: { labId, status: "PENDING" } }),
    db.reportCorrection.count({ where: { labId, status: "OPEN" } }),
    db.medicalReport.count({ where: { labId, source: "LAB_DIRECT", uploadedAt: { gte: dayStart }, values: { some: { flag: { startsWith: "CRITICAL" } } } } }),
    db.labOrder.count({ where: { labId, status: { in: ["CREATED", "IN_PROGRESS", "RESULT_UPLOADED"] } } }),
  ]);

  const recent = await db.medicalReport.findMany({
    where: { labId, source: "LAB_DIRECT" },
    orderBy: { uploadedAt: "desc" },
    take: 8,
    include: {
      owner: { select: { fullName: true, phone: true } },
      values: { select: { flag: true, verification: true } },
      corrections: { where: { status: "OPEN" }, select: { id: true } },
      reviews: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true } },
    },
  });
  const pending = await db.pendingLabResult.findMany({
    where: { labId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: { id: true, patientName: true, fileName: true, claimToken: true, createdAt: true, expiresAt: true, patientPhone: true },
  });
  const holds = await db.identityHold.findMany({
    where: { labId, status: "OPEN" },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const orders = await db.labOrder.findMany({
    where: { labId, status: { in: ["CREATED", "IN_PROGRESS", "RESULT_UPLOADED"] } },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { patient: { select: { fullName: true } } },
  });

  const { decryptText } = await import("@/lib/crypto-file");
  return jsonOk({
    lab: { canReviewHolds },
    today: { uploads: todayUploads, pending: pendingCount, corrections: correctionsCount },
    totals: { critical: criticalCount, openOrders },
    recent: recent.map((r) => ({
      id: r.id,
      fileName: r.fileName,
      status: r.status,
      uploadedAt: r.uploadedAt,
      patientName: r.owner.fullName,
      phoneMasked: r.owner.phone ? `${r.owner.phone.slice(0, -4)}****` : null,
      openedByPatient: !!r.patientOpenedAt,
      critical: r.values.some((v) => v.flag.startsWith("CRITICAL")),
      verifiedCount: r.values.filter((v) => v.verification === "VERIFIED_LAB" || v.verification === "CORRECTED_LAB").length,
      valuesCount: r.values.length,
      openCorrections: r.corrections.length,
      reviewStatus: r.reviews[0]?.status ?? null,
    })),
    pending: pending.map((p) => {
      const plain = decryptText(p.patientPhone) || "";
      return { ...p, patientPhone: undefined, phoneMasked: plain ? `${plain.slice(0, -4)}****` : null };
    }),
    orders: orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      qrToken: o.qrToken,
      status: o.status,
      patientName: o.patient.fullName,
      testKeys: JSON.parse(o.testKeys) as string[],
      note: o.note,
      createdAt: o.createdAt,
    })),
    holds: holds.map((h) => ({ id: h.id, reportId: h.reportId, orderNumber: h.orderNumber, expectedName: h.expectedName, providedName: h.providedName, createdAt: h.createdAt })),
  });
}

/** POST /api/lab — البحث برقم موبايل العميل (مسار المرجع) */
export async function POST(req: NextRequest) {
  const ctx = await requireLab();
  if (ctx instanceof Response) return ctx;
  const body = await readJson(req);
  const phoneRaw = String(body?.phone ?? "");
  const { normalizePhone } = await import("@/lib/helpers");
  const phone = normalizePhone(phoneRaw);
  if (!phone) return jsonError("INVALID_PHONE", 400);
  const { rateLimit } = await import("@/lib/rate-limit");
  if (!(await rateLimit(`lab-search:${ctx.labId}`, 120, 60 * 60 * 1000))) return jsonError("RATE_LIMITED", 429);

  const patient = await db.user.findFirst({
    where: { phone, role: "PATIENT", isActive: true },
    include: { consents: { where: { type: "LAB_RESULT_SHARING" } } },
  });
  if (!patient) return jsonOk({ found: false, delivery: "PENDING", reason: "NOT_REGISTERED", fullName: null });
  const consented = !!patient.consents.some((c) => c.granted);
  return jsonOk({
    found: true,
    delivery: consented ? "DIRECT" : "PENDING",
    reason: consented ? null : "NO_CONSENT",
    fullName: patient.fullName,
  });
}
