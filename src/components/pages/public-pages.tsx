"use client";
import { useState } from "react";
import { useLang } from "@/lib/i18n";
import { Navbar, Footer } from "@/components/layout/public-chrome";
import { Button, Card, CardContent, Input, Label, Textarea } from "@/components/ui/core";
import { api } from "@/lib/api";
import { AlertCircle, CheckCircle2, Mail, Clock, MapPin, Send, Building2, FileCheck2, RefreshCcw, Sparkles } from "lucide-react";

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="mx-auto max-w-5xl px-4 py-10">{children}</main>
      <Footer />
    </div>
  );
}

function Head({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-8 text-center">
      <h1 className="text-3xl font-extrabold text-navy">{title}</h1>
      {sub && <p className="mx-auto mt-2 max-w-3xl text-muted">{sub}</p>}
    </div>
  );
}

export function AboutPage() {
  const { t } = useLang();
  return (
    <Page>
      <Head title={t("about.title")} />
      <Card className="mb-6">
        <CardContent className="p-6 text-ink/90">
          <p className="mb-3">{t("about.p1")}</p>
          <p>{t("about.p2")}</p>
        </CardContent>
      </Card>
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <Card><CardContent className="p-6"><h3 className="font-bold text-medblue">{t("about.mission.t")}</h3><p className="mt-1 text-sm text-muted">{t("about.mission.b")}</p></CardContent></Card>
        <Card><CardContent className="p-6"><h3 className="font-bold text-medblue">{t("about.vision.t")}</h3><p className="mt-1 text-sm text-muted">{t("about.vision.b")}</p></CardContent></Card>
      </div>
      <Card><CardContent className="p-6">
        <h3 className="mb-3 font-bold text-navy">{t("about.values.t")}</h3>
        <ul className="space-y-2 text-sm">
          {[1, 2, 3, 4].map((i) => (
            <li key={i} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 text-success" />{t(`about.values.${i}`)}</li>
          ))}
        </ul>
      </CardContent></Card>
    </Page>
  );
}

