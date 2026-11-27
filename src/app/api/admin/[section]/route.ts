import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireCapability } from "@/lib/permissions";
import { jsonError, jsonOk } from "@/lib/auth";
import { readJson, logAudit } from "@/lib/api-utils";
import { invalidateUserTokens } from "@/lib/auth";
import { hashPassword } from "@/lib/auth";
import { getAllSettings, setSetting, SETTING_DEFAULTS } from "@/lib/settings";
import { isStrongPassword, isValidEmail, normalizePhone } from "@/lib/helpers";

/**
 * GET/POST /api/admin/[section] — الإدارة أرقام مجمعة فقط.
 * لا تُعرض هنا نتائج مرضى ولا آراء أطباء إطلاقًا.
 */

const SECTIONS = ["stats", "users", "doctors", "labs", "markaz", "plans", "payments", "payment-requests", "settings", "audit", "contact", "protocols", "rules", "alerts", "network", "broadcast"] as const;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ section: string }> }) {
  const user = await requireCapability("admin:manage");
  if (user instanceof Response) return user;
  const { section } = await ctx.params;
  if (!SECTIONS.includes(section as never)) return jsonError("UNKNOWN_SECTION", 404);

  if (section === "stats") {
    const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const [users, activeUsers, subscribers, revenue, reports, pendingReviews, openAlerts, failedReports, securityEvents, activeLabs] = await Promise.all([
      db.user.count(),
      db.user.count({ where: { lastLoginAt: { gte: monthAgo } } }),
      db.subscription.count({ where: { planKey: { in: ["PLUS", "FAMILY"] }, status: "ACTIVE" } }),
      db.payment.aggregate({ _sum: { amount: true } }),
      db.medicalReport.count(),
      db.doctorReview.count({ where: { status: { in: ["PENDING", "IN_REVIEW", "NEEDS_INFO"] } } }),
      db.criticalAlert.count({ where: { status: "OPEN" } }),
      db.medicalReport.count({ where: { status: "FAILED" } }),
      db.auditLog.count({ where: { action: { in: ["LOGIN_FAILED", "LOGIN_RATE_LIMITED", "OTP_RATE_LIMITED", "ROLE_CHANGE", "CLAIM_TOKEN_MISMATCH"] }, createdAt: { gte: weekAgo } } }),
      db.lab.count({ where: { isActive: true } }),
    ]);
    return jsonOk({
      users, activeUsers, subscribers,
      revenue: revenue._sum.amount ?? 0,
      reports, pendingReviews, openAlerts, failedReports, securityEvents, activeLabs,
    });
  }

  if (section === "users") {
    const users = await db.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, email: true, fullName: true, role: true, isActive: true, lastLoginAt: true, createdAt: true, labId: true, locale: true },
    });
    return jsonOk({ users });
  }

  if (section === "doctors") {
    const doctors = await db.user.findMany({
      where: { role: "DOCTOR" },
      orderBy: { createdAt: "desc" },
      include: { doctorProfile: { select: { specialty: true, licenseNumber: true, isVerified: true, bio: true } } },
      take: 100,
    });
    return jsonOk({
      doctors: doctors.map((d) => ({ id: d.id, email: d.email, fullName: d.fullName, isActive: d.isActive, specialty: d.doctorProfile?.specialty ?? null, licenseNumber: d.doctorProfile?.licenseNumber ?? null, isVerified: d.doctorProfile?.isVerified ?? false })),
    });
  }

  if (section === "labs") {
    const labs = await db.lab.findMany({
      orderBy: { createdAt: "asc" },
      include: { markaz: { select: { name: true } }, staff: { select: { id: true, email: true, fullName: true, role: true } } },
    });
    const stats = await Promise.all(
      labs.map(async (l) => {
        const [uploads, pending, corrections] = await Promise.all([
          db.medicalReport.count({ where: { labId: l.id, source: "LAB_DIRECT" } }),
          db.pendingLabResult.count({ where: { labId: l.id, status: "PENDING" } }),
          db.reportCorrection.count({ where: { labId: l.id, status: "OPEN" } }),
        ]);
        return { id: l.id, uploads, pending, corrections };
      })
    );
    return jsonOk({
      labs: labs.map((l) => ({
        id: l.id, name: l.name, licenseNumber: l.licenseNumber, markazName: l.markaz?.name ?? null,
        contactName: l.contactName, contactPhone: l.contactPhone, address: l.address,
        isVerified: l.isVerified, isActive: l.isActive, pricingModel: l.pricingModel, pricePerResult: l.pricePerResult, commissionPct: l.commissionPct,
        staff: l.staff,
        stats: stats.find((s) => s.id === l.id),
      })),
      markazList: await db.markaz.findMany({ orderBy: { name: "asc" } }),
    });
  }

  if (section === "markaz") {
    const markaz = await db.markaz.findMany({ orderBy: { name: "asc" }, include: { labs: { select: { id: true, name: true } } } });
    return jsonOk({ markaz });
  }

  if (section === "plans") {
    const plans = await db.plan.findMany({ orderBy: { sortOrder: "asc" } });
    return jsonOk({
      plans: plans.map((p) => ({ ...p, featuresAr: JSON.parse(p.featuresAr) as string[], featuresEn: JSON.parse(p.featuresEn) as string[] })),
    });
  }

  if (section === "payments") {
    const payments = await db.payment.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { user: { select: { email: true, fullName: true } } },
    });
    return jsonOk({
      payments: payments.map((p) => ({ id: p.id, amount: p.amount, planKey: p.planKey, method: p.method, note: p.note, createdAt: p.createdAt, userEmail: p.user.email, userName: p.user.fullName })),
    });
  }

  if (section === "payment-requests") {
    // بدون proofData — الصورة تُجلب من /api/payments/requests/[id]/proof
    const rows = await db.paymentRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true, planKey: true, amountEgp: true, method: true, senderRef: true, proofMime: true, proofSize: true,
        status: true, reviewNote: true, createdAt: true, reviewedAt: true,
        user: { select: { email: true, fullName: true, phone: true } },
      },
    });
    rows.sort((a, b) => Number(b.status === "PENDING") - Number(a.status === "PENDING")); // المعلّقة أولًا (الفرز ثابت)
    return jsonOk({
      pendingCount: rows.filter((r) => r.status === "PENDING").length,
      requests: rows.map((r) => ({
        id: r.id, planKey: r.planKey, amountEgp: r.amountEgp, method: r.method, senderRef: r.senderRef, proofMime: r.proofMime, proofSize: r.proofSize,
        status: r.status, reviewNote: r.reviewNote, createdAt: r.createdAt, reviewedAt: r.reviewedAt,
        userName: r.user.fullName, userEmail: r.user.email, userPhone: r.user.phone,
      })),
    });
  }

  if (section === "settings") {
    return jsonOk({ settings: await getAllSettings() });
  }

  if (section === "audit") {
    const logs = await db.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { actor: { select: { fullName: true, email: true } } },
    });
    return jsonOk({
      logs: logs.map((l) => ({ id: l.id, action: l.action, actorName: l.actor?.fullName ?? null, actorRole: l.actorRole, entityType: l.entityType, entityId: l.entityId, ip: l.ip, createdAt: l.createdAt })),
    });
  }

  if (section === "contact") {
    const messages = await db.contactMessage.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
    return jsonOk({ messages });
  }

  if (section === "protocols") {
    const protocols = await db.screeningProtocol.findMany({
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      select: { id: true, key: true, titleAr: true, titleEn: true, category: true, minAge: true, maxAge: true, sourceOrg: true, guidelineVersion: true, guidelineDate: true, status: true, active: true, version: true, updatedAt: true },
    });
    return jsonOk({ protocols });
  }

  if (section === "rules") {
    const rules = await db.criticalRule.findMany({ orderBy: { key: "asc" } });
    return jsonOk({ rules });
  }

  if (section === "alerts") {
    const [count, byDay] = await Promise.all([
      db.criticalAlert.count({ where: { status: "OPEN" } }),
      db.$queryRaw<Array<{ day: string; n: bigint }>>`
        SELECT to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(*) AS n
        FROM critical_alerts WHERE "createdAt" > now() - interval '30 days'
        GROUP BY 1 ORDER BY 1 DESC LIMIT 30`,
    ]).catch(() => [0, [] as Array<{ day: string; n: bigint }>]);
    return jsonOk({ openCount: count, byDay });
  }

  if (section === "network") {
    const labs = await db.lab.findMany({ include: { markaz: { select: { name: true } } } });
    const rows = await Promise.all(
      labs.map(async (l) => {
        const [uploads, opened, corrections, critical, pending] = await Promise.all([
          db.medicalReport.count({ where: { labId: l.id, source: "LAB_DIRECT" } }),
          db.medicalReport.count({ where: { labId: l.id, source: "LAB_DIRECT", patientOpenedAt: { not: null } } }),
          db.reportCorrection.count({ where: { labId: l.id } }),
          db.medicalReport.count({ where: { labId: l.id, source: "LAB_DIRECT", values: { some: { flag: { startsWith: "CRITICAL" } } } } }),
          db.pendingLabResult.count({ where: { labId: l.id, status: "PENDING" } }),
        ]);
        return {
          id: l.id, name: l.name, markazName: l.markaz?.name ?? null, isActive: l.isActive, isVerified: l.isVerified,
          uploads, openedPct: uploads ? Math.round((opened / uploads) * 100) : 0,
          correctionPct: uploads ? Math.round((corrections / uploads) * 100) : 0,
          critical, pending,
        };
      })
    );
    return jsonOk({ labs: rows });
  }

  return jsonError("UNKNOWN_SECTION", 404);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ section: string }> }) {
  const user = await requireCapability("admin:manage");
  if (user instanceof Response) return user;
  const { section } = await ctx.params;
  const body = await readJson(req);
  const op = String(body?.op ?? "");
  if (!SECTIONS.includes(section as never)) return jsonError("UNKNOWN_SECTION", 404);
  if (!body) return jsonError("INVALID_BODY", 400);

  // ---------- users: تفعيل/تعليق فوري (tokenVersion) ----------
  if (section === "users" && op === "toggle-active") {
    const id = String(body.id ?? "");
    if (id === user.id) return jsonError("CANNOT_DEACTIVATE_SELF", 400);
    const target = await db.user.findUnique({ where: { id } });
    if (!target) return jsonError("NOT_FOUND", 404);
    const newActive = !target.isActive;
    await db.user.update({ where: { id }, data: { isActive: newActive } });
    // التعليق يقطع كل جلسات الحساب فورًا (tokenVersion) — إيقاف حساب = قطع جلساته
    if (!newActive) await invalidateUserTokens(id);
    await logAudit(newActive ? "USER_ACTIVATE" : "USER_DEACTIVATE", { req, actorUserId: user.id, actorRole: user.role, entityType: "User", entityId: id });
    return jsonOk({ ok: true, isActive: newActive });
  }

  // ---------- users: إنشاء حساب دكتور / مسؤول طبي (لا يوجد تسجيل ذاتي لهذه الأدوار) ----------
  if (section === "users" && op === "create-user") {
    const role = String(body.role ?? "");
    if (role !== "DOCTOR" && role !== "MEDICAL_OFFICER") return jsonError("INVALID_ROLE", 400);
    const email = String(body.email ?? "").trim().toLowerCase();
    const fullName = String(body.fullName ?? "").trim().slice(0, 120);
    const password = String(body.password ?? "");
    const specialty = String(body.specialty ?? "").trim().slice(0, 120);
    const licenseNumber = String(body.licenseNumber ?? "").trim().slice(0, 80);
    if (!isValidEmail(email)) return jsonError("INVALID_EMAIL", 400);
    if (fullName.length < 3) return jsonError("INVALID_NAME", 400);
    if (!isStrongPassword(password)) return jsonError("WEAK_PASSWORD", 400);
    if (role === "DOCTOR" && (!specialty || !licenseNumber)) return jsonError("MISSING_FIELDS", 400);
    if (await db.user.findUnique({ where: { email } })) return jsonError("EMAIL_EXISTS", 409);
    const created = await db.user.create({
      data: {
        email,
        fullName,
        role: role as never,
        passwordHash: await hashPassword(password),
        ...(role === "DOCTOR" ? { doctorProfile: { create: { specialty, licenseNumber, isVerified: true } } } : {}),
      },
      select: { id: true },
    });
    await logAudit("USER_CREATE", { req, actorUserId: user.id, actorRole: user.role, entityType: "User", entityId: created.id, meta: { role } });
    return jsonOk({ id: created.id }, 201);
  }

  // ---------- doctors: توثيق ----------
  if (section === "doctors" && op === "toggle-verify") {
    const id = String(body.id ?? "");
    const profile = await db.doctorProfile.findUnique({ where: { userId: id } });
    if (!profile) return jsonError("NOT_FOUND", 404);
    await db.doctorProfile.update({ where: { userId: id }, data: { isVerified: !profile.isVerified } });
    await logAudit("DOCTOR_VERIFY", { req, actorUserId: user.id, actorRole: user.role, entityType: "DoctorProfile", entityId: id, meta: { verified: !profile.isVerified } });
    return jsonOk({ ok: true, isVerified: !profile.isVerified });
  }

  // ---------- labs: إنشاء/توثيق/تفعيل/موظفين/مشرف ----------
  if (section === "labs") {
    if (op === "create") {
      const name = String(body.name ?? "").trim().slice(0, 150);
      const markazId = String(body.markazId ?? "") || null;
      if (name.length < 3) return jsonError("INVALID_NAME", 400);
      const lab = await db.lab.create({
        data: {
          name,
          licenseNumber: String(body.licenseNumber ?? "").trim().slice(0, 80) || null,
          markazId,
          contactName: String(body.contactName ?? "").trim().slice(0, 120) || null,
          contactPhone: normalizePhone(String(body.contactPhone ?? "")) || null,
          address: String(body.address ?? "").trim().slice(0, 200) || null,
        },
      });
      await logAudit("LAB_CREATE", { req, actorUserId: user.id, actorRole: user.role, entityType: "Lab", entityId: lab.id });
      return jsonOk({ id: lab.id }, 201);
    }
    if (op === "toggle-verify" || op === "toggle-active") {
      const id = String(body.id ?? "");
      const lab = await db.lab.findUnique({ where: { id } });
      if (!lab) return jsonError("NOT_FOUND", 404);
      if (op === "toggle-verify") {
        await db.lab.update({ where: { id }, data: { isVerified: !lab.isVerified } });
      } else {
        // تفعيل معمل يتطلب توثيقًا أولًا
        if (!lab.isVerified && !lab.isActive) return jsonError("VERIFY_FIRST", 409);
        await db.lab.update({ where: { id }, data: { isActive: !lab.isActive } });
      }
      await logAudit(op === "toggle-verify" ? "LAB_VERIFY" : "LAB_TOGGLE_ACTIVE", { req, actorUserId: user.id, actorRole: user.role, entityType: "Lab", entityId: id });
      return jsonOk({ ok: true });
    }
    if (op === "add-staff" || op === "add-supervisor") {
      const id = String(body.id ?? "");
      const email = String(body.email ?? "").trim().toLowerCase();
      const fullName = String(body.fullName ?? "").trim().slice(0, 120);
      const password = String(body.password ?? "");
      if (!email || fullName.length < 3 || !isStrongPassword(password)) return jsonError("WEAK_PASSWORD", 400);
      const exists = await db.user.findUnique({ where: { email } });
      if (exists) return jsonError("EMAIL_EXISTS", 409);
      const role = op === "add-supervisor" ? "LAB_SUPERVISOR" : "LAB";
      const staff = await db.user.create({
        data: { email, fullName, role: role as never, labId: id, passwordHash: await hashPassword(password) },
      });
      await logAudit(op === "add-supervisor" ? "LAB_SUPERVISOR_CREATE" : "LAB_STAFF_CREATE", { req, actorUserId: user.id, actorRole: user.role, entityType: "User", entityId: staff.id, meta: { labId: id } });
      return jsonOk({ id: staff.id }, 201);
    }
    if (op === "update-pricing") {
      const id = String(body.id ?? "");
      const pricingModel = String(body.pricingModel ?? "NONE");
      if (!["NONE", "PER_RESULT", "COMMISSION"].includes(pricingModel)) return jsonError("INVALID_PRICING", 400);
      await db.lab.update({
        where: { id },
        data: {
          pricingModel,
          pricePerResult: body.pricePerResult != null ? Number(body.pricePerResult) : null,
          commissionPct: body.commissionPct != null ? Number(body.commissionPct) : null,
        },
      });
      await logAudit("LAB_PRICING_UPDATE", { req, actorUserId: user.id, actorRole: user.role, entityType: "Lab", entityId: id });
      return jsonOk({ ok: true });
    }
  }

  // ---------- markaz: تعديل اسم (استبدال الأسماء المؤقتة) ----------
  if (section === "markaz" && op === "rename") {
    const id = String(body.id ?? "");
    const name = String(body.name ?? "").trim().slice(0, 150);
    if (name.length < 2) return jsonError("INVALID_NAME", 400);
    await db.markaz.update({ where: { id }, data: { name } });
    await logAudit("MARKAZ_RENAME", { req, actorUserId: user.id, actorRole: user.role, entityType: "Markaz", entityId: id });
    return jsonOk({ ok: true });
  }

  // ---------- plans ----------
  if (section === "plans" && op === "update") {
    const key = String(body.key ?? "");
    const data: Record<string, unknown> = {};
    if (body.priceEgp !== undefined) {
      const n = Number(body.priceEgp);
      if (!Number.isFinite(n) || n < 0) return jsonError("INVALID_NUMBER", 400);
      data.priceEgp = n;
    }
    if (body.reportsLimit !== undefined) {
      const n = Number(body.reportsLimit);
      if (!Number.isInteger(n) || n < -1 || n > 10000) return jsonError("INVALID_NUMBER", 400);
      data.reportsLimit = n;
    }
    if (body.isActive !== undefined) data.isActive = body.isActive === true;
    await db.plan.update({ where: { key }, data });
    await logAudit("PLAN_UPDATE", { req, actorUserId: user.id, actorRole: user.role, entityType: "Plan", entityId: key });
    return jsonOk({ ok: true });
  }

  // ---------- payments: تسجيل يدوي بلا بوابة دفع ----------
  if (section === "payments" && op === "add-manual") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const amount = Number(body.amount);
    const planKey = ["FREE", "PLUS", "FAMILY"].includes(String(body.planKey ?? "")) ? String(body.planKey) : null;
    const target = await db.user.findUnique({ where: { email } });
    if (!target) return jsonError("USER_NOT_FOUND", 404);
    if (!Number.isFinite(amount) || amount <= 0) return jsonError("INVALID_NUMBER", 400);
    await db.$transaction(async (tx) => {
      await tx.payment.create({ data: { userId: target.id, amount, planKey, method: "MANUAL", note: String(body.note ?? "").trim().slice(0, 300) || null } });
      if (planKey && planKey !== "FREE") {
        await tx.subscription.updateMany({ where: { userId: target.id, status: "ACTIVE" }, data: { status: "CANCELLED" } });
        await tx.subscription.create({ data: { userId: target.id, planKey, status: "ACTIVE", expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000) } });
      }
    });
    await logAudit("PAYMENT_MANUAL", { req, actorUserId: user.id, actorRole: user.role, entityType: "Payment", entityId: target.id, meta: { amount, planKey } });
    return jsonOk({ ok: true }, 201);
  }

  // ---------- payment-requests: مراجعة إيصالات الدفع اليدوي ----------
  if (section === "payment-requests" && op === "review") {
    const id = String(body.id ?? "");
    const decision = String(body.decision ?? "");
    if (decision !== "APPROVE" && decision !== "REJECT") return jsonError("INVALID_VALUE", 400);
    const note = String(body.note ?? "").trim().slice(0, 300) || null;
    const row = await db.paymentRequest.findUnique({ where: { id }, select: { id: true, userId: true, planKey: true, amountEgp: true, method: true } });
    if (!row) return jsonError("NOT_FOUND", 404);
    const approve = decision === "APPROVE";
    const done = await db.$transaction(async (tx) => {
      // حجز الطلب ذريًا: لا يُراجَع مرتين لو ضغط مديران في نفس اللحظة
      const claimed = await tx.paymentRequest.updateMany({
        where: { id, status: "PENDING" },
        data: { status: approve ? "APPROVED" : "REJECTED", reviewNote: note, reviewedById: user.id, reviewedAt: new Date() },
      });
      if (claimed.count !== 1) return false;
      if (approve) {
        const payment = await tx.payment.create({
          data: { userId: row.userId, amount: row.amountEgp, planKey: row.planKey, method: row.method, status: "PAID", note: `طلب دفع يدوي ${row.id}` },
        });
        await tx.subscription.updateMany({ where: { userId: row.userId, status: "ACTIVE" }, data: { status: "CANCELLED" } });
        await tx.subscription.create({ data: { userId: row.userId, planKey: row.planKey, status: "ACTIVE", expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000) } });
        await tx.paymentRequest.update({ where: { id }, data: { paymentId: payment.id } });
      }
      await tx.notification.create({
        data: {
          userId: row.userId,
          type: approve ? "PAYMENT_APPROVED" : "PAYMENT_REJECTED",
          titleAr: approve ? "تم تفعيل اشتراكك" : "تعذّر قبول إيصال الدفع",
          titleEn: approve ? "Your subscription is active" : "Payment receipt was not accepted",
          bodyAr: approve ? "تمت مراجعة إيصال الدفع وتفعيل باقتك لمدة 30 يومًا." : `لم نتمكن من قبول إيصال الدفع.${note ? ` السبب: ${note}` : ""} يمكنك إرسال إيصال جديد.`,
          bodyEn: approve ? "Your payment receipt was reviewed and your plan is active for 30 days." : `We could not accept the receipt.${note ? ` Reason: ${note}` : ""} You can submit a new one.`,
          severity: approve ? "INFO" : "WARNING",
          link: "/app/subscription",
        },
      });
      return true;
    });
    if (!done) return jsonError("ALREADY_REVIEWED", 409);
    await logAudit(approve ? "PAYMENT_REQUEST_APPROVE" : "PAYMENT_REQUEST_REJECT", { req, actorUserId: user.id, actorRole: user.role, entityType: "PaymentRequest", entityId: id, meta: { planKey: row.planKey, amount: row.amountEgp } });
    return jsonOk({ ok: true });
  }

  // ---------- settings ----------
  if (section === "settings" && op === "update") {
    const key = String(body.key ?? "");
    const value = String(body.value ?? "").trim().slice(0, String(body.key ?? "").startsWith("PAY_") ? 300 : 60);
    if (!(key in SETTING_DEFAULTS)) return jsonError("UNKNOWN_SETTING", 400);
    const numericKeys = ["DOCTOR_SLA_HOURS", "LAB_SLA_HOURS", "PENDING_CLAIM_EXPIRY_DAYS", "LAB_DAILY_UPLOAD_LIMIT"];
    const boolKeys = ["ALLOW_PATIENT_UPLOAD", "LAB_RESULTS_EXEMPT_FROM_LIMIT"];
    if (numericKeys.includes(key) && !/^\d{1,4}$/.test(value)) return jsonError("INVALID_VALUE", 400);
    if (boolKeys.includes(key) && !["true", "false"].includes(value)) return jsonError("INVALID_VALUE", 400);
    await setSetting(key as keyof typeof SETTING_DEFAULTS, value);
    await logAudit("SETTING_UPDATE", { req, actorUserId: user.id, actorRole: user.role, entityType: "SystemSetting", entityId: key, meta: { value } });
    return jsonOk({ ok: true });
  }

  // ---------- broadcast: بث عام بلا أي قيم طبية ----------
  if (section === "broadcast" && op === "send") {
    const titleAr = String(body.titleAr ?? "").trim().slice(0, 120);
    const titleEn = String(body.titleEn ?? "").trim().slice(0, 120) || titleAr;
    const bodyAr = String(body.bodyAr ?? "").trim().slice(0, 600);
    const bodyEn = String(body.bodyEn ?? "").trim().slice(0, 600) || bodyAr;
    const severity = ["INFO", "WARNING", "URGENT"].includes(String(body.severity ?? "")) ? String(body.severity) : "INFO";
    if (titleAr.length < 3 || bodyAr.length < 3) return jsonError("INVALID_FIELDS", 400);
    const recipients = await db.user.findMany({ where: { isActive: true }, select: { id: true } });
    const chunkSize = 200;
    let sent = 0;
    for (let i = 0; i < recipients.length; i += chunkSize) {
      const chunk = recipients.slice(i, i + chunkSize);
      await db.notification.createMany({
        data: chunk.map((r) => ({ userId: r.id, type: "BROADCAST", titleAr, titleEn, bodyAr, bodyEn, severity, channel: "IN_APP" })),
      });
      sent += chunk.length;
    }
    await logAudit("BROADCAST_SENT", { req, actorUserId: user.id, actorRole: user.role, meta: { recipients: sent } });
    return jsonOk({ sent });
  }

  // ---------- contact: تعليم معالجة ----------
  if (section === "contact" && op === "toggle-handled") {
    const id = String(body.id ?? "");
    const msg = await db.contactMessage.findUnique({ where: { id } });
    if (!msg) return jsonError("NOT_FOUND", 404);
    await db.contactMessage.update({ where: { id }, data: { handled: !msg.handled } });
    return jsonOk({ ok: true });
  }

  // ---------- protocols: تعديل يعيدها لمسودة (الاعتماد للمسؤول الطبي فقط) ----------
  if (section === "protocols") {
    if (op === "update") {
      const id = String(body.id ?? "");
      const p = await db.screeningProtocol.findUnique({ where: { id } });
      if (!p) return jsonError("NOT_FOUND", 404);
      const data: Record<string, unknown> = {};
      for (const f of ["titleAr", "titleEn", "summaryAr", "summaryEn", "category", "exclusionsAr", "exclusionsEn", "seeDoctorAr", "seeDoctorEn", "sourceOrg", "guidelineVersion", "guidelineDate"]) {
        if (body[f] !== undefined) data[f] = String(body[f]).slice(0, 1000);
      }
      for (const f of ["minAge", "maxAge", "intervalMonths"]) {
        if (body[f] !== undefined && body[f] !== "") {
          const n = Number(body[f]);
          if (!Number.isInteger(n) || n < 0 || n > 200) return jsonError("INVALID_NUMBER", 400);
          data[f] = n;
        }
      }
      if (body.gender !== undefined) data.gender = body.gender === "MALE" || body.gender === "FEMALE" ? body.gender : null;
      if (body.doctorDiscussion !== undefined) data.doctorDiscussion = body.doctorDiscussion === true;
      if (body.requiresRisk !== undefined) data.requiresRisk = body.requiresRisk === true;
      // أي تعديل يعيد البروتوكول لمسودة ويمسح الاعتماد
      data.status = "DRAFT";
      data.approvedById = null;
      data.approvedAt = null;
      await db.screeningProtocol.update({ where: { id }, data });
      await logAudit("PROTOCOL_ADMIN_EDIT", { req, actorUserId: user.id, actorRole: user.role, entityType: "ScreeningProtocol", entityId: id });
      return jsonOk({ ok: true, status: "DRAFT" });
    }
    if (op === "archive") {
      const id = String(body.id ?? "");
      await db.screeningProtocol.update({ where: { id }, data: { status: "RETIRED", active: false } });
      await logAudit("PROTOCOL_ARCHIVE", { req, actorUserId: user.id, actorRole: user.role, entityType: "ScreeningProtocol", entityId: id });
      return jsonOk({ ok: true });
    }
    if (op === "approve") {
      return jsonError("APPROVAL_MOVED_TO_OFFICER", 400);
    }
  }

  return jsonError("UNKNOWN_OP", 400);
}
