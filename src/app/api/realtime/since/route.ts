import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { userMaySeeEvent } from "@/lib/events";

/**
 * GET /api/realtime/since?cursor=N — بديل polling بـ ETag.
 * يعيد الأحداث المصرّح بها بعد المؤشر — بلا أي بيانات طبية.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const cursor = Number(req.nextUrl.searchParams.get("cursor") || 0) || 0;
  const take = Math.min(Number(req.nextUrl.searchParams.get("take") || 50) || 50, 200);

  const rows = await db.domainEvent.findMany({
    where: { seq: { gt: cursor } },
    orderBy: { seq: "asc" },
    take,
  });
  const allowed = rows
    .filter((r) => userMaySeeEvent(user, r))
    .map((r) => {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(r.payload);
      } catch {
        payload = {};
      }
      return {
        seq: r.seq,
        id: r.id,
        type: r.type,
        reportId: r.reportId,
        patientId: r.patientId,
        labId: r.labId,
        doctorId: r.doctorId,
        orderId: r.orderId,
        version: r.version,
        occurredAt: r.occurredAt.toISOString(),
        payload,
      };
    });
  const maxSeq = allowed.length ? allowed[allowed.length - 1].seq : cursor;
  const etag = `"rt-${maxSeq}-${allowed.length}"`;

  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }
  return Response.json(
    { events: allowed, cursor: maxSeq },
    { headers: { ETag: etag, "Cache-Control": "no-store" } }
  );
}
