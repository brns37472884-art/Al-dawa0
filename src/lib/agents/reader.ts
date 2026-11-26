// ============================================================
// وكيل قارئ التقارير — استخراج القيم من PDF/صور.
// المسار المحلي بلا مزود خارجي: pdftotext + محلل نصي حتمي.
// الصور بلا مزود خارجي: FAILED برسالة واضحة (الإدخال اليدوي من المعمل).
// درجات ثقة + تمييز «مستخرج آليًا» عن «موثّق من المعمل».
// ============================================================
import { execFile } from "child_process";
import { db } from "@/lib/db";
import { getApprovedCriticalRules, matchCriticalRule } from "@/lib/safety/critical";
import { runImmediateSafetyCheck } from "@/lib/safety/flow";
import { recordAndPublish } from "@/lib/events";
import { logAgentRun } from "@/lib/api-utils";
import { hasAiConsent } from "@/lib/privacy";
import { redactPii } from "@/lib/privacy";
import { aiChat, aiVision, extractJson, type ChatMessageLite } from "@/lib/ai/provider";
import { storage } from "@/lib/storage";
import { flagImagePii } from "@/lib/privacy";

interface ExtractedRow {
  name: string;
  value?: number | null;
  valueText?: string | null;
  unit?: string | null;
  refLow?: number | null;
  refHigh?: number | null;
  refText?: string | null;
  section?: string | null;
  confidence?: number;
}

interface Extraction {
  reportType: "LAB" | "RADIOLOGY" | "OTHER";
  labName?: string | null;
  testDate?: string | null;
  values: ExtractedRow[];
  findings?: string | null;
  impression?: string | null;
  engine: string;
  pages?: number;
}

function pdftotextAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("pdftotext", ["-v"], { timeout: 5000 }, (err) => resolve(!err || (err as { code?: number }).code !== 127));
  });
}

// pdftotext يحتاج ملفًا — نكتب ملفًا مؤقتًا بأسماء مولّدة في tmp ثم نحذفه
import { mkdtemp, writeFile, rm } from "fs/promises";
import os from "os";
import path from "path";

