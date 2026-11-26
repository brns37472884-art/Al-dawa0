import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { readJson } from "@/lib/api-utils";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { isValidEmail } from "@/lib/helpers";

/** POST /api/contact — حفظ رسالة تواصل + rate-limit */
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (!(await rateLimit(`contact:${ip}`, 5, 60 * 60 * 1000))) {
    return Response.json({ error: "RATE_LIMITED" }, { status: 429 });
  }
  const body = await readJson(req);
  if (!body) return Response.json({ error: "INVALID_BODY" }, { status: 400 });
  const name = String(body.name ?? "").trim().slice(0, 120);
  const email = String(body.email ?? "").trim().slice(0, 200);
  const subject = String(body.subject ?? "").trim().slice(0, 150);
  const message = String(body.message ?? "").trim().slice(0, 4000);
  if (name.length < 3 || !isValidEmail(email) || message.length < 5) {
    return Response.json({ error: "INVALID_FIELDS" }, { status: 400 });
  }
  await db.contactMessage.create({ data: { name, email, subject, message } });
  return Response.json({ ok: true }, { status: 201 });
}
