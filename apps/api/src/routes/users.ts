import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { ah, HttpError, requireViewer } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { serializeUser } from '../lib/serialize.js';
import { toWebp } from '../lib/image.js';
import { requireAuth } from '../middleware/auth.js';

export const usersRouter = Router();

usersRouter.use(requireAuth);

// Same engine as note/DM images: sharp → webp, one file, capped at 8MB.
const uploadPhoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype.startsWith('image/')),
});

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

usersRouter.get(
  '/me',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const user = await prisma.user.findUnique({ where: { id: viewer.id } });
    if (!user) throw new HttpError(401, 'unknown user');
    res.json(serializeUser(user));
  }),
);

usersRouter.patch(
  '/me',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const body = z
      .object({
        displayName: z.string().max(200).optional(),
        username: z.string().max(40).optional(),
        frequentCollaborators: z.array(z.string().email()).optional(),
      })
      .parse(req.body);

    let username: string | undefined;
    if (body.username !== undefined) {
      username = body.username.trim().toLowerCase();
      if (!USERNAME_RE.test(username)) {
        throw new HttpError(
          400,
          'username must be 3-20 lowercase letters, digits or underscores',
        );
      }
      const clash = await prisma.user.findFirst({
        where: { username, id: { not: viewer.id } },
        select: { id: true },
      });
      if (clash) throw new HttpError(409, 'username already taken');
    }

    try {
      const user = await prisma.user.update({
        where: { id: viewer.id },
        data: {
          ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
          ...(username !== undefined ? { username } : {}),
          ...(body.frequentCollaborators
            ? {
                frequentCollaborators: Array.from(
                  new Set(body.frequentCollaborators.map((e) => e.toLowerCase())),
                ),
              }
            : {}),
        },
      });
      res.json(serializeUser(user));
    } catch (e) {
      // Backstop for the check-then-set race above.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new HttpError(409, 'username already taken');
      }
      throw e;
    }
  }),
);

// POST /api/users/me/photo  multipart "photo" (single image) -> UserProfile
usersRouter.post(
  '/me/photo',
  uploadPhoto.single('photo'),
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    if (!req.file) throw new HttpError(400, 'photo file required');
    const img = await toWebp(req.file.buffer);
    const user = await prisma.user.update({
      where: { id: viewer.id },
      data: { photoURL: img.url },
    });
    res.json(serializeUser(user));
  }),
);

// GET /api/users/lookup?email=  or  ?username=  -> { exists, id? }  (for
// ShareModal's "is this a registered Noteshare user?" check, and for the
// "add contact by username" flow).
usersRouter.get(
  '/lookup',
  ah(async (req, res) => {
    const email = String(req.query.email ?? '')
      .trim()
      .toLowerCase();
    const username = String(req.query.username ?? '')
      .trim()
      .toLowerCase();
    if (!email && !username) throw new HttpError(400, 'email or username required');

    const user = email
      ? await prisma.user.findUnique({ where: { email }, select: { id: true } })
      : await prisma.user.findUnique({ where: { username }, select: { id: true } });
    res.json({ exists: !!user, id: user?.id ?? null });
  }),
);

// GET /api/users/search?q=  -> { items }  — nickname-prefix typeahead for the
// Contacts "add" box. Excludes the viewer and anyone already in their
// contacts. Requires 3+ chars to avoid dumping half the user table.
usersRouter.get(
  '/search',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    const q = String(req.query.q ?? '')
      .trim()
      .toLowerCase()
      .replace(/^@/, '');
    if (q.length < 3) return res.json({ items: [] });

    const existingContacts = await prisma.contact.findMany({
      where: { ownerId: viewer.id },
      select: { email: true },
    });
    const excluded = new Set(existingContacts.map((c) => c.email.toLowerCase()));

    const users = await prisma.user.findMany({
      where: { username: { startsWith: q }, id: { not: viewer.id } },
      select: { id: true, username: true, displayName: true, email: true, photoURL: true },
      orderBy: { username: 'asc' },
      take: 20,
    });
    const items = users
      .filter((u) => !excluded.has(u.email.toLowerCase()))
      .slice(0, 8)
      .map((u) => ({
        id: u.id,
        username: u.username as string,
        name: u.displayName || u.email.split('@')[0],
        photoURL: u.photoURL || '',
      }));
    res.json({ items });
  }),
);

// DELETE /api/users/me  — delete the account and everything it owns.
usersRouter.delete(
  '/me',
  ah(async (req, res) => {
    const viewer = requireViewer(req);
    await prisma.user.delete({ where: { id: viewer.id } });
    res.clearCookie('ns_access', { path: '/' });
    res.clearCookie('ns_refresh', { path: '/' });
    res.json({ ok: true });
  }),
);
