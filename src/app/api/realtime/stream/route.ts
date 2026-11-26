import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { userMaySeeEvent, eventBus, REDIS_EVENTS_CHANNEL, type DomainEventPayload } from "@/lib/events";
import { subscriber } from "@/lib/redis";
import { safeJsonParse } from "@/lib/helpers";

/**
 * GET /api/realtime/stream — SSE لحظي:
 * مصادقة كوكي/Bearer · heartbeat 25 ثانية · استئناف Last-Event-ID من القاعدة
 * · بث بين النسخ عبر Redis pub/sub · ACL لكل حدث — بلا أي بيانات طبية في الأحداث.
 */

const g = globalThis as unknown as {
  __aldawaRtHub?: {
    subscribers: Set<(ev: DomainEventPayload) => void>;
    redisBound: boolean;
  };
};

function hub() {
  if (!g.__aldawaRtHub) {
    g.__aldawaRtHub = { subscribers: new Set(), redisBound: false };
  }
  return g.__aldawaRtHub;
}

async function bindSources(dispatch: (ev: DomainEventPayload) => void): Promise<void> {
  const h = hub();
  // 1) bus داخلي (نفس العملية)
  eventBus.on("event", dispatch);
  // 2) Redis pub/sub (بين النسخ) — ربط مرة واحدة لكل عملية
  if (!h.redisBound) {
    h.redisBound = true;
    const sub = await subscriber();
    if (sub) {
      await sub.subscribe(REDIS_EVENTS_CHANNEL).catch(() => {});
      sub.on("message", (_channel: string, message: string) => {
        try {
          const ev = JSON.parse(message) as DomainEventPayload;
          for (const s of h.subscribers) s(ev);
        } catch {
          /* رسالة تالفة */
        }
      });
    }
  }
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const lastEventId = req.headers.get("last-event-id") ?? req.nextUrl.searchParams.get("cursor") ?? "0";
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          closed = true;
        }
      };

      // استئناف: أحداث بعد المؤشر من القاعدة (محدود 100) — تُرشَّح بالصلاحية
      const cursor = Number(lastEventId) || 0;
      try {
        const missed = await db.domainEvent.findMany({
          where: { seq: { gt: cursor } },
          orderBy: { seq: "asc" },
          take: 100,
        });
        for (const row of missed) {
          const ev: DomainEventPayload = {
            seq: row.seq,
            id: row.id,
            type: row.type as DomainEventPayload["type"],
            reportId: row.reportId,
            patientId: row.patientId,
            labId: row.labId,
            doctorId: row.doctorId,
            orderId: row.orderId,
            version: row.version,
            occurredAt: row.occurredAt.toISOString(),
            payload: safeJsonParse(row.payload, {}),
          };
          if (userMaySeeEvent(user, ev)) {
            send(`id: ${ev.seq}\nevent: domain\ndata: ${JSON.stringify(ev)}\n\n`);
          }
        }
      } catch {
        /* استئناف فاشل لا يمنع البث الحي */
      }

      // البث الحي — بفلتر الصلاحية لكل حدث
      const dispatch = (ev: DomainEventPayload) => {
        if (closed) return;
        if (!userMaySeeEvent(user, ev)) return;
        send(`id: ${ev.seq}\nevent: domain\ndata: ${JSON.stringify(ev)}\n\n`);
      };
      hub().subscribers.add(dispatch);
      await bindSources(dispatch);

      // heartbeat — يمنع انقطاع البروكسي ويكشف الميت
      const hb = setInterval(() => send(`: hb ${Date.now()}\n\n`), 25_000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(hb);
        hub().subscribers.delete(dispatch);
        try {
          controller.close();
        } catch {
          /* مُغلق بالفعل */
        }
      };
      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, private",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
