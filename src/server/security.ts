import { createHash, randomBytes } from "node:crypto";
import sharp from "sharp";
import { integerEnv } from "./config";

export class StudyError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

export function stableHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function hashStudyCode(value: string) {
  return stableHash(value.trim().toUpperCase());
}

export function newToken() {
  return randomBytes(32).toString("base64url");
}

export function maxImageBytes() {
  return integerEnv("MAX_IMAGE_UPLOAD_BYTES", 3 * 1024 * 1024, 1024, 8 * 1024 * 1024);
}

const safeRaster = /^data:image\/(png|jpeg|webp);base64,([a-z0-9+/]+={0,2})$/i;

export function readImageData(dataUrl: string, limit = maxImageBytes()) {
  if (dataUrl.length > Math.ceil(limit / 3) * 4 + 32) {
    throw new StudyError("The image exceeds the configured upload size.", 413);
  }
  const match = safeRaster.exec(dataUrl);
  if (!match || match[2].length % 4 !== 0) throw new StudyError("Use a PNG, JPEG, or WebP image.");
  const data = Buffer.from(match[2], "base64");
  if (data.length < 10 || data.length > limit) throw new StudyError("The image size is invalid.", 413);
  return { data, format: match[1].toLowerCase() };
}

export async function validateImageData(dataUrl: string, limit = maxImageBytes()) {
  const { data, format } = readImageData(dataUrl, limit);
  try {
    const image = sharp(data, { limitInputPixels: 16_000_000, failOn: "error" });
    const metadata = await image.metadata();
    if (metadata.format !== format || (metadata.pages ?? 1) > 1) throw new Error("format mismatch");
    const cleaned = await image.rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 90 }).toBuffer();
    if (cleaned.length > limit) throw new Error("size after sanitization");
    return `data:image/webp;base64,${cleaned.toString("base64")}`;
  } catch {
    throw new StudyError("The image could not be validated. Try a smaller PNG, JPEG, or WebP image.");
  }
}
