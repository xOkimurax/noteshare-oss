import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useMemos, useFolders, useDeleteMemo, useUpdateMemo, useFolderMutations } from '../hooks/data';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { 
  MoreVertical, 
  Trash2,
  Edit3, 
  MapPin, 
  Calendar, 
  Download,
  CheckCircle2,
  Circle,
  LayoutGrid,
  List,
  Grid,
  X,
  AlertTriangle,
  Loader2,
  Users,
  Share2,
  Folder as FolderIcon,
  FolderOpen,
  ArrowLeft,
  FolderPlus,
  FolderInput,
  Edit2,
  Check
} from 'lucide-react';
import { Memo, Folder } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { saveAs } from 'file-saver';
import ShareModal from './ShareModal';
import FolderModal from './FolderModal';
import ConnectionError from './ConnectionError';
import NoteViewModal from './NoteViewModal';
import { useBackable } from '../hooks/useBackable';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface NoteListProps {
  searchQuery: string;
  onEdit: (memo: Memo) => void;
  onSaveSuccess?: (msg: string) => void;
  currentFolderId?: string | null;
  onFolderChange?: (id: string | null) => void;
}

export default function NoteList({ searchQuery, onEdit, onSaveSuccess, currentFolderId, onFolderChange }: NoteListProps) {
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'compact'>('grid');
  const [viewingMemo, setViewingMemo] = useState<Memo | null>(null);
  const [selectedMemo, setSelectedMemo] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null); // For folder 3-dots
  const [sharingMemo, setSharingMemo] = useState<Memo | null>(null);
  const [memoToDelete, setMemoToDelete] = useState<string | null>(null);
  const [folderToDelete, setFolderToDelete] = useState<string | null>(null);
  const [isDeletingMemo, setIsDeletingMemo] = useState(false);
  const [isDeletingFolder, setIsDeletingFolder] = useState(false);

  const [shareFilter, setShareFilter] = useState<'all' | 'shared' | 'not_shared'>('all');
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);
  const [memoToMove, setMemoToMove] = useState<Memo | null>(null); // Move to folder modal

  const [selectedMemoIds, setSelectedMemoIds] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [draggedOverFolderId, setDraggedOverFolderId] = useState<string | null>(null);

  // Mobile/browser back button closes these instead of leaving the app.
  // (viewingMemo/sharingMemo/isFolderModalOpen are handled inside
  // NoteViewModal/ShareModal/FolderModal themselves.)
  useBackable(!!memoToMove, () => setMemoToMove(null));
  useBackable(!!memoToDelete, () => setMemoToDelete(null));
  useBackable(!!folderToDelete, () => setFolderToDelete(null));
  // Being inside a folder is itself a back-able "view", independent of
  // whether a note inside it is also open (that's viewingMemo, already
  // covered, and nests correctly on top of this one since it can only
  // open once already browsing some folder — root included).
  useBackable(!!currentFolderId, () => onFolderChange?.(null));
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);

  const toggleSelection = (id: string) => {
    setSelectedMemoIds(prev =>
      prev.includes(id) ? prev.filter(mid => mid !== id) : [...prev, id]
    );
  };

  // Auto-scroll the surrounding scroll container while dragging near its edges,
  // so you can drop onto folders that are off-screen.
  useEffect(() => {
    if (!isDragging) return;
    let scroller: HTMLElement | null = rootRef.current?.parentElement ?? null;
    while (scroller) {
      const oy = getComputedStyle(scroller).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && scroller.scrollHeight > scroller.clientHeight) break;
      scroller = scroller.parentElement;
    }
    if (!scroller) return;

    const EDGE = 90;
    let speed = 0;
    let raf = 0;
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      const r = scroller!.getBoundingClientRect();
      if (e.clientY < r.top + EDGE) speed = -Math.ceil((r.top + EDGE - e.clientY) / 6);
      else if (e.clientY > r.bottom - EDGE) speed = Math.ceil((e.clientY - (r.bottom - EDGE)) / 6);
      else speed = 0;
    };
    const tick = () => {
      if (speed !== 0) scroller!.scrollBy(0, speed);
      raf = requestAnimationFrame(tick);
    };
    document.addEventListener('dragover', onDragOver);
    raf = requestAnimationFrame(tick);
    return () => {
      document.removeEventListener('dragover', onDragOver);
      cancelAnimationFrame(raf);
    };
  }, [isDragging]);

  const handleBulkMove = async (folderId: string | null) => {
    const ids = selectedMemoIds;
    if (ids.length === 0) return;
    try {
      await Promise.all(ids.map(id => updateMemo.mutateAsync({ id, patch: { folderId } })));
      setSelectedMemoIds([]);
      setBulkMoveOpen(false);
      if (onSaveSuccess) onSaveSuccess(t('note_updated') || 'Updated');
    } catch (err) {
      console.error(err);
    }
  };

  const handleDragStart = (e: React.DragEvent, memo: Memo) => {
    setIsDragging(true);
    const idsToDrag = selectedMemoIds.includes(memo.id) ? selectedMemoIds : [memo.id];
    e.dataTransfer.setData('application/json', JSON.stringify(idsToDrag));
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    setDraggedOverFolderId(null);
  };

  const handleDropOnFolder = async (e: React.DragEvent, folderId: string | null) => {
    e.preventDefault();
    setDraggedOverFolderId(null);
    const data = e.dataTransfer.getData('application/json');
    if (!data) return;
    try {
      const ids: string[] = JSON.parse(data);
      if (ids.length > 0) {
        await Promise.all(ids.map(id => updateMemo.mutateAsync({ id, patch: { folderId } })));
        setSelectedMemoIds([]);
        if (onSaveSuccess) onSaveSuccess(t('note_updated') || 'Updated');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState('');

  const { memos: allMemos, loading, error, refetch, isFetching } = useMemos();
  const { folders } = useFolders();
  const deleteMemo = useDeleteMemo();
  const updateMemo = useUpdateMemo();
  const folderMutations = useFolderMutations();

  const currentFolder = currentFolderId ? folders.find(f => f.id === currentFolderId) : null;

  useEffect(() => {
    const handleClickOutside = () => {
      setSelectedMemo(null);
      setSelectedFolderId(null);
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const memos = allMemos;

  const filteredMemos = memos.filter(m => {
    const matchesSearch = 
      m.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()));

    if (!matchesSearch) return false;

    // Filter by folder logic
    if (searchQuery) {
      // If searching, show across all folders but you can keep it restricted if you prefer
      // We will restrict it to the current folder if currentFolderId is set
      if (currentFolderId && m.folderId !== currentFolderId) return false;
      if (!currentFolderId && m.folderId) return false; // In root, only root items. Or maybe in search we show all? The prompt said "if we are inside a folder we see the ones inside"
    } else {
      if (currentFolderId) {
        if (m.folderId !== currentFolderId) return false;
      } else {
        if (m.folderId) return false;
      }
    }

    const isShared = (m.shareCode != null && m.shareCode !== "") || (m.allowedEmails && m.allowedEmails.length > 0);
    if (shareFilter === 'shared') {
      return isShared;
    } else if (shareFilter === 'not_shared') {
      return !isShared;
    }
    return true;
  });

  const filteredFolders = folders.filter(f => {
    if (currentFolderId) return false; // Don't show nested folders
    if (searchQuery) {
      return f.name.toLowerCase().includes(searchQuery.toLowerCase());
    }
    return true;
  });

  const handleDeleteMemo = async (id: string) => {
    setIsDeletingMemo(true);
    try {
      await deleteMemo.mutateAsync(id);
      setMemoToDelete(null);
    } catch (err) {
      console.error(err);
      setMemoToDelete(null);
    } finally {
      setIsDeletingMemo(false);
    }
  };

  const handleDeleteFolder = async (id: string) => {
    setIsDeletingFolder(true);
    try {
      await folderMutations.remove.mutateAsync(id);
      setFolderToDelete(null);
    } catch (err) {
      console.error(err);
      setFolderToDelete(null);
    } finally {
      setIsDeletingFolder(false);
    }
  };

  const handleSaveFolderName = async (id: string) => {
    if (!editingFolderName.trim()) return;
    try {
      await folderMutations.rename.mutateAsync({ id, name: editingFolderName.trim() });
      setEditingFolderId(null);
    } catch (e) {
      console.error(e);
    }
  };

  const handleMoveToFolder = async (memo: Memo, newFolderId: string | null) => {
    try {
      await updateMemo.mutateAsync({ id: memo.id, patch: { folderId: newFolderId } });
      setMemoToMove(null);
      if (onSaveSuccess) onSaveSuccess(t('note_updated') || 'Updated');
    } catch (e) {
      console.error(e);
    }
  };

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

  if (loading) return <div className="text-center py-20 text-stone-400">{t('loading')}</div>;
  // Nothing to show + the load failed (usually the API restarting on deploy):
  // keep auto-retrying instead of a dead end.
  if (error && allMemos.length === 0)
    return <ConnectionError onRetry={() => void refetch()} isFetching={isFetching} />;

  const toggleViewMode = () => {
    if (viewMode === 'grid') setViewMode('list');
    else if (viewMode === 'list') setViewMode('compact');
    else setViewMode('grid');
  };

  const ViewIcon = viewMode === 'grid' ? LayoutGrid : viewMode === 'list' ? List : Grid;

  return (
    <div ref={rootRef} className="space-y-6 flex flex-col h-full">
      {error && allMemos.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200/60 dark:border-amber-800/40 rounded-xl px-3 py-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          {t('reconnecting') || 'Sin conexión con el servidor, reintentando…'}
        </div>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-stone-100 dark:border-stone-800 pb-4">
        
        {currentFolderId ? (
          <div className="flex items-center gap-3">
            <button 
              onClick={() => onFolderChange?.(null)}
              onDragOver={(e) => { e.preventDefault(); setDraggedOverFolderId('root'); }}
              onDragLeave={() => setDraggedOverFolderId(null)}
              onDrop={(e) => handleDropOnFolder(e, null)}
              className={cn("p-2 rounded-lg transition-colors text-stone-500", draggedOverFolderId === 'root' ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600" : "hover:bg-stone-100 dark:hover:bg-stone-800")}
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h2 className="text-xl font-bold dark:text-white flex items-center gap-2">
              <FolderOpen className="w-6 h-6 text-emerald-600" />
              {currentFolder?.name}
            </h2>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <select
              value={shareFilter}
              onChange={(e) => setShareFilter(e.target.value as 'all' | 'shared' | 'not_shared')}
              className="p-2 text-sm bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-lg shadow-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none text-stone-600 dark:text-stone-400 font-medium flex-1 sm:flex-none"
            >
              <option value="all">{t('filter_all')}</option>
              <option value="shared">{t('filter_shared')}</option>
              <option value="not_shared">{t('filter_not_shared')}</option>
            </select>
            
            <button
              onClick={() => setIsFolderModalOpen(true)}
              className="p-2 text-sm bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-lg shadow-sm hover:bg-stone-50 dark:hover:bg-stone-800 transition-all text-emerald-600 dark:text-emerald-500 font-medium flex flex-1 sm:flex-none items-center gap-2"
            >
              <FolderPlus className="w-4 h-4" />
              {t('new_folder') || 'Nueva carpeta'}
            </button>
          </div>
        )}

        <button
          onClick={toggleViewMode}
          className="p-2 self-end sm:self-auto bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-lg shadow-sm hover:bg-stone-50 dark:hover:bg-stone-800 transition-all text-stone-600 dark:text-stone-400 shrink-0"
          title={t('toggle_view')}
        >
          <ViewIcon className="w-5 h-5" />
        </button>
      </div>

      <div className={
        viewMode === 'list' 
          ? "flex flex-col gap-4" 
          : viewMode === 'compact'
            ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3"
            : "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
      }>
        <AnimatePresence>
          {filteredFolders.map((folder) => (
            <motion.div
              key={folder.id}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              onClick={() => !editingFolderId && onFolderChange?.(folder.id)}
              onDragOver={(e) => { e.preventDefault(); setDraggedOverFolderId(folder.id); }}
              onDragLeave={() => setDraggedOverFolderId(null)}
              onDrop={(e) => handleDropOnFolder(e, folder.id)}
              className={cn(
                "card relative group flex flex-col cursor-pointer transition-all hover:ring-2 hover:ring-emerald-500/50 bg-amber-50/50 dark:bg-amber-900/10 border-amber-100/50 dark:border-amber-900/20",
                draggedOverFolderId === folder.id && "ring-2 ring-emerald-500 bg-emerald-100/50 dark:bg-emerald-900/30",
                viewMode === 'list' ? "flex-row items-center gap-4 p-4 min-h-0" : 
                viewMode === 'compact' ? "p-3 min-h-0 aspect-square justify-center" : 
                "min-h-[140px] justify-center items-center text-center",
                selectedFolderId === folder.id && "z-[50]"
              )}
            >
              <div className={cn(viewMode === 'list' ? "flex-1 flex items-center justify-between" : "flex w-full items-center", viewMode === 'compact' ? "justify-center" : "justify-between", viewMode !== 'list' && viewMode !== 'compact' && "absolute top-4 px-4")}>
                
                {viewMode === 'list' ? (
                  <div className="flex items-center gap-3 overflow-hidden max-w-[80%] flex-1">
                    <FolderIcon className="w-5 h-5 text-amber-500 shrink-0" />
                    {editingFolderId === folder.id ? (
                      <div className="flex items-center gap-2 w-full" onClick={e => e.stopPropagation()}>
                        <input
                          value={editingFolderName}
                          onChange={e => setEditingFolderName(e.target.value)}
                          className="flex-1 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-lg px-2 py-1 outline-none text-sm dark:text-white"
                          autoFocus
                        />
                        <button onClick={() => handleSaveFolderName(folder.id)} className="text-emerald-600 p-1 bg-white dark:bg-stone-800 rounded-md"><Check className="w-4 h-4" /></button>
                        <button onClick={() => setEditingFolderId(null)} className="text-stone-400 p-1 bg-white dark:bg-stone-800 rounded-md"><X className="w-4 h-4" /></button>
                      </div>
                    ) : (
                      <h3 className="font-bold text-amber-900 dark:text-amber-100 text-lg line-clamp-1">{folder.name}</h3>
                    )}
                  </div>
                ) : (
                  <div />
                )}
                
                {viewMode !== 'compact' && (
                  <div className="relative ml-auto shrink-0">
                    <button 
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        setSelectedFolderId(selectedFolderId === folder.id ? null : folder.id);
                        setSelectedMemo(null);
                      }}
                      className="p-1 hover:bg-black/5 rounded-full transition-all"
                    >
                      <MoreVertical className="w-5 h-5 text-stone-500" />
                    </button>
                    
                    {selectedFolderId === folder.id && (
                        <div className="absolute right-0 top-8 w-40 bg-white dark:bg-stone-800 rounded-xl shadow-xl border border-stone-100 dark:border-stone-700 z-[60] py-2 overflow-hidden" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => { 
                            setEditingFolderId(folder.id); 
                            setEditingFolderName(folder.name); 
                            setSelectedFolderId(null); 
                          }} className="w-full flex items-center gap-3 px-4 py-2 hover:bg-stone-50 dark:hover:bg-stone-700 text-sm dark:text-stone-200">
                            <Edit2 className="w-4 h-4" /> {t('edit')}
                          </button>
                          <button onClick={() => { setFolderToDelete(folder.id); setSelectedFolderId(null); }} className="w-full flex items-center gap-3 px-4 py-2 hover:bg-red-50 text-red-600 text-sm">
                            <Trash2 className="w-4 h-4" /> {t('delete')}
                          </button>
                        </div>
                    )}
                  </div>
                )}
              </div>
              
              {viewMode !== 'list' && (
                <>
                  <FolderIcon className={cn("text-amber-500 mb-2", viewMode === 'compact' ? "w-6 h-6" : "w-12 h-12 mx-auto")} />
                  {editingFolderId === folder.id ? (
                    <div className="flex items-center gap-2 px-4 w-full" onClick={e => e.stopPropagation()}>
                      <input
                        value={editingFolderName}
                        onChange={e => setEditingFolderName(e.target.value)}
                        className="flex-1 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-lg px-2 py-1 outline-none text-sm dark:text-white"
                        autoFocus
                      />
                      <button onClick={() => handleSaveFolderName(folder.id)} className="text-emerald-600 p-1 bg-white dark:bg-stone-800 rounded-md"><Check className="w-4 h-4" /></button>
                      <button onClick={() => setEditingFolderId(null)} className="text-stone-400 p-1 bg-white dark:bg-stone-800 rounded-md"><X className="w-4 h-4" /></button>
                    </div>
                  ) : (
                    <h3 className={cn("font-bold text-amber-900 dark:text-amber-100", viewMode === 'compact' ? "text-xs line-clamp-2" : "text-lg line-clamp-1")}>{folder.name}</h3>
                  )}
                </>
              )}
            </motion.div>
          ))}

          {filteredMemos.map((memo) => (
            <motion.div
              key={memo.id}
              layout
              draggable
              onDragStart={(e) => handleDragStart(e as unknown as React.DragEvent, memo)}
              onDragEnd={() => handleDragEnd()}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              onClick={(e) => {
                if (e.shiftKey || selectedMemoIds.length > 0) {
                  e.preventDefault();
                  toggleSelection(memo.id);
                } else if (!selectedMemo) {
                  setViewingMemo(memo);
                }
              }}
              className={cn(
                "card relative group flex flex-col cursor-pointer transition-all hover:ring-2 hover:ring-emerald-500/50",
                selectedMemoIds.includes(memo.id) && "ring-2 ring-emerald-500 transform scale-[1.02]",
                viewMode === 'list' ? "flex-row items-center gap-4 p-4 min-h-0" : 
                viewMode === 'compact' ? "p-3 min-h-0 aspect-square justify-center" : 
                "min-h-[240px]",
                selectedMemo === memo.id && "z-[50]"
              )}
              style={{ backgroundColor: memo.color + '40' }}
            >
              {selectedMemoIds.includes(memo.id) && (
                <div className="absolute -top-2 -left-2 w-6 h-6 bg-emerald-500 text-white rounded-full flex items-center justify-center shadow-lg z-10">
                  <Check className="w-4 h-4" />
                </div>
              )}
              {viewMode === 'grid' && memo.imageUrls.length > 0 && (
                <div className="w-full h-32 mb-4 overflow-hidden rounded-xl shrink-0">
                  <img
                    src={memo.imageUrls[0]}
                    alt={memo.title}
                    className="w-full h-full object-cover transition-transform group-hover:scale-105 duration-500 default-img-handling" 
                    referrerPolicy="no-referrer"
                  />
                </div>
              )}
              
              <div className={cn(viewMode === 'list' ? "flex-1 flex items-center justify-between" : "flex justify-between items-start mb-2 px-1", viewMode === 'grid' && memo.imageUrls.length === 0 ? "mt-2" : "")}>
                <div className="flex items-center gap-2 overflow-hidden max-w-[80%]">
                  {memo.type === 'list' ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <Circle className="w-4 h-4 text-stone-400 shrink-0" />}
                  <h3 className={viewMode === 'compact' ? "font-bold text-xs line-clamp-2" : "font-bold text-lg line-clamp-1"}>{memo.title}</h3>
                  {((memo.shareCode != null && memo.shareCode !== "") || (memo.allowedEmails && memo.allowedEmails.length > 0)) && (
                    <span 
                      className="inline-flex items-center gap-1 text-[10px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider shrink-0"
                      title={t('shared') || 'Compartido'}
                    >
                      <Users className="w-3 h-3" />
                    </span>
                  )}
                </div>
                
                {viewMode !== 'compact' && (
                  <div className="relative flex items-center gap-0.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(memo);
                        setSelectedMemo(null);
                      }}
                      title={t('edit') || 'Editar'}
                      className="p-1 hover:bg-black/5 rounded-full transition-all"
                    >
                      <Edit3 className="w-[18px] h-[18px] text-stone-500" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedMemo(selectedMemo === memo.id ? null : memo.id);
                        setSelectedFolderId(null);
                      }}
                      className="p-1 hover:bg-black/5 rounded-full transition-all"
                    >
                      <MoreVertical className="w-5 h-5 text-stone-500" />
                    </button>
                    
                    {selectedMemo === memo.id && (
                        <div className="absolute right-0 top-8 w-48 bg-white dark:bg-stone-800 rounded-xl shadow-xl border border-stone-100 dark:border-stone-700 z-[60] py-2 overflow-hidden" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => { onEdit(memo); setSelectedMemo(null); }} className="w-full flex items-center gap-3 px-4 py-2 hover:bg-stone-50 dark:hover:bg-stone-700 text-sm dark:text-stone-200">
                            <Edit3 className="w-4 h-4" /> {t('edit')}
                          </button>
                          
                          <button onClick={() => { setMemoToMove(memo); setSelectedMemo(null); }} className="w-full flex items-center gap-3 px-4 py-2 hover:bg-stone-50 dark:hover:bg-stone-700 text-sm dark:text-stone-200">
                            <FolderInput className="w-4 h-4" /> {t('move_to_folder') || 'Mover a carpeta'}
                          </button>

                          <div className="h-px bg-stone-100 dark:bg-stone-700 my-1" />

                          <button onClick={() => { exportToPDF(memo); setSelectedMemo(null); }} className="w-full flex items-center gap-3 px-4 py-2 hover:bg-stone-50 dark:hover:bg-stone-700 text-sm dark:text-stone-200">
                            <Download className="w-4 h-4" /> {t('export')} PDF
                          </button>
                          <button onClick={() => { exportToExcel(memo); setSelectedMemo(null); }} className="w-full flex items-center gap-3 px-4 py-2 hover:bg-stone-50 dark:hover:bg-stone-700 text-sm dark:text-stone-200">
                            <Download className="w-4 h-4" /> {t('export')} Excel
                          </button>
                          <button onClick={() => { exportToDocx(memo); setSelectedMemo(null); }} className="w-full flex items-center gap-3 px-4 py-2 hover:bg-stone-50 dark:hover:bg-stone-700 text-sm dark:text-stone-200">
                            <Download className="w-4 h-4" /> {t('export')} Word
                          </button>

                          <div className="h-px bg-stone-100 dark:bg-stone-700 my-1" />

                          <button onClick={() => { setSharingMemo(memo); setSelectedMemo(null); }} className="w-full flex items-center gap-3 px-4 py-2 hover:bg-stone-50 dark:hover:bg-stone-700 text-sm dark:text-stone-200">
                            <Share2 className="w-4 h-4" /> {t('share') || 'Compartir'}
                          </button>
                          <button onClick={() => { setMemoToDelete(memo.id); setSelectedMemo(null); }} className="w-full flex items-center gap-3 px-4 py-2 hover:bg-red-50 text-red-600 text-sm">
                            <Trash2 className="w-4 h-4" /> {t('delete')}
                          </button>
                        </div>
                    )}
                  </div>
                )}
              </div>

              {viewMode !== 'compact' && (
                <p className={cn(
                  "text-stone-600 dark:text-stone-400 text-sm mb-4 px-1",
                  viewMode === 'list' && "flex-1 mb-0 line-clamp-1",
                  viewMode === 'grid' && "line-clamp-2"
                )}>
                  {memo.content}
                </p>
              )}
              
              {viewMode !== 'compact' && viewMode !== 'list' && (
                <div className="flex flex-wrap gap-1.5 mb-4 mt-auto px-1">
                  {memo.tags.map(tag => (
                    <span key={tag} className="px-2 py-0.5 bg-white/50 dark:bg-black/20 rounded-full text-[10px] font-bold uppercase tracking-wider text-stone-500">
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {viewMode === 'grid' && (memo.dueDate || memo.location) && (
                <div className="flex items-center gap-4 text-xs text-stone-500 dark:text-stone-400 border-t border-black/5 dark:border-white/5 pt-3 mt-auto mx-1">
                  {memo.dueDate && (
                    <span className="flex items-center gap-1 font-medium">
                      <Calendar className="w-3 h-3" />
                      {format(new Date(memo.dueDate), 'MMM d')}
                    </span>
                  )}
                  {memo.location && (
                    <span className="flex items-center gap-1 font-medium truncate">
                      <MapPin className="w-3 h-3 shrink-0" />
                      <span className="truncate">{memo.location.name}</span>
                    </span>
                  )}
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        {filteredMemos.length === 0 && filteredFolders.length === 0 && (
          <div className="col-span-full py-20 text-center">
            <div className="w-20 h-20 bg-stone-100 dark:bg-stone-800 rounded-3xl flex items-center justify-center mx-auto mb-6">
              <FolderOpen className="w-10 h-10 text-stone-400" />
            </div>
            <h3 className="text-xl font-bold dark:text-white mb-2">{t('no_notes')}</h3>
            <p className="text-stone-500 dark:text-stone-400 max-w-md mx-auto">
              {t('create_first')}
            </p>
          </div>
        )}
      </div>

      {/* Viewing Modal (shared component) */}
      <NoteViewModal
        memo={viewingMemo}
        onClose={() => setViewingMemo(null)}
        onEdit={(m) => { onEdit(m); setViewingMemo(null); }}
      />

      {/* Move to Folder Modal */}
      <AnimatePresence>
        {memoToMove && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white dark:bg-stone-900 w-full max-w-sm rounded-3xl shadow-2xl p-6"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold dark:text-white flex items-center gap-2">
                  <FolderInput className="w-6 h-6 text-emerald-600" />
                  {t('move_to_folder') || 'Mover a carpeta'}
                </h3>
                <button onClick={() => setMemoToMove(null)} className="p-2 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-full transition-all text-stone-400">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="space-y-2 max-h-[50vh] overflow-y-auto custom-scrollbar">
                <button
                  onClick={() => handleMoveToFolder(memoToMove, null)}
                  className={cn(
                    "w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left",
                    !memoToMove.folderId 
                      ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400"
                      : "bg-white dark:bg-stone-800 border-stone-200 dark:border-stone-700 hover:border-emerald-300 dark:text-stone-300"
                  )}
                >
                  <FolderIcon className="w-5 h-5" />
                  <span className="font-medium">{t('unfolderized') || 'Sin carpeta'}</span>
                  {!memoToMove.folderId && <Check className="w-4 h-4 ml-auto" />}
                </button>
                
                {folders.map(f => (
                  <button
                    key={f.id}
                    onClick={() => handleMoveToFolder(memoToMove, f.id)}
                    className={cn(
                      "w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left",
                      memoToMove.folderId === f.id
                        ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400"
                        : "bg-white dark:bg-stone-800 border-stone-200 dark:border-stone-700 hover:border-emerald-300 dark:text-stone-300"
                    )}
                  >
                    <FolderIcon className="w-5 h-5" />
                    <span className="font-medium">{f.name}</span>
                    {memoToMove.folderId === f.id && <Check className="w-4 h-4 ml-auto" />}
                  </button>
                ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Floating selection bar */}
      <AnimatePresence>
        {selectedMemoIds.length > 0 && !bulkMoveOpen && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            className="fixed bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 z-[80] flex items-center gap-2 bg-stone-900 dark:bg-stone-800 text-white rounded-2xl shadow-2xl pl-4 pr-2 py-2"
          >
            <span className="text-sm font-semibold whitespace-nowrap">
              {selectedMemoIds.length} {t('selected') || 'seleccionadas'}
            </span>
            <button
              onClick={() => setBulkMoveOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 rounded-xl text-sm font-medium transition-colors"
            >
              <FolderInput className="w-4 h-4" />
              {t('move_to_folder') || 'Mover a carpeta'}
            </button>
            <button
              onClick={() => setSelectedMemoIds([])}
              className="p-2 hover:bg-white/10 rounded-xl transition-colors"
              title={t('cancel')}
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bulk move to folder modal */}
      <AnimatePresence>
        {bulkMoveOpen && (
          <div className="fixed inset-0 z-[85] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white dark:bg-stone-900 w-full max-w-sm rounded-3xl shadow-2xl p-6"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold dark:text-white flex items-center gap-2">
                  <FolderInput className="w-6 h-6 text-emerald-600" />
                  {t('move_to_folder') || 'Mover a carpeta'}
                  <span className="text-sm font-medium text-stone-400">({selectedMemoIds.length})</span>
                </h3>
                <button onClick={() => setBulkMoveOpen(false)} className="p-2 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-full transition-all text-stone-400">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-2 max-h-[50vh] overflow-y-auto custom-scrollbar">
                <button
                  onClick={() => handleBulkMove(null)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left bg-white dark:bg-stone-800 border-stone-200 dark:border-stone-700 hover:border-emerald-300 dark:text-stone-300"
                >
                  <FolderIcon className="w-5 h-5" />
                  <span className="font-medium">{t('unfolderized') || 'Sin carpeta'}</span>
                </button>
                {folders.map(f => (
                  <button
                    key={f.id}
                    onClick={() => handleBulkMove(f.id)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left bg-white dark:bg-stone-800 border-stone-200 dark:border-stone-700 hover:border-emerald-300 dark:text-stone-300"
                  >
                    <FolderIcon className="w-5 h-5" />
                    <span className="font-medium">{f.name}</span>
                  </button>
                ))}
                {folders.length === 0 && (
                  <p className="text-sm text-stone-400 text-center py-4">{t('no_folders') || 'No hay carpetas'}</p>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal for Memos */}
      <AnimatePresence>
        {memoToDelete && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white dark:bg-stone-900 w-full max-w-sm rounded-3xl shadow-2xl p-6 text-center"
            >
              <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="w-8 h-8 text-red-600" />
              </div>
              <h3 className="text-xl font-bold dark:text-white mb-2">{t('confirm_delete')}</h3>
              <p className="text-stone-500 dark:text-stone-400 mb-6">{t('delete_warning')}</p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setMemoToDelete(null)}
                  className="flex-1 btn-secondary"
                >
                  {t('cancel')}
                </button>
                <button 
                  onClick={() => handleDeleteMemo(memoToDelete)}
                  disabled={isDeletingMemo}
                  className="flex-1 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors py-2 font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isDeletingMemo ? <Loader2 className="w-4 h-4 animate-spin" /> : t('delete')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal for Folders */}
      <AnimatePresence>
        {folderToDelete && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white dark:bg-stone-900 w-full max-w-sm rounded-3xl shadow-2xl p-6 text-center"
            >
              <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="w-8 h-8 text-red-600" />
              </div>
              <h3 className="text-xl font-bold dark:text-white mb-2">{t('confirm_delete_folder') || 'Confirm Delete Folder'}</h3>
              <p className="text-stone-500 dark:text-stone-400 mb-6">{t('delete_folder_warning') || 'Are you sure you want to delete this folder?'}</p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setFolderToDelete(null)}
                  className="flex-1 btn-secondary"
                >
                  {t('cancel')}
                </button>
                <button 
                  onClick={() => handleDeleteFolder(folderToDelete)}
                  disabled={isDeletingFolder}
                  className="flex-1 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors py-2 font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isDeletingFolder ? <Loader2 className="w-4 h-4 animate-spin" /> : t('delete')}
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
            isOpen={sharingMemo !== null}
            onClose={() => setSharingMemo(null)}
            onSaveSuccess={(msg) => onSaveSuccess?.(msg)}
          />
        )}
      </AnimatePresence>

      <FolderModal
        isOpen={isFolderModalOpen}
        onClose={() => setIsFolderModalOpen(false)}
      />
    </div>
  );
}
