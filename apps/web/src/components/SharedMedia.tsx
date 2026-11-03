import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, FileText, CheckSquare, Loader2, ImageIcon, Link2, Search } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { api, assetUrl } from '../api';
import { qk } from '../query';
import { timeAgo } from '../utils';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface SharedMediaProps {
  conversationId: string;
  onOpenSharedNote?: (memoId: string) => void;
  onViewImage: (images: string[], index: number) => void;
}

/**
 * Shared photos / notes / links for a conversation — the bottom half of both
 * ChatContactInfo (1:1) and ChatGroupInfo (group), factored out since the two
 * panels show identical sections here.
 */
export default function SharedMedia({ conversationId, onOpenSharedNote, onViewImage }: SharedMediaProps) {
  const { t } = useTranslation();
  const [imagesPage, setImagesPage] = useState(1);
  const [noteSearch, setNoteSearch] = useState('');
  const { data, isLoading, isPlaceholderData } = useQuery({
    queryKey: qk.conversationMedia(conversationId, imagesPage),
    queryFn: () => api.getConversationMedia(conversationId, imagesPage),
    placeholderData: keepPreviousData,
  });
  const images = data?.images ?? [];
  const imagesTotal = data?.imagesTotal ?? 0;
  const imagesPageSize = data?.imagesPageSize ?? 9;
  const totalImagePages = Math.max(1, Math.ceil(imagesTotal / imagesPageSize));
  const notes = data?.notes ?? [];
  const urls = data?.urls ?? [];
  const filteredNotes = useMemo(() => {
    const q = noteSearch.trim().toLowerCase();
    return q ? notes.filter((n) => n.title.toLowerCase().includes(q)) : notes;
  }, [notes, noteSearch]);

  return (
    <>
      <div className="p-4 space-y-2">
        <h4 className="text-xs font-bold uppercase tracking-wider text-stone-400 flex items-center gap-1.5">
          <ImageIcon className="w-3.5 h-3.5" />
          {t('shared_photos', { defaultValue: 'Fotos compartidas' })}
          {imagesTotal > 0 && ` (${imagesTotal})`}
        </h4>
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-stone-400" />
          </div>
        ) : images.length === 0 ? (
          <p className="text-sm text-stone-400 italic py-2">
            {t('no_shared_photos', { defaultValue: 'Todavía no se compartieron fotos.' })}
          </p>
        ) : (
          <>
            <div
              className={cn(
                'grid grid-cols-3 gap-1.5 transition-opacity',
                isPlaceholderData && 'opacity-50',
              )}
            >
              {images.map((img, i) => (
                <button
                  key={`${img.url}-${i}`}
                  type="button"
                  onClick={() => onViewImage(images.map((im) => assetUrl(im.url)), i)}
                  className="aspect-square rounded-lg overflow-hidden cursor-zoom-in"
                >
                  <img
                    src={assetUrl(img.url)}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
            {totalImagePages > 1 && (
              <div className="flex items-center justify-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setImagesPage((p) => Math.max(1, p - 1))}
                  disabled={imagesPage <= 1}
                  className="p-1.5 rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs text-stone-400">
                  {t('page_of', {
                    defaultValue: 'Página {{page}} de {{total}}',
                    page: imagesPage,
                    total: totalImagePages,
                  })}
                </span>
                <button
                  type="button"
                  onClick={() => setImagesPage((p) => Math.min(totalImagePages, p + 1))}
                  disabled={imagesPage >= totalImagePages}
                  className="p-1.5 rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="p-4 space-y-2 border-t border-stone-100 dark:border-stone-800">
        <h4 className="text-xs font-bold uppercase tracking-wider text-stone-400 flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5" />
          {t('shared_notes', { defaultValue: 'Notas compartidas' })}
          {notes.length > 0 && ` (${notes.length})`}
        </h4>
        {!isLoading && notes.length === 0 && (
          <p className="text-sm text-stone-400 italic py-2">
            {t('no_shared_notes', { defaultValue: 'Todavía no se compartieron notas.' })}
          </p>
        )}
        {notes.length > 0 && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400" />
            <input
              type="text"
              value={noteSearch}
              onChange={(e) => setNoteSearch(e.target.value)}
              placeholder={t('search_notes', { defaultValue: 'Buscar en las notas...' })}
              className="w-full pl-8 pr-3 py-1.5 bg-stone-50 dark:bg-stone-800 border-transparent rounded-lg focus:bg-white dark:focus:bg-stone-700 focus:ring-2 focus:ring-emerald-500 transition-all outline-none text-xs dark:text-white"
            />
          </div>
        )}
        {notes.length > 0 && filteredNotes.length === 0 && (
          <p className="text-sm text-stone-400 italic py-2">
            {t('no_notes_match', { defaultValue: 'Ninguna nota coincide con la búsqueda.' })}
          </p>
        )}
        <div className="space-y-1">
          {filteredNotes.map((n) => (
            <button
              key={n.id}
              type="button"
              disabled={!n.accessible}
              onClick={() => n.accessible && onOpenSharedNote?.(n.id)}
              className={cn(
                'w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left border transition-colors',
                n.accessible
                  ? 'bg-stone-50 dark:bg-stone-800 border-transparent hover:border-emerald-400 dark:hover:border-emerald-500 cursor-pointer'
                  : 'bg-stone-50 dark:bg-stone-800/60 border-transparent opacity-60 cursor-default',
              )}
            >
              <span className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
                {n.type === 'list' ? (
                  <CheckSquare className="w-4 h-4" />
                ) : (
                  <FileText className="w-4 h-4" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium truncate dark:text-stone-200">
                  {n.title || t('note_unavailable')}
                </span>
                <span className="block text-[11px] text-stone-400">{timeAgo(n.createdAt)}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 space-y-2 border-t border-stone-100 dark:border-stone-800">
        <h4 className="text-xs font-bold uppercase tracking-wider text-stone-400 flex items-center gap-1.5">
          <Link2 className="w-3.5 h-3.5" />
          {t('shared_urls', { defaultValue: 'Enlaces compartidos' })}
          {urls.length > 0 && ` (${urls.length})`}
        </h4>
        {!isLoading && urls.length === 0 && (
          <p className="text-sm text-stone-400 italic py-2">
            {t('no_shared_urls', { defaultValue: 'Todavía no se compartieron enlaces.' })}
          </p>
        )}
        <div className="space-y-1">
          {urls.map((u, i) => {
            const href = /^https?:\/\//i.test(u.url) ? u.url : `https://${u.url}`;
            return (
              <a
                key={`${u.url}-${i}`}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 bg-stone-50 dark:bg-stone-800 border border-transparent hover:border-emerald-400 dark:hover:border-emerald-500 transition-colors"
              >
                <span className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 flex items-center justify-center shrink-0">
                  <Link2 className="w-4 h-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium truncate text-blue-600 dark:text-blue-400">
                    {u.url}
                  </span>
                  <span className="block text-[11px] text-stone-400">{timeAgo(u.createdAt)}</span>
                </span>
              </a>
            );
          })}
        </div>
      </div>
    </>
  );
}
