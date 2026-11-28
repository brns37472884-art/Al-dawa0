"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLang } from "@/lib/i18n";
import { useSession, roleHome } from "@/hooks/use-session";
import { useRealtime } from "@/hooks/use-realtime";
import { Button } from "@/components/ui/core";
import { Logo } from "@/components/shared/common";
import { Bell, LogOut, Globe } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon?: string;
}

/**
 * غلاف لوحات الأدوار — سايدبار بسيط (موبايل/كمبيوتر) + جرس إشعارات + مؤشر مباشر.
 */
export function DashboardShell({
  title,
  nav,
  children,
  extraNav,
  home,
}: {
  /** مسار لوحة هذا الغلاف (/app, /doctor, /lab, /admin, /officer) — أي دور آخر يُعاد لوحته */
  home: string;
  title: string;
  nav: NavItem[];
  children: React.ReactNode;
  extraNav?: React.ReactNode;
}) {
  const { t, lang, setLang } = useLang();
  const { user, loading, logout } = useSession();
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);

  const onEvent = useCallback(
    (ev: { type: string }) => {
      setFlash(t(`rt.${ev.type}`));
      setUnread((u) => u + 1);
      setTimeout(() => setFlash(null), 4000);
      // إعادة جلب الصفحة الحالية بعد حدث — الواجهة تعيد الجلب من API مصرّح به
      router.refresh();
      window.dispatchEvent(new CustomEvent("aldawa:refresh"));
    },
    [router, t]
  );
  const rt = useRealtime(onEvent);

  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace("/login"); return; }
    const mine = roleHome(user.role);
    if (mine !== home) router.replace(mine);
  }, [loading, user, router, home]);

  useEffect(() => {
    if (!user) return;
    const load = () =>
      fetch("/api/notifications", { credentials: "same-origin", cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setUnread(d.unread ?? 0))
        .catch(() => {});
    load();
    window.addEventListener("aldawa:refresh", load);
    return () => window.removeEventListener("aldawa:refresh", load);
  }, [user]);

  if (loading) {
    return <div className="p-10 text-center text-muted">{t("common.loading")}</div>;
  }
  if (!user || roleHome(user.role) !== home) return null;

  const doLogout = async () => {
    await logout();
    window.location.href = "/";
  };

  return (
    <div className="flex min-h-screen">
      {/* السايدبار */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col justify-between bg-navy p-4 text-white lg:flex">
        <div>
          <Link href="/" className="mb-6 block">
            <Logo light />
          </Link>
          <div className="mb-4 rounded-xl bg-white/10 p-3 text-sm">
            <div className="font-bold">{title}</div>
            <div className="text-xs text-white/60">{user.fullName}</div>
          </div>
          <nav className="space-y-1">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className="block rounded-xl px-3 py-2 text-sm font-semibold text-white/80 hover:bg-white/10 hover:text-white">
                {n.label}
              </Link>
            ))}
          </nav>
          {extraNav && <div className="mt-4">{extraNav}</div>}
        </div>
        <div className="space-y-2">
          <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs ${rt.connected ? "bg-success/20 text-white" : "bg-white/10 text-white/70"}`}>
            <span className={`h-2 w-2 rounded-full ${rt.connected ? "bg-success animate-pulse" : "bg-warning"}`} />
            {rt.connected ? t("shell.realtime") : "—"}
          </div>
          <button onClick={() => setLang(lang === "ar" ? "en" : "ar")} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-white/80 hover:bg-white/10">
            <Globe className="h-4 w-4" /> {lang === "ar" ? "EN" : "ع"}
          </button>
          <button onClick={doLogout} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-white/80 hover:bg-white/10">
            <LogOut className="h-4 w-4" /> {t("common.logout")}
          </button>
        </div>
      </aside>

      {/* المحتوى */}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-white/95 px-4 py-3 backdrop-blur lg:px-6">
          <div className="flex items-center gap-3">
            <Link href="/" className="lg:hidden"><Logo size="sm" /></Link>
            <h1 className="text-lg font-bold text-navy">{title}</h1>
          </div>
          <div className="flex items-center gap-2">
            {flash && <span className="rounded-full bg-medblue/10 px-3 py-1 text-xs font-bold text-medblue-dark">{flash}</span>}
            <Link href="/notifications" className="relative rounded-xl p-2 hover:bg-lightblue" aria-label={t("shell.nav.notifications")}>
              <Bell className="h-5 w-5 text-navy" />
              {unread > 0 && <span className="absolute -end-1 -top-1 rounded-full bg-urgent px-1.5 text-[10px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}
            </Link>
            <Button variant="ghost" size="sm" className="lg:hidden" onClick={doLogout}>{t("common.logout")}</Button>
          </div>
        </header>

        {/* تنقل الموبايل */}
        <nav className="flex gap-1 overflow-x-auto border-b border-line bg-white px-3 py-2 lg:hidden">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-bold text-muted hover:bg-lightblue">
              {n.label}
            </Link>
          ))}
        </nav>

        <main className="mx-auto max-w-6xl p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}

export { roleHome };
