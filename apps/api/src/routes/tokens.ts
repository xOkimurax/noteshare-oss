import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { ah, HttpError, requireViewer } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { PAT_PREFIX, hashToken } from '../middleware/auth.js';

export const tokensRouter = Router();

tokensRouter.use(requireAuth);

tokensRouter.get(
  '/',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const tokens = await prisma.apiToken.findMany({
      where: { userId: viewer.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, lastUsedAt: true, createdAt: true },
    });
    res.json(
      tokens.map((t) => ({
        id: t.id,
        name: t.name,
        lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
        createdAt: t.createdAt.toISOString(),
      })),
    );
  }),
);

// POST /api/tokens { name } -> { ..., token }  (token shown once)
tokensRouter.post(
  '/',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const { name } = z
      .object({ name: z.string().min(1).max(80).default('MCP') })
      .parse(req.body ?? {});

    const token = PAT_PREFIX + randomBytes(24).toString('base64url');
    const row = await prisma.apiToken.create({
      data: { userId: viewer.id, name, tokenHash: hashToken(token) },
    });
    res.status(201).json({
      id: row.id,
      name: row.name,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: null,
      token,
    });
  }),
);

tokensRouter.delete(
  '/:id',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const { count } = await prisma.apiToken.deleteMany({
      where: { id: req.params.id, userId: viewer.id },
    });
    if (!count) throw new HttpError(404, 'token not found');
    res.json({ ok: true });
  }),
);
