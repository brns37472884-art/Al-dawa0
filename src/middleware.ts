import { NextResponse, type NextRequest } from "next/server";
import { originAllowed } from "@/lib/origin";

/**
 * CSP frame-ancestors وقت التشغيل — يضبط من .env (ALLOWED_FRAME_ANCESTORS).
 * الافتراضي 'self'.
 *
 * + فحص Origin/Host على الطلبات المُعدِّلة (POST/PUT/PATCH/DELETE) — حماية CSRF (src/lib/origin.ts).
 *
 * مسارا رفع الملفات (/api/reports و/api/lab/results) مستثنيان من الـ matcher عمدًا:
 * Next يخزّن جسم الطلب مؤقتًا عند مروره بالـ middleware بحد افتراضي 10MB ويقتطع الأكبر،
 * بينما حد التقرير 15MB × 5 ملفات. فحص Origin يُنفَّذ داخل المسارين نفسيهما.
 */
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export default function middleware(req: NextRequest) {
  if (MUTATING.has(req.method) && !originAllowed(req.headers)) {
    return NextResponse.json({ error: "ORIGIN_FORBIDDEN" }, { status: 403 });
  }
  const res = NextResponse.next();
  const frameAncestors = (process.env.ALLOWED_FRAME_ANCESTORS || "").trim() || "'self'";
  res.headers.set("Content-Security-Policy", `frame-ancestors ${frameAncestors}`);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/reports$|api/lab/results$).*)"],
};