export function HowItWorksPage() {
  const { t } = useLang();
  const steps = [1, 2, 3, 4, 5].map((i) => ({ t: t(`home.step${i}t`), b: t(`home.step${i}b`) }));
  return (
    <Page>
      <Head title={t("howPage.title")} sub={t("howPage.sub")} />
      <div className="space-y-4">
        {steps.map((s, i) => (
          <Card key={i} className="card-hover">
            <CardContent className="flex items-start gap-4 p-5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-medblue text-lg font-extrabold text-white">{i + 1}</span>
              <div>
                <h3 className="font-bold text-navy">{s.t}</h3>
                <p className="mt-1 text-sm text-muted">{s.b}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="mt-8 text-center">
        <Button asChild size="lg"><a href="/register">{t("home.cta.button")}</a></Button>
      </div>
    </Page>
  );
}

export function ScreeningsPage() {
  const { t } = useLang();
  const ages = ["age18", "age30", "age40", "age50", "age65"];
  const tracks = [1, 2, 3, 4, 5, 6];
  return (
    <Page>
      <Head title={t("screeningsPage.title")} />
      <div className="mb-6 rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm text-ink">
        <span className="inline-flex items-start gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />{t("screeningsPage.note")}</span>
      </div>
      <h2 className="mb-4 text-xl font-bold text-navy">{t("screeningsPage.ageTitle")}</h2>
      <div className="mb-8 grid gap-3 sm:grid-cols-2">
        {ages.map((a) => (
          <Card key={a}><CardContent className="p-4 text-sm text-ink/90">{t(`screeningsPage.${a}`)}</CardContent></Card>
        ))}
      </div>
      <h2 className="mb-4 text-xl font-bold text-navy">{t("screeningsPage.tracksTitle")}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tracks.map((i) => (
          <Card key={i} className="card-hover">
            <CardContent className="p-5">
              {i === 4 && <a href="/early-detection" className="text-lg font-bold text-medblue hover:underline">{t(`screeningsPage.track${i}t`)}</a>}
              {i !== 4 && <h3 className="text-lg font-bold text-navy">{t(`screeningsPage.track${i}t`)}</h3>}
              <p className="mt-1 text-sm text-muted">{t(`screeningsPage.track${i}b`)}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </Page>
  );
}

export function EarlyDetectionPage() {
  const { t } = useLang();
  const tracks = [1, 2, 3, 4, 5];
  return (
    <Page>
      <Head title={t("earlyPage.title")} sub={t("earlyPage.sub")} />
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tracks.map((i) => (
          <Card key={i} className="card-hover">
            <CardContent className="p-5">
              <h3 className="font-bold text-navy">{t(`earlyPage.track${i}t`)}</h3>
              <p className="mt-1 text-sm text-muted">{t(`earlyPage.track${i}b`)}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="rounded-2xl border border-urgent/40 bg-urgent/5 p-5">
        <h3 className="mb-3 flex items-center gap-2 font-bold text-urgent"><AlertCircle className="h-5 w-5" />{t("earlyPage.notesTitle")}</h3>
        <ul className="space-y-2 text-sm">
          {[1, 2, 3, 4].map((i) => (
            <li key={i} className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-urgent/70" />{t(`earlyPage.note${i}`)}</li>
          ))}
        </ul>
      </div>
    </Page>
  );
}

export function AiReportsPage() {
  const { t } = useLang();
  const agents = [1, 2, 3, 4, 5, 6, 7];
  return (
    <Page>
      <Head title={t("aiPage.title")} sub={t("aiPage.sub")} />
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <Card><CardContent className="p-6"><h3 className="mb-2 font-bold text-navy">{t("aiPage.fieldsTitle")}</h3><p className="text-sm text-muted">{t("aiPage.fieldsBody")}</p></CardContent></Card>
        <Card><CardContent className="p-6">
          <h3 className="mb-2 font-bold text-navy">{t("aiPage.agentsTitle")}</h3>
          <ul className="space-y-2 text-sm">
            {agents.map((i) => (
              <li key={i} className="flex items-center gap-2"><Sparkles className="h-4 w-4 shrink-0 text-medblue" />{t(`aiPage.agent${i}`)}</li>
            ))}
          </ul>
        </CardContent></Card>
      </div>
      <div className="rounded-2xl border border-medblue/30 bg-lightblue p-4 text-sm text-ink">
        {t("home.medical.disclaimer")}
      </div>
    </Page>
  );
}

export function ForLabsPage() {
  const { t } = useLang();
  return (
    <Page>
      <Head title={t("forLabs.title")} sub={t("forLabs.sub")} />
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="card-hover"><CardContent className="p-5">
            {i === 1 ? <Building2 className="mb-2 h-5 w-5 text-medblue" /> : i === 2 ? <RefreshCcw className="mb-2 h-5 w-5 text-medblue" /> : <FileCheck2 className="mb-2 h-5 w-5 text-medblue" />}
            <h3 className="font-bold text-navy">{t(`forLabs.b${i}t`)}</h3>
            <p className="mt-1 text-sm text-muted">{t(`forLabs.b${i}b`)}</p>
          </CardContent></Card>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card><CardContent className="p-6">
          <h3 className="mb-3 font-bold text-navy">{t("forLabs.reqTitle")}</h3>
          <ul className="space-y-2 text-sm">
            {[1, 2, 3].map((i) => (
              <li key={i} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 text-success" />{t(`forLabs.req${i}`)}</li>
            ))}
          </ul>
        </CardContent></Card>
        <Card><CardContent className="p-6">
          <h3 className="font-bold text-navy">{t("forLabs.joinTitle")}</h3>
          <p className="mt-1 text-sm text-muted">{t("forLabs.joinB")}</p>
          <Button asChild className="mt-4"><a href="/contact">{t("forLabs.cta")}</a></Button>
        </CardContent></Card>
      </div>
    </Page>
  );
}

export function PricingPage() {
  const { t } = useLang();
  return (
    <Page>
      <Head title={t("pricing.title")} sub={t("pricing.sub")} />
      <a href="/#packages" className="mx-auto block w-fit">
        <Button size="lg">{t("packages.title")}</Button>
      </a>
      <p className="mt-4 rounded-xl bg-lightblue p-3 text-center text-xs text-muted">{t("pricing.note")}</p>
    </Page>
  );
}

export function ContactPage() {
  const { t, lang } = useLang();
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "" });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("sending");
    setError("");
    try {
      await api("/api/contact", { body: form });
      setState("sent");
    } catch (err) {
      setState("idle");
      const code = err instanceof Error ? err.message : "ERROR";
      setError(code === "RATE_LIMITED" ? t("common.rateLimited") : t("common.error"));
    }
  };

  return (
    <Page>
      <Head title={t("contact.title")} sub={t("contact.sub")} />
      <div className="grid gap-6 md:grid-cols-5">
        <Card className="md:col-span-3">
          <CardContent className="p-6">
            {state === "sent" ? (
              <div className="py-8 text-center">
                <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
                <h3 className="mt-3 font-bold text-navy">{t("contact.sent")}</h3>
                <p className="mt-1 text-sm text-muted">{t("contact.sentBody")}</p>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <div><Label htmlFor="c-name">{t("contact.name")} *</Label><Input id="c-name" required minLength={3} maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div><Label htmlFor="c-email">{t("contact.email")} *</Label><Input id="c-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} dir="ltr" /></div>
                <div><Label htmlFor="c-subject">{t("contact.subject")}</Label><Input id="c-subject" maxLength={150} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></div>
                <div><Label htmlFor="c-message">{t("contact.message")} *</Label><Textarea id="c-message" required minLength={5} maxLength={4000} rows={5} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></div>
                {error && <p className="rounded-lg bg-urgent/10 p-2 text-sm text-urgent">{error}</p>}
                <Button type="submit" disabled={state === "sending"} className="w-full">
                  <Send className="h-4 w-4" />
                  {state === "sending" ? t("contact.sending") : t("contact.send")}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
        <div className="space-y-3 md:col-span-2">
          <Card><CardContent className="flex items-center gap-3 p-4"><Mail className="h-5 w-5 text-medblue" /><div><div className="text-xs text-muted">{t("contact.info.email")}</div><div dir="ltr" className="text-sm font-bold">support@aldawa.health</div></div></CardContent></Card>
          <Card><CardContent className="flex items-center gap-3 p-4"><Clock className="h-5 w-5 text-medblue" /><div><div className="text-xs text-muted">{t("contact.info.hours")}</div><div className="text-sm font-bold">{t("contact.info.hoursValue")}</div></div></CardContent></Card>
          <Card><CardContent className="flex items-center gap-3 p-4"><MapPin className="h-5 w-5 text-medblue" /><div><div className="text-xs text-muted">{t("contact.info.location")}</div><div className="text-sm font-bold">{t("contact.info.locationValue")}</div></div></CardContent></Card>
        </div>
      </div>
      <p className="mt-6 text-center text-xs text-muted" lang={lang}>{t("footer.medicalNote")}</p>
    </Page>
  );
}

export function PolicyPage({ kind }: { kind: "disclaimer" | "privacy" | "terms" }) {
  const { t } = useLang();
  const sections = [1, 2, 3, 4, 5, 6];
  return (
    <Page>
      <Head title={t(`${kind}.title`)} />
      <Card>
        <CardContent className="space-y-6 p-6">
          {sections.map((i) => (
            <section key={i}>
              <h2 className="mb-1 text-lg font-bold text-navy">{i}. {t(`${kind}.s${i}t`)}</h2>
              <p className="text-sm text-muted">{t(`${kind}.s${i}b`)}</p>
            </section>
          ))}
        </CardContent>
      </Card>
    </Page>
  );
}
