import { db } from "@/lib/db";
import { logAudit } from "@/lib/api-utils";
import { maskPhone } from "@/lib/helpers";

/**
 * طبقة الإشعارات — IN_APP (قاعدة البيانات) + SMS/WhatsApp بمزود وهمي.
 * قاعدة صارمة: لا قيمة طبية ولا رقم ولا اسم في أي رسالة صادرة — إشارة لفتح التطبيق فقط.
 */

export type OutChannel = "SMS" | "WHATSAPP";

interface OutboundMessage {
  channel: OutChannel;
  to: string;
  template: "RESULT_READY" | "SCREENING_DUE" | "PENDING_INVITE" | "CRITICAL_ALERT";
  lang?: "ar" | "en";
}

const TEMPLATES: Record<OutboundMessage["template"], Record<"ar" | "en", string>> = {
  RESULT_READY: {
    ar: "الدواء: نتيجتك جاهزة على المنصة. افتح التطبيق للاطلاع.",
    en: "Al Dawa: Your result is ready on the platform. Open the app to view it.",
  },
  SCREENING_DUE: {
    ar: "الدواء: حان موعد فحص وقائي مستحق لك. افتح التطبيق للتفاصيل.",
    en: "Al Dawa: A preventive screening is due. Open the app for details.",
  },
  PENDING_INVITE: {
    ar: "الدواء: لديك نتيجة تحليل بانتظار استلامك. سجّل عبر الرابط مطابقًا رقم موبايلك لاستلامها: {link}",
    en: "Al Dawa: A lab result is waiting for you. Register with the same mobile number to receive it: {link}",
  },
  CRITICAL_ALERT: {
    ar: "الدواء: تنبيه مهم بخصوص نتيجة من نتائجك — افتح التطبيق فورًا. للأعراض الحادة: الإسعاف 123.",
    en: "Al Dawa: An important alert about one of your results — open the app now. For acute symptoms: emergency 123.",
  },
};

async function sendViaSms(to: string, text: string): Promise<boolean> {
  const provider = process.env.SMS_PROVIDER || "mock";
  if (provider === "mock") {
    console.log(`[SMS:mock] to=${maskPhone(to)} :: ${text}`);
    return true;
  }
  // TODO(production): استبدل باستدعاء مزود SMS المتعاقد عليه — المتغيرات في .env فقط
  console.log(`[SMS:${provider}] (غير مفعّل بعد) to=${maskPhone(to)}`);
  return false;
}

async function sendViaWhatsapp(to: string, text: string): Promise<boolean> {
  const provider = process.env.WHATSAPP_PROVIDER || "mock";
  if (provider === "mock") {
    console.log(`[WhatsApp:mock] to=${maskPhone(to)} :: ${text}`);
    return true;
  }
  console.log(`[WhatsApp:${provider}] (غير مفعّل بعد) to=${maskPhone(to)}`);
  return false;
}

export async function hasNotificationsConsent(userId: string): Promise<boolean> {
  const c = await db.consent.findUnique({ where: { userId_type: { userId, type: "NOTIFICATIONS" } } });
  return !!c?.granted;
}

export async function sendOutbound(msg: OutboundMessage, opts?: { userId?: string; link?: string }): Promise<boolean> {
  const lang = msg.lang ?? "ar";
  if (opts?.userId && !(await hasNotificationsConsent(opts.userId))) {
    await logAudit("NOTIF_SKIPPED_NO_CONSENT", { actorUserId: opts.userId ?? null, meta: { channel: msg.channel, template: msg.template } });
    return false;
  }
  let text = TEMPLATES[msg.template][lang];
  if (opts?.link) text = text.replace("{link}", opts.link);
  const ok = msg.channel === "SMS" ? await sendViaSms(msg.to, text) : await sendViaWhatsapp(msg.to, text);
  await logAudit("OUTBOUND_SENT", {
    actorUserId: opts?.userId ?? null,
    entityType: "Notification",
    meta: { channel: msg.channel, template: msg.template, ok, to: maskPhone(msg.to) },
  });
  return ok;
}

/** إشعار داخلي + قناة صادرة معًا */
export async function notifyResultReady(userId: string, link: string, severity: "INFO" | "URGENT" = "INFO"): Promise<void> {
  const { notify } = await import("@/lib/api-utils");
  await notify(userId, {
    type: severity === "URGENT" ? "RESULT_ATTENTION" : "REPORT_UPLOADED",
    titleAr: severity === "URGENT" ? "تنبيه مهم بخصوص نتيجتك" : "نتيجتك جاهزة على الدواء",
    titleEn: severity === "URGENT" ? "Important alert about your result" : "Your result is ready on Al Dawa",
    bodyAr:
      severity === "URGENT"
        ? "توجد نتيجة تحتاج اطلاعك العاجل. للأعراض الحادة: الإسعاف 123."
        : "وصلتك نتيجة جديدة — افتح التقرير لمشاهدة الشرح والمقارنة.",
    bodyEn:
      severity === "URGENT"
        ? "A result needs your urgent attention. For acute symptoms: emergency 123."
        : "A new result arrived — open the report for explanation and comparison.",
    severity,
    link,
  });
  const user = await db.user.findUnique({ where: { id: userId }, select: { phone: true, locale: true } });
  if (user?.phone) {
    await sendOutbound(
      {
        channel: "SMS",
        to: user.phone,
        template: severity === "URGENT" ? "CRITICAL_ALERT" : "RESULT_READY",
        lang: (user.locale as "ar" | "en") || "ar",
      },
      { userId, link }
    );
  }
}
