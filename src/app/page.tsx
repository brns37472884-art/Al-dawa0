"use client";
import { useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";
import { Navbar, Footer } from "@/components/layout/public-chrome";
import { Button, Badge, Card, CardContent } from "@/components/ui/core";
import { api } from "@/lib/api";
import { ArrowLeft, ShieldCheck, Activity, Stethoscope, FileSearch, FolderHeart, GitCompareArrows, ListChecks, Bot, Lock, EyeOff, Sparkles, Building2, FileCheck2, MapPin } from "lucide-react";

interface Plan {
  key: string;
  nameAr: string;
  nameEn: string;
  priceEgp: number;
  reportsLimit: number;
  featuresAr: string[];
  featuresEn: string[];
  isActive: boolean;
  sortOrder: number;
}

function Packages() {
  const { t, lang } = useLang();
  const [plans, setPlans] = useState<Plan[] | null>(null);

  useEffect(() => {
    api<{ plans: Plan[] }>("/api/plans")
      .then((d) => setPlans((d.plans ?? []).filter((p) => p.isActive)))
      .catch(() => setPlans([]));
  }, []);

  return (
    <section id="packages" className="bg-[#f0f7fa] py-16">
      <div className="mx-auto max-w-6xl px-4">
        <div className="mb-10 text-center">
          <Badge tone="info">{t("packages.eyebrow")}</Badge>
          <h2 className="mt-3 text-3xl font-extrabold text-navy">
            {t("packages.title").split(" ")[0]}{" "}
            <span className="text-medblue">{t("packages.title").split(" ").slice(1).join(" ")}</span>
          </h2>
          <p className="mt-2 text-muted">{t("packages.sub")}</p>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {(plans ?? [null, null, null]).map((p, i) => {
            const popular = i === 1;
            const features = p ? (lang === "ar" ? p.featuresAr : p.featuresEn) : [];
            const limit = p ? (p.reportsLimit === -1 ? t("packages.unlimited") : t("packages.reportsPerMonth", { n: p.reportsLimit })) : "";
            return (
              <Card key={p?.key ?? i} className={`card-hover relative overflow-hidden ${popular ? "border-medblue shadow-lg" : ""}`}>
                {popular && (
                  <span className="absolute end-4 top-4 rounded-full bg-medblue px-3 py-1 text-xs font-bold text-white">{t("packages.popular")}</span>
                )}
                <CardContent className="p-6 pt-8">
                  <h3 className="text-lg font-bold text-navy">{p ? (lang === "ar" ? p.nameAr : p.nameEn) : "—"}</h3>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-3xl font-extrabold text-medblue">{p ? (p.priceEgp === 0 ? t("packages.free") : p.priceEgp) : "—"}</span>
                    {p && p.priceEgp > 0 && <span className="text-sm text-muted">{t("packages.currency")}</span>}
                  </div>
                  {p && <div className="mt-1 text-xs text-muted">/ {t("packages.perMonth")} · {limit}</div>}
                  <ul className="mt-4 space-y-2">
                    {features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm text-ink">
                        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Button asChild className="mt-6 w-full" variant={popular ? "default" : "outline"}>
                    <a href="/register">{t("packages.choose")}</a>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
        <p className="mx-auto mt-6 max-w-2xl rounded-xl bg-white/80 p-3 text-center text-xs text-muted">{t("packages.note")}</p>
      </div>
    </section>
  );
}

export default function HomePage() {
  const { t } = useLang();

  const problems = [1, 2, 3, 4].map((i) => ({ t: t(`home.problem.${i}t`), b: t(`home.problem.${i}b`) }));
  const solutions = [1, 2, 3, 4, 5].map((i) => ({ t: t(`home.solution.${i}t`), b: t(`home.solution.${i}b`) }));
  const steps = [1, 2, 3, 4, 5].map((i) => ({ t: t(`home.step${i}t`), b: t(`home.step${i}b`) }));
  const security = [1, 2, 3, 4].map((i) => ({ t: t(`home.security.${i}t`), b: t(`home.security.${i}b`) }));
  const stepIcons = [FolderHeart, ListChecks, Building2, FileCheck2, Stethoscope];

  return (
    <div className="min-h-screen">
      <Navbar />

      {/* Hero */}
      <section className="hero-gradient relative overflow-hidden text-white">
        <div className="dot-grid absolute inset-0 opacity-40" aria-hidden />
        <div className="relative mx-auto grid max-w-6xl gap-8 px-4 py-16 md:grid-cols-2 md:py-24">
          <div>
            <Badge tone="navy" className="bg-white/15 text-white">{t("home.hero.badge")}</Badge>
            <h1 className="mt-4 text-4xl font-extrabold leading-tight md:text-5xl">
              {t("home.hero.title").split(" ").slice(0, -2).join(" ")}{" "}
              <span className="text-mint">{t("home.hero.title").split(" ").slice(-2).join(" ")}</span>
            </h1>
            <p className="mt-4 max-w-xl text-white/85">{t("home.hero.sub")}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <a href="/register">{t("home.hero.cta1")}</a>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-white/40 bg-white/10 text-white hover:bg-white/20">
                <a href="/#how">{t("home.hero.cta2")}</a>
              </Button>
            </div>
            <div className="mt-6 flex flex-wrap gap-2 text-xs">
              {[1, 2, 3].map((i) => (
                <span key={i} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-mint" />
                  {t(`home.trust.${i}`)}
                </span>
              ))}
            </div>
          </div>
          <div className="hidden md:block">
            <div className="rounded-3xl border border-white/15 bg-white/10 p-6 backdrop-blur">
              <div className="mb-4 flex items-center justify-between">
                <span className="text-sm font-bold">{t("home.trends.title")}</span>
                <Badge tone="navy" className="bg-white/15 text-white">{t("app.name")}</Badge>
              </div>
              <div className="chart-wrap">
                <svg viewBox="0 0 320 120" className="w-full">
                  <defs>
                    <linearGradient id="hg" x1="0" x2="1">
                      <stop offset="0" stopColor="#35b8c8" />
                      <stop offset="1" stopColor="#62d8d2" />
                    </linearGradient>
                  </defs>
                  <polyline fill="none" stroke="url(#hg)" strokeWidth="3" strokeLinecap="round" points="10,90 60,70 110,80 160,50 210,55 260,35 310,40" />
                  <line x1="10" y1="100" x2="310" y2="100" stroke="rgba(255,255,255,0.25)" strokeDasharray="4 4" />
                </svg>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 text-center text-xs">
                <div className="rounded-xl bg-white/10 p-2.5"><div className="text-base font-bold text-mint">6.9%</div>HbA1c</div>
                <div className="rounded-xl bg-white/10 p-2.5"><div className="text-base font-bold text-mint">208</div>Chol.</div>
                <div className="rounded-xl bg-white/10 p-2.5"><div className="text-base font-bold text-mint">34</div>Vit D</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* المشكلة */}
      <section className="py-16">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="mb-8 text-center text-2xl font-extrabold text-navy">{t("home.problem.title")}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {problems.map((p, i) => (
              <Card key={i} className="card-hover">
                <CardContent className="p-5">
                  <Activity className="mb-2 h-5 w-5 text-urgent" />
                  <h3 className="font-bold text-navy">{p.t}</h3>
                  <p className="mt-1 text-sm text-muted">{p.b}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* الخدمات */}
      <section id="services" className="bg-lightblue/40 py-16">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="mb-8 text-center text-2xl font-extrabold text-navy">{t("home.solution.title")}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {solutions.map((s, i) => (
              <Card key={i} className="card-hover">
                <CardContent className="p-5">
                  <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-medblue/10 text-medblue">
                    {i === 0 ? <FileSearch className="h-5 w-5" /> : i === 1 ? <FolderHeart className="h-5 w-5" /> : i === 2 ? <GitCompareArrows className="h-5 w-5" /> : i === 3 ? <ListChecks className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
                  </div>
                  <h3 className="font-bold text-navy">{s.t}</h3>
                  <p className="mt-1 text-sm text-muted">{s.b}</p>
                </CardContent>
              </Card>
            ))}
            <Card className="card-hover border-medblue/40 bg-white">
              <CardContent className="p-5">
                <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-medblue text-white">
                  <Sparkles className="h-5 w-5" />
                </div>
                <h3 className="font-bold text-navy">{t("home.solution.5t")}</h3>
                <p className="mt-1 text-sm text-muted">{t("home.solution.5b")}</p>
                <a href="/early-detection" className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-medblue hover:underline">
                  {t("earlyPage.title")} <ArrowLeft className="flip-x h-4 w-4" />
                </a>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* كيف تعمل */}
      <section id="how" className="bg-[#edf6fa] py-16">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="mb-10 text-center text-2xl font-extrabold text-navy">{t("home.how.title")}</h2>
          <div className="relative grid gap-6 md:grid-cols-5">
            {steps.map((s, i) => {
              const Icon = stepIcons[i];
              return (
                <div key={i} className="relative text-center">
                  <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-white text-medblue shadow ring-4 ring-[#edf6fa]">
                    <Icon className="h-6 w-6" />
                  </div>
                  <span className="absolute -top-2 start-1/2 ms-5 flex h-6 w-6 items-center justify-center rounded-full bg-medblue text-xs font-bold text-white">{i + 1}</span>
                  <h3 className="text-sm font-bold text-navy">{s.t}</h3>
                  <p className="mt-1 text-xs text-muted">{s.b}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* الإشراف الطبي */}
      <section className="bg-navy py-16 text-white">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="mb-8 text-center text-2xl font-extrabold">{t("home.medical.title")}</h2>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="rounded-2xl border border-white/15 bg-white/10 p-6 backdrop-blur">
              <h3 className="mb-3 font-bold text-mint">{t("home.medical.aiTitle")}</h3>
              <ul className="space-y-2 text-sm text-white/85">
                {[1, 2, 3, 4].map((i) => (
                  <li key={i} className="flex items-center gap-2"><Bot className="h-4 w-4 shrink-0 text-mint" /> {t(`home.medical.ai${i}`)}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-white/15 bg-white/10 p-6 backdrop-blur">
              <h3 className="mb-3 font-bold text-mint">{t("home.medical.doctorTitle")}</h3>
              <ul className="space-y-2 text-sm text-white/85">
                {[1, 2, 3, 4].map((i) => (
                  <li key={i} className="flex items-center gap-2"><Stethoscope className="h-4 w-4 shrink-0 text-mint" /> {t(`home.medical.doctor${i}`)}</li>
                ))}
              </ul>
            </div>
          </div>
          <p className="mx-auto mt-6 max-w-3xl rounded-xl bg-white/5 p-4 text-center text-xs text-white/75">{t("home.medical.disclaimer")}</p>
        </div>
      </section>

      {/* الأمان */}
      <section className="py-16">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="mb-8 text-center text-2xl font-extrabold text-navy">{t("home.security.title")}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {security.map((s, i) => (
              <Card key={i} className="card-hover">
                <CardContent className="p-5">
                  {i === 0 ? <ShieldCheck className="mb-2 h-5 w-5 text-medblue" /> : i === 1 ? <EyeOff className="mb-2 h-5 w-5 text-medblue" /> : i === 2 ? <Lock className="mb-2 h-5 w-5 text-medblue" /> : <Bot className="mb-2 h-5 w-5 text-medblue" />}
                  <h3 className="font-bold text-navy">{s.t}</h3>
                  <p className="mt-1 text-sm text-muted">{s.b}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* الباقات — من /api/plans */}
      <Packages />

      {/* المعامل */}
      <section className="bg-lightblue/40 py-16">
        <div className="mx-auto max-w-6xl px-4 text-center">
          <Badge tone="info">{t("home.labs.badge")}</Badge>
          <h2 className="mt-3 text-2xl font-extrabold text-navy">{t("home.labs.title")}</h2>
          <p className="mx-auto mt-2 max-w-2xl text-muted">{t("home.labs.sub")}</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="card-hover">
                <CardContent className="p-5 text-start">
                  {i === 1 ? <FileCheck2 className="mb-2 h-5 w-5 text-medblue" /> : i === 2 ? <MapPin className="mb-2 h-5 w-5 text-medblue" /> : <Building2 className="mb-2 h-5 w-5 text-medblue" />}
                  <h3 className="font-bold text-navy">{t(`home.labs.${i}t`)}</h3>
                  <p className="mt-1 text-sm text-muted">{t(`home.labs.${i}b`)}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          <Button asChild className="mt-8" variant="navy">
            <a href="/for-labs">{t("forLabs.title")}</a>
          </Button>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 text-center">
        <div className="mx-auto max-w-2xl px-4">
          <h2 className="text-3xl font-extrabold text-navy">{t("home.cta.title")}</h2>
          <p className="mt-3 text-muted">{t("home.cta.sub")}</p>
          <Button asChild size="lg" className="mt-6">
            <a href="/register">{t("home.cta.button")}</a>
          </Button>
        </div>
      </section>

      <Footer />
    </div>
  );
}
