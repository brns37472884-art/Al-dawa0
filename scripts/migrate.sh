#!/bin/sh
# ============================================================
# ترحيلات Prisma قبل النشر — Pre-deploy Command على Railway
# (كان سابقًا command داخل docker-compose.prod.yml — ذلك للـ VPS فقط)
# الاستخدام: sh scripts/migrate.sh   أو: npm run db:deploy
# ============================================================
set -e
cd "$(dirname "$0")/.."
echo "[migrate] prisma migrate deploy — بدء..."
./node_modules/.bin/prisma migrate deploy
echo "[migrate] اكتمل الترحيل بنجاح."

# إنشاء الأدمن الأول (idempotent: لا يغيّر شيئًا لو الحساب موجود)
if [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ]; then
  echo "[migrate] init-production — التأكد من وجود حساب الأدمن..."
  ./node_modules/.bin/tsx scripts/init-production.ts || echo "[migrate] تحذير: فشل init-production — يُكمل النشر"
fi
