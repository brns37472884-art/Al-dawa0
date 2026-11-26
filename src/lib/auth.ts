import crypto from "crypto";
import { cookies, headers } from "next/headers";
import { db } from "@/lib/db";
import { getEnv, isProdEnv } from "@/env";

/**
 * المصادقة — JWT في كوكي httpOnly/Secure/SameSite + scrypt async + tokenVersion.
 * tokenVersion: أي تعليق حساب/تغيير دور/خروج يزيده فورًا → كل الرموز القديمة تُرفض.
 */

export const SESSION_COOKIE = "aldawa_session";
const SESSION_TTL = 60 * 60 * 24 * 7; // أسبوع

function getSecret(): string {
  const env = getEnv(); // env.ts يفشل مبكرًا لو JWT_SECRET ناقص 32+
  return env.JWT_SECRET;
}

// hash وهمي ثابت لمساواة زمن التحقق عند عدم وجود المستخدم (منع تعداد الحسابات)
const DUMMY_HASH = "b9c4a1d0e3f24a5b8677c2d1e0f3a4b5:" + "a".repeat(128);

// ---------- كلمات المرور (scrypt async — لا يحجب event loop) ----------
const scryptAsync = (pw: string, salt: string, keylen: number) =>
  new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(pw, salt, keylen, (err, key) => (err ? reject(err) : resolve(key)));
  });

export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = (await scryptAsync(pw, salt, 64)).toString("hex");
  return `${salt}:${hash}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  try {
    const [salt, hash] = stored.split(":");
    if (!salt || !hash) return false;
    const check = await scryptAsync(pw, salt, 64);
    const expected = Buffer.from(hash, "hex");
    if (check.length !== expected.length) return false;
    return crypto.timingSafeEqual(check, expected);
  } catch {
    return false;
  }
}

export async function dummyPasswordVerify(pw: string): Promise<boolean> {
  return verifyPassword(pw, DUMMY_HASH);
}

// ---------- JWT (HMAC-SHA256) ----------
function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

export interface JwtPayload {
  sub: string;
  role: string;
  tv: number; // tokenVersion
  labId?: string | null;
  iat: number;
  exp: number;
}

export function signJWT(payload: { sub: string; role: string; tv: number; labId?: string | null }, ttlSec = SESSION_TTL): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(JSON.stringify({ ...payload, iat: now, exp: now + ttlSec }));
  const sig = crypto.createHmac("sha256", getSecret()).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

export function verifyJWT(token: string): JwtPayload | null {
  try {
    const secret = getSecret();
    const [h, p, sig] = token.split(".");
    if (!h || !p || !sig) return null;
    const expected = crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf-8")) as JwtPayload;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------- Session ----------
export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  labId: string | null;
  locale: string;
}

async function userFromToken(token: string): Promise<SessionUser | null> {
  const payload = verifyJWT(token);
  if (!payload || typeof payload.sub !== "string") return null;
  const user = await db.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.isActive) return null;
  // إبطال فوري: tokenVersion في الرمز لا يطابق الحساب → رمز قديم بعد تعليق/خروج
  if (payload.tv !== user.tokenVersion) return null;
  return { id: user.id, email: user.email, fullName: user.fullName, role: user.role, labId: user.labId, locale: user.locale };
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const cookieToken = store.get(SESSION_COOKIE)?.value;
  if (cookieToken) {
    const fromCookie = await userFromToken(cookieToken);
    if (fromCookie) return fromCookie;
  }
  const h = await headers();
  const auth = h.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    return userFromToken(auth.slice(7).trim());
  }
  return null;
}

export async function setSessionCookie(user: { id: string; role: string; tokenVersion: number; labId: string | null }): Promise<string> {
  const token = signJWT({ sub: user.id, role: user.role, tv: user.tokenVersion, labId: user.labId });
  const store = await cookies();
  const cookieMode = process.env.COOKIE_SECURE;
  const httpsMode =
    cookieMode === "true" ? true : cookieMode === "false" ? false : isProdEnv();
  // SameSite قابل للضبط (COOKIE_SAMESITE=lax|none|strict) — الافتراضي lax
  // إلا لو ALLOWED_FRAME_ANCESTORS مضبوط (تضمين iframe خارجي → none)، وNone يتطلب Secure
  const rawSame = (process.env.COOKIE_SAMESITE || (process.env.ALLOWED_FRAME_ANCESTORS?.trim() ? "none" : "lax")).toLowerCase();
  const samesite = rawSame === "strict" ? ("strict" as const) : rawSame === "none" ? ("none" as const) : ("lax" as const);
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: samesite,
    secure: samesite === "none" ? true : httpsMode,
    maxAge: SESSION_TTL,
    path: "/",
  });
  return token;
}

/** إبطال كل الرموز الصادرة — يُستدعى عند الخروج وتعليق الحساب وتغيير الدور وتسحب الجلسات */
export async function invalidateUserTokens(userId: string): Promise<void> {
  await db.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { httpOnly: true, maxAge: 0, path: "/" });
}

// ---------- Standard responses ----------
export function jsonOk(data: unknown, status = 200) {
  return Response.json(data as Record<string, unknown>, { status });
}

export function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return Response.json({ error: message, ...extra }, { status });
}
