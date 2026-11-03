import { Router } from 'express';
import { requireViewer } from '../lib/http.js';
import { PAT_PREFIX, requireAuth } from '../middleware/auth.js';
import { publish, subscribe } from '../lib/sse.js';
import { prisma } from '../lib/prisma.js';

export const streamRouter = Router();

// Tell everyone who shares a DM thread with this user that their online/last
// seen status may have changed, so their chat list/header refreshes live.
async function notifyPresence(userId: string): Promise<void> {
  const partners = await prisma.conversationParticipant.findMany({
    where: { userId: { not: userId }, conversation: { participants: { some: { userId } } } },
    select: { userId: true },
  });
  const ids = [...new Set(partners.map((p) => p.userId))];
  if (ids.length) publish(ids, { type: 'presence', userId });
}

async function touchLastSeen(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() } });
}

// EventSource can't send an Authorization header, so the extension panel (which
// has no cookie session) passes its PAT as `?token=`. Promote it before auth.
streamRouter.use((req, _res, next) => {
  const t = req.query.token;
  if (typeof t === 'string' && t.startsWith(PAT_PREFIX) && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${t}`;
  }
  next();
});

// GET /api/stream — Server-Sent Events. The client (EventSource) reconnects on
// its own; we just keep the socket open and push events from lib/sse.
streamRouter.get('/', requireAuth, (req, res) => {
  const viewer = requireViewer(req);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  res.write(': connected\n\n');

  const unsubscribe = subscribe(viewer.id, res);
  void touchLastSeen(viewer.id).catch(() => {});
  void notifyPresence(viewer.id);

  req.on('close', () => {
    unsubscribe();
    res.end();
    void touchLastSeen(viewer.id).catch(() => {});
    void notifyPresence(viewer.id);
  });
});
