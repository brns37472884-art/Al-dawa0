import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireCapability } from "@/lib/permissions";
import { jsonOk } from "@/lib/auth";
import { readJson } from "@/lib/api-utils";

/** GET /api/notifications — آخر 50 + غير مقروء */
export async function GET() {
  const user = await requireCapability("patient:self");
  if (user instanceof Response) return user;
  const [items, unread] = await Promise.all([
    db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.notification.count({ where: { userId: user.id, isRead: false } }),
  ]);
  return jsonOk({ items, unread });
}

/** PATCH — تعليم مقروء (واحد أو الكل) */
export async function PATCH(req: NextRequest) {
  const user = await requireCapability("patient:self");
  if (user instanceof Response) return user;
  const body = await readJson(req);
  if (body?.id) {
    await db.notification.updateMany({ where: { id: String(body.id), userId: user.id }, data: { isRead: true } });
  } else {
    await db.notification.updateMany({ where: { userId: user.id, isRead: false }, data: { isRead: true } });
  }
  return jsonOk({ ok: true });
}

