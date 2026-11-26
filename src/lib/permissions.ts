import { db } from "@/lib/db";
import { getSessionUser, jsonError, type SessionUser } from "@/lib/auth";

/**
 * مصفوفة الصلاحيات المركزية — كل مسار API يمر من هنا.
 * الأدوار: PATIENT | DOCTOR | LAB | LAB_SUPERVISOR | ADMIN | MEDICAL_OFFICER
 * المبدأ: كل طرف يرى ما يخصه فقط — الإدارة أرقام مجمعة بلا بيانات مرضى.
 */

export const CAPABILITIES = [
  "patient:self",            // بياناته وتقاريره وخطته ومساعده وطلباته
  "patient:family",          // أفراد أسرة
  "doctor:inbox",            // صندوق الحالات المسندة إليه فقط
  "doctor:review",           // كتابة الرأي وخطة المتابعة وطلب التصحيح
  "lab:operate",             // بوابة المعمل: طلباته ونتائجه فقط
  "lab:upload",              // رفع النتائج
  "lab:holds:review",        // مراجعة IdentityHold (مشرف المعمل فقط)
  "officer:approve",         // اعتماد البروتوكولات وقواعد القيم الحرجة
  "admin:manage",            // لوحة الإدارة — أرقام مجمعة فقط
  "admin:settings",          // تعديل إعدادات النظام
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const PERMISSIONS: Record<string, readonly Capability[]> = {
  PATIENT: ["patient:self", "patient:family"],
  DOCTOR: ["doctor:inbox", "doctor:review"],
  LAB: ["lab:operate", "lab:upload"],
  LAB_SUPERVISOR: ["lab:operate", "lab:upload", "lab:holds:review"],
  MEDICAL_OFFICER: ["officer:approve"],
  ADMIN: ["admin:manage", "admin:settings"],
};

export function can(role: string, cap: Capability): boolean {
  return PERMISSIONS[role]?.includes(cap) ?? false;
}

/** التحقق الدوري من المصفوفة — يُستخدم في الاختبارات */
export function assertMatrixInvariants(): string[] {
  const problems: string[] = [];
  // ADMIN لا يرى بيانات مرضى: لا يملك أي قدرة على محتوى طبي
  for (const role of Object.keys(PERMISSIONS)) {
    if (role !== "ADMIN" && role !== "MEDICAL_OFFICER" && !PERMISSIONS[role].length) {
      problems.push(`${role} بلا صلاحيات`);
    }
  }
  if (!can("LAB_SUPERVISOR", "lab:holds:review")) problems.push("المشرف بلا صلاحية مراجعة التعارضات");
  if (can("LAB", "lab:holds:review")) problems.push("موظف المعمل العادي لا يجب أن يراجع التعارضات");
  if (can("ADMIN", "patient:self")) problems.push("الإدارة لا ترى ملفات المرضى");
  return problems;
}

// ---------- حواجز المسارات ----------
export async function requireUser(): Promise<SessionUser | Response> {
  const user = await getSessionUser();
  if (!user) return jsonError("UNAUTHORIZED", 401);
  return user;
}

export async function requireRole(roles: string[]): Promise<SessionUser | Response> {
  const user = await getSessionUser();
  if (!user) return jsonError("UNAUTHORIZED", 401);
  if (!roles.includes(user.role)) return jsonError("FORBIDDEN", 403);
  return user;
}

export async function requireCapability(cap: Capability): Promise<SessionUser | Response> {
  const user = await getSessionUser();
  if (!user) return jsonError("UNAUTHORIZED", 401);
  if (!can(user.role, cap)) return jsonError("FORBIDDEN", 403);
  return user;
}

/** بوابة المعمل: دور معمل + معمل مرتبط ومفعّل — كل الاستعلامات مقيدة بـ labId */
export async function requireLab(): Promise<
  { user: SessionUser; labId: string; canReviewHolds: boolean } | Response
> {
  const user = await getSessionUser();
  if (!user) return jsonError("UNAUTHORIZED", 401);
  if (!can(user.role, "lab:operate")) return jsonError("FORBIDDEN", 403);
  const dbUser = await db.user.findUnique({
    where: { id: user.id },
    include: { lab: { select: { id: true, name: true, isActive: true } } },
  });
  if (!dbUser?.labId || !dbUser.lab) return jsonError("NO_LAB_BOUND", 403);
  if (!dbUser.lab.isActive) return jsonError("LAB_INACTIVE", 403);
  return { user, labId: dbUser.labId, canReviewHolds: can(user.role, "lab:holds:review") };
}
