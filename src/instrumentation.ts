/** يعمل مرة عند إقلاع السيرفر (Node فقط) — تجهيز الأدمن الأول من متغيرات البيئة. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  try {
    const { bootstrapAdmin } = await import("@/lib/bootstrap-admin");
    await bootstrapAdmin();
    const { describeFlags } = await import("@/lib/flags");
    console.log(`[config] ${describeFlags()}`);
  } catch (e) {
    console.error("[bootstrap] تعذر التشغيل:", e instanceof Error ? e.message : e);
  }
}
