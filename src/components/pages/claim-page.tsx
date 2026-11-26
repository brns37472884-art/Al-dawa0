"use client";
import { useCallback, useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";
import { api } from "@/lib/api";
import { Navbar, Footer } from "@/components/layout/public-chrome";
import { Button, Card, CardContent, Input, Label, Badge } from "@/components/ui/core";
import { useSession } from "@/hooks/use-session";
import { fmtDate } from "@/lib/api";
import { ShieldCheck, PackageCheck } from "lucide-react";

interface PendingItem {
  id: string;
  labName: string;
  patientNameOnFile: string;
  fileName: string;
  reportType: string;
  testDate: string | null;
  createdAt: string;
  expiresAt: string;
}

/** صفحة استلام النتائج المعلّقة — تحقق مزدوج (رمز + موبايل + اسم) */
export function ClaimPage() {
  const { t, lang } = useLang();
  const { user, loading } = useSession();
  const [data, setData] = useState<{ phoneOnFile: boolean; phoneMasked?: string; pending: PendingItem[] } | null>(null);
  const [selected, setSelected] = useState<PendingItem | null>(null);
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const load = useCallback(() => {
    if (!user) return;
    api<{ phoneOnFile: boolean; phoneMasked?: string; pending: PendingItem[] }>("/api/claim")
      .then(setData)
      .catch(() => setData({ phoneOnFile: false, pending: [] }));
  }, [user]);
  useEffect(() => {
    if (!loading) void load();
  }, [loading, user, load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/claim", { body: { pendingId: selected.id, nameConfirm: name, claimToken: token } });
      setDone(true);
    } catch (err) {
      const code = err instanceof Error ? err.message : "ERROR";
      const key = ["CLAIM_TOKEN_INVALID", "PHONE_MISMATCH", "NAME_MISMATCH", "NOT_FOUND_OR_EXPIRED", "PHONE_NOT_VERIFIED", "FILE_CORRUPT"].includes(code) ? `claim.err.${code}` : null;
      setError(key ? t(key) : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="mx-auto max-w-2xl px-4 py-10">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-extrabold text-navy">{t("claim.title")}</h1>
          <p className="mt-2 text-sm text-muted">{t("claim.sub")}</p>
        </div>

        {!user && !loading && (
          <Card>
            <CardContent className="p-6 text-center">
              <ShieldCheck className="mx-auto h-8 w-8 text-medblue" />
              <p className="mt-3 text-sm text-muted">{t("claim.sub")}</p>
              <div className="mt-4 flex justify-center gap-2">
                <Button asChild><a href="/login">{t("nav.login")}</a></Button>
                <Button asChild variant="outline"><a href="/register">{t("nav.register")}</a></Button>
              </div>
            </CardContent>
          </Card>
        )}

        {user && done && (
          <Card><CardContent className="p-6 text-center">
            <PackageCheck className="mx-auto h-10 w-10 text-success" />
            <p className="mt-3 font-bold text-navy">{t("claim.received")}</p>
            <Button asChild className="mt-4"><a href="/app/records">{t("shell.nav.records")}</a></Button>
          </CardContent></Card>
        )}

        {user && !done && (
          <div className="space-y-4">
            <Card><CardContent className="p-4 text-sm">
              <span className="text-muted">{t("claim.phoneOnFile")}: </span>
              <span dir="ltr" className="font-bold">{data?.phoneMasked ?? "—"}</span>
              {!data?.phoneOnFile && <p className="mt-1 text-xs text-urgent">{t("claim.err.PHONE_NOT_VERIFIED")}</p>}
            </CardContent></Card>

            {data && data.pending.length === 0 && (
              <Card><CardContent className="p-6 text-center text-sm text-muted">{t("claim.noPending")}</CardContent></Card>
            )}

            {data?.pending.map((p) => (
              <Card key={p.id} className={selected?.id === p.id ? "border-medblue" : ""}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-bold text-navy">{p.labName}</div>
                      <div className="text-xs text-muted">{p.fileName} · {fmtDate(p.createdAt, lang)}</div>
                    </div>
                    <Badge tone="info">{t("lab.results.status.PENDING")}</Badge>
                  </div>
                  {selected?.id === p.id && (
                    <form onSubmit={submit} className="mt-4 space-y-3 border-t border-line pt-4">
                      <div><Label htmlFor="cl-name">{t("claim.nameConfirm")}</Label><Input id="cl-name" required value={name} onChange={(e) => setName(e.target.value)} /></div>
                      <div><Label htmlFor="cl-token">{t("claim.token")}</Label><Input id="cl-token" dir="ltr" required value={token} onChange={(e) => setToken(e.target.value)} /></div>
                      {error && <p className="rounded-lg bg-urgent/10 p-2 text-sm text-urgent">{error}</p>}
                      <Button type="submit" disabled={busy} className="w-full">{busy ? t("claim.claiming") : t("claim.receive")}</Button>
                    </form>
                  )}
                  {selected?.id !== p.id && (
                    <Button variant="soft" size="sm" className="mt-3 w-full" onClick={() => { setSelected(p); setError(""); }}>{t("claim.title")}</Button>
                  )}
                </CardContent>
              </Card>
            ))}

            <p className="rounded-xl bg-lightblue p-3 text-center text-xs text-muted">{t("claim.privacyNote")}</p>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
