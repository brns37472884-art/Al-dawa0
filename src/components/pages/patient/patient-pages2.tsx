"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import { PatientShell } from "./patient-home";
import { api, fmtDate, fmtNumber, ApiError } from "@/lib/api";
import { Card, CardContent, Badge, Button, Input, Label, Switch, Textarea } from "@/components/ui/core";
import { Select } from "@/components/ui/overlays";
import { EmptyState, LoadingBlock, FlagBadge } from "@/components/shared/common";
import { Send, Trash2, QrCode } from "lucide-react";

// ============================================================
// الاتجاهات — مقارنة بنفس الوحدة بصياغة محايدة
// ============================================================
interface TrendsData {
  availableKeys: string[];
  catalogEntry: { key: string; nameAr: string; nameEn: string; unit: string; refLow: number | null; refHigh: number | null } | null;
  series: Array<{ id: string; value: number | null; valueText: string | null; unit: string | null; refLow: number | null; refHigh: number | null; flag: string; verified: string; date: string; source: string }>;
  last: { value: number | null; unit: string | null } | null;
  deltaPct: number | null;
  direction: string | null;
  meaningful: boolean;
}

export function TrendsPage() {
  const { t, lang } = useLang();
  const [data, setData] = useState<TrendsData | null>(null);
  const [key, setKey] = useState("");
  useEffect(() => {
    api<TrendsData>("/api/trends").then((d) => {
      if (d.availableKeys.length && !key) setKey(d.availableKeys[0]);
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!key) return;
    api<TrendsData>(`/api/trends?key=${encodeURIComponent(key)}`).then(setData).catch(() => {});
  }, [key]);

  if (!data) return <PatientShell active="/app/trends"><LoadingBlock /></PatientShell>;
  const cat = data.catalogEntry;
  const points = data.series.filter((s) => s.value !== null);

  return (
    <PatientShell active="/app/trends">
      <h1 className="mb-1 text-xl font-extrabold text-navy">{t("trends.title")}</h1>
      <p className="mb-4 text-sm text-muted">{t("trends.note")}</p>
      <div className="mb-4 flex flex-wrap gap-1">
        {data.availableKeys.map((k) => (
          <button key={k} onClick={() => setKey(k)} className={`rounded-full px-3 py-1.5 text-xs font-bold ${key === k ? "bg-medblue text-white" : "bg-lightblue text-muted"}`}>{k}</button>
        ))}
      </div>

      {!key || points.length === 0 ? (
        <EmptyState text={t("trends.empty")} />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Card><CardContent className="p-4 text-center">
              <div className="text-xs text-muted">{t("trends.lastValue")}</div>
              <div dir="ltr" className="text-3xl font-extrabold text-navy">{fmtNumber(data.last?.value ?? null, lang)}</div>
              <div className="text-xs text-muted">{cat?.unit ?? data.last?.unit}</div>
            </CardContent></Card>
            <Card><CardContent className="p-4 text-center">
              <div className="text-xs text-muted">{t("trends.change")}</div>
              <div dir="ltr" className="text-2xl font-extrabold">{data.deltaPct !== null ? `${data.deltaPct > 0 ? "+" : ""}${data.deltaPct.toFixed(1)}%` : "—"}</div>
              {data.direction && <Badge tone={data.direction === "UP" ? "warning" : data.direction === "DOWN" ? "info" : "neutral"}>{t(`direction.${data.direction}`)}</Badge>}
            </CardContent></Card>
            <Card><CardContent className="p-4 text-center">
              <div className="text-xs text-muted">{t("trends.refRange")}</div>
              <div dir="ltr" className="text-sm font-bold text-navy">{cat?.refLow ?? "—"} – {cat?.refHigh ?? "—"} {cat?.unit}</div>
              {data.meaningful && <Badge tone="warning" className="mt-2">{t("trends.meaningful")}</Badge>}
            </CardContent></Card>
          </div>

          {points.length >= 2 && (
            <Card><CardContent className="p-5">
              <div className="chart-wrap">
                <svg viewBox="0 0 600 200" className="w-full">
                  {[...points].map((pt, i) => {
                    const vals = points.map((p) => p.value!);
                    const min = Math.min(...vals, cat?.refLow ?? Infinity);
                    const max = Math.max(...vals, cat?.refHigh ?? -Infinity);
                    const pad = (max - min) * 0.15 || 1;
                    const lo = min - pad, hi = max + pad;
                    const x = (i / Math.max(1, points.length - 1)) * 540 + 30;
                    const y = 180 - ((pt.value! - lo) / (hi - lo)) * 160;
                    return <circle key={pt.id} cx={x} cy={y} r="4" fill="#087eae" />;
                  })}
                  {points.length >= 2 && (() => {
                    const vals = points.map((p) => p.value!);
                    const min = Math.min(...vals, cat?.refLow ?? Infinity);
                    const max = Math.max(...vals, cat?.refHigh ?? -Infinity);
                    const pad = (max - min) * 0.15 || 1;
                    const lo = min - pad, hi = max + pad;
                    const path = points.map((pt, i) => {
                      const x = (i / (points.length - 1)) * 540 + 30;
                      const y = 180 - ((pt.value! - lo) / (hi - lo)) * 160;
                      return `${i === 0 ? "M" : "L"}${x},${y}`;
                    }).join(" ");
                    return <path d={path} fill="none" stroke="#087eae" strokeWidth="2.5" strokeLinecap="round" />;
                  })()}
                  {cat?.refLow != null && cat?.refHigh != null && (() => {
                    const vals = points.map((p) => p.value!);
                    const min = Math.min(...vals, cat.refLow);
                    const max = Math.max(...vals, cat.refHigh);
                    const pad = (max - min) * 0.15 || 1;
                    const lo = min - pad, hi = max + pad;
                    const yLo = 180 - ((cat.refLow - lo) / (hi - lo)) * 160;
                    const yHi = 180 - ((cat.refHigh - lo) / (hi - lo)) * 160;
                    return <rect x="30" y={yHi} width="540" height={Math.max(1, yLo - yHi)} fill="#21865a" opacity="0.08" />;
                  })()}
                </svg>
              </div>
            </CardContent></Card>
          )}

          <Card><CardContent className="p-5">
            <h3 className="mb-3 font-bold text-navy">{t("trends.allReadings")}</h3>
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-lightblue/60 text-navy"><tr>
                  <th className="p-2.5 text-start">{t("trends.date")}</th><th className="p-2.5 text-start">{t("report.value")}</th>
                  <th className="p-2.5 text-start">{t("report.unit")}</th><th className="p-2.5 text-start">{t("report.flag")}</th><th className="p-2.5 text-start">{t("trends.source")}</th>
                </tr></thead>
                <tbody>
                  {[...data.series].reverse().map((s) => (
                    <tr key={s.id} className="border-t border-line">
                      <td className="p-2.5">{fmtDate(s.date, lang)}</td>
                      <td className="p-2.5 font-bold" dir="ltr">{s.value !== null ? fmtNumber(s.value, lang) : s.valueText}</td>
                      <td className="p-2.5 text-muted">{s.unit}</td>
                      <td className="p-2.5"><FlagBadge flag={s.flag} /></td>
                      <td className="p-2.5 text-muted">{s.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent></Card>
        </div>
      )}
    </PatientShell>
  );
}

// ============================================================
// أفراد الأسرة
// ============================================================
export function FamilyPage() {
  const { t, lang } = useLang();
  const [members, setMembers] = useState<Array<{ id: string; name: string; relation: string; dateOfBirth: string | null }>>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", relation: "SON", dateOfBirth: "", gender: "MALE" });
  const [msg, setMsg] = useState("");
  const load = useCallback(() => api<{ members: typeof members }>("/api/family").then((d) => setMembers(d.members)).catch(() => {}), []);
  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    setMsg("");
    try {
      await api("/api/family", { body: form });
      setOpen(false);
      setForm({ name: "", relation: "SON", dateOfBirth: "", gender: "MALE" });
      load();
    } catch (e) {
      setMsg(e instanceof ApiError ? t(`auth.err.${e.code}`) ?? e.code : t("common.error"));
    }
  };
  const remove = async (id: string) => {
    await api(`/api/family?id=${id}`, { method: "DELETE" });
    load();
  };

  return (
    <PatientShell active="/app/family">
      <div className="mb-4 flex items-center justify-between">
        <div><h1 className="text-xl font-extrabold text-navy">{t("family.title")}</h1><p className="text-sm text-muted">{t("family.sub")}</p></div>
        <Button onClick={() => setOpen(!open)}>{t("family.add")}</Button>
      </div>
      {msg && <p className="mb-3 rounded-lg bg-urgent/10 p-2 text-sm text-urgent">{msg}</p>}
      {open && (
        <Card className="mb-4"><CardContent className="grid gap-3 p-4 sm:grid-cols-2">
          <div><Label>{t("auth.fullName")}</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><Label>{t("family.relation")}</Label>
            <Select value={form.relation} onValueChange={(v) => setForm({ ...form, relation: v })} options={["SPOUSE", "SON", "DAUGHTER", "FATHER", "MOTHER", "BROTHER", "SISTER", "OTHER"].map((r) => ({ value: r, label: t(`relation.${r}`) }))} />
          </div>
          <div><Label>{t("auth.dob")}</Label><Input type="date" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} /></div>
          <div><Label>{t("auth.gender")}</Label>
            <Select value={form.gender} onValueChange={(v) => setForm({ ...form, gender: v })} options={[{ value: "MALE", label: t("auth.genderMale") }, { value: "FEMALE", label: t("auth.genderFemale") }]} />
          </div>
          <div className="sm:col-span-2"><Button className="w-full" disabled={form.name.length < 2} onClick={add}>{t("family.add")}</Button></div>
        </CardContent></Card>
      )}
      {members.length === 0 ? <EmptyState text={t("family.sub")} /> : (
        <div className="grid gap-3 sm:grid-cols-2">
          {members.map((m) => (
            <Card key={m.id}><CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="font-bold text-navy">{m.name}</div>
                <Badge tone="info">{t(`relation.${m.relation}`)}</Badge>
              </div>
              <div className="mt-1 text-xs text-muted">{fmtDate(m.dateOfBirth, lang)}</div>
              <div className="mt-3 flex gap-2">
                <Button asChild size="sm" variant="outline" className="flex-1"><a href={`/app/records`}>{t("family.records")}</a></Button>
                <Button size="sm" variant="ghost" onClick={() => remove(m.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </CardContent></Card>
          ))}
        </div>
      )}
    </PatientShell>
  );
}

// ============================================================
// طلبات الفحص — رقم طلب + QR
// ============================================================
interface OrderItem {
  id: string; orderNumber: string; qrToken: string; status: string; labName: string; markaz: string | null;
  testKeys: string[]; note: string | null; createdAt: string; reports: Array<{ id: string; status: string }>;
}
interface LabItem { id: string; name: string; markaz: { name: string; nameEn: string | null } | null; address: string | null }

export function OrdersPage() {
  const { t, lang } = useLang();
  const [orders, setOrders] = useState<OrderItem[] | null>(null);
  const [labs, setLabs] = useState<LabItem[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ labId: "", tests: "", note: "" });
  const [msg, setMsg] = useState("");
  const [created, setCreated] = useState<{ orderNumber: string; qrToken: string } | null>(null);

  const load = useCallback(() => api<{ orders: OrderItem[] }>("/api/orders").then((d) => setOrders(d.orders)).catch(() => {}), []);
  useEffect(() => { load(); api<{ labs: LabItem[] }>("/api/labs").then((d) => setLabs(d.labs)).catch(() => {}); }, [load]);

  const create = async () => {
    setMsg("");
    try {
      const d = await api<{ orderNumber: string; qrToken: string }>("/api/orders", {
        body: { labId: form.labId, testKeys: form.tests.split(/[,،\n]/).map((s) => s.trim()).filter(Boolean), note: form.note },
      });
      setCreated(d);
      setOpen(false);
      setForm({ labId: "", tests: "", note: "" });
      load();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.code : t("common.error"));
    }
  };
  const cancel = async (id: string) => {
    await api("/api/orders", { method: "PATCH", body: { id } });
    load();
  };

  const qrData = created ? `aldawa-order:${created.orderNumber}:${created.qrToken}` : "";

  return (
    <PatientShell active="/app/orders">
      <div className="mb-4 flex items-center justify-between">
        <div><h1 className="text-xl font-extrabold text-navy">{t("orders.title")}</h1><p className="text-sm text-muted">{t("orders.sub")}</p></div>
        <Button onClick={() => setOpen(!open)}>{t("orders.create")}</Button>
      </div>

      {created && (
        <Card className="mb-4 border-success"><CardContent className="flex flex-wrap items-center gap-4 p-4">
          <QrCode className="h-16 w-16 text-navy" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-success">{t("orders.created")}</p>
            <p dir="ltr" className="text-lg font-extrabold text-navy">{created.orderNumber}</p>
            <p className="text-xs text-muted">{t("orders.qrHint")}</p>
            <p dir="ltr" className="mt-1 break-all text-[10px] text-muted">{qrData}</p>
          </div>
        </CardContent></Card>
      )}

      {open && (
        <Card className="mb-4"><CardContent className="grid gap-3 p-4">
          <div><Label>{t("orders.lab")}</Label>
            <Select value={form.labId} onValueChange={(v) => setForm({ ...form, labId: v })} placeholder="—" options={labs.map((l) => ({ value: l.id, label: `${l.name} — ${l.markaz?.name ?? ""}` }))} />
          </div>
          <div><Label>{t("orders.tests")}</Label><Input value={form.tests} onChange={(e) => setForm({ ...form, tests: e.target.value })} placeholder={t("orders.testsHint")} /></div>
          <div><Label>{t("orders.note")}</Label><Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
          {msg && <p className="rounded-lg bg-urgent/10 p-2 text-sm text-urgent">{msg}</p>}
          <Button disabled={!form.labId} onClick={create}>{t("orders.submit")}</Button>
        </CardContent></Card>
      )}

      {orders === null ? <LoadingBlock /> : orders.length === 0 ? <EmptyState text={t("orders.noOrders")} /> : (
        <div className="space-y-2">
          {orders.map((o) => (
            <Card key={o.id}><CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
              <div>
                <div dir="ltr" className="font-extrabold text-navy">{o.orderNumber}</div>
                <div className="text-sm text-muted">{o.labName}{o.markaz ? ` — ${o.markaz}` : ""} · {fmtDate(o.createdAt, lang)}</div>
                {o.testKeys.length > 0 && <div className="text-xs text-muted">{o.testKeys.join("، ")}</div>}
                {o.reports.length > 0 && <div className="text-xs text-success">{t("orders.resultsLinked")}: {o.reports.length}</div>}
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={o.status === "CONFIRMED" ? "success" : o.status === "CANCELLED" ? "neutral" : o.status === "RESULT_UPLOADED" ? "info" : "warning"}>{t(`orderStatus.${o.status}`)}</Badge>
                {o.status === "CREATED" && <Button size="sm" variant="ghost" onClick={() => cancel(o.id)}>{t("orders.cancel")}</Button>}
              </div>
            </CardContent></Card>
          ))}
        </div>
      )}
    </PatientShell>
  );
}

// ============================================================
// الإشعارات والموافقات
// ============================================================
interface NotifItem { id: string; type: string; titleAr: string; titleEn: string; bodyAr: string; bodyEn: string; severity: string; link: string | null; isRead: boolean; createdAt: string }

export function NotificationsPage() {
  return (
    <PatientShell active="/app/notifications">
      <NotificationsContent />
    </PatientShell>
  );
}

/** محتوى الإشعارات بلا غلاف — يُستخدم داخل غلاف أي دور */
export function NotificationsContent() {
  const { t, lang } = useLang();
  const [items, setItems] = useState<NotifItem[]>([]);
  const load = useCallback(() => api<{ items: NotifItem[] }>("/api/notifications").then((d) => setItems(d.items)).catch(() => {}), []);
  useEffect(() => { void load(); }, [load]);
  const markAll = async () => { await api("/api/notifications", { method: "PATCH", body: {} }); load(); };

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-extrabold text-navy">{t("notif.title")}</h1>
        <Button variant="outline" size="sm" onClick={markAll}>{t("notif.markAll")}</Button>
      </div>
      {items.length === 0 ? <EmptyState text={t("notif.empty")} /> : (
        <div className="space-y-2">
          {items.map((n) => (
            <a key={n.id} href={n.link ?? "#"} onClick={() => api("/api/notifications", { method: "PATCH", body: { id: n.id } }).catch(() => {})}
              className={`block rounded-2xl border bg-white p-4 ${n.isRead ? "border-line" : "border-medblue"}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-navy">{lang === "ar" ? n.titleAr : n.titleEn}</span>
                <Badge tone={n.severity === "URGENT" ? "urgent" : n.severity === "WARNING" ? "warning" : "info"}>{t(`type.${n.type}`)}</Badge>
              </div>
              <p className="mt-1 text-sm text-muted">{lang === "ar" ? n.bodyAr : n.bodyEn}</p>
              <p className="mt-1 text-xs text-muted/70">{fmtDate(n.createdAt, lang)}</p>
            </a>
          ))}
        </div>
      )}
    </>
  );
}

export function ConsentsPage() {
  const { t, lang } = useLang();
  const [map, setMap] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState("");
  useEffect(() => {
    api<{ consents: Array<{ type: string; granted: boolean }> }>("/api/profile").then((d) => {
      setMap(Object.fromEntries(d.consents.map((c) => [c.type, c.granted])));
    }).catch(() => {});
  }, []);
  const toggle = async (key: string, type: string) => {
    const next = !map[type];
    setMap((m) => ({ ...m, [type]: next }));
    setMsg("");
    try {
      await api("/api/profile", { method: "PUT", body: { consents: { [key]: next } } });
      setMsg(t("common.saved"));
    } catch {
      setMap((m) => ({ ...m, [type]: !next }));
      setMsg(t("common.error"));
    }
  };
  const items: Array<{ key: string; type: string; label: string }> = [
    { key: "data", type: "DATA_PROCESSING", label: t("consents.DATA_PROCESSING") },
    { key: "ai", type: "AI_ANALYSIS", label: t("consents.AI_ANALYSIS") },
    { key: "doctor", type: "DOCTOR_SHARE", label: t("consents.DOCTOR_SHARE") },
    { key: "notifications", type: "NOTIFICATIONS", label: t("consents.NOTIFICATIONS") },
    { key: "labShare", type: "LAB_RESULT_SHARING", label: t("consents.LAB_RESULT_SHARING") },
    { key: "research", type: "RESEARCH", label: t("consents.RESEARCH") },
  ];
  return (
    <PatientShell active="/app/consents">
      <h1 className="mb-1 text-xl font-extrabold text-navy">{t("consents.title")}</h1>
      <p className="mb-1 text-sm text-muted">{t("consents.sub")}</p>
      <p className="mb-4 rounded-xl bg-warning/10 p-3 text-xs text-ink">{t("consents.withdrawnNote")}</p>
      <div className="space-y-3">
        {items.map((it) => (
          <Card key={it.type}><CardContent className="flex items-center justify-between gap-3 p-4">
            <span className="text-sm font-semibold text-ink">{lang ? it.label : it.label}</span>
            <Switch checked={map[it.type] === true} onCheckedChange={() => toggle(it.key, it.type)} />
          </CardContent></Card>
        ))}
      </div>
      {msg && <p className="mt-3 text-sm text-success">{msg}</p>}
    </PatientShell>
  );
}

// ============================================================
// المساعد الصحي
// ============================================================
interface ChatMsg { id: string; role: string; content: string; createdAt: string }

export function AssistantPage() {
  const { t, lang } = useLang();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => api<{ messages: ChatMsg[] }>("/api/assistant").then((d) => setMessages(d.messages)).catch(() => {}), []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);

  const send = async (text?: string) => {
    const message = (text ?? input).trim();
    if (!message || busy) return;
    setInput("");
    setBusy(true);
    try {
      const d = await api<{ reply: string }>("/api/assistant", { body: { message } });
      setMessages((m) => [...m, { id: `u-${Date.now()}`, role: "USER", content: message, createdAt: new Date().toISOString() }, { id: `a-${Date.now()}`, role: "ASSISTANT", content: d.reply, createdAt: new Date().toISOString() }]);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      setMessages((m) => [...m, { id: `e-${Date.now()}`, role: "ASSISTANT", content: code === "RATE_LIMITED" ? t("common.rateLimited") : t("assistant.unavailable"), createdAt: new Date().toISOString() }]);
    } finally {
      setBusy(false);
    }
  };
  const clear = async () => {
    await api("/api/assistant", { method: "DELETE" });
    setConfirmClear(false);
    load();
  };

  return (
    <PatientShell active="/app/assistant">
      <div className="mb-1 text-xl font-extrabold text-navy">{t("assistant.title")}</div>
      <p className="mb-2 text-sm text-muted">{t("assistant.intro")}</p>
      <div className="mb-3 rounded-xl bg-warning/10 p-3 text-xs text-ink">{t("assistant.disclaimer")}</div>

      <Card className="flex h-[55vh] flex-col">
        <CardContent className="flex flex-1 flex-col overflow-y-auto p-4">
          {messages.length === 0 ? (
            <div className="m-auto text-center">
              <p className="text-sm text-muted">{t("assistant.intro")}</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {[1, 2, 3, 4].map((i) => (
                  <button key={i} onClick={() => send(t(`assistant.sug${i}`))} className="rounded-xl border border-line bg-white p-2.5 text-xs font-semibold text-medblue-dark hover:bg-lightblue">{t(`assistant.sug${i}`)}</button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((m) => (
                <div key={m.id} className={`flex ${m.role === "USER" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl p-3 text-sm ${m.role === "USER" ? "rounded-ee-md bg-medblue text-white" : "rounded-es-md bg-lightblue text-ink"}`} dir={lang === "ar" ? "rtl" : "ltr"}>
                    {m.content}
                  </div>
                </div>
              ))}
              {busy && <div className="text-sm text-muted">{t("common.loading")}</div>}
              <div ref={endRef} />
            </div>
          )}
        </CardContent>
        <div className="border-t border-line p-3">
          {messages.length > 0 && (
            <div className="mb-2 text-end">
              {confirmClear ? (
                <span className="text-xs text-muted">
                  {t("assistant.clearConfirm")}{" "}
                  <button className="font-bold text-urgent" onClick={clear}>{t("common.yes")}</button> ·{" "}
                  <button className="font-bold text-medblue" onClick={() => setConfirmClear(false)}>{t("common.no")}</button>
                </span>
              ) : (
                <button className="text-xs text-muted hover:underline" onClick={() => setConfirmClear(true)}>{t("assistant.clear")}</button>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <Input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder={t("assistant.placeholder")} />
            <Button disabled={busy || !input.trim()} onClick={() => send()}><Send className="h-4 w-4" /></Button>
          </div>
        </div>
      </Card>
    </PatientShell>
  );
}

void fmtNumber;
