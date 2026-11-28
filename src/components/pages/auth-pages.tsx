"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLang } from "@/lib/i18n";
import { roleHome, useSession } from "@/hooks/use-session";
import { api, ApiError } from "@/lib/api";
import { Navbar, Footer } from "@/components/layout/public-chrome";
import { Button, Card, CardContent, Input, Label, Checkbox, Badge, Progress } from "@/components/ui/core";
import { AlertCircle } from "lucide-react";

const ERROR_KEYS = [
  "INVALID_CREDENTIALS", "EMAIL_EXISTS", "PHONE_EXISTS", "INVALID_PHONE", "OTP_EXPIRED", "OTP_INVALID",
  "MFA_EXPIRED", "MFA_INVALID", "RATE_LIMITED", "WEAK_PASSWORD", "INVALID_EMAIL", "CONSENT_REQUIRED",
  "INVALID_NAME", "INVALID_DOB", "INVALID_GENDER", "OTP_MISSING", "REGISTER_FAILED", "ORIGIN_FORBIDDEN",
];

function ErrMsg({ code }: { code: string }) {
  const { t } = useLang();
  const key = ERROR_KEYS.includes(code) ? `auth.err.${code}` : null;
  return <p className="rounded-lg bg-urgent/10 p-2.5 text-sm text-urgent">{key ? t(key) : t("common.error")}</p>;
}

export function LoginPage() {
  const { t, lang } = useLang();
  const router = useRouter();
  const { refresh } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const d = await api<{ mfaRequired?: boolean; demoCode?: string; user?: { role: string } }>("/api/auth/login", { body: { email, password } });
      if (d.mfaRequired) {
        setMfaRequired(true);
        setDemoCode(d.demoCode ?? null);
        return;
      }
      // مهم: SessionProvider يحمّل الجلسة مرة واحدة عند فتح الموقع (قبل الدخول)، فبدون refresh()
      // تبقى user=null وتعيدك لوحة التحكم إلى /login فورًا رغم نجاح الدخول.
      await refresh();
      router.replace(roleHome(d.user?.role));
    } catch (err) {
      setError(err instanceof ApiError ? err.code : "ERROR");
    } finally {
      setBusy(false);
    }
  };

  const submitMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const d = await api<{ user?: { role: string } }>("/api/auth/mfa-verify", { body: { email, code: mfaCode } });
      await refresh();
      router.replace(roleHome(d.user?.role));
    } catch (err) {
      setError(err instanceof ApiError ? err.code : "ERROR");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen">
      <Navbar hideAuth />
      <main className="mx-auto max-w-md px-4 py-12">
        <Card>
          <CardContent className="p-6">
            <h1 className="text-xl font-extrabold text-navy">{mfaRequired ? t("auth.mfaTitle") : t("auth.loginTitle")}</h1>
            <p className="mt-1 text-sm text-muted">{mfaRequired ? t("auth.mfaSub") : t("auth.loginSub")}</p>
            {demoCode && (
              <div className="mt-3 rounded-xl border border-dashed border-medblue bg-lightblue p-3 text-center">
                <div dir="ltr" className="text-2xl font-extrabold tracking-[0.3em] text-medblue-dark">{demoCode}</div>
                <p className="mt-1 text-[11px] text-muted">{t("auth.demoCodeNote")}</p>
              </div>
            )}
            {!mfaRequired ? (
              <form onSubmit={submit} className="mt-5 space-y-4">
                <div><Label htmlFor="l-email">{t("auth.email")}</Label><Input id="l-email" type="email" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></div>
                <div><Label htmlFor="l-pass">{t("auth.password")}</Label><Input id="l-pass" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></div>
                {error && <ErrMsg code={error} />}
                <Button type="submit" disabled={busy} className="w-full">{t("auth.login")}</Button>
                <p className="text-center text-sm text-muted"><a href="/register" className="font-bold text-medblue hover:underline">{t("auth.noAccount")}</a></p>
                <p className="text-center text-sm text-muted"><a href="/forgot-password" className="font-bold text-medblue hover:underline">{lang === "ar" ? "نسيت كلمة السر؟" : "Forgot password?"}</a></p>
              </form>
            ) : (
              <form onSubmit={submitMfa} className="mt-5 space-y-4">
                <div><Label htmlFor="l-otp">{t("auth.otpLabel")}</Label><Input id="l-otp" dir="ltr" inputMode="numeric" maxLength={6} required className="text-center text-xl tracking-[0.4em]" value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))} /></div>
                {error && <ErrMsg code={error} />}
                <Button type="submit" disabled={busy || mfaCode.length !== 6} className="w-full">{t("auth.mfaVerify")}</Button>
              </form>
            )}
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
}

