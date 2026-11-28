"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { api, fmtDate, fmtNumber, ApiError } from "@/lib/api";
import { Card, CardContent, Badge, Button, Input, Label } from "@/components/ui/core";
import { Select } from "@/components/ui/overlays";
import { EmptyState, LoadingBlock, StatCard, FlagBadge } from "@/components/shared/common";
import { QrCode, Search, Upload, FilePlus2, RefreshCcw, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

const LAB_NAV = (t: (k: string) => string) => [
  { href: "/lab", label: t("lab.tab.today") },
];

interface LabOverview {
  lab: { canReviewHolds: boolean };
  today: { uploads: number; pending: number; corrections: number };
  totals: { critical: number; openOrders: number };
  recent: Array<{ id: string; fileName: string; status: string; uploadedAt: string; patientName: string; phoneMasked: string | null; openedByPatient: boolean; critical: boolean; valuesCount: number; verifiedCount: number; openCorrections: number }>;
  pending: Array<{ id: string; patientName: string; fileName: string; claimToken: string; createdAt: string; expiresAt: string; phoneMasked: string | null }>;
  orders: Array<{ id: string; orderNumber: string; qrToken: string; status: string; patientName: string; testKeys: string[]; note: string | null; createdAt: string }>;
  holds: Array<{ id: string; reportId: string | null; orderNumber: string | null; expectedName: string; providedName: string; createdAt: string }>;
}

export function LabDashboardPage() {
  const { t, lang } = useLang();
  const [data, setData] = useState<LabOverview | null>(null);
  const [tab, setTab] = useState<"today" | "upload" | "results" | "orders" | "corrections" | "holds">("today");
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    api<LabOverview>("/api/lab").then(setData).catch(() => setErr("NETWORK"));
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (["ORDER_CREATED", "REPORT_UPLOADED", "CORRECTION_OPENED", "CRITICAL_FLAG", "IDENTITY_HOLD"].includes(d?.type)) load();
    };
    window.addEventListener("aldawa:rt", h);
    window.addEventListener("aldawa:refresh", load);
    return () => { window.removeEventListener("aldawa:rt", h); window.removeEventListener("aldawa:refresh", load); };
  }, [load]);

  if (err) return <LabShell><EmptyState text={t("common.errorNetwork")} /></LabShell>;
  if (!data) return <LabShell><LoadingBlock /></LabShell>;

  return (
    <LabShell>
      <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-lightblue p-1">
        {([
          ["today", t("lab.tab.today")], ["orders", `${t("lab.tab.orders")} (${data.totals.openOrders})`],
          ["upload", t("lab.tab.upload")], ["results", t("lab.tab.results")],
          ["corrections", `${t("lab.tab.corrections")} (${data.today.corrections})`],
          ...(data.lab.canReviewHolds ? [["holds", `${t("lab.tab.holds")} (${data.holds.length})`] as const] : []),
        ] as Array<[typeof tab, string]>).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-lg px-3 py-1.5 text-sm font-bold ${tab === k ? "bg-white text-medblue-dark shadow-sm" : "text-muted"}`}>{label}</button>
        ))}
      </div>

      {tab === "today" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <StatCard label={t("lab.stat.uploads")} value={fmtNumber(data.today.uploads, lang)} tone="info" />
            <StatCard label={t("lab.stat.pending")} value={fmtNumber(data.today.pending, lang)} tone="warning" />
            <StatCard label={t("lab.stat.orders")} value={fmtNumber(data.totals.openOrders, lang)} tone="info" />
            <StatCard label={t("lab.stat.corrections")} value={fmtNumber(data.today.corrections, lang)} tone="warning" />
            <StatCard label={t("lab.stat.critical")} value={fmtNumber(data.totals.critical, lang)} tone="urgent" />
          </div>
          {data.recent.some((r) => r.critical) && (
            <div className="rounded-2xl border-2 border-urgent bg-urgent/5 p-3 text-sm font-bold text-urgent">{t("lab.smart.1")}</div>
          )}
          {data.orders.length > 0 && <div className="rounded-2xl border border-medblue/40 bg-lightblue p-3 text-sm">{t("lab.smart.4", { n: data.orders.length })}</div>}
          <Card><CardContent className="p-4">
            <h3 className="mb-3 font-bold text-navy">{t("lab.results.title")}</h3>
            {data.recent.length === 0 ? <EmptyState text={t("lab.orders.empty")} /> : data.recent.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2 text-sm last:border-0">
                <div><span className="font-semibold">{r.patientName}</span> <span dir="ltr" className="text-xs text-muted">{r.phoneMasked}</span><div className="text-xs text-muted">{r.fileName} · {fmtDate(r.uploadedAt, lang)}</div></div>
                <div className="flex items-center gap-2">
                  {r.critical && <Badge tone="urgent">{t("lab.results.criticalBadge")}</Badge>}
                  <Badge tone={r.openedByPatient ? "success" : "neutral"}>{r.openedByPatient ? t("lab.results.opened") : t("lab.results.notOpened")}</Badge>
                  <Badge tone="info">{r.status}</Badge>
                </div>
              </div>
            ))}
          </CardContent></Card>
        </div>
      )}

      {tab === "orders" && <OrdersTab data={data} reload={load} switchTab={(k) => setTab(k as never)} />}

      {tab === "upload" && <UploadTab reload={load} switchTab={(k) => setTab(k as never)} />}

      {tab === "results" && <ResultsTab data={data} reload={load} />}

      {tab === "corrections" && <CorrectionsTab reload={load} />}
      {tab === "holds" && <HoldsTab data={data} reload={load} canReview={data.lab.canReviewHolds} />}
    </LabShell>
  );
}

export function LabShell({ children }: { children: React.ReactNode }) {
  const { t } = useLang();
  return <DashboardShell home="/lab" title={t("shell.lab")} nav={LAB_NAV(t)}>{children}</DashboardShell>;
}

// ---------- الطلبات الواردة ----------
function OrdersTab({ data, reload: _reload, switchTab }: { data: LabOverview; reload: () => void; switchTab: (k: string) => void }) {
  const { t, lang } = useLang();
  return (
    <div className="space-y-3">
      {data.orders.length === 0 ? <EmptyState text={t("lab.orders.empty")} /> : data.orders.map((o) => (
        <Card key={o.id}><CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div dir="ltr" className="font-extrabold text-navy">{o.orderNumber}</div>
              <div className="text-sm text-muted">{o.patientName} · {fmtDate(o.createdAt, lang)}</div>
              {o.testKeys.length > 0 && <div className="text-xs text-muted">{t("lab.orders.tests")}: {o.testKeys.join("، ")}</div>}
              {o.note && <div className="text-xs text-muted">{o.note}</div>}
            </div>
            <div className="flex items-center gap-2">
              <Badge tone="info">{t(`orderStatus.${o.status}`)}</Badge>
              <Button size="sm" onClick={() => { sessionStorage.setItem("lab-order", o.orderNumber); switchTab("upload"); }}>{t("lab.orders.uploadResult")}</Button>
            </div>
          </div>
        </CardContent></Card>
      ))}
    </div>
  );
}

// ---------- رفع نتيجة: بالطلب/الكود أو بالرقم ----------
function UploadTab({ reload, switchTab }: { reload: () => void; switchTab: (k: string) => void }) {
  const { t } = useLang();
  const [mode, setMode] = useState<"order" | "phone">("order");
  const [orderNumber, setOrderNumber] = useState(sessionStorage.getItem("lab-order") ?? "");
  const [phone, setPhone] = useState("");
  const [identity, setIdentity] = useState<{ delivery: string; reason: string | null; fullName: string | null } | null>(null);
  const [providedName, setProvidedName] = useState("");
  const [reportType, setReportType] = useState("LAB");
  const [testDate, setTestDate] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [manual, setManual] = useState<Array<{ name: string; value: string; unit: string; refLow: string; refHigh: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [result, setResult] = useState<{ delivery: string; claimToken?: string; hold?: boolean; holdId?: string; id: string } | null>(null);

  useEffect(() => {
    const v = sessionStorage.getItem("lab-order");
    if (v) setOrderNumber(v);
  }, []);

  // مسح كود QR بكاميرا الجهاز — BarcodeDetector المدمج فقط (بلا مكتبات خارجية)
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scan = async () => {
    type BDetector = new (opts?: { formats?: string[] }) => { detect: (src: CanvasImageSource) => Promise<Array<{ rawValue: string }>> };
    const W = window as unknown as { BarcodeDetector?: BDetector };
    if (!W.BarcodeDetector) {
      setMsg("المسح المدمج غير متاح في هذا المتصفح — اكتب رقم الطلب يدويًا من الكود");
      return;
    }
    try {
      setScanning(true);
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      const detector = new W.BarcodeDetector({ formats: ["qr_code"] });
      const loop = async () => {
        if (!scanning && !video.srcObject) return;
        try {
          const codes = await detector.detect(video);
          if (codes.length > 0) {
            // محتوى الكود: aldawa-order:DW-...:token
            const raw = codes[0].rawValue;
            const parts = raw.split(":");
            if (parts.length >= 3 && parts[0] === "aldawa-order") {
              setOrderNumber(parts[1]);
              stopStream(stream);
              setMsg("تم قراءة الطلب من الكود ✓");
              return;
            }
          }
        } catch {
          /* إطار غير مقروء */
        }
        setTimeout(() => void loop(), 300);
      };
      void loop();
    } catch {
      setScanning(false);
      setMsg("تعذر فتح الكاميرا — اكتب رقم الطلب يدويًا");
    }
  };
  const stopStream = (stream: MediaStream) => {
    stream.getTracks().forEach((t) => t.stop());
    setScanning(false);
  };

  const checkPhone = async () => {
    setIdentity(null);
    try {
      const d = await api<{ found: boolean; delivery: string; reason: string | null; fullName: string | null }>("/api/lab", { body: { phone } });
      setIdentity(d);
      if (d.fullName) setProvidedName(d.fullName);
    } catch (e) {
      setMsg(e instanceof ApiError && e.code === "INVALID_PHONE" ? t("auth.err.INVALID_PHONE") : t("common.error"));
    }
  };

  const upload = async () => {
    setBusy(true);
    setMsg("");
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("reportType", reportType);
      if (testDate) fd.append("testDate", testDate);
      if (mode === "order") {
        fd.append("orderNumber", orderNumber);
      } else {
        fd.append("phone", phone);
        fd.append("patientName", providedName);
      }
      for (const f of files.slice(0, 5)) fd.append("files", f);
      const rows = manual.filter((m) => m.name && (m.value || m.value !== ""));
      if (rows.length > 0) fd.append("manualValues", JSON.stringify(rows.map((m) => ({ name: m.name, value: m.value === "" ? null : m.value, unit: m.unit || undefined, refLow: m.refLow || undefined, refHigh: m.refHigh || undefined }))));
      const d = await api<{ delivery: string; claimToken?: string; hold?: boolean; holdId?: string; id: string }>("/api/lab/results", { formData: fd });
      setResult(d);
      setFiles([]);
      setManual([]);
      reload();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "ERROR";
      if (code === "LAB_DAILY_LIMIT_REACHED") setMsg(t("lab.upload.dailyLimit", { n: String((e as ApiError).extra?.limit ?? "") }));
      else if (code === "RATE_LIMITED") setMsg(t("common.rateLimited"));
      else setMsg(code);
    } finally {
      setBusy(false);
    }
  };

  const identityBanner = identity && (
    <div className={`rounded-xl p-3 text-sm font-semibold ${identity.delivery === "DIRECT" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
      {identity.delivery === "DIRECT" && !identity.reason ? t("lab.upload.identityDirect") : identity.reason === "NO_CONSENT" ? t("lab.upload.identityPendingConsent") : t("lab.upload.identityPendingClaim")}
      {identity.fullName && <span className="ms-2">({identity.fullName})</span>}
    </div>
  );

  return (
    <Card><CardContent className="space-y-4 p-5">
      <h2 className="font-bold text-navy">{t("lab.upload.title")}</h2>
      <div className="flex gap-2">
        <button onClick={() => setMode("order")} className={`flex-1 rounded-xl border p-3 text-sm font-bold ${mode === "order" ? "border-medblue bg-lightblue text-medblue-dark" : "border-line text-muted"}`}>
          <QrCode className="mx-auto mb-1 h-5 w-5" />{t("lab.upload.byOrder")}
        </button>
        <button onClick={() => setMode("phone")} className={`flex-1 rounded-xl border p-3 text-sm font-bold ${mode === "phone" ? "border-medblue bg-lightblue text-medblue-dark" : "border-line text-muted"}`}>
          <Search className="mx-auto mb-1 h-5 w-5" />{t("lab.upload.byPhone")}
        </button>
      </div>

      {mode === "order" ? (
        <div>
          <Label>{t("lab.upload.orderNumber")}</Label>
          <div className="flex gap-2">
            <Input dir="ltr" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} placeholder={t("lab.upload.scanHint")} />
            <Button type="button" variant="soft" onClick={() => void scan()}>
              <QrCode className="h-4 w-4" />{t("lab.upload.scan")}
            </Button>
          </div>
          {scanning && (
            <div className="mt-2 overflow-hidden rounded-xl border border-line">
              <video ref={videoRef} className="h-48 w-full object-cover" muted playsInline />
              <button className="w-full bg-lightblue py-1.5 text-xs font-bold text-muted" onClick={() => { const v = videoRef.current?.srcObject as MediaStream | null; if (v) stopStream(v); setScanning(false); }}>
                {t("common.cancel")}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            <div className="flex-1"><Label>{t("lab.upload.phone")}</Label><Input dir="ltr" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01xxxxxxxxx" /></div>
            <Button variant="soft" className="self-end" onClick={checkPhone}><Search className="h-4 w-4" />{t("lab.upload.check")}</Button>
          </div>
          {identityBanner}
          <div><Label>{t("lab.upload.patientName")}</Label><Input value={providedName} onChange={(e) => setProvidedName(e.target.value)} /><p className="mt-1 text-xs text-muted">{t("lab.upload.nameHint")}</p></div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label>{t("lab.upload.reportType")}</Label>
          <Select value={reportType} onValueChange={setReportType} options={[{ value: "LAB", label: t("lab.upload.reportType.LAB") }, { value: "RADIOLOGY", label: t("lab.upload.reportType.RADIOLOGY") }, { value: "OTHER", label: t("lab.upload.reportType.OTHER") }]} />
        </div>
        <div><Label>{t("lab.upload.testDate")}</Label><Input type="date" value={testDate} onChange={(e) => setTestDate(e.target.value)} /></div>
      </div>

      <div>
        <Label>{t("lab.upload.files")}</Label>
        <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} className="mt-1 w-full rounded-xl border border-dashed border-line p-3 text-sm" />
        <p className="mt-1 text-xs text-muted">{t("lab.upload.filesHint")}</p>
        {files.length > 0 && <p className="text-xs text-success">{files.map((f) => f.name).join("، ")}</p>}
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between"><Label><FilePlus2 className="inline h-4 w-4" /> {t("lab.upload.manual")}</Label>
          <Button size="sm" variant="soft" onClick={() => setManual((m) => [...m, { name: "", value: "", unit: "", refLow: "", refHigh: "" }])}>{t("lab.upload.addRow")}</Button>
        </div>
        <div className="space-y-2">
          {manual.map((m, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-6">
              <Input className="sm:col-span-2" placeholder={t("lab.upload.testName")} value={m.name} onChange={(e) => setManual((x) => x.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))} />
              <Input dir="ltr" placeholder={t("lab.upload.value")} value={m.value} onChange={(e) => setManual((x) => x.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))} />
              <Input dir="ltr" placeholder="Unit" value={m.unit} onChange={(e) => setManual((x) => x.map((r, j) => (j === i ? { ...r, unit: e.target.value } : r)))} />
              <Input dir="ltr" placeholder="Ref Low" value={m.refLow} onChange={(e) => setManual((x) => x.map((r, j) => (j === i ? { ...r, refLow: e.target.value } : r)))} />
              <Input dir="ltr" placeholder="Ref High" value={m.refHigh} onChange={(e) => setManual((x) => x.map((r, j) => (j === i ? { ...r, refHigh: e.target.value } : r)))} />
            </div>
          ))}
        </div>
      </div>

      {msg && <p className="rounded-lg bg-urgent/10 p-2 text-sm text-urgent">{msg}</p>}
      {result && (
        <div className={`rounded-xl p-3 text-sm ${result.delivery === "DIRECT" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
          {result.delivery === "DIRECT" ? t("lab.upload.identityDirect") : t("lab.upload.identityPendingClaim")}
          {result.claimToken && <div dir="ltr" className="mt-1 break-all font-mono text-xs">{result.claimToken}</div>}
          {result.hold && <div className="mt-2 flex items-center gap-2 font-bold text-warning"><AlertTriangle className="h-4 w-4" />{t("lab.orders.holdWarning")} <button className="underline" onClick={() => switchTab("holds")}>{t("lab.tab.holds")}</button></div>}
        </div>
      )}
      <Button className="w-full" disabled={busy} onClick={upload}><Upload className="h-4 w-4" />{busy ? t("common.uploading") : t("lab.upload.submit")}</Button>
      <p className="text-xs text-muted">{t("lab.upload.note")}</p>
    </CardContent></Card>
  );
}

// ---------- النتائج + تأكيد القيم ----------
function ResultsTab({ data, reload }: { data: LabOverview; reload: () => void }) {
  const { t, lang } = useLang();
  const [details, setDetails] = useState<null | { report: { id: string; patientName: string; status: string; openedByPatient: boolean }; values: Array<{ id: string; rawName: string; value: number | null; valueText: string | null; unit: string | null; refLow: number | null; refHigh: number | null; flag: string; verification: string }> }>(null);
  const [editVal, setEditVal] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const openDetails = async (id: string) => {
    setMsg("");
    try {
      const d = await api<{ report: { id: string; patientName: string; status: string; openedByPatient: boolean }; values: typeof details extends null ? never : NonNullable<typeof details>["values"] }>(`/api/lab/results/${id}`);
      setDetails(d);
    } catch {
      setMsg(t("common.error"));
    }
  };

  const saveValue = async (valueId: string) => {
    setBusy(true);
    try {
      await api(`/api/lab/results/${details!.report.id}`, { body: { op: "edit-value", valueId, value: editVal[valueId] } });
      setEditVal((x) => { const n = { ...x }; delete n[valueId]; return n; });
      openDetails(details!.report.id);
    } catch { setMsg(t("common.error")); } finally { setBusy(false); }
  };

  const verifyAll = async () => {
    setBusy(true);
    setMsg("");
    try {
      await api(`/api/lab/results/${details!.report.id}`, { body: { op: "verify-all" } });
      setDetails(null);
      reload();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "ERROR";
      setMsg(code === "HOLD_BLOCKED" ? t("lab.holds.blockedNote") : code === "CONSENT_WITHDRAWN" ? t("consents.withdrawnNote") : t("common.error"));
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      {msg && <p className="rounded-lg bg-warning/10 p-2 text-sm text-warning">{msg}</p>}
      {data.recent.length === 0 ? <EmptyState text={t("lab.orders.empty")} /> : data.recent.map((r) => (
        <Card key={r.id}><CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
          <div className="min-w-0">
            <span className="font-semibold">{r.patientName}</span> <span dir="ltr" className="text-xs text-muted">{r.phoneMasked}</span>
            <div className="text-xs text-muted">{r.fileName} · {fmtDate(r.uploadedAt, lang)} · {r.verifiedCount}/{r.valuesCount} {t("report.values")}</div>
          </div>
          <div className="flex items-center gap-2">
            {r.critical && <Badge tone="urgent">{t("lab.results.criticalBadge")}</Badge>}
            {r.openCorrections > 0 && <Badge tone="warning">{r.openCorrections}</Badge>}
            <Badge tone={r.openedByPatient ? "success" : "neutral"}>{r.openedByPatient ? t("lab.results.opened") : t("lab.results.notOpened")}</Badge>
            <Button size="sm" onClick={() => openDetails(r.id)}>{t("lab.results.verify")}</Button>
          </div>
        </CardContent></Card>
      ))}

      {details && (
        <Card className="border-medblue"><CardContent className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-bold text-navy">{t("lab.verify.title")} — {details.report.patientName}</h3>
            <Button size="sm" variant="ghost" onClick={() => setDetails(null)}>{t("common.close")}</Button>
          </div>
          <div className="space-y-2">
            {details.values.map((v) => {
              const verified = v.verification === "VERIFIED_LAB" || v.verification === "CORRECTED_LAB";
              return (
                <div key={v.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-2.5 text-sm">
                  <span className="min-w-40 flex-1 font-semibold">{v.rawName}</span>
                  <span dir="ltr" className="text-muted">{v.refLow ?? "—"}–{v.refHigh ?? "—"} {v.unit}</span>
                  <FlagBadge flag={v.flag} />
                  {verified ? <Badge tone="success">{t("lab.verify.verified")}</Badge> : editVal[v.id] !== undefined ? (
                    <span className="flex items-center gap-1">
                      <Input dir="ltr" className="h-8 w-24" value={editVal[v.id]} onChange={(e) => setEditVal((x) => ({ ...x, [v.id]: e.target.value }))} />
                      <Button size="sm" variant="success" disabled={busy} onClick={() => saveValue(v.id)}>{t("lab.verify.saveValue")}</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditVal((x) => { const n = { ...x }; delete n[v.id]; return n; })}><XCircle className="h-4 w-4" /></Button>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <b dir="ltr">{v.value !== null ? fmtNumber(v.value, lang) : v.valueText}</b>
                      <Button size="sm" variant="ghost" onClick={() => setEditVal((x) => ({ ...x, [v.id]: String(v.value ?? "") }))}><RefreshCcw className="h-3.5 w-3.5" /></Button>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <Button className="mt-4 w-full" disabled={busy} onClick={verifyAll}><CheckCircle2 className="h-4 w-4" />{t("lab.verify.confirmAll")}</Button>
          <p className="mt-1 text-center text-xs text-muted">{t("lab.verify.confirmHint")}</p>
        </CardContent></Card>
      )}

      {data.pending.length > 0 && (
        <Card><CardContent className="p-4">
          <h3 className="mb-2 font-bold text-navy">{t("lab.results.pendingTitle")}</h3>
          {data.pending.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2 text-sm last:border-0">
              <div><span className="font-semibold">{p.patientName}</span> <span dir="ltr" className="text-xs text-muted">{p.phoneMasked}</span><div className="text-xs text-muted">{p.fileName} · {fmtDate(p.createdAt, lang)}</div></div>
              <Badge tone="warning">{t("lab.results.status.PENDING")}</Badge>
            </div>
          ))}
        </CardContent></Card>
      )}
    </div>
  );
}

// ---------- طلبات التصحيح ----------
function CorrectionsTab({ reload }: { reload: () => void }) {
  const { t, lang } = useLang();
  const [rows, setRows] = useState<Array<{ id: string; reportId: string; reportName: string; patientName: string; field: string; details: string; status: string; oldValue: string | null; newValue: string | null; createdAt: string; resolution: string | null }>>([]);
  const [values, setValues] = useState<Record<string, { newValue: string; note: string }>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const load = useCallback(() => {
    api<{ corrections: typeof rows }>("/api/lab/results").then((d) => setRows(d.corrections)).catch(() => {});
  }, []);
  useEffect(() => { void load(); }, [load]);

  const resolveWithReport = async (row: typeof rows[number], decision: "RESOLVED" | "REJECTED") => {
    setBusy(true);
    setMsg("");
    try {
      await api(`/api/lab/results/${row.reportId}`, { body: { op: "resolve-correction", correctionId: row.id, decision, newValue: values[row.id]?.newValue, resolution: values[row.id]?.note } });
      reload();
      load();
    } catch {
      setMsg(t("common.error"));
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      {msg && <p className="rounded-lg bg-urgent/10 p-2 text-sm text-urgent">{msg}</p>}
      <p className="rounded-xl bg-lightblue p-3 text-xs text-muted">{t("lab.corrections.resolvedNote")}</p>
      {rows.length === 0 ? <EmptyState text="—" /> : rows.map((r) => (
        <Card key={r.id} className={r.status === "OPEN" ? "border-warning" : ""}><CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><span className="font-semibold">{r.patientName}</span> <span className="text-xs text-muted">{r.reportName} · {fmtDate(r.createdAt, lang)}</span></div>
            <Badge tone={r.status === "OPEN" ? "warning" : r.status === "RESOLVED" ? "success" : "neutral"}>{t(`report.correctionStatus.${r.status}`)}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted">{t(`report.correctionField.${r.field}`)} — {r.details}</p>
          {r.status === "OPEN" && (
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <Input dir="ltr" placeholder={t("lab.corrections.newValue")} value={values[r.id]?.newValue ?? ""} onChange={(e) => setValues((v) => ({ ...v, [r.id]: { newValue: e.target.value, note: v[r.id]?.note ?? "" } }))} />
              <Input placeholder={t("lab.corrections.labNote")} value={values[r.id]?.note ?? ""} onChange={(e) => setValues((v) => ({ ...v, [r.id]: { newValue: v[r.id]?.newValue ?? "", note: e.target.value } }))} />
              <div className="flex gap-2">
                <Button size="sm" className="flex-1" disabled={busy} onClick={() => resolveWithReport(r, "RESOLVED")}>{t("lab.corrections.resolve")}</Button>
                <Button size="sm" variant="outline" className="flex-1" disabled={busy} onClick={() => resolveWithReport(r, "REJECTED")}>{t("lab.corrections.reject")}</Button>
              </div>
            </div>
          )}
          {r.newValue && <p dir="ltr" className="mt-1 text-xs">{r.oldValue ?? "—"} → <b>{r.newValue}</b></p>}
        </CardContent></Card>
      ))}
      void lang;
    </div>
  );
}

// ---------- تعارضات الاسم — المشرف فقط ----------
function HoldsTab({ data, reload, canReview }: { data: LabOverview; reload: () => void; canReview: boolean }) {
  const { t } = useLang();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const act = async (id: string, decision: "APPROVED" | "REJECTED") => {
    setBusy(true);
    setMsg("");
    try {
      await api("/api/lab/holds", { body: { id, decision, note } });
      setNote("");
      reload();
    } catch (e) {
      setMsg(e instanceof ApiError && e.code === "SUPERVISOR_REQUIRED" ? t("lab.holds.supervisorOnly") : t("common.error"));
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <p className="rounded-xl bg-warning/10 p-3 text-xs text-ink">{t("lab.holds.blockedNote")}</p>
      {!canReview && <p className="rounded-lg bg-urgent/10 p-2 text-sm text-urgent">{t("lab.holds.supervisorOnly")}</p>}
      {msg && <p className="rounded-lg bg-urgent/10 p-2 text-sm text-urgent">{msg}</p>}
      {data.holds.length === 0 ? <EmptyState text="—" /> : data.holds.map((h) => (
        <Card key={h.id} className="border-warning"><CardContent className="p-4">
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <div className="rounded-xl bg-lightblue p-2"><b>{t("lab.holds.expected")}:</b> {h.expectedName}</div>
            <div className="rounded-xl bg-warning/10 p-2"><b>{t("lab.holds.provided")}:</b> {h.providedName}</div>
          </div>
          {h.orderNumber && <p dir="ltr" className="mt-1 text-xs text-muted">{h.orderNumber}</p>}
          {canReview && (
            <div className="mt-3 space-y-2">
              <Input placeholder={t("lab.holds.note")} value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex gap-2">
                <Button size="sm" variant="success" className="flex-1" disabled={busy} onClick={() => act(h.id, "APPROVED")}>{t("lab.holds.approve")}</Button>
                <Button size="sm" variant="destructive" className="flex-1" disabled={busy} onClick={() => act(h.id, "REJECTED")}>{t("lab.holds.reject")}</Button>
              </div>
            </div>
          )}
        </CardContent></Card>
      ))}
    </div>
  );
}
