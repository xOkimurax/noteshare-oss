import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import type { MemoComment } from '@noteshare/shared';
import { ah, HttpError, requireViewer } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { canReadMemo, canWriteMemo } from '../lib/access.js';
import { memoInclude, type FullMemo } from '../lib/serialize.js';
import { publish } from '../lib/sse.js';
import {
  accessUserIds,
  getActor,
  notifyNewComment,
} from '../lib/notifications.js';
import { requireAuth } from '../middleware/auth.js';

const withAuthor = {
  author: { select: { id: true, displayName: true, email: true, photoURL: true } },
} satisfies Prisma.MemoCommentInclude;

type CommentRow = Prisma.MemoCommentGetPayload<{ include: typeof withAuthor }>;

function serializeComment(row: CommentRow, viewerId: string): MemoComment {
  return {
    id: row.id,
    memoId: row.memoId,
    authorId: row.authorId,
    authorName: row.author.displayName || row.author.email.split('@')[0],
    authorPhotoURL: row.author.photoURL || '',
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt ? row.editedAt.toISOString() : null,
    mine: row.authorId === viewerId,
  };
}

async function loadMemo(id: string): Promise<FullMemo> {
  const memo = await prisma.memo.findUnique({ where: { id }, include: memoInclude });
  if (!memo) throw new HttpError(404, 'memo not found');
  return memo as FullMemo;
}

// --- /api/memos/:id/comments --------------------------------------------

export const memoCommentsRouter = Router({ mergeParams: true });
memoCommentsRouter.use(requireAuth);

const bodySchema = z.object({ body: z.string().trim().min(1).max(4000) });

// GET /  -> { items, lastReadAt }
memoCommentsRouter.get(
  '/',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const memo = await loadMemo(req.params.id);
    if (!canReadMemo(memo, viewer)) throw new HttpError(403, 'forbidden');

    const [rows, marker] = await Promise.all([
      prisma.memoComment.findMany({
        where: { memoId: memo.id },
        include: withAuthor,
        orderBy: { createdAt: 'asc' },
      }),
      prisma.memoCommentRead.findUnique({
        where: { memoId_userId: { memoId: memo.id, userId: viewer.id } },
        select: { lastReadAt: true },
      }),
    ]);

    res.json({
      items: rows.map((r) => serializeComment(r, viewer.id)),
      lastReadAt: marker?.lastReadAt.toISOString() ?? null,
    });
  }),
);

// POST /  -> MemoComment (201)
memoCommentsRouter.post(
  '/',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const memo = await loadMemo(req.params.id);
    if (!canWriteMemo(memo, viewer)) throw new HttpError(403, 'forbidden');
    const { body } = bodySchema.parse(req.body);

    const row = await prisma.memoComment.create({
      data: { memoId: memo.id, authorId: viewer.id, body },
      include: withAuthor,
    });

    // The author has, by definition, read up to their own message.
    await prisma.memoCommentRead.upsert({
      where: { memoId_userId: { memoId: memo.id, userId: viewer.id } },
      create: { memoId: memo.id, userId: viewer.id },
      update: { lastReadAt: new Date() },
    });

    const audience = await accessUserIds(memo);
    publish(audience, { type: 'memo.comment', memoId: memo.id });
    void getActor(viewer).then((actor) => notifyNewComment(memo, actor));

    res.status(201).json(serializeComment(row, viewer.id));
  }),
);

async function loadOwnComment(cid: string, memoId: string) {
  const row = await prisma.memoComment.findUnique({
    where: { id: cid },
    include: withAuthor,
  });
  if (!row || row.memoId !== memoId) throw new HttpError(404, 'comment not found');
  return row;
}

// PATCH /:cid  -> author only
memoCommentsRouter.patch(
  '/:cid',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const memo = await loadMemo(req.params.id);
    if (!canReadMemo(memo, viewer)) throw new HttpError(403, 'forbidden');
    const existing = await loadOwnComment(req.params.cid, memo.id);
    if (existing.authorId !== viewer.id) throw new HttpError(403, 'not your comment');
    const { body } = bodySchema.parse(req.body);

    const row = await prisma.memoComment.update({
      where: { id: existing.id },
      data: { body, editedAt: new Date() },
      include: withAuthor,
    });
    publish(await accessUserIds(memo), { type: 'memo.comment', memoId: memo.id });
    res.json(serializeComment(row, viewer.id));
  }),
);

// DELETE /:cid  -> author or memo owner
memoCommentsRouter.delete(
  '/:cid',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const memo = await loadMemo(req.params.id);
    if (!canReadMemo(memo, viewer)) throw new HttpError(403, 'forbidden');
    const existing = await loadOwnComment(req.params.cid, memo.id);
    if (existing.authorId !== viewer.id && memo.ownerId !== viewer.id) {
      throw new HttpError(403, 'not allowed');
    }
    await prisma.memoComment.delete({ where: { id: existing.id } });
    publish(await accessUserIds(memo), { type: 'memo.comment', memoId: memo.id });
    res.json({ ok: true });
  }),
);

// POST /read  -> mark the thread read up to now
memoCommentsRouter.post(
  '/read',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const memo = await loadMemo(req.params.id);
    if (!canReadMemo(memo, viewer)) throw new HttpError(403, 'forbidden');
    await prisma.memoCommentRead.upsert({
      where: { memoId_userId: { memoId: memo.id, userId: viewer.id } },
      create: { memoId: memo.id, userId: viewer.id },
      update: { lastReadAt: new Date() },
    });
    res.json({ ok: true });
  }),
);

// --- /api/comments -----------------------------------------------------

export const commentsRouter = Router();
commentsRouter.use(requireAuth);

// GET /unread -> [{ memoId, count }] for every memo the viewer can see
commentsRouter.get(
  '/unread',
  ah(async (req, res) => {
    const viewer = requireViewer(req);

    // Memos the viewer owns or collaborates on that actually have comments.
    const memos = await prisma.memo.findMany({
      where: {
        comments: { some: {} },
        OR: [
          { ownerId: viewer.id },
          { collaborators: { some: { userId: viewer.id } } },
          { collaborators: { some: { email: viewer.email } } },
          { allowedEmails: { has: viewer.email } },
        ],
      },
      select: {
        id: true,
        comments: { select: { createdAt: true, authorId: true } },
      },
    });

    const markers = await prisma.memoCommentRead.findMany({
      where: { userId: viewer.id, memoId: { in: memos.map((m) => m.id) } },
    });
    const lastReadBy = new Map(markers.map((m) => [m.memoId, m.lastReadAt]));

    const out: Array<{ memoId: string; count: number }> = [];
    for (const m of memos) {
      const since = lastReadBy.get(m.id);
      const count = m.comments.filter(
        (c) => c.authorId !== viewer.id && (!since || c.createdAt > since),
      ).length;
      if (count > 0) out.push({ memoId: m.id, count });
    }
    res.json(out);
  }),
);
