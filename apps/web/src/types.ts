import type {
  Memo as ApiMemo,
  Folder as ApiFolder,
  Location as ApiLocation,
  KanbanStatus as ApiKanbanStatus,
  MemoType as ApiMemoType,
  UserProfile,
} from '@noteshare/shared';

export type KanbanStatus = ApiKanbanStatus;
export type MemoType = ApiMemoType;
export type Location = ApiLocation;

/**
 * The API `Memo` plus the flattened image URLs the components use
 * (added client-side by `normalizeMemo` in api.ts).
 */
export interface Memo extends ApiMemo {
  /** Absolute URLs, ordered. Always present (possibly empty). */
  imageUrls: string[];
}

export type Folder = ApiFolder;

export type { UserProfile };
