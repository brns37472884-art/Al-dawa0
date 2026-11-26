import { db } from "@/lib/db";
import { requireCapability } from "@/lib/permissions";
import { jsonOk } from "@/lib/auth";

/** GET /api/labs — المعامل الشريكة النشطة (للعميل والزوار) */
export async function GET() {
  void requireCapability;
  const labs = await db.lab.findMany({
    where: { isActive: true, isVerified: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, markaz: { select: { name: true, nameEn: true } }, address: true, contactPhone: true },
  });
  return jsonOk({ labs });
}
