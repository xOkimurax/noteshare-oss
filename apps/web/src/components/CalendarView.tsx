import { useState } from 'react';
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css';
import { useTranslation } from 'react-i18next';
import { format, isSameDay } from 'date-fns';
import { Calendar as CalendarIcon, Clock } from 'lucide-react';
import { useMemos } from '../hooks/data';
import { Memo } from '../types';
import NoteViewModal from './NoteViewModal';

interface CalendarViewProps {
  onEdit?: (memo: Memo) => void;
}

export default function CalendarView({ onEdit }: CalendarViewProps) {
  const { t, i18n } = useTranslation();
  const [date, setDate] = useState(new Date());
  const [viewing, setViewing] = useState<Memo | null>(null);
  const { memos } = useMemos();

  const matchesDay = (m: Memo, day: Date) => {
    const byCreated = isSameDay(new Date(m.createdAt || m.updatedAt || new Date().toISOString()), day);
    const byDue = !!m.dueDate && isSameDay(new Date(m.dueDate), day);
    return { byCreated, byDue, any: byCreated || byDue };
  };

  const selectedDayMemos = memos
    .map(m => ({ memo: m, ...matchesDay(m, date) }))
    .filter(entry => entry.any);

  const tileContent = ({ date: tileDate, view }: { date: Date; view: string }) => {
    if (view === 'month') {
      const has = memos.some(m => matchesDay(m, tileDate).any);
      if (has) {
        return (
          <div className="flex justify-center mt-1">
            <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></div>
          </div>
        );
      }
    }
    return null;
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6 lg:gap-8 h-full overflow-hidden">
      <div className="lg:w-[420px] shrink-0 min-w-0">
        <div className="card p-4 sm:p-6 bg-white dark:bg-stone-900 rounded-3xl overflow-hidden">
          <Calendar
            onChange={(val) => setDate(val as Date)}
            value={date}
            tileContent={tileContent}
            locale={i18n.language}
            className="w-full border-none font-sans"
          />
        </div>
      </div>

      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <div className="flex items-center justify-between gap-3 mb-4 lg:mb-6 shrink-0">
          <h2 className="text-xl lg:text-2xl font-bold flex items-center gap-2 dark:text-white min-w-0">
            <CalendarIcon className="w-6 h-6 text-emerald-600 shrink-0" />
            <span className="truncate">{format(date, 'MMMM d, yyyy')}</span>
          </h2>
          <span className="shrink-0 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 px-3 py-1 rounded-full text-xs font-bold">
            {t('memos_count', { count: selectedDayMemos.length })}
          </span>
        </div>

        <div className="flex-1 min-h-[45vh] lg:min-h-0 space-y-4 overflow-y-auto pr-1 sm:pr-2">
          {selectedDayMemos.map(({ memo, byCreated, byDue }) => (
            <button
              type="button"
              key={memo.id}
              onClick={() => setViewing(memo)}
              className="w-full text-left block p-4 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 shadow-sm hover:shadow-md hover:border-emerald-300 dark:hover:border-emerald-700 hover:-translate-y-0.5 transition-all cursor-pointer"
              style={{ borderLeftWidth: '6px', borderLeftColor: memo.color }}
            >
              <div className="flex justify-between items-start gap-2 mb-2">
                <h4 className="font-bold dark:text-white min-w-0 truncate">{memo.title}</h4>
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {byCreated
                    ? format(new Date(memo.createdAt), 'p')
                    : memo.dueDate
                      ? format(new Date(memo.dueDate), 'p')
                      : ''}
                  {!byCreated && byDue && (
                    <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                      {t('due') || 'vence'}
                    </span>
                  )}
                </span>
              </div>
              <p className="text-sm text-stone-500 dark:text-stone-400 line-clamp-2 break-words">{memo.content}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {memo.tags.map(tag => (
                  <span key={tag} className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">#{tag}</span>
                ))}
              </div>
            </button>
          ))}

          {selectedDayMemos.length === 0 && (
            <div className="text-center py-20 bg-stone-100/50 dark:bg-stone-900/50 rounded-3xl border-2 border-dashed border-stone-200 dark:border-stone-800">
              <p className="text-stone-400 dark:text-stone-500">{t('no_memos_scheduled')}</p>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .react-calendar {
          width: 100%;
          background: transparent;
          border: none;
          font-family: inherit;
        }
        .dark .react-calendar {
          color: white;
        }
        .react-calendar__navigation button {
          color: #065f46;
          font-weight: bold;
          font-size: 1.1rem;
        }
        .dark .react-calendar__navigation button {
          color: #10b981;
        }
        .react-calendar__navigation button:enabled:hover,
        .react-calendar__navigation button:enabled:focus {
          background-color: #f3f4f6;
          border-radius: 12px;
        }
        .dark .react-calendar__navigation button:enabled:hover,
        .dark .react-calendar__navigation button:enabled:focus {
          background-color: #1f2937;
        }
        .react-calendar__month-view__weekdays {
          text-transform: uppercase;
          font-weight: bold;
          font-size: 0.7rem;
          color: #9ca3af;
        }
        .react-calendar__tile--active {
          background: #059669 !important;
          border-radius: 12px;
          color: white !important;
        }
        .react-calendar__tile--now {
          background: #ecfdf5;
          border-radius: 12px;
          color: #059669;
          font-weight: bold;
        }
        .dark .react-calendar__tile--now {
          background: #064e3b;
          color: #10b981;
        }
        .react-calendar__tile:hover {
          background: #f3f4f6;
          border-radius: 12px;
        }
        .dark .react-calendar__tile:hover {
          background: #1f2937;
        }
        .dark .react-calendar__tile {
          color: #d1d5db;
        }
        .dark .react-calendar__month-view__days__day--neighboringMonth {
          color: #4b5563;
        }
      `}</style>

      <NoteViewModal
        memo={viewing}
        onClose={() => setViewing(null)}
        onEdit={(m) => { onEdit?.(m); setViewing(null); }}
      />
    </div>
  );
}
