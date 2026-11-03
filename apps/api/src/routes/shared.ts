import { Router } from 'express';
import { ah, requireViewer } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { memoInclude, serializeMemo, type FullMemo } from '../lib/serialize.js';
import { requireAuth } from '../middleware/auth.js';

export const sharedRouter = Router();

// GET /api/shared — notes shared *with* me plus notes I share *with others*.
sharedRouter.get(
  '/',
  requireAuth,
  ah(async (req, res) => {
    const viewer = requireViewer(req);

    const [withMe, byMe] = await Promise.all([
      prisma.memo.findMany({
        where: {
          ownerId: { not: viewer.id },
          OR: [
            { collaborators: { some: { userId: viewer.id } } },
            { collaborators: { some: { email: viewer.email } } },
            { allowedEmails: { has: viewer.email } },
          ],
        },
        include: memoInclude,
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.memo.findMany({
        where: {
          ownerId: viewer.id,
          OR: [
            { shareCode: { not: null } },
            { allowedEmails: { isEmpty: false } },
            { isPublic: true },
          ],
        },
        include: memoInclude,
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    const seen = new Set<string>();
    const merged: FullMemo[] = [];
    for (const m of [...byMe, ...withMe] as FullMemo[]) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      merged.push(m);
    }
    res.json(merged.map((m) => serializeMemo(m, viewer)));
  }),
);
