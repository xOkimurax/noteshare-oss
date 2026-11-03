import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'motion/react';
import {
  Clock,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  Search,
  Eraser,
  GripVertical,
} from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { KanbanColumn } from '@noteshare/shared';
import { Memo } from '../types';
import { api } from '../api';
import { qk } from '../query';
import { useAuth } from '../auth';
import { useMemos, useUpdateMemo } from '../hooks/data';
import { useBackable } from '../hooks/useBackable';

interface KanbanBoardProps {
  onEdit?: (memo: Memo) => void;
}

type DialogState =
  | { kind: 'add' }
  | { kind: 'rename'; col: KanbanColumn }
  | { kind: 'delete'; col: KanbanColumn }
  | { kind: 'clear'; col: KanbanColumn }
  | null;

const slugify = (label: string) =>
  label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'col';

const isOverdue = (dueDate: string | null) =>
  !!dueDate && new Date(dueDate) < new Date();

export default function KanbanBoard({ onEdit }: KanbanBoardProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user, refresh } = useAuth();
  const { memos: allMemos, loading } = useMemos();
  const updateMemo = useUpdateMemo();

  const DEFAULT_COLUMNS: KanbanColumn[] = [
    { id: 'pending', label: t('pending') },
    { id: 'in-progress', label: t('in_progress') },
    { id: 'completed', label: t('completed') },
  ];
  const columns: KanbanColumn[] = user?.kanbanColumns ?? DEFAULT_COLUMNS;
  const lastColumnId = columns[columns.length - 1]?.id;

  const memos = useMemo(() => allMemos.filter((m) => m.type === 'list'), [allMemos]);

  // --- filter bar ---
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);

  const allTags = useMemo(
    () => [...new Set(memos.flatMap((m) => m.tags))].sort(),
    [memos],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return memos.filter((m) => {
      if (q && !m.title.toLowerCase().includes(q) && !m.content.toLowerCase().includes(q))
        return false;
      if (tag && !m.tags.includes(tag)) return false;
      if (overdueOnly && !(isOverdue(m.dueDate) && m.kanbanStatus !== lastColumnId))
        return false;
      return true;
    });
  }, [memos, query, tag, overdueOnly, lastColumnId]);

  const cardsByColumn = (colId: string) =>
    visible.filter((m) => m.kanbanStatus === colId);

  // --- column persistence ---
  const [savingCols, setSavingCols] = useState(false);
  const persistColumns = async (next: KanbanColumn[]) => {
    setSavingCols(true);
    try {
      await api.setKanbanColumns(next);
      await refresh();
      qc.invalidateQueries({ queryKey: qk.memos });
    } catch (err) {
      console.error('Error saving kanban columns:', err);
    } finally {
      setSavingCols(false);
    }
  };

  // In-app dialogs (no native confirm()/prompt()).
  const [dialog, setDialog] = useState<DialogState>(null);

  const doAddColumn = (label: string) => {
    const clean = label.trim().slice(0, 40);
    if (!clean) return;
    let id = slugify(clean);
    const taken = new Set(columns.map((c) => c.id));
    if (taken.has(id)) {
      let n = 2;
      while (taken.has(`${id}-${n}`)) n += 1;
      id = `${id}-${n}`;
    }
    void persistColumns([...columns, { id, label: clean }]);
  };

  const doRenameColumn = (id: string, label: string) => {
    const clean = label.trim().slice(0, 40);
    if (!clean) return;
    void persistColumns(columns.map((c) => (c.id === id ? { ...c, label: clean } : c)));
  };

  const doDeleteColumn = (id: string) => {
    if (columns.length <= 1) return;
    void persistColumns(columns.filter((c) => c.id !== id));
  };

  const doClearColumn = async (col: KanbanColumn) => {
    try {
      await api.clearKanban({ status: col.id });
      qc.invalidateQueries({ queryKey: qk.memos });
    } catch (err) {
      console.error('Error clearing column:', err);
    }
  };

  const onDialogConfirm = (value?: string) => {
    if (!dialog) return;
    if (dialog.kind === 'add' && value) doAddColumn(value);
    if (dialog.kind === 'rename' && value) doRenameColumn(dialog.col.id, value);
    if (dialog.kind === 'delete') doDeleteColumn(dialog.col.id);
    if (dialog.kind === 'clear') void doClearColumn(dialog.col);
    setDialog(null);
  };

  // --- drag & drop ---
  const [activeCard, setActiveCard] = useState<Memo | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    if (id.startsWith('card:')) {
      setActiveCard(memos.find((m) => m.id === id.slice(5)) ?? null);
    }
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveCard(null);
    const a = String(e.active.id);
    const over = e.over ? String(e.over.id) : null;
    if (!over) return;

    if (a.startsWith('card:')) {
      const memo = memos.find((m) => m.id === a.slice(5));
      const targetCol = over.startsWith('drop:') ? over.slice(5) : null;
      if (memo && targetCol && memo.kanbanStatus !== targetCol) {
        void moveMemo(memo, targetCol);
      }
      return;
    }

    if (a.startsWith('col:') && over.startsWith('col:') && a !== over) {
      const from = columns.findIndex((c) => `col:${c.id}` === a);
      const to = columns.findIndex((c) => `col:${c.id}` === over);
      if (from >= 0 && to >= 0) void persistColumns(arrayMove(columns, from, to));
    }
  };

  const moveMemo = async (memo: Memo, newStatus: string) => {
    try {
      // kanbanStatus is a free string server-side (any column id).
      await updateMemo.mutateAsync({ id: memo.id, patch: { kanbanStatus: newStatus } });
    } catch (err) {
      console.error('Error moving memo:', err);
    }
  };

  // Time a memo has spent in the given column: from that column's log entry to
  // the next-recorded log entry (any column), else "now".
  const timeInState = (memo: Memo, colId: string) => {
    const logs = memo.kanbanTimeLogs || {};
    const start = logs[colId];
    if (!start) return '0m';
    const laterStamps = Object.values(logs).filter((ts) => ts > start);
    const end = laterStamps.length ? Math.min(...laterStamps) : Date.now();
    const mins = Math.max(0, Math.floor((end - start) / 60000));
    const hrs = Math.floor(mins / 60);
    return hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m`;
  };

  if (loading) return <div className="text-center py-20 text-stone-400">{t('loading')}</div>;

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('filter_cards', { defaultValue: 'Filtrar tarjetas...' })}
            className="w-full pl-9 pr-3 py-2 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-sm dark:text-white"
          />
        </div>
        {allTags.length > 0 && (
          <select
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            className="px-3 py-2 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl text-sm dark:text-white outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="">{t('all_tags', { defaultValue: 'Todas las etiquetas' })}</option>
            {allTags.map((tg) => (
              <option key={tg} value={tg}>#{tg}</option>
            ))}
          </select>
        )}
        <button
          onClick={() => setOverdueOnly((v) => !v)}
          className={
            'px-3 py-2 rounded-xl text-sm font-semibold border transition-colors ' +
            (overdueOnly
              ? 'bg-red-500 text-white border-red-500'
              : 'bg-white dark:bg-stone-900 text-stone-500 dark:text-stone-400 border-stone-200 dark:border-stone-800 hover:bg-stone-50 dark:hover:bg-stone-800')
          }
        >
          <AlertTriangle className="w-4 h-4 inline -mt-0.5 mr-1" />
          {t('only_overdue', { defaultValue: 'Solo vencidas' })}
        </button>
        <button
          onClick={() => setDialog({ kind: 'add' })}
          disabled={savingCols || columns.length >= 12}
          className="px-3 py-2 rounded-xl text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-50 shrink-0"
        >
          <Plus className="w-4 h-4 inline -mt-0.5 mr-1" />
          {t('add_column', { defaultValue: 'Columna' })}
        </button>
      </div>

      {/* Board */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveCard(null)}
      >
        <div className="flex-1 min-h-0 flex gap-4 overflow-x-auto pb-2">
          <SortableContext
            items={columns.map((c) => `col:${c.id}`)}
            strategy={horizontalListSortingStrategy}
          >
            {columns.map((col) => (
              <Column
                key={col.id}
                col={col}
                count={cardsByColumn(col.id).length}
                canDelete={columns.length > 1}
                onRename={() => setDialog({ kind: 'rename', col })}
                onDelete={() => setDialog({ kind: 'delete', col })}
                onClear={() => setDialog({ kind: 'clear', col })}
              >
                {cardsByColumn(col.id).map((memo) => (
                  <Card
                    key={memo.id}
                    memo={memo}
                    isLast={col.id === lastColumnId}
                    timeLabel={timeInState(memo, col.id)}
                    onEdit={onEdit}
                    t={t}
                  />
                ))}
                {cardsByColumn(col.id).length === 0 && (
                  <p className="text-xs text-stone-400 dark:text-stone-600 italic text-center py-6">
                    {t('no_cards', { defaultValue: 'Sin tarjetas' })}
                  </p>
                )}
              </Column>
            ))}
          </SortableContext>
        </div>

        <DragOverlay>
          {activeCard && (
            <div className="bg-white dark:bg-stone-800 p-4 rounded-xl shadow-lg border border-emerald-300 dark:border-emerald-700 w-[280px] rotate-2">
              <h4 className="font-bold line-clamp-2 dark:text-white text-sm">{activeCard.title}</h4>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <KanbanDialog dialog={dialog} onCancel={() => setDialog(null)} onConfirm={onDialogConfirm} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function KanbanDialog({
  dialog,
  onCancel,
  onConfirm,
}: {
  dialog: DialogState;
  onCancel: () => void;
  onConfirm: (value?: string) => void;
}) {
  const { t } = useTranslation();
  const isPrompt = dialog?.kind === 'add' || dialog?.kind === 'rename';
  const [value, setValue] = useState('');
  useBackable(!!dialog, onCancel);

  // Prefill / reset whenever a new dialog opens.
  const dialogKey = dialog
    ? dialog.kind + ('col' in dialog ? `:${dialog.col.id}` : '')
    : 'none';
  const prevKey = useRef(dialogKey);
  if (prevKey.current !== dialogKey) {
    prevKey.current = dialogKey;
    setValue(dialog?.kind === 'rename' ? dialog.col.label : '');
  }

  const destructive = dialog?.kind === 'delete';

  const meta = (() => {
    switch (dialog?.kind) {
      case 'add':
        return { icon: <Plus className="w-8 h-8" />, tone: 'emerald',
          title: t('add_column', { defaultValue: 'Añadir columna' }), body: null };
      case 'rename':
        return { icon: <Pencil className="w-8 h-8" />, tone: 'emerald',
          title: t('rename', { defaultValue: 'Renombrar' }), body: null };
      case 'delete':
        return { icon: <Trash2 className="w-8 h-8" />, tone: 'red',
          title: t('delete_column', { defaultValue: 'Eliminar columna' }),
          body: t('delete_column_confirm', { defaultValue: 'Se elimina la columna y sus tarjetas pasan a la primera.' }) };
      case 'clear':
        return { icon: <Eraser className="w-8 h-8" />, tone: 'amber',
          title: t('clear_column', { defaultValue: 'Limpiar columna' }),
          body: t('clear_column_confirm', {
            col: dialog.col.label,
            defaultValue: 'Las tarjetas de «{{col}}» salen del tablero y quedan como notas normales.',
          }) };
      default:
        return null;
    }
  })();

  const tone =
    meta?.tone === 'red'
      ? 'bg-red-100 dark:bg-red-900/30 text-red-600'
      : meta?.tone === 'amber'
        ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600'
        : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600';

  const canConfirm = !isPrompt || value.trim().length > 0;

  return (
    <AnimatePresence>
      {dialog && meta && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
            className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-sm bg-white dark:bg-stone-900 rounded-3xl shadow-2xl p-8 space-y-6 overflow-hidden"
          >
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto ${tone}`}>
              {meta.icon}
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-xl font-bold dark:text-white">{meta.title}</h3>
              {meta.body && <p className="text-stone-500 dark:text-stone-400 text-sm">{meta.body}</p>}
            </div>

            {isPrompt && (
              <input
                autoFocus
                value={value}
                maxLength={40}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canConfirm) onConfirm(value);
                  if (e.key === 'Escape') onCancel();
                }}
                placeholder={t('column_name', { defaultValue: 'Nombre de la columna' })}
                className="w-full px-4 py-2.5 bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-sm dark:text-white"
              />
            )}

            <div className="flex flex-col gap-3">
              <button
                onClick={() => onConfirm(isPrompt ? value : undefined)}
                disabled={!canConfirm}
                className={
                  'w-full py-3 text-white font-bold rounded-xl transition-all disabled:opacity-50 ' +
                  (destructive
                    ? 'bg-red-600 hover:bg-red-700 shadow-lg shadow-red-600/20'
                    : 'bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-600/10')
                }
              >
                {destructive
                  ? t('delete', { defaultValue: 'Eliminar' })
                  : dialog.kind === 'clear'
                    ? t('clear', { defaultValue: 'Limpiar' })
                    : t('save', { defaultValue: 'Aceptar' })}
              </button>
              <button
                onClick={onCancel}
                className="w-full py-3 bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 font-bold rounded-xl transition-all"
              >
                {t('cancel', { defaultValue: 'Cancelar' })}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------

