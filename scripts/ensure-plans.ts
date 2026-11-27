/**
 * ensure-plans — يضمن وجود الباقات (FREE / PLUS / FAMILY) في قاعدة البيانات.
 * آمن للتكرار: يُنشئ الناقص فقط ولا يكتب فوق أسعار/إعدادات عدّلتها الإدارة.
 * يعمل تلقائيًا في Pre-deploy (scripts/migrate.sh) — على Railway لا يوجد seed يدوي.
 */
import { PrismaClient } from "@prisma/client";
import { PLANS } from "../prisma/reference-data";

const db = new PrismaClient();

async function main() {
  for (const p of PLANS) {
    await db.plan.upsert({ where: { key: p.key }, create: { ...p }, update: {} });
  }
  const n = await db.plan.count();
  console.log(`✅ ensure-plans: ${n} باقة في قاعدة البيانات.`);
}

main()
  .catch((e) => {
    console.error("فشل ensure-plans:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
