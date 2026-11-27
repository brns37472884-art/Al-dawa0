# النشر — منصة الدواء | Al Dawa v2

> متطلبات الخادم: Ubuntu 22+ · Docker + Docker Compose · نطاق موثّق (A record) · 2GB RAM فأكثر

## 1) التجهيز على الخادم

```bash
# فك حزمة الهوستنج ثم:
cp .env.example .env
# املأ بقيم حقيقية (لا تُرفع أبدًا):
#   DOMAIN=aldawa.example.com
#   POSTGRES_PASSWORD=<قوي>
#   REDIS_PASSWORD=<قوي>
#   JWT_SECRET=<32+ حرفًا: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
#   LAB_ENC_KEY=<32+ حرفًا مستقلًا عن JWT_SECRET>
#   S3_ACCESS_KEY_ID=aldawa   S3_SECRET_ACCESS_KEY=<قوي>
#   ADMIN_EMAIL=...           ADMIN_PASSWORD=<12+ حرفًا>
#   SMTP_* (بريد OTP وMFA)
node scripts/gen-env.mjs --force   # بديل: يولد JWT_SECRET/LAB_ENC_KEY عشوائيين في .env
```

## 2) التشغيل

```bash
docker compose -f docker-compose.prod.yml up -d --build
# أول مرة فقط: بيانات مرجعية + أدمن
docker compose -f docker-compose.prod.yml exec app npx prisma migrate deploy
docker compose -f docker-compose.prod.yml exec app npx tsx prisma/seed-production.ts
docker compose -f docker-compose.prod.yml exec app npx tsx scripts/init-production.ts
```

Caddy يستخرج شهادة HTTPS تلقائيًا للنطاق. صحة النظام: `GET /api/ready`.

## 3) بعد الإقلاع — خطوات لا تُتخطى

1. **اعتماد طبي**: سجّل حساب المسؤول الطبي (الإدارة تنشئه من تبويب المستخدمين أو اطلب من الأدمن إضافته)، ثم من شاشة المسؤول الطبي اعتمد الـ19 بروتوكولًا بعد مراجعتها، واعتمد قواعد القيم الحرجة الـ12 — **قبل تسجيل أي عميل حقيقي لا يظهر أي توصية ولا يعمل فحص القيم الحرجة**.
2. **الشبكة**: من لوحة الإدارة → المعامل: دوّن أسماء المراكز السبعة الرسمية بدل «مركز (n) — سوهاج»، وأضف المعامل الحقيقية بترخيصها، وفعّلها على الشبكة، وأنشئ لكل معمل موظفًا (+ مشرف اختياري).
3. **الباقات**: راجع الأسعار 0/250/500 من تبويب الباقات (تعديلها فوري).
4. **البريد**: تأكد أن OTP يصل فعليًا (SMTP) — بلا بريد لا تسجيل حقيقي.

## 4) النسخ الاحتياطي

```bash
# يوميًا 2 صباحًا (crontab -e)
0 2 * * * cd /path/to/app && BACKUP_DIR=/var/backups/aldawa sh scripts/backup.sh >> /var/log/aldawa-backup.log 2>&1
# أسبوعيًا: اختبار استرجاع فعلي
0 3 * * 0 cd /path/to/app && sh scripts/restore-test.sh
```
النسخة = pg_dump بتنسيق custom + ملفات التخزين المحلية؛ عند MinIO انقل مجلد بيانات miniodata volume أو استخدم `mc mirror`.

## 5) الاختبارات على بيئة كاملة

```bash
npm test                                          # وحدة (لا يحتاج خادمًا)
TEST_BASE_URL=https://DOMAIN npx vitest run tests/integration --config vitest.int.config.ts
BASE_URL=https://DOMAIN npx playwright test tests/e2e   # السيناريوهات السبعة + قياس زمن الوصول
```
معيار القبول: طبيب وموظف معمل غير تقنيين يكملون مهامهم دون شرح.

## 6) المتغيرات السرية — قائمة كاملة في `.env.example`

