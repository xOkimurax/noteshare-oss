import type {
  Folder as PrismaFolder,
  Memo as PrismaMemo,
  MemoImage as PrismaImage,
  MemoCollaborator as PrismaCollab,
  User as PrismaUser,
} from '@prisma/client';
import type {
  Folder,
  KanbanColumn,
  Memo,
  MemoImage,
  UserProfile,
} from '@noteshare/shared';
import { isAdmin, memoRole, type Viewer } from './access.js';

export type FullMemo = PrismaMemo & {
  images: PrismaImage[];
  collaborators: PrismaCollab[];
};

export const memoInclude = {
  images: { orderBy: { position: 'asc' } },
  collaborators: true,
} as const;

function serializeImage(img: PrismaImage): MemoImage {
  return {
    id: img.id,
    url: img.url,
    position: img.position,
    width: img.width,
    height: img.height,
    bytes: img.bytes,
  };
}

export function serializeMemo(memo: FullMemo, viewer: Viewer | null): Memo {
  const collaborators = memo.collaborators
    .map((c) => c.userId ?? c.email)
    .filter((v): v is string => !!v);

  return {
    id: memo.id,
    title: memo.title,
    content: memo.content,
    type: memo.type,
    color: memo.color,
    tags: memo.tags,
    kanbanStatus: memo.kanbanStatus as Memo['kanbanStatus'],
    kanbanTimeLogs: (memo.kanbanTimeLogs ?? {}) as Record<string, number>,
    dueDate: memo.dueDate ? memo.dueDate.toISOString() : null,
    location: (memo.location as Memo['location']) ?? null,
    folderId: memo.folderId,
    ownerId: memo.ownerId,
    images: memo.images.map(serializeImage),
    collaborators,
    shareCode: memo.shareCode,
    shareName: memo.shareName,
    allowAnyone: memo.allowAnyone,
    allowedEmails: memo.allowedEmails,
    isPublic: memo.isPublic,
    publicSlug: memo.publicSlug,
    createdAt: memo.createdAt.toISOString(),
    updatedAt: memo.updatedAt.toISOString(),
    role: memoRole(memo, viewer),
  };
}

export function serializeFolder(folder: PrismaFolder): Folder {
  return {
    id: folder.id,
    name: folder.name,
    ownerId: folder.ownerId,
    createdAt: folder.createdAt.toISOString(),
  };
}

/** Validate the stored JSON into a clean KanbanColumn[] (or null). */
export function readKanbanColumns(value: unknown): KanbanColumn[] | null {
  if (!Array.isArray(value)) return null;
  const cols = value
    .filter(
      (c): c is KanbanColumn =>
        !!c &&
        typeof c === 'object' &&
        typeof (c as KanbanColumn).id === 'string' &&
        typeof (c as KanbanColumn).label === 'string',
    )
    .map((c) => ({ id: c.id, label: c.label }));
  return cols.length ? cols : null;
}

export function serializeUser(user: PrismaUser): UserProfile {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    photoURL: user.photoURL,
    frequentCollaborators: user.frequentCollaborators,
    kanbanColumns: readKanbanColumns(user.kanbanColumns),
    isAdmin: isAdmin(user.email),
  };
}
