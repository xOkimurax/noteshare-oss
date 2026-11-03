import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight, Download, Pencil, X } from 'lucide-react';
import { downloadImage } from '../utils';
import { useBackable } from '../hooks/useBackable';

interface ImageLightboxProps {
  images: string[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  downloadName?: (index: number) => string;
  // Only set for a pending (not-yet-sent) attachment — there's no
  // "edit a message you already sent" feature.
  onEdit?: () => void;
}

/**
 * Fullscreen image viewer shared by notes, the note editor and chat. Left/
 * right arrows browse the gallery on desktop; hidden on mobile (thumb reach)
 * where a WhatsApp-style swipe does the same thing instead.
 */
export default function ImageLightbox({
  images,
  index,
  onIndexChange,
  onClose,
  downloadName,
  onEdit,
}: ImageLightboxProps) {
  const touchStartX = useRef<number | null>(null);
  const current = images[index];
  const hasMultiple = images.length > 1;
  const canPrev = index > 0;
  const canNext = index < images.length - 1;

  const goPrev = () => canPrev && onIndexChange(index - 1);
  const goNext = () => canNext && onIndexChange(index + 1);

  // Always mounted only while actually shown — its own unmount IS the close.
  useBackable(true, onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, images.length]);

  if (!current) return null;

  const SWIPE_THRESHOLD = 50;
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current == null) return;
    const dx = (e.changedTouches[0]?.clientX ?? touchStartX.current) - touchStartX.current;
    touchStartX.current = null;
    if (dx > SWIPE_THRESHOLD) goPrev();
    else if (dx < -SWIPE_THRESHOLD) goNext();
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/90 p-4"
      onClick={onClose}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.img
          key={current}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.15 }}
          src={current}
          alt=""
          referrerPolicy="no-referrer"
          draggable={false}
          className="max-w-full max-h-full object-contain rounded-lg select-none"
          onClick={(e) => e.stopPropagation()}
        />
      </AnimatePresence>

      {hasMultiple && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 text-white/80 text-xs font-semibold bg-black/40 px-3 py-1 rounded-full pointer-events-none">
          {index + 1} / {images.length}
        </div>
      )}

      {hasMultiple && canPrev && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            goPrev();
          }}
          title="Anterior"
          className="hidden sm:flex absolute left-4 top-1/2 -translate-y-1/2 p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-all"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
      )}
      {hasMultiple && canNext && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            goNext();
          }}
          title="Siguiente"
          className="hidden sm:flex absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-all"
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      )}

      {onEdit && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          title="Editar imagen"
          className="absolute top-6 left-6 p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-all"
        >
          <Pencil className="w-6 h-6" />
        </button>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="absolute top-6 right-6 p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-all"
      >
        <X className="w-6 h-6" />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          downloadImage(current, downloadName ? downloadName(index) : `imagen-${index + 1}.webp`);
        }}
        title="Download"
        className="absolute bottom-6 right-6 p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-all"
      >
        <Download className="w-6 h-6" />
      </button>
    </div>
  );
}
