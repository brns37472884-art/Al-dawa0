/**
 * عامل الخلفية — BullMQ على Redis: استخراج التقارير + إشعارات + صيانة دورية.
 * تشغيل: npm run worker (عملية منفصلة عن Next.js).
 */
import { Worker } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { redisConnectionOptions } from "../lib/redis-options";

const db = new PrismaClient();
const concurrency = Number(process.env.WORKER_CONCURRENCY || 2);

if (!process.env.REDIS_URL) {
  console.error("[WORKER] REDIS_URL مطلوب — شغّل Redis ثم أعد المحاولة");
  process.exit(1);
}
if (process.env.NODE_ENV === "production" && process.env.DEMO_MODE === "true") {
  console.error("[WORKER] DEMO_MODE=true ممنوع في الإنتاج");
  process.exit(1);
}

// فك REDIS_URL صراحة (ioredis يتجاهل مفتاح url) — بعد التحقق من وجوده أعلاه
const connection = redisConnectionOptions(process.env.REDIS_URL as string);

process.env.WORKER_RUNTIME = "true";
import("../lib/agents/reader").catch(() => {});

let stopping = false;

const extractWorker = new Worker(
  "extract",
  async (job) => {
    const { reportId } = job.data as { reportId: string };
    const { processReport } = await import("../lib/agents/reader");
    await processReport(reportId);
    return { reportId };
  },
  { connection, concurrency, limiter: { max: 30, duration: 60_000 } }
);

const notifyWorker = new Worker(
  "notify",
  async (job) => {
    const data = job.data as { userId: string; channel: "SMS" | "WHATSAPP"; template: "RESULT_READY" | "SCREENING_DUE" | "PENDING_INVITE" | "CRITICAL_ALERT"; link?: string };
    const { sendOutbound } = await import("../lib/notifications");
    const { maskPhone } = await import("../lib/helpers");
    const user = await db.user.findUnique({ where: { id: data.userId }, select: { phone: true } });
    if (!user?.phone) return { skipped: true };
    await sendOutbound({ channel: data.channel, to: user.phone, template: data.template }, { userId: data.userId, link: data.link });
    void maskPhone;
    return { ok: true };
  },
  { connection, concurrency: 5 }
);

/** صيانة دورية: انتهاء صلاحية النتائج المعلقة + تذكيرات الفحوصات */
const maintenance = setInterval(
  async () => {
    if (stopping) return;
    try {
      // 1) انتهاء صلاحية النتائج غير المستلمة (المدة من إعدادات المدير)
      const setting = await db.systemSetting.findUnique({ where: { key: "PENDING_CLAIM_EXPIRY_DAYS" } });
      const days = Number(setting?.value ?? 30) || 30;
      const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);
      const expired = await db.pendingLabResult.findMany({
        where: { status: "PENDING", createdAt: { lt: cutoff } },
        select: { id: true, filePath: true },
      });
      for (const p of expired) {
        if (p.filePath) {
          const { storage } = await import("../lib/storage");
          await storage().delete(p.filePath).catch(() => {});
        }
        await db.pendingLabResult.update({ where: { id: p.id }, data: { status: "EXPIRED", filePath: "" } });
        await db.auditLog.create({ data: { action: "PENDING_EXPIRED", actorRole: "SYSTEM", entityType: "PendingLabResult", entityId: p.id, meta: JSON.stringify({ days }) } });
      }
      // 2) تذكيرات الفحوصات (مجموعة محدودة كل دورة)
      const { generateReminders } = await import("../lib/screening/service");
      const dueUsers = await db.screeningRecord.findMany({
        where: { status: { in: ["DUE", "OVERDUE"] }, user: { isActive: true } },
        select: { userId: true },
        distinct: ["userId"],
        take: 100,
      });
      for (const u of dueUsers) await generateReminders(u.userId).catch(() => {});
    } catch (e) {
      console.error("[WORKER-MAINTAIN]", e);
    }
  },
  5 * 60 * 1000
);
maintenance.unref?.();

const shutdown = async () => {
  stopping = true;
  console.log("[WORKER] إيقاف…");
  await Promise.allSettled([extractWorker.close(), notifyWorker.close()]);
  await db.$disconnect();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

console.log(`[WORKER] يعمل — استخراج (${concurrency}) + إشعارات + صيانة كل 5 دقائق`);
