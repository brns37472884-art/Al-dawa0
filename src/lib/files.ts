/**
 * التحقق من الملفات المرفوعة — بصمة المحتوى الحقيقية (Magic Bytes).
 * الامتداد وحده لا يُعتمد أبدًا — ملف تنفيذي باسم .png يُرفض هنا.
 */
export type RealFileType = "pdf" | "jpg" | "png" | null;

export function detectRealType(buf: Buffer): RealFileType {
  if (buf.length < 8) return null;
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return "pdf"; // %PDF
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg"; // JPEG
  return null;
}

export const REPORT_ALLOWED_EXT = ["pdf", "jpg", "jpeg", "png"];
export const REPORT_MAX_SIZE = 15 * 1024 * 1024; // 15MB
export const REPORT_MAX_FILES = 5; // رفع تقرير أو أكثر مرة واحدة
