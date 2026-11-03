import { Router } from 'express';
import { z } from 'zod';
import { ah, HttpError, requireViewer } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { serializeNotification } from '../lib/notifications.js';
import { isAdmin } from '../lib/access.js';
import { publish } from '../lib/sse.js';

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

// GET /api/notifications -> { items, unreadCount }
notificationsRouter.get(
  '/',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const [items, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: viewer.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.notification.count({ where: { userId: viewer.id, read: false } }),
    ]);
    res.json({ items: items.map(serializeNotification), unreadCount });
  }),
);

// POST /api/notifications/read   body: { ids?: string[] }  (omit ids = all)
notificationsRouter.post(
  '/read',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const { ids } = z
      .object({ ids: z.array(z.string()).optional() })
      .parse(req.body ?? {});
    await prisma.notification.updateMany({
      where: {
        userId: viewer.id,
        read: false,
        ...(ids ? { id: { in: ids } } : {}),
      },
      data: { read: true },
    });
    res.json({ ok: true });
  }),
);

// POST /api/notifications/announce  { message }  — admin only. Broadcasts a
// one-off "here's what's new" notification to every user (system.announcement,
// not tied to any memo/conversation — memoTitle carries the message text).
notificationsRouter.post(
  '/announce',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    if (!isAdmin(viewer.email)) throw new HttpError(403, 'admin only');
    const { message } = z
      .object({ message: z.string().trim().min(1).max(500) })
      .parse(req.body);

    const users = await prisma.user.findMany({ select: { id: true } });
    await prisma.notification.createMany({
      data: users.map((u) => ({
        userId: u.id,
        type: 'system.announcement',
        memoTitle: message,
      })),
    });
    publish(
      users.map((u) => u.id),
      { type: 'notification' },
    );
    res.json({ ok: true, count: users.length });
  }),
);

// DELETE /api/notifications  — clear all for the user.
notificationsRouter.delete(
  '/',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    await prisma.notification.deleteMany({ where: { userId: viewer.id } });
    res.json({ ok: true });
  }),
);
