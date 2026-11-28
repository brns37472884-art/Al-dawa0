import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { jsonOk, jsonError, getSessionUser } from "@/lib/auth";
import { readJson } from "@/lib/api-utils";

/** GET /api/notifications — آخر 50 + غير مقروء */
export async function GET() {
  // أي مستخدم مسجّل (مريض/دكتور/معمل/أدمن/مسؤول) — الاستعلام مقيّد بـ userId نفسه
  const user = await getSessionUser();
  if (!user) return jsonError("UNAUTHORIZED", 401);
  const [items, unread] = await Promise.all([
    db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.notification.count({ where: { userId: user.id, isRead: false } }),
  ]);
  return jsonOk({ items, unread });
}

/** PATCH — تعليم مقروء (واحد أو الكل) */
export async function PATCH(req: NextRequest) {
  // أي مستخدم مسجّل (مريض/دكتور/معمل/أدمن/مسؤول) — الاستعلام مقيّد بـ userId نفسه
  const user = await getSessionUser();
  if (!user) return jsonError("UNAUTHORIZED", 401);
  const body = await readJson(req);
  if (body?.id) {
    await db.notification.updateMany({ where: { id: String(body.id), userId: user.id }, data: { isRead: true } });
  } else {
    await db.notification.updateMany({ where: { userId: user.id, isRead: false }, data: { isRead: true } });
  }
  return jsonOk({ ok: true });
}

