/**
 * Default nickname for a user who doesn't have one yet — derived from their
 * email local-part, lowercased, sanitized to [a-z0-9_], padded to the 3-char
 * minimum, truncated to 20, with a numeric suffix on collision. Mirrors
 * scripts/backfill-usernames.ts (the one-off that seeded existing users).
 */
import { randomInt } from 'node:crypto';
import { prisma } from './prisma.js';

function sanitize(local: string): string {
  let base = local.toLowerCase().replace(/[^a-z0-9_]/g, '');
  while (base.length < 3) base += String(randomInt(0, 10));
  return base.slice(0, 20);
}

export async function defaultUsernameFor(email: string): Promise<string> {
  const base = sanitize(email.split('@')[0] ?? '');
  let candidate = base;
  for (let n = 2; ; n++) {
    const clash = await prisma.user.findUnique({
      where: { username: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
    const suffix = String(n);
    candidate = `${base.slice(0, 20 - suffix.length)}${suffix}`;
  }
}
