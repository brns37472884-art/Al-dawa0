import nodemailer from "nodemailer";
import { getEnv } from "@/env";
import { maskPhone } from "@/lib/helpers";

/**
 * البريد عبر nodemailer — OTP وتنبيهات MFA.
 * قاعدة صارمة: لا قيمة طبية ولا بيانات تعريف في أي رسالة بريد.
 * بلا SMTP_* في .env: وضع وهمي يسجل في اللوج (رقم مقنّع/بريد مقنّع).
 */

interface TransporterLike {
  sendMail(opts: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
}

let cached: TransporterLike | null = null;
let cachedKey = "";

function getTransporter(): TransporterLike | null {
  const env = getEnv();
  if (!env.SMTP_HOST) return null; // وضع وهمي
  const key = `${env.SMTP_HOST}:${env.SMTP_PORT}:${env.SMTP_USER}`;
  if (cached && cachedKey === key) return cached;
  const port = Number(env.SMTP_PORT || 587);
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS || "" } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  cached = transport as unknown as TransporterLike;
  cachedKey = key;
  return cached;
}

function maskEmail(e: string): string {
  const [name, domain] = e.split("@");
  if (!domain) return "***";
  const shown = name.slice(0, 2);
  return `${shown}${"*".repeat(Math.max(1, name.length - 2))}@${domain}`;
}

export async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  try {
    const t = getTransporter();
    if (!t) {
      console.log(`[EMAIL:mock] to=${maskEmail(to)} :: ${subject}`);
      return true;
    }
    const env = getEnv();
    const from = env.EMAIL_FROM || `Al Dawa <no-reply@${env.SMTP_HOST}>`;
    await t.sendMail({ from, to, subject, text });
    return true;
  } catch (e) {
    console.error(`[EMAIL] فشل الإرسال إلى ${maskEmail(to)}: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

const TTL_AR = "الرمز صالح لمدة 10 دقائق ولا يُشارك مع أي شخص.";
const TTL_EN = "The code is valid for 10 minutes and should never be shared.";

export async function sendOtpEmail(to: string, code: string): Promise<boolean> {
  return sendEmail(
    to,
    "الدواء | رمز التحقق",
    `رمز التحقق: ${code}\n${TTL_AR}\n\nAl Dawa | Verification code: ${code}\n${TTL_EN}`
  );
}

export async function sendMfaEmail(to: string, code: string): Promise<boolean> {
  return sendEmail(
    to,
    "الدواء | رمز التحقق بخطوتين",
    `رمز التحقق بخطوتين: ${code}\n${TTL_AR}\n\nAl Dawa | Two-step verification code: ${code}\n${TTL_EN}`
  );
}

export { maskPhone };
