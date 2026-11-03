import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Pencil,
  Download,
  Maximize2,
  Calendar,
  MapPin,
  Users,
  CheckCircle2,
  Circle,
} from 'lucide-react';
import { format } from 'date-fns';
import { Memo } from '../types';
import { renderWithLinks, downloadImage } from '../utils';
import NoteComments, { noteIsShared } from './NoteComments';
import ImageLightbox from './ImageLightbox';
import { useBackable } from '../hooks/useBackable';

interface NoteViewModalProps {
  memo: Memo | null;
  onClose: () => void;
  onEdit: (memo: Memo) => void;
}

/**
 * Read-only note view, shared by the notes list, shared-notes and calendar.
 * The pencil in the header hands off to the editor. Near-fullscreen on mobile.
 */
export default function NoteViewModal({ memo, onClose, onEdit }: NoteViewModalProps) {
  const { t } = useTranslation();
  const [fullScreenIndex, setFullScreenIndex] = useState<number | null>(null);
  useBackable(!!memo, onClose);

  const shared =
    !!memo &&
    ((memo.shareCode != null && memo.shareCode !== '') ||
      (memo.allowedEmails && memo.allowedEmails.length > 0));

  return (
    <>
      <AnimatePresence>
        {memo && (
          <div
            className="fixed inset-0 z-[50] flex items-center justify-center p-0 sm:p-6 bg-black/40 backdrop-blur-sm"
            onClick={onClose}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white dark:bg-stone-900 w-full h-[100dvh] max-h-[100dvh] rounded-none sm:h-auto sm:max-h-[92vh] sm:rounded-3xl sm:max-w-3xl md:max-w-[min(96vw,1600px)] md:h-[94vh] md:max-h-[94vh] shadow-2xl flex flex-col overflow-hidden"
            >
              <div className="p-6 sm:p-8 bg-stone-50 dark:bg-stone-800/50 flex justify-between items-start gap-4 border-b border-stone-100 dark:border-stone-800 shrink-0">
                <div className="flex items-start gap-3 min-w-0">
                  <div
                    className="w-11 h-11 rounded-2xl flex items-center justify-center shadow-inner shrink-0"
                    style={{ backgroundColor: memo.color }}
                  >
                    {memo.type === 'list' ? (
                      <CheckCircle2 className="w-5 h-5 text-black/40" />
                    ) : (
                      <Circle className="w-5 h-5 text-black/40" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-xl sm:text-2xl font-bold dark:text-white leading-tight break-words">
                      {memo.title}
                    </h2>
                    <div className="flex items-center gap-3 text-xs sm:text-sm text-stone-500 mt-1.5 font-medium">
                      <span>{format(new Date(memo.updatedAt), 'PPp')}</span>
                      {shared && (
                        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                          <Users className="w-4 h-4" /> {t('shared') || 'Compartido'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => { onEdit(memo); onClose(); }}
                    title={t('edit')}
                    className="p-2.5 bg-white dark:bg-stone-800 hover:bg-stone-100 dark:hover:bg-stone-700 rounded-xl transition-all text-stone-600 dark:text-stone-400"
                  >
                    <Pencil className="w-5 h-5" />
                  </button>
                  <button
                    onClick={onClose}
                    title={t('close')}
                    className="p-2.5 bg-white dark:bg-stone-800 hover:bg-stone-100 dark:hover:bg-stone-700 rounded-xl transition-all text-stone-600 dark:text-stone-400"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="flex-1 min-h-0 p-6 sm:p-8 overflow-y-auto custom-scrollbar bg-white dark:bg-stone-900">
                {memo.imageUrls.length > 0 && (
                  <div className="mb-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {memo.imageUrls.map((url, idx) => (
                      <div
                        key={idx}
                        className="relative group cursor-zoom-in"
                        onClick={() => setFullScreenIndex(idx)}
                      >
                        <img
                          src={url}
                          alt={`${memo.title} - ${idx + 1}`}
                          className="w-full h-auto rounded-2xl default-img-handling object-cover shadow-sm"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl flex items-center justify-center gap-4 backdrop-blur-[2px]">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              downloadImage(url, `${memo.title || 'imagen'}-${idx + 1}.webp`);
                            }}
                            className="p-3 bg-black/40 hover:bg-black/60 rounded-full text-white backdrop-blur-md transition-all"
                            title={t('download') || 'Download'}
                          >
                            <Download className="w-6 h-6" />
                          </button>
                          <div className="p-3 bg-black/40 rounded-full text-white backdrop-blur-md">
                            <Maximize2 className="w-6 h-6" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <p className="text-stone-700 dark:text-stone-300 text-lg whitespace-pre-wrap leading-relaxed">
                  {renderWithLinks(memo.content)}
                </p>

                {memo.tags.length > 0 && (
                  <div className="mt-8 flex flex-wrap gap-2">
                    {memo.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-3 py-1 bg-stone-100 dark:bg-stone-800 rounded-full text-xs font-semibold text-stone-600 dark:text-stone-400"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}

                {(memo.dueDate || memo.location) && (
                  <div className="grid grid-cols-2 gap-4 border-t border-stone-100 dark:border-stone-800 mt-8 pt-6 text-sm text-stone-500 dark:text-stone-400">
                    {memo.dueDate && (
                      <div className="flex items-center gap-2">
                        <Calendar className="w-5 h-5 text-stone-400 shrink-0" />
                        <div>
                          <p className="text-xs text-stone-400 dark:text-stone-500 font-bold uppercase tracking-widest">
                            {t('due_date')}
                          </p>
                          <p className="font-semibold">{format(new Date(memo.dueDate), 'PPP')}</p>
                        </div>
                      </div>
                    )}
                    {memo.location && (
                      <div className="flex items-center gap-2 col-span-2 sm:col-span-1">
                        <MapPin className="w-5 h-5 text-stone-400 shrink-0" />
                        <div>
                          <p className="text-xs text-stone-400 dark:text-stone-500 font-bold uppercase tracking-widest">
                            {t('location')}
                          </p>
                          <p className="font-semibold">{memo.location.name}</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {noteIsShared(memo) && (
                  <div className="border-t border-stone-100 dark:border-stone-800 mt-8 pt-6">
                    <NoteComments memo={memo} />
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {fullScreenIndex !== null && memo && (
        <ImageLightbox
          images={memo.imageUrls}
          index={fullScreenIndex}
          onIndexChange={setFullScreenIndex}
          onClose={() => setFullScreenIndex(null)}
          downloadName={(i) => `${memo.title || 'imagen'}-${i + 1}.webp`}
        />
      )}
    </>
  );
}
