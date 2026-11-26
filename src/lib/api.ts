"use client";

/** عميل API موحد — رمي خطأ بكود الخطأ من الخادم */
export class ApiError extends Error {
  code: string;
  status: number;
  extra: Record<string, unknown>;
  constructor(code: string, status: number, extra?: Record<string, unknown>) {
    super(code);
    this.code = code;
    this.status = status;
    this.extra = extra ?? {};
  }
}

export async function api<T = Record<string, unknown>>(
  path: string,
  opts: { method?: string; body?: unknown; formData?: FormData } = {}
): Promise<T> {
  const method = opts.method ?? (opts.body || opts.formData ? "POST" : "GET");
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: opts.formData ? undefined : { "Content-Type": "application/json" },
    body: opts.formData ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    cache: "no-store",
  });
  let data: Record<string, unknown> | null = null;
  try {
    data = await res.json();
  } catch {
    /* لا جسم */
  }
  if (!res.ok) {
    throw new ApiError(String(data?.error ?? (res.status === 401 ? "UNAUTHORIZED" : `HTTP_${res.status}`)), res.status, (data ?? undefined) as Record<string, unknown>);
  }
  return data as T;
}

export function fmtDate(d: string | Date | null | undefined, lang: string): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return String(d);
  }
}

export function fmtNumber(n: number | null | undefined, lang: string): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString(lang === "ar" ? "ar-EG" : "en-US");
}
