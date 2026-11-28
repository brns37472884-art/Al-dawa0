import { db } from "@/lib/db";

/** إشعار داخل التطبيق لكل الأدمن النشطين (طلب دفع جديد، رسالة تواصل، طلب استعادة كلمة سر). لا يكسر الطلب الأصلي لو فشل. */
export async function notifyAdmins(n: { titleAr: string; titleEn: string; bodyAr: string; bodyEn: string; severity?: "INFO" | "WARNING"; link?: string }): Promise<void> {
  try {
    const admins = await db.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
    if (admins.length === 0) return;
    await db.notification.createMany({
      data: admins.map((a) => ({
        userId: a.id,
        type: "BROADCAST",
        titleAr: n.titleAr,
        titleEn: n.titleEn,
        bodyAr: n.bodyAr,
        bodyEn: n.bodyEn,
        severity: n.severity ?? "INFO",
        channel: "IN_APP",
        link: n.link ?? "/admin",
      })),
    });
  } catch (e) {
    console.error("[notifyAdmins]", e instanceof Error ? e.message : e);
  }
}
