import { useTranslation } from 'react-i18next';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { ChatParticipant } from '@noteshare/shared';
import { assetUrl } from '../api';
import { timeAgo } from '../utils';
import SharedMedia from './SharedMedia';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ChatContactInfoProps {
  other: ChatParticipant;
  conversationId: string;
  onOpenSharedNote?: (memoId: string) => void;
  onViewImage: (images: string[], index: number) => void;
}

/**
 * Contact info as an in-place view inside the same chat panel — not a modal
 * — so it replaces the thread's header/messages/composer rather than
 * floating over them. ChatView owns the back-button header; this renders
 * only the scrollable body.
 */
export default function ChatContactInfo({
  other,
  conversationId,
  onOpenSharedNote,
  onViewImage,
}: ChatContactInfoProps) {
  const { t } = useTranslation();
  const photoURL = other.photoURL ? assetUrl(other.photoURL) : '';

  return (
    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
      <div className="flex flex-col items-center gap-3 px-6 py-8 border-b border-stone-100 dark:border-stone-800">
        {photoURL ? (
          <button
            type="button"
            onClick={() => onViewImage([photoURL], 0)}
            className="cursor-zoom-in rounded-full"
            title={t('view_photo', { defaultValue: 'Ver foto' })}
          >
            <img
              src={photoURL}
              alt={other.name}
              referrerPolicy="no-referrer"
              className="w-28 h-28 rounded-full object-cover shadow-lg"
            />
          </button>
        ) : (
          <div className="w-28 h-28 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 flex items-center justify-center text-4xl font-bold">
            {(other.name || '?').trim().charAt(0).toUpperCase()}
          </div>
        )}
        <div className="text-center">
          <p className="text-lg font-bold dark:text-white">{other.name}</p>
          <p className="text-sm text-stone-400">{other.email}</p>
          <p
            className={cn(
              'text-xs mt-1',
              other.online ? 'text-emerald-600 dark:text-emerald-400' : 'text-stone-400',
            )}
          >
            {other.online ? t('online_now') : t('last_seen', { time: timeAgo(other.lastSeenAt) })}
          </p>
        </div>
      </div>

      <SharedMedia
        conversationId={conversationId}
        onOpenSharedNote={onOpenSharedNote}
        onViewImage={onViewImage}
      />
    </div>
  );
}
