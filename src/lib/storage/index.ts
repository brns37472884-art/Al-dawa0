import { mkdir, writeFile, readFile, unlink, stat } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { getEnv } from "@/env";
import { db } from "@/lib/db";

/**
 * طبقة تخزين مجردة — متوافقة S3 (MinIO محليًا) أو محلي.
 * مزود S3 بعميل REST يدوي (AWS SigV4) — بلا مكتبات خارج إضافية.
 */

export interface StorageProvider {
  save(dir: string, name: string, data: Buffer): Promise<string>;
  read(storedPath: string): Promise<Buffer>;
  delete(storedPath: string): Promise<void>;
  size(storedPath: string): Promise<number | null>;
}

class LocalStorageProvider implements StorageProvider {
  private base: string;

  constructor(baseDir?: string) {
    const chosen = baseDir ?? process.env.STORAGE_LOCAL_DIR ?? "uploads";
    this.base = path.isAbsolute(chosen) ? chosen : path.join(process.cwd(), chosen);
  }

  async save(dir: string, name: string, data: Buffer): Promise<string> {
    // dir و name من السيرفر فقط — لا مدخل مستخدم في المسار
    const safeDir = dir.replace(/\.\./g, "").replace(/[^a-zA-Z0-9_\-/]/g, "_");
    const fullDir = path.join(this.base, safeDir);
    await mkdir(fullDir, { recursive: true });
    const safeName = name.replace(/\.\./g, "").replace(/[^a-zA-Z0-9_.\-]/g, "_");
    const full = path.join(fullDir, safeName);
    await writeFile(full, data);
    return path.join(safeDir, safeName);
  }

  private resolveInBase(storedPath: string): string {
    const resolved = path.isAbsolute(storedPath)
      ? path.resolve(storedPath)
      : path.resolve(this.base, storedPath.replace(/\.\./g, ""));
    if (!resolved.startsWith(path.resolve(this.base))) throw new Error("STORAGE_PATH_ESCAPE");
    return resolved;
  }

  async read(storedPath: string): Promise<Buffer> {
    return readFile(this.resolveInBase(storedPath));
  }

  async delete(storedPath: string): Promise<void> {
    try {
      await unlink(this.resolveInBase(storedPath));
    } catch {
      /* غير موجود */
    }
  }

  async size(storedPath: string): Promise<number | null> {
    try {
      const s = await stat(this.resolveInBase(storedPath));
      return s.size;
    } catch {
      return null;
    }
  }
}

/** تخزين في Postgres — مشترك بين app و worker ويصمد أمام إعادة النشر */
class DbStorageProvider implements StorageProvider {
  private key(dir: string, name: string) {
    return `${dir.replace(/\.\./g, "").replace(/[^a-zA-Z0-9_\-/]/g, "_")}/${name.replace(/\.\./g, "").replace(/[^a-zA-Z0-9_.\-]/g, "_")}`;
  }
  async save(dir: string, name: string, data: Buffer): Promise<string> {
    const key = this.key(dir, name);
    const bytes = new Uint8Array(data);
    await db.storedFile.upsert({
      where: { key },
      create: { key, data: bytes, size: data.length },
      update: { data: bytes, size: data.length },
    });
    return key;
  }
  async read(storedPath: string): Promise<Buffer> {
    const row = await db.storedFile.findUnique({ where: { key: storedPath } });
    if (!row) throw new Error("STORAGE_NOT_FOUND");
    return Buffer.from(row.data);
  }
  async delete(storedPath: string): Promise<void> {
    await db.storedFile.deleteMany({ where: { key: storedPath } });
  }
  async size(storedPath: string): Promise<number | null> {
    const row = await db.storedFile.findUnique({ where: { key: storedPath }, select: { size: true } });
    return row ? row.size : null;
  }
}

