import { Router } from 'express';
import { z } from 'zod';
import { ah, HttpError, requireViewer } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import {
  canDeleteMemo,
  canReadMemo,
  canWriteMemo,
  memoAudience,
} from '../lib/access.js';
import { memoInclude, serializeMemo, type FullMemo } from '../lib/serialize.js';
import { publish } from '../lib/sse.js';
import { getActor, notifyJoined, notifyMemoUpdated } from '../lib/notifications.js';
import { noteJoined } from '../lib/contacts.js';
import { requireAuth } from '../middleware/auth.js';
import { shareRouter } from './share.js';
import { imagesRouter } from './images.js';
import { memoCommentsRouter } from './comments.js';

export const memosRouter = Router();

// Sub-resources first so "/:id/share" and "/:id/images" never fall into "/:id".
memosRouter.use('/:id/share', shareRouter);
memosRouter.use('/:id/images', imagesRouter);
memosRouter.use('/:id/comments', memoCommentsRouter);

const locationSchema = z
  .object({ lat: z.number(), lng: z.number(), name: z.string() })
  .nullable();

const memoInputSchema = z.object({
  title: z.string().min(1).max(1000),
  content: z.string().default(''),
  type: z.enum(['note', 'list']).default('note'),
  color: z.string().default('#ffffff'),
  tags: z.array(z.string()).default([]),
  // A Kanban column id: a default or a user-defined column (see routes/kanban).
  kanbanStatus: z
    .string()
    .regex(/^[a-z0-9-]{1,40}$/)
    .default('pending'),
  dueDate: z.string().datetime().nullable().optional(),
  location: locationSchema.optional(),
  folderId: z.string().nullable().optional(),
});

const memoPatchSchema = memoInputSchema.partial();

async function loadMemo(id: string): Promise<FullMemo> {
  const memo = await prisma.memo.findUnique({
    where: { id },
    include: memoInclude,
  });
  if (!memo) throw new HttpError(404, 'memo not found');
  return memo as FullMemo;
}

async function assertFolderOwned(folderId: string | null | undefined, ownerId: string) {
  if (!folderId) return;
  const folder = await prisma.folder.findUnique({ where: { id: folderId } });
  if (!folder || folder.ownerId !== ownerId) {
    throw new HttpError(400, 'unknown folder');
  }
}

// GET /api/memos — memos owned by the current user (the main list / kanban / calendar / map).
memosRouter.get(
  '/',
  requireAuth,
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const memos = await prisma.memo.findMany({
      where: { ownerId: viewer.id },
      include: memoInclude,
      orderBy: { updatedAt: 'desc' },
    });
    res.json(memos.map((m) => serializeMemo(m as FullMemo, viewer)));
  }),
);

// POST /api/memos
memosRouter.post(
  '/',
  requireAuth,
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const input = memoInputSchema.parse(req.body);
    await assertFolderOwned(input.folderId, viewer.id);

    const now = Date.now();
    const memo = await prisma.memo.create({
      data: {
        title: input.title,
        content: input.content,
        type: input.type,
        color: input.color,
        tags: input.tags,
        kanbanStatus: input.kanbanStatus,
        kanbanTimeLogs: { [input.kanbanStatus]: now },
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        location: input.location ?? undefined,
        folderId: input.folderId ?? null,
        ownerId: viewer.id,
      },
      include: memoInclude,
    });
    publish([viewer.id], { type: 'memo.changed', id: memo.id });
    res.status(201).json(serializeMemo(memo as FullMemo, viewer));
  }),
);

// GET /api/memos/:id
memosRouter.get(
  '/:id',
  requireAuth,
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const memo = await loadMemo(req.params.id);
    if (!canReadMemo(memo, viewer)) throw new HttpError(403, 'forbidden');
    res.json(serializeMemo(memo, viewer));
  }),
);