| المتغير | مين يضعه | أين يُستخدم |
|---|---|---|
| `JWT_SECRET` | أنت في `.env` | توقيع الجلسات (env.ts يفشل بدونه <32) |
| `LAB_ENC_KEY` | أنت في `.env` | تشفير النتائج المعلقة AES-256-GCM + هاش الموبايل HMAC |
| `POSTGRES_PASSWORD` / `REDIS_PASSWORD` | أنت في `.env` | docker-compose.prod.yml |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | أنت في `.env` | MinIO/S3 |
| `SMTP_PASS` | أنت في `.env` | nodemailer (OTP/MFA) |
| `EXTERNAL_AI_API_KEY` | أنت في `.env` | المزود الخارجي للقراءة والمساعد — بلا المفتاح يعمل المزود المحلي فقط |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | أنت في `.env` | سكربت init-production فقط |

قاعدة: **لا سر في الكود أو اللوج أو Git** — الكود يقرأ من البيئة فقط ويطبع أسماء المتغيرات عند الفشل، لا القيم.

## 7) ملاحظات تشغيلية

- **تعدد النسخ**: SSE يبث عبر Redis pub/sub — يكفي تشغيل نسخة app ثانية بنفس الـ env خلف Caddy.
- **السجلات**: pino بلا بيانات شخصية (مقنّعة في redact) — اجمعها بـ `docker logs` أو وجه خارجي.
- **الاحتفاظ بالبيانات**: سياسة الاحتفاظ النهائية بعد مراجعة قانونية (قانون 151/2020) — الأصل محفوظ بلا مسح لتوثيق التصحيحات.
- **قبل الإطلاق الحقيقي**: مراجعة قانونية، اعتماد البروتوكولات من مسؤول طبي مصري، مزود SMS حقيقي، أسماء مراكز رسمية.

## 8) النشر على Railway (بديل الـ VPS)

على Railway لا يُستخدم `docker-compose.prod.yml` ولا `Caddyfile` إطلاقًا (هما للـ VPS فقط) — Railway يبني من `Dockerfile` ويقرأ `railway.toml` لخدمة app.

### الخدمات (4)

| الخدمة | المصدر | الإعداد |
|---|---|---|
| Postgres | Railway Database (نقدي `DATABASE_URL` من متغيراتها) | أضف `?sslmode=require` إن طلبه المزود |
| Redis | Railway Database (`REDIS_URL`) | OTP / rate-limit / الطوابير / pub/sub |
| app | نفس الريبو — Dockerfile + `railway.toml` | healthcheck `/api/ready` (timeout 120) وPre-deploy: `sh scripts/migrate.sh` |
| worker | نفس الـ image — **Config as Code**: Settings → Config as Code path = `railway.worker.toml` (يعيّن Start Command: `node node_modules/.bin/tsx src/worker/index.ts`) | بلا pre-deploy وبلا healthcheck HTTP؛ اربطه بنفس متغيرات app |

### متغيرات خدمة app (والـ worker يشترك فيها)

