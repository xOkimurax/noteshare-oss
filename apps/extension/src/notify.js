import { ext, getToken } from './browser.js';
import { API_URL } from './config.js';

function title(n) {
  const who = n.actorName || 'Alguien';
  const t = n.memoTitle || 'una nota';
  switch (n.type) {
    case 'memo.shared':
      return `${who} te compartió una nota`;
    case 'memo.updated':
      return `${who} editó "${t}"`;
    case 'memo.joined':
      return `${who} se unió a "${t}"`;
    case 'memo.comment':
      return `${who} comentó en "${t}"`;
    case 'dm.message':
      return `${who} te escribió`;
    default:
      return 'Noteshare';
  }
}
function body(n) {
  if (n.type === 'dm.message') return 'Nuevo mensaje en Noteshare';
  return n.memoTitle ? `"${n.memoTitle}"` : 'Abrí Noteshare para verlo';
}

/**
 * Fetch notifications, update the toolbar badge, and fire a native
 * notification for anything new since we last checked. `onNew` runs once when
 * at least one fired (use it to play a sound). Called from both the service
 * worker (poll) and the panel (on the SSE nudge) — `lastSeenAt` in storage
 * dedupes between them.
 */
export async function checkAndNotify(onNew) {
  const token = await getToken();
  if (!token) {
    console.log('[noteshare] checkAndNotify: no token');
    ext.action?.setBadgeText?.({ text: '' });
    return;
  }

  // One quick retry — a bare `fetch` rejecting outright (not a non-2xx
  // response) is almost always a momentary blip (a deploy restarting the
  // API, a brief network drop), and the poll alarm won't come around again
  // for a full minute otherwise.
  let data;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${API_URL}/api/notifications`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        console.warn('[noteshare] notifications fetch', res.status);
        return;
      }
      data = await res.json();
      break;
    } catch (e) {
      if (attempt === 1) {
        console.warn('[noteshare] notifications fetch failed', e);
        return;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const unread = data.unreadCount || 0;
  ext.action?.setBadgeBackgroundColor?.({ color: '#059669' });
  ext.action?.setBadgeText?.({ text: unread ? String(Math.min(unread, 99)) : '' });

  const stored = await ext.storage.local.get('lastSeenAt');
  const lastSeenAt =
    stored.lastSeenAt == null ? Date.now() - 10 * 60 * 1000 : stored.lastSeenAt;

  const fresh = (data.items || [])
    .filter((n) => !n.read && new Date(n.createdAt).getTime() > lastSeenAt)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  console.log(
    `[noteshare] checkAndNotify: unread=${unread} fresh=${fresh.length}`,
  );

  await ext.storage.local.set({
    lastSeenAt: fresh.length
      ? new Date(fresh[fresh.length - 1].createdAt).getTime()
      : Date.now(),
  });
  if (fresh.length === 0) return;

  const icon = ext.runtime.getURL('icons/128.png');
  const { navTargets = {} } = await ext.storage.local.get('navTargets');
  for (const n of fresh.slice(-4)) {
    const key = `ns:${n.id}:${Date.now()}`;
    navTargets[key] = {
      type: n.type,
      memoId: n.memoId || null,
      conversationId: n.conversationId || null,
    };
    try {
      ext.notifications.create(key, {
        type: 'basic',
        iconUrl: icon,
        title: title(n),
        message: body(n),
        priority: 2,
      });
    } catch (e) {
      console.warn('[noteshare] notifications.create failed', e);
    }
  }
  // Keep only the most recent handful of targets.
  const keys = Object.keys(navTargets);
  for (const k of keys.slice(0, Math.max(0, keys.length - 20))) delete navTargets[k];
  await ext.storage.local.set({ navTargets });
  onNew?.();
}
