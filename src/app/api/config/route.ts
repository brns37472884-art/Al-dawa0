import { getSettingBool } from "@/lib/settings";
import { emailVerificationRequired } from "@/lib/flags";

/** GET /api/config — إعدادات عامة يحتاجها العميل (بلا أي بيانات حساسة) */
export async function GET() {
  const allowPatientUpload = await getSettingBool("ALLOW_PATIENT_UPLOAD");
  return Response.json({ allowPatientUpload, emailVerificationRequired: emailVerificationRequired() });
}
