import { useEffect, useState } from 'react';
import { api, assetUrl, type PublicMemo } from '../api';
import { renderWithLinks } from '../utils';
import { FileText, MapPin, AlertCircle } from 'lucide-react';

interface PublicNoteViewProps {
  // New short links pass `slug` (?p=<publicSlug>). Older links shared before
  // the slug feature existed pass `memoId` (?public=<memoId>) directly.
  slug?: string;
  memoId?: string;
}

type LoadState = 'loading' | 'not_found' | 'ready';

export default function PublicNoteView({ slug, memoId }: PublicNoteViewProps) {
  const [memo, setMemo] = useState<PublicMemo | null>(null);
  const [state, setState] = useState<LoadState>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = slug
          ? await api.publicBySlug(slug)
          : memoId
            ? await api.publicById(memoId)
            : null;
        if (cancelled) return;
        if (!data) {
          setState('not_found');
          return;
        }
        setMemo(data);
        setState('ready');
      } catch {
        if (!cancelled) setState('not_found');
      }
    })();
    return () => { cancelled = true; };
  }, [slug, memoId]);

  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50 dark:bg-stone-950">
        <div className="w-8 h-8 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (state === 'not_found' || !memo) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50 dark:bg-stone-950 p-4">
        <div className="text-center space-y-3 max-w-sm">
          <AlertCircle className="w-10 h-10 text-stone-400 mx-auto" />
          <h1 className="text-lg font-bold text-stone-700 dark:text-stone-200">Nota no disponible</h1>
          <p className="text-sm text-stone-500 dark:text-stone-400">
            Este enlace no existe o el dueño dejó de compartirlo públicamente.
          </p>
        </div>
      </div>
    );
  }

  const images = memo.images
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((i) => assetUrl(i.url));

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-2 mb-4 text-stone-400 dark:text-stone-600 text-xs font-medium">
          <FileText className="w-3.5 h-3.5" />
          <span>Nota pública compartida vía Noteshare</span>
        </div>

        <div className="bg-white dark:bg-stone-900 rounded-3xl shadow-lg border border-stone-100 dark:border-stone-800 overflow-hidden">
          <div
            className="h-2"
            style={{ backgroundColor: memo.color || '#10b981' }}
          />
          <div className="p-6 sm:p-8 space-y-5">
            <h1 className="text-2xl font-bold text-stone-900 dark:text-white break-words">{memo.title}</h1>

            {images.length > 0 && (
              <div className="grid grid-cols-1 gap-3">
                {images.map((src, i) => (
                  <img key={i} src={src} alt="" className="w-full h-auto rounded-2xl object-cover shadow-sm" referrerPolicy="no-referrer" />
                ))}
              </div>
            )}

            <p className="text-stone-700 dark:text-stone-300 whitespace-pre-wrap break-words leading-relaxed">
              {renderWithLinks(memo.content)}
            </p>

            {memo.location && (
              <div className="flex items-center gap-2 text-sm text-stone-500 dark:text-stone-400">
                <MapPin className="w-4 h-4 shrink-0" />
                <span>{memo.location.name || `${memo.location.lat}, ${memo.location.lng}`}</span>
              </div>
            )}

            {memo.tags && memo.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2 border-t border-stone-100 dark:border-stone-800">
                {memo.tags.map(tag => (
                  <span key={tag} className="px-2.5 py-1 bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 text-xs font-medium rounded-full">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-stone-400 dark:text-stone-600 mt-6">
          Vista de solo lectura. Solo el dueño de la nota puede editarla.
        </p>
      </div>
    </div>
  );
}
