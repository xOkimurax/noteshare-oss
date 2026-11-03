import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { StreamEvent } from '@noteshare/shared';
import { API_URL } from '../api';
import { embedToken, IS_EMBEDDED } from '../lib/embed';
import { qk } from '../query';
import { setTypingSignal } from './useTyping';

// EventSource can't set an Authorization header, so in the extension panel the
// PAT rides as a query param instead of a cookie.
const streamUrl = () => {
  const t = embedToken();
  return `${API_URL}/api/stream${t ? `?token=${encodeURIComponent(t)}` : ''}`;
};

/**
 * Opens the SSE stream and invalidates react-query caches when the server says
 * something the current user can see has changed.
 *
 * EventSource does reconnect on network blips, but on an HTTP error (a 401 once
 * the access-token cookie has expired) it closes for good. So we watch for that
 * and rebuild the connection ourselves — after refreshing the session, and with
 * a short backoff — and also rebuild whenever the tab becomes visible again.
 */
export function useEventStream(enabled: boolean) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let backoff = 3000;
    let closed = false;

    const handle = (e: MessageEvent) => {
      let ev: StreamEvent;
      try {
        ev = JSON.parse(e.data);
      } catch {
        return;
      }
      switch (ev.type) {
        case 'memo.changed':
        case 'memo.deleted':
          qc.invalidateQueries({ queryKey: qk.memos });
          qc.invalidateQueries({ queryKey: qk.shared });
          break;
        case 'shared.changed':
          qc.invalidateQueries({ queryKey: qk.shared });
          qc.invalidateQueries({ queryKey: qk.memos });
          break;
        case 'folder.changed':
          qc.invalidateQueries({ queryKey: qk.folders });
          break;
        case 'notification':
          qc.invalidateQueries({ queryKey: qk.notifications });
          // In the extension panel, nudge the shell to fire a native
          // desktop notification right away instead of waiting for its poll.
          if (IS_EMBEDDED) {
            window.parent?.postMessage({ type: 'noteshare:notify' }, '*');
          }
          break;
        case 'memo.comment':
          qc.invalidateQueries({ queryKey: qk.comments(ev.memoId) });
          qc.invalidateQueries({ queryKey: qk.commentUnreads });
          break;
        case 'dm':
          qc.invalidateQueries({ queryKey: qk.conversations });
          qc.invalidateQueries({ queryKey: qk.messages(ev.conversationId) });
          break;
        case 'presence':
          qc.invalidateQueries({ queryKey: qk.conversations });
          break;
        case 'typing':
          setTypingSignal(ev.conversationId, ev.userId, ev.typing);
          break;
      }
    };

    const connect = () => {
      if (closed) return;
      es?.close();
      const url = streamUrl();
      if (IS_EMBEDDED) console.log('[noteshare] SSE connecting', url);
      es = new EventSource(url, { withCredentials: true });
      es.onmessage = (e) => {
        if (IS_EMBEDDED) console.log('[noteshare] SSE message', e.data);
        handle(e);
      };
      es.onopen = () => {
        if (IS_EMBEDDED) console.log('[noteshare] SSE open');
        backoff = 3000;
      };
      es.onerror = () => {
        if (IS_EMBEDDED) {
          console.log('[noteshare] SSE error, readyState =', es?.readyState);
        }
        // Browser will retry a transient drop on its own; only step in once it
        // has actually given up (CLOSED), which is what a 401 produces.
        if (es?.readyState !== EventSource.CLOSED || closed || retry) return;
        retry = setTimeout(() => {
          retry = null;
          if (embedToken()) {
            connect();
            return;
          }
          void fetch(`${API_URL}/api/auth/refresh`, {
            method: 'POST',
            credentials: 'include',
          })
            .catch(() => {})
            .finally(connect);
        }, backoff);
        backoff = Math.min(backoff * 2, 30_000);
      };
    };

    const onVisible = () => {
      if (
        document.visibilityState === 'visible' &&
        es?.readyState !== EventSource.OPEN
      ) {
        connect();
      }
    };

    connect();
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      document.removeEventListener('visibilitychange', onVisible);
      es?.close();
    };
  }, [enabled, qc]);
}
