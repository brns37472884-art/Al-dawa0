"use client";
import { useEffect, useRef, useState } from "react";

/**
 * عميل اللحظي — EventSource أصلي (كوكي نفس الأصل تلقائيًا)
 * + استئناف Last-Event-ID (المتصفح يرسله على إعادة الاتصال) + بديل polling بـ ETag.
 */
export interface RtEvent {
  seq: number;
  id: string;
  type: string;
  reportId: string | null;
  patientId: string | null;
  labId: string | null;
  doctorId: string | null;
  orderId: string | null;
  version: number;
  occurredAt: string;
  payload: Record<string, unknown>;
}

type Listener = (ev: RtEvent) => void;

export function useRealtime(onEvent: Listener, enabled = true): { connected: boolean; pending: number; flush: () => void } {
  const [connected, setConnected] = useState(false);
  const [pending, setPending] = useState(0);
  const listenerRef = useRef(onEvent);
  const pendingRef = useRef<RtEvent[]>([]);
  listenerRef.current = onEvent;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;

    const connect = () => {
      es = new EventSource("/api/realtime/stream", { withCredentials: true });
      es.addEventListener("open", () => {
        setConnected(true);
        failures = 0;
      });
      es.addEventListener("domain", (e) => {
        try {
          const ev = JSON.parse((e as MessageEvent).data) as RtEvent;
          listenerRef.current(ev);
        } catch {
          /* إطار تالف */
        }
      });
      es.addEventListener("error", () => {
        setConnected(false);
        es?.close();
        failures++;
        if (failures >= 3) startPolling();
        retry = setTimeout(connect, Math.min(1000 * 2 ** failures, 30_000));
      });
    };

    let poll: ReturnType<typeof setInterval> | null = null;
    let cursor = 0;
    const startPolling = () => {
      if (poll) return;
      poll = setInterval(async () => {
        try {
          const res = await fetch(`/api/realtime/since?cursor=${cursor}`, {
            headers: { "If-None-Match": `"rt-${cursor}-0"` },
            credentials: "same-origin",
            cache: "no-store",
          });
          if (res.status === 304 || res.status === 401) return;
          if (!res.ok) return;
          const data = (await res.json()) as { events: RtEvent[]; cursor: number };
          for (const ev of data.events ?? []) listenerRef.current(ev);
          cursor = data.cursor ?? cursor;
        } catch {
          /* الشبكة متعثرة */
        }
      }, 5000);
    };
    const stopPolling = () => {
      if (poll) {
        clearInterval(poll);
        poll = null;
      }
    };

    connect();
    return () => {
      es?.close();
      stopPolling();
      if (retry) clearTimeout(retry);
    };
  }, [enabled]);

  const flush = () => {
    setPending(0);
    pendingRef.current = [];
  };

  return { connected, pending, flush };
}
