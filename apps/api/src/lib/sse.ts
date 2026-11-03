/**
 * In-memory pub/sub for Server-Sent Events.
 *
 * Coolify runs one instance per app, so a process-local map is enough. If this
 * ever scales horizontally, swap `publish` for Postgres LISTEN/NOTIFY.
 */
import type { Response } from 'express';
import type { StreamEvent } from '@noteshare/shared';

const subscribers = new Map<string, Set<Response>>();

export function subscribe(userId: string, res: Response): () => void {
  let set = subscribers.get(userId);
  if (!set) {
    set = new Set();
    subscribers.set(userId, set);
  }
  set.add(res);

  return () => {
    const s = subscribers.get(userId);
    if (!s) return;
    s.delete(res);
    if (s.size === 0) subscribers.delete(userId);
  };
}

/**
 * Whether a user currently has the app open (at least one live SSE stream).
 * Used to skip redundant emails — an online user already sees the in-app
 * notification. `req.on('close')` in the stream route keeps this accurate.
 */
export function isOnline(userId: string): boolean {
  const set = subscribers.get(userId);
  return !!set && set.size > 0;
}

export function publish(userIds: Iterable<string>, event: StreamEvent): void {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  const seen = new Set<string>();
  for (const userId of userIds) {
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);
    const set = subscribers.get(userId);
    if (!set) continue;
    for (const res of set) {
      res.write(payload);
    }
  }
}

export function heartbeatAll(): void {
  for (const set of subscribers.values()) {
    for (const res of set) res.write(': ping\n\n');
  }
}