function pdfToText(buf: Buffer, timeoutMs = 30_000): Promise<string> {
  return new Promise(async (resolve, reject) => {
    let dir: string | null = null;
    try {
      dir = await mkdtemp(path.join(os.tmpdir(), "aldawa-pdf-"));
      const pdfPath = path.join(dir, "input.pdf");
      const outPath = path.join(dir, "out");
      await writeFile(pdfPath, buf);
      execFile("pdftotext", ["-layout", pdfPath, outPath], { timeout: timeoutMs }, (err) => {
        if (err) {
          reject(err);
          return;
        }
        import("fs/promises")
          .then((fs) => fs.readFile(outPath, "utf8"))
          .then((txt) => resolve(txt))
          .catch(reject);
      });
    } catch (e) {
      reject(e);
    } finally {
      if (dir) rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });
}

// ---------- المحلل المحلي الحتمي (بلا شبكة) ----------
function parseTextLocally(text: string, catalog: Array<{ key: string; nameAr: string; nameEn: string; unit: string; refLow: number | null; refHigh: number | null; category: string }>): Extraction {
  const values: ExtractedRow[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const l = line.trim();
    if (l.length < 5 || !/\d/.test(l)) continue;
    // نمط شائع: اسم الفحص  القيمة  الوحدة  المدى (مثل: 12.5  g/dL  12 - 17)
    const m = l.match(/^(.{3,60}?)\s+([\d.]+)\s*([a-zA-Zµ%°/³²¹]{1,12})?\s+(?:(\d+\.?\d*)\s*[-–]\s*(\d+\.?\d*))?/);
    if (!m) continue;
    const name = m[1].replace(/[|:]+$/, "").trim();
    const value = Number(m[2]);
    if (!name || !Number.isFinite(value) || name.length < 3) continue;
    let canonical: (typeof catalog)[number] | null = null;
    for (const c of catalog) {
      if (name.includes(c.nameAr) || name.toLowerCase().includes(c.nameEn.toLowerCase())) {
        canonical = c;
        break;
      }
    }
    values.push({
      name,
      value,
      unit: m[3] || canonical?.unit || null,
      refLow: m[4] ? Number(m[4]) : canonical?.refLow ?? null,
      refHigh: m[5] ? Number(m[5]) : canonical?.refHigh ?? null,
      confidence: canonical ? 0.8 : 0.55,
    });
  }
  return { reportType: "LAB", values, engine: "pdftotext+local-parser", pages: 1 };
}

// ---------- المطالبة النصية للمزود الخارجي ----------
function buildExtractionPrompt(catalogKeys: string): string {
  return [
    "أنت مستخرج بيانات تقارير طبية. استخرج فقط ما هو ظاهر في النص حرفيًا — لا تخمّن أبدًا.",
    "أعد JSON فقط بالشكل: {\"reportType\":\"LAB|RADIOLOGY|OTHER\",\"labName\":string|null,\"testDate\":string|null,\"values\":[{\"name\":string,\"value\":number|null,\"valueText\":string|null,\"unit\":string|null,\"refLow\":number|null,\"refHigh\":number|null,\"refText\":string|null,\"section\":string|null,\"confidence\":number}],\"findings\":string|null,\"impression\":string|null}",
    "confidence بين 0 و1 (0.9+ للطباعة الواضحة). تقارير الأشعة: findings/impression و values ف [].",
    "مفاتيح الكتالوج المعروفة (لربط canonicalKey إن تطاب الاسم):",
    catalogKeys,
  ].join("\n");
}

const SYSTEM_READER: ChatMessageLite = {
  role: "system",
  content:
    "أنت مستخرج بيانات من تقارير طبية. لا تشخّص ولا توصي ولا تفسر — استخرج فقط ما هو مكتوب حرفيًا، ولا تخمّن قيمة غير موجودة. أعد JSON فقط.",
};

/** معالجة تقرير: استخراج → تحقق → حفظ → فحص أمان فوري */
export async function processReport(reportId: string): Promise<void> {
  const started = Date.now();
  // 1) مطالبة سباقية — منع معالجة مزدوجة
  const claimed = await db.medicalReport.updateMany({
    where: { id: reportId, status: { in: ["UPLOADED", "FAILED"] } },
    data: { status: "PROCESSING", processingStep: "OCR" },
  });
  if (claimed.count === 0) return;

  const report = await db.medicalReport.findUnique({
    where: { id: reportId },
    include: { owner: { select: { id: true, fullName: true } } },
  });
  if (!report) return;
  const catalog = await db.testCatalog.findMany({ where: { isActive: true } });

  try {
    const aiAllowed = await hasAiConsent(report.ownerUserId);
    let extraction: Extraction | null = null;
    let imagePrivacyNote: string | null = null;

    if (report.fileType === "pdf" && report.filePath) {
      if (!(await pdftotextAvailable())) {
        throw new Error("PDFTOTEXT_MISSING: أدوات poppler غير متوفرة على الخادم");
      }
      const buf = await storage().read(report.filePath);
      const text = await pdfToText(buf);
      const cleanText = text.length > 250 && /\d/.test(text) ? text : "";
      if (cleanText) {
        const redacted = redactPii(cleanText.slice(0, 12_000), { names: [report.owner.fullName] });
        const catalogKeys = catalog.map((c) => `${c.key}:${c.nameAr}/${c.nameEn}`).join("; ").slice(0, 3000);
        const prompt = buildExtractionPrompt(catalogKeys);
        if (aiAllowed) {
          try {
            const res = await aiChat(
              [SYSTEM_READER, { role: "user", content: `${prompt}\n\n---\n${redacted}` }],
              { json: true, temperature: 0.1, allowExternal: true, builtinFallback: () => JSON.stringify(parseTextLocally(cleanText, catalog)) }
            );
            const parsed = extractJson(res.content) as Extraction | null;
            if (parsed?.values) {
              extraction = { ...parsed, engine: `pdftotext+llm(${res.provider})`, pages: 1 };
            }
          } catch {
            extraction = parseTextLocally(cleanText, catalog);
          }
        } else {
          // بلا موافقة AI: المحلل المحلي الحتمي فقط
          extraction = parseTextLocally(cleanText, catalog);
        }
      } else {
        // نص قصير → يلزم مزود رؤية خارجي (بموافقة) وإلا FAILED
        if (aiAllowed) {
          throw new Error("NEEDS_VISION: PDF صوري — يتطلب مزود رؤية خارجي مضبوطًا");
        }
        throw new Error("CONSENT_REQUIRED_IMAGE: PDF صوري وتحليل الصور يحتاج موافقة AI_ANALYSIS — استخدم الإدخال اليدوي من المعمل");
      }
    } else if (["jpg", "jpeg", "png"].includes(report.fileType) && report.filePath) {
      // الصورة لا تُجرَّد PII — موافقة AI شرط، والشكل الخارجي فقط
      if (!aiAllowed) {
        await logAgentRun("READER", { userId: report.ownerUserId, status: "FAILED", provider: "none", inputSummary: report.fileName, outputSummary: "IMAGE_CONSENT_REQUIRED", meta: { reportId } });
        throw new Error("IMAGE_CONSENT_REQUIRED: صور التقارير تحتاج موافقة «تحليل الذكاء الاصطناعي» — أو الإدخال اليدوي من المعمل");
      }
      const buf = await storage().read(report.filePath);
      const note = flagImagePii();
      imagePrivacyNote = note.noteAr;
      const prompt = buildExtractionPrompt(catalog.map((c) => `${c.key}:${c.nameAr}/${c.nameEn}`).join("; ").slice(0, 2500));
      const res = await aiVision(prompt, buf.toString("base64"), report.mimeType, { allowExternal: true });
      const parsed = extractJson(res.content) as Extraction | null;
      if (!parsed?.values) throw new Error("VISION_EMPTY_RESULT");
      extraction = { ...parsed, engine: `vision(${res.provider})`, pages: 1 };
    } else {
      // إدخال معمل يدوي (بلا ملف) — لا استخراج
      extraction = null;
    }

    if (extraction) {
      // 4) تحقق وتطبيع القيم مقابل الكتالوج
      const approved = await getApprovedCriticalRules();
      const saved: ExtractedRow[] = [];
      for (const raw of extraction.values.slice(0, 80)) {
        const name = String(raw.name ?? "").slice(0, 200);
        if (!name) continue;
        const value = raw.value !== undefined && raw.value !== null && Number.isFinite(Number(raw.value)) ? Number(raw.value) : null;
        if (value === null && !raw.valueText) continue;
        let canonicalKey: string | null = null;
        for (const c of catalog) {
          if (name.includes(c.nameAr) || name.toLowerCase().includes(c.nameEn.toLowerCase()) || name.toLowerCase() === c.key.toLowerCase()) {
            canonicalKey = c.key;
            break;
          }
        }
        const cat = canonicalKey ? catalog.find((c) => c.key === canonicalKey) : undefined;
        const refLow = raw.refLow ?? cat?.refLow ?? null;
        const refHigh = raw.refHigh ?? cat?.refHigh ?? null;
        const unit = raw.unit || cat?.unit || null;
        let confidence = typeof raw.confidence === "number" && raw.confidence >= 0 && raw.confidence <= 1 ? raw.confidence : 0.7;
        if (cat && unit && cat.unit && unit.toLowerCase() !== cat.unit.toLowerCase()) confidence = Math.min(confidence, 0.6);
        saved.push({ ...raw, name, value, unit, refLow, refHigh, confidence });
      }

      if (!saved.length) throw new Error("EMPTY_EXTRACTION");

      // 5) حفظ — القيم القديمة تُستبدل فقط عند استخراج غير فارغ
      await db.extractedValue.deleteMany({ where: { reportId } });
      for (const s of saved) {
        const ck = (() => {
          for (const c of catalog) {
            if (s.name.includes(c.nameAr) || s.name.toLowerCase().includes(c.nameEn.toLowerCase())) return c.key;
          }
          return null;
        })();
        const v2 = s.value ?? null;
        const rL = s.refLow ?? null;
        const rH = s.refHigh ?? null;
        let flag = "UNKNOWN";
        if (v2 !== null && rL !== null && rH !== null) {
          flag = v2 > rH ? "HIGH" : v2 < rL ? "LOW" : "NORMAL";
          const rule = await matchCriticalRule(ck, v2, approved);
          if (rule) flag = rule.op === ">" ? "CRITICAL_HIGH" : "CRITICAL_LOW";
        }
        await db.extractedValue.create({
          data: {
            reportId,
            canonicalKey: ck,
            rawName: s.name,
            value: s.value,
            valueText: s.value === null && s.valueText ? String(s.valueText).slice(0, 60) : null,
            unit: s.unit,
            refLow: s.refLow,
            refHigh: s.refHigh,
            flag,
            confidence: s.confidence,
            verification: "PENDING",
            section: s.section ?? null,
            testDate: extraction.testDate ? new Date(extraction.testDate) : report.testDate,
          },
        });
      }

      const meta: Record<string, unknown> = {
        engine: extraction.engine,
        pages: extraction.pages ?? 1,
        reportType: extraction.reportType,
        durationMs: Date.now() - started,
        findings: extraction.findings ?? null,
        impression: extraction.impression ?? null,
      };
      if (imagePrivacyNote) meta.imagePrivacyNote = imagePrivacyNote;
      await db.medicalReport.update({
        where: { id: reportId },
        data: {
          status: "EXTRACTED",
          processingStep: null,
          processedAt: new Date(),
          extractionMeta: JSON.stringify(meta),
          reportType: extraction.reportType || report.reportType,
          ...(extraction.labName ? { labName: extraction.labName } : {}),
        },
      });
      await recordAndPublish({ type: "REPORT_EXTRACTED", reportId, patientId: report.ownerUserId, labId: report.labId });
      await logAgentRun("READER", { userId: report.ownerUserId, status: "SUCCESS", provider: meta.engine as string, inputSummary: report.fileName, outputSummary: `${saved.length} values extracted`, durationMs: Date.now() - started, meta: { reportId } });
      // فحص الأمان فور الاستخراج — قبل تأكيد المستخدم
      await runImmediateSafetyCheck(reportId);
    } else {
      // إدخال يدوي من المعمل — الحالة تظل كما هي
      await db.medicalReport.update({ where: { id: reportId }, data: { processingStep: null } });
    }
  } catch (e) {
    // فشل آمن — لا تُمسح القيم القديمة إن وجدت
    const existing = await db.extractedValue.count({ where: { reportId } });
    const msg = e instanceof Error ? e.message : "EXTRACTION_FAILED";
    await db.medicalReport.update({
      where: { id: reportId },
      data: {
        status: existing > 0 ? "EXTRACTED" : "FAILED",
        processingStep: null,
        extractionMeta: JSON.stringify({ error: msg.slice(0, 300), durationMs: Date.now() - started }),
      },
    });
    await logAgentRun("READER", { userId: report.ownerUserId, status: "FAILED", provider: "none", inputSummary: report.fileName, outputSummary: msg.slice(0, 200), meta: { reportId } });
    await recordAndPublish({ type: "REPORT_EXTRACTED", reportId, patientId: report.ownerUserId, labId: report.labId, payload: { failed: true } });
  }
}

/** إنشاء تقرير من إدخال قيم يدوي — مصدره المعمل (ثقة كاملة بعد التأكيد) */
export async function saveManualValues(
  reportId: string,
  manualValues: Array<{ name: string; value?: unknown; valueText?: string; unit?: string; refLow?: unknown; refHigh?: unknown }>,
  testDate: Date | null
): Promise<number> {
  const catalog = await db.testCatalog.findMany({ where: { isActive: true } });
  const approved = await getApprovedCriticalRules();
  let count = 0;
  for (const mv of manualValues.slice(0, 60)) {
    const rawName = String(mv.name ?? "").slice(0, 200);
    if (!rawName) continue;
    const value = mv.value !== undefined && mv.value !== null && String(mv.value).trim() !== "" ? Number(mv.value) : null;
    if (value === null && !mv.valueText) throw new Error("INVALID_VALUE");
    if (Number.isNaN(value ?? 0) || Number.isNaN(Number(mv.refLow ?? 0)) || Number.isNaN(Number(mv.refHigh ?? 0))) throw new Error("INVALID_VALUE");
    const refLowN = mv.refLow !== undefined && mv.refLow !== "" && mv.refLow !== null ? Number(mv.refLow) : null;
    const refHighN = mv.refHigh !== undefined && mv.refHigh !== "" && mv.refHigh !== null ? Number(mv.refHigh) : null;
    if (refLowN !== null && refHighN !== null && refLowN > refHighN) throw new Error("INVALID_RANGE");
    let canonicalKey: string | null = null;
    for (const c of catalog) {
      if (rawName.includes(c.nameAr) || rawName.toLowerCase().includes(c.nameEn.toLowerCase()) || rawName.toLowerCase() === c.key.toLowerCase()) {
        canonicalKey = c.key;
        break;
      }
    }
    const cat = canonicalKey ? catalog.find((c) => c.key === canonicalKey) : undefined;
    const refLow = refLowN ?? cat?.refLow ?? null;
    const refHigh = refHighN ?? cat?.refHigh ?? null;
    const unit = mv.unit ? String(mv.unit).slice(0, 30) : cat?.unit ?? null;
    let flag = "UNKNOWN";
    if (value !== null && refLow !== null && refHigh !== null) {
      flag = value > refHigh ? "HIGH" : value < refLow ? "LOW" : "NORMAL";
      if (canonicalKey) {
        const rule = await matchCriticalRule(canonicalKey, value, approved);
        if (rule) flag = rule.op === ">" ? "CRITICAL_HIGH" : "CRITICAL_LOW";
      }
    }
    await db.extractedValue.create({
      data: {
        reportId,
        canonicalKey,
        rawName,
        value,
        valueText: value === null && mv.valueText ? String(mv.valueText).slice(0, 60) : null,
        unit,
        refLow,
        refHigh,
        flag,
        confidence: 1,
        verification: "PENDING",
        section: cat?.category ?? null,
        testDate,
      },
    });
    count++;
  }
  return count;
}