const GOVS = ["القاهرة", "الجيزة", "الإسكندرية", "سوهاج", "أسيوط", "المنيا", "الفيوم", "بني سويف", "قنا", "الأقصر", "أسوان", "الدقهلية", "الشرقية", "الغربية", "المنوفية", "كفر الشيخ", "البحيرة", "القليوبية", "بورسعيد", "السويس", "الإسماعيلية", "مطروح", "البحر الأحمر", "الوادي الجديد", "شمال سيناء", "جنوب سيناء"];

export function RegisterPage() {
  const { t } = useLang();
  const router = useRouter();
  const { refresh } = useSession();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [demoCode, setDemoCode] = useState<string | null>(null);
  // التحقق من البريد عند التسجيل مفتاح تشغيل من السيرفر (EMAIL_VERIFICATION_REQUIRED) — الافتراضي مُعطَّل
  const [needOtp, setNeedOtp] = useState(false);
  useEffect(() => {
    api<{ emailVerificationRequired?: boolean }>("/api/config").then((c) => setNeedOtp(c.emailVerificationRequired === true)).catch(() => {});
  }, []);

  const [f, setF] = useState({
    fullName: "", email: "", phone: "", password: "", confirmPassword: "", otp: "",
    dob: "", gender: "", gov: "سوهاج", city: "", emergency: "",
    cData: false, cAI: false, cDoctor: false, cLab: false, cNotif: false,
  });
  const set = (k: keyof typeof f, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  const sendOtp = async () => {
    setBusy(true);
    setError("");
    try {
      const d = await api<{ demoCode?: string }>("/api/auth/otp-send", { body: { email: f.email } });
      setDemoCode(d.demoCode ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : "ERROR");
    } finally {
      setBusy(false);
    }
  };

  const next1 = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (f.fullName.trim().length < 3) return setError("INVALID_NAME");
    if (f.password !== f.confirmPassword) return setError("WEAK_PASSWORD");
    if (!/^01\d{9}$/.test(f.phone.replace(/\s/g, ""))) return setError("INVALID_PHONE");
    setStep(1);
  };
  const next2 = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!f.dob || !f.gender) return setError("INVALID_DOB");
    setStep(2);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/register", {
        body: {
          fullName: f.fullName, email: f.email, phone: f.phone, password: f.password,
          dob: f.dob, gender: f.gender, gov: f.gov, city: f.city, emergencyContact: f.emergency,
          otp: needOtp ? f.otp : "",
          consents: { data: f.cData, ai: f.cAI, doctor: f.cDoctor, labShare: f.cLab, notifications: f.cNotif },
        },
      });
      await refresh(); // نفس سبب الدخول: حدّث الجلسة قبل فتح /app
      router.replace("/app");
    } catch (err) {
      setError(err instanceof ApiError ? err.code : "ERROR");
      setBusy(false);
    }
  };

  const stepTitles = [t("auth.step1"), t("auth.step2"), t("auth.step3")];

  return (
    <div className="min-h-screen">
      <Navbar hideAuth />
      <main className="mx-auto max-w-lg px-4 py-10">
        <Card>
          <CardContent className="p-6">
            <h1 className="text-xl font-extrabold text-navy">{t("auth.registerTitle")}</h1>
            <p className="mt-1 text-sm text-muted">{t("auth.registerSub")}</p>
            <div className="mt-4">
              <Progress value={((step + 1) / 3) * 100} />
              <div className="mt-2 flex justify-between text-xs font-bold text-muted">
                {stepTitles.map((s, i) => <span key={s} className={i === step ? "text-medblue" : ""}>{i + 1}. {s}</span>)}
              </div>
            </div>

            {step === 0 && (
              <form onSubmit={next1} className="mt-5 space-y-4">
                <div><Label htmlFor="r-name">{t("auth.fullName")}</Label><Input id="r-name" required value={f.fullName} onChange={(e) => set("fullName", e.target.value)} /></div>
                <div>
                  <Label htmlFor="r-email">{t("auth.email")}</Label>
                  <div className="flex gap-2">
                    <Input id="r-email" type="email" dir="ltr" required value={f.email} onChange={(e) => set("email", e.target.value)} />
                    {needOtp && <Button type="button" variant="soft" disabled={busy || !f.email} onClick={sendOtp}>{t("auth.sendOtp")}</Button>}
                  </div>
                  {needOtp && demoCode && (
                    <div className="mt-2 rounded-xl border border-dashed border-medblue bg-lightblue p-2.5 text-center">
                      <span dir="ltr" className="text-xl font-extrabold tracking-[0.3em] text-medblue-dark">{demoCode}</span>
                      <span className="ms-3 text-[11px] text-muted">{t("auth.demoCodeNote")}</span>
                    </div>
                  )}
                </div>
                {needOtp && <div><Label htmlFor="r-otp">{t("auth.otpLabel")}</Label><Input id="r-otp" dir="ltr" inputMode="numeric" maxLength={6} required value={f.otp} onChange={(e) => set("otp", e.target.value.replace(/\D/g, ""))} className="text-center text-lg tracking-[0.4em]" /></div>}
                <div><Label htmlFor="r-phone">{t("auth.phone")}</Label><Input id="r-phone" dir="ltr" inputMode="numeric" placeholder="01xxxxxxxxx" required value={f.phone} onChange={(e) => set("phone", e.target.value)} /><p className="mt-1 text-xs text-muted">{t("auth.phoneHint")}</p></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label htmlFor="r-pass">{t("auth.password")}</Label><Input id="r-pass" type="password" required value={f.password} onChange={(e) => set("password", e.target.value)} /></div>
                  <div><Label htmlFor="r-pass2">{t("auth.confirmPassword")}</Label><Input id="r-pass2" type="password" required value={f.confirmPassword} onChange={(e) => set("confirmPassword", e.target.value)} /></div>
                </div>
                {error && <ErrMsg code={error} />}
                <Button type="submit" className="w-full">{t("common.next")}</Button>
                <p className="text-center text-sm text-muted"><a href="/login" className="font-bold text-medblue hover:underline">{t("auth.haveAccount")}</a></p>
              </form>
            )}

            {step === 1 && (
              <form onSubmit={next2} className="mt-5 space-y-4">
                <div><Label htmlFor="r-dob">{t("auth.dob")}</Label><Input id="r-dob" type="date" required max={new Date().toISOString().slice(0, 10)} value={f.dob} onChange={(e) => set("dob", e.target.value)} /></div>
                <div>
                  <Label>{t("auth.gender")}</Label>
                  <div className="mt-1 flex gap-3">
                    {["MALE", "FEMALE"].map((g) => (
                      <button key={g} type="button" onClick={() => set("gender", g)} className={`flex-1 rounded-xl border p-2.5 text-sm font-bold ${f.gender === g ? "border-medblue bg-lightblue text-medblue-dark" : "border-line text-muted"}`}>
                        {g === "MALE" ? t("auth.genderMale") : t("auth.genderFemale")}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label htmlFor="r-gov">{t("auth.gov")}</Label>
                    <select id="r-gov" value={f.gov} onChange={(e) => set("gov", e.target.value)} className="h-10 w-full rounded-xl border border-input bg-white px-3 text-sm">
                      {GOVS.map((g) => <option key={g}>{g}</option>)}
                    </select>
                  </div>
                  <div><Label htmlFor="r-city">{t("auth.city")}</Label><Input id="r-city" value={f.city} onChange={(e) => set("city", e.target.value)} /></div>
                </div>
                <div><Label htmlFor="r-emg">{t("auth.emergency")}</Label><Input id="r-emg" dir="ltr" value={f.emergency} onChange={(e) => set("emergency", e.target.value)} /></div>
                {error && <ErrMsg code={error} />}
                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="flex-1" onClick={() => setStep(0)}>{t("common.back")}</Button>
                  <Button type="submit" className="flex-1">{t("common.next")}</Button>
                </div>
              </form>
            )}

            {step === 2 && (
              <form onSubmit={submit} className="mt-5 space-y-3">
                {[
                  { key: "cData" as const, label: t("auth.consentData"), required: true },
                  { key: "cAI" as const, label: t("auth.consentAI"), required: true },
                  { key: "cDoctor" as const, label: t("auth.consentDoctor"), required: true },
                  { key: "cLab" as const, label: t("auth.consentLabShare"), required: true },
                  { key: "cNotif" as const, label: t("auth.consentNotif"), required: false },
                ].map((c) => (
                  <label key={c.key} className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 text-sm hover:bg-lightblue/50">
                    <Checkbox checked={f[c.key]} onCheckedChange={(v) => set(c.key, v)} id={c.key} />
                    <span className="text-ink">
                      {c.label} {c.required && <span className="text-urgent">*</span>}
                    </span>
                  </label>
                ))}
                <p className="text-xs text-muted">{t("auth.consentNote")}</p>
                {error && <ErrMsg code={error} />}
                <div className="flex gap-2 pt-2">
                  <Button type="button" variant="outline" className="flex-1" onClick={() => setStep(1)}>{t("common.back")}</Button>
                  <Button type="submit" className="flex-1" disabled={busy || !(f.cData && f.cAI && f.cDoctor && f.cLab) || (needOtp && f.otp.length !== 6)}>{t("auth.createAccount")}</Button>
                </div>
              </form>
            )}
            {needOtp && demoCode && (
              <p className="mt-4 flex items-center gap-1.5 text-[11px] text-muted"><AlertCircle className="h-3.5 w-3.5" />{t("auth.demoAccounts")}</p>
            )}
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
}

void Badge;


/** نسيت كلمة السر — بلا SMTP يصل الطلب للإدارة (تبويب التواصل) وتعيد التعيين يدويًا */
export function ForgotPasswordPage() {
  const { lang } = useLang();
  const ar = lang === "ar";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    setErr("");
    setBusy(true);
    try {
      await api("/api/contact", {
        body: {
          name,
          email,
          subject: "RESET_PASSWORD — طلب إعادة تعيين كلمة السر",
          message: `طلب إعادة تعيين كلمة السر للحساب: ${email}${phone ? ` — موبايل للتواصل: ${phone}` : ""}`,
        },
      });
      setDone(true);
    } catch (e) {
      setErr(e instanceof ApiError && e.code === "RATE_LIMITED" ? (ar ? "محاولات كثيرة، حاول لاحقًا" : "Too many attempts, try later") : ar ? "تأكد من الاسم (3 أحرف+) والبريد" : "Check your name (3+ chars) and email");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Navbar />
      <main className="mx-auto flex min-h-[70vh] max-w-md items-center px-4 py-10">
        <Card className="w-full">
          <CardContent className="space-y-4 p-6">
            <h1 className="text-xl font-extrabold text-navy">{ar ? "نسيت كلمة السر" : "Forgot password"}</h1>
            {done ? (
              <p className="rounded-xl bg-success/10 p-3 text-sm text-ink">
                {ar ? "وصل طلبك للإدارة. هيتم التواصل معاك وتعيين كلمة سر جديدة." : "Your request reached the admin. You will be contacted with a new password."}
              </p>
            ) : (
              <>
                <p className="text-sm text-muted">{ar ? "اكتب بياناتك وهيوصل الطلب للإدارة لتعيين كلمة سر جديدة." : "Enter your details; the admin will set a new password for you."}</p>
                <div><Label>{ar ? "الاسم" : "Name"}</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div><Label>{ar ? "البريد الإلكتروني للحساب" : "Account email"}</Label><Input dir="ltr" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                <div><Label>{ar ? "رقم موبايل للتواصل (اختياري)" : "Contact mobile (optional)"}</Label><Input dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
                {err && <p className="flex items-center gap-1 text-sm text-urgent"><AlertCircle className="h-4 w-4" />{err}</p>}
                <Button className="w-full" disabled={busy || name.trim().length < 3 || !email.includes("@")} onClick={submit}>{ar ? "إرسال الطلب" : "Send request"}</Button>
              </>
            )}
            <p className="text-center text-sm"><a href="/login" className="font-bold text-medblue hover:underline">{ar ? "العودة لتسجيل الدخول" : "Back to login"}</a></p>
          </CardContent>
        </Card>
      </main>
      <Footer />
    </>
  );
}
