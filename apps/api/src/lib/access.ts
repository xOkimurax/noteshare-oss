/**
 * Memo authorisation — a direct port of the old firestore.rules /memos/{id}
 * read / update / delete conditions.
 */
import type { Memo, MemoCollaborator } from '@prisma/client';
import { ADMIN_EMAILS } from '../env.js';

export interface Viewer {
  id: string;
  email: string;
}

export type MemoWithCollab = Memo & { collaborators: MemoCollaborator[] };

export function isAdmin(email: string | undefined | null): boolean {
  return !!email && ADMIN_EMAILS.has(email.toLowerCase());
}

function isCollaborator(memo: MemoWithCollab, viewer: Viewer): boolean {
  const email = viewer.email.toLowerCase();
  return memo.collaborators.some(
    (c) =>
      (c.userId && c.userId === viewer.id) ||
      (c.email && c.email.toLowerCase() === email),
  );
}

function inAllowedEmails(memo: MemoWithCollab, viewer: Viewer): boolean {
  const email = viewer.email.toLowerCase();
  return memo.allowedEmails.some((e) => e.toLowerCase() === email);
}

const hasShareCode = (memo: MemoWithCollab) =>
  memo.shareCode != null && memo.shareCode !== '';

export function canReadMemo(
  memo: MemoWithCollab,
  viewer: Viewer | null,
): boolean {
  if (memo.isPublic) return true;
  if (!viewer) return false;
  return (
    memo.ownerId === viewer.id ||
    isCollaborator(memo, viewer) ||
    inAllowedEmails(memo, viewer) ||
    isAdmin(viewer.email) ||
    hasShareCode(memo)
  );
}

export function canWriteMemo(
  memo: MemoWithCollab,
  viewer: Viewer | null,
): boolean {
  if (!viewer) return false;
  return (
    memo.ownerId === viewer.id ||
    isCollaborator(memo, viewer) ||
    (memo.allowAnyone && hasShareCode(memo)) ||
    inAllowedEmails(memo, viewer) ||
    isAdmin(viewer.email)
  );
}

export function canDeleteMemo(
  memo: MemoWithCollab,
  viewer: Viewer | null,
): boolean {
  if (!viewer) return false;
  return memo.ownerId === viewer.id || isAdmin(viewer.email);
}

export function memoRole(
  memo: MemoWithCollab,
  viewer: Viewer | null,
): 'owner' | 'collaborator' | 'shared' | 'public' {
  if (viewer && memo.ownerId === viewer.id) return 'owner';
  if (viewer && isCollaborator(memo, viewer)) return 'collaborator';
  if (viewer && (inAllowedEmails(memo, viewer) || hasShareCode(memo)))
    return 'shared';
  return 'public';
}

/** User ids that should be notified when this memo changes (SSE fan-out). */
export function memoAudience(memo: MemoWithCollab): string[] {
  const ids = [memo.ownerId];
  for (const c of memo.collaborators) if (c.userId) ids.push(c.userId);
  return ids;
}
