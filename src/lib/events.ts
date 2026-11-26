import { EventEmitter } from "events";
import type { PrismaClient, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { publisher } from "@/lib/redis";
import { safeJsonParse } from "@/lib/helpers";

/**
 * طبقة الأحداث اللحظية — Outbox Pattern + Redis pub/sub للبث بين النسخ.
 * أي تغيير مهم يُكتب DomainEvent في نفس الـ transaction ثم يُنشر بعد الاكتمال
 * على bus داخلي + Redis. حلقة ناشر (تعمل في app + worker) تستعيد غير المنشور.
 * الحدث لا يحمل أي قيمة طبية أو بيانات تعريف — الواجهة تعيد الجلب من API مصرّح به.
 */

export type EventType =
  | "ORDER_CREATED"
  | "REPORT_UPLOADED"
  | "REPORT_EXTRACTED"
  | "REPORT_CONFIRMED"
  | "REPORT_DELIVERED"
  | "REPORT_OPENED"
  | "REVIEW_STATE"
  | "INFO_REQUESTED"
  | "CORRECTION_OPENED"
  | "CORRECTION_RESOLVED"
  | "REPORT_CORRECTED"
  | "CRITICAL_FLAG"
  | "PATIENT_CONFIRMED"
  | "CONSENT_WITHDRAWN"
  | "IDENTITY_HOLD";

export interface DomainEventPayload {
  seq: number;
  id: string;
  type: EventType;
  reportId: string | null;
  patientId: string | null;
  labId: string | null;
  doctorId: string | null;
  orderId: string | null;
  version: number;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export const REDIS_EVENTS_CHANNEL = "aldawa:events";

// bus داخلي (نفس العملية) — يُخزّن على globalThis لنسخة واحدة عبر كل الـ routes
const g = globalThis as unknown as { __aldawaEventBus?: EventEmitter };
export const eventBus: EventEmitter = g.__aldawaEventBus ?? new EventEmitter().setMaxListeners(0);
g.__aldawaEventBus = eventBus;

type EventInput = {
  type: EventType;
  reportId?: string | null;
  patientId?: string | null;
  labId?: string | null;
  doctorId?: string | null;
  orderId?: string | null;
  version?: number;
  payload?: Record<string, unknown>;
};

type Tx = Prisma.TransactionClient | PrismaClient;

/** إدراج حدث في الصندوق — يُستدعى داخل نفس transaction التغيير */
export async function recordEvent(tx: Tx, ev: EventInput): Promise<{ seq: number; id: string }> {
  const row = await (tx as Prisma.TransactionClient).domainEvent.create({
    data: {
      type: ev.type,
      reportId: ev.reportId ?? null,
      patientId: ev.patientId ?? null,
      labId: ev.labId ?? null,
      doctorId: ev.doctorId ?? null,
      orderId: ev.orderId ?? null,
      version: ev.version ?? 1,
      payload: JSON.stringify(ev.payload ?? {}),
    },
    select: { seq: true, id: true },
  });
  return { seq: row.seq, id: row.id };
}

/** نشر حدث مسجّل (بعد اكتمال الـ transaction) — bus داخلي + Redis */
export async function publishRecordedEvent(seq: number): Promise<void> {
  try {
    const row = await db.domainEvent.findUnique({ where: { seq } });
    if (!row) return;
    const payload: DomainEventPayload = {
      seq: row.seq,
      id: row.id,
      type: row.type as EventType,
      reportId: row.reportId,
      patientId: row.patientId,
      labId: row.labId,
      doctorId: row.doctorId,
      orderId: row.orderId,
      version: row.version,
      occurredAt: row.occurredAt.toISOString(),
      payload: safeJsonParse(row.payload, {}),
    };
    eventBus.emit("event", payload);
    eventBus.emit(`type:${row.type}`, payload);
    // بث بين النسخ عبر Redis pub/sub
    const pub = await publisher();
    if (pub) {
      pub.publish(REDIS_EVENTS_CHANNEL, JSON.stringify(payload)).catch(() => {});
    }
    await db.domainEvent.update({ where: { seq }, data: { publishedAt: new Date() } });
    await updateRollups(payload);
  } catch {
    /* الناشر لا يُسقط أبدًا — حلقة الاستعادة ستعيد المحاولة */
  }
}

/** مساعد للاستدعاءات بلا transaction صريح */
export async function recordAndPublish(ev: EventInput): Promise<void> {
  const { seq } = await recordEvent(db, ev);
  await publishRecordedEvent(seq);
}

// ---------- مُجمّع أحداث للـ transactions ----------
/** يُمرَّر داخل db.$transaction: الإدراج داخل الـ tx، والنشر بعد الاكتمال */
export class EventRecorder {
  private tx: Prisma.TransactionClient | null = null;
  private queued: number[] = [];

  bind(tx: Prisma.TransactionClient) {
    this.tx = tx;
  }

  async add(ev: EventInput): Promise<void> {
    const client = this.tx ?? db;
    const row = await client.domainEvent.create({
      data: {
        type: ev.type,
        reportId: ev.reportId ?? null,
        patientId: ev.patientId ?? null,
        labId: ev.labId ?? null,
        doctorId: ev.doctorId ?? null,
        orderId: ev.orderId ?? null,
        version: ev.version ?? 1,
        payload: JSON.stringify(ev.payload ?? {}),
      },
      select: { seq: true },
    });
    this.queued.push(row.seq);
  }

  /** بعد اكتمال الـ transaction — انشر كل ما سُجّل */
  async flush(): Promise<void> {
    const seqs = this.queued;
    this.queued = [];
    this.tx = null;
    for (const seq of seqs) await publishRecordedEvent(seq);
  }
}

// ---------- حلقة الناشر (استعادة أي حدث لم يُنشر — تعطل فوري/تعدد مثيلات) ----------
let publisherTimer: ReturnType<typeof setInterval> | null = null;

export function startEventPublisher(): void {
  if (publisherTimer) return;
  publisherTimer = setInterval(async () => {
    try {
      const stale = await db.domainEvent.findMany({
        where: { publishedAt: null, occurredAt: { lt: new Date(Date.now() - 2000) } },
        select: { seq: true },
        orderBy: { seq: "asc" },
        take: 100,
      });
      for (const e of stale) await publishRecordedEvent(e.seq);
      if (Math.random() < 0.02) {
        await db.domainEvent.deleteMany({
          where: { occurredAt: { lt: new Date(Date.now() - 30 * 24 * 3600 * 1000) } },
        });
      }
    } catch {
      /* لا شيء — المحاولة التالية */
    }
  }, 2000);
  (publisherTimer as unknown as { unref?: () => void }).unref?.();
}

if (process.env.NEXT_RUNTIME === "nodejs" || process.env.WORKER_RUNTIME === "true") {
  startEventPublisher();
}

// ---------- القنوات والصلاحيات ----------
export type SessionUserLite = { id: string; role: string; labId?: string | null };

export function channelsForEvent(ev: {
  patientId?: string | null;
  labId?: string | null;
  doctorId?: string | null;
}): string[] {
  const ch: string[] = ["admin"];
  if (ev.patientId) ch.push(`user:${ev.patientId}`);
  if (ev.labId) ch.push(`lab:${ev.labId}`);
  if (ev.doctorId) ch.push(`doctor:${ev.doctorId}`);
  return ch;
}

/** ACL: هل هذا المستخدم يملك صلاحية على هذا الحدث؟ (فحص عند الاشتراك وعند كل بث/جلب) */
export function userMaySeeEvent(
  user: SessionUserLite,
  ev: { patientId?: string | null; labId?: string | null; doctorId?: string | null }
): boolean {
  if (user.role === "ADMIN") return true;
  if (ev.patientId === user.id) return true;
  if ((user.role === "LAB" || user.role === "LAB_SUPERVISOR") && ev.labId && user.labId && ev.labId === user.labId) return true;
  if (user.role === "DOCTOR" && ev.doctorId === user.id) return true;
  return false;
}

// ---------- Rollups ----------
function cairoDay(d = new Date()): string {
  const t = new Date(d.getTime() + 2 * 3600 * 1000);
  return t.toISOString().slice(0, 10);
}

type StatField = "uploads" | "delivered" | "opened" | "corrections" | "critical" | "reviews";

async function bumpStat(scope: string, scopeId: string, field: StatField): Promise<void> {
  const day = cairoDay();
  try {
    await db.dashboardStat.upsert({
      where: { scope_scopeId_day: { scope, scopeId, day } },
      create: { scope, scopeId, day, [field]: 1 },
      update: { [field]: { increment: 1 } },
    });
  } catch {
    /* إحصاء لا يُعطّل الأحداث */
  }
}

async function updateRollups(ev: DomainEventPayload): Promise<void> {
  switch (ev.type) {
    case "ORDER_CREATED":
    case "REPORT_UPLOADED":
      if (ev.labId) await bumpStat("LAB", ev.labId, "uploads");
      break;
    case "REPORT_DELIVERED":
      if (ev.labId) await bumpStat("LAB", ev.labId, "delivered");
      break;
    case "REPORT_OPENED":
      if (ev.labId) await bumpStat("LAB", ev.labId, "opened");
      break;
    case "CORRECTION_OPENED":
      if (ev.labId) await bumpStat("LAB", ev.labId, "corrections");
      break;
    case "CRITICAL_FLAG":
      if (ev.labId) await bumpStat("LAB", ev.labId, "critical");
      break;
    case "REVIEW_STATE":
      if (ev.doctorId) await bumpStat("DOCTOR", ev.doctorId, "reviews");
      break;
  }
}
