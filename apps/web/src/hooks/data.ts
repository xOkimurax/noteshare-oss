import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '../api';
import { qk } from '../query';
import { useAuth } from '../auth';
import type { Memo, Folder } from '../types';

export function useMemos() {
  const q = useQuery({ queryKey: qk.memos, queryFn: api.listMemos });
  return {
    memos: q.data ?? [],
    loading: q.isLoading,
    error: q.error,
    refetch: q.refetch,
    isFetching: q.isFetching,
  };
}

export function useFolders() {
  const q = useQuery({ queryKey: qk.folders, queryFn: api.listFolders });
  return { folders: q.data ?? [], loading: q.isLoading, error: q.error };
}

export function useSharedNotes() {
  const q = useQuery({ queryKey: qk.shared, queryFn: api.listShared });
  return {
    memos: q.data ?? [],
    loading: q.isLoading,
    error: q.error,
    refetch: q.refetch,
    isFetching: q.isFetching,
  };
}

export function useNotifications() {
  const q = useQuery({
    queryKey: qk.notifications,
    queryFn: api.listNotifications,
    refetchInterval: 60_000,
  });
  return {
    items: q.data?.items ?? [],
    unreadCount: q.data?.unreadCount ?? 0,
    loading: q.isLoading,
  };
}

export function useContacts() {
  const q = useQuery({ queryKey: qk.contacts, queryFn: api.listContacts });
  return { contacts: q.data ?? [], loading: q.isLoading };
}

// --- chat: note comments ---------------------------------------------------

export function useComments(memoId: string | null) {
  const q = useQuery({
    queryKey: qk.comments(memoId ?? '_'),
    queryFn: () => api.listComments(memoId as string),
    enabled: !!memoId,
  });
  return {
    items: q.data?.items ?? [],
    lastReadAt: q.data?.lastReadAt ?? null,
    loading: q.isLoading,
    refetch: q.refetch,
  };
}

/** memoId -> unread comment count. Polled + refreshed on the SSE event. */
export function useCommentUnreads() {
  const q = useQuery({
    queryKey: qk.commentUnreads,
    queryFn: api.commentUnreads,
    refetchInterval: 60_000,
  });
  return new Map((q.data ?? []).map((r) => [r.memoId, r.count]));
}

// --- chat: direct messages ----------------------------------------------

export function useConversations() {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: qk.conversations,
    queryFn: api.listConversations,
    refetchInterval: 60_000,
    enabled: !!user,
  });
  const conversations = q.data ?? [];
  return {
    conversations,
    totalUnread: conversations.reduce((n, c) => n + c.unread, 0),
    loading: q.isLoading,
  };
}

export function useMessages(convId: string | null) {
  const q = useQuery({
    queryKey: qk.messages(convId ?? '_'),
    queryFn: () => api.listMessages(convId as string, { limit: 30 }),
    enabled: !!convId,
  });
  return {
    items: q.data?.items ?? [],
    hasMore: q.data?.hasMore ?? false,
    loading: q.isLoading,
    refetch: q.refetch,
  };
}

/** Invalidate the lists that a memo write can affect. */
export function useInvalidateMemos() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: qk.memos });
    qc.invalidateQueries({ queryKey: qk.shared });
  };
}

export function useCreateMemo() {
  const invalidate = useInvalidateMemos();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.createMemo>[0]) =>
      api.createMemo(input),
    onSuccess: invalidate,
  });
}

export function useUpdateMemo() {
  const invalidate = useInvalidateMemos();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Memo> | Record<string, unknown> }) =>
      api.updateMemo(id, patch),
    onSuccess: invalidate,
  });
}

export function useDeleteMemo() {
  const invalidate = useInvalidateMemos();
  return useMutation({
    mutationFn: (id: string) => api.deleteMemo(id),
    onSuccess: invalidate,
  });
}

export function useFolderMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.folders });
    qc.invalidateQueries({ queryKey: qk.memos });
  };
  return {
    create: useMutation({ mutationFn: api.createFolder, onSuccess: invalidate }),
    rename: useMutation({
      mutationFn: ({ id, name }: { id: string; name: string }) =>
        api.renameFolder(id, name),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: api.deleteFolder, onSuccess: invalidate }),
  };
}

export type { Memo, Folder };
