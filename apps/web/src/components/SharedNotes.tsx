import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { useSharedNotes, useCommentUnreads } from '../hooks/data';
import ConnectionError from './ConnectionError';
import NoteViewModal from './NoteViewModal';
import { useBackable } from '../hooks/useBackable';
import { useQueryClient } from '@tanstack/react-query';
import { qk } from '../query';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { 
  MoreVertical, 
  Edit3, 
  MapPin, 
  Calendar, 
  Download,
  CheckCircle2,
  Circle,
  LayoutList,
  LayoutGrid,
  List,
  Grid,
  X,
  Plus,
  Key,
  LogOut,
  Mail,
  AlertCircle,
  User,
  Search,
  BookOpen,
  Users,
  Share2,
  MessageCircle
} from 'lucide-react';
import { Memo } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { saveAs } from 'file-saver';
import ShareModal from './ShareModal';
import { renderWithLinks } from '../utils';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface SharedNotesProps {
  searchQuery: string;
  onEdit: (memo: Memo) => void;
  onSaveSuccess: (msg: string) => void;
  /** When set, open this note's view modal (deep-link from the chat). */
  openMemoId?: string | null;
  onOpenedMemo?: () => void;
}

export default function SharedNotes({ searchQuery, onEdit, onSaveSuccess, openMemoId, onOpenedMemo }: SharedNotesProps) {
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'compact'>('grid');
  const [viewingMemo, setViewingMemo] = useState<Memo | null>(null);
  const [selectedMemo, setSelectedMemo] = useState<string | null>(null);
  const [sharingMemo, setSharingMemo] = useState<Memo | null>(null);
  
  // Join Modal state
  const [isJoinOpen, setIsJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);

  // Leave Confirm state
  const [memoToLeave, setMemoToLeave] = useState<Memo | null>(null);
  const [isLeaving, setIsLeaving] = useState(false);

  // Mobile/browser back button closes these instead of leaving the app.
  // (viewingMemo/sharingMemo are handled inside NoteViewModal/ShareModal.)
  useBackable(isJoinOpen, () => setIsJoinOpen(false));
  useBackable(!!memoToLeave, () => setMemoToLeave(null));

  const { user } = useAuth();
  const qc = useQueryClient();
  const { memos: sharedMemos, loading, error, refetch, isFetching } = useSharedNotes();
  const commentUnreads = useCommentUnreads();

  React.useEffect(() => {
    const handleClickOutside = () => setSelectedMemo(null);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // Deep-link from the chat: open the shared note once it shows up in the list
  // (it may still be arriving via the `shared.changed` refresh).
  React.useEffect(() => {
    if (!openMemoId) return;
    const found = sharedMemos.find((m) => m.id === openMemoId);
    if (found) {
      setViewingMemo(found);
      onOpenedMemo?.();
    }
  }, [openMemoId, sharedMemos, onOpenedMemo]);

  const refreshShared = () => qc.invalidateQueries({ queryKey: qk.shared });

  const filteredMemos = sharedMemos.filter(m => 
    m.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()))
  ).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const exportToExcel = (memo: Memo) => {
    const ws = XLSX.utils.json_to_sheet([{
      Title: memo.title,
      Content: memo.content,
      Type: memo.type,
      Status: memo.kanbanStatus,
      Tags: memo.tags.join(', '),
      DueDate: memo.dueDate,
      Location: memo.location?.name
    }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Memo");
    XLSX.writeFile(wb, `${memo.title}.xlsx`);
  };

  const exportToPDF = (memo: Memo) => {
    const docObj = new jsPDF();
    docObj.setFontSize(20);
    docObj.text(memo.title, 10, 20);
    docObj.setFontSize(12);
    docObj.text(`Type: ${memo.type} | Status: ${memo.kanbanStatus}`, 10, 30);
    docObj.text(`Created: ${format(new Date(memo.createdAt), 'PPP')}`, 10, 40);
    docObj.line(10, 45, 200, 45);
    const splitContent = docObj.splitTextToSize(memo.content, 180);
    docObj.text(splitContent, 10, 55);
    docObj.save(`${memo.title}.pdf`);
  };

  const exportToDocx = async (memo: Memo) => {
    const docObj = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({
            children: [
              new TextRun({ text: memo.title, bold: true, size: 32 }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: `Type: ${memo.type} | Status: ${memo.kanbanStatus}`, italics: true }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: memo.content }),
            ],
          }),
        ],
      }],
    });

    const blob = await Packer.toBlob(docObj);
    saveAs(blob, `${memo.title}.docx`);
  };

  const handleJoinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = joinCode.trim();
    if (!cleanCode) {
      setJoinError(t('code_empty'));
      return;
    }

    if (cleanCode.includes(' ')) {
      setJoinError(t('code_no_spaces'));
      return;
    }

    setIsJoining(true);
    setJoinError(null);

    try {
      await api.joinByCode(cleanCode);
      refreshShared();
      onSaveSuccess(t('join_success') || '¡Te has unido a la nota compartida con éxito!');
      setIsJoinOpen(false);
      setJoinCode('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setJoinError(t('invalid_share_code') || 'Código único no válido o nota inexistente.');
      } else if (err instanceof ApiError && err.status === 409) {
        setJoinError(t('already_have_access') || 'Ya tienes acceso a esta nota.');
      } else if (err instanceof ApiError && err.status === 403) {
        setJoinError(t('not_allowed_to_join') || 'No tienes permiso para unirte a esta nota compartida.');
      } else {
        console.error('Error joining shared note:', err);
        setJoinError(t('error_saving'));
      }
    } finally {
      setIsJoining(false);
    }
  };

  const handleLeaveConfirm = async () => {
    if (!memoToLeave) return;
    setIsLeaving(true);
    try {
      await api.leaveMemo(memoToLeave.id);
      refreshShared();
      onSaveSuccess(t('leave_success'));
      setMemoToLeave(null);
    } catch (err) {
      console.error('Error leaving memo:', err);
    } finally {
      setIsLeaving(false);
    }
  };

  if (loading) return <div className="text-center py-20 text-stone-400">{t('loading')}</div>;
  if (error && sharedMemos.length === 0)
    return <ConnectionError onRetry={() => void refetch()} isFetching={isFetching} />;

  const toggleViewMode = () => {
    if (viewMode === 'grid') setViewMode('list');
    else if (viewMode === 'list') setViewMode('compact');
    else setViewMode('grid');
  };

  const ViewIcon = viewMode === 'grid' ? LayoutGrid : viewMode === 'list' ? List : Grid;

  return (
    <div className="space-y-6 flex flex-col h-full">
      {/* Top action bar */}
      <div className="flex justify-between items-center bg-white dark:bg-stone-900/40 p-4 rounded-2xl border border-stone-200/50 dark:border-stone-800/50">
        <h2 className="text-lg font-bold dark:text-white flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-emerald-600" />
          {t('shared_notes')}
        </h2>

        <div className="flex items-center gap-2">
          <button
            onClick={toggleViewMode}
            className="p-2.5 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl shadow-sm hover:bg-stone-50 dark:hover:bg-stone-800 transition-all text-stone-600 dark:text-stone-400"
            title={t('toggle_view')}
          >
            <ViewIcon className="w-5 h-5" />
          </button>
          <button
            onClick={() => { setIsJoinOpen(true); setJoinError(null); }}
            className="btn-primary flex items-center justify-center gap-2 px-3 sm:px-4 py-2.5 rounded-xl shadow-lg shadow-emerald-600/10"
          >
            <Plus className="w-5 h-5" />
            <span className="hidden sm:inline">{t('join_note')}</span>
          </button>
        </div>
      </div>

      <div className={
        viewMode === 'list' 
          ? "flex flex-col gap-4" 
          : viewMode === 'compact'
            ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3"
            : "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
      }>
        <AnimatePresence>
          {filteredMemos.map((memo) => {
            const isOwnedByMe = memo.ownerId === user?.id;
            return (
              <motion.div
                key={memo.id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                onClick={() => !selectedMemo && setViewingMemo(memo)}
                className={cn(
                  "card relative group flex flex-col cursor-pointer transition-all hover:ring-2 hover:ring-emerald-500/50",
                  viewMode === 'list' ? "flex-row items-center gap-4 p-4 min-h-0" : 
                  viewMode === 'compact' ? "p-3 min-h-0 aspect-square justify-center" : 
                  "min-h-[200px]"
                )}
                style={{ backgroundColor: memo.color + '40' }}
              >
                <div className={viewMode === 'list' ? "flex-1 flex items-center justify-between" : "flex justify-between items-start mb-4"}>
                  <div className="flex items-center gap-2 overflow-hidden max-w-[80%]">
                    {memo.type === 'list' ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <Circle className="w-4 h-4 text-stone-400 shrink-0" />}
                    <h3 className={viewMode === 'compact' ? "font-bold text-xs line-clamp-2" : "font-bold text-lg line-clamp-1 dark:text-white"}>{memo.title}</h3>
                    {(commentUnreads.get(memo.id) ?? 0) > 0 && (
                      <span
                        className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-bold"
                        title={t('comments') || 'Comentarios'}
                      >
                        <MessageCircle className="w-3 h-3" />
                        {commentUnreads.get(memo.id)}
                      </span>
                    )}
                  </div>
                  
                  {viewMode !== 'compact' && (
                    <div className="relative flex items-center gap-0.5">
                      <button
                        onClick={(e) => { e.stopPropagation(); onEdit(memo); setSelectedMemo(null); }}
                        title={t('edit') || 'Editar'}
                        className="p-1 hover:bg-black/5 rounded-full transition-all"
                      >
                        <Edit3 className="w-[18px] h-[18px] text-stone-500" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedMemo(selectedMemo === memo.id ? null : memo.id); }}
                        className="p-1 hover:bg-black/5 rounded-full transition-all"
                      >
                        <MoreVertical className="w-5 h-5 text-stone-500" />
                      </button>
                      
                      {selectedMemo === memo.id && (
                          <div className="absolute right-0 top-8 w-48 bg-white dark:bg-stone-800 rounded-xl shadow-xl border border-stone-100 dark:border-stone-700 z-[60] py-2 overflow-hidden" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => { onEdit(memo); setSelectedMemo(null); }} className="w-full flex items-center gap-3 px-4 py-2 hover:bg-stone-50 dark:hover:bg-stone-700 text-sm dark:text-stone-200">
                              <Edit3 className="w-4 h-4" /> {t('edit')}
                            </button>
                            <button onClick={() => { exportToPDF(memo); setSelectedMemo(null); }} className="w-full flex items-center gap-3 px-4 py-2 hover:bg-stone-50 dark:hover:bg-stone-700 text-sm dark:text-stone-200">
                              <Download className="w-4 h-4" /> {t('export')} PDF
                            </button>
                            <button onClick={() => { exportToExcel(memo); setSelectedMemo(null); }} className="w-full flex items-center gap-3 px-4 py-2 hover:bg-stone-50 dark:hover:bg-stone-700 text-sm dark:text-stone-200">
                              <Download className="w-4 h-4" /> {t('export')} Excel
                            </button>
                            <button onClick={() => { exportToDocx(memo); setSelectedMemo(null); }} className="w-full flex items-center gap-3 px-4 py-2 hover:bg-stone-50 dark:hover:bg-stone-700 text-sm dark:text-stone-200">
                              <Download className="w-4 h-4" /> {t('export')} Word
                            </button>
                            <div className="border-t border-stone-100 dark:border-stone-700 my-1"></div>
                            {isOwnedByMe ? (
                              <button onClick={() => { setSharingMemo(memo); setSelectedMemo(null); }} className="w-full flex items-center gap-3 px-4 py-2 hover:bg-stone-50 dark:hover:bg-stone-700 text-sm dark:text-stone-200">
                                <Share2 className="w-4 h-4" /> {t('share') || 'Compartir'}
                              </button>
                            ) : (
                              <button onClick={() => { setMemoToLeave(memo); setSelectedMemo(null); }} className="w-full flex items-center gap-3 px-4 py-2 hover:bg-red-50 text-red-600 text-sm">
                                <LogOut className="w-4 h-4" /> {t('leave_note')}
                              </button>
                            )}
                          </div>
                      )}
                    </div>
                  )}
                </div>

                {viewMode === 'grid' && (
                  <>
                    {memo.imageUrls.length > 0 && (
                      <div className="mb-3 h-32 w-full rounded-xl overflow-hidden shrink-0">
                        <img src={memo.imageUrls[0]} alt={memo.title} className="w-full h-full object-cover default-img-handling" referrerPolicy="no-referrer" />
                      </div>
                    )}
                    <p className="text-stone-600 dark:text-stone-400 text-sm line-clamp-4 flex-1 mb-4">
                      {renderWithLinks(memo.content)}
                    </p>

                    <div className="flex flex-wrap gap-1 mb-4">
                      <span className={cn(
                        "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
                        isOwnedByMe 
                          ? "bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300"
                          : "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-300"
                      )}>
                        {isOwnedByMe ? t('shared_by_me') : t('shared_with_me')}
                      </span>
                      {memo.tags.map(tag => (
                        <span key={tag} className="px-2 py-0.5 bg-black/5 dark:bg-white/10 rounded-full text-[10px] font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">
                          #{tag}
                        </span>
                      ))}
                    </div>

                    {isOwnedByMe && (
                      <div className="mb-4 -mt-1">
                        <p className="text-[10px] text-stone-400 font-bold uppercase tracking-widest flex items-center gap-1 mb-1.5">
                          <Users className="w-3 h-3" /> {t('shared_with_people')}
                        </p>
                        {memo.allowedEmails.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {memo.allowedEmails.map(email => (
                              <span key={email} className="max-w-full truncate px-2 py-0.5 bg-emerald-100/70 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 rounded-full text-[11px] font-medium flex items-center gap-1">
                                <Mail className="w-3 h-3 shrink-0" />
                                <span className="truncate">{email}</span>
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[11px] text-stone-400 dark:text-stone-500 italic">{t('shared_with_nobody')}</p>
                        )}
                      </div>
                    )}

                    <div className="flex items-center justify-between text-[10px] text-stone-400 font-bold uppercase tracking-widest border-t border-black/5 dark:border-white/5 pt-3">
                      <div className="flex items-center gap-3">
                        {memo.dueDate && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" /> {format(new Date(memo.dueDate), 'MMM d')}
                          </span>
                        )}
                        {memo.location && (
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3 h-3" /> {memo.location.name}
                          </span>
                        )}
                      </div>
                    </div>
                  </>
                )}

                {viewMode === 'list' && (
                  <div className="hidden sm:flex items-center gap-4 text-xs text-stone-400 font-bold uppercase tracking-widest ml-auto">
                    {memo.dueDate && (
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" /> {format(new Date(memo.dueDate), 'MMM d')}
                      </span>
                    )}
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
      
      {filteredMemos.length === 0 && (
        <div className="text-center py-20 flex-1 flex flex-col items-center justify-center">
          <div className="w-20 h-20 bg-stone-100 dark:bg-stone-900 rounded-full flex items-center justify-center mb-4">
            <BookOpen className="w-10 h-10 text-stone-300 dark:text-stone-700" />
          </div>
          <h3 className="text-xl font-bold text-stone-600 dark:text-stone-300">{t('no_shared_notes')}</h3>
          <p className="text-stone-400 dark:text-stone-500 max-w-sm mt-1">{t('add_first_shared')}</p>
        </div>
      )}

      {/* View Modal (shared component) */}
      <NoteViewModal
        memo={viewingMemo}
        onClose={() => setViewingMemo(null)}
        onEdit={(m) => { onEdit(m); setViewingMemo(null); }}
      />

      {/* Join Modal */}
      <AnimatePresence>
        {isJoinOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-stone-900 w-full max-w-sm rounded-3xl shadow-2xl p-6 space-y-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-stone-100 dark:border-stone-800 pb-3">
                <div className="flex items-center gap-2">
                  <Key className="w-5 h-5 text-emerald-600" />
                  <h3 className="text-lg font-bold dark:text-white">{t('add_shared_note')}</h3>
                </div>
                <button onClick={() => setIsJoinOpen(false)} className="p-1 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-full transition-all">
                  <X className="w-5 h-5 text-stone-500" />
                </button>
              </div>

              {joinError && (
                <div className="bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 p-3 rounded-xl flex items-center gap-2 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{joinError}</span>
                </div>
              )}

              <form onSubmit={handleJoinSubmit} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-semibold dark:text-stone-300">
                    {t('enter_share_code')}
                  </label>
                  <input
                    type="text"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.replace(/\s+/g, ''))}
                    placeholder={t('share_code_placeholder')}
                    className="w-full px-4 py-2.5 bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-xl focus:ring-2 focus:ring-emerald-500 transition-all outline-none text-sm dark:text-white"
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsJoinOpen(false)}
                    className="flex-1 py-2.5 bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 font-bold rounded-xl transition-all text-sm"
                  >
                    {t('cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={isJoining}
                    className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-emerald-600/10 text-sm disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isJoining ? (
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                        className="w-4 h-4 border-2 border-white border-t-transparent rounded-full"
                      />
                    ) : t('join_note')}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Leave Confirm Modal */}
      <AnimatePresence>
        {memoToLeave && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-stone-900 w-full max-w-sm rounded-3xl shadow-2xl p-6 space-y-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-2xl flex items-center justify-center mx-auto text-red-600">
                <LogOut className="w-6 h-6" />
              </div>
              <div className="text-center space-y-2">
                <h3 className="text-lg font-bold dark:text-white">{t('leave_note')}</h3>
                <p className="text-stone-500 dark:text-stone-400 text-sm">
                  {t('leave_confirm_msg')}
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setMemoToLeave(null)}
                  className="flex-1 py-2.5 bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 font-bold rounded-xl transition-all text-sm"
                >
                  {t('cancel')}
                </button>
                <button
                  onClick={handleLeaveConfirm}
                  disabled={isLeaving}
                  className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-red-600/10 text-sm disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isLeaving ? (
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      className="w-4 h-4 border-2 border-white border-t-transparent rounded-full"
                    />
                  ) : t('leave_note')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {sharingMemo && (
          <ShareModal
            memo={sharingMemo}
            isOpen={!!sharingMemo}
            onClose={() => setSharingMemo(null)}
            onSaveSuccess={onSaveSuccess}
          />
        )}
      </AnimatePresence>

    </div>
  );
}
