/**
 * Sibling to image.ts's toWebp(), but for voice messages: a voice note is
 * saved AS-IS (no re-encode/processing — writeFile the buffer straight to
 * disk), since re-encoding audio server-side isn't worth the complexity for
 * this feature and MediaRecorder's output is already a reasonably-sized
 * compressed format (opus/webm, aac/m4a, etc.).
 */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '../env.js';

export interface ProcessedAudio {
  /** Path relative to the API origin, e.g. "/uploads/<uuid>.webm". */
  url: string;
  /** Absolute path on disk. */
  path: string;
  bytes: number;
}

// MediaRecorder's actual output mimetype varies by browser (Chrome defaults
// to "audio/webm;codecs=opus", Safari tends to produce "audio/mp4"). Map the
// common ones to a sane extension; anything unrecognised falls back to
// .webm — still a valid, playable file even if the extension is a guess.
function extensionFor(mimetype: string): string {
  const base = mimetype.split(';')[0]?.trim().toLowerCase();
  switch (base) {
    case 'audio/mp4':
    case 'audio/x-m4a':
      return '.m4a';
    case 'audio/ogg':
      return '.ogg';
    case 'audio/mpeg':
      return '.mp3';
    case 'audio/wav':
    case 'audio/x-wav':
      return '.wav';
    case 'audio/webm':
    default:
      return '.webm';
  }
}

let ensuredDir: Promise<string> | null = null;
function uploadsDir(): Promise<string> {
  if (!ensuredDir) {
    const dir = env.UPLOADS_DIR;
    ensuredDir = mkdir(dir, { recursive: true }).then(() => dir);
  }
  return ensuredDir;
}

/** Save a raw audio upload buffer to disk, unmodified. */
export async function saveAudio(input: Buffer, mimetype: string): Promise<ProcessedAudio> {
  const dir = await uploadsDir();
  const name = `${randomUUID()}${extensionFor(mimetype)}`;
  const path = join(dir, name);
  await writeFile(path, input);

  return {
    url: `/uploads/${name}`,
    path,
    bytes: input.length,
  };
}
