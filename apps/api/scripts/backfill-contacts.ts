/**
 * One-off: seed the Contact address book from existing sharing activity so
 * nobody starts with an empty list.
 *
 *   - every User.frequentCollaborators entry            -> owner's book (shared-out)
 *   - every (memo owner) -> (allowedEmails / collaborators) pair
 *        owner's book gets the recipient   (shared-out)
 *        recipient's book gets the owner    (shared-in)   [if they have an account]
 *
 * Idempotent: upsertContact never creates a duplicate or downgrades a row.
 *
 *   npx tsx --env-file=.env scripts/backfill-contacts.ts
 */
import { prisma } from '../src/lib/prisma.ts';
import { upsertContact } from '../src/lib/contacts.ts';

let links = 0;

const users = await prisma.user.findMany({
  select: { id: true, email: true, frequentCollaborators: true },
});
const emailToId = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));

// 1. frequentCollaborators
for (const u of users) {
  for (const email of u.frequentCollaborators) {
    await upsertContact(u.id, email, 'shared-out');
    links++;
  }
}

// 2. shared memos
const memos = await prisma.memo.findMany({
  where: {
    OR: [
      { allowedEmails: { isEmpty: false } },
      { collaborators: { some: {} } },
      { shareCode: { not: null } },
    ],
  },
  select: {
    ownerId: true,
    allowedEmails: true,
    owner: { select: { email: true } },
    collaborators: {
      select: { email: true, user: { select: { email: true } } },
    },
  },
});

for (const memo of memos) {
  const ownerEmail = memo.owner.email.toLowerCase();
  const recipientEmails = new Set<string>();
  for (const e of memo.allowedEmails) recipientEmails.add(e.toLowerCase());
  for (const c of memo.collaborators) {
    const e = (c.user?.email ?? c.email ?? '').toLowerCase();
    if (e) recipientEmails.add(e);
  }

  for (const email of recipientEmails) {
    if (email === ownerEmail) continue;
    await upsertContact(memo.ownerId, email, 'shared-out');
    links++;
    const recipientId = emailToId.get(email);
    if (recipientId) {
      await upsertContact(recipientId, ownerEmail, 'shared-in');
      links++;
    }
  }
}

const total = await prisma.contact.count();
console.log(`backfill done — processed ${links} links, ${total} contacts now exist`);
await prisma.$disconnect();
