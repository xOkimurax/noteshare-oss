/**
 * The single image engine for Noteshare.
 *
 * Every image that enters the system — a user upload today, or a base64
 * data-URI pulled out of the old Firestore docs during migration — goes
 * through `toWebp()`. Nothing is ever stored without conversion.
 *
 * sharp, webp quality 82, longest side capped at 1600px.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { env } from '../env.js';

export const WEBP_QUALITY = 82;
export const MAX_DIMENSION = 1600;

export interface ProcessedImage {
  /** Path relative to the API origin, e.g. "/uploads/<uuid>.webp". */
  url: string;
  /** Absolute path on disk. */
  path: string;
  width: number;
  height: number;
  bytes: number;
}

let ensuredDir: Promise<string> | null = null;
function uploadsDir(): Promise<string> {
  if (!ensuredDir) {
    const dir = env.UPLOADS_DIR;
    ensuredDir = mkdir(dir, { recursive: true }).then(() => dir);
  }
  return ensuredDir;
}

/** Convert an arbitrary image buffer to a stored .webp file. */
export async function toWebp(input: Buffer): Promise<ProcessedImage> {
  const pipeline = sharp(input, { failOn: 'none' })
    .rotate() // honour EXIF orientation
    .resize({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: WEBP_QUALITY, effort: 4 });

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

  const dir = await uploadsDir();
  const name = `${randomUUID()}.webp`;
  await writeFile(join(dir, name), data);

  return {
    url: `/uploads/${name}`,
    path: join(dir, name),
    width: info.width,
    height: info.height,
    bytes: data.length,
  };
}

/** Parse a `data:` URI into a Buffer, or return null if it isn't one. */
export function dataUriToBuffer(uri: string): Buffer | null {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(uri);
  if (!m) return null;
  const isBase64 = Boolean(m[2]);
  return Buffer.from(m[3], isBase64 ? 'base64' : 'utf8');
}
