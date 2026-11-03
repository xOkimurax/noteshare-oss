import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Viewer } from '../lib/access.js';
import { prisma } from '../lib/prisma.js';
import { ACCESS_COOKIE, verifyAccess } from '../lib/jwt.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      viewer?: Viewer;
    }
  }
}

export const PAT_PREFIX = 'ns_pat_';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function resolveViewer(req: Request): Promise<Viewer | null> {
  const header = req.header('authorization');
  if (header?.startsWith('Bearer ')) {
    const token = header.slice(7).trim();
    if (!token.startsWith(PAT_PREFIX)) return null;
    const row = await prisma.apiToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!row) return null;
    prisma.apiToken
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});
    return { id: row.user.id, email: row.user.email };
  }

  const cookie = req.cookies?.[ACCESS_COOKIE];
  if (cookie) {
    try {
      const claims = verifyAccess(cookie);
      return { id: claims.sub, email: claims.email };
    } catch {
      return null;
    }
  }
  return null;
}

export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  req.viewer = (await resolveViewer(req)) ?? undefined;
  next();
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const viewer = await resolveViewer(req);
  if (!viewer) {
    res.status(401).json({ error: 'unauthenticated' });
    return;
  }
  req.viewer = viewer;
  next();
}
