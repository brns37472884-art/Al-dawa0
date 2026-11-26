import { db } from "@/lib/db";

/** GET /api/plans — الباقات من قاعدة البيانات (لا أرقام ثابتة في الواجهة) */
export async function GET() {
  const plans = await db.plan.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { key: true, nameAr: true, nameEn: true, priceEgp: true, reportsLimit: true, featuresAr: true, featuresEn: true, includesReview: true, isActive: true, sortOrder: true },
  });
  return Response.json({
    plans: plans.map((p) => ({
      ...p,
      featuresAr: JSON.parse(p.featuresAr) as string[],
      featuresEn: JSON.parse(p.featuresEn) as string[],
    })),
  });
}