`DATABASE_URL` · `REDIS_URL` · `JWT_SECRET` (32+ حرفًا) · `LAB_ENC_KEY` (32+ حرفًا **ومختلف عن JWT_SECRET**) · `NODE_ENV=production` · `DEMO_MODE=false` · `TRUSTED_PROXY=true` · `TRUSTED_IP_HEADER=x-real-ip` (يمنع تزوير IP في الـ rate-limit — راجع لوج أول طلب للتأكد) · `PUBLIC_BASE_URL` (نطاق Railway المؤقت أو النطاق الموصول — يُستخدم أيضًا في فحص Origin) · `HOSTNAME=0.0.0.0` · `STORAGE_PROVIDER=s3` + `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` (+ `S3_REGION` اختياري، و`S3_FORCE_PATH_STYLE=false` لمزودات virtual-host مثل Railway Bucket — الافتراضي path-style يعمل مع Cloudflare R2 وMinIO) · `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `EMAIL_FROM` · `ADMIN_EMAIL` / `ADMIN_PASSWORD` (لسكربت التهيئة فقط) · `COOKIE_SAMESITE` (اختياري — الافتراضي lax إلا لو `ALLOWED_FRAME_ANCESTORS` مضبوط).

### أول تشغيل — البيانات المرجعية والأدمن

⚠️ **لماذا لا يعمل `railway run` هنا؟** `railway run` يركّز متغيرات الخدمة على جهازك المحلي، لكن `DATABASE_URL` على Railway يشير إلى الرابط **الداخلي** (`*.railway.internal`) الذي لا يُرى من خارج شبكة Railway — فسيفشل الاتصال بالقاعدة. استخدم إحدى الطريقتين:

**الطريقة الموصى بها — `railway ssh` داخل خدمة app** (يعمل داخل الحاوية حيث `DATABASE_URL` الداخلي صحيح، و`tsx` أصبح في dependencies فمتوفر في node_modules):

```bash
railway ssh --service app
# داخل الحاوية:
npx tsx prisma/seed-production.ts    # بيانات مرجعية
npx tsx scripts/init-production.ts   # الأدمن الأول (يحتاج ADMIN_EMAIL/ADMIN_PASSWORD من متغيرات الخدمة)
```

**بديل من جهازك المحلي — عبر الرابط العام `DATABASE_PUBLIC_URL`** (متغير مرجعي على خدمة Postgres يمر عبر TCP proxy بـ TLS):

```bash
# اجلب الرابط العام من متغيرات خدمة القاعدة (استبدل Postgres باسمها في مشروعك):
export DATABASE_URL="$(railway variables --service Postgres --kv | grep '^DATABASE_PUBLIC_URL=' | cut -d= -f2-)"
export ADMIN_EMAIL="..." ADMIN_PASSWORD="..."   # لسكربت init فقط — من متغيرات app
npx tsx prisma/seed-production.ts
npx tsx scripts/init-production.ts
```

ثم أعد خطوة «بعد الإقلاع» أعلاه: اعتماد البروتوكولات وقواعد القيم الحرجة من شاشة المسؤول الطبي قبل تسجيل أي عميل.

### ملاحظات Railway

- **SMTP**: Railway يغلق منافذ SMTP الخارجية (25/465/587) في الخطط الأقل من Pro — إن لم يعمل البريد فلن يصل OTP للتسجيل أو MFA. الحل: خطة Pro، أو مزود بريد عبر HTTP API، أو SMTP داخلي متوافق.
- **التخزين**: لا يوجد volume مشترك بين app و worker — `STORAGE_PROVIDER` يجب أن يكون `s3` (المشروع يطبع تحذيرًا في اللوج عند local في الإنتاج).
- **الهوية**: النشر يمس الريبو مباشرة — أي تعديل جديد على الملفات يعيد نشر الخدمتين.

### إعدادات التخزين الجاهزة (S3)

| المزود | S3_ENDPOINT | S3_REGION | S3_FORCE_PATH_STYLE |
|---|---|---|---|
| Cloudflare R2 | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` | `auto` | `true` (الافتراضي) |
| Railway Bucket | الـ endpoint الظاهر في صفحة الـ Bucket | `auto` | `false` |

`S3_BUCKET` اسم الـ bucket، و`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` من صفحة الـ Bucket. جرّب رفع تقرير وفتحه بعد أول نشر للتأكد من التوقيع.

### ما يتحقق منه بعد أول نشر

1. لوج app: لا يوجد `ENV_INVALID` ولا `REDIS_UNAVAILABLE`، و`GET /api/ready` يرجع `{"ok":true}`.
2. لوج worker: يظهر `[WORKER] يعمل` — إن ظهر خطأ اتصال Redis فتحقق من `REDIS_URL` (الرابط الداخلي `*.railway.internal`).
3. تسجيل دخول → رفع تقرير (يصل لـ S3) → يظهر استخراجه (يثبت أن worker يقرأ نفس الملف).
4. أي رد `ORIGIN_FORBIDDEN` (403) عند الدخول = `PUBLIC_BASE_URL` لا يطابق النطاق الذي تفتح منه.

### تغييرات النشر على Railway (تلخيص)

