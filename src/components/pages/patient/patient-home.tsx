"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLang } from "@/lib/i18n";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { api, fmtDate, fmtNumber } from "@/lib/api";
import { Card, CardContent, Badge, Button, Progress } from "@/components/ui/core";
import { StatCard, EmptyState, LoadingBlock, StatusBadge, DemoBadge, UrgencyBadge } from "@/components/shared/common";
import { Siren, Sparkles, FolderHeart, ListChecks, GitCompareArrows, FileText, MessageSquareHeart, Activity, Building2, QrCode, ScrollText, TrendingUp, Users, BellRing, Stethoscope, Pencil } from "lucide-react";

export const PATIENT_NAV = (t: (k: string) => string) => [
  { href: "/app", label: t("shell.nav.home"), icon: "home" },
  { href: "/app/profile", label: t("shell.nav.profile"), icon: "profile" },
  { href: "/app/screenings", label: t("shell.nav.screenings"), icon: "screenings" },
  { href: "/app/records", label: t("shell.nav.records"), icon: "records" },
  { href: "/app/trends", label: t("shell.nav.trends"), icon: "trends" },
  { href: "/app/orders", label: t("shell.nav.orders"), icon: "orders" },
  { href: "/app/subscription", label: t("shell.nav.subscription"), icon: "subscription" },
  { href: "/app/family", label: t("shell.nav.family"), icon: "family" },
  { href: "/app/notifications", label: t("shell.nav.notifications"), icon: "notifications" },
  { href: "/app/consents", label: t("shell.nav.consents"), icon: "consents" },
  { href: "/app/assistant", label: t("shell.nav.assistant"), icon: "assistant" },
];

interface HomeData {
  completion: { percent: number };
  profileSummary: { age: number | null; gender: string | null; bmi: number | null; chronicCount: number; medsCount: number; name: string };
  riskFactors: Array<{ key: string; labelAr: string; labelEn: string }>;
  eligible: Array<{ id: string; status: string; nextDueAt: string | null; reasonAr: string; reasonEn: string; protocol: { titleAr: string; titleEn: string; sourceOrg: string; guidelineVersion: string; guidelineDate: string; approvedAt: string | null; doctorDiscussion: boolean } }>;
  completed: Array<{ id: string; lastDoneAt: string | null; titleAr: string; titleEn: string }>;
  upcoming: Array<{ id: string; titleAr: string; titleEn: string; dueDate: string | null }>;
  reports: Array<{ id: string; fileName: string; status: string; uploadedAt: string; labName: string | null; source: string; currentVersion: number; valuesCount: number; abnormalCount: number; review: { status: string; urgency: string; needsReview: boolean } | null; demo: boolean }>;
  changes: Array<{ key: string; nameAr: string; unit: string; prev: number; last: number; direction: string }>;
  alerts: Array<{ id: string; severity: string; messageAr: string; messageEn: string; reportId: string | null }>;
  pendingReviews: Array<{ id: string; fileName: string; status: string }>;
}

