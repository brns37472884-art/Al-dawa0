"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLang } from "@/lib/i18n";
import { PatientShell } from "./patient-home";
import { api, fmtDate, fmtNumber, ApiError } from "@/lib/api";
import { Card, CardContent, Badge, Button, Input, Label, Switch, Textarea, Progress } from "@/components/ui/core";
import { Select, Dialog, DialogContent } from "@/components/ui/overlays";
import { EmptyState, LoadingBlock, StatusBadge, FlagBadge, DemoBadge } from "@/components/shared/common";
import { HelpCircle, ChevronDown, Trash2, Activity, FileDown } from "lucide-react";

// ============================================================
// الملف الصحي — معالج 6 خطوات بحفظ جزئي و«ليه بنسألك؟»
// ============================================================
interface ProfileData {
  profile: Record<string, string | number | boolean | null> | null;
  consents: Array<{ type: string; granted: boolean }>;
  completeness: number;
  user: { phone: string | null; email: string; fullName: string };
}

const STEP_KEYS: string[][] = [
  ["fullName", "phone", "dateOfBirth", "gender", "gov", "city", "emergencyContact"],
  ["heightCm", "weightKg", "bpSystolic", "bpDiastolic"],
  ["chronicConditions", "medications", "allergies", "surgeries"],
  ["familyHistory", "geneticRiskFactors", "personalCancerHistory"],
  ["smokingStatus", "quitYearsAgo", "activityLevel", "reproductiveInfo"],
  ["consents"],
];

