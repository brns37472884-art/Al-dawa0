import { z } from "zod";

/**
 * فحص البيئة بـ zod عند الإقلاع — يفشل مبكرًا لو ناقص سر.
 * لا تُطبع قيم الأسرار أبدًا — أسماء المتغيرات فقط.
 */
const boolish = z
  .string()
  .optional()
  .transform((v) => v === "true");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL مطلوب (PostgreSQL 16)"),
  REDIS_URL: z.string().optional(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET يجب أن يكون 32 حرفًا فأكثر"),
  LAB_ENC_KEY: z.string().optional(),
  DEMO_MODE: boolish,
  TRUSTED_PROXY: boolish,
  PORT: z.string().optional(),
  PUBLIC_BASE_URL: z.string().optional(),
  ALLOWED_FRAME_ANCESTORS: z.string().optional(),
  COOKIE_SECURE: z.string().optional(),
  STORAGE_PROVIDER: z.enum(["local", "s3", "db"]).optional(),
  STORAGE_LOCAL_DIR: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_REGION: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  EXTERNAL_AI_ENABLED: boolish,
  EXTERNAL_AI_API_KEY: z.string().optional(),
  EXTERNAL_AI_BASE_URL: z.string().optional(),
  EXTERNAL_AI_MODEL: z.string().optional(),
  EXTERNAL_AI_VISION_MODEL: z.string().optional(),
  WORKER_CONCURRENCY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `- ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `ENV_INVALID — تحقق متغيرات البيئة فشل (لا تُطبع القيم):\n${issues}`
    );
  }
  const env = parsed.data;
  if (env.NODE_ENV === "production") {
    // في الإنتاج: Redis إلزامي (OTP/rate-limit/طوابير/pub/sub مشتركة بين النسخ)
    if (!env.REDIS_URL) {
      throw new Error("ENV_INVALID — REDIS_URL مطلوب في الإنتاج (Redis 7)");
    }
    if (env.DEMO_MODE) {
      throw new Error("ENV_INVALID — DEMO_MODE=true ممنوع في الإنتاج");
    }
    if (env.STORAGE_PROVIDER === "s3" && (!env.S3_ENDPOINT || !env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY)) {
      throw new Error("ENV_INVALID — متغيرات S3 ناقصة (S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY)");
    }
  }
  cached = env;
  return env;
}

export function isDemoMode(): boolean {
  try {
    return getEnv().DEMO_MODE;
  } catch {
    return false;
  }
}

export function isProdEnv(): boolean {
  try {
    return getEnv().NODE_ENV === "production";
  } catch {
    return false;
  }
}