/** AWS SigV4 — توقيع طلبات S3 المتوافقة (MinIO) بلا مكتبات خارجية */
function sigV4Headers(
  method: string,
  url: URL,
  body: Buffer | null,
  accessKey: string,
  secretKey: string,
  region: string,
  service = "s3"
): Record<string, string> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = crypto.createHash("sha256").update(body ?? Buffer.alloc(0)).digest("hex");
  const canonicalUri = url.pathname;
  const canonicalQuery = url.search.replace(/^\?/, "");

  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const sortedKeys = Object.keys(headers).sort();
  const canonicalHeaders = sortedKeys.map((k) => `${k}:${headers[k]}\n`).join("");
  const signedHeaders = sortedKeys.join(";");

  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, crypto.createHash("sha256").update(canonicalRequest).digest("hex")].join("\n");

  const hmac = (key: Buffer | string, data: string) => crypto.createHmac("sha256", key).update(data).digest();
  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  return {
    ...headers,
    Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

class S3StorageProvider implements StorageProvider {
  private conf() {
    const env = getEnv();
    if (!env.S3_ENDPOINT || !env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
      throw new Error("S3_STORAGE_NOT_CONFIGURED: املأ S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY في .env");
    }
    return {
      endpoint: env.S3_ENDPOINT,
      bucket: env.S3_BUCKET,
      accessKey: env.S3_ACCESS_KEY_ID,
      secretKey: env.S3_SECRET_ACCESS_KEY,
      region: env.S3_REGION || "us-east-1",
      // path-style (الافتراضي): endpoint/bucket/key — يعمل مع MinIO وCloudflare R2
      // S3_FORCE_PATH_STYLE=false → virtual-host style (bucket كـ subdomain — مثل Railway Bucket)
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true").trim().toLowerCase() !== "false",
    };
  }

  /** بناء URL حسب نمط العنونة — path-style أو virtual-host style */
  private urlFor(c: { endpoint: string; bucket: string; forcePathStyle: boolean }, key: string): URL {
    const ep = c.endpoint.replace(/\/+$/, "");
    const k = key.replace(/^\/+/, "");
    if (c.forcePathStyle) return new URL(`${ep}/${c.bucket}/${k}`);
    const u = new URL(ep);
    u.hostname = `${c.bucket}.${u.hostname}`;
    u.pathname = `/${k}`;
    return u;
  }

  async save(dir: string, name: string, data: Buffer): Promise<string> {
    const c = this.conf();
    const key = `${dir.replace(/\.\./g, "").replace(/[^a-zA-Z0-9_\-/]/g, "_")}/${name.replace(/\.\./g, "").replace(/[^a-zA-Z0-9_.\-]/g, "_")}`;
    const url = this.urlFor(c, key);
    const headers = sigV4Headers("PUT", url, data, c.accessKey, c.secretKey, c.region);
    const res = await fetch(url, { method: "PUT", headers, body: new Uint8Array(data) });
    if (!res.ok) throw new Error(`S3_PUT_FAILED_${res.status}`);
    return key;
  }

  async read(storedPath: string): Promise<Buffer> {
    const c = this.conf();
    const url = this.urlFor(c, storedPath);
    const headers = sigV4Headers("GET", url, null, c.accessKey, c.secretKey, c.region);
    const res = await fetch(url, { method: "GET", headers });
    if (!res.ok) throw new Error(`S3_GET_FAILED_${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(storedPath: string): Promise<void> {
    const c = this.conf();
    const url = this.urlFor(c, storedPath);
    const headers = sigV4Headers("DELETE", url, null, c.accessKey, c.secretKey, c.region);
    await fetch(url, { method: "DELETE", headers }).catch(() => {});
  }

  async size(storedPath: string): Promise<number | null> {
    const c = this.conf();
    const url = this.urlFor(c, storedPath);
    const headers = sigV4Headers("HEAD", url, null, c.accessKey, c.secretKey, c.region);
    const res = await fetch(url, { method: "HEAD", headers }).catch(() => null);
    const len = res?.headers.get("content-length");
    return len ? Number(len) : null;
  }
}

/** الافتراضي: db في الإنتاج (آمن على Railway)، local في التطوير */
export function storage(): StorageProvider {
  let chosen: string | undefined;
  try {
    chosen = getEnv().STORAGE_PROVIDER;
  } catch {
    /* env غير جاهز (بناء) */
  }
  if (!chosen) chosen = process.env.NODE_ENV === "production" ? "db" : "local";
  // في الإنتاج "local" يضيع مع كل نشر ولا يراه الـ worker — نحوّله لـ db إلا لو STORAGE_ALLOW_LOCAL=true
  if (chosen === "local" && process.env.NODE_ENV === "production" && process.env.STORAGE_ALLOW_LOCAL !== "true") chosen = "db";
  if (chosen === "s3") return new S3StorageProvider();
  if (chosen === "db") return new DbStorageProvider();
  return new LocalStorageProvider();
}

export function generatedFileName(ext: string): string {
  const e = ext.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${e}`;
}
