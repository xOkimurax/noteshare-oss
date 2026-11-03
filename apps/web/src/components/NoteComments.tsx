import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, Pencil, Trash2, Check, X, Loader2, MessageCircle } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useComments } from '../hooks/data';
import { timeAgo, renderWithLinks } from '../utils';
import { Memo } from '../types';

interface NoteCommentsProps {
  memo: Memo;
  /** Compact styling for the smaller view modal. */
  dense?: boolean;
}

/**
 * Whether a note has a comment thread worth showing — i.e. it is shared in
 * some way, or the viewer reached it as a collaborator / invitee.
 */
export function noteIsShared(memo: Memo): boolean {
  return (
    !!memo.shareCode ||
    memo.allowAnyone ||
    memo.isPublic ||
    (memo.allowedEmails?.length ?? 0) > 0 ||
    (memo.collaborators?.length ?? 0) > 0 ||
    (!!memo.role && memo.role !== 'owner')
  );
}

/**
 * Per-note comment thread. Rendered inside the view / edit modals only when
 * the note is shared. Stays live through the `memo.comment` SSE event, which
 * the event stream turns into a `qk.comments(memoId)` invalidation.
 */
export default function NoteComments({ memo, dense = false }: NoteCommentsProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { items, loading, refetch } = useComments(memo.id);

  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const isOwner = user?.id === memo.ownerId;

  // Mark the thread read while it's on screen and whenever new messages arrive.
  useEffect(() => {
    if (!loading) void api.markCommentsRead(memo.id).catch(() => {});
  }, [memo.id, items.length, loading]);

  // Keep the latest message in view.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length]);

  const send = async () => {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await api.addComment(memo.id, text);
      setBody('');
      refetch();
    } catch (err) {
      console.error('Error posting comment:', err);
    } finally {
      setSending(false);
    }
  };

  const startEdit = (id: string, current: string) => {
    setEditingId(id);
    setEditBody(current);
  };

  const saveEdit = async (id: string) => {
    const text = editBody.trim();
    if (!text || busyId) return;
    setBusyId(id);
    try {
      await api.editComment(memo.id, id, text);
      setEditingId(null);
      setEditBody('');
      refetch();
    } catch (err) {
      console.error('Error editing comment:', err);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    if (busyId) return;
    setBusyId(id);
    try {
      await api.deleteComment(memo.id, id);
      refetch();
    } catch (err) {
      console.error('Error deleting comment:', err);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col min-h-0">
      <h4 className="text-xs font-bold uppercase tracking-widest text-stone-400 dark:text-stone-500 flex items-center gap-2 mb-3">
        <MessageCircle className="w-4 h-4" />
        {t('comments') || 'Comentarios'}
        {items.length > 0 && (
          <span className="text-stone-400 dark:text-stone-500 normal-case tracking-normal font-medium">
            ({items.length})
          </span>
        )}
      </h4>

      <div
        ref={listRef}
        className={
          'flex-1 min-h-0 overflow-y-auto space-y-4 pr-1 ' +
          (dense ? 'max-h-64' : 'min-h-[8rem] max-h-[60vh]')
        }
      >
        {loading && (
          <div className="flex justify-center py-4 text-stone-400">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}

        {!loading && items.length === 0 && (
          <p className="text-sm text-stone-400 dark:text-stone-500 italic py-4 text-center">
            {t('no_comments_yet') || 'Todavía no hay comentarios. Escribí el primero.'}
          </p>
        )}

        {items.map((c) => {
          const canEdit = c.mine;
          const canDelete = c.mine || isOwner;
          const isEditing = editingId === c.id;
          return (
            <div key={c.id} className="flex gap-2.5">
              {c.authorPhotoURL ? (
                <img
                  src={c.authorPhotoURL}
                  alt=""
                  className="w-7 h-7 rounded-full object-cover shrink-0 mt-0.5"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                  {(c.authorName || '?').slice(0, 1).toUpperCase()}
                </span>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold dark:text-stone-200 truncate">
                    {c.mine ? t('you') || 'Vos' : c.authorName || '—'}
                  </span>
                  <span className="text-[10px] text-stone-400 dark:text-stone-500 shrink-0">
                    {timeAgo(c.createdAt)}
                    {c.editedAt && ` · ${t('comment_edited') || 'editado'}`}
                  </span>
                </div>

                {isEditing ? (
                  <div className="mt-1 space-y-2">
                    <textarea
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      rows={2}
                      className="w-full px-3 py-2 bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg focus:ring-2 focus:ring-emerald-500 transition-all outline-none text-sm dark:text-white resize-none"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => saveEdit(c.id)}
                        disabled={busyId === c.id || !editBody.trim()}
                        className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1 disabled:opacity-50"
                      >
                        {busyId === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        {t('save') || 'Guardar'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setEditingId(null); setEditBody(''); }}
                        className="px-2.5 py-1 bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 rounded-lg text-xs font-semibold flex items-center gap-1"
                      >
                        <X className="w-3.5 h-3.5" />
                        {t('cancel') || 'Cancelar'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-stone-700 dark:text-stone-300 whitespace-pre-wrap break-words">
                      {renderWithLinks(c.body)}
                    </p>
                    {(canEdit || canDelete) && (
                      <div className="flex gap-3 mt-0.5">
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => startEdit(c.id, c.body)}
                            className="text-[11px] text-stone-400 hover:text-emerald-600 dark:hover:text-emerald-400 font-semibold flex items-center gap-1 transition-colors"
                          >
                            <Pencil className="w-3 h-3" /> {t('edit') || 'Editar'}
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => remove(c.id)}
                            disabled={busyId === c.id}
                            className="text-[11px] text-stone-400 hover:text-red-500 font-semibold flex items-center gap-1 transition-colors disabled:opacity-50"
                          >
                            {busyId === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                            {t('delete') || 'Eliminar'}
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex gap-2 pt-3 mt-1 border-t border-stone-100 dark:border-stone-800">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={dense ? 1 : 2}
          placeholder={t('comment_placeholder') || 'Escribí un comentario...'}
          className="flex-1 px-3 py-2 bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-xl focus:ring-2 focus:ring-emerald-500 transition-all outline-none text-sm dark:text-white resize-none"
        />
        <button
          type="button"
          onClick={send}
          disabled={!body.trim() || sending}
          title={t('send') || 'Enviar'}
          className="px-3 self-end h-[38px] bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl flex items-center justify-center transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
