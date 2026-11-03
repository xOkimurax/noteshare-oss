import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import type { KanbanColumn } from '@noteshare/shared';
import { ah, HttpError, requireViewer } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { readKanbanColumns } from '../lib/serialize.js';
import { publish } from '../lib/sse.js';
import { requireAuth } from '../middleware/auth.js';

export const kanbanRouter = Router();
kanbanRouter.use(requireAuth);

const columnSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9-]{1,40}$/, 'column id: lowercase letters, digits, dashes'),
  label: z.string().trim().min(1).max(40),
});

const columnsSchema = z
  .array(columnSchema)
  .min(1, 'at least one column')
  .max(12, 'at most 12 columns')
  .refine(
    (cols) => new Set(cols.map((c) => c.id)).size === cols.length,
    'column ids must be unique',
  );

// GET /api/kanban/columns  ->  { columns: KanbanColumn[] | null }
kanbanRouter.get(
  '/columns',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const user = await prisma.user.findUnique({
      where: { id: viewer.id },
      select: { kanbanColumns: true },
    });
    res.json({ columns: readKanbanColumns(user?.kanbanColumns) });
  }),
);

// PUT /api/kanban/columns  { columns }  ->  { columns }
// Orphaned cards (a memo pointing at a removed column) fall back to column 0.
kanbanRouter.put(
  '/columns',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const columns = columnsSchema.parse(
      z.object({ columns: z.unknown() }).parse(req.body).columns,
    ) as KanbanColumn[];

    await prisma.user.update({
      where: { id: viewer.id },
      data: { kanbanColumns: columns as unknown as Prisma.InputJsonValue },
    });

    const ids = columns.map((c) => c.id);
    await prisma.memo.updateMany({
      where: { ownerId: viewer.id, type: 'list', kanbanStatus: { notIn: ids } },
      data: { kanbanStatus: ids[0] },
    });

    publish([viewer.id], { type: 'memo.changed', id: viewer.id });
    res.json({ columns });
  }),
);

// POST /api/kanban/clear  { status? }
// Take finished cards off the board — they stay as regular notes (type:'note').
// Omit `status` to clear the whole board.
kanbanRouter.post(
  '/clear',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const { status } = z
      .object({ status: z.string().max(40).optional() })
      .parse(req.body ?? {});

    const result = await prisma.memo.updateMany({
      where: {
        ownerId: viewer.id,
        type: 'list',
        ...(status ? { kanbanStatus: status } : {}),
      },
      data: { type: 'note' },
    });

    if (result.count === 0) throw new HttpError(404, 'nothing to clear');
    publish([viewer.id], { type: 'memo.changed', id: viewer.id });
    res.json({ cleared: result.count });
  }),
);
