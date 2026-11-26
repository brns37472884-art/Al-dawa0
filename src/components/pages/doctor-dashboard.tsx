"use client";
import { useCallback, useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { api, fmtDate, fmtNumber, ApiError } from "@/lib/api";
import { Card, CardContent, Badge, Button, Input, Label, Textarea } from "@/components/ui/core";
import { Select, Dialog, DialogContent } from "@/components/ui/overlays";
import { EmptyState, LoadingBlock, StatCard, FlagBadge, UrgencyBadge, StatusBadge } from "@/components/shared/common";
import { Stethoscope, AlertTriangle, FileText, ClipboardList, UserRound } from "lucide-react";

const DOCTOR_NAV = (t: (k: string) => string) => [{ href: "/doctor", label: t("shell.nav.inbox") }];

interface CaseItem {
  reviewId: string; reportId: string; reportName: string; reportType: string; reportStatus: string;
  patientName: string; patientId: string; labName: string | null; testDate: string | null; uploadedAt: string;
  status: string; urgency: string; abnormalCount: number; criticalCount: number; priority: number; ageHours: number; slaBreached: boolean; needsReview: boolean; open: boolean;
}
interface InboxData {
  cases: CaseItem[];
  summary: { assignedPatients: number; newCases: number; pendingReview: number; urgentCases: number; completedReviews: number; avgReviewMinutes: number | null; lateCases: number; slaHours: number };
  followUpPatients: Array<{ id: string; name: string; openCases: number }>;
}

export function DoctorDashboardPage() {
  const { t, lang } = useLang();
  const [data, setData] = useState<InboxData | null>(null);
  const [filter, setFilter] = useState("ALL");
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(() => { void api<InboxData>(`/api/doctor?filter=${filter}`).then(setData).catch(() => {}); }, [filter]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (["REPORT_DELIVERED", "REVIEW_STATE", "CRITICAL_FLAG", "PATIENT_CONFIRMED", "INFO_REQUESTED"].includes(d?.type)) load();
    };
    window.addEventListener("aldawa:rt", h);
    window.addEventListener("aldawa:refresh", load);
    return () => { window.removeEventListener("aldawa:rt", h); window.removeEventListener("aldawa:refresh", load); };
  }, [load]);

  if (!data) return <DoctorShell><LoadingBlock /></DoctorShell>;

  return (
    <DoctorShell>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <StatCard label={t("d.stats.patients")} value={fmtNumber(data.summary.assignedPatients, lang)} tone="navy" />
          <StatCard label={t("d.stats.new")} value={fmtNumber(data.summary.newCases, lang)} tone="info" />
          <StatCard label={t("d.stats.pending")} value={fmtNumber(data.summary.pendingReview, lang)} tone="warning" />
          <StatCard label={t("d.stats.urgent")} value={fmtNumber(data.summary.urgentCases, lang)} tone="urgent" />
          <StatCard label={t("d.stats.completed")} value={fmtNumber(data.summary.completedReviews, lang)} tone="success" />
          <StatCard label={t("d.stats.late")} value={fmtNumber(data.summary.lateCases, lang)} tone="warning" />
          <StatCard label={t("d.stats.avg")} value={data.summary.avgReviewMinutes !== null ? `${data.summary.avgReviewMinutes} ${t("common.minutes")}` : "—"} tone="info" />
        </div>

        <div className="flex flex-wrap gap-1 rounded-xl bg-lightblue p-1">
          {["ALL", "NEW", "PENDING", "URGENT", "IN_REVIEW", "COMPLETED"].map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`rounded-lg px-3 py-1.5 text-sm font-bold ${filter === f ? "bg-white text-medblue-dark shadow-sm" : "text-muted"}`}>{t(`d.filter.${f}`)}</button>
          ))}
        </div>

        {selected ? (
          <CaseView reportId={selected} onBack={() => { setSelected(null); load(); }} />
        ) : data.cases.length === 0 ? (
          <EmptyState text={t("d.empty")} />
        ) : (
          <div className="space-y-2">
            {data.cases.map((c) => (
              <Card key={c.reviewId} className={`card-hover ${c.priority === 0 ? "border-urgent" : ""}`}>
                <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <button className="min-w-0 flex-1 text-start" onClick={() => setSelected(c.reportId)}>
                    <div className="flex flex-wrap items-center gap-2">
                      {c.criticalCount > 0 && <Badge tone="urgent"><AlertTriangle className="h-3 w-3" />{t("d.criticalCount", { n: c.criticalCount })}</Badge>}
                      {c.abnormalCount > 0 && <Badge tone="warning">{t("d.abnormalCount", { n: c.abnormalCount })}</Badge>}
                      <span className="font-bold text-navy">{c.patientName}</span>
                      {c.needsReview && <Badge tone="warning">{t("report.needsReviewBadge")}</Badge>}
                    </div>
                    <div className="mt-0.5 text-xs text-muted">{c.reportName} · {c.labName ?? "—"} · {fmtDate(c.uploadedAt, lang)} · {c.ageHours} {t("common.hours")}</div>
                  </button>
                  <div className="flex flex-wrap items-center gap-2">
                    {c.slaBreached ? <Badge tone="urgent">{t("d.sla.breached", { n: data.summary.slaHours })}</Badge> : c.open ? <Badge tone="info">{t("d.sla.waiting", { n: c.ageHours })}</Badge> : null}
                    <UrgencyBadge urgency={c.urgency} />
                    <StatusBadge status={c.reportStatus} />
                    <Button size="sm" onClick={() => setSelected(c.reportId)}>{t("p.open")}</Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {!selected && (
          <Card><CardContent className="p-5">
            <h2 className="mb-3 font-bold text-navy">{t("d.followups.title")}</h2>
            {data.followUpPatients.length === 0 ? <p className="text-sm text-muted">—</p> : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {data.followUpPatients.map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-xl border border-line p-3 text-sm">
                    <span className="font-semibold">{p.name}</span>
                    <Badge tone={p.openCases > 0 ? "warning" : "neutral"}>{p.openCases}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent></Card>
        )}
      </div>
    </DoctorShell>
  );
}

export function DoctorShell({ children }: { children: React.ReactNode }) {
  const { t } = useLang();
  return <DashboardShell title={t("shell.doctor")} nav={DOCTOR_NAV(t)}>{children}</DashboardShell>;
}

// ---------- الحالة ----------
function CaseView({ reportId, onBack }: { reportId: string; onBack: () => void }) {
  const { t, lang } = useLang();
  const [detail, setDetail] = useState<{
    report: { fileName: string; reportType: string; status: string; testDate: string | null; labName: string | null; fileType: string; source: string };
    values: Array<{ id: string; rawName: string; value: number | null; valueText: string | null; unit: string | null; refLow: number | null; refHigh: number | null; flag: string }>;
    review: { id: string; status: string; notes: string | null; recommendation: string | null; requestedInfo: string | null; needsReview: boolean } | null;
    isOwner: boolean;
  } | null>(null);
  const [patient, setPatient] = useState<{ patient: Record<string, unknown>; timeline: Array<{ canonicalKey: string; rawName: string; value: number | null; unit: string | null; testDate: string | null }>; plans: Array<{ id: string; titleAr: string; dueDate: string | null; status: string }> } | null>(null);
  const [notes, setNotes] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const [infoMsg, setInfoMsg] = useState("");
  const [corrOpen, setCorrOpen] = useState(false);
  const [corrField, setCorrField] = useState("VALUE");
  const [corrDetails, setCorrDetails] = useState("");
  const [planTitle, setPlanTitle] = useState("");
  const [planDue, setPlanDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    api<typeof detail>(`/api/reports/${reportId}`).then((d) => {
      setDetail(d);
      if (d?.review) { setNotes(d.review.notes ?? ""); setRecommendation(d.review.recommendation ?? ""); }
    }).catch(() => {});
    api<{ patient: { id: string } }>(`/api/doctor/patient/${reportId}`).catch(() => {});
  }, [reportId]);

  // جلب ملف المريض عبر صندوق الحالات (patientId من الحالة)
  useEffect(() => {
    void api<InboxData>("/api/doctor?filter=ALL").then((d) => {
      const c = d.cases.find((x) => x.reportId === reportId);
      if (c) void api<typeof patient>(`/api/doctor/patient/${c.patientId}`).then(setPatient).catch(() => setPatient(null));
    }).catch(() => {});
  }, [reportId]);

  const act = async (op: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    setMsg("");
    try {
      await api("/api/doctor", { body: { op, reportId, ...extra } });
      setMsg(t("common.success"));
      load();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.code : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  if (!detail) return <LoadingBlock />;
  const review = detail.review;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" onClick={onBack}>← {t("d.filter.ALL")}</Button>
        <div className="flex items-center gap-2">
          {review?.needsReview && <Badge tone="warning">{t("report.needsReviewBadge")}</Badge>}
          <StatusBadge status={detail.report.status} />
        </div>
      </div>

      <Card><CardContent className="p-4">
        <h1 className="flex items-center gap-2 font-extrabold text-navy"><FileText className="h-5 w-5 text-medblue" />{detail.report.fileName}</h1>
        <p className="mt-1 text-sm text-muted">{detail.report.labName ?? "—"} · {fmtDate(detail.report.testDate ?? "", lang)} · {detail.report.reportType}</p>
        {detail.report.fileType !== "json" && <Button asChild size="sm" variant="outline" className="mt-2"><a href={`/api/reports/${reportId}/file`} target="_blank" rel="noreferrer">{t("d.case.original")}</a></Button>}
      </CardContent></Card>

      {/* بيانات المريض */}
      {patient && (
        <Card><CardContent className="p-4">
          <h2 className="mb-2 font-bold text-navy">{t("d.case.history")}</h2>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div className="rounded-xl bg-lightblue p-2">{t("d.case.patient")}: <b>{String(patient.patient.fullName ?? "")}</b></div>
            <div className="rounded-xl bg-lightblue p-2">{t("records.historyChronic")}: <b>{Array.isArray(patient.patient.chronic) ? (patient.patient.chronic as Array<{ key: string }>).map((c) => c.key).join("، ") || "—" : "—"}</b></div>
            <div className="rounded-xl bg-lightblue p-2">{t("records.historyMeds")}: <b>{Array.isArray(patient.patient.medications) ? (patient.patient.medications as string[]).join("، ") || "—" : "—"}</b></div>
            <div className="rounded-xl bg-lightblue p-2">{t("records.historyAllergy")}: <b>{Array.isArray(patient.patient.allergies) ? (patient.patient.allergies as string[]).join("، ") || "—" : "—"}</b></div>
          </div>
        </CardContent></Card>
      )}

      {/* القيم */}
      <Card><CardContent className="p-5">
        <h2 className="mb-3 font-bold text-navy">{t("d.case.values")}</h2>
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[520px] text-sm" dir="ltr">
            <thead className="bg-lightblue/60 text-navy"><tr><th className="p-2.5 text-start">{t("trends.select")}</th><th className="p-2.5 text-start">{t("report.value")}</th><th className="p-2.5 text-start">{t("report.refRange")}</th><th className="p-2.5 text-start">{t("report.flag")}</th></tr></thead>
            <tbody>
              {detail.values.map((v) => (
                <tr key={v.id} className="border-t border-line">
                  <td className="p-2.5 font-semibold" dir="rtl">{v.rawName}</td>
                  <td className="p-2.5 font-bold">{v.value !== null ? fmtNumber(v.value, lang) : v.valueText}</td>
                  <td className="p-2.5 text-muted" dir="ltr">{v.refLow ?? "—"}–{v.refHigh ?? "—"} {v.unit}</td>
                  <td className="p-2.5"><FlagBadge flag={v.flag} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">{t("d.case.cannotEdit")}</p>
      </CardContent></Card>

      {/* الرأي وخطة المتابعة */}
      <Card><CardContent className="grid gap-4 p-5 md:grid-cols-2">
        <div>
          <h2 className="mb-2 font-bold text-navy">{t("d.case.notes")}</h2>
          <Textarea rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("d.case.notesHint")} />
          <div className="mt-2"><Label>{t("d.case.recommendation")}</Label><Input value={recommendation} onChange={(e) => setRecommendation(e.target.value)} placeholder={t("d.case.recommendationHint")} /></div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="success" disabled={busy || notes.length < 5} onClick={() => act("complete", { notes, recommendation })}>{t("d.case.complete")}</Button>
            <Button variant="outline" disabled={busy || infoMsg.length < 2} onClick={() => act("request-info", { message: infoMsg })}>{t("d.case.requestInfo")}</Button>
            <Button variant="destructive" disabled={busy} onClick={() => act("escalate")}>{t("d.case.escalate")}</Button>
            {detail.report.source === "LAB_DIRECT" && <Button variant="outline" onClick={() => setCorrOpen(true)}>{t("d.case.requestCorrection")}</Button>}
          </div>
          <div className="mt-2"><Label>{t("d.case.infoMessage")}</Label><Input value={infoMsg} onChange={(e) => setInfoMsg(e.target.value)} /></div>
          {review?.requestedInfo && <p className="mt-1 text-xs text-muted">↩ {review.requestedInfo}</p>}
        </div>
        <div>
          <h2 className="mb-2 font-bold text-navy">{t("d.followups.title")}</h2>
          <div className="space-y-2 rounded-xl border border-line p-3">
            <Input value={planTitle} onChange={(e) => setPlanTitle(e.target.value)} placeholder={t("d.followups.planTitle")} />
            <Input type="date" value={planDue} onChange={(e) => setPlanDue(e.target.value)} />
            <Button size="sm" className="w-full" disabled={busy || planTitle.length < 3} onClick={() => act("follow-up-create", { titleAr: planTitle, dueDate: planDue || undefined })}>{t("d.followups.create")}</Button>
          </div>
          {(patient?.plans ?? []).map((p) => (
            <div key={p.id} className="mt-2 flex items-center justify-between rounded-xl border border-line p-2.5 text-sm">
              <span>{p.titleAr}</span>
              <span className="text-xs text-muted">{fmtDate(p.dueDate, lang)} · {p.status}</span>
            </div>
          ))}
        </div>
      </CardContent></Card>

      {msg && <p className="rounded-lg bg-success/10 p-2 text-sm text-success">{msg}</p>}

      <Dialog open={corrOpen} onOpenChange={setCorrOpen}>
        <DialogContent title={t("d.case.requestCorrection")}>
          <div className="space-y-3">
            <div><Label>{t("report.correctionField")}</Label>
              <Select value={corrField} onValueChange={setCorrField} options={["VALUE", "REFERENCE", "DATE", "OTHER"].map((f) => ({ value: f, label: t(`report.correctionField.${f}`) }))} />
            </div>
            <div><Label>{t("report.correctionDetails")}</Label><Textarea value={corrDetails} onChange={(e) => setCorrDetails(e.target.value)} /></div>
            <Button className="w-full" disabled={busy || corrDetails.length < 5} onClick={async () => { await act("request-lab-correction", { field: corrField, details: corrDetails }); setCorrOpen(false); setCorrDetails(""); setMsg(t("d.correctionSent")); }}>{t("report.correctionSubmit")}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

void Stethoscope; void ClipboardList; void UserRound; void Select;
