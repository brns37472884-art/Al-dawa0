"use client";
import { useCallback, useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { api, fmtDate, ApiError } from "@/lib/api";
import { Card, CardContent, Badge, Button, Textarea, Input, Label } from "@/components/ui/core";
import { Select } from "@/components/ui/overlays";
import { LoadingBlock, StatCard } from "@/components/shared/common";

const OFFICER_NAV = (t: (k: string) => string) => [{ href: "/officer", label: t("shell.nav.protocols") }];

interface OfficerData {
  counts: Record<string, number>;
  total: number;
  protocols: Array<{
    id: string; key: string; titleAr: string; titleEn: string; summaryAr: string; category: string; gender: string | null;
    minAge: number; maxAge: number | null; intervalMonths: number | null; riskFactors: string; requiresRisk: boolean;
    protocolType: string; sourceOrg: string; guidelineVersion: string; guidelineDate: string; doctorDiscussion: boolean;
    exclusionsAr: string | null; seeDoctorAr: string | null; status: string; version: number; approvedAt: string | null;
    reviews: Array<{ id: string; officerName: string; action: string; fromStatus: string; toStatus: string; note: string | null; createdAt: string }>;
    versions: Array<{ id: string; version: number; publishedAt: string; snapshot: string }>;
  }>;
  rules: Array<{ id: string; key: string; testKey: string; op: string; threshold: number; severity: string; unit: string; messageAr: string; status: string; version: number; approvedAt: string | null }>;
  reviews: Array<{ id: string; officerName: string; action: string; fromStatus: string; toStatus: string; note: string | null; createdAt: string }>;
  approvedRulesCount: number;
}

export function OfficerDashboardPage() {
  const { t, lang } = useLang();
  const [data, setData] = useState<OfficerData | null>(null);
  const [tab, setTab] = useState<"protocols" | "rules" | "log">("protocols");
  const [filter, setFilter] = useState("ALL");
  const [noteFor, setNoteFor] = useState<{ id: string; kind: string; op: string } | null>(null);
  const [note, setNote] = useState("");
  const [compareId, setCompareId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(() => { void api<OfficerData>("/api/officer").then(setData).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (kind: string, id: string, op: string, noteText?: string) => {
    setBusy(true);
    setMsg("");
    try {
      await api("/api/officer", { body: { kind, id, op, note: noteText } });
      setNoteFor(null);
      setNote("");
      setMsg(t("common.success"));
      load();
    } catch (e) {
      setMsg(e instanceof ApiError && e.code === "NOTE_REQUIRED" ? t("o.noteRequired") : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <OfficerShell><LoadingBlock /></OfficerShell>;
  const protocols = data.protocols.filter((p) => filter === "ALL" || p.status === filter);
  const compareP = data.protocols.find((p) => p.id === compareId);

  return (
    <OfficerShell>
      <div className="mb-4 rounded-2xl border border-medblue/40 bg-lightblue p-3 text-sm font-semibold text-medblue-dark">{t("o.banner")}</div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={t("o.counts.draft")} value={data.counts.DRAFT ?? 0} tone="warning" />
        <StatCard label={t("o.counts.inReview")} value={data.counts.IN_REVIEW ?? 0} tone="info" />
        <StatCard label={t("o.counts.approved")} value={data.counts.APPROVED ?? 0} tone="success" />
        <StatCard label={t("o.counts.retired")} value={data.counts.RETIRED ?? 0} tone="neutral" />
      </div>

      <div className="mb-4 flex gap-1 rounded-xl bg-lightblue p-1">
        {(["protocols", "rules", "log"] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-lg px-3 py-1.5 text-sm font-bold ${tab === k ? "bg-white text-medblue-dark shadow-sm" : "text-muted"}`}>{t(`o.tab.${k}`)}</button>
        ))}
      </div>

      {msg && <p className="mb-3 rounded-lg bg-success/10 p-2 text-sm text-success">{msg}</p>}
      <p className="mb-3 rounded-xl bg-lightblue p-3 text-xs text-muted">{t("o.protocolApprovedNote")}</p>

      {tab === "protocols" && (
        <div className="space-y-3">
          {compareP && (
            <Card className="border-medblue"><CardContent className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-bold text-navy">{t("o.compareTitle", { title: compareP.titleAr })}</h3>
                <Button size="sm" variant="ghost" onClick={() => setCompareId(null)}>{t("common.close")}</Button>
              </div>
              {(() => {
                const published = compareP.versions[0];
                const cur = compareP;
                if (!published) return <p className="text-sm text-muted">{t("o.compareNone")}</p>;
                let snap: Record<string, unknown> = {};
                try { snap = JSON.parse(published.snapshot); } catch {}
                const fields: Array<[string, string]> = [
                  ["titleAr", lang ? "" : ""], ["summaryAr", ""], ["minAge", ""], ["maxAge", ""], ["intervalMonths", ""], ["sourceOrg", ""], ["guidelineVersion", ""], ["guidelineDate", ""],
                ];
                const rows = fields.filter(([f]) => snap[f] !== undefined).map(([f]) => ({ f, prev: String(snap[f] ?? "—"), cur: String((cur as unknown as Record<string, unknown>)[f] ?? "—") }));
                const changed = rows.filter((r) => r.prev !== r.cur);
                return changed.length === 0 ? <p className="text-sm text-muted">{t("o.compareNone")}</p> : (
                  <table className="w-full text-sm"><thead><tr className="text-start"><th className="p-2 text-start">{t("o.compareField")}</th><th className="p-2 text-start">{t("o.comparePrev")} (v{published.version})</th><th className="p-2 text-start">{t("o.compareCurrent")}</th></tr></thead>
                    <tbody>{changed.map((r) => <tr key={r.f} className="border-t border-line"><td className="p-2 font-bold">{r.f}</td><td className="p-2 text-muted">{r.prev}</td><td className="p-2">{r.cur}</td></tr>)}</tbody></table>
                );
              })()}
            </CardContent></Card>
          )}
          <div className="flex flex-wrap gap-1">
            {["ALL", "DRAFT", "IN_REVIEW", "APPROVED"].map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-3 py-1.5 text-xs font-bold ${filter === f ? "bg-medblue text-white" : "bg-lightblue text-muted"}`}>{f === "ALL" ? t("common.all") : t(`o.counts.${f.toLowerCase()}`)}</button>
            ))}
          </div>
          {protocols.map((p) => (
            <Card key={p.id}><CardContent className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-bold text-navy">{lang === "ar" ? p.titleAr : p.titleEn}</span>
                  <div className="mt-0.5 text-xs text-muted">
                    {t(`o.type.${p.protocolType}`)} · {p.minAge}{p.maxAge ? `–${p.maxAge}` : "+"} · {p.intervalMonths ? `${t("plan.nextDue")}: ${p.intervalMonths}` : ""} · {p.sourceOrg} v{p.guidelineVersion} ({p.guidelineDate}) · v{p.version}
                  </div>
                </div>
                <Badge tone={p.status === "APPROVED" ? "success" : p.status === "RETIRED" ? "neutral" : p.status === "IN_REVIEW" ? "info" : "warning"}>{t(`o.counts.${p.status.toLowerCase()}`)}</Badge>
              </div>
              <p className="mt-1 text-sm text-muted">{lang === "ar" ? p.summaryAr : p.titleEn}</p>
              {p.exclusionsAr && <p className="mt-1 text-xs text-muted"><b>{t("plan.exclusions")}:</b> {p.exclusionsAr.slice(0, 120)}…</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {p.status === "DRAFT" && <Button size="sm" variant="outline" disabled={busy} onClick={() => act("protocol", p.id, "start-review")}>{t("o.startReview")}</Button>}
                {["DRAFT", "IN_REVIEW"].includes(p.status) && <Button size="sm" variant="success" disabled={busy} onClick={() => { if (confirm(t("o.approveConfirm"))) act("protocol", p.id, "approve"); }}>{t("o.approve")}</Button>}
                {["IN_REVIEW", "APPROVED"].includes(p.status) && <Button size="sm" variant="outline" disabled={busy} onClick={() => setNoteFor({ id: p.id, kind: "protocol", op: "return" })}>{t("o.return")}</Button>}
                {p.status !== "RETIRED" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => act("protocol", p.id, "retire")}>{t("o.retire")}</Button>}
                {p.versions.length > 0 && <Button size="sm" variant="ghost" onClick={() => setCompareId(p.id)}>{t("o.compare")}</Button>}
              </div>
            </CardContent></Card>
          ))}
        </div>
      )}

      {tab === "rules" && (
        <div className="space-y-3">
          {data.approvedRulesCount === 0 && <div className="rounded-2xl border-2 border-urgent bg-urgent/5 p-3 text-sm font-bold text-urgent">{t("o.rulesWarning")}</div>}
          <p className="rounded-xl bg-lightblue p-3 text-xs text-muted">{t("o.rulesNote")}</p>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-lightblue/60 text-navy"><tr>
                <th className="p-2.5 text-start">#</th><th className="p-2.5 text-start">Test</th><th className="p-2.5 text-start">Rule</th>
                <th className="p-2.5 text-start">Severity</th><th className="p-2.5 text-start">Status</th><th className="p-2.5 text-start">—</th>
              </tr></thead>
              <tbody>
                {data.rules.map((r, i) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="p-2.5">{i + 1}</td>
                    <td className="p-2.5 font-bold" dir="ltr">{r.testKey}</td>
                    <td className="p-2.5" dir="ltr">{r.op} {r.threshold} {r.unit}</td>
                    <td className="p-2.5"><Badge tone={r.severity === "URGENT" ? "urgent" : "warning"}>{r.severity}</Badge></td>
                    <td className="p-2.5"><Badge tone={r.status === "APPROVED" ? "success" : r.status === "RETIRED" ? "neutral" : r.status === "IN_REVIEW" ? "info" : "warning"}>{r.status === "APPROVED" ? t("o.ruleApproved", { v: r.version }) : t(`o.counts.${r.status.toLowerCase()}`)}</Badge></td>
                    <td className="p-2.5">
                      <div className="flex gap-1">
                        {r.status === "DRAFT" && <Button size="sm" variant="outline" disabled={busy} onClick={() => act("rule", r.id, "start-review")}>→</Button>}
                        {["DRAFT", "IN_REVIEW"].includes(r.status) && <Button size="sm" variant="success" disabled={busy} onClick={() => act("rule", r.id, "approve")}>✓</Button>}
                        {r.status !== "RETIRED" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setNoteFor({ id: r.id, kind: "rule", op: "return" })}>↩</Button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "log" && (
        <Card><CardContent className="p-4">
          <h3 className="mb-2 font-bold text-navy">{t("o.reviewLog")}</h3>
          {data.reviews.map((r) => (
            <div key={r.id} className="border-b border-line py-2 text-sm last:border-0">
              <span className="font-semibold">{r.officerName}</span> — {r.action} ({r.fromStatus} → {r.toStatus}) · {fmtDate(r.createdAt, lang)}
              {r.note && <span className="text-muted"> «{r.note}»</span>}
            </div>
          ))}
        </CardContent></Card>
      )}

      <DialogNote noteFor={noteFor} note={note} setNote={setNote} onCancel={() => setNoteFor(null)} onSubmit={() => noteFor && act(noteFor.kind, noteFor.id, noteFor.op, note)} busy={busy} label={t("o.noteRequired")} />
    </OfficerShell>
  );
}

export function OfficerShell({ children }: { children: React.ReactNode }) {
  const { t } = useLang();
  return <DashboardShell title={t("shell.officer")} nav={OFFICER_NAV(t)}>{children}</DashboardShell>;
}

function DialogNote({ noteFor, note, setNote, onCancel, onSubmit, busy, label }: { noteFor: { id: string; kind: string; op: string } | null; note: string; setNote: (s: string) => void; onCancel: () => void; onSubmit: () => void; busy: boolean; label: string }) {
  const { t } = useLang();
  return (
    <dialog open={!!noteFor} className="fixed inset-0 z-50 m-auto h-fit w-[min(92vw,460px)] rounded-2xl border border-line bg-white p-5 shadow-xl" dir="rtl">
      <h3 className="mb-2 font-bold text-navy">{label}</h3>
      <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
      <div className="mt-3 flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onCancel}>{t("common.cancel")}</Button>
        <Button className="flex-1" disabled={busy || !note.trim()} onClick={onSubmit}>{t("common.confirm")}</Button>
      </div>
    </dialog>
  );
}

void Input; void Label; void Select;
