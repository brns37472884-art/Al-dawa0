import pino from "pino";

/**
 * سجلات pino بلا بيانات شخصية.
 * قاعدة صارمة: لا رقم موبايل، لا اسم، لا قيمة طبية، لا رمز OTP في أي سجل.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: {
    paths: [
      "password",
      "*.password",
      "passwordHash",
      "*.passwordHash",
      "code",
      "*.code",
      "otp",
      "*.otp",
      "token",
      "*.token",
      "authorization",
      "*.authorization",
      "phone",
      "*.phone",
      "email",
      "*.email",
      "value",
      "*.value",
      "valueText",
      "*.valueText",
    ],
    censor: "[REDACTED]",
  },
});
