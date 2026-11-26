import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireCapability } from "@/lib/permissions";
import { jsonError, jsonOk } from "@/lib/auth";
import { readJson } from "@/lib/api-utils";
import { assistantReply } from "@/lib/agents/assistant";
import { rateLimit } from "@/lib/rate-limit";

/** GET /api/assistant — تاريخ المحادثة */
export async function GET() {
  const user = await requireCapability("patient:self");
  if (user instanceof Response) return user;
  const messages = await db.chatMessage.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 40 });
  return jsonOk({ messages: messages.reverse() });
}

/** POST — سؤال المساعد (30 سؤالًا/10 دقائق) */
export async function POST(req: NextRequest) {
  const user = await requireCapability("patient:self");
  if (user instanceof Response) return user;
  if (!(await rateLimit(`assistant:${user.id}`, 30, 10 * 60 * 1000))) return jsonError("RATE_LIMITED", 429);
  const body = await readJson(req);
  const message = String(body?.message ?? "").trim().slice(0, 2000);
  if (!message) return jsonError("EMPTY_MESSAGE", 400);

  const history = await db.chatMessage.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 8 });
  try {
    const { reply, provider } = await assistantReply(user.id, message, history.reverse().map((h) => ({ role: h.role as "USER" | "ASSISTANT", content: h.content })));
    await db.chatMessage.create({ data: { userId: user.id, role: "USER", content: message } });
    await db.chatMessage.create({ data: { userId: user.id, role: "ASSISTANT", content: reply, meta: JSON.stringify({ provider }) } });
    return jsonOk({ reply, provider });
  } catch {
    return jsonError("AI_UNAVAILABLE", 503);
  }
}

/** DELETE — مسح المحادثة */
export async function DELETE() {
  const user = await requireCapability("patient:self");
  if (user instanceof Response) return user;
  await db.chatMessage.deleteMany({ where: { userId: user.id } });
  return jsonOk({ ok: true });
}
