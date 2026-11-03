import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, RefreshCw } from 'lucide-react';

/**
 * Shown when a view has no data AND its load failed — usually the API
 * restarting during a deploy. Keeps auto-retrying (react-query gives up after
 * a handful) and offers a manual retry, instead of a dead end.
 */
export default function ConnectionError({
  onRetry,
  isFetching,
}: {
  onRetry: () => void;
  isFetching: boolean;
}) {
  const { t } = useTranslation();
  const [secs, setSecs] = useState(4);
  const retryRef = useRef(onRetry);
  retryRef.current = onRetry;

  useEffect(() => {
    const tick = setInterval(() => {
      setSecs((s) => {
        if (s <= 1) {
          retryRef.current();
          return 4;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
      <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
      <div className="space-y-1">
        <p className="font-semibold text-stone-600 dark:text-stone-300">
          {t('reconnecting') || 'Sin conexión con el servidor, reintentando…'}
        </p>
        <p className="text-xs text-stone-400">
          {isFetching
            ? t('retrying_now') || 'Reintentando…'
            : `${t('retry_in') || 'Reintento en'} ${secs}s`}
        </p>
      </div>
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl border border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors"
      >
        <RefreshCw className="w-4 h-4" />
        {t('retry_now') || 'Reintentar ahora'}
      </button>
    </div>
  );
}
