import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { isValidEmail } from "@/lib/helpers";

/**
 * يضمن وجود حساب الأدمن عند إقلاع التطبيق نفسه (لا يعتمد على Pre-deploy).
 *   ADMIN_EMAIL + ADMIN_PASSWORD (12+ حرفًا، حرف ورقم) → ينشئ الأدمن لو غير موجود.
 *   ADMIN_FORCE_RESET=true → يعيد ضبط كلمة المرور فقط لو لا تطابق المخزّنة (فلا تُقطع الجلسات عند كل إعادة تشغيل).
 * لا يُطبع أي سر في اللوج — فقط حالة العملية.
 */
export async function bootstrapAdmin(): Promise<void> {
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!email || !password) {
    console.log("[bootstrap] ADMIN_EMAIL/ADMIN_PASSWORD غير مضبوطين — تخطي إنشاء الأدمن.");
    return;
  }
  if (!isValidEmail(email)) return void console.error("[bootstrap] ADMIN_EMAIL ليس بريدًا صالحًا — لم يُنشأ الأدمن.");
  if (password.length < 12 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    return void console.error(`[bootstrap] ADMIN_PASSWORD قصير أو ضعيف (طوله الحالي ${password.length}) — يجب 12+ حرفًا بها حرف ورقم. لم يُنشأ الأدمن.`);
  }
  try {
    const existing = await db.user.findUnique({ where: { email } });
    if (!existing) {
      await db.user.create({ data: { email, fullName: "مدير النظام", role: "ADMIN", passwordHash: await hashPassword(password) } });
      console.log(`[bootstrap] ✅ أُنشئ حساب الأدمن (${email}).`);
      return;
    }
    if (process.env.ADMIN_FORCE_RESET !== "true") {
      console.log(`[bootstrap] حساب الأدمن (${email}) موجود (دوره ${existing.role}) — لا تغيير. لإعادة ضبط كلمة المرور اضبط ADMIN_FORCE_RESET=true.`);
      return;
    }
    const same = await verifyPassword(password, existing.passwordHash);
    if (same && existing.role === "ADMIN" && existing.isActive) {
      console.log(`[bootstrap] كلمة مرور الأدمن (${email}) مطابقة لـ ADMIN_PASSWORD — لا تغيير.`);
      return;
    }
    await db.user.update({
      where: { id: existing.id },
      data: { passwordHash: await hashPassword(password), role: "ADMIN", isActive: true, tokenVersion: { increment: 1 } },
    });
    console.log(`[bootstrap] 🔑 أُعيد ضبط كلمة مرور الأدمن (${email}).`);
  } catch (e) {
    // غالبًا الجداول غير موجودة (الترحيلات لم تعمل) أو DATABASE_URL خاطئ
    console.error(`[bootstrap] فشل تجهيز الأدمن: ${e instanceof Error ? e.message.split("\n").slice(-2).join(" ") : e}`);
  }
}
