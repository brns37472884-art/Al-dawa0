import { notifyAdmins } from "@/lib/notifications/admin";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireCapability } from "@/lib/permissions";
import { jsonOk, jsonError } from "@/lib/auth";
import { logAudit } from "@/lib/api-utils";
import { detectRealType } from "@/lib/files";
import { rateLimit } from "@/lib/rate-limit";
import { getSetting } from "@/lib/settings";

/**
 * الدفع اليدوي للباقات:
 *   GET  /api/payments/requests — طلبات العميل + بيانات الدفع + اشتراكه الحالي
 *   POST /api/payments/requests — (multipart) planKey + method + senderRef + file (صورة/PDF الإيصال)
 * الإدارة تراجع الطلب وتفعّل الاشتراك من /api/admin/payment-requests.
 */

const PAYMENT_METHODS = ["CASH", "INSTAPAY", "BANK_TRANSFER"] as const;
const PROOF_MAX_SIZE = 5 * 1024 * 1024; // 5MB
const PROOF_MIME: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg" };

export async function GET() {
  const user = await requireCapability("patient:self");
  if (user instanceof Response) return user;

  // بدون proofData عمدًا — الصورة تُجلب من مسار منفصل
  const requests = await db.paymentRequest.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, planKey: true, amountEgp: true, method: true, senderRef: true, status: true, reviewNote: true, createdAt: true, reviewedAt: true },
  });
  const sub = await db.subscription.findFirst({
    where: { userId: user.id, status: "ACTIVE" },
    orderBy: { startedAt: "desc" },
    select: { planKey: true, expiresAt: true },
  });
  const [cash, instapay, bank] = await Promise.all([getSetting("PAY_CASH_INFO"), getSetting("PAY_INSTAPAY_INFO"), getSetting("PAY_BANK_INFO")]);
  return jsonOk({ requests, subscription: sub, info: { CASH: cash, INSTAPAY: instapay, BANK_TRANSFER: bank } });
}

export async function POST(req: NextRequest) {
  const user = await requireCapability("patient:self");
  if (user instanceof Response) return user;
  if (!(await rateLimit(`payreq:${user.id}`, 5, 60 * 60 * 1000))) return jsonError("RATE_LIMITED", 429);

  const form = await req.formData().catch(() => null);
  if (!form) return jsonError("INVALID_FORM", 400);

  const planKey = String(form.get("planKey") ?? "");
  const method = String(form.get("method") ?? "");
  const senderRef = String(form.get("senderRef") ?? "").trim().slice(0, 120) || null;
  if (!(PAYMENT_METHODS as readonly string[]).includes(method)) return jsonError("INVALID_METHOD", 400);

  const plan = await db.plan.findUnique({ where: { key: planKey } });
  if (!plan || !plan.isActive || plan.priceEgp <= 0) return jsonError("INVALID_PLAN", 400);

  const pending = await db.paymentRequest.count({ where: { userId: user.id, status: "PENDING" } });
  if (pending > 0) return jsonError("PENDING_EXISTS", 409);

  const file = form.get("file");
  if (!file || !(file instanceof File)) return jsonError("NO_FILE", 400);
  if (file.size > PROOF_MAX_SIZE) return jsonError("FILE_TOO_LARGE", 400, { maxMB: 5 });
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length === 0) return jsonError("EMPTY_FILE", 400);
  // نوع الملف الحقيقي من بصمة المحتوى — لا يُعتمد على الامتداد ولا على MIME القادم من المتصفح
  const real = detectRealType(buffer);
  if (!real) return jsonError("UNSUPPORTED_FORMAT", 400, { allowed: ["pdf", "jpg", "png"] });

  const created = await db.paymentRequest.create({
    data: {
      userId: user.id,
      planKey: plan.key,
      amountEgp: plan.priceEgp,
      method,
      senderRef,
      proofData: new Uint8Array(buffer),
      proofMime: PROOF_MIME[real],
      proofSize: buffer.length,
    },
    select: { id: true },
  });
  await logAudit("PAYMENT_REQUEST_CREATE", { req, actorUserId: user.id, actorRole: user.role, entityType: "PaymentRequest", entityId: created.id, meta: { planKey: plan.key, method } });
  await notifyAdmins({
    titleAr: "طلب دفع جديد", titleEn: "New payment request",
    bodyAr: `طلب اشتراك ${plan.key} بانتظار المراجعة في تبويب طلبات الدفع.`,
    bodyEn: `A ${plan.key} subscription request awaits review in Payment requests.`,
    severity: "WARNING", link: "/admin",
  });
  return jsonOk({ id: created.id, status: "PENDING" }, 201);
}
