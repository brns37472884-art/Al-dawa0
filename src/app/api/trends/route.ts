import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireCapability } from "@/lib/permissions";
import { jsonOk } from "@/lib/auth";

/** GET /api/trends?key=&member= — اتجاهات مؤشر: نفس الوحدة فقط وصياغة محايدة */
export async function GET(req: NextRequest) {
  const user = await requireCapability("patient:self");
  if (user instanceof Response) return user;
  const key = req.nextUrl.searchParams.get("key") ?? "";
  const member = req.nextUrl.searchParams.get("member") || "me";
  const familyMemberId = member === "me" ? null : member;

  const availableKeys = await db.extractedValue.findMany({
    where: { report: { ownerUserId: user.id, familyMemberId }, canonicalKey: { not: null } },
    distinct: ["canonicalKey"],
    select: { canonicalKey: true },
    take: 200,
  });

  const catalog = await db.testCatalog.findMany({ where: { isActive: true } });
  if (!key) {
    return jsonOk({ availableKeys: availableKeys.map((a) => a.canonicalKey), catalog: catalog.map((c) => ({ key: c.key, nameAr: c.nameAr, nameEn: c.nameEn, unit: c.unit })) });
  }

  const values = await db.extractedValue.findMany({
    where: { canonicalKey: key, report: { ownerUserId: user.id, familyMemberId, status: { in: ["EXTRACTED", "CONFIRMED", "CONFIRMED_LAB", "UNDER_REVIEW", "REVIEWED"] } } },
    orderBy: { testDate: "asc" },
    take: 100,
    include: { report: { select: { uploadedAt: true, labName: true } } },
  });
  const cat = catalog.find((c) => c.key === key) ?? null;
  const series = values.map((v) => ({
    id: v.id,
    value: v.value,
    valueText: v.valueText,
    unit: v.unit,
    refLow: v.refLow,
    refHigh: v.refHigh,
    flag: v.flag,
    verified: v.verification,
    date: v.testDate ?? v.report.uploadedAt ?? v.createdAt,
    source: v.report.labName ?? "تحليل",
  }));
  const last = series.at(-1) ?? null;
  const prev = series.at(-2) ?? null;
  const deltaPct = last && prev && last.value !== null && prev.value !== null && prev.value !== 0 ? ((last.value - prev.value) / prev.value) * 100 : null;
  const direction = deltaPct === null ? null : deltaPct > 0 ? "UP" : deltaPct < 0 ? "DOWN" : "FLAT";
  const meaningful = deltaPct !== null && Math.abs(deltaPct) >= 15;

  return jsonOk({
    availableKeys: availableKeys.map((a) => a.canonicalKey),
    catalogEntry: cat,
    series,
    last: last ?? null,
    deltaPct,
    direction,
    meaningful,
  });
}