export function ProfileWizardPage() {
  const { t } = useLang();
  const [data, setData] = useState<ProfileData | null>(null);
  const [catalog, setCatalog] = useState<{ chronic: Array<{ key: string; ar: string }>; family: Array<{ key: string; ar: string }>; relations: Array<{ key: string; ar: string }> } | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [listAdd, setListAdd] = useState({ medications: "", allergies: "" });

  const load = useCallback(() => {
    api<ProfileData>("/api/profile").then((d) => {
      setData(d);
      const p = (d.profile ?? {}) as Record<string, unknown>;
      setForm({
        ...p,
        fullName: d.user.fullName,
        phone: d.user.phone ?? "",
        dateOfBirth: p.dateOfBirth ? String(p.dateOfBirth).slice(0, 10) : "",
        consentsMap: Object.fromEntries(d.consents.map((c) => [c.type, c.granted])),
      });
    }).catch(() => {});
    api<{ chronic: Array<{ key: string; ar: string }>; family: Array<{ key: string; ar: string }>; relations: Array<{ key: string; ar: string }> }>("/api/profile", { body: { op: "catalog" } }).then(setCatalog).catch(() => {});
  }, []);
  useEffect(() => { void load(); }, [load]);

  // أول خطوة ناقصة
  useEffect(() => {
    if (!data?.profile) return;
    const p = data.profile as Record<string, unknown>;
    for (let i = 0; i < 5; i++) {
      const incomplete = STEP_KEYS[i].some((k) => p[k] === null || p[k] === undefined || p[k] === "" || p[k] === "[]");
      if (incomplete) {
        setStep(i);
        break;
      }
    }
  }, [data]);

  const save = async (stepIdx: number, advance = true) => {
    setBusy(true);
    setMsg("");
    try {
      const payload: Record<string, unknown> = {};
      for (const k of STEP_KEYS[stepIdx]) {
        if (k === "fullName" || k === "phone") payload[k] = form[k];
        else if (k === "consents") continue;
        else payload[k] = form[k];
      }
      if (stepIdx === 5) {
        const m = form.consentsMap as Record<string, boolean> | undefined;
        if (m) payload.consents = { data: m.DATA_PROCESSING, ai: m.AI_ANALYSIS, doctor: m.DOCTOR_SHARE, notifications: m.NOTIFICATIONS, research: m.RESEARCH, labShare: m.LAB_RESULT_SHARING };
      }
      await api("/api/profile", { method: "PUT", body: payload });
      if (advance) setStep((s) => Math.min(5, s + 1));
      setMsg(t("common.saved"));
      load();
    } catch (e) {
      setMsg(e instanceof ApiError && ERROR_SIMPLE.includes(e.code) ? t(`auth.err.${e.code}`) : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const p = (form ?? {}) as Record<string, unknown>;
  const arr = (k: string): string[] => (Array.isArray(p[k]) ? (p[k] as string[]) : []);
  const setArr = (k: string, v: unknown[]) => setForm((f) => ({ ...f, [k]: v }));
  const consentsMap = (p.consentsMap ?? {}) as Record<string, boolean>;
  const setConsent = (k: string, v: boolean) => setForm((f) => ({ ...f, consentsMap: { ...(f.consentsMap as Record<string, boolean>), [k]: v } }));

  const chronicList: Array<{ key: string }> = Array.isArray(p.chronicConditions) ? (p.chronicConditions as Array<{ key: string }>) : [];
  const famList: Array<{ condition: string; relation: string }> = Array.isArray(p.familyHistory) ? (p.familyHistory as Array<{ condition: string; relation: string }>) : [];
  const repro = (p.reproductiveInfo ?? {}) as Record<string, unknown>;

  const steps = [t("wizard.s1"), t("wizard.s2"), t("wizard.s3"), t("wizard.s4"), t("wizard.s5"), t("wizard.s6")];

  if (!data) return <PatientShell active="/app/profile"><LoadingBlock /></PatientShell>;

  return (
    <PatientShell active="/app/profile">
      <div className="mb-4">
        <h1 className="text-xl font-extrabold text-navy">{t("wizard.title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("wizard.sub")}</p>
        <div className="mt-3"><Progress value={data.completeness} /><span className="text-xs text-muted">{t("p.summary.completion")}: {data.completeness}%</span></div>
      </div>

      <div className="mb-4 flex flex-wrap gap-1">
        {steps.map((s, i) => (
          <button key={s} onClick={() => setStep(i)} className={`rounded-full px-3 py-1.5 text-xs font-bold ${i === step ? "bg-medblue text-white" : "bg-lightblue text-muted"}`}>
            {i + 1}. {s}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="p-5">
          <div className="mb-4 flex items-start gap-2 rounded-xl bg-lightblue p-3 text-sm text-ink">
            <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-medblue" />
            <span>{t(`wizard.why${step + 1}`)}</span>
          </div>
          <p className="mb-4 text-xs text-muted">{t("wizard.step", { i: step + 1, n: 6, title: steps[step] })}</p>

          {step === 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Label>{t("auth.fullName")}</Label><Input value={String(p.fullName ?? "")} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} /></div>
              <div><Label>{t("auth.phone")}</Label><Input dir="ltr" value={String(p.phone ?? "")} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></div>
              <div><Label>{t("auth.dob")}</Label><Input type="date" value={String(p.dateOfBirth ?? "")} onChange={(e) => setForm((f) => ({ ...f, dateOfBirth: e.target.value }))} /></div>
              <div><Label>{t("auth.gender")}</Label>
                <Select value={String(p.gender ?? "")} onValueChange={(v) => setForm((f) => ({ ...f, gender: v }))} placeholder="—" options={[{ value: "MALE", label: t("auth.genderMale") }, { value: "FEMALE", label: t("auth.genderFemale") }]} />
              </div>
              <div><Label>{t("auth.gov")}</Label><Input value={String(p.gov ?? "")} onChange={(e) => setForm((f) => ({ ...f, gov: e.target.value }))} /></div>
              <div><Label>{t("auth.city")}</Label><Input value={String(p.city ?? "")} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} /></div>
              <div><Label>{t("auth.emergency")}</Label><Input dir="ltr" value={String(p.emergencyContact ?? "")} onChange={(e) => setForm((f) => ({ ...f, emergencyContact: e.target.value }))} /></div>
            </div>
          )}

          {step === 1 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Label>{t("wizard.height")}</Label><Input type="number" value={String(p.heightCm ?? "")} onChange={(e) => setForm((f) => ({ ...f, heightCm: e.target.value }))} /></div>
              <div><Label>{t("wizard.weight")}</Label><Input type="number" value={String(p.weightKg ?? "")} onChange={(e) => setForm((f) => ({ ...f, weightKg: e.target.value }))} /></div>
              {(() => {
                const h = Number(p.heightCm) || 0, w = Number(p.weightKg) || 0;
                const bmi = h > 0 && w > 0 ? (w / ((h / 100) ** 2)) : null;
                return <div><Label>{t("wizard.bmi")}</Label><Input readOnly value={bmi ? bmi.toFixed(1) : "—"} className="bg-lightblue" /></div>;
              })()}
              <div><Label>{t("wizard.bpSys")}</Label><Input type="number" value={String(p.bpSystolic ?? "")} onChange={(e) => setForm((f) => ({ ...f, bpSystolic: e.target.value }))} /></div>
              <div><Label>{t("wizard.bpDia")}</Label><Input type="number" value={String(p.bpDiastolic ?? "")} onChange={(e) => setForm((f) => ({ ...f, bpDiastolic: e.target.value }))} /></div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <Label>{t("wizard.chronic")}</Label>
                <p className="mb-2 text-xs text-muted">{t("wizard.chronicHint")}</p>
                <div className="flex flex-wrap gap-2">
                  {(catalog?.chronic ?? []).map((c) => {
                    const active = chronicList.some((x) => x.key === c.key);
                    return (
                      <button key={c.key} onClick={() => setArr("chronicConditions", active ? chronicList.filter((x) => x.key !== c.key) : [...chronicList, { key: c.key }])}
                        className={`rounded-full border px-3 py-1.5 text-xs font-bold ${active ? "border-medblue bg-lightblue text-medblue-dark" : "border-line text-muted"}`}>
                        {c.ar}
                      </button>
                    );
                  })}
                </div>
              </div>
              {(["medications", "allergies"] as const).map((k) => (
                <div key={k}>
                  <Label>{k === "medications" ? t("wizard.meds") : t("wizard.allergies")}</Label>
                  <div className="mt-1 flex gap-2">
                    <Input value={listAdd[k as "medications" | "allergies"]} onChange={(e) => setListAdd((x) => ({ ...x, [k]: e.target.value }))} placeholder={t("wizard.medsHint")} />
                    <Button variant="soft" onClick={() => { const v = listAdd[k].trim(); if (v) { setArr(k, [...arr(k), v]); setListAdd((x) => ({ ...x, [k]: "" })); } }}>{t("wizard.add")}</Button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {arr(k).map((m, i) => (
                      <span key={`${m}-${i}`} className="inline-flex items-center gap-1 rounded-full bg-lightblue px-2.5 py-1 text-xs">{m}
                        <button onClick={() => setArr(k, arr(k).filter((_, j) => j !== i))}><Trash2 className="h-3 w-3 text-muted" /></button>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <label className="flex items-center justify-between rounded-xl border border-line p-3 text-sm font-semibold">
                <span>{t("wizard.personalCancer")}</span>
                <Switch checked={p.personalCancerHistory === true} onCheckedChange={(v) => setForm((f) => ({ ...f, personalCancerHistory: v }))} />
              </label>
              <div>
                <Label>{t("wizard.familyHistory")}</Label>
                <div className="mt-2 space-y-2">
                  {famList.map((fam, i) => (
                    <div key={i} className="flex gap-2">
                      <Select value={fam.condition} onValueChange={(v) => { const n = [...famList]; n[i] = { ...fam, condition: v }; setArr("familyHistory", n); }}
                        options={(catalog?.family ?? []).map((c) => ({ value: c.key, label: c.ar }))} className="flex-1" />
                      <Select value={fam.relation} onValueChange={(v) => { const n = [...famList]; n[i] = { ...fam, relation: v }; setArr("familyHistory", n); }}
                        options={(catalog?.relations ?? []).map((c) => ({ value: c.key, label: c.ar }))} className="flex-1" />
                      <Button variant="ghost" onClick={() => setArr("familyHistory", famList.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ))}
                  <Button variant="soft" size="sm" onClick={() => setArr("familyHistory", [...famList, { condition: catalog?.family[0]?.key ?? "", relation: catalog?.relations[0]?.key ?? "" }])}>{t("wizard.add")}</Button>
                </div>
              </div>
              <div><Label>{t("wizard.genetic")}</Label>
                <Textarea value={String(p.geneticRiskFactors ?? "")} onChange={(e) => setForm((f) => ({ ...f, geneticRiskFactors: e.target.value }))} placeholder="مثال: طفرات BRCA (تاريخ عائلي)" />
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div><Label>{t("wizard.smoking")}</Label>
                <Select value={String(p.smokingStatus ?? "")} onValueChange={(v) => setForm((f) => ({ ...f, smokingStatus: v }))} placeholder="—"
                  options={[{ value: "NEVER", label: t("wizard.smoking.NEVER") }, { value: "FORMER", label: t("wizard.smoking.FORMER") }, { value: "CURRENT", label: t("wizard.smoking.CURRENT") }]} />
              </div>
              {p.smokingStatus === "FORMER" && <div><Label>{t("wizard.quitYears")}</Label><Input type="number" value={String(p.quitYearsAgo ?? "")} onChange={(e) => setForm((f) => ({ ...f, quitYearsAgo: e.target.value }))} /></div>}
              <div><Label>{t("wizard.activity")}</Label>
                <Select value={String(p.activityLevel ?? "")} onValueChange={(v) => setForm((f) => ({ ...f, activityLevel: v }))} placeholder="—"
                  options={[{ value: "SEDENTARY", label: t("wizard.activity.SEDENTARY") }, { value: "LIGHT", label: t("wizard.activity.LIGHT") }, { value: "MODERATE", label: t("wizard.activity.MODERATE") }, { value: "ACTIVE", label: t("wizard.activity.ACTIVE") }]} />
              </div>
              {p.gender === "FEMALE" && (
                <div className="rounded-xl border border-line p-3">
                  <div className="mb-2 text-sm font-bold text-navy">{t("wizard.womenOnly")}</div>
                  <label className="flex items-center justify-between py-1 text-sm">
                    <span>{t("wizard.pregnant")}</span>
                    <Switch checked={repro.pregnant === true} onCheckedChange={(v) => setForm((f) => ({ ...f, reproductiveInfo: JSON.stringify({ ...repro, pregnant: v }) }))} />
                  </label>
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <div><Label>{t("wizard.lastPap")}</Label><Input type="date" value={String(repro.lastPap ?? "")} onChange={(e) => setForm((f) => ({ ...f, reproductiveInfo: JSON.stringify({ ...repro, lastPap: e.target.value }) }))} /></div>
                    <div><Label>{t("wizard.lastMammogram")}</Label><Input type="date" value={String(repro.lastMammogram ?? "")} onChange={(e) => setForm((f) => ({ ...f, reproductiveInfo: JSON.stringify({ ...repro, lastMammogram: e.target.value }) }))} /></div>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 5 && (
            <div className="space-y-3">
              {[
                { type: "DATA_PROCESSING", label: t("consents.DATA_PROCESSING") },
                { type: "AI_ANALYSIS", label: t("consents.AI_ANALYSIS") },
                { type: "DOCTOR_SHARE", label: t("consents.DOCTOR_SHARE") },
                { type: "NOTIFICATIONS", label: t("consents.NOTIFICATIONS") },
                { type: "LAB_RESULT_SHARING", label: t("consents.LAB_RESULT_SHARING") },
                { type: "RESEARCH", label: t("consents.RESEARCH") },
              ].map((c) => (
                <label key={c.type} className="flex items-center justify-between gap-3 rounded-xl border border-line p-3 text-sm">
                  <span>{c.label}</span>
                  <Switch checked={consentsMap[c.type] === true} onCheckedChange={(v) => setConsent(c.type, v)} />
                </label>
              ))}
            </div>
          )}

          {msg && <p className="mt-3 rounded-lg bg-success/10 p-2 text-sm text-success">{msg}</p>}
          <div className="mt-5 flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>{t("common.back")}</Button>
            <Button className="flex-1" disabled={busy} onClick={() => save(step)}>{step === 5 ? t("wizard.finish") : t("wizard.saveNext")}</Button>
          </div>
        </CardContent>
      </Card>
    </PatientShell>
  );
}

const ERROR_SIMPLE = ["INVALID_NAME", "INVALID_PHONE", "PHONE_EXISTS", "INVALID_DOB", "INVALID_NUMBER", "INVALID_CONSENT_VALUE", "INVALID_GENDER"];

// ============================================================
// فحوصاتك الوقائية — المطلوب / اللي اتعمل / الجاي
// ============================================================
interface PlanRecord {
  id: string;
  status: string;
  lastDoneAt: string | null;
  nextDueAt: string | null;
  reasonAr: string;
  reasonEn: string;
  protocol: { key: string; titleAr: string; titleEn: string; summaryAr: string; sourceOrg: string; guidelineVersion: string; guidelineDate: string; approvedAt: string | null; doctorDiscussion: boolean; exclusionsAr: string | null; seeDoctorAr: string | null; intervalMonths: number | null };
}
interface PlanData {
  grouped: Record<string, PlanRecord[]>;
  doctorPlans: Array<{ id: string; titleAr: string; dueDate: string | null; note: string | null; doctorName: string }>;
  protocolsApproved: number;
  protocolsTotal: number;
}

export function PlanPage() {
  const { t, lang } = useLang();
  const [data, setData] = useState<PlanData | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [doneDate, setDoneDate] = useState("");
  const load = useCallback(() => api<PlanData>("/api/screening").then(setData).catch(() => {}), []);
  useEffect(() => { void load(); }, [load]);

  const markDone = async (id: string) => {
    await api("/api/screening", { body: { op: "mark-done", id, date: doneDate || undefined } });
    setOpenId(null);
    setDoneDate("");
    load();
  };

  if (!data) return <PatientShell active="/app/screenings"><LoadingBlock /></PatientShell>;
  const { grouped } = data;
    const upcoming = grouped.UPCOMING;
  const completed = grouped.COMPLETED;
  const locked = data.protocolsApproved === 0;

  const Group = ({ title, items, tone }: { title: string; items: PlanRecord[]; tone: "urgent" | "warning" | "info" | "success" }) => (
    <section className="mb-6">
      <h2 className="mb-3 flex items-center gap-2 font-bold text-navy"><Badge tone={tone}>{title}</Badge><span className="text-sm text-muted">{items.length}</span></h2>
      {items.length === 0 ? <p className="text-sm text-muted">—</p> : (
        <div className="space-y-2">
          {items.map((r) => (
            <Card key={r.id} className={openId === r.id ? "border-medblue" : ""}>
              <CardContent className="p-4">
                <button className="flex w-full flex-wrap items-center justify-between gap-2 text-start" onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                  <span className="font-bold text-navy">{lang === "ar" ? r.protocol.titleAr : r.protocol.titleEn}</span>
                  <span className="flex items-center gap-2 text-xs text-muted">
                    {r.nextDueAt && <span>{t("plan.nextDue")}: {fmtDate(r.nextDueAt, lang)}</span>}
                    <ChevronDown className={`h-4 w-4 transition-transform ${openId === r.id ? "rotate-180" : ""}`} />
                  </span>
                </button>
                {openId === r.id && (
                  <div className="mt-3 space-y-2 border-t border-line pt-3 text-sm">
                    <p className="text-muted">{t("plan.why")}: {lang === "ar" ? r.reasonAr : r.reasonEn}</p>
                    <div className="grid gap-1 text-xs text-muted sm:grid-cols-2">
                      <span>{t("plan.source")}: {r.protocol.sourceOrg} · {t("plan.guideline")}: {r.protocol.guidelineVersion} — {r.protocol.guidelineDate}</span>
                      {r.protocol.approvedAt && <span className="text-success">{t("plan.lastReviewed")}: {fmtDate(r.protocol.approvedAt, lang)}</span>}
                    </div>
                    {r.protocol.doctorDiscussion && <Badge tone="info">{t("plan.sharedDecision")}</Badge>}
                    {r.protocol.exclusionsAr && <p className="text-xs text-muted"><b>{t("plan.exclusions")}:</b> {lang === "ar" ? r.protocol.exclusionsAr : ""}</p>}
                    {r.protocol.seeDoctorAr && <p className="text-xs text-muted"><b>{t("plan.seeDoctor")}:</b> {lang === "ar" ? r.protocol.seeDoctorAr : ""}</p>}
                    {r.lastDoneAt && <p className="text-xs">{t("plan.lastDone")}: {fmtDate(r.lastDoneAt, lang)}</p>}
                    <div className="flex flex-wrap items-end gap-2 pt-2">
                      <div><Label>{t("plan.markDoneDate")}</Label><Input type="date" value={doneDate} onChange={(e) => setDoneDate(e.target.value)} /></div>
                      <Button size="sm" onClick={() => markDone(r.id)}>{t("plan.markDone")}</Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );

  return (
    <PatientShell active="/app/screenings">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-extrabold text-navy">{t("plan.title")}</h1>
          <p className="text-sm text-muted">{t("p.eligible.note")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={async () => { await api("/api/screening", { body: { op: "recompute" } }); load(); }}>{t("plan.recompute")}</Button>
      </div>

      {locked && <div className="mb-4 rounded-2xl border border-warning/50 bg-warning/10 p-4 text-sm">{t("plan.locked")}</div>}
      {!locked && (
        <>
          {data.doctorPlans.length > 0 && (
            <Card className="mb-6"><CardContent className="p-4">
              <h2 className="mb-2 font-bold text-navy">{t("plan.doctorPlans")}</h2>
              {data.doctorPlans.map((dp) => (
                <div key={dp.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2 text-sm last:border-0">
                  <span>{dp.titleAr} <span className="text-xs text-muted">— {dp.doctorName}</span></span>
                  <span className="text-xs text-muted">{fmtDate(dp.dueDate, lang)}</span>
                </div>
              ))}
            </CardContent></Card>
          )}
          <Group title={t("planStatus.OVERDUE")} items={grouped.OVERDUE} tone="urgent" />
          <Group title={t("planStatus.DUE")} items={grouped.DUE} tone="warning" />
          <Group title={t("planStatus.UPCOMING")} items={upcoming} tone="info" />
          <Group title={t("planStatus.COMPLETED")} items={completed} tone="success" />
        </>
      )}
    </PatientShell>
  );
}

// ============================================================
// السجلات
// ============================================================
interface ReportsList {
  reports: Array<{ id: string; fileName: string; reportType: string; status: string; uploadedAt: string; testDate: string | null; labName: string | null; source: string; memberName: string | null; demo: boolean; valuesCount: number; abnormalCount: number; review: { status: string } | null }>;
}

export function RecordsPage() {
  const { t, lang } = useLang();
  const [data, setData] = useState<ReportsList | null>(null);
  const [tab, setTab] = useState<"all" | "radiology" | "reviewed" | "history">("all");
  const [profile, setProfile] = useState<{ chronic: Array<{ key: string; name?: string }>; meds: string[]; allergies: string[] } | null>(null);
  const load = useCallback(() => api<ReportsList>("/api/reports").then(setData).catch(() => {}), []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    api<{ profile: Record<string, string> | null }>("/api/profile").then((d) => {
      const pj = (s: string, f: unknown) => { try { return JSON.parse(s); } catch { return f; } };
      if (d.profile) setProfile({
        chronic: pj(d.profile.chronicConditions ?? "[]", []),
        meds: pj(d.profile.medications ?? "[]", []),
        allergies: pj(d.profile.allergies ?? "[]", []),
      });
    }).catch(() => {});
  }, []);

  if (!data) return <PatientShell active="/app/records"><LoadingBlock /></PatientShell>;
  const filtered = data.reports.filter((r) =>
    tab === "radiology" ? r.reportType === "RADIOLOGY" : tab === "reviewed" ? r.review?.status === "COMPLETED" : tab === "all"
  );
  const tabs = [
    { key: "all" as const, label: `${t("records.tabAll")} (${data.reports.length})` },
    { key: "radiology" as const, label: `${t("records.tabRadiology")} (${data.reports.filter((r) => r.reportType === "RADIOLOGY").length})` },
    { key: "reviewed" as const, label: `${t("records.tabReviewed")} (${data.reports.filter((r) => r.review?.status === "COMPLETED").length})` },
    { key: "history" as const, label: t("records.tabHistory") },
  ];

  return (
    <PatientShell active="/app/records">
      <h1 className="mb-4 text-xl font-extrabold text-navy">{t("records.title")}</h1>
      <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-lightblue p-1">
        {tabs.map((tb) => (
          <button key={tb.key} onClick={() => setTab(tb.key)} className={`rounded-lg px-3 py-1.5 text-sm font-bold ${tab === tb.key ? "bg-white text-medblue-dark shadow-sm" : "text-muted"}`}>{tb.label}</button>
        ))}
      </div>

      {tab === "history" ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card><CardContent className="p-4"><h3 className="mb-2 font-bold text-navy">{t("records.historyChronic")}</h3>
            {(profile?.chronic ?? []).map((c, i) => <span key={i} className="me-1.5 mb-1 inline-block rounded-full bg-lightblue px-2.5 py-1 text-xs">{c.name ?? c.key}</span>) || "—"}</CardContent></Card>
          <Card><CardContent className="p-4"><h3 className="mb-2 font-bold text-navy">{t("records.historyMeds")}</h3>
            {(profile?.meds ?? []).map((m, i) => <span key={i} className="me-1.5 mb-1 inline-block rounded-full bg-lightblue px-2.5 py-1 text-xs">{m}</span>) || "—"}</CardContent></Card>
          <Card><CardContent className="p-4"><h3 className="mb-2 font-bold text-navy">{t("records.historyAllergy")}</h3>
            {(profile?.allergies ?? []).map((a, i) => <span key={i} className="me-1.5 mb-1 inline-block rounded-full bg-warning/15 px-2.5 py-1 text-xs">{a}</span>) || "—"}</CardContent></Card>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState text={t("records.empty")} />
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <Link key={r.id} href={`/app/records/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white p-3 text-sm hover:border-medblue">
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-semibold text-navy">{r.reportType === "RADIOLOGY" ? <Activity className="h-4 w-4 text-medblue" /> : <FileDown className="h-4 w-4 text-medblue" />}<span className="truncate">{r.fileName}</span>{r.demo && <DemoBadge />}</div>
                <div className="text-xs text-muted">{r.labName ?? "—"} · {fmtDate(r.testDate ?? r.uploadedAt, lang)} · {r.memberName ?? ""} · {r.valuesCount} {t("p.values")}{r.abnormalCount > 0 && <span className="text-warning"> · {r.abnormalCount} {t("p.abnormal")}</span>}</div>
              </div>
              <StatusBadge status={r.status} />
            </Link>
          ))}
        </div>
      )}
    </PatientShell>
  );
}

// ============================================================
// تفاصيل التقرير — قيم + شرح + مقارنة + إصدارات + تصحيح
// ============================================================
interface DetailData {
  report: { id: string; fileName: string; fileType: string; reportType: string; status: string; labName: string | null; labReportNo: string | null; testDate: string | null; notes: string | null; source: string; currentVersion: number; demo: boolean; extractionMeta: Record<string, unknown>; labVerified: boolean; uploadedAt: string };
  values: Array<{ id: string; rawName: string; value: number | null; valueText: string | null; unit: string | null; refLow: number | null; refHigh: number | null; flag: string; confidence: number; verification: string }>;
  review: { status: string; urgency: string; notes: string | null; recommendation: string | null; requestedInfo: string | null; needsReview: boolean; doctorName: string } | null;
  corrections: Array<{ id: string; field: string; details: string; status: string; resolution: string | null; oldValue: string | null; newValue: string | null; createdAt: string; labName: string }>;
  versions: Array<{ id: string; version: number; changeNote: string | null; createdAt: string; valuesCount: number }>;
  comparisons: Array<{ key: string; name: string; unit: string | null; prev: number; last: number | null; deltaPct: number; direction: string; meaningful: boolean }> | null;
  isOwner: boolean;
}

export function ReportDetailPage({ id }: { id: string }) {
  const { t, lang } = useLang();
  const [data, setData] = useState<DetailData | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [corrOpen, setCorrOpen] = useState(false);
  const [corrField, setCorrField] = useState("VALUE");
  const [corrDetails, setCorrDetails] = useState("");
  const [reply, setReply] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(() => api<DetailData>(`/api/reports/${id}`).then(setData).catch(() => {}), [id]);
  useEffect(() => { void load(); }, [load]);

  const confirmAll = async () => {
    setBusy(true);
    setMsg("");
    try {
      const values = Object.entries(edits)
        .filter(([, v]) => v !== "")
        .map(([vid, v]) => ({ id: vid, value: v === "" ? null : Number(v) }));
      await api(`/api/reports/${id}`, { method: "PATCH", body: { op: "confirm", values } });
      setMsg(t("common.saved"));
      load();
    } catch (e) {
      setMsg(e instanceof ApiError && e.code === "PLAN_LIMIT_REACHED" ? t("report.planLimit") : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const sendReply = async () => {
    setBusy(true);
    try {
      await api(`/api/reports/${id}`, { method: "PATCH", body: { op: "reply-info", message: reply } });
      setReply("");
      setMsg(t("common.success"));
      load();
    } catch { setMsg(t("common.error")); } finally { setBusy(false); }
  };

  const sendCorrection = async () => {
    setBusy(true);
    try {
      await api(`/api/reports/${id}`, { method: "PATCH", body: { op: "request-correction", field: corrField, details: corrDetails } });
      setCorrOpen(false);
      setCorrDetails("");
      setMsg(t("report.correctionSent"));
      load();
    } catch { setMsg(t("common.error")); } finally { setBusy(false); }
  };

  if (!data) return <PatientShell active="/app/records"><LoadingBlock /></PatientShell>;
  const r = data.report;
  const canConfirm = data.isOwner && ["EXTRACTED", "FAILED", "CONFIRMED"].includes(r.status) && r.source !== "LAB_DIRECT";
  const canAck = data.isOwner && r.source === "LAB_DIRECT" && !["CONFIRMED_LAB", "REVIEWED", "UNDER_REVIEW"].includes(r.status);
  const meta = r.extractionMeta ?? {};

  return (
    <PatientShell active="/app/records">
      <div className="space-y-4">
        <Card><CardContent className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h1 className="flex flex-wrap items-center gap-2 text-lg font-extrabold text-navy">{r.fileName}{r.demo && <DemoBadge />}</h1>
              <p className="mt-1 text-sm text-muted">
                {r.source === "LAB_DIRECT" ? t("report.labResult", { lab: r.labName ?? "—" }) : t("report.patientUpload")} · {fmtDate(r.testDate ?? r.uploadedAt, lang)}
                {r.labReportNo && <> · {t("report.labNo")}: {r.labReportNo}</>}
                {String(meta.engine ?? "") && <> · {t("report.engine")}: {String(meta.engine)}</>}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {r.labVerified && <Badge tone="success">{t("report.verifiedLabBadge")}</Badge>}
              <StatusBadge status={r.status} />
              {r.fileType !== "json" && <Button asChild size="sm" variant="outline"><a href={`/api/reports/${id}/file`} target="_blank" rel="noreferrer">{t("report.viewFile")}</a></Button>}
            </div>
          </div>
        </CardContent></Card>

        {/* تنبيه حرج */}
        {data.values.some((v) => v.flag.startsWith("CRITICAL")) && (
          <div className="rounded-2xl border-2 border-urgent bg-urgent/5 p-4 text-sm text-urgent">
            {t("report.criticalAlert")} <a href="tel:123" className="ms-2 inline-block rounded-xl bg-urgent px-4 py-1.5 font-extrabold text-white" dir="ltr">123</a>
          </div>
        )}

        {/* رأي الطبيب */}
        {data.review && (
          <Card>
            <CardContent className="p-5">
              {data.review.status === "COMPLETED" ? (
                <>
                  <h2 className="mb-2 font-bold text-success">{t("report.doctorOpinion")} — {data.review.doctorName}</h2>
                  {data.review.notes && <p className="whitespace-pre-wrap text-sm text-ink">{data.review.notes}</p>}
                  {data.review.recommendation && <p className="mt-2 rounded-xl bg-lightblue p-3 text-sm"><b>{t("report.doctorRecommendation")}:</b> {data.review.recommendation}</p>}
                </>
              ) : (
                <p className="text-sm text-muted">{t("report.pendingReview")}</p>
              )}
              {data.review.status === "NEEDS_INFO" && data.review.requestedInfo && (
                <div className="mt-3 rounded-xl border border-warning/50 bg-warning/10 p-3">
                  <p className="text-sm font-bold text-warning">{t("report.needsInfo")}</p>
                  <p className="mt-1 text-sm">{data.review.requestedInfo}</p>
                  <Textarea className="mt-2" value={reply} onChange={(e) => setReply(e.target.value)} placeholder="…" />
                  <Button size="sm" className="mt-2" disabled={busy || reply.length < 2} onClick={sendReply}>{t("report.replyInfo")}</Button>
                </div>
              )}
              {data.review.needsReview && <Badge tone="warning" className="mt-2">{t("report.needsReviewBadge")}</Badge>}
            </CardContent>
          </Card>
        )}

        {/* المقارنة بالسابق */}
        {data.comparisons && data.comparisons.length > 0 && (
          <Card><CardContent className="p-5">
            <h2 className="mb-3 font-bold text-navy">{t("report.comparisons")}</h2>
            <div className="space-y-2">
              {data.comparisons.map((c) => (
                <div key={c.key} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3 text-sm">
                  <span className="font-semibold">{c.name}</span>
                  <span dir="ltr" className="text-muted">{fmtNumber(c.prev, lang)} → <b>{fmtNumber(c.last, lang)}</b> {c.unit}</span>
                  <span className="flex items-center gap-2">
                    <Badge tone={c.direction === "UP" ? "warning" : c.direction === "DOWN" ? "info" : "neutral"}>{t(`direction.${c.direction}`)}</Badge>
                    {c.meaningful && <Badge tone="warning">{t("trends.meaningful")}</Badge>}
                  </span>
                </div>
              ))}
            </div>
          </CardContent></Card>
        )}

        {/* جدول القيم */}
        <Card><CardContent className="p-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold text-navy">{t("report.values")}</h2>
            {(canConfirm || canAck) && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted">{t("report.confirmNote")}</span>
                <Button size="sm" disabled={busy} onClick={confirmAll}>{canAck ? t("report.confirmAck") : t("report.confirmAll")}</Button>
              </div>
            )}
          </div>
          {r.labVerified && <p className="mb-3 rounded-xl bg-success/10 p-2 text-xs text-success">{t("report.verifiedLabHint")}</p>}
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[640px] text-sm" dir="ltr">
              <thead className="bg-lightblue/60 text-navy">
                <tr>
                  <th className="p-2.5 text-start font-bold">{t("trends.select")}</th>
                  <th className="p-2.5 text-start font-bold">{t("report.value")}</th>
                  <th className="p-2.5 text-start font-bold">{t("report.unit")}</th>
                  <th className="p-2.5 text-start font-bold">{t("report.refRange")}</th>
                  <th className="p-2.5 text-start font-bold">{t("report.flag")}</th>
                  <th className="p-2.5 text-start font-bold">{t("report.confidence")}</th>
                </tr>
              </thead>
              <tbody>
                {data.values.map((v) => {
                  const labVerified = v.verification === "VERIFIED_LAB" || v.verification === "CORRECTED_LAB";
                  const editable = canConfirm && !labVerified;
                  return (
                    <tr key={v.id} className="border-t border-line">
                      <td className="p-2.5 font-semibold" dir="rtl">{v.rawName}</td>
                      <td className="p-2.5">
                        {editable ? (
                          <Input className="h-8 w-24" dir="ltr" value={edits[v.id] ?? (v.value !== null ? String(v.value) : v.valueText ?? "")} onChange={(e) => setEdits((x) => ({ ...x, [v.id]: e.target.value }))} />
                        ) : (
                          <b>{v.value !== null ? fmtNumber(v.value, lang) : v.valueText ?? "—"}</b>
                        )}
                      </td>
                      <td className="p-2.5 text-muted">{v.unit ?? "—"}</td>
                      <td className="p-2.5 text-muted" dir="ltr">{v.refLow ?? "—"} – {v.refHigh ?? "—"}</td>
                      <td className="p-2.5"><FlagBadge flag={v.flag} /></td>
                      <td className="p-2.5 text-xs">
                        <span className={v.confidence >= 0.8 ? "text-success" : v.confidence >= 0.6 ? "text-warning" : "text-urgent"}>{Math.round(v.confidence * 100)}%</span>
                        {labVerified && <Badge tone="success" className="ms-1">{t("verification.VERIFIED_LAB")}</Badge>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {msg && <p className="mt-2 text-sm text-success">{msg}</p>}
        </CardContent></Card>

        {/* الإصدارات — الأصل محفوظ */}
        {data.versions.length > 0 && (
          <Card><CardContent className="p-5">
            <h2 className="mb-1 font-bold text-navy">{t("report.versions")}</h2>
            <p className="mb-3 text-xs text-muted">{t("report.versionOriginal")}</p>
            {data.versions.map((v) => (
              <div key={v.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2 text-sm last:border-0">
                <span className="font-semibold">{t("report.versionN", { n: v.version })}</span>
                <span className="text-xs text-muted">{v.changeNote ?? "—"} · {fmtDate(v.createdAt, lang)}</span>
              </div>
            ))}
          </CardContent></Card>
        )}

        {/* طلب تصحيح */}
        {data.isOwner && r.source === "LAB_DIRECT" && (
          <Card><CardContent className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-bold text-navy">{t("report.corrections")}</h2>
              <Button size="sm" variant="outline" onClick={() => setCorrOpen(true)}>{t("report.requestCorrection")}</Button>
            </div>
            {data.corrections.map((c) => (
              <div key={c.id} className="mt-3 rounded-xl border border-line p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{t(`report.correctionField.${c.field}`)}</span>
                  <Badge tone={c.status === "OPEN" ? "warning" : c.status === "RESOLVED" ? "success" : "neutral"}>{t(`report.correctionStatus.${c.status}`)}</Badge>
                </div>
                <p className="mt-1 text-muted">{c.details}</p>
                {c.newValue && <p className="text-xs">{c.oldValue ?? "—"} → <b>{c.newValue}</b> · {c.labName}</p>}
                {c.resolution && <p className="text-xs text-muted">{c.resolution}</p>}
              </div>
            ))}
          </CardContent></Card>
        )}

        <Dialog open={corrOpen} onOpenChange={setCorrOpen}>
          <DialogContent title={t("report.requestCorrection")}>
            <div className="space-y-3">
              <div><Label>{t("report.correctionField")}</Label>
                <Select value={corrField} onValueChange={setCorrField} options={["VALUE", "REFERENCE", "DATE", "OTHER"].map((f) => ({ value: f, label: t(`report.correctionField.${f}`) }))} />
              </div>
              <div><Label>{t("report.correctionDetails")}</Label><Textarea value={corrDetails} onChange={(e) => setCorrDetails(e.target.value)} /></div>
              <Button className="w-full" disabled={busy || corrDetails.length < 5} onClick={sendCorrection}>{t("report.correctionSubmit")}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </PatientShell>
  );
}
