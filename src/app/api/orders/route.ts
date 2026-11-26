import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireCapability } from "@/lib/permissions";
import { jsonError, jsonOk } from "@/lib/auth";
import { readJson, logAudit } from "@/lib/api-utils";
import { EventRecorder, recordAndPublish } from "@/lib/events";
import { generateOrderNumber } from "@/lib/helpers";
import { qrToken } from "@/lib/crypto-file";

/** GET /api/orders — طلبات العميل (برقم الطلب + محتوى QR) */
export async function GET() {
  const user = await requireCapability("patient:self");
  if (user instanceof Response) return user;
  const orders = await db.labOrder.findMany({
    where: { patientId: user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      lab: { select: { id: true, name: true, markaz: { select: { name: true } } } },
      reports: { select: { id: true, status: true, currentVersion: true }, take: 5 },
    },
  });
  return jsonOk({
    orders: orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      qrToken: o.qrToken,
      status: o.status,
      labName: o.lab.name,
      markaz: o.lab.markaz?.name ?? null,
      testKeys: JSON.parse(o.testKeys) as string[],
      note: o.note,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
      reports: o.reports,
    })),
  });
}

/** POST /api/orders — إنشاء طلب فحص عند معمل شريك → يظهر للمعمل فورًا (Outbox) */
export async function POST(req: NextRequest) {
  const user = await requireCapability("patient:self");
  if (user instanceof Response) return user;
  const body = await readJson(req);
  if (!body) return jsonError("INVALID_BODY", 400);
  const labId = String(body.labId ?? "");
  const note = String(body.note ?? "").trim().slice(0, 500) || null;
  const testKeys = Array.isArray(body.testKeys) ? (body.testKeys as string[]).slice(0, 30).map((k) => String(k).slice(0, 60)) : [];
  if (!labId) return jsonError("MISSING_FIELDS", 400);
  const lab = await db.lab.findFirst({ where: { id: labId, isActive: true, isVerified: true } });
  if (!lab) return jsonError("LAB_NOT_AVAILABLE", 400);

  const count = await db.labOrder.count();
  const recorder = new EventRecorder();
  const order = await db.$transaction(async (tx) => {
    const o = await tx.labOrder.create({
      data: {
        orderNumber: generateOrderNumber(count + 1),
        qrToken: qrToken(),
        status: "CREATED",
        patientId: user.id,
        labId,
        testKeys: JSON.stringify(testKeys),
        note,
      },
    });
    // حدث في نفس الـ transaction — يصل للمعمل لحظيًا بلا تحديث صفحة
    recorder.bind(tx);
    await recorder.add({ type: "ORDER_CREATED", orderId: o.id, patientId: user.id, labId, payload: { orderNumber: o.orderNumber } });
    return o;
  });
  await recorder.flush();
  await logAudit("ORDER_CREATE", { req, actorUserId: user.id, actorRole: user.role, entityType: "LabOrder", entityId: order.id, meta: { labId } });
  return jsonOk({ id: order.id, orderNumber: order.orderNumber, qrToken: order.qrToken }, 201);
}

/** PATCH — إلغاء طلب (قبل رفع نتيجة) */
export async function PATCH(req: NextRequest) {
  const user = await requireCapability("patient:self");
  if (user instanceof Response) return user;
  const body = await readJson(req);
  const id = String(body?.id ?? "");
  const order = await db.labOrder.findFirst({ where: { id, patientId: user.id } });
  if (!order) return jsonError("NOT_FOUND", 404);
  if (order.status !== "CREATED") return jsonError("CANNOT_CANCEL", 409, { status: order.status });
  await db.labOrder.update({ where: { id }, data: { status: "CANCELLED" } });
  await recordAndPublish({ type: "ORDER_CREATED", orderId: id, labId: order.labId, payload: { cancelled: true } });
  return jsonOk({ ok: true });
}

/** GET /api/orders/labs — المعامل النشطة للاختيار */
export async function labsList() {
  const labs = await db.lab.findMany({
    where: { isActive: true, isVerified: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, markaz: { select: { name: true } }, address: true },
  });
  return labs;
}
