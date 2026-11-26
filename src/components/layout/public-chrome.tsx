"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLang } from "@/lib/i18n";
import { useSession, roleHome } from "@/hooks/use-session";
import { Button } from "@/components/ui/core";
import { Logo } from "@/components/shared/common";
import { Menu, Globe } from "lucide-react";

export function Navbar({ hideAuth = false }: { hideAuth?: boolean }) {
  const { t, lang, setLang } = useLang();
  const { user } = useSession();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const items: Array<{ href: string; label: string }> = [
    { href: "/", label: t("nav.home") },
    { href: "/#services", label: t("nav.services") },
    { href: "/#packages", label: t("nav.packages") },
    { href: "/#how", label: t("nav.how") },
    { href: "/about", label: t("nav.about") },
    { href: "/contact", label: t("nav.contact") },
  ];

  const goDashboard = () => {
    window.location.href = roleHome(user?.role);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/90 backdrop-blur">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
        <Link href="/" aria-label="Al Dawa home">
          <Logo />
        </Link>
        <div className="hidden items-center gap-1 lg:flex">
          {items.map((it) => (
            <a
              key={it.href}
              href={it.href}
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors hover:bg-lightblue hover:text-medblue-dark ${pathname === it.href ? "text-medblue-dark" : "text-muted"}`}
            >
              {it.label}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setLang(lang === "ar" ? "en" : "ar")}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-2.5 text-sm font-bold text-muted hover:bg-lightblue"
            aria-label="switch language"
          >
            <Globe className="h-4 w-4" />
            {lang === "ar" ? "EN" : "ع"}
          </button>
          {!user && !hideAuth && (
            <div className="hidden items-center gap-2 sm:flex">
              <Button asChild variant="ghost" size="sm">
                <a href="/login">{t("nav.login")}</a>
              </Button>
              <Button asChild size="sm">
                <a href="/register">{t("nav.register")}</a>
              </Button>
            </div>
          )}
            {user && (
              <Button variant="navy" size="sm" onClick={goDashboard}>
                {t("nav.dashboard")}
              </Button>
            )}
          <button className="rounded-lg p-2 hover:bg-lightblue lg:hidden" onClick={() => setOpen(!open)} aria-label="menu">
            <Menu className="h-5 w-5 text-navy" />
          </button>
        </div>
      </nav>
      {open && (
        <div className="border-t border-line bg-white px-4 py-3 lg:hidden">
          <div className="flex flex-col gap-1">
            {items.map((it) => (
              <a key={it.href} href={it.href} onClick={() => setOpen(false)} className="rounded-lg px-3 py-2 text-sm font-semibold text-muted hover:bg-lightblue">
                {it.label}
              </a>
            ))}
            {!user && (
              <div className="mt-2 flex gap-2">
                <Button asChild variant="outline" size="sm" className="flex-1">
                  <a href="/login" onClick={() => setOpen(false)}>{t("nav.login")}</a>
                </Button>
                <Button asChild size="sm" className="flex-1">
                  <a href="/register" onClick={() => setOpen(false)}>{t("nav.register")}</a>
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

export function Footer() {
  const { t } = useLang();
  const year = new Date().getFullYear();
  return (
    <footer className="bg-navy text-white/80">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:grid-cols-3">
        <div className="md:col-span-1">
          <Logo light />
          <p className="mt-3 max-w-xs text-sm">{t("footer.tagline")}</p>
          <p className="mt-2 text-xs font-bold tracking-wide text-cyan">{t("app.slogan")}</p>
        </div>
        <div>
          <h4 className="mb-3 text-sm font-bold text-white">{t("footer.platform")}</h4>
          <ul className="space-y-2 text-sm">
            <li><a href="/#how" className="hover:text-cyan">{t("nav.how")}</a></li>
            <li><a href="/screenings" className="hover:text-cyan">{t("screeningsPage.title")}</a></li>
            <li><a href="/early-detection" className="hover:text-cyan">{t("earlyPage.title")}</a></li>
            <li><a href="/ai-reports" className="hover:text-cyan">{t("aiPage.title")}</a></li>
            <li><a href="/#packages" className="hover:text-cyan">{t("nav.packages")}</a></li>
            <li><a href="/contact" className="hover:text-cyan">{t("nav.contact")}</a></li>
          </ul>
        </div>
        <div>
          <h4 className="mb-3 text-sm font-bold text-white">{t("footer.legal")}</h4>
          <ul className="space-y-2 text-sm">
            <li><a href="/privacy" className="hover:text-cyan">{t("footer.privacy")}</a></li>
            <li><a href="/terms" className="hover:text-cyan">{t("footer.terms")}</a></li>
            <li><a href="/disclaimer" className="hover:text-cyan">{t("footer.disclaimer")}</a></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-4 text-xs md:flex-row md:items-center md:justify-between">
          <span>© {year} {t("app.name")} | AL DAWA — {t("footer.rights")}</span>
          <span className="max-w-xl text-white/60">{t("footer.medicalNote")}</span>
        </div>
      </div>
    </footer>
  );
}
