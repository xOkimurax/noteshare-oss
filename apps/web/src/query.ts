import { QueryClient } from '@tanstack/react-query';

/** HTTP status that means "the request itself was wrong" — retrying won't help. */
function isClientError(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  return (
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    status !== 408 && // request timeout
    status !== 429 // rate limited
  );
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: true,
      // Bridge the window when the API restarts on deploy (can be ~30-60s with
      // the migrate-on-boot step): keep retrying network / 5xx errors with
      // backoff, but give up immediately on a real 4xx.
      retry: (failureCount, error) =>
        !isClientError(error) && failureCount < 8,
      retryDelay: (attempt) => Math.min(1500 * 2 ** attempt, 8_000),
    },
  },
});

export const qk = {
  memos: ['memos'] as const,
  folders: ['folders'] as const,
  shared: ['shared'] as const,
  tokens: ['tokens'] as const,
  notifications: ['notifications'] as const,
  contacts: ['contacts'] as const,
  comments: (memoId: string) => ['comments', memoId] as const,
  commentUnreads: ['comment-unreads'] as const,
  conversations: ['conversations'] as const,
  messages: (convId: string) => ['messages', convId] as const,
  conversationMedia: (convId: string, imagesPage = 1) =>
    ['conversation-media', convId, imagesPage] as const,
  groupMembers: (convId: string) => ['group-members', convId] as const,
};
