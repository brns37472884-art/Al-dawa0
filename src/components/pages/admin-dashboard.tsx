"use client";
import { useCallback, useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { api, fmtDate, fmtNumber, ApiError } from "@/lib/api";
import { Card, CardContent, Badge, Button, Input, Label, Switch, Textarea, Table, THead, TR, TH, TD } from "@/components/ui/core";
import { Select } from "@/components/ui/overlays";
import { LoadingBlock, StatCard, StatusBadge } from "@/components/shared/common";

const ADMIN_NAV = (t: (k: string) => string) => [{ href: "/admin", label: t("shell.admin") }];
const TABS = ["overview", "users", "doctors", "labs", "markaz", "plans", "payments", "payment-requests", "broadcast", "settings", "audit", "contact", "protocols", "alerts", "network"] as const;

export function AdminDashboardPage() {
  const { t, lang } = useLang();
  const [tab, setTab] = useState<(typeof TABS)[number]>("overview");
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState("");

  const load = useCallback(() => { void api<Record<string, unknown>>(`/api/admin/${tab}`).then(setData).catch(() => setData({})); }, [tab]);
  useEffect(() => { load(); }, [load]);

  const post = async (op: string, body: Record<string, unknown>, refreshTab = true) => {
    setMsg("");
    try {
      await api(`/api/admin/${tab}`, { body: { op, ...body } });
      setMsg(t("common.saved"));
      if (refreshTab) load();
      return true;
    } catch (e) {
      setMsg(e instanceof ApiError ? e.code : t("common.error"));
      return false;
    }
  };

  if (data === null) return <AdminShell><LoadingBlock /></AdminShell>;
  const stats = data as { users?: number; activeUsers?: number; subscribers?: number; revenue?: number; reports?: number; pendingReviews?: number; securityEvents?: number; openAlerts?: number; activeLabs?: number; failedReports?: number };

  return (
    <AdminShell>
      <div className="mb-4 rounded-2xl border border-navy/30 bg-lightblue p-3 text-sm font-semibold text-navy">{t("a.privacyNote")}</div>
      <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-lightblue p-1">
        {TABS.map((tb) => (
          <button key={tb} onClick={() => setTab(tb)} className={`rounded-lg px-3 py-1.5 text-sm font-bold ${tab === tb ? "bg-white text-medblue-dark shadow-sm" : "text-muted"}`}>{t(`a.tab.${tb}`)}</button>
        ))}
      </div>
      {msg && <p className="mb-3 rounded-lg bg-success/10 p-2 text-sm text-success">{msg}</p>}

      {tab === "overview" && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label={t("a.stats.users")} value={fmtNumber(stats.users ?? 0, lang)} tone="navy" />
          <StatCard label={t("a.stats.active")} value={fmtNumber(stats.activeUsers ?? 0, lang)} tone="info" />
          <StatCard label={t("a.stats.subscribers")} value={fmtNumber(stats.subscribers ?? 0, lang)} tone="success" />
          <StatCard label={t("a.stats.revenue")} value={fmtNumber(stats.revenue ?? 0, lang)} tone="success" />
          <StatCard label={t("a.stats.reports")} value={fmtNumber(stats.reports ?? 0, lang)} tone="info" />
          <StatCard label={t("a.stats.pendingReviews")} value={fmtNumber(stats.pendingReviews ?? 0, lang)} tone="warning" />
          <StatCard label={t("a.stats.securityEvents")} value={fmtNumber(stats.securityEvents ?? 0, lang)} tone="urgent" />
          <StatCard label={t("a.stats.openAlerts")} value={fmtNumber(stats.openAlerts ?? 0, lang)} tone="urgent" />
          <StatCard label={t("a.stats.labsActive")} value={fmtNumber(stats.activeLabs ?? 0, lang)} tone="info" />
          <StatCard label="FAILED" value={fmtNumber(stats.failedReports ?? 0, lang)} tone="warning" />
        </div>
      )}

      {tab === "users" && (
        <div className="space-y-3">
          <CreateUserForm post={post} />
          <Input placeholder={t("a.users.search")} value={q} onChange={(e) => setQ(e.target.value)} />
          <Table>
            <THead><TR><TH>{t("auth.fullName")}</TH><TH>{t("auth.email")}</TH><TH>{t("a.users.role")}</TH><TH>{t("a.users.status")}</TH><TH>—</TH></TR></THead>
            <tbody>
              {((data.users as Array<{ id: string; fullName: string; email: string; role: string; isActive: boolean }>) ?? [])
                .filter((u) => !q || u.fullName.includes(q) || u.email.toLowerCase().includes(q.toLowerCase()))
                .map((u) => (
                <TR key={u.id}>
                  <TD>{u.fullName}</TD><TD dir="ltr">{u.email}</TD>
                  <TD><Badge tone="info">{u.role}</Badge></TD>
                  <TD><Badge tone={u.isActive ? "success" : "urgent"}>{u.isActive ? t("a.users.active") : t("a.users.suspended")}</Badge></TD>
                  <TD className="space-x-1 space-x-reverse whitespace-nowrap">
                    <Button size="sm" variant="outline" onClick={() => post("toggle-active", { id: u.id })}>{t("a.users.toggle")}</Button>
                    <Button size="sm" variant="outline" onClick={() => {
                      const pw = window.prompt(`${u.email}\nكلمة سر جديدة: 8 خانات على الأقل، فيها حرف إنجليزي ورقم / New password: 8+ chars with a letter and a digit`);
                      if (!pw) return;
                      if (pw.length < 8 || !/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) { window.alert("كلمة السر ضعيفة: لازم 8 خانات + حرف إنجليزي + رقم / Weak password"); return; }
                      void post("reset-password", { id: u.id, password: pw }).then((ok) => window.alert(ok ? `تم تغيير كلمة سر ${u.email} ✅` : "فشل التغيير ❌"));
                    }}>{lang === "ar" ? "كلمة السر" : "Password"}</Button>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
          <p className="text-xs text-muted">{t("a.users.suspendNote")}</p>
        </div>
      )}

      {tab === "doctors" && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {((data.doctors as Array<{ id: string; fullName: string; email: string; specialty: string | null; licenseNumber: string | null; isVerified: boolean; isActive: boolean }>) ?? []).map((d) => (
            <Card key={d.id}><CardContent className="p-4">
              <div className="font-bold text-navy">{d.fullName}</div>
              <div dir="ltr" className="text-xs text-muted">{d.email}</div>
              <div className="mt-1 text-xs">{d.specialty} · {d.licenseNumber}</div>
              <div className="mt-2 flex items-center justify-between">
                <Badge tone={d.isVerified ? "success" : "warning"}>{d.isVerified ? "✓" : "—"}</Badge>
                <Button size="sm" variant="outline" onClick={() => post("toggle-verify", { id: d.id })}>{t("a.doctors.verify")}</Button>
              </div>
            </CardContent></Card>
          ))}
        </div>
      )}

      {tab === "labs" && <LabsTab data={data} post={post} load={load} />}

      {tab === "markaz" && (
        <div className="space-y-2">
          {((data.markaz as Array<{ id: string; name: string; labs: Array<{ id: string }> }>) ?? []).map((m) => (
            <Card key={m.id}><CardContent className="flex flex-wrap items-center justify-between gap-2 p-3">
              <span className="font-bold text-navy">{m.name}</span>
              <RenameMarkaz id={m.id} name={m.name} post={post} />
            </CardContent></Card>
          ))}
        </div>
      )}

      {tab === "plans" && (
        <div className="grid gap-3 sm:grid-cols-3">
          {((data.plans as Array<{ key: string; nameAr: string; priceEgp: number; reportsLimit: number; isActive: boolean }>) ?? []).map((p) => (
            <Card key={p.key}><CardContent className="p-4">
              <div className="flex items-center justify-between"><span className="font-bold text-navy">{p.nameAr}</span>
                <Switch checked={p.isActive} onCheckedChange={(v) => post("update", { key: p.key, isActive: v })} id={`plan-${p.key}`} />
              </div>
              <div className="mt-2"><Label>{t("a.plans.price")}</Label>
                <Input type="number" defaultValue={p.priceEgp} onBlur={(e) => post("update", { key: p.key, priceEgp: Number(e.target.value) })} />
              </div>
              <div className="mt-2"><Label>{t("a.plans.limit")}</Label>
                <Input type="number" defaultValue={p.reportsLimit} onBlur={(e) => post("update", { key: p.key, reportsLimit: Number(e.target.value) })} />
              </div>
            </CardContent></Card>
          ))}
        </div>
      )}

      {tab === "payments" && <PaymentsTab data={data} post={post} />}
      {tab === "payment-requests" && <PaymentRequestsTab data={data} post={post} />}

      {tab === "broadcast" && <BroadcastTab post={post} />}

      {tab === "settings" && (
        <div className="space-y-2">
          <p className="rounded-xl bg-lightblue p-3 text-xs text-muted">{t("a.settings.note")}</p>
          {((data.settings as Array<{ key: string; value: string; noteAr: string | null }>) ?? []).map((s) => (
            <Card key={s.key}><CardContent className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div><span dir="ltr" className="font-bold text-navy">{s.key}</span><div className="text-xs text-muted">{s.noteAr}</div></div>
              <Input className="w-40" defaultValue={s.value} onBlur={(e) => post("update", { key: s.key, value: e.target.value })} />
            </CardContent></Card>
          ))}
        </div>
      )}

      {tab === "audit" && (
        <Table>
          <THead><TR><TH>{t("a.audit.action")}</TH><TH>{t("a.audit.actor")}</TH><TH>{t("a.audit.entity")}</TH><TH>{t("a.audit.time")}</TH></TR></THead>
          <tbody>
            {((data.logs as Array<{ id: string; action: string; actorName: string | null; actorRole: string | null; entityType: string | null; entityId: string | null; createdAt: string }>) ?? []).map((l) => (
              <TR key={l.id}><TD dir="ltr">{l.action}</TD><TD>{l.actorName ?? l.actorRole ?? "—"}</TD><TD className="text-xs text-muted">{l.entityType} {l.entityId?.slice(0, 8)}</TD><TD className="text-xs">{fmtDate(l.createdAt, lang)}</TD></TR>
            ))}
          </tbody>
        </Table>
      )}

      {tab === "contact" && (
        <div className="space-y-2">
          {((data.messages as Array<{ id: string; name: string; email: string; subject: string; message: string; handled: boolean; createdAt: string }>) ?? []).map((m) => (
            <Card key={m.id}><CardContent className="p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-navy">{m.name} <span dir="ltr" className="text-xs text-muted">{m.email}</span></span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted">{fmtDate(m.createdAt, lang)}</span>
                  <Button size="sm" variant={m.handled ? "success" : "outline"} onClick={() => post("toggle-handled", { id: m.id })}>{t("a.contact.handled")}</Button>
                </div>
              </div>
              {m.subject && <div className="mt-1 text-sm font-semibold">{m.subject}</div>}
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{m.message}</p>
            </CardContent></Card>
          ))}
        </div>
      )}

      {tab === "protocols" && (
        <div className="space-y-3">
          <p className="rounded-xl bg-warning/10 p-3 text-xs">{t("a.protocolsNote")}</p>
          <Table>
            <THead><TR><TH>{t("trends.select")}</TH><TH>{t("a.users.status")}</TH><TH>Source</TH><TH>—</TH></TR></THead>
            <tbody>
              {((data.protocols as Array<{ id: string; titleAr: string; status: string; sourceOrg: string; active: boolean }>) ?? []).map((p) => (
                <TR key={p.id}>
                  <TD>{p.titleAr}</TD>
                  <TD><StatusBadge status={p.status} /></TD>
                  <TD className="text-xs">{p.sourceOrg}</TD>
                  <TD>{p.active && <Button size="sm" variant="ghost" onClick={() => post("archive", { id: p.id })}>{t("a.protocols.archive")}</Button>}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      {tab === "alerts" && (
        <div className="space-y-3">
          <StatCard label={t("a.stats.openAlerts")} value={fmtNumber((data as { openCount?: number }).openCount ?? 0, lang)} tone="urgent" />
          <p className="rounded-xl bg-lightblue p-3 text-xs text-muted">{t("a.alerts.noData")}</p>
        </div>
      )}

      {tab === "network" && (
        <Table>
          <THead><TR><TH>Lab</TH><TH>{t("a.network.uploads")}</TH><TH>{t("a.network.openedPct")}</TH><TH>{t("a.network.correctionPct")}</TH><TH>{t("a.network.critical")}</TH><TH>{t("a.network.pending")}</TH></TR></THead>
          <tbody>
            {((data.labs as Array<{ id: string; name: string; markazName: string | null; isActive: boolean; uploads: number; openedPct: number; correctionPct: number; critical: number; pending: number }>) ?? []).map((l) => (
              <TR key={l.id}>
                <TD>{l.name} <span className="text-xs text-muted">{l.markazName}</span> {!l.isActive && <Badge tone="neutral">off</Badge>}</TD>
                <TD>{l.uploads}</TD><TD>{l.openedPct}%</TD><TD>{l.correctionPct}%</TD><TD>{l.critical}</TD><TD>{l.pending}</TD>
              </TR>
            ))}
          </tbody>
        </Table>
      )}
    </AdminShell>
  );
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { t } = useLang();
  return <DashboardShell home="/admin" title={t("shell.admin")} nav={ADMIN_NAV(t)}>{children}</DashboardShell>;
}

function LabsTab({ data, post, load }: { data: Record<string, unknown>; post: (op: string, body: Record<string, unknown>, refresh?: boolean) => Promise<boolean>; load: () => void }) {
  const { t } = useLang();
  const [nf, setNf] = useState({ name: "", markazId: "", licenseNumber: "", contactName: "", contactPhone: "", address: "" });
  const [sf, setSf] = useState({ email: "", fullName: "", password: "" });
  const [staffFor, setStaffFor] = useState<string | null>(null);
  const markazList = (data.markazList as Array<{ id: string; name: string }>) ?? [];

  return (
    <div className="space-y-4">
      <Card><CardContent className="grid gap-3 p-4 sm:grid-cols-3">
        <Input placeholder={t("a.labs.name")} value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} />
        <Select value={nf.markazId} onValueChange={(v) => setNf({ ...nf, markazId: v })} placeholder={t("a.labs.markaz")} options={markazList.map((m) => ({ value: m.id, label: m.name }))} />
        <Input placeholder={t("a.labs.license")} value={nf.licenseNumber} onChange={(e) => setNf({ ...nf, licenseNumber: e.target.value })} />
        <Input placeholder={t("a.labs.contact")} value={nf.contactName} onChange={(e) => setNf({ ...nf, contactName: e.target.value })} />
        <Input dir="ltr" placeholder={t("a.labs.phone")} value={nf.contactPhone} onChange={(e) => setNf({ ...nf, contactPhone: e.target.value })} />
        <Button disabled={nf.name.length < 3} onClick={async () => { if (await post("create", nf)) { setNf({ name: "", markazId: "", licenseNumber: "", contactName: "", contactPhone: "", address: "" }); load(); } }}>{t("a.labs.add")}</Button>
      </CardContent></Card>

      {((data.labs as Array<{ id: string; name: string; markazName: string | null; isVerified: boolean; isActive: boolean; stats?: { uploads: number; pending: number; corrections: number }; staff: Array<{ id: string; email: string; fullName: string; role: string }> }>) ?? []).map((l) => (
        <Card key={l.id}><CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-bold text-navy">{l.name}</span> <span className="text-xs text-muted">{l.markazName}</span>
              <div className="text-xs text-muted">{l.stats?.uploads ?? 0} ⬆ · {l.stats?.pending ?? 0} ⏳ · {l.stats?.corrections ?? 0} ↺</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={l.isVerified ? "success" : "outline"} onClick={() => post("toggle-verify", { id: l.id })}>{t("a.labs.verify")}</Button>
              <Button size="sm" variant={l.isActive ? "success" : "outline"} onClick={() => post("toggle-active", { id: l.id })}>{t("a.labs.activate")}</Button>
              <Button size="sm" variant="ghost" onClick={() => setStaffFor(staffFor === l.id ? null : l.id)}>{t("a.labs.addStaff")}</Button>
              <Button size="sm" variant="ghost" onClick={() => { void post("add-supervisor", { ...sf, id: l.id }); }}>{t("a.labs.addSupervisor")}</Button>
            </div>
          </div>
          {staffFor === l.id && (
            <div className="mt-3 grid gap-2 border-t border-line pt-3 sm:grid-cols-4">
              <Input placeholder={t("auth.fullName")} value={sf.fullName} onChange={(e) => setSf({ ...sf, fullName: e.target.value })} />
              <Input dir="ltr" placeholder={t("auth.email")} value={sf.email} onChange={(e) => setSf({ ...sf, email: e.target.value })} />
              <Input dir="ltr" type="password" placeholder={t("auth.password")} value={sf.password} onChange={(e) => setSf({ ...sf, password: e.target.value })} />
              <Button onClick={async () => { if (await post("add-staff", { ...sf, id: l.id })) setSf({ email: "", fullName: "", password: "" }); }}>{t("a.labs.addStaff")}</Button>
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {(l.staff ?? []).map((s) => <span key={s.id} className="rounded-full bg-lightblue px-2.5 py-1">{s.fullName} · {s.role}</span>)}
          </div>
        </CardContent></Card>
      ))}
    </div>
  );
}

function RenameMarkaz({ id, name, post }: { id: string; name: string; post: (op: string, body: Record<string, unknown>) => Promise<boolean> }) {
  const { t } = useLang();
  const [v, setV] = useState(name);
  return (
    <span className="flex gap-2">
      <Input className="w-48" value={v} onChange={(e) => setV(e.target.value)} />
      <Button size="sm" variant="outline" onClick={() => post("rename", { id, name: v })}>{t("a.markaz.rename")}</Button>
    </span>
  );
}

function PaymentsTab({ data, post }: { data: Record<string, unknown>; post: (op: string, body: Record<string, unknown>) => Promise<boolean> }) {
  const { t, lang } = useLang();
  const [pf, setPf] = useState({ email: "", amount: "", planKey: "PLUS", note: "" });
  return (
    <div className="space-y-4">
      <Card><CardContent className="grid gap-2 p-4 sm:grid-cols-5">
        <Input dir="ltr" placeholder={t("a.payments.userEmail")} value={pf.email} onChange={(e) => setPf({ ...pf, email: e.target.value })} />
        <Input dir="ltr" type="number" placeholder={t("a.payments.amount")} value={pf.amount} onChange={(e) => setPf({ ...pf, amount: e.target.value })} />
        <Select value={pf.planKey} onValueChange={(v) => setPf({ ...pf, planKey: v })} options={["PLUS", "FAMILY"].map((k) => ({ value: k, label: k }))} />
        <Input placeholder={t("a.payments.note")} value={pf.note} onChange={(e) => setPf({ ...pf, note: e.target.value })} />
        <Button disabled={!pf.email || !pf.amount} onClick={() => post("add-manual", { ...pf, amount: Number(pf.amount) })}>{t("a.payments.record")}</Button>
      </CardContent></Card>
      <p className="text-xs text-muted">{t("a.payments.manualNote")}</p>
      <Table>
        <THead><TR><TH>{t("auth.fullName")}</TH><TH>{t("a.payments.amount")}</TH><TH>{t("a.payments.plan")}</TH><TH>{t("a.audit.time")}</TH></TR></THead>
        <tbody>
          {((data.payments as Array<{ id: string; userName: string; userEmail: string; amount: number; planKey: string | null; createdAt: string }>) ?? []).map((p) => (
            <TR key={p.id}><TD>{p.userName} <span dir="ltr" className="text-xs text-muted">{p.userEmail}</span></TD><TD dir="ltr">{fmtNumber(p.amount, lang)}</TD><TD>{p.planKey ?? "—"}</TD><TD className="text-xs">{fmtDate(p.createdAt, lang)}</TD></TR>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function CreateUserForm({ post }: { post: (op: string, body: Record<string, unknown>) => Promise<boolean> }) {
  const { t } = useLang();
  const empty = { role: "DOCTOR", fullName: "", email: "", password: "", specialty: "", licenseNumber: "" };
  const [f, setF] = useState(empty);
  const isDoctor = f.role === "DOCTOR";
  const ready = f.fullName.trim().length >= 3 && f.email && f.password && (!isDoctor || (f.specialty && f.licenseNumber));
  return (
    <Card><CardContent className="space-y-3 p-4">
      <div className="font-bold text-navy">{t("a.users.createTitle")}</div>
      <div className="grid gap-2 sm:grid-cols-3">
        <div><Label>{t("a.users.createRole")}</Label>
          <Select value={f.role} onValueChange={(v) => setF({ ...f, role: v })} options={["DOCTOR", "MEDICAL_OFFICER"].map((r) => ({ value: r, label: t(`a.users.role${r}`) }))} />
        </div>
        <div><Label>{t("auth.fullName")}</Label><Input value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></div>
        <div><Label>{t("auth.email")}</Label><Input dir="ltr" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        {isDoctor && <div><Label>{t("a.users.specialty")}</Label><Input value={f.specialty} onChange={(e) => setF({ ...f, specialty: e.target.value })} /></div>}
        {isDoctor && <div><Label>{t("a.users.license")}</Label><Input dir="ltr" value={f.licenseNumber} onChange={(e) => setF({ ...f, licenseNumber: e.target.value })} /></div>}
        <div><Label>{t("a.users.newPassword")}</Label><Input dir="ltr" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={!ready} onClick={async () => { if (await post("create-user", f)) setF(empty); }}>{t("a.users.createBtn")}</Button>
        <span className="text-xs text-muted">{t("a.users.createNote")}</span>
      </div>
    </CardContent></Card>
  );
}

function PaymentRequestsTab({ data, post }: { data: Record<string, unknown>; post: (op: string, body: Record<string, unknown>) => Promise<boolean> }) {
  const { t, lang } = useLang();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const rows = (data.requests as Array<{ id: string; planKey: string; amountEgp: number; method: string; senderRef: string | null; proofMime: string; status: string; reviewNote: string | null; createdAt: string; userName: string; userEmail: string; userPhone: string | null }>) ?? [];
  const tone = (s: string) => (s === "APPROVED" ? "success" : s === "REJECTED" ? "urgent" : "warning") as "success" | "urgent" | "warning";
  if (!rows.length) return <p className="rounded-xl bg-lightblue p-4 text-sm text-muted">{t("a.payreq.empty")}</p>;
  return (
    <div className="space-y-3">
      <p className="rounded-xl bg-lightblue p-3 text-xs text-muted">{t("a.payreq.note")}</p>
      {rows.map((r) => (
        <Card key={r.id}><CardContent className="grid gap-3 p-4 md:grid-cols-[1fr_auto]">
          <div className="space-y-1 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold text-navy">{r.userName}</span>
              <span dir="ltr" className="text-xs text-muted">{r.userEmail}{r.userPhone ? ` · ${r.userPhone}` : ""}</span>
              <Badge tone={tone(r.status)}>{t(`sub.status.${r.status}`)}</Badge>
            </div>
            <div>{r.planKey} — <b>{fmtNumber(r.amountEgp, lang)}</b> {t("packages.currency")} · {t(`sub.method.${r.method}`)}</div>
            {r.senderRef && <div className="text-xs text-muted">{t("sub.ref")}: <span dir="auto">{r.senderRef}</span></div>}
            <div className="text-xs text-muted">{fmtDate(r.createdAt, lang)}</div>
            {r.reviewNote && <div className="text-xs text-muted">{r.reviewNote}</div>}
            {r.status === "PENDING" && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Input className="w-56" placeholder={t("a.payreq.reason")} value={notes[r.id] ?? ""} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                <Button size="sm" variant="success" onClick={() => post("review", { id: r.id, decision: "APPROVE", note: notes[r.id] ?? "" })}>{t("a.payreq.approve")}</Button>
                <Button size="sm" variant="outline" onClick={() => post("review", { id: r.id, decision: "REJECT", note: notes[r.id] ?? "" })}>{t("a.payreq.reject")}</Button>
              </div>
            )}
          </div>
          <a href={`/api/payments/requests/${r.id}/proof`} target="_blank" rel="noopener noreferrer" className="block w-40">
            {r.proofMime.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/payments/requests/${r.id}/proof`} alt={t("a.payreq.proof")} className="max-h-40 w-40 rounded-xl border border-line object-contain" />
            ) : (
              <span className="flex h-24 items-center justify-center rounded-xl border border-line bg-lightblue text-xs font-bold text-medblue-dark">PDF — {t("a.payreq.open")}</span>
            )}
          </a>
        </CardContent></Card>
      ))}
    </div>
  );
}

function BroadcastTab({ post }: { post: (op: string, body: Record<string, unknown>) => Promise<boolean> }) {
  const { t, lang } = useLang();
  const [bf, setBf] = useState({ titleAr: "", bodyAr: "", titleEn: "", bodyEn: "", severity: "INFO" });
  const [sent, setSent] = useState<number | null>(null);
  return (
    <div className="space-y-3">
      <p className="rounded-xl bg-warning/10 p-3 text-xs">{t("a.broadcast.noValues")}</p>
      <Card><CardContent className="grid gap-2 p-4">
        <Input placeholder={lang === "ar" ? "العنوان (عربي)" : "Title"} value={bf.titleAr} onChange={(e) => setBf({ ...bf, titleAr: e.target.value })} />
        <Input dir="ltr" placeholder="Title (EN)" value={bf.titleEn} onChange={(e) => setBf({ ...bf, titleEn: e.target.value })} />
        <Textarea placeholder={lang === "ar" ? "النص" : "Body"} value={bf.bodyAr} onChange={(e) => setBf({ ...bf, bodyAr: e.target.value })} />
        <Textarea dir="ltr" placeholder="Body (EN)" value={bf.bodyEn} onChange={(e) => setBf({ ...bf, bodyEn: e.target.value })} />
        <Select value={bf.severity} onValueChange={(v) => setBf({ ...bf, severity: v })} options={["INFO", "WARNING", "URGENT"].map((s) => ({ value: s, label: s }))} />
        <Button disabled={bf.titleAr.length < 3 || bf.bodyAr.length < 3} onClick={async () => { const ok = await post("send", bf); if (ok) setSent(-1); }}>{t("a.broadcast.send")}</Button>
        {sent !== null && <p className="text-sm text-success">{t("a.broadcast.sent", { n: "" })}</p>}
      </CardContent></Card>
    </div>
  );
}
