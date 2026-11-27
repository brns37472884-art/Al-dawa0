import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/permissions";
import { jsonError } from "@/lib/auth";

/** GET /api/payments/requests/[id]/proof — صورة الإيصال: لصاحب الطلب أو الإدارة فقط */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const row = await db.paymentRequest.findUnique({ where: { id }, select: { userId: true, proofData: true, proofMime: true } });
  if (!row || (row.userId !== user.id && user.role !== "ADMIN")) return jsonError("NOT_FOUND", 404);
  return new Response(new Uint8Array(row.proofData), {
    headers: {
      "Content-Type": row.proofMime,
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
