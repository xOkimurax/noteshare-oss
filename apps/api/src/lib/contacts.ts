/**
 * The private address book. Every helper here is best-effort — a failure must
 * never break the share / join that triggered the seeding.
 *
 * Model: one row = "this person is in that owner's contacts", one direction
 * only, no mutual consent. `email` is the stable key; `contactUserId` is
 * resolved lazily once the person has an account.
 */
import type { Contact, ContactSource } from '@noteshare/shared';
import { prisma } from './prisma.js';
import type { Prisma } from '@prisma/client';

const withUser = {
  contactUser: { select: { displayName: true, photoURL: true } },
} satisfies Prisma.ContactInclude;

type ContactRow = Prisma.ContactGetPayload<{ include: typeof withUser }>;

export function serializeContact(row: ContactRow): Contact {
  return {
    id: row.id,
    email: row.email,
    name: row.contactUser?.displayName || row.alias || row.email,
    photoURL: row.contactUser?.photoURL || '',
    alias: row.alias,
    favorite: row.favorite,
    hasAccount: !!row.contactUserId,
    source: row.source as ContactSource,
    createdAt: row.createdAt.toISOString(),
  };
}

export const contactInclude = withUser;

/**
 * Add `email` to `ownerId`'s address book if it isn't there yet. Never
 * downgrades an existing row (keeps its source / alias / favorite). Resolves
 * the account link on creation.
 */
export async function upsertContact(
  ownerId: string,
  email: string,
  source: ContactSource,
): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;

  const owner = await prisma.user.findUnique({
    where: { id: ownerId },
    select: { email: true },
  });
  // Don't let a user add themselves.
  if (!owner || owner.email === normalized) return;

  const existing = await prisma.contact.findUnique({
    where: { ownerId_email: { ownerId, email: normalized } },
    select: { id: true },
  });
  if (existing) return;

  const account = await prisma.user.findUnique({
    where: { email: normalized },
    select: { id: true },
  });

  await prisma.contact.create({
    data: {
      ownerId,
      email: normalized,
      contactUserId: account?.id ?? null,
      source,
    },
  });
}

/**
 * `sharerId` just granted `emails` access to a note. Record each in the
 * sharer's book (shared-out), and — for those with an account — record the
 * sharer in theirs (shared-in).
 */
export async function noteSharedOut(
  sharerId: string,
  emails: string[],
): Promise<void> {
  try {
    const sharer = await prisma.user.findUnique({
      where: { id: sharerId },
      select: { email: true },
    });
    const normalized = [
      ...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean)),
    ];

    for (const email of normalized) {
      await upsertContact(sharerId, email, 'shared-out');
    }

    if (sharer?.email) {
      const accounts = await prisma.user.findMany({
        where: { email: { in: normalized } },
        select: { id: true },
      });
      for (const a of accounts) {
        await upsertContact(a.id, sharer.email, 'shared-in');
      }
    }
  } catch (e) {
    console.error('noteSharedOut failed', e);
  }
}

/**
 * `joiner` joined `ownerId`'s shared note via the share code. Cross-link both
 * address books.
 */
export async function noteJoined(
  ownerId: string,
  joiner: { id: string; email: string },
): Promise<void> {
  try {
    const owner = await prisma.user.findUnique({
      where: { id: ownerId },
      select: { email: true },
    });
    await upsertContact(ownerId, joiner.email, 'joined');
    if (owner?.email) {
      await upsertContact(joiner.id, owner.email, 'shared-in');
    }
  } catch (e) {
    console.error('noteJoined failed', e);
  }
}

/**
 * Backfill / repair the account link for any of an owner's contacts whose
 * person has since registered. Cheap enough to call before listing.
 */
export async function relinkContacts(ownerId: string): Promise<void> {
  const orphans = await prisma.contact.findMany({
    where: { ownerId, contactUserId: null },
    select: { id: true, email: true },
  });
  if (orphans.length === 0) return;

  const users = await prisma.user.findMany({
    where: { email: { in: orphans.map((o) => o.email) } },
    select: { id: true, email: true },
  });
  const byEmail = new Map(users.map((u) => [u.email, u.id]));

  await Promise.all(
    orphans
      .filter((o) => byEmail.has(o.email))
      .map((o) =>
        prisma.contact.update({
          where: { id: o.id },
          data: { contactUserId: byEmail.get(o.email) },
        }),
      ),
  );
}
