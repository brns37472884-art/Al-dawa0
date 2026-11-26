import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ipFromHeaders } from "@/lib/rate-limit";
import { safeJsonParse } from "@/lib/helpers";

/**
 * أدوات مشتركة للمسارات — حد حجم الجسم بالبايت + تدقيق + إشعارات.
 */
export async function readJson<T = Record<string, unknown>>(req: NextRequest | Request, maxBytes = 256 * 1024): Promise<T | null> {
  try {
    const text = await req.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function logAudit(
  action: string,
  opts: {
    req?: NextRequest | Request;
    actorUserId?: string | null;
    actorRole?: string | null;
    entityType?: string;
    entityId?: string;
    meta?: Record<string, unknown>;
  } = {}
) {
  try {
    let ip: string | null = null;
    if (opts.req) {
      ip = ipFromHeaders((k) => opts.req!.headers.get(k));
    } else {
      const { headers } = await import("next/headers");
      const h = await headers();
      ip = ipFromHeaders((k) => h.get(k));
    }
    await db.auditLog.create({
      data: {
        action,
        actorUserId: opts.actorUserId ?? null,
        actorRole: opts.actorRole ?? null,
        entityType: opts.entityType,
        entityId: opts.entityId,
        meta: JSON.stringify(opts.meta ?? {}),
        ip,
      },
    });
  } catch (e) {
    console.error("audit log failed", e);
  }
}

export async function notify(
  userId: string,
  n: {
    type: string;
    titleAr: string;
    titleEn: string;
    bodyAr: string;
    bodyEn: string;
    severity?: "INFO" | "WARNING" | "URGENT";
    channel?: "IN_APP" | "EMAIL" | "SMS" | "WHATSAPP";
    link?: string;
  }
) {
  try {
    await db.notification.create({
      data: {
        userId,
        type: n.type,
        titleAr: n.titleAr,
        titleEn: n.titleEn,
        bodyAr: n.bodyAr,
        bodyEn: n.bodyEn,
        severity: n.severity ?? "INFO",
        channel: n.channel ?? "IN_APP",
        link: n.link,
      },
    });
  } catch (e) {
    console.error("notify failed", e);
  }
}

export { safeJsonParse };

// ---------- تسجيل تشغيلات الوكلاء ----------
export async function logAgentRun(
  agentKey: string,
  data: {
    userId?: string | null;
    status?: "SUCCESS" | "FAILED" | "FALLBACK";
    provider?: string;
    inputSummary?: string;
    outputSummary?: string;
    tokens?: number;
    durationMs?: number;
    meta?: Record<string, unknown>;
  }
) {
  try {
    await db.aiInteraction.create({
      data: {
        agentKey,
        userId: data.userId ?? null,
        status: data.status ?? "SUCCESS",
        provider: data.provider ?? "builtin",
        inputSummary: data.inputSummary?.slice(0, 500),
        outputSummary: data.outputSummary?.slice(0, 500),
        tokens: data.tokens,
        durationMs: data.durationMs,
        meta: JSON.stringify(data.meta ?? {}),
      },
    });
  } catch (e) {
    console.error("agent log failed", e);
  }
}
