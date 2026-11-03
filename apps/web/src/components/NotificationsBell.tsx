import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'motion/react';
import { Bell, Share2, UserPlus, Pencil, Check, Trash2, MessageSquare, MessagesSquare, Sparkles, Users } from 'lucide-react';
import type { AppNotification } from '@noteshare/shared';
import { api } from '../api';
import { qk } from '../query';
import { timeAgo } from '../utils';
import { useNotifications } from '../hooks/data';
import { useBackable } from '../hooks/useBackable';

const ICONS: Record<AppNotification['type'], typeof Share2> = {
  'memo.shared': Share2,
  'memo.joined': UserPlus,
  'memo.updated': Pencil,
  'memo.comment': MessageSquare,
  'dm.message': MessagesSquare,
  'system.announcement': Sparkles,
  'group.added': Users,
};

function line(n: AppNotification): string {
  const who = n.actorName || 'Alguien';
  const title = n.memoTitle || 'una nota';
  switch (n.type) {
    case 'memo.shared':
      return `${who} compartió "${title}" con vos`;
    case 'memo.joined':
      return `${who} se unió a "${title}"`;
    case 'memo.updated':
      return `${who} editó "${title}"`;
    case 'memo.comment':
      return `${who} comentó en "${title}"`;
    case 'dm.message':
      return `${who} te escribió`;
    case 'system.announcement':
      return n.memoTitle;
    case 'group.added':
      return `${who} te agregó al grupo "${title}"`;
    default:
      return title;
  }
}

export default function NotificationsBell({
  onOpenChat,
  onOpenMemo,
}: {
  onOpenChat?: (conversationId: string) => void;
  /** Opens the note a memo.* notification refers to (shared or my own). */
  onOpenMemo?: (memoId: string) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { items, unreadCount } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useBackable(open, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  type NotifData = { items: AppNotification[]; unreadCount: number };

  const openPanel = async () => {
    setOpen((v) => !v);
    if (!open && unreadCount > 0) {
      // Optimistic: flip to read instantly, reconcile with the server in the
      // background — waiting on the round-trip here just reads as lag.
      await qc.cancelQueries({ queryKey: qk.notifications });
      const prev = qc.getQueryData<NotifData>(qk.notifications);
      if (prev) {
        qc.setQueryData<NotifData>(qk.notifications, {
          items: prev.items.map((n) => ({ ...n, read: true })),
          unreadCount: 0,
        });
      }
      api.markNotificationsRead().catch(() => {
        if (prev) qc.setQueryData<NotifData>(qk.notifications, prev);
      });
    }
  };

  const clearAll = async () => {
    await qc.cancelQueries({ queryKey: qk.notifications });
    const prev = qc.getQueryData<NotifData>(qk.notifications);
    qc.setQueryData<NotifData>(qk.notifications, { items: [], unreadCount: 0 });
    api.clearNotifications().catch(() => {
      if (prev) qc.setQueryData<NotifData>(qk.notifications, prev);
    });
  };

  const tr = (k: string) => t(k) || k;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={openPanel}
        className="relative p-2 text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-lg transition-all"
        title={tr('notifications')}
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <>
            {/* Mobile-only backdrop — signals a sheet is open, tap to dismiss. */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-[65] bg-black/40 backdrop-blur-sm sm:hidden"
            />
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 24 }}
              className="fixed inset-x-0 bottom-0 z-[70] w-full rounded-t-3xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80 sm:max-w-[calc(100vw-2rem)] sm:rounded-2xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100 dark:border-stone-800">
                <span className="font-bold text-sm dark:text-white">
                  {tr('notifications')}
                </span>
                {items.length > 0 && (
                  <button
                    onClick={clearAll}
                    className="flex items-center gap-1 text-xs text-stone-400 hover:text-red-500 transition-colors p-1 -m-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {tr('clear')}
                  </button>
                )}
              </div>

              <div className="max-h-[70dvh] sm:max-h-[60vh] overflow-y-auto custom-scrollbar">
                {items.length === 0 ? (
                  <div className="px-4 py-10 text-center text-sm text-stone-400">
                    {tr('no_notifications')}
                  </div>
                ) : (
                  items.map((n) => {
                    const Icon = ICONS[n.type] ?? Bell;
                    const target =
                      (n.type === 'dm.message' || n.type === 'group.added') && n.conversationId
                        ? () => onOpenChat?.(n.conversationId!)
                        : n.memoId
                          ? () => onOpenMemo?.(n.memoId!)
                          : null;
                    const clickable = !!target;
                    return (
                      <div
                        key={n.id}
                        onClick={
                          clickable
                            ? () => {
                                target!();
                                setOpen(false);
                              }
                            : undefined
                        }
                        className={
                          'flex gap-3 px-4 py-3.5 sm:py-3 border-b border-stone-50 dark:border-stone-800/50 last:border-0 ' +
                          (clickable ? 'cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-800/40 active:bg-stone-100 dark:active:bg-stone-800 ' : '') +
                          (n.read ? '' : 'bg-emerald-50/50 dark:bg-emerald-900/10')
                        }
                      >
                        <div className="w-8 h-8 rounded-lg bg-stone-100 dark:bg-stone-800 flex items-center justify-center shrink-0">
                          <Icon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm text-stone-700 dark:text-stone-200 leading-snug">
                            {line(n)}
                          </p>
                          <p className="text-[11px] text-stone-400 mt-0.5">
                            {timeAgo(n.createdAt)}
                          </p>
                        </div>
                        {!n.read && (
                          <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-1" />
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
