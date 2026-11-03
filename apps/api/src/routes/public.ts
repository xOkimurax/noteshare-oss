import { Router } from 'express';
import { ah, HttpError } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { memoInclude, serializeMemo, type FullMemo } from '../lib/serialize.js';

export const publicRouter = Router();

function publicView(memo: FullMemo) {
  const full = serializeMemo(memo, null);
  return {
    id: full.id,
    title: full.title,
    content: full.content,
    color: full.color,
    tags: full.tags,
    location: full.location,
    images: full.images,
    createdAt: full.createdAt,
  };
}

// GET /api/public/by-id/:memoId  — legacy ?public=<memoId> links.
publicRouter.get(
  '/by-id/:memoId',
  ah(async (req, res) => {
    const memo = await prisma.memo.findUnique({
      where: { id: req.params.memoId },
      include: memoInclude,
    });
    if (!memo || !memo.isPublic) throw new HttpError(404, 'not found');
    res.json(publicView(memo as FullMemo));
  }),
);

// GET /api/public/:slug  — current ?p=<slug> short links.
publicRouter.get(
  '/:slug',
  ah(async (req, res) => {
    const memo = await prisma.memo.findFirst({
      where: { publicSlug: req.params.slug, isPublic: true },
      include: memoInclude,
    });
    if (!memo) throw new HttpError(404, 'not found');
    res.json(publicView(memo as FullMemo));
  }),
);
