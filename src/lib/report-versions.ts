// ============================================================
// سلسلة إصدارات التقارير — الأصل محفوظ أبدًا، والتصحيح ينشئ إصدارًا جديدًا.
// ============================================================
import { db } from "@/lib/db";

export interface VersionSnapshot {
  id: string;
  rawName: string;
  value: number | null;
  valueText: string | null;
  unit: string | null;
  refLow: number | null;
  refHigh: number | null;
  flag: string;
}

export async function snapshotValues(reportId: string): Promise<string> {
  const values = await db.extractedValue.findMany({ where: { reportId } });
  const snap: VersionSnapshot[] = values.map((v) => ({
    id: v.id,
    rawName: v.rawName,
    value: v.value,
    valueText: v.valueText,
    unit: v.unit,
    refLow: v.refLow,
    refHigh: v.refHigh,
    flag: v.flag,
  }));
  return JSON.stringify(snap);
}

/** إنشاء إصدار أول عند إنشاء التقرير */
export async function createInitialVersion(report: { id: string; fileName: string; filePath: string; fileType: string; mimeType: string; fileSize: number }): Promise<void> {
  const valuesJson = await snapshotValues(report.id);
  await db.reportVersion.create({
    data: {
      reportId: report.id,
      version: 1,
      fileName: report.fileName,
      filePath: report.filePath,
      fileType: report.fileType,
      mimeType: report.mimeType,
      fileSize: report.fileSize,
      valuesJson,
      changeNote: "الإصدار الأصلي",
    },
  });
}

/**
 * تصحيح معمل → إصدار جديد يحل محل القديم بسلسلة محفوظة.
 * لا يمسح الأصل أبدًا — ويعلّم رأي الطبيب القديم «يحتاج مراجعة».
 */
export async function createCorrectionVersion(reportId: string, changeNote: string, createdById: string): Promise<number> {
  const report = await db.medicalReport.findUnique({ where: { id: reportId } });
  if (!report) throw new Error("REPORT_NOT_FOUND");
  const nextVersion = report.currentVersion + 1;
  const valuesJson = await snapshotValues(reportId);
  await db.reportVersion.create({
    data: {
      reportId,
      version: nextVersion,
      fileName: report.fileName,
      filePath: report.filePath,
      fileType: report.fileType,
      mimeType: report.mimeType,
      fileSize: report.fileSize,
      valuesJson,
      changeNote,
      createdById,
    },
  });
  await db.medicalReport.update({ where: { id: reportId }, data: { currentVersion: nextVersion } });

  // رأي الطبيب القديم يحتاج مراجعة بعد التصحيح
  const reviews = await db.doctorReview.findMany({ where: { reportId, needsReview: false } });
  for (const r of reviews) {
    await db.doctorReview.update({
      where: { id: r.id },
      data: { needsReview: true },
    });
    const log = safeParseLog(r.log);
    log.push({ action: "NEEDS_REVIEW_AFTER_CORRECTION", at: new Date().toISOString(), note: "نتيجة المعمل صححت — هذا الرأي يحتاج مراجعة" });
    await db.doctorReview.update({ where: { id: r.id }, data: { log: JSON.stringify(log) } });
    const { notify } = await import("@/lib/api-utils");
    await notify(r.doctorId, {
      type: "CORRECTION",
      titleAr: "نتيجة صححت — رأيك يحتاج مراجعة",
      titleEn: "Result corrected — your opinion needs review",
      bodyAr: "صحح المعمل قيم نتيجة راجعتها سابقًا — راجع الحالة مجددًا من صندوقك.",
      bodyEn: "The lab corrected values of a result you reviewed — review the case again in your inbox.",
      severity: "WARNING",
      link: "/doctor",
    });
  }
  return nextVersion;
}

function safeParseLog(s: string): Array<{ action: string; at: string; note: string }> {
  try {
    return JSON.parse(s) as Array<{ action: string; at: string; note: string }>;
  } catch {
    return [];
  }
}
