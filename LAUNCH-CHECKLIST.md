# قائمة الإطلاق — AL-DAWA

## 1) متغيرات خدمة التطبيق (app) على Railway
| المتغير | القيمة |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` |
| `JWT_SECRET` | `${{secret(64)}}` |
| `LAB_ENC_KEY` | `${{secret(64)}}` (لا تغيّره بعد أول رفع ملفات) |
| `NODE_ENV` | `production` |
| `PUBLIC_BASE_URL` | رابط الموقع النهائي بدون `/` في الآخر |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | حساب الأدمن (كلمة سر قوية 12+) |
| `EMAIL_VERIFICATION_REQUIRED` | `false` (حتى يتظبط SMTP) |
| `TRUSTED_PROXY` | `true` |

نفس `DATABASE_URL` و`REDIS_URL` و`JWT_SECRET` و`LAB_ENC_KEY` و`S3_*` لازم تتحط في خدمة الـ worker كمان.

## 2) التخزين (مهم جداً قبل ما الناس ترفع تحاليل)
الافتراضي `local` بيضيع مع كل نشر، والـ worker مش بيشوفه. اضبط في الخدمتين:
`STORAGE_PROVIDER=s3`، `S3_ENDPOINT`، `S3_BUCKET`، `S3_ACCESS_KEY_ID`، `S3_SECRET_ACCESS_KEY`، `S3_REGION`
(Cloudflare R2 أو Railway Bucket).

## 3) بعد أول نشر ناجح
- [ ] `ADMIN_FORCE_RESET` احذفه بعد ما تدخل.
- [ ] غيّر كلمة سر الأدمن لو كانت اتبعتت في شات.
- [ ] خلّي الـ repo **Private** (Settings → Danger Zone).
- [ ] Healthcheck `/api/ready` أخضر في الـ app.
- [ ] اعمل حساب مريض تجريبي، اطلب باقة، ارفع صورة دفع، واقبلها من الأدمن.
- [ ] اعمل دكتور ومعمل (موثّق ومفعّل + موظف) وجرّب دخولهم.
- [ ] راجع بروتوكولات DRAFT عند المسؤول الطبي.
- [ ] اضبط بيانات الدفع (كاش/إنستاباي/بنك) من إعدادات الأدمن (`PAY_*`).
- [ ] فعّل Backups لقاعدة Postgres.

## 4) لاحقاً
- SMTP (Resend/Brevo) ثم `MFA_EMAIL_REQUIRED` و`EMAIL_VERIFICATION_REQUIRED=true`.
- دومين خاص بدل `up.railway.app`.
