import { NextRequest } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { isDemoMode } from "@/env";
import {
  getSessionUser, jsonOk, jsonError, setSessionCookie, clearSessionCookie,
  verifyPassword, dummyPasswordVerify, invalidateUserTokens,
} from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { kvSet, kvGet, kvDel } from "@/lib/redis";
import { hashCode, codeMatches } from "@/lib/crypto-file";
import { sendOtpEmail, sendMfaEmail } from "@/lib/email";
import { logAudit, readJson } from "@/lib/api-utils";
import { emailVerificationRequired, mfaEmailRequired } from "@/lib/flags";
import { normalizePhone, isStrongPassword, isValidEmail } from "@/lib/helpers";

/**
 * المصادقة — OTP بالبريد (3 أكواد/10 دقائق) + MFA بالبريد للحسابات المهنية.
 * بلا DEMO_MODE=true لا يظهر أي رمز على الشاشة إطلاقًا.
 */

type Action = string;

function emailValid(e: string): boolean {
  return isValidEmail(e);
}

/** متطلبات MFA: DOCTOR (لو مفعّل) + LAB/LAB_SUPERVISOR + MEDICAL_OFFICER + ADMIN */
async function needsMfa(role: string, userId: string): Promise<boolean> {
  if (!mfaEmailRequired()) return false; // MFA_EMAIL_REQUIRED=false — مؤقتًا حتى ضبط مزود بريد
  if (role === "LAB" || role === "LAB_SUPERVISOR" || role === "MEDICAL_OFFICER" || role === "ADMIN") return true;
  if (role === "DOCTOR") {
    const p = await db.doctorProfile.findUnique({ where: { userId } });
    return !!p?.mfaEnabled;
  }
  return false;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  const { action }: { action: Action } = await ctx.params;
  const ip = clientIp(req);
  const demo = isDemoMode();

  // ---------- otp-send ----------
  if (action === "otp-send") {
    const body = await readJson(req);
    const email = String(body?.email ?? "").trim().toLowerCase();
    if (!emailValid(email)) return jsonError("INVALID_EMAIL", 400);
    const exists = await db.user.findUnique({ where: { email } });
    if (exists) return jsonError("EMAIL_EXISTS", 409);
    if (!(await rateLimit(`otp:${email}`, 3, 10 * 60 * 1000)) || !(await rateLimit(`otp-ip:${ip}`, 15, 60 * 60 * 1000))) {
      await logAudit("OTP_RATE_LIMITED", { req, meta: { email } });
      return jsonError("RATE_LIMITED", 429);
    }
    const code = String(crypto.randomInt(100000, 1000000));
    await kvSet(`otp:${email}`, JSON.stringify({ h: hashCode(code), tries: 0 }), 10 * 60 * 1000);
    const sent = await sendOtpEmail(email, code);
    await logAudit("OTP_SENT", { req, meta: { email, sent } });
    return jsonOk({ sent: true, ...(demo ? { demoCode: code } : {}) });
  }

  // ---------- register ----------
  if (action === "register") {
    if (!(await rateLimit(`register:${ip}`, 10, 60 * 60 * 1000))) return jsonError("RATE_LIMITED", 429);
    const body = await readJson(req);
    if (!body) return jsonError("MISSING_FIELDS", 400);
    const fullName = String(body.fullName ?? "").trim().slice(0, 120);
    const email = String(body.email ?? "").trim().toLowerCase();
    const phone = normalizePhone(String(body.phone ?? ""));
    const password = String(body.password ?? "");
    const dobRaw = String(body.dob ?? "");
    const gender = String(body.gender ?? "");
    const gov = String(body.gov ?? "").trim().slice(0, 80) || null;
    const city = String(body.city ?? "").trim().slice(0, 80) || null;
    const emergencyContact = String(body.emergencyContact ?? "").trim().slice(0, 40) || null;
    const otp = String(body.otp ?? "").trim();
    const consents = (body.consents ?? {}) as Record<string, unknown>;

    if (!fullName || fullName.length < 3 || fullName.length > 120) return jsonError("INVALID_NAME", 400);
    if (!emailValid(email)) return jsonError("INVALID_EMAIL", 400);
    if (!phone) return jsonError("INVALID_PHONE", 400);
    if (!isStrongPassword(password)) return jsonError("WEAK_PASSWORD", 400);
    if (gender !== "MALE" && gender !== "FEMALE") return jsonError("INVALID_GENDER", 400);
    const verifyEmail = emailVerificationRequired(); // EMAIL_VERIFICATION_REQUIRED — الافتراضي false
    if (verifyEmail && !otp) return jsonError("OTP_MISSING", 400);

    const dob = dobRaw ? new Date(dobRaw) : null;
    if (!dob || Number.isNaN(dob.getTime()) || dob.getTime() > Date.now() || dob.getTime() < new Date("1900-01-01").getTime()) {
      return jsonError("INVALID_DOB", 400);
    }

    if (verifyEmail) {
      const rec = await kvGet(`otp:${email}`);
      if (!rec) return jsonError("OTP_EXPIRED", 401);
      const parsed = JSON.parse(rec) as { h: string; tries: number };
      if (parsed.tries >= 5) {
        await kvDel(`otp:${email}`);
        return jsonError("OTP_EXPIRED", 429);
      }
      if (!codeMatches(otp, parsed.h)) {
        parsed.tries += 1;
        await kvSet(`otp:${email}`, JSON.stringify(parsed), 10 * 60 * 1000);
        return jsonError("OTP_INVALID", 401);
      }
    }

    for (const c of ["data", "ai", "doctor", "labShare"]) {
      if (consents[c] !== true) return jsonError("CONSENT_REQUIRED", 400);
    }

    try {
      const user = await db.$transaction(async (tx) => {
        const u = await tx.user.create({
          data: {
            email,
            phone,
            passwordHash: await (async () => {
              const salt = crypto.randomBytes(16).toString("hex");
              const key = await new Promise<Buffer>((res, rej) => crypto.scrypt(password, salt, 64, (e, k) => (e ? rej(e) : res(k))));
              return `${salt}:${key.toString("hex")}`;
            })(),
            fullName,
            role: "PATIENT",
            phoneVerifiedAt: new Date(),
            emailVerifiedAt: verifyEmail ? new Date() : null,
            patientProfile: { create: { dateOfBirth: dob, gender, gov, city, emergencyContact } },
            subscriptions: {
              create: { planKey: "FREE", status: "ACTIVE" },
            },
          },
        });
        const map: Record<string, string> = { data: "DATA_PROCESSING", ai: "AI_ANALYSIS", doctor: "DOCTOR_SHARE", notifications: "NOTIFICATIONS", labShare: "LAB_RESULT_SHARING", research: "RESEARCH" };
        for (const [k, type] of Object.entries(map)) {
          await tx.consent.create({ data: { userId: u.id, type: type as never, granted: consents[k] === true, source: "REGISTER" } });
        }
        return u;
      });
      if (verifyEmail) await kvDel(`otp:${email}`);
      await logAudit("REGISTER", { req, actorUserId: user.id, actorRole: "PATIENT" });
      const token = await setSessionCookie({ id: user.id, role: user.role, tokenVersion: user.tokenVersion, labId: user.labId });
      return jsonOk({ user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role }, ...(demo ? { sessionToken: token } : {}) });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("User_email_key")) return jsonError("EMAIL_EXISTS", 409);
      if (msg.includes("User_phone_key")) return jsonError("PHONE_EXISTS", 409);
      return jsonError("REGISTER_FAILED", 500);
    }
  }

  // ---------- login ----------
  if (action === "login") {
    const body = await readJson(req);
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");
    if (!email || !password) return jsonError("MISSING_FIELDS", 400);
    if (!(await rateLimit(`login:${email}:${ip}`, 8, 10 * 60 * 1000)) || !(await rateLimit(`login-ip:${ip}`, 30, 10 * 60 * 1000))) {
      await logAudit("LOGIN_RATE_LIMITED", { req, meta: { email } });
      return jsonError("RATE_LIMITED", 429);
    }
    const user = await db.user.findUnique({ where: { email } });
    const ok = user && user.isActive ? await verifyPassword(password, user.passwordHash) : await dummyPasswordVerify(password);
    if (!user || !ok || !user.isActive) {
      await logAudit("LOGIN_FAILED", { req, meta: { email } });
      return jsonError("INVALID_CREDENTIALS", 401);
    }
    if (await needsMfa(user.role, user.id)) {
      const code = String(crypto.randomInt(100000, 1000000));
      await kvSet(`mfa:${email}`, JSON.stringify({ h: hashCode(code), tries: 0 }), 10 * 60 * 1000);
      const sent = await sendMfaEmail(email, code);
      await logAudit("MFA_INITIATED", { req, actorUserId: user.id, actorRole: user.role, meta: { emailSent: sent } });
      return jsonOk({ mfaRequired: true, ...(demo ? { demoCode: code } : {}) });
    }
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await logAudit("LOGIN", { req, actorUserId: user.id, actorRole: user.role });
    const token = await setSessionCookie({ id: user.id, role: user.role, tokenVersion: user.tokenVersion, labId: user.labId });
    return jsonOk({ user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role, labId: user.labId }, ...(demo ? { sessionToken: token } : {}) });
  }

  // ---------- mfa-verify ----------
  if (action === "mfa-verify") {
    const body = await readJson(req);
    const email = String(body?.email ?? "").trim().toLowerCase();
    const code = String(body?.code ?? "").trim();
    if (!email || !code) return jsonError("MISSING_FIELDS", 400);
    if (!(await rateLimit(`mfa:${email}`, 5, 10 * 60 * 1000))) {
      await kvDel(`mfa:${email}`);
      await logAudit("MFA_LOCKED", { req, meta: { email } });
      return jsonError("MFA_EXPIRED", 429);
    }
    const user = await db.user.findUnique({ where: { email } });
    if (!user || !user.isActive) return jsonError("MFA_EXPIRED", 401);
    const rec = await kvGet(`mfa:${email}`);
    if (!rec) return jsonError("MFA_EXPIRED", 401);
    const parsed = JSON.parse(rec) as { h: string; tries: number };
    if (!codeMatches(code, parsed.h)) {
      parsed.tries += 1;
      await kvSet(`mfa:${email}`, JSON.stringify(parsed), 10 * 60 * 1000);
      return jsonError("MFA_INVALID", 401);
    }
    await kvDel(`mfa:${email}`);
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await logAudit("LOGIN_MFA", { req, actorUserId: user.id, actorRole: user.role });
    const token = await setSessionCookie({ id: user.id, role: user.role, tokenVersion: user.tokenVersion, labId: user.labId });
    return jsonOk({ user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role, labId: user.labId }, ...(demo ? { sessionToken: token } : {}) });
  }

  // ---------- logout ----------
  if (action === "logout") {
    const user = await getSessionUser();
    if (user) {
      await invalidateUserTokens(user.id);
      await logAudit("LOGOUT", { req, actorUserId: user.id, actorRole: user.role });
    }
    await clearSessionCookie();
    return jsonOk({ ok: true });
  }

  return jsonError("UNKNOWN_ACTION", 404);
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  if (action === "me") {
    const user = await getSessionUser();
    return jsonOk({ user });
  }
  return jsonError("UNKNOWN_ACTION", 404);
}

