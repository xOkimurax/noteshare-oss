import { Router } from 'express';
import { z } from 'zod';
import { ah, HttpError, requireViewer } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { isAdmin } from '../lib/access.js';
import { memoInclude, serializeMemo, type FullMemo } from '../lib/serialize.js';
import { publish } from '../lib/sse.js';
import { getActor, notifySharedWith } from '../lib/notifications.js';
import { noteSharedOut } from '../lib/contacts.js';
import { requireAuth } from '../middleware/auth.js';

// Mounted at /api/memos/:id/share
export const shareRouter = Router({ mergeParams: true });

const slugSchema = z
  .string()
  .regex(/^[a-z0-9-]*$/, 'slug: lowercase letters, numbers and dashes only')
  .max(64);

const shareInputSchema = z.object({
  shareCode: z.string().max(120).nullable().optional(),
  shareName: z.string().max(200).nullable().optional(),
  allowAnyone: z.boolean().optional(),
  allowedEmails: z.array(z.string().email()).optional(),
  isPublic: z.boolean().optional(),
  publicSlug: slugSchema.nullable().optional(),
});

async function loadOwnedMemo(id: string, viewer: { id: string; email: string }) {
  const memo = await prisma.memo.findUnique({ where: { id }, include: memoInclude });
  if (!memo) throw new HttpError(404, 'memo not found');
  if (memo.ownerId !== viewer.id && !isAdmin(viewer.email)) {
    throw new HttpError(403, 'only the owner can change sharing');
  }
  return memo as FullMemo;
}

// GET /api/memos/:id/share/check-code?code=xxx  -> { unique: boolean }
shareRouter.get(
  '/check-code',
  requireAuth,
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    await loadOwnedMemo(req.params.id, viewer);
    const code = String(req.query.code ?? '').trim();
    if (!code) return res.json({ unique: true });
    const clash = await prisma.memo.findFirst({
      where: { shareCode: code, id: { not: req.params.id } },
      select: { id: true },
    });
    res.json({ unique: !clash });
  }),
);

// GET /api/memos/:id/share/check-slug?slug=xxx -> { unique: boolean }
shareRouter.get(
  '/check-slug',
  requireAuth,
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    await loadOwnedMemo(req.params.id, viewer);
    const slug = String(req.query.slug ?? '').trim();
    if (!slug) return res.json({ unique: true });
    const clash = await prisma.memo.findFirst({
      where: { publicSlug: slug, id: { not: req.params.id } },
      select: { id: true },
    });
    res.json({ unique: !clash });
  }),
);

// PATCH /api/memos/:id/share
shareRouter.patch(
  '/',
  requireAuth,
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const memo = await loadOwnedMemo(req.params.id, viewer);
    const input = shareInputSchema.parse(req.body);

    const shareCode =
      input.shareCode !== undefined
        ? input.shareCode?.trim() || null
        : memo.shareCode;
    const publicSlug =
      input.publicSlug !== undefined
        ? input.publicSlug?.trim() || null
        : memo.publicSlug;
    const isPublic = input.isPublic ?? memo.isPublic;

    if (isPublic && !publicSlug) {
      throw new HttpError(400, 'a public note needs a slug');
    }
    if (shareCode) {
      const clash = await prisma.memo.findFirst({
        where: { shareCode, id: { not: memo.id } },
        select: { id: true },
      });
      if (clash) throw new HttpError(409, 'share code already in use');
    }
    if (isPublic && publicSlug) {
      const clash = await prisma.memo.findFirst({
        where: { publicSlug, id: { not: memo.id } },
        select: { id: true },
      });
      if (clash) throw new HttpError(409, 'public link already in use');
    }

    const allowedEmails = input.allowedEmails
      ? input.allowedEmails.map((e) => e.toLowerCase())
      : memo.allowedEmails;
    const previousEmails = memo.allowedEmails.map((e) => e.toLowerCase());
    const newlyInvited = allowedEmails.filter((e) => !previousEmails.includes(e));

    const updated = await prisma.memo.update({
      where: { id: memo.id },
      data: {
        shareCode,
        shareName: input.shareName !== undefined ? input.shareName : memo.shareName,
        allowAnyone: input.allowAnyone ?? memo.allowAnyone,
        allowedEmails,
        isPublic,
        // keep the slug even when unpublishing, like the old ShareModal did
        publicSlug: isPublic ? publicSlug : memo.publicSlug ?? publicSlug,
        updatedAt: new Date(),
      },
      include: memoInclude,
    });

    // Remember invited emails as frequent collaborators (best-effort).
    if (allowedEmails.length) {
      try {
        const current = await prisma.user.findUnique({
          where: { id: viewer.id },
          select: { frequentCollaborators: true },
        });
        const merged = Array.from(
          new Set([...(current?.frequentCollaborators ?? []), ...allowedEmails]),
        );
        await prisma.user.update({
          where: { id: viewer.id },
          data: { frequentCollaborators: merged },
        });
      } catch {
        /* best-effort */
      }
    }

    publish([memo.ownerId], { type: 'memo.changed', id: memo.id });
    void getActor(viewer).then((actor) =>
      notifySharedWith(updated as FullMemo, newlyInvited, actor),
    );
    void noteSharedOut(viewer.id, allowedEmails);
    res.json(serializeMemo(updated as FullMemo, viewer));
  }),
);

// DELETE /api/memos/:id/share  — stop sharing entirely.
shareRouter.delete(
  '/',
  requireAuth,
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const memo = await loadOwnedMemo(req.params.id, viewer);
    const updated = await prisma.memo.update({
      where: { id: memo.id },
      data: {
        shareCode: null,
        allowAnyone: false,
        allowedEmails: [],
        isPublic: false,
        updatedAt: new Date(),
      },
      include: memoInclude,
    });
    publish([memo.ownerId], { type: 'memo.changed', id: memo.id });
    res.json(serializeMemo(updated as FullMemo, viewer));
  }),
);