// PATCH /api/memos/:id
memosRouter.patch(
  '/:id',
  requireAuth,
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const memo = await loadMemo(req.params.id);
    if (!canWriteMemo(memo, viewer)) throw new HttpError(403, 'forbidden');

    const patch = memoPatchSchema.parse(req.body);
    if (patch.folderId !== undefined) {
      await assertFolderOwned(patch.folderId, memo.ownerId);
    }

    const data: Record<string, unknown> = {};
    for (const key of ['title', 'content', 'type', 'color', 'tags'] as const) {
      if (patch[key] !== undefined) data[key] = patch[key];
    }
    if (patch.folderId !== undefined) data.folderId = patch.folderId ?? null;
    if (patch.dueDate !== undefined) {
      data.dueDate = patch.dueDate ? new Date(patch.dueDate) : null;
    }
    if (patch.location !== undefined) data.location = patch.location ?? null;
    if (patch.kanbanStatus !== undefined) {
      data.kanbanStatus = patch.kanbanStatus;
      const logs = { ...(memo.kanbanTimeLogs as Record<string, number>) };
      logs[patch.kanbanStatus] = Date.now();
      data.kanbanTimeLogs = logs;
    }
    data.updatedAt = new Date();

    const updated = await prisma.memo.update({
      where: { id: memo.id },
      data,
      include: memoInclude,
    });
    publish(memoAudience(updated as FullMemo), {
      type: 'memo.changed',
      id: memo.id,
    });
    void getActor(viewer).then((actor) =>
      notifyMemoUpdated(updated as FullMemo, actor),
    );
    res.json(serializeMemo(updated as FullMemo, viewer));
  }),
);

// DELETE /api/memos/:id
memosRouter.delete(
  '/:id',
  requireAuth,
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const memo = await loadMemo(req.params.id);
    if (!canDeleteMemo(memo, viewer)) throw new HttpError(403, 'forbidden');
    const audience = memoAudience(memo);
    await prisma.memo.delete({ where: { id: memo.id } });
    publish(audience, { type: 'memo.deleted', id: memo.id });
    res.json({ ok: true });
  }),
);

// POST /api/memos/join  — join a shared note by its code.
memosRouter.post(
  '/join',
  requireAuth,
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const { code } = z.object({ code: z.string().min(1) }).parse(req.body);

    const memo = await prisma.memo.findFirst({
      where: { shareCode: code.trim() },
      include: memoInclude,
    });
    if (!memo) throw new HttpError(404, 'invalid share code');

    if (
      memo.ownerId === viewer.id ||
      memo.collaborators.some((c) => c.userId === viewer.id)
    ) {
      throw new HttpError(409, 'already has access');
    }

    const emailAllowed = memo.allowedEmails.some(
      (e) => e.toLowerCase() === viewer.email.toLowerCase(),
    );
    if (!memo.allowAnyone && !emailAllowed) {
      throw new HttpError(403, 'not allowed to join');
    }

    await prisma.memoCollaborator.create({
      data: { memoId: memo.id, userId: viewer.id },
    });
    publish([memo.ownerId, viewer.id], { type: 'shared.changed', id: memo.id });

    const fresh = await loadMemo(memo.id);
    void getActor(viewer).then((actor) => notifyJoined(fresh, actor));
    void noteJoined(memo.ownerId, { id: viewer.id, email: viewer.email });
    res.status(201).json(serializeMemo(fresh, viewer));
  }),
);

// DELETE /api/memos/:id/collaborators/me — leave a shared note.
memosRouter.delete(
  '/:id/collaborators/me',
  requireAuth,
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const email = viewer.email.toLowerCase();
    const memo = await prisma.memo.findUnique({ where: { id: req.params.id } });

    // Drop the collaborator row (whether it was keyed by account id or email).
    await prisma.memoCollaborator.deleteMany({
      where: {
        memoId: req.params.id,
        OR: [{ userId: viewer.id }, { email: { equals: viewer.email, mode: 'insensitive' } }],
      },
    });

    // Also revoke the standing email invite, otherwise the note keeps
    // reappearing in "shared with me" (GET /api/shared matches allowedEmails).
    if (memo && memo.allowedEmails.some((e) => e.toLowerCase() === email)) {
      await prisma.memo.update({
        where: { id: memo.id },
        data: {
          allowedEmails: memo.allowedEmails.filter((e) => e.toLowerCase() !== email),
        },
      });
    }

    publish([viewer.id, memo?.ownerId ?? viewer.id], {
      type: 'shared.changed',
      id: req.params.id,
    });
    res.json({ ok: true });
  }),
);
