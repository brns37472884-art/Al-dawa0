// ============================================================
// مزود الذكاء الاصطناعي — يشرح فقط ولا يوصي.
// المزود الخارجي (OpenAI-compatible) لا يُستدعى إطلاقًا إلا بموافقة AI_ANALYSIS
// وبعد إخفاء PII. بلا مفتاح خارجي: المزود المحلي الحتمي فقط (بلا شبكة).
// ============================================================
import { getEnv } from "@/env";

export interface ChatMessageLite {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiResult {
  content: string;
  provider: "external" | "builtin";
}

function externalConfigured(): boolean {
  const env = getEnv();
  return !!(
    env.EXTERNAL_AI_ENABLED &&
    env.EXTERNAL_AI_API_KEY &&
    env.EXTERNAL_AI_API_KEY.length > 10 &&
    env.EXTERNAL_AI_BASE_URL &&
    env.EXTERNAL_AI_BASE_URL.startsWith("http")
  );
}

/** استدعاء خارجي OpenAI-compatible — chat completions */
async function externalChat(messages: ChatMessageLite[], opts: { temperature?: number; maxTokens?: number; json?: boolean; model?: string } = {}): Promise<string> {
  const env = getEnv();
  const res = await fetch(`${env.EXTERNAL_AI_BASE_URL!.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.EXTERNAL_AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: opts.model || env.EXTERNAL_AI_MODEL || "glm-4.6",
      messages,
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.maxTokens ?? 1500,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`EXTERNAL_AI_HTTP_${res.status}`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content ?? "";
  if (!content) throw new Error("EXTERNAL_AI_EMPTY");
  return content;
}

/** استدعاء خارجي للصور (vision) — base64 */
async function externalVision(prompt: string, imageBase64: string, mimeType: string, opts: { maxTokens?: number } = {}): Promise<string> {
  const env = getEnv();
  const model = env.EXTERNAL_AI_VISION_MODEL || env.EXTERNAL_AI_MODEL || "glm-4.6v";
  return externalChat(
    [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
        ],
      } as unknown as ChatMessageLite,
    ],
    { temperature: 0.1, maxTokens: opts.maxTokens ?? 2500, json: true, model }
  );
}

/**
 * شات موحّد — allowExternal=false يجبر المحلي (بلا موافقة AI مثلاً).
 * builtinFallback: مولّد محلي حتمي (بلا شبكة ولا نموذج خارجي).
 */
export async function aiChat(
  messages: ChatMessageLite[],
  opts: { allowExternal?: boolean; temperature?: number; maxTokens?: number; json?: boolean; builtinFallback?: () => string } = {}
): Promise<AiResult> {
  if (opts.allowExternal !== false && externalConfigured()) {
    try {
      const content = await externalChat(messages, opts);
      return { content, provider: "external" };
    } catch (e) {
      console.error(`[AI] فشل المزود الخارجي — التراجع للمحلي: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (opts.builtinFallback) {
    return { content: opts.builtinFallback(), provider: "builtin" };
  }
  throw new Error("AI_UNAVAILABLE: لا يوجد مزود خارجي مضبوط ولا مولد محلي — اضبط EXTERNAL_AI_* في .env أو زوّد builtinFallback");
}

export async function aiVision(prompt: string, imageBase64: string, mimeType: string, opts: { allowExternal?: boolean } = {}): Promise<AiResult> {
  if (opts.allowExternal !== false && externalConfigured()) {
    try {
      const content = await externalVision(prompt, imageBase64, mimeType);
      return { content, provider: "external" };
    } catch (e) {
      console.error(`[AI-VISION] فشل المزود الخارجي: ${e instanceof Error ? e.message : e}`);
    }
  }
  throw new Error("AI_VISION_UNAVAILABLE: تحليل الصور يحتاج مزودًا خارجيًا مضبوطًا (EXTERNAL_AI_* + موافقة AI_ANALYSIS) — استخدم إدخال المعمل اليدوي");
}

/** استخراج JSON من نص — تقليم أسوار ثم أول { إلى آخر } */
export function extractJson(text: string): unknown | null {
  let t = text.trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const firstObj = t.indexOf("{");
  const firstArr = t.indexOf("[");
  const start = firstArr >= 0 && (firstObj < 0 || firstArr < firstObj) ? firstArr : firstObj;
  const lastObj = t.lastIndexOf("}");
  const lastArr = t.lastIndexOf("]");
  const end = lastArr > lastObj ? lastArr : lastObj;
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function aiProviderStatus(): { external: boolean; builtin: "local-deterministic" } {
  return { external: externalConfigured(), builtin: "local-deterministic" };
}
