"use client";
import { useSession } from "@/hooks/use-session";
import { useLang } from "@/lib/i18n";
import { NotificationsContent, NotificationsPage } from "@/components/pages/patient/patient-pages2";
import { DoctorShell } from "@/components/pages/doctor-dashboard";
import { AdminShell } from "@/components/pages/admin-dashboard";
import { OfficerShell } from "@/components/pages/officer-dashboard";
import { LabShell } from "@/components/pages/lab-dashboard";

/** إشعارات حسب الدور — كل دور داخل لوحته الخاصة (بدل صفحة المريض للجميع) */
export default function Page() {
  const { user, loading } = useSession();
  const { t } = useLang();
  if (loading) return <div className="p-10 text-center text-muted">{t("common.loading")}</div>;
  const role = user?.role;
  const body = <NotificationsContent />;
  if (role === "DOCTOR") return <DoctorShell>{body}</DoctorShell>;
  if (role === "ADMIN") return <AdminShell>{body}</AdminShell>;
  if (role === "MEDICAL_OFFICER") return <OfficerShell>{body}</OfficerShell>;
  if (role === "LAB" || role === "LAB_SUPERVISOR") return <LabShell>{body}</LabShell>;
  return <NotificationsPage />;
}
