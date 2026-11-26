// ============================================================
// المساعد الصحي — يشرح فقط ولا يوصي ولا يشخّص ولا يصف أدوية.
// قواعد السلامة مفروضة في السياق، والمزود الخارجي خلف بوابة AI_ANALYSIS
// مع إخفاء PII. البديل المحلي حتمي (بلا شبكة): شرح توعوي عام.
// ============================================================
import { db } from "@/lib/db";
import { aiChat, type ChatMessageLite } from "@/lib/ai/provider";
import { hasAiConsent } from "@/lib/privacy";
import { redactPii } from "@/lib/privacy";
import { logAgentRun } from "@/lib/api-utils";
import { calcAge, calcBmi, safeJsonParse } from "@/lib/helpers";

export const ASSISTANT_SYSTEM = [
  "أنت «المساعد الصحي» في منصة الدواء — دورك شرح توعوي فقط.",
  "قواعد صارمة لا تُخترق:",
  "1) لست طبيبًا — لا تشخّص ولا تحكم على نتيجة ولا تقل «نتيجتك طبيعية/غير طبيعية» بشكل قاطع.",
  "2) لا توصِ بفحص أو دواء أو جرعة — إن سُئلت عن دواء: قل إن الجرعات والأدوية قرار طبي، ووجّه لطبيبه.",
  "3) صياغة احتمالية فقط («قد تشير»، «يُناقش مع الطبيب»)، والنتيجة الطبيعية لا تنفي وجود المرض.",
  "4) لا تشرح تحاليل الأورام في الدم (CEA / CA-125 / CA19-9) كفحص لاكتشاف السرطان لدى الأصحاء.",
  "5) عند أعراض حادة (ألم صدر، ضيق نفس، إغماء، نزيف، تشوش وعي): اتصل بالإسعاف 123 فورًا — لا تنتظر.",
  "6) لا تخترع أرقامًا أو مصادر — اعتمد على السياق المزود فقط.",
  "7) اقترح أسئلة جيدة يسألها لطبيبه، واشرح المصطلحات بلغة بسيطة.",
  "8) نبرة داعمة ومطمئنة، والجواب مختصر وعملي.",
].join("\n");

interface CtxValue {
  canonicalKey: string | null;
  rawName: string;
  value: number | null;
  valueText: string | null;
  unit: string | null;
  refLow: number | null;
  refHigh: number | null;
  flag: string;
  testDate: Date | null;
}

/** سياق توعوي من ملف المستخدم — قيم مسمومة بوضوح، مع تمرير redactPii دائمًا */
async function buildContext(userId: string): Promise<{ text: string; names: string[] }> {
  const user = await db.user.findUnique({ where: { id: userId }, include: { patientProfile: true } });
  if (!user) return { text: "", names: [] };
  const p = user.patientProfile;
  const age = p?.dateOfBirth ? calcAge(p.dateOfBirth) : null;
  const bmi = calcBmi(p?.heightCm, p?.weightKg);
  const chronic = safeJsonParse<Array<{ key: string }>>(p?.chronicConditions ?? "[]", []).map((c) => c.key).join(", ") || "لا يوجد";
  const meds = safeJsonParse<string[]>(p?.medications ?? "[]", []).join(", ") || "لا يوجد";
  const smoking = p?.smokingStatus ?? "غير محدد";

  const recentValues: CtxValue[] = await db.extractedValue.findMany({
    where: { report: { ownerUserId: userId, status: { in: ["EXTRACTED", "CONFIRMED", "CONFIRMED_LAB", "UNDER_REVIEW", "REVIEWED"] } } },
    orderBy: { testDate: "desc" },
    take: 12,
    select: { canonicalKey: true, rawName: true, value: true, valueText: true, unit: true, refLow: true, refHigh: true, flag: true, testDate: true },
  });
  const valuesText = recentValues.length
    ? recentValues
        .map(
          (v) =>
            `- ${v.rawName}: ${v.value ?? v.valueText ?? "—"} ${v.unit ?? ""} (المدى ${v.refLow ?? "—"}–${v.refHigh ?? "—"}), الحالة: ${v.flag}${v.value === null ? " — (قيمة بانتظار تأكيد المعمل، غير نهائية)" : ""}`
        )
        .join("\n")
    : "لا توجد قيم بعد";

  const due = await db.screeningRecord.findMany({
    where: { userId, status: { in: ["DUE", "OVERDUE"] } },
    include: { protocol: { select: { titleAr: true } } },
    take: 5,
  });
  const dueText = due.length ? due.map((d) => `- ${d.protocol.titleAr} (${d.status})`).join("\n") : "لا فحوصات مستحقة معروضة (البروتوكولات المعتمدة فقط)";

  const text = [
    `سياق توعوي (بلا أي هوية):`,
    `العمر: ${age ?? "غير محدد"}، الجنس: ${p?.gender ?? "غير محدد"}، مؤشر الكتلة: ${bmi ? bmi.toFixed(1) : "غير محدد"}`,
    `أمراض مزمنة: ${chronic}، أدوية: ${meds}، تدخين: ${smoking}`,
    `آخر القيم (قد تكون بانتظار التأكيد):`,
    valuesText,
    `فحوصات مستحقة من الخططة المعتمدة:`,
    dueText,
  ].join("\n");
  return { text: redactPii(text, { names: [user.fullName] }), names: [user.fullName] };
}