- `openssl` مضاف لكل مراحل الـ Dockerfile (Prisma على Alpine) و`HOSTNAME=0.0.0.0` يُضبط داخل أمر التشغيل.
- اتصال BullMQ بـ Redis يُفكّك من `REDIS_URL` صراحة مع `family:0` (IPv4+IPv6) — شبكة Railway الداخلية قد تكون IPv6.
- مساران رفع الملفات (`/api/reports`, `/api/lab/results`) مستثنيان من الـ middleware لتفادي اقتطاع الجسم عند 10MB، وفحص Origin داخلهما.
- إعادة تشغيل تلقائية للخدمتين عند الفشل (`restartPolicyType`).

### الدفع اليدوي للباقات + مفاتيح التشغيل

- **الباقات** (FREE 0 / PLUS 250 / FAMILY 500) تُنشأ تلقائيًا في Pre-deploy (`scripts/ensure-plans.ts`) ولا تُستبدل تعديلات الإدارة.
- **العميل:** `/app/subscription` → يختار الباقة وطريقة الدفع (كاش / إنستا باي / تحويل بنكي) ويرفع صورة الإيصال (JPG/PNG/PDF ≤ 5MB).
  الصورة تُحفظ في قاعدة البيانات (لا تحتاج S3 ولا تضيع عند إعادة النشر).
- **الأدمن:** تبويب «إيصالات الدفع» → قبول (يفعّل الاشتراك 30 يومًا ويسجّل دفعة ويُرسل إشعارًا) أو رفض بسبب.
- **بيانات التحويل** (رقم المحفظة / عنوان إنستا باي / الحساب البنكي) تُكتب من الأدمن ← الإعدادات: `PAY_CASH_INFO` و`PAY_INSTAPAY_INFO` و`PAY_BANK_INFO`.
- **مفاتيح التشغيل (Railway Variables):**
  - `EMAIL_VERIFICATION_REQUIRED` — الافتراضي `false` (التسجيل بلا OTP).
  - `MFA_EMAIL_REQUIRED` — الافتراضي `true`. على Railway بلا SMTP ضعه `false` مؤقتًا وإلا لن يستطيع الأدمن الدخول (الرمز يُرسل بالبريد فقط).
  - `ADMIN_FORCE_RESET=true` مع `ADMIN_EMAIL`/`ADMIN_PASSWORD` يعيد ضبط كلمة مرور الأدمن في النشر التالي — احذفه بعدها.

### تسجيل الدخول والأدوار (إصلاحات)

- **سبب «يرجعني لصفحة الدخول»:** الجلسة كانت تُحمَّل مرة واحدة قبل الدخول ولا تتحدث بعده؛ أُصلح بتحديثها بعد الدخول/التسجيل/MFA.
- **حساب دكتور / مسؤول طبي:** من الأدمن ← المستخدمين ← «إضافة حساب» (لا تسجيل ذاتي لهذه الأدوار). حسابات المعمل من تبويب المعامل (إنشاء ← توثيق ← تفعيل ← إضافة موظف).
- **البروتوكولات والقيم الحرجة** تُبذر كمسودات في كل نشر؛ يعتمدها المسؤول الطبي من لوحته قبل ظهور توصيات الفحوصات.

### تجهيز الأدمن عند الإقلاع

التطبيق نفسه يجهّز الأدمن عند كل إقلاع (`src/instrumentation.ts`) بغض النظر عن Pre-deploy. في **Deploy Logs** ابحث عن `[bootstrap]`:
- `✅ أُنشئ حساب الأدمن` / `🔑 أُعيد ضبط كلمة مرور الأدمن` — جاهز.
- `موجود ... لا تغيير` — الحساب قديم: اضبط `ADMIN_FORCE_RESET=true` وأعد النشر.
- `ADMIN_PASSWORD قصير أو ضعيف` / `غير مضبوطين` — المتغيرات غير صحيحة/غير موصولة بهذا الـ service.
- `فشل تجهيز الأدمن` — مشكلة قاعدة بيانات (الترحيلات أو DATABASE_URL).
