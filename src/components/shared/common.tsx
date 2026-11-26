"use client";
import { Badge } from "@/components/ui/core";
import { useLang } from "@/lib/i18n";
import { Inbox, HeartPulse } from "lucide-react";

/** الشعار — درع وموجة + الاسم */
export function Logo({ light = false, size = "md" }: { light?: boolean; size?: "sm" | "md" | "lg" }) {
  const dims = size === "lg" ? "h-12 w-12" : size === "sm" ? "h-8 w-8" : "h-10 w-10";
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`inline-flex ${dims} items-center justify-center rounded-xl bg-gradient-to-br from-medblue to-cyan text-white`}>
        <HeartPulse className="h-1/2 w-1/2" />
      </span>
      <span className="leading-tight">
        <span className={`block font-extrabold ${light ? "text-white" : "text-navy"} ${size === "lg" ? "text-xl" : "text-lg"}`}>الدواء</span>
        <span className={`block text-[10px] font-bold tracking-widest ${light ? "text-cyan" : "text-medblue"}`}>AL DAWA</span>
      </span>
    </span>
  );
}

export function DemoBadge() {
  const { t } = useLang();
  return <Badge tone="warning">{t("common.demoBadge")}</Badge>;
}

export function StatCard({ label, value, tone = "info", sub }: { label: string; value: string | number; tone?: "info" | "success" | "warning" | "urgent" | "navy" | "neutral"; sub?: string }) {
  const tones: Record<string, string> = {
    info: "border-medblue/30 bg-lightblue/50",
    success: "border-success/30 bg-success/5",
    warning: "border-warning/40 bg-warning/5",
    urgent: "border-urgent/40 bg-urgent/5",
    navy: "border-navy/30 bg-navy/5",
    neutral: "border-line bg-white",
  };
  return (
    <div className={`rounded-2xl border p-4 ${tones[tone]}`}>
      <div className="text-2xl font-extrabold text-navy">{value}</div>
      <div className="text-xs font-semibold text-muted">{label}</div>
      {sub && <div className="mt-1 text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line bg-white/60 p-8 text-center">
      <Inbox className="h-8 w-8 text-muted/60" />
      <p className="text-sm text-muted">{text}</p>
    </div>
  );
}

export function LoadingBlock() {
  const { t } = useLang();
  return (
    <div className="flex items-center justify-center gap-3 p-8 text-muted">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-medblue border-t-transparent" />
      <span className="text-sm">{t("common.loading")}</span>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const { t } = useLang();
  const tone: Record<string, "neutral" | "info" | "success" | "warning" | "urgent"> = {
    UPLOADED: "neutral",
    PROCESSING: "info",
    EXTRACTED: "warning",
    CONFIRMED: "success",
    CONFIRMED_LAB: "success",
    UNDER_REVIEW: "info",
    REVIEWED: "success",
    NEEDS_INFO: "warning",
    FAILED: "urgent",
  };
  return <Badge tone={tone[status] ?? "neutral"}>{t(`status.${status}`)}</Badge>;
}

export function FlagBadge({ flag }: { flag: string }) {
  const { t } = useLang();
  const tone: Record<string, "success" | "warning" | "urgent" | "neutral"> = {
    NORMAL: "success",
    HIGH: "warning",
    LOW: "warning",
    CRITICAL_HIGH: "urgent",
    CRITICAL_LOW: "urgent",
    UNKNOWN: "neutral",
  };
  return <Badge tone={tone[flag] ?? "neutral"}>{t(`flag.${flag}`)}</Badge>;
}

export function UrgencyBadge({ urgency }: { urgency: string }) {
  const { t } = useLang();
  const tone: Record<string, "neutral" | "warning" | "urgent"> = { ROUTINE: "neutral", ATTENTION: "warning", URGENT: "urgent" };
  return <Badge tone={tone[urgency] ?? "neutral"}>{t(`urgency.${urgency}`)}</Badge>;
}
