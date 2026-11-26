import { db } from "@/lib/db";

/** GET /api/ready — عام: قاعدة + طول طابور الأحداث غير المنشورة */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    const pendingEvents = await db.domainEvent.count({ where: { publishedAt: null } });
    return Response.json({ ok: true, db: "up", pendingEvents });
  } catch {
    return Response.json({ ok: false, db: "down" }, { status: 503 });
  }
}
