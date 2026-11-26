import type { Queue } from "bullmq";
import { redisConnectionOptions } from "@/lib/redis-options";

/**
 * طوابق BullMQ — الاستخراج والإشعارات في worker منفصل.
 * بلا Redis (تطوير): تنفيذ مباشر داخل العملية (نفس المنطق) —
 * في الإنتاج env.ts يفرض REDIS_URL فتشتغل الطوابير فعلًا.
 */

let extractQueue: Queue | null = null;
let notifyQueue: Queue | null = null;
let broken = false;

async function getQueues(): Promise<{ extract: Queue; notify: Queue } | null> {
  if (broken || !process.env.REDIS_URL) return null;
  if (extractQueue && notifyQueue) return { extract: extractQueue, notify: notifyQueue };
  try {
    const { Queue } = await import("bullmq");
    const connection = redisConnectionOptions(process.env.REDIS_URL as string, { producer: true });
    extractQueue = new Queue("extract", { connection });
    notifyQueue = new Queue("notify", { connection });
    return { extract: extractQueue, notify: notifyQueue };
  } catch (e) {
    broken = true;
    console.error(`[QUEUE] تعذر تهيئة BullMQ — التنفيذ المباشر: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/** استخراج تقرير: طابور إن توفر Redis وإلا مباشر */
export async function enqueueExtraction(reportId: string): Promise<void> {
  const q = await getQueues();
  if (q) {
    try {
      await q.extract.add("extract", { reportId }, { jobId: `extract:${reportId}`, removeOnComplete: 500, removeOnFail: 500, attempts: 2 });
      return;
    } catch {
      /* فشل طابور → مباشر */
    }
  }
  const { processReport } = await import("@/lib/agents/reader");
  processReport(reportId).catch((e) => console.error("[INLINE-PIPELINE]", e));
}

/** إشعار صادر: طابور إن توفر Redis وإلا مباشر */
type OutTemplate = "RESULT_READY" | "SCREENING_DUE" | "PENDING_INVITE" | "CRITICAL_ALERT";

export async function enqueueNotify(job: { userId: string; channel: "SMS" | "WHATSAPP"; template: OutTemplate; link?: string }): Promise<void> {
  const q = await getQueues();
  if (q) {
    try {
      await q.notify.add("notify", job, { removeOnComplete: 500, attempts: 2 });
      return;
    } catch {
      /* فشل طابور → مباشر */
    }
  }
  const { sendOutbound } = await import("@/lib/notifications");
  await sendOutbound({ channel: job.channel, to: "", template: job.template }, { userId: job.userId, link: job.link });
}
