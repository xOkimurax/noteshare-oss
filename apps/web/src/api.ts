/**
 * Typed client for the Noteshare REST API. Every call sends cookies
 * (`credentials: 'include'`) so the httpOnly JWT rides along.
 */
import type {
  ApiToken,
  AppNotification,
  ChatConversation,
  ChatGroupMember,
  ChatParticipant,
  Contact,
  ConversationMedia,
  DirectMessage,
  Folder,
  KanbanColumn,
  Memo as ApiMemo,
  MemoComment,
  ShareInput,
  UserProfile,
  UserSearchResult,
} from '@noteshare/shared';
import type { Memo } from './types';
import { IS_EMBEDDED, embedToken, requestParentLogin } from './lib/embed';

export type { Contact };

export const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

// The access-token cookie lives ~15 min; the refresh cookie ~30 days. When a
// tab sits idle past 15 min every request 401s. Rather than surface that as a
// "no connection" error, silently swap in a fresh access token and retry once.
// One shared in-flight refresh so a burst of 401s (react-query refetching the
// whole app on focus) triggers exactly one /api/auth/refresh.
let refreshInFlight: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  retried = false,
): Promise<T> {
  const tok = embedToken();
  const res = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: {
      ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
      ...(init.body && !(init.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...init.headers,
    },
    ...init,
  });

  if (res.status === 401 && !retried && !path.startsWith('/api/auth/')) {
    if (IS_EMBEDDED) {
      // No cookies to refresh in the panel — the stored PAT is stale/revoked.
      requestParentLogin();
    } else if (await refreshSession()) {
      // Expired access token → refresh once and replay the original request.
      return request<T>(path, init, true);
    } else {
      // The refresh itself failed — the session is genuinely dead. Tell the
      // app so it shows the login screen instead of looping "no connection".
      window.dispatchEvent(new Event('noteshare:auth-lost'));
    }
  }

  // Still 401 after a refresh + replay → the new session is broken too.
  if (res.status === 401 && retried && !IS_EMBEDDED) {
    window.dispatchEvent(new Event('noteshare:auth-lost'));
  }

  if (res.status === 204) return undefined as T;

  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!res.ok) {
    const b = body as { error?: string; code?: string } | null;
    throw new ApiError(res.status, b?.error ?? res.statusText, b?.code);
  }
  return body as T;
}

/** Absolute URL for an image path returned by the API. */
export function assetUrl(path: string): string {
  return path.startsWith('http') ? path : `${API_URL}${path}`;
}

/** Absolute-ises a possibly-relative `photoURL` (Google's own URLs are already absolute). */
export function normalizeUser(u: UserProfile): UserProfile {
  return { ...u, photoURL: u.photoURL ? assetUrl(u.photoURL) : u.photoURL };
}

/** Flattens `images` into the ordered absolute-URL list the components use. */
export function normalizeMemo(m: ApiMemo): Memo {
  const imageUrls = m.images
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((i) => assetUrl(i.url));
  return { ...m, imageUrls };
}

export interface PublicMemo {
  id: string;
  title: string;
  content: string;
  color: string;
  tags: string[];
  location: { lat: number; lng: number; name: string } | null;
  images: { id: string; url: string; position: number }[];
  createdAt: string;
}

