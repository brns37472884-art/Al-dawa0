import { db } from "@/lib/db";
import { isProdEnv } from "@/env";

/** GET /api/health — للإدارة: حالة العملية والمزود */
export async function GET() {
  let aiProvider = "builtin";
  if (process.env.EXTERNAL_AI_ENABLED === "true" && process.env.EXTERNAL_AI_API_KEY) {
    aiProvider = "external+builtin";
  }
  return Response.json({
    ok: true,
    env: isProdEnv() ? "production" : "development",
    aiProvider,
    uptimeSec: Math.floor(process.uptime()),
  });
}

void db;
