"use client";
import { useParams } from "next/navigation";
import { ReportDetailPage } from "@/components/pages/patient/patient-pages";

export default function Page() {
  const params = useParams<{ id: string }>();
  return <ReportDetailPage id={String(params?.id ?? "")} />;
}
