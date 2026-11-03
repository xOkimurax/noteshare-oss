import { useSyncExternalStore } from 'react';

/**
 * Ephemeral "X is typing" state, keyed by conversationId and then by userId
 * (a group can have more than one person typing at once) — never touches
 * react-query, a typing ping is never worth caching or refetching, just a
 * transient SSE blip with a client-side TTL as a safety net for a ping that
 * never got its "stopped" follow-up (tab closed mid-keystroke, etc).
 */
const TTL_MS = 5000;

const typingUsers = new Map<string, Set<string>>();
// Keyed by `${conversationId}:${userId}` — each typing user has their own
// independent TTL, so one person stopping doesn't clear another's.
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
let version = 0;

function notify(): void {
  version++;
  for (const l of listeners) l();
}

export function setTypingSignal(conversationId: string, userId: string, typing: boolean): void {
  const key = `${conversationId}:${userId}`;
  const existingTimer = timers.get(key);
  if (existingTimer) clearTimeout(existingTimer);
  timers.delete(key);

  let set = typingUsers.get(conversationId);
  if (typing) {
    if (!set) {
      set = new Set();
      typingUsers.set(conversationId, set);
    }
    set.add(userId);
    timers.set(
      key,
      setTimeout(() => {
        set?.delete(userId);
        if (set && set.size === 0) typingUsers.delete(conversationId);
        timers.delete(key);
        notify();
      }, TTL_MS),
    );
  } else if (set) {
    set.delete(userId);
    if (set.size === 0) typingUsers.delete(conversationId);
  }
  notify();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Re-renders the caller whenever any conversation's typing state changes. */
export function useTypingVersion(): number {
  return useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
}

export function isTyping(conversationId: string | null | undefined): boolean {
  if (!conversationId) return false;
  const set = typingUsers.get(conversationId);
  return !!set && set.size > 0;
}

/** userIds currently typing in this conversation, if any (order unspecified). */
export function typingUserIds(conversationId: string | null | undefined): string[] {
  if (!conversationId) return [];
  const set = typingUsers.get(conversationId);
  return set ? [...set] : [];
}