const BUILTIN_GUIDE = [
  "شرح توعوي عام من المساعد المحلي (بلا نموذج لغوي خارجي):",
  "• لست طبيبًا ولا أشخّص — القرار الطبي لطبيبك.",
  "• نتيجة طبيعية لا تنفي وجود مرض، ونتيجة غير طبيعية ليست تشخيصًا — النطاق المرجعي يختلف بين المعامل.",
  "• قيم مؤكدة من المعمل هي المرجع الرسمي؛ القيم المستخرجة آليًا بانتظار المراجعة.",
  "• عند أعراض حادة (ألم صدر، ضيق نفس، إغماء، نزيف): اتصل بالإسعاف 123 فورًا.",
  "• لعرض تفاصيل قيمك ومداها المرجعي ودرجة ثقة استخراجها: افتح التقرير من «سجلاتي» — وكل توصية فحص تظهر مع سببها ومصدرها وتاريخ اعتمادها.",
  "• أسئلة جيدة لطبيبك: هل نتيجتي تتطلب متابعة؟ متى أعيد الفحص؟ هل هناك فحص وقائي يناسب عمري وتاريخ عائلتي؟",
].join("\n");

export async function assistantReply(userId: string, message: string, history: Array<{ role: "USER" | "ASSISTANT"; content: string }>): Promise<{ reply: string; provider: string }> {
  const ctx = await buildContext(userId);
  const redactedMsg = redactPii(message, { names: ctx.names });

  const messages: ChatMessageLite[] = [
    { role: "system", content: `${ASSISTANT_SYSTEM}\n\n${ctx.text}` },
    ...history.slice(-8).map((h) => ({ role: (h.role === "USER" ? "user" : "assistant") as "user" | "assistant", content: redactPii(h.content, { names: ctx.names }) })),
    { role: "user", content: redactedMsg },
  ];

  const consented = await hasAiConsent(userId);
  let reply: string;
  let provider: string;
  if (consented) {
    try {
      const res = await aiChat(messages, {
        allowExternal: true,
        temperature: 0.5,
        maxTokens: 1200,
        builtinFallback: () => BUILTIN_GUIDE,
      });
      reply = res.content;
      provider = res.provider;
    } catch {
      reply = BUILTIN_GUIDE;
      provider = "builtin";
    }
  } else {
    // بلا موافقة AI_ANALYSIS: لا يخرج أي شيء لمزود خارجي — المولد المحلي فقط
    reply = BUILTIN_GUIDE;
    provider = "builtin";
  }

  await logAgentRun("ASSISTANT", {
    userId,
    status: "SUCCESS",
    provider,
    inputSummary: message.slice(0, 120),
    outputSummary: reply.slice(0, 120),
    meta: { externalAllowed: consented },
  });
  return { reply, provider };
}
