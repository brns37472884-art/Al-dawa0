"use client";
import { useCallback, useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";
import { api, ApiError, fmtDate } from "@/lib/api";
import { Card, CardContent, Badge, Button, Input, Label } from "@/components/ui/core";
import { LoadingBlock, EmptyState } from "@/components/shared/common";
import { PatientShell } from "./patient-home";

interface PlanItem { key: string; nameAr: string; nameEn: string; priceEgp: number; reportsLimit: number; featuresAr: string[]; featuresEn: string[] }
interface RequestItem { id: string; planKey: string; amountEgp: number; method: string; senderRef: string | null; status: string; reviewNote: string | null; createdAt: string; reviewedAt: string | null }
interface PayData { requests: RequestItem[]; subscription: { planKey: string; expiresAt: string | null } | null; info: Record<string, string> }

const METHODS = ["CASH", "INSTAPAY", "BANK_TRANSFER"] as const;
const ERR_CODES = ["INVALID_PLAN", "INVALID_METHOD", "NO_FILE", "UNSUPPORTED_FORMAT", "FILE_TOO_LARGE", "EMPTY_FILE", "PENDING_EXISTS", "RATE_LIMITED"];
const MAX_BYTES = 5 * 1024 * 1024;

export function SubscriptionPage() {
  const { t, lang } = useLang();
  const [plans, setPlans] = useState<PlanItem[] | null>(null);
  const [data, setData] = useState<PayData | null>(null);
  const [planKey, setPlanKey] = useState("");
  const [method, setMethod] = useState<(typeof METHODS)[number]>("INSTAPAY");
  const [senderRef, setSenderRef] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const load = useCallback(() => {
    api<PayData>("/api/payments/requests").then(setData).catch(() => setData({ requests: [], subscription: null, info: {} }));
  }, []);

  useEffect(() => {
    load();
    api<{ plans: PlanItem[] }>("/api/plans").then((d) => {
      const paid = (d.plans ?? []).filter((p) => p.priceEgp > 0);
      setPlans(paid);
      const wanted = new URLSearchParams(window.location.search).get("plan") ?? "";
      setPlanKey(paid.find((p) => p.key === wanted)?.key ?? paid[0]?.key ?? "");
    }).catch(() => setPlans([]));
  }, [load]);

  if (!plans || !data) return <PatientShell active="/app/subscription"><LoadingBlock /></PatientShell>;

  const selected = plans.find((p) => p.key === planKey) ?? null;
  const pending = data.requests.some((r) => r.status === "PENDING");
  const planName = (k: string) => { const p = plans.find((x) => x.key === k); return p ? (lang === "ar" ? p.nameAr : p.nameEn) : k; };
  const tone = (s: string) => (s === "APPROVED" ? "success" : s === "REJECTED" ? "urgent" : "warning") as "success" | "urgent" | "warning";

  const pick = (f: File | null) => {
    setError("");
    if (f && f.size > MAX_BYTES) { setFile(null); setError("FILE_TOO_LARGE"); return; }
    setFile(f);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !file) return;
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("planKey", selected.key);
      fd.append("method", method);
      fd.append("senderRef", senderRef);
      fd.append("file", file);
      await api("/api/payments/requests", { formData: fd });
      setSent(true);
      setFile(null);
      setSenderRef("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : "ERROR");
    } finally {
      setBusy(false);
    }
  };

  const info = (data.info[method] ?? "").trim();

  return (
    <PatientShell active="/app/subscription">
      <div className="mb-4">
        <h1 className="text-xl font-extrabold text-navy">{t("sub.title")}</h1>
        <p className="text-sm text-muted">{t("sub.sub")}</p>
      </div>

      <Card className="mb-4"><CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
        <div>
          <div className="text-xs text-muted">{t("sub.current")}</div>
          <div className="font-bold text-navy">{planName(data.subscription?.planKey ?? "FREE")}</div>
        </div>
        {data.subscription?.expiresAt && <Badge tone="info">{t("sub.expires")}: {fmtDate(data.subscription.expiresAt, lang)}</Badge>}
      </CardContent></Card>

      {sent && <p className="mb-4 rounded-xl bg-success/10 p-3 text-sm font-semibold text-success">{t("sub.sent")}</p>}

      {pending ? (
        <p className="mb-4 rounded-xl bg-warning/10 p-3 text-sm font-semibold text-warning">{t("sub.pendingNote")}</p>
      ) : plans.length === 0 ? (
        <EmptyState text={t("sub.noPlans")} />
      ) : (
        <form onSubmit={submit} className="mb-6 space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            {plans.map((p) => (
              <button key={p.key} type="button" onClick={() => setPlanKey(p.key)} className={`rounded-2xl border p-4 text-start ${planKey === p.key ? "border-medblue bg-lightblue" : "border-line bg-white"}`}>
                <div className="font-bold text-navy">{lang === "ar" ? p.nameAr : p.nameEn}</div>
                <div className="mt-1 text-2xl font-extrabold text-medblue">{p.priceEgp} <span className="text-sm font-semibold text-muted">{t("packages.currency")} / {t("packages.perMonth")}</span></div>
                <div className="mt-1 text-xs text-muted">{p.reportsLimit === -1 ? t("packages.unlimited") : t("packages.reportsPerMonth", { n: p.reportsLimit })}</div>
              </button>
            ))}
          </div>

          <Card><CardContent className="space-y-4 p-4">
            <div>
              <Label>{t("sub.method")}</Label>
              <div className="mt-1 grid gap-2 sm:grid-cols-3">
                {METHODS.map((m) => (
                  <button key={m} type="button" onClick={() => setMethod(m)} className={`rounded-xl border p-2.5 text-sm font-bold ${method === m ? "border-medblue bg-lightblue text-medblue-dark" : "border-line text-muted"}`}>{t(`sub.method.${m}`)}</button>
                ))}
              </div>
            </div>

            <div className="rounded-xl bg-lightblue p-3 text-sm">
              <div className="mb-1 font-bold text-navy">{t("sub.howTo", { amount: selected?.priceEgp ?? 0 })}</div>
              <p className="whitespace-pre-wrap text-ink" dir="auto">{info || t("sub.noInfo")}</p>
            </div>

            <div><Label htmlFor="s-ref">{t("sub.ref")}</Label><Input id="s-ref" maxLength={120} value={senderRef} onChange={(e) => setSenderRef(e.target.value)} /></div>
            <div>
              <Label htmlFor="s-file">{t("sub.proof")} *</Label>
              <input id="s-file" type="file" accept="image/png,image/jpeg,application/pdf" onChange={(e) => pick(e.target.files?.[0] ?? null)} className="mt-1 block w-full rounded-xl border border-input bg-white p-2 text-sm file:me-3 file:rounded-lg file:border-0 file:bg-lightblue file:px-3 file:py-1.5 file:font-bold file:text-medblue-dark" />
              <p className="mt-1 text-xs text-muted">{t("sub.proofHint")}</p>
            </div>
            {error && <p className="rounded-lg bg-urgent/10 p-2.5 text-sm text-urgent">{ERR_CODES.includes(error) ? t(`sub.err.${error}`) : t("common.error")}</p>}
            <Button type="submit" className="w-full" disabled={busy || !selected || !file}>{busy ? t("sub.sending") : t("sub.submit")}</Button>
          </CardContent></Card>
        </form>
      )}

      <h2 className="mb-2 font-bold text-navy">{t("sub.history")}</h2>
      {data.requests.length === 0 ? <EmptyState text={t("sub.noHistory")} /> : (
        <div className="space-y-2">
          {data.requests.map((r) => (
            <Card key={r.id}><CardContent className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <div>
                <div className="font-bold text-navy">{planName(r.planKey)} — {r.amountEgp} {t("packages.currency")}</div>
                <div className="text-xs text-muted">{t(`sub.method.${r.method}`)} · {fmtDate(r.createdAt, lang)}</div>
                {r.status === "REJECTED" && r.reviewNote && <div className="mt-1 text-xs text-urgent">{r.reviewNote}</div>}
              </div>
              <Badge tone={tone(r.status)}>{t(`sub.status.${r.status}`)}</Badge>
            </CardContent></Card>
          ))}
        </div>
      )}
    </PatientShell>
  );
}