export function PatientHomePage() {
  const { t, lang } = useLang();
  const [data, setData] = useState<HomeData | null>(null);
  const [err, setErr] = useState(false);
  const [readyCard, setReadyCard] = useState(false);

  const load = useCallback(() => {
    api<HomeData>("/api/patient-home").then(setData).catch(() => setErr(true));
  }, []);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.type === "REPORT_DELIVERED") setReadyCard(true);
    };
    window.addEventListener("aldawa:rt", h);
    return () => window.removeEventListener("aldawa:rt", h);
  }, []);

  const refreshOnEvent = useCallback(() => {
    window.addEventListener("aldawa:refresh", load, { once: true });
  }, [load]);
  useEffect(refreshOnEvent, [refreshOnEvent]);

  if (err) return <PatientShell active="/app"><EmptyState text={t("common.errorNetwork")} /></PatientShell>;
  if (!data) return <PatientShell active="/app"><LoadingBlock /></PatientShell>;

  const hasUrgent = data.alerts.some((a) => a.severity === "URGENT");

  return (
    <PatientShell active="/app">
      <div className="space-y-5">
        {/* 0) الشريط الحرج — الإسعاف 123 */}
        {hasUrgent && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border-2 border-urgent bg-urgent/5 p-4">
            <Siren className="h-8 w-8 shrink-0 text-urgent" />
            <div className="min-w-40 flex-1">
              <div className="font-bold text-urgent">{t("p.critical.title")}</div>
              <div className="text-xs text-muted">{t("p.critical.sub")}</div>
            </div>
            <a href="tel:123" className="flex h-14 w-24 items-center justify-center rounded-2xl bg-urgent text-2xl font-extrabold text-white shadow-lg" dir="ltr">123</a>
          </div>
        )}

        {/* 0ب) بطاقة «نتيجتك جاهزة» اللحظية */}
        {readyCard && (
          <div className="rounded-2xl border-2 border-success bg-success/5 p-4">
            <div className="font-bold text-success">{t("p.ready.title")}</div>
            <Button asChild size="sm" variant="success" className="mt-2"><Link href="/app/records">{t("p.ready.open")}</Link></Button>
          </div>
        )}

        {/* 1) ملخص الملف الصحي */}
        <Card className="overflow-hidden">
          <div className="hero-gradient p-5 text-white">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">{data.completion.percent > 0 ? t("p.summary.title") : t("p.summary.startTitle")}</h2>
                <p className="mt-1 text-sm text-white/85">{t("p.summary.greeting", { name: data.profileSummary.name })}</p>
              </div>
              <Button asChild variant="soft" className="bg-white/15 text-white hover:bg-white/25">
                <Link href="/app/profile">{data.completion.percent < 60 ? t("p.summary.continue") : t("p.summary.review")}</Link>
              </Button>
            </div>
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-xs text-white/80"><span>{t("p.summary.completion")}</span><span>{data.completion.percent}%</span></div>
              <Progress value={data.completion.percent} className="bg-white/20" />
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {data.profileSummary.age !== null && <span className="rounded-full bg-white/10 px-2.5 py-1">{t("p.age")}: {data.profileSummary.age}</span>}
              <span className="rounded-full bg-white/10 px-2.5 py-1">{t("p.chronic")}: {data.profileSummary.chronicCount}</span>
              <span className="rounded-full bg-white/10 px-2.5 py-1">{t("p.meds")}: {data.profileSummary.medsCount}</span>
            </div>
          </div>
          {data.riskFactors.length > 0 && (
            <CardContent className="p-5">
              <h3 className="mb-1 font-bold text-navy">{t("p.summary.riskFactors")}</h3>
              <p className="mb-3 text-xs text-muted">{t("p.summary.riskNote")}</p>
              <div className="flex flex-wrap gap-2">
                {data.riskFactors.map((r) => (
                  <Badge key={r.key} tone="info">{lang === "ar" ? r.labelAr : r.labelEn}</Badge>
                ))}
              </div>
            </CardContent>
          )}
        </Card>

        {/* 2) فحوصات قد تكون مؤهلًا لها */}
        <Card>
          <CardContent className="p-5">
            <h3 className="mb-1 flex items-center gap-2 font-bold text-navy"><ListChecks className="h-5 w-5 text-medblue" />{t("p.eligible.title")}</h3>
            <p className="mb-3 text-xs text-muted">{t("p.eligible.note")}</p>
            {data.eligible.length === 0 ? (
              <EmptyState text={data.completion.percent < 40 ? t("p.summary.startTitle") : t("plan.locked")} />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {data.eligible.map((e) => (
                  <div key={e.id} className="rounded-xl border border-line p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-navy">{lang === "ar" ? e.protocol.titleAr : e.protocol.titleEn}</span>
                      <Badge tone={e.status === "OVERDUE" ? "urgent" : "warning"}>{t(`planStatus.${e.status}`)}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted">{lang === "ar" ? e.reasonAr : e.reasonEn}</p>
                    <div className="mt-1 text-[11px] text-muted">{e.protocol.sourceOrg} · {e.protocol.guidelineVersion} · {e.protocol.guidelineDate}</div>
                    {e.protocol.approvedAt && <div className="text-[11px] text-success">{t("plan.lastReviewed")}: {fmtDate(e.protocol.approvedAt, lang)}</div>}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 3+4) مأتمم + مواعيد */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Card><CardContent className="p-5">
            <h3 className="mb-3 font-bold text-navy">{t("p.completed.title")}</h3>
            {data.completed.length === 0 ? <p className="text-sm text-muted">—</p> : data.completed.map((c) => (
              <div key={c.id} className="flex items-center justify-between border-b border-line py-2 text-sm last:border-0">
                <span>{lang === "ar" ? c.titleAr : c.titleEn}</span>
                <span className="text-xs text-muted">{fmtDate(c.lastDoneAt, lang)}</span>
              </div>
            ))}
          </CardContent></Card>
          <Card><CardContent className="p-5">
            <h3 className="mb-3 font-bold text-navy">{t("p.upcoming.title")}</h3>
            {data.upcoming.length === 0 ? <p className="text-sm text-muted">—</p> : data.upcoming.map((u) => (
              <div key={u.id} className="flex items-center justify-between border-b border-line py-2 text-sm last:border-0">
                <span>{lang === "ar" ? u.titleAr : u.titleEn}</span>
                <span className="text-xs text-muted">{fmtDate(u.dueDate, lang)}</span>
              </div>
            ))}
          </CardContent></Card>
        </div>

        {/* إجراءات سريعة */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { href: "/app/orders", label: t("p.quick.plan"), icon: Building2 },
            { href: "/app/records", label: t("shell.nav.records"), icon: ScrollText },
            { href: "/app/trends", label: t("p.quick.trends"), icon: TrendingUp },
            { href: "/app/assistant", label: t("p.quick.assistant"), icon: MessageSquareHeart },
          ].map((q) => (
            <Link key={q.href} href={q.href} className="card-hover flex flex-col items-center gap-2 rounded-2xl border border-line bg-white p-4 text-sm font-bold text-navy">
              <q.icon className="h-6 w-6 text-medblue" />
              {q.label}
            </Link>
          ))}
        </div>

        {/* 5) آخر التقارير */}
        <Card><CardContent className="p-5">
          <h3 className="mb-3 font-bold text-navy">{t("p.reports.title")}</h3>
          {data.reports.length === 0 ? <EmptyState text={t("records.empty")} /> : data.reports.map((r) => (
            <Link key={r.id} href={`/app/records/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-3 text-sm last:border-0 hover:bg-lightblue/40">
              <div className="min-w-0">
                <div className="flex items-center gap-2"><FileText className="h-4 w-4 shrink-0 text-medblue" /><span className="truncate font-semibold">{r.fileName}</span>{r.demo && <DemoBadge />}</div>
                <div className="mt-0.5 text-xs text-muted">{r.labName ?? "—"} · {fmtDate(r.uploadedAt, lang)} · {r.valuesCount} {t("p.values")}{r.abnormalCount > 0 && <span className="text-warning"> · {r.abnormalCount} {t("p.abnormal")}</span>}</div>
              </div>
              <div className="flex items-center gap-2">
                {r.review?.needsReview && <Badge tone="warning">{t("report.needsReviewBadge")}</Badge>}
                {r.review && <UrgencyBadge urgency={r.review.urgency} />}
                <StatusBadge status={r.status} />
              </div>
            </Link>
          ))}
        </CardContent></Card>

        {/* 6) تغيرات المؤشرات */}
        <Card><CardContent className="p-5">
          <h3 className="mb-1 flex items-center gap-2 font-bold text-navy"><GitCompareArrows className="h-5 w-5 text-medblue" />{t("p.changes.title")}</h3>
          <p className="mb-3 text-xs text-muted">{t("p.changes.note")}</p>
          {data.changes.length === 0 ? <p className="text-sm text-muted">—</p> : (
            <div className="space-y-2">
              {data.changes.map((c) => (
                <div key={c.key} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3 text-sm">
                  <span className="font-semibold">{c.nameAr}</span>
                  <span dir="ltr" className="text-muted">{fmtNumber(c.prev, lang)} → <b className="text-navy">{fmtNumber(c.last, lang)}</b> {c.unit}</span>
                  <Badge tone={c.direction === "UP" ? "warning" : c.direction === "DOWN" ? "info" : "neutral"}>{t(`direction.${c.direction}`)}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent></Card>

        {/* 7) التنبيهات */}
        {data.alerts.length > 0 && (
          <Card><CardContent className="p-5">
            <h3 className="mb-3 font-bold text-urgent">{t("p.alerts.title")}</h3>
            <div className="space-y-2">
              {data.alerts.map((a) => (
                <div key={a.id} className="rounded-xl border border-urgent/40 bg-urgent/5 p-3 text-sm">
                  <p className="text-ink">{lang === "ar" ? a.messageAr : a.messageEn}</p>
                  {a.reportId && <Link href={`/app/records/${a.reportId}`} className="mt-1 inline-block text-xs font-bold text-medblue hover:underline">{t("p.open")} →</Link>}
                </div>
              ))}
            </div>
          </CardContent></Card>
        )}

        {/* 8) التواصل */}
        <Card><CardContent className="p-5">
          <h3 className="mb-3 font-bold text-navy">{t("p.contact.title")}</h3>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="soft"><Link href="/app/assistant"><Sparkles className="h-4 w-4" />{t("p.quick.assistant")}</Link></Button>
            <Button asChild variant="outline"><Link href="/contact">{t("nav.contact")}</Link></Button>
          </div>
          {data.pendingReviews.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 text-xs font-bold text-muted">{t("p.pendingReviews")}</div>
              {data.pendingReviews.map((p) => (
                <div key={p.id} className="flex items-center justify-between border-b border-line py-2 text-sm last:border-0">
                  <span className="truncate">{p.fileName}</span>
                  <StatusBadge status={p.status} />
                </div>
              ))}
            </div>
          )}
        </CardContent></Card>
      </div>
    </PatientShell>
  );
}

/** غلاف العميل — يلف DashboardShell بناف العميل */
export function PatientShell({ active, children }: { active: string; children: React.ReactNode }) {
  const { t } = useLang();
  return (
    <DashboardShell home="/app" title={t("shell.patient")} nav={PATIENT_NAV(t)}>
      <div data-active={active}>{children}</div>
    </DashboardShell>
  );
}

void Activity; void Users; void BellRing; void Stethoscope; void Pencil; void QrCode; void FolderHeart; void StatCard;
