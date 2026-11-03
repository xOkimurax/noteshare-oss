import { Router } from 'express';
import { z } from 'zod';
import { ah, HttpError, requireViewer } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import {
  contactInclude,
  relinkContacts,
  serializeContact,
} from '../lib/contacts.js';

export const contactsRouter = Router();

contactsRouter.use(requireAuth);

// Favourites first, then by display-ish name. Prisma can't order by the
// resolved name, so sort in JS after serialising.
function sortContacts<T extends { favorite: boolean; name: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

// GET /api/contacts
contactsRouter.get(
  '/',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    await relinkContacts(viewer.id);
    const rows = await prisma.contact.findMany({
      where: { ownerId: viewer.id },
      include: contactInclude,
    });
    res.json(sortContacts(rows.map(serializeContact)));
  }),
);

const addSchema = z
  .object({
    email: z.string().email().optional(),
    username: z.string().max(40).optional(),
    alias: z.string().max(120).nullish(),
  })
  .refine((d) => !!d.email !== !!d.username, {
    message: 'provide exactly one of email or username',
  });

// POST /api/contacts  — { email } or { username }, plus an optional alias.
contactsRouter.post(
  '/',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const { email, username, alias } = addSchema.parse(req.body);

    let normalized: string;
    let account: { id: string } | null;
    if (username) {
      const found = await prisma.user.findUnique({
        where: { username: username.trim().toLowerCase() },
        select: { id: true, email: true },
      });
      if (!found) throw new HttpError(404, 'no user with that username');
      normalized = found.email.toLowerCase();
      account = { id: found.id };
    } else {
      normalized = email!.trim().toLowerCase();
      account = await prisma.user.findUnique({
        where: { email: normalized },
        select: { id: true },
      });
    }

    if (normalized === viewer.email.toLowerCase()) {
      throw new HttpError(400, 'you cannot add yourself');
    }

    const clash = await prisma.contact.findUnique({
      where: { ownerId_email: { ownerId: viewer.id, email: normalized } },
      select: { id: true },
    });
    if (clash) throw new HttpError(409, 'contact already exists');

    const row = await prisma.contact.create({
      data: {
        ownerId: viewer.id,
        email: normalized,
        alias: alias?.trim() || null,
        contactUserId: account?.id ?? null,
        source: 'manual',
      },
      include: contactInclude,
    });
    res.status(201).json(serializeContact(row));
  }),
);

const patchSchema = z.object({
  alias: z.string().max(120).nullish(),
  favorite: z.boolean().optional(),
});

async function loadOwnedContact(id: string, ownerId: string) {
  const row = await prisma.contact.findUnique({ where: { id } });
  if (!row || row.ownerId !== ownerId) throw new HttpError(404, 'contact not found');
  return row;
}

// PATCH /api/contacts/:id
contactsRouter.patch(
  '/:id',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    await loadOwnedContact(req.params.id, viewer.id);
    const body = patchSchema.parse(req.body);

    const row = await prisma.contact.update({
      where: { id: req.params.id },
      data: {
        ...(body.alias !== undefined ? { alias: body.alias?.trim() || null } : {}),
        ...(body.favorite !== undefined ? { favorite: body.favorite } : {}),
      },
      include: contactInclude,
    });
    res.json(serializeContact(row));
  }),
);

// DELETE /api/contacts/:id
contactsRouter.delete(
  '/:id',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    await loadOwnedContact(req.params.id, viewer.id);
    await prisma.contact.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  }),
);
