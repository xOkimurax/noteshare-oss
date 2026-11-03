/**
 * One-off: give every existing user (username is null) a handle derived from
 * their email local-part — lowercased, sanitized to [a-z0-9_], padded to the
 * 3-char minimum, truncated to 20, with a numeric suffix on collision.
 *
 * Idempotent: only touches rows where username is still null.
 *
 *   npx tsx --env-file=.env scripts/backfill-usernames.ts
 */
import { randomInt } from 'node:crypto';
import { prisma } from '../src/lib/prisma.ts';

function sanitize(local: string): string {
  let base = local.toLowerCase().replace(/[^a-z0-9_]/g, '');
  while (base.length < 3) base += String(randomInt(0, 10));
  return base.slice(0, 20);
}

function uniqueUsername(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  for (;;) {
    const suffix = String(n);
    const candidate = `${base.slice(0, 20 - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
    n++;
  }
}

const [pending, existing] = await Promise.all([
  prisma.user.findMany({ where: { username: null }, select: { id: true, email: true } }),
  prisma.user.findMany({ where: { username: { not: null } }, select: { username: true } }),
]);

const taken = new Set(existing.map((u) => u.username as string));

let set = 0;
for (const u of pending) {
  const local = u.email.split('@')[0] ?? '';
  const base = sanitize(local);
  const username = uniqueUsername(base, taken);
  taken.add(username);
  await prisma.user.update({ where: { id: u.id }, data: { username } });
  set++;
}

console.log(`backfill done — set username for ${set} user(s)`);
await prisma.$disconnect();
