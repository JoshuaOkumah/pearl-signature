import "server-only";
import { createHash } from "node:crypto";
import {
  ALLOWED_IMAGE_FORMATS,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  UPLOAD_FOLDER,
} from "@/lib/cloudinary/shared";

/**
 * Cloudinary upload authorization and asset verification (Phase 3).
 *
 * Upload model: **short-lived, server-signed direct browser uploads**.
 * 1. An authenticated admin action calls `signUpload()`; the browser uses
 *    those parameters to post the file straight to Cloudinary.
 * 2. The server fixes every signature parameter (folder, overwrite, unique
 *    filename) so a signed client cannot choose its own namespace.
 * 3. After the upload, `verifyUploadedAsset()` re-fetches the asset from
 *    Cloudinary's Admin API and returns the canonical metadata. Product
 *    records are built EXCLUSIVELY from this response — a forged client
 *    reply can never attach an arbitrary URL or foreign asset.
 *
 * The API secret exists only in `CLOUDINARY_API_SECRET` (server env), is
 * never returned to the browser, and never appears in logs. No unsigned
 * preset is used anywhere.
 *
 * If Cloudinary is not configured, every entry point reports
 * `CloudinaryNotConfiguredError` and the UI shows an honest "uploads are
 * not configured" state instead of failing silently.
 */

export { ALLOWED_IMAGE_FORMATS, MAX_IMAGE_BYTES, MAX_IMAGE_DIMENSION, UPLOAD_FOLDER };
const REQUEST_TIMEOUT_MS = 10_000;

export class CloudinaryNotConfiguredError extends Error {
  constructor() {
    super("Cloudinary uploads are not configured.");
    this.name = "CloudinaryNotConfiguredError";
  }
}

interface CloudinaryEnv {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

function readEnv(): CloudinaryEnv {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();
  if (!cloudName || !apiKey || !apiSecret) throw new CloudinaryNotConfiguredError();
  return { cloudName, apiKey, apiSecret };
}

export function isUploadConfigured(): boolean {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME?.trim() &&
      process.env.CLOUDINARY_API_KEY?.trim() &&
      process.env.CLOUDINARY_API_SECRET?.trim(),
  );
}

/* ── request signing ────────────────────────────────────────────────── */

export interface UploadSignature {
  cloudName: string;
  apiKey: string;
  uploadUrl: string;
  timestamp: number;
  folder: string;
  /** SHA-256 signature including `signature_algorithm=sha256`. */
  signature: string;
  signatureAlgorithm: "sha256";
}

/**
 * Produce upload parameters signed with the API secret. All signature
 * inputs are server-chosen: callers cannot override folder, filename
 * behaviour or timestamp window beyond Cloudinary's clock-skew limit.
 * Callers must hold a valid admin session (enforced by the action).
 */
export function signUpload(now = Date.now()): UploadSignature {
  const { cloudName, apiKey, apiSecret } = readEnv();
  const timestamp = Math.floor(now / 1000);

  const params: Record<string, string> = {
    folder: UPLOAD_FOLDER,
    timestamp: String(timestamp),
    unique_filename: "true",
    overwrite: "false",
  };

  const signable = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  const signature = createHash("sha256").update(signable + apiSecret, "utf8").digest("hex");

  return {
    cloudName,
    apiKey,
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    timestamp,
    folder: UPLOAD_FOLDER,
    signature,
    signatureAlgorithm: "sha256",
  };
}

/* ── authoritative asset verification ───────────────────────────────── */

export interface VerifiedAsset {
  publicId: string;
  secureUrl: string;
  format: string;
  bytes: number;
  width: number;
  height: number;
}

export type VerifyFailure =
  | "not_configured"
  | "not_found"
  | "wrong_folder"
  | "invalid_type"
  | "too_large"
  | "bad_dimensions"
  | "network";

interface CloudinaryResource {
  public_id?: string;
  folder?: string;
  format?: string;
  bytes?: number;
  width?: number;
  height?: number;
  secure_url?: string;
  type?: string;
  resource_type?: string;
}

/**
 * Re-fetch a freshly uploaded asset from Cloudinary and validate it
 * against the upload contract. Returns canonical metadata on success or a
 * safe failure code. This is the ONLY source of image fields written to
 * MongoDB for new uploads.
 */
export async function verifyUploadedAsset(publicId: string): Promise<VerifiedAsset | VerifyFailure> {
  let env: CloudinaryEnv;
  try {
    env = readEnv();
  } catch {
    return "not_configured";
  }

  try {
    const credentials = Buffer.from(`${env.apiKey}:${env.apiSecret}`).toString("base64");
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${env.cloudName}/resources/image/upload/${encodeURIComponent(publicId)}`,
      {
        method: "GET",
        headers: { Authorization: `Basic ${credentials}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (response.status === 404) return "not_found";
    if (!response.ok) return "network";

    const resource = (await response.json()) as CloudinaryResource;
    const folderOk = resource.folder
      ? resource.folder === UPLOAD_FOLDER || resource.folder.startsWith(`${UPLOAD_FOLDER}/`)
      : resource.public_id?.startsWith(`${UPLOAD_FOLDER}/`);
    if (!resource.public_id || !folderOk) return "wrong_folder";
    if (resource.type !== "upload" || resource.resource_type !== "image") return "invalid_type";

    const format = (resource.format ?? "").toLowerCase();
    if (!(ALLOWED_IMAGE_FORMATS as readonly string[]).includes(format)) return "invalid_type";
    if (typeof resource.bytes !== "number" || resource.bytes < 1 || resource.bytes > MAX_IMAGE_BYTES) {
      return "too_large";
    }
    const { width, height } = resource;
    if (
      typeof width !== "number" ||
      typeof height !== "number" ||
      width < 1 ||
      height < 1 ||
      width > MAX_IMAGE_DIMENSION ||
      height > MAX_IMAGE_DIMENSION
    ) {
      return "bad_dimensions";
    }
    const secureUrl = resource.secure_url ?? "";
    if (!secureUrl.startsWith(`https://res.cloudinary.com/${env.cloudName}/image/upload/`)) {
      return "invalid_type";
    }

    return {
      publicId: resource.public_id,
      secureUrl,
      format,
      bytes: resource.bytes,
      width,
      height,
    };
  } catch {
    return "network";
  }
}

/**
 * Best-effort destructive cleanup of an unverified/removed asset.
 * Returns `false` when Cloudinary could not be reached — callers treat
 * that as "reconcile later" (see docs/CLOUDINARY_UPLOADS.md).
 */
export async function destroyAsset(publicId: string): Promise<boolean> {
  let env: CloudinaryEnv;
  try {
    env = readEnv();
  } catch {
    return false;
  }

  try {
    const credentials = Buffer.from(`${env.apiKey}:${env.apiSecret}`).toString("base64");
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${env.cloudName}/resources/image/upload`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ public_id: publicId, invalidate: true }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    // Already-deleted counts as cleaned up.
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}
