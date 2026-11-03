import { Router } from 'express';
import { z } from 'zod';
import { ah, HttpError, requireViewer } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { serializeFolder } from '../lib/serialize.js';
import { publish } from '../lib/sse.js';
import { requireAuth } from '../middleware/auth.js';

export const foldersRouter = Router();

const nameSchema = z.object({ name: z.string().min(1).max(200) });

foldersRouter.use(requireAuth);

foldersRouter.get(
  '/',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const folders = await prisma.folder.findMany({
      where: { ownerId: viewer.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json(folders.map(serializeFolder));
  }),
);

foldersRouter.post(
  '/',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const { name } = nameSchema.parse(req.body);
    const folder = await prisma.folder.create({
      data: { name, ownerId: viewer.id },
    });
    publish([viewer.id], { type: 'folder.changed', id: folder.id });
    res.status(201).json(serializeFolder(folder));
  }),
);

async function loadOwnedFolder(id: string, ownerId: string) {
  const folder = await prisma.folder.findUnique({ where: { id } });
  if (!folder || folder.ownerId !== ownerId) {
    throw new HttpError(404, 'folder not found');
  }
  return folder;
}

foldersRouter.patch(
  '/:id',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    await loadOwnedFolder(req.params.id, viewer.id);
    const { name } = nameSchema.parse(req.body);
    const folder = await prisma.folder.update({
      where: { id: req.params.id },
      data: { name },
    });
    publish([viewer.id], { type: 'folder.changed', id: folder.id });
    res.json(serializeFolder(folder));
  }),
);

foldersRouter.delete(
  '/:id',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    await loadOwnedFolder(req.params.id, viewer.id);
    // Notes keep existing; their folderId is set to null (schema onDelete: SetNull)
    // so they resurface at the root — same as the user saw with the old app.
    await prisma.folder.delete({ where: { id: req.params.id } });
    publish([viewer.id], { type: 'folder.changed', id: req.params.id });
    res.json({ ok: true });
  }),
);