export const api = {
  // --- auth ---
  me: () => request<UserProfile>('/api/auth/me').then(normalizeUser),
  refresh: () =>
    request<UserProfile>('/api/auth/refresh', { method: 'POST' }).then(normalizeUser),
  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  loginUrl: () => `${API_URL}/api/auth/google`,

  // --- memos ---
  listMemos: () => request<ApiMemo[]>('/api/memos').then((r) => r.map(normalizeMemo)),
  getMemo: (id: string) =>
    request<ApiMemo>(`/api/memos/${id}`).then(normalizeMemo),
  createMemo: (input: unknown) =>
    request<ApiMemo>('/api/memos', {
      method: 'POST',
      body: JSON.stringify(input),
    }).then(normalizeMemo),
  updateMemo: (id: string, patch: unknown) =>
    request<ApiMemo>(`/api/memos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }).then(normalizeMemo),
  deleteMemo: (id: string) =>
    request<{ ok: true }>(`/api/memos/${id}`, { method: 'DELETE' }),

  // --- sharing ---
  listShared: () =>
    request<ApiMemo[]>('/api/shared').then((r) => r.map(normalizeMemo)),
  updateShare: (id: string, input: ShareInput) =>
    request<ApiMemo>(`/api/memos/${id}/share`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }).then(normalizeMemo),
  removeShare: (id: string) =>
    request<ApiMemo>(`/api/memos/${id}/share`, { method: 'DELETE' }).then(
      normalizeMemo,
    ),
  checkShareCode: (id: string, code: string) =>
    request<{ unique: boolean }>(
      `/api/memos/${id}/share/check-code?code=${encodeURIComponent(code)}`,
    ),
  checkSlug: (id: string, slug: string) =>
    request<{ unique: boolean }>(
      `/api/memos/${id}/share/check-slug?slug=${encodeURIComponent(slug)}`,
    ),
  joinByCode: (code: string) =>
    request<ApiMemo>(`/api/memos/join`, {
      method: 'POST',
      body: JSON.stringify({ code }),
    }).then(normalizeMemo),
  leaveMemo: (id: string) =>
    request<{ ok: true }>(`/api/memos/${id}/collaborators/me`, {
      method: 'DELETE',
    }),

  // --- images ---
  uploadImages: (id: string, files: File[]) => {
    const fd = new FormData();
    for (const f of files) fd.append('images', f);
    return request<ApiMemo>(`/api/memos/${id}/images`, {
      method: 'POST',
      body: fd,
    }).then(normalizeMemo);
  },
  deleteImage: (memoId: string, imageId: string) =>
    request<ApiMemo>(`/api/memos/${memoId}/images/${imageId}`, {
      method: 'DELETE',
    }).then(normalizeMemo),

  // --- folders ---
  listFolders: () => request<Folder[]>('/api/folders'),
  createFolder: (name: string) =>
    request<Folder>('/api/folders', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  renameFolder: (id: string, name: string) =>
    request<Folder>(`/api/folders/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  deleteFolder: (id: string) =>
    request<{ ok: true }>(`/api/folders/${id}`, { method: 'DELETE' }),

  // --- users ---
  lookupUser: (email: string) =>
    request<{ exists: boolean; id: string | null }>(
      `/api/users/lookup?email=${encodeURIComponent(email)}`,
    ),
  lookupUsername: (username: string) =>
    request<{ exists: boolean; id: string | null }>(
      `/api/users/lookup?username=${encodeURIComponent(username)}`,
    ),
  updateProfile: (patch: {
    displayName?: string;
    username?: string;
    frequentCollaborators?: string[];
  }) =>
    request<UserProfile>('/api/users/me', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }).then(normalizeUser),
  updateProfilePhoto: (file: File) => {
    const fd = new FormData();
    fd.append('photo', file);
    return request<UserProfile>('/api/users/me/photo', {
      method: 'POST',
      body: fd,
    }).then(normalizeUser);
  },
  deleteAccount: () =>
    request<{ ok: true }>('/api/users/me', { method: 'DELETE' }),

  // --- kanban ---
  getKanbanColumns: () =>
    request<{ columns: KanbanColumn[] | null }>('/api/kanban/columns'),
  setKanbanColumns: (columns: KanbanColumn[]) =>
    request<{ columns: KanbanColumn[] }>('/api/kanban/columns', {
      method: 'PUT',
      body: JSON.stringify({ columns }),
    }),
  clearKanban: (opts: { status?: string } = {}) =>
    request<{ cleared: number }>('/api/kanban/clear', {
      method: 'POST',
      body: JSON.stringify(opts.status ? { status: opts.status } : {}),
    }),

  // --- contacts ---
  listContacts: () => request<Contact[]>('/api/contacts'),
  addContact: (identifier: { email: string } | { username: string }, alias?: string) =>
    request<Contact>('/api/contacts', {
      method: 'POST',
      body: JSON.stringify(alias ? { ...identifier, alias } : identifier),
    }),
  updateContact: (
    id: string,
    patch: { alias?: string | null; favorite?: boolean },
  ) =>
    request<Contact>(`/api/contacts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteContact: (id: string) =>
    request<{ ok: true }>(`/api/contacts/${id}`, { method: 'DELETE' }),
  searchUsers: (q: string) =>
    request<{ items: UserSearchResult[] }>(`/api/users/search?q=${encodeURIComponent(q)}`),

  // --- tokens (MCP) ---
  listTokens: () => request<ApiToken[]>('/api/tokens'),
  createToken: (name: string) =>
    request<ApiToken>('/api/tokens', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  deleteToken: (id: string) =>
    request<{ ok: true }>(`/api/tokens/${id}`, { method: 'DELETE' }),

  // --- notifications ---
  listNotifications: () =>
    request<{ items: AppNotification[]; unreadCount: number }>(
      '/api/notifications',
    ),
  markNotificationsRead: (ids?: string[]) =>
    request<{ ok: true }>('/api/notifications/read', {
      method: 'POST',
      body: JSON.stringify(ids ? { ids } : {}),
    }),
  clearNotifications: () =>
    request<{ ok: true }>('/api/notifications', { method: 'DELETE' }),
  /** Admin only — broadcasts a "what's new" notification to every user. */
  announceToAllUsers: (message: string) =>
    request<{ ok: true; count: number }>('/api/notifications/announce', {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),

  // --- note comments ---
  listComments: (memoId: string) =>
    request<{ items: MemoComment[]; lastReadAt: string | null }>(
      `/api/memos/${memoId}/comments`,
    ),
  addComment: (memoId: string, body: string) =>
    request<MemoComment>(`/api/memos/${memoId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
  editComment: (memoId: string, cid: string, body: string) =>
    request<MemoComment>(`/api/memos/${memoId}/comments/${cid}`, {
      method: 'PATCH',
      body: JSON.stringify({ body }),
    }),
  deleteComment: (memoId: string, cid: string) =>
    request<{ ok: true }>(`/api/memos/${memoId}/comments/${cid}`, {
      method: 'DELETE',
    }),
  markCommentsRead: (memoId: string) =>
    request<{ ok: true }>(`/api/memos/${memoId}/comments/read`, {
      method: 'POST',
    }),
  commentUnreads: () =>
    request<Array<{ memoId: string; count: number }>>('/api/comments/unread'),

  // --- direct messages ---
  listConversations: () =>
    request<ChatConversation[]>('/api/conversations'),
  openConversation: (arg: { email: string } | { userId: string }) =>
    request<ChatConversation>('/api/conversations/with', {
      method: 'POST',
      body: JSON.stringify(arg),
    }),
  /** memberEmails are the OTHER members (not the caller); at least 2 required. */
  createGroup: (name: string, memberEmails: string[]) =>
    request<ChatConversation>('/api/conversations/group', {
      method: 'POST',
      body: JSON.stringify({ name, memberEmails }),
    }),
  listGroupMembers: (convId: string) =>
    request<ChatGroupMember[]>(`/api/conversations/${convId}/members`),
  addGroupMembers: (convId: string, emails: string[]) =>
    request<ChatConversation>(`/api/conversations/${convId}/members`, {
      method: 'POST',
      body: JSON.stringify({ emails }),
    }),
  removeGroupMember: (convId: string, userId: string) =>
    request<{ ok: true }>(`/api/conversations/${convId}/members/${userId}`, {
      method: 'DELETE',
    }),
  /** Any current admin — promotes another member to admin too (additive,
   * never revokes the promoter's own admin status). */
  promoteToAdmin: (convId: string, userId: string) =>
    request<ChatConversation>(`/api/conversations/${convId}/admins/${userId}`, {
      method: 'POST',
    }),
  /** Any current admin — demotes another admin. The group's creator can
   * never be demoted (the API rejects that with a 403). */
  demoteAdmin: (convId: string, userId: string) =>
    request<ChatConversation>(`/api/conversations/${convId}/admins/${userId}`, {
      method: 'DELETE',
    }),
  /** Group admin only — updates the group's photo. */
  updateGroupPhoto: (convId: string, file: File) => {
    const fd = new FormData();
    fd.append('photo', file);
    return request<ChatConversation>(`/api/conversations/${convId}/photo`, {
      method: 'PATCH',
      body: fd,
    });
  },
  /** Leave (group) or delete (1:1) this conversation for yourself. */
  deleteConversation: (convId: string) =>
    request<{ ok: true }>(`/api/conversations/${convId}`, { method: 'DELETE' }),
  listMessages: (
    convId: string,
    opts: { before?: string; limit?: number } = {},
  ) => {
    const q = new URLSearchParams();
    if (opts.before) q.set('before', opts.before);
    if (opts.limit) q.set('limit', String(opts.limit));
    const qs = q.toString();
    return request<{ items: DirectMessage[]; hasMore: boolean }>(
      `/api/conversations/${convId}/messages${qs ? `?${qs}` : ''}`,
    );
  },
  getConversationMedia: (convId: string, imagesPage = 1) =>
    request<ConversationMedia>(
      `/api/conversations/${convId}/media?imagesPage=${imagesPage}`,
    ),
  sendMessage: (
    convId: string,
    body: string,
    images?: File[],
    isSticker = false,
    replyToId?: string,
    audio?: { blob: Blob; durationSec: number },
  ) => {
    if (images?.length || audio) {
      const fd = new FormData();
      if (body) fd.append('body', body);
      if (isSticker) fd.append('isSticker', 'true');
      if (replyToId) fd.append('replyToId', replyToId);
      for (const f of images ?? []) fd.append('images', f);
      if (audio) {
        // Extension is cosmetic (the server picks the real one from the
        // blob's mimetype) — this filename is just what multer sees.
        const ext = audio.blob.type.includes('mp4') ? 'm4a' : audio.blob.type.includes('ogg') ? 'ogg' : 'webm';
        fd.append('audio', audio.blob, `voice-message.${ext}`);
        fd.append('audioDurationSec', String(Math.round(audio.durationSec)));
      }
      return request<DirectMessage>(`/api/conversations/${convId}/messages`, {
        method: 'POST',
        body: fd,
      });
    }
    return request<DirectMessage>(`/api/conversations/${convId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body, ...(replyToId ? { replyToId } : {}) }),
    });
  },
  editMessage: (convId: string, messageId: string, body: string) =>
    request<DirectMessage>(`/api/conversations/${convId}/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ body }),
    }),
  deleteMessage: (convId: string, messageId: string, scope: 'me' | 'everyone') =>
    request<DirectMessage | { ok: true }>(`/api/conversations/${convId}/messages/${messageId}`, {
      method: 'DELETE',
      body: JSON.stringify({ scope }),
    }),
  setReaction: (convId: string, messageId: string, emoji: string) =>
    request<DirectMessage>(`/api/conversations/${convId}/messages/${messageId}/reaction`, {
      method: 'PUT',
      body: JSON.stringify({ emoji }),
    }),
  removeReaction: (convId: string, messageId: string) =>
    request<DirectMessage>(`/api/conversations/${convId}/messages/${messageId}/reaction`, {
      method: 'DELETE',
    }),
  /** Send an existing note you own; it gets shared with the recipient. */
  sendNote: (convId: string, memoId: string, body?: string) =>
    request<DirectMessage>(`/api/conversations/${convId}/messages`, {
      method: 'POST',
      body: JSON.stringify(body ? { memoId, body } : { memoId }),
    }),
  markConversationRead: (convId: string) =>
    request<{ ok: true }>(`/api/conversations/${convId}/read`, {
      method: 'POST',
    }),
  setTyping: (convId: string, typing = true) =>
    request<{ ok: true }>(`/api/conversations/${convId}/typing`, {
      method: 'POST',
      body: JSON.stringify({ typing }),
    }),

  // --- public (no auth) ---
  publicBySlug: (slug: string) =>
    request<PublicMemo>(`/api/public/${encodeURIComponent(slug)}`),
  publicById: (id: string) =>
    request<PublicMemo>(`/api/public/by-id/${encodeURIComponent(id)}`),
};
