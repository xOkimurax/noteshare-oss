import { unlink } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { env } from '../env.js';
import { ah, HttpError, requireViewer } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { canWriteMemo, memoAudience } from '../lib/access.js';
import { memoInclude, serializeMemo, type FullMemo } from '../lib/serialize.js';
import { toWebp } from '../lib/image.js';
import { publish } from '../lib/sse.js';
import { requireAuth } from '../middleware/auth.js';

// Mounted at /api/memos/:id/images
export const imagesRouter = Router({ mergeParams: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    cb(null, file.mimetype.startsWith('image/'));
  },
});

async function loadWritableMemo(id: string, viewer: { id: string; email: string }) {
  const memo = await prisma.memo.findUnique({ where: { id }, include: memoInclude });
  if (!memo) throw new HttpError(404, 'memo not found');
  if (!canWriteMemo(memo as FullMemo, viewer)) throw new HttpError(403, 'forbidden');
  return memo as FullMemo;
}

// POST /api/memos/:id/images   (multipart, field name "images" or "image")
imagesRouter.post(
  '/',
  requireAuth,
  upload.fields([
    { name: 'images', maxCount: 10 },
    { name: 'image', maxCount: 10 },
  ]),
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const memo = await loadWritableMemo(req.params.id, viewer);

    const files = [
      ...(((req.files as Record<string, Express.Multer.File[]>)?.images) ?? []),
      ...(((req.files as Record<string, Express.Multer.File[]>)?.image) ?? []),
    ];
    if (!files.length) throw new HttpError(400, 'no image files');

    let position =
      memo.images.reduce((max, i) => Math.max(max, i.position), -1) + 1;

    for (const file of files) {
      const processed = await toWebp(file.buffer);
      await prisma.memoImage.create({
        data: {
          memoId: memo.id,
          url: processed.url,
          position: position++,
          width: processed.width,
          height: processed.height,
          bytes: processed.bytes,
        },
      });
    }
    await prisma.memo.update({
      where: { id: memo.id },
      data: { updatedAt: new Date() },
    });

    const fresh = (await prisma.memo.findUnique({
      where: { id: memo.id },
      include: memoInclude,
    })) as FullMemo;
    publish(memoAudience(fresh), { type: 'memo.changed', id: memo.id });
    res.status(201).json(serializeMemo(fresh, viewer));
  }),
);

// DELETE /api/memos/:id/images/:imageId
imagesRouter.delete(
  '/:imageId',
  requireAuth,
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const memo = await loadWritableMemo(req.params.id, viewer);
    const image = memo.images.find((i) => i.id === req.params.imageId);
    if (!image) throw new HttpError(404, 'image not found');

    await prisma.memoImage.delete({ where: { id: image.id } });
    // Best-effort file cleanup (url is "/uploads/<name>").
    unlink(join(env.UPLOADS_DIR, basename(image.url))).catch(() => {});

    await prisma.memo.update({
      where: { id: memo.id },
      data: { updatedAt: new Date() },
    });
    const fresh = (await prisma.memo.findUnique({
      where: { id: memo.id },
      include: memoInclude,
    })) as FullMemo;
    publish(memoAudience(fresh), { type: 'memo.changed', id: memo.id });
    res.json(serializeMemo(fresh, viewer));
  }),
);