function Column({
  col,
  count,
  canDelete,
  onRename,
  onDelete,
  onClear,
  children,
}: {
  col: KanbanColumn;
  count: number;
  canDelete: boolean;
  onRename: () => void;
  onDelete: () => void;
  onClear: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } =
    useSortable({ id: `col:${col.id}` });
  const drop = useDroppable({ id: `drop:${col.id}` });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group w-[300px] shrink-0 rounded-2xl bg-stone-100 dark:bg-stone-900/50 p-3 flex flex-col"
    >
      <div className="flex items-center gap-1 mb-3 px-1">
        <button
          {...attributes}
          {...listeners}
          className="p-1 -ml-1 text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 cursor-grab active:cursor-grabbing touch-none"
          title={t('reorder', { defaultValue: 'Reordenar' })}
        >
          <GripVertical className="w-4 h-4" />
        </button>

        <h3 className="flex-1 min-w-0 truncate font-bold text-stone-700 dark:text-stone-300 uppercase tracking-wider text-sm">
          {col.label}
        </h3>

        <span className="bg-white/70 dark:bg-stone-800/70 px-2 py-0.5 rounded-full text-xs font-bold text-stone-500 dark:text-stone-400 shrink-0">
          {count}
        </span>

        <div className="flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 hover:opacity-100 transition-opacity">
          <button onClick={onRename} title={t('rename', { defaultValue: 'Renombrar' })} className="p-1 text-stone-400 hover:text-emerald-600">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={onClear} disabled={count === 0} title={t('clear', { defaultValue: 'Limpiar' })} className="p-1 text-stone-400 hover:text-amber-600 disabled:opacity-30 disabled:hover:text-stone-400">
            <Eraser className="w-3.5 h-3.5" />
          </button>
          {canDelete && (
            <button onClick={onDelete} title={t('delete', { defaultValue: 'Eliminar' })} className="p-1 text-stone-400 hover:text-red-500">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div
        ref={drop.setNodeRef}
        className={
          'flex-1 space-y-3 overflow-y-auto pr-1 min-h-[80px] rounded-xl transition-colors ' +
          (drop.isOver ? 'bg-emerald-100/50 dark:bg-emerald-900/20' : '')
        }
      >
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Card({
  memo,
  isLast,
  timeLabel,
  onEdit,
  t,
}: {
  memo: Memo;
  isLast: boolean;
  timeLabel: string;
  onEdit?: (memo: Memo) => void;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `card:${memo.id}`,
  });
  const overdue = isOverdue(memo.dueDate) && !isLast;

  return (
    <motion.div
      ref={setNodeRef}
      layout
      style={{ transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.4 : 1 }}
      {...attributes}
      {...listeners}
      onClick={() => onEdit?.(memo)}
      className={
        'bg-white dark:bg-stone-800 p-4 rounded-xl shadow-sm border transition-colors cursor-pointer touch-none ' +
        (overdue
          ? 'border-red-200 dark:border-red-900/50 bg-red-50/30 dark:bg-red-900/5'
          : 'border-stone-200 dark:border-stone-700')
      }
    >
      <div className="flex justify-between items-start mb-2 gap-2">
        <h4 className="font-bold line-clamp-2 dark:text-white flex-1 text-sm">{memo.title}</h4>
        {overdue && (
          <span className="flex items-center gap-1 text-[10px] font-bold text-red-500 bg-red-100 dark:bg-red-900/30 px-2 py-0.5 rounded-full uppercase shrink-0">
            <AlertTriangle className="w-3 h-3" />
            {t('overdue')}
          </span>
        )}
        {isLast && <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />}
      </div>

      {memo.content && (
        <p className="text-xs text-stone-500 dark:text-stone-400 line-clamp-3 mb-3">{memo.content}</p>
      )}

      <div className="flex items-center justify-between mt-auto pt-2 border-t border-stone-50 dark:border-stone-700/60">
        <span className="flex items-center gap-1 text-[10px] font-bold text-stone-400 dark:text-stone-500">
          <Clock className="w-3 h-3" />
          {timeLabel}
        </span>
        {memo.dueDate && (
          <span className={'text-[9px] font-medium ' + (overdue ? 'text-red-400' : 'text-stone-400')}>
            {new Date(memo.dueDate).toLocaleDateString()}
          </span>
        )}
      </div>

      {memo.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {memo.tags.slice(0, 3).map((tg) => (
            <span key={tg} className="text-[9px] font-bold uppercase tracking-wide text-stone-400 dark:text-stone-500 bg-black/5 dark:bg-white/5 px-1.5 py-0.5 rounded">
              #{tg}
            </span>
          ))}
        </div>
      )}
    </motion.div>
  );
}
