import { useState, useRef, useEffect, useMemo, ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { X, MapPin, Tag, Palette, Calendar, CheckSquare, FileText, AlertCircle, Loader2, Image as ImageIcon, Trash2, Camera, Check, Maximize2 } from 'lucide-react';
import { Memo, MemoType } from '../types';
import type { MemoImage } from '@noteshare/shared';
import { motion, AnimatePresence } from 'motion/react';
import CameraModal from './CameraModal';
import NoteComments, { noteIsShared } from './NoteComments';
import ImageLightbox from './ImageLightbox';
import { api, assetUrl } from '../api';
import { useFolders, useCreateMemo, useUpdateMemo } from '../hooks/data';
import { useAutoSave } from '../hooks/useAutoSave';
import { describeUploadFailure } from '../lib/uploadDiagnostics';
import { useBackable } from '../hooks/useBackable';

const AUTOSAVE_DELAY = 1200;

interface MemoEditorProps {
  memo?: Memo;
  onClose: () => void;
  onSaveSuccess?: (message: string) => void;
  initialFolderId?: string | null;
  /** Called after every successful save with the persisted id. */
  onSaved?: (memoId: string, wasNew: boolean) => void;
}

const COLORS = [
  '#ffffff', '#fecaca', '#fed7aa', '#fef08a', '#dcfce7', '#d1fae5', '#e0f2fe', '#e0e7ff', '#f5f3ff', '#fae8ff'
];

export default function MemoEditor({ memo, onClose, onSaveSuccess, initialFolderId, onSaved }: MemoEditorProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(memo?.title || '');
  const [content, setContent] = useState(memo?.content || '');
  const [type, setType] = useState<MemoType>(memo?.type || 'note');
  const [color, setColor] = useState(memo?.color || '#ffffff');
  const [tags, setTags] = useState<string[]>(memo?.tags || []);
  const [newTag, setNewTag] = useState('');
  const [dueDate, setDueDate] = useState(memo?.dueDate || '');
  const [folderId, setFolderId] = useState(memo?.folderId || initialFolderId || '');
  
  const { folders } = useFolders();
  const createMemo = useCreateMemo();
  const updateMemo = useUpdateMemo();

  const [locationName, setLocationName] = useState(memo?.location?.name || '');
  const [lat, setLat] = useState(memo?.location?.lat || 0);
  const [lng, setLng] = useState(memo?.location?.lng || 0);
  const [existingImages, setExistingImages] = useState<MemoImage[]>(memo?.images ?? []);
  const [removedImageIds, setRemovedImageIds] = useState<string[]>([]);
  const [newImageFiles, setNewImageFiles] = useState<{file: File, preview: string}[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [fullScreenIndex, setFullScreenIndex] = useState<number | null>(null);
  // Always mounted only while actually shown (App.tsx renders it
  // conditionally) — its own unmount IS the close.
  useBackable(true, onClose);
  // Existing (saved) images first, then not-yet-uploaded ones — matches the
  // grid's visual order, so a thumbnail's index into this array is stable.
  const galleryImages = useMemo(
    () => [...existingImages.map((i) => assetUrl(i.url)), ...newImageFiles.map((f) => f.preview)],
    [existingImages, newImageFiles],
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  // Synchronous guard: `disabled={isSaving}` only takes effect after a
  // re-render, so a fast double-tap on Save would otherwise upload twice.
  const savingRef = useRef(false);

  const [autoSave] = useAutoSave();
  // Id of the persisted memo — starts as the edited memo's id, gets set once
  // a brand-new note is first saved (so autosave updates rather than dupes).
  const [currentId, setCurrentId] = useState<string | undefined>(memo?.id);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  const fieldSignature = () =>
    JSON.stringify({ title, content, type, color, tags, dueDate, folderId, locationName, lat, lng });
  // Baseline the note's fields are compared against; refreshed after each save.
  const savedSigRef = useRef(fieldSignature());
  const dirty =
    fieldSignature() !== savedSigRef.current ||
    newImageFiles.length > 0 ||
    removedImageIds.length > 0;

  const fileKey = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;

  const addFiles = (files: File[]) => {
    setNewImageFiles(prev => {
      const seen = new Set(prev.map(p => fileKey(p.file)));
      const fresh = files
        .filter(f => !seen.has(fileKey(f)))
        .map(file => ({ file, preview: URL.createObjectURL(file) }));
      return prev.concat(fresh);
    });
  };

  // Paste (Ctrl+V a screenshot / copied image) or drag-and-drop straight into
  // the editor — no need to open the file picker.
  const handlePaste = (e: React.ClipboardEvent) => {
    const imgs = Array.from(e.clipboardData?.items ?? [])
      .filter(it => it.kind === 'file' && it.type.startsWith('image/'))
      .map(it => it.getAsFile())
      .filter((f): f is File => !!f);
    if (imgs.length) {
      e.preventDefault();
      addFiles(imgs);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    const imgs = Array.from(e.dataTransfer?.files ?? []).filter(f =>
      f.type.startsWith('image/'),
    );
    if (imgs.length) {
      e.preventDefault();
      addFiles(imgs);
    }
  };

  // Drag-over feedback for the whole modal card (not just the text area) —
  // a counter because dragenter/dragleave fire on every child crossed.
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  const onModalDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    dragDepth.current++;
    setDragActive(true);
  };
  const onModalDragLeave = (e: React.DragEvent) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  };
  const onModalDrop = (e: React.DragEvent) => {
    dragDepth.current = 0;
    setDragActive(false);
    handleDrop(e);
  };

  const handleImageChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(Array.from(e.target.files) as File[]);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  const handleCameraCapture = (file: File) => addFiles([file]);

  const removeExistingImage = (index: number) => {
    setExistingImages(prev => {
      const img = prev[index];
      if (img) setRemovedImageIds(ids => [...ids, img.id]);
      return prev.filter((_, i) => i !== index);
    });
  };

  const removeNewImage = (index: number) => {
    setNewImageFiles(prev => prev.filter((_, i) => i !== index));
  };

  /**
   * Persists the current state.
   *  - `close`: close the editor afterwards
   *  - `toast`: fire the success toast
   * Returns true on success. Never throws.
   */
  const persist = async ({ close, toast }: { close: boolean; toast: boolean }): Promise<boolean> => {
    if (savingRef.current) return false;
    if (!title.trim()) return false;

    savingRef.current = true;
    setIsSaving(true);
    setSaveStatus('saving');
    setError(null);

    const wasNew = !currentId;
    try {
      const payload = {
        title,
        content,
        type,
        folderId: folderId || null,
        color,
        tags,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        location: locationName ? { lat, lng, name: locationName } : null,
      };

      const saved = currentId
        ? await updateMemo.mutateAsync({ id: currentId, patch: payload })
        : await createMemo.mutateAsync(payload);
      setCurrentId(saved.id);

      for (const id of removedImageIds) {
        await api.deleteImage(saved.id, id).catch((e) => console.error(e));
      }
      let finalMemo = saved;
      if (newImageFiles.length) {
        try {
          finalMemo = await api.uploadImages(saved.id, newImageFiles.map((n) => n.file));
        } catch (uploadErr) {
          console.error('Error uploading images:', uploadErr);
          setError(await describeUploadFailure(uploadErr));
          setSaveStatus('idle');
          return false;
        }
      }

      // Re-sync local state to the server so `dirty` goes false and autosave
      // never re-uploads.
      newImageFiles.forEach((n) => URL.revokeObjectURL(n.preview));
      setNewImageFiles([]);
      setRemovedImageIds([]);
      setExistingImages(finalMemo.images);
      savedSigRef.current = fieldSignature();
      setSaveStatus('saved');
      onSaved?.(finalMemo.id, wasNew);

      if (toast && onSaveSuccess) {
        onSaveSuccess(wasNew ? t('note_created') : t('note_updated'));
      }
      if (close) onClose();
      return true;
    } catch (err) {
      console.error('Error saving memo:', err);
      setError(t('error_saving'));
      setSaveStatus('idle');
      return false;
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  // Debounced auto-save: re-armed on every edit; the `dirty` gate stops it from
  // firing after `persist` resets the state.
  useEffect(() => {
    if (!autoSave || !dirty || !title.trim()) return;
    const h = setTimeout(() => {
      void persist({ close: false, toast: false });
    }, AUTOSAVE_DELAY);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSave, dirty, title, content, type, color, tags, dueDate, folderId, locationName, lat, lng, newImageFiles, removedImageIds]);

  const handleSave = async () => {
    if (!title.trim()) {
      setError(t('error_no_title'));
      return;
    }
    await persist({ close: true, toast: true });
  };

  // X / secondary button. With auto-save on, flush a final save before leaving.
  const handleClose = () => {
    if (autoSave && dirty && title.trim() && !savingRef.current) {
      void persist({ close: true, toast: false });
    } else {
      onClose();
    }
  };

  const addTag = () => {
    if (newTag && !tags.includes(newTag)) {
      setTags([...tags, newTag]);
      setNewTag('');
    }
  };

  const removeTag = (tag: string) => {
    setTags(tags.filter(t => t !== tag));
  };

  const getCurrentLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((position) => {
        setLat(position.coords.latitude);
        setLng(position.coords.longitude);
        setLocationName(`Point (${position.coords.latitude.toFixed(4)}, ${position.coords.longitude.toFixed(4)})`);
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm">
      <CameraModal
        isOpen={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        onCapture={handleCameraCapture}
      />
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="relative bg-white dark:bg-stone-900 w-full h-[100dvh] max-h-[100dvh] rounded-none sm:h-auto sm:max-h-[92vh] sm:rounded-3xl sm:max-w-2xl md:max-w-[min(96vw,1600px)] md:h-[94vh] md:max-h-[94vh] shadow-2xl overflow-hidden flex flex-col"
        style={{ backgroundColor: document.documentElement.classList.contains('dark') ? undefined : color }}
        onDragEnter={onModalDragEnter}
        onDragLeave={onModalDragLeave}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onModalDrop}
      >
        {dragActive && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-emerald-600/10 dark:bg-emerald-500/10 border-4 border-dashed border-emerald-500 pointer-events-none">
            <div className="bg-white dark:bg-stone-900 px-5 py-3 rounded-2xl shadow-xl flex items-center gap-2.5 text-emerald-700 dark:text-emerald-400 font-semibold text-sm">
              <ImageIcon className="w-5 h-5" />
              {t('drop_image_here') || 'Soltá la imagen acá'}
            </div>
          </div>
        )}
        <div className="p-6 border-b border-black/5 dark:border-white/5 flex justify-between items-center bg-white/40 dark:bg-black/20 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setType('note')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all font-bold text-xs uppercase tracking-wider ${type === 'note' ? 'bg-black dark:bg-emerald-600 text-white' : 'text-stone-500 dark:text-stone-400 hover:bg-black/5 dark:hover:bg-white/5'}`}
            >
              <FileText className="w-4 h-4" />
              {t('note')}
            </button>
            <button 
              onClick={() => setType('list')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all font-bold text-xs uppercase tracking-wider ${type === 'list' ? 'bg-black dark:bg-emerald-600 text-white' : 'text-stone-500 dark:text-stone-400 hover:bg-black/5 dark:hover:bg-white/5'}`}
            >
              <CheckSquare className="w-4 h-4" />
              {t('list')}
            </button>
          </div>
          <div className="flex items-center gap-3">
            {autoSave && (
              <span className="flex items-center gap-1.5 text-xs font-medium text-stone-400 dark:text-stone-500">
                {saveStatus === 'saving' ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    {t('saving')}
                  </>
                ) : saveStatus === 'saved' && !dirty ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                    {t('saved') || 'Guardado'}
                  </>
                ) : null}
              </span>
            )}
            <button onClick={handleClose} className="p-2 text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg">
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        <div
          className="flex-1 min-h-0 overflow-y-auto p-6 sm:p-8 space-y-6"
          onPaste={handlePaste}
        >
          <AnimatePresence>
            {error && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4 rounded-2xl flex items-center gap-3 text-red-600 dark:text-red-400 text-sm"
              >
                <AlertCircle className="w-5 h-5 shrink-0" />
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          <input 
            type="text" 
            placeholder={t('title')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full text-3xl font-bold bg-transparent border-none outline-none placeholder:text-stone-300 dark:placeholder:text-stone-700 dark:text-white"
          />

          <textarea 
            placeholder={t('content_placeholder')}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full h-64 md:h-80 min-h-[10rem] bg-transparent border-none outline-none resize-y placeholder:text-stone-300 dark:placeholder:text-stone-700 text-lg dark:text-stone-200"
          />

          <div className="space-y-4">
            {(existingImages.length > 0 || newImageFiles.length > 0) && (
              <div className="flex flex-wrap gap-4">
                {existingImages.map((img, index) => (
                  <div
                    key={img.id}
                    className="relative inline-block group rounded-2xl overflow-hidden border border-black/5 dark:border-white/5 cursor-zoom-in"
                    onClick={() => setFullScreenIndex(index)}
                  >
                    <img src={assetUrl(img.url)} alt={`Attachment ${index + 1}`} className="h-32 w-auto object-cover default-img-handling" />
                    <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                      <Maximize2 className="w-5 h-5 text-white" />
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeExistingImage(index); }}
                      className="absolute top-2 right-2 p-1.5 bg-red-500/80 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                {newImageFiles.map((img, index) => (
                  <div
                    key={`new-${index}`}
                    className="relative inline-block group rounded-2xl overflow-hidden border border-black/5 dark:border-white/5 cursor-zoom-in"
                    onClick={() => setFullScreenIndex(existingImages.length + index)}
                  >
                    <img src={img.preview} alt={`New attachment ${index + 1}`} className="h-32 w-auto object-cover default-img-handling" referrerPolicy="no-referrer" />
                    <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                      <Maximize2 className="w-5 h-5 text-white" />
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeNewImage(index); }}
                      className="absolute top-2 right-2 p-1.5 bg-red-500/80 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-3">
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-3 bg-black/5 dark:bg-white/5 text-stone-600 dark:text-stone-300 font-medium rounded-xl hover:bg-black/10 dark:hover:bg-white/10 transition-colors w-fit text-sm"
              >
                <ImageIcon className="w-5 h-5 opacity-70" />
                {t('add_image') || 'Add Image'}
              </button>
              <button 
                onClick={() => setIsCameraOpen(true)}
                className="flex items-center gap-2 px-4 py-3 bg-black/5 dark:bg-white/5 text-stone-600 dark:text-stone-300 font-medium rounded-xl hover:bg-black/10 dark:hover:bg-white/10 transition-colors w-fit text-sm"
              >
                <Camera className="w-5 h-5 opacity-70" />
                {t('camera') || 'Cámara'}
              </button>
            </div>
            <input 
              type="file" 
              accept="image/*" 
              multiple
              ref={fileInputRef}
              onChange={handleImageChange}
              className="hidden" 
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">
              {t('folder') || 'Carpeta'}
            </label>
            <select
              value={folderId}
              onChange={(e) => setFolderId(e.target.value)}
              className="w-full bg-white/60 dark:bg-stone-800/60 border-none rounded-xl p-3 outline-none dark:text-white"
            >
              <option value="">{t('unfolderized') || 'Sin carpeta'}</option>
              {folders.map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {type === 'list' && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">
                  <Calendar className="w-4 h-4" /> {t('due_date')}
                </label>
                <input 
                  type="datetime-local" 
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full bg-white/60 dark:bg-stone-800/60 border-none rounded-xl p-3 outline-none dark:text-white"
                />
              </div>
            )}

            <div className={`space-y-2 ${type === 'note' ? 'md:col-span-2' : ''}`}>
              <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">
                <MapPin className="w-4 h-4" /> {t('location')}
              </label>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  placeholder={t('location_placeholder')}
                  value={locationName}
                  onChange={(e) => setLocationName(e.target.value)}
                  className="flex-1 bg-white/60 dark:bg-stone-800/60 border-none rounded-xl p-3 outline-none dark:text-white"
                />
                <button 
                  onClick={getCurrentLocation}
                  className="p-3 bg-white/60 dark:bg-stone-800/60 rounded-xl hover:bg-white/80 dark:hover:bg-stone-700 transition-all"
                >
                  <MapPin className="w-5 h-5 text-emerald-600" />
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">
              <Tag className="w-4 h-4" /> {t('tags')}
            </label>
            <div className="flex flex-wrap gap-2">
              {tags.map(tag => (
                <span key={tag} className="px-3 py-1 bg-black/5 dark:bg-white/10 rounded-full text-sm flex items-center gap-1 dark:text-stone-200">
                  {tag}
                  <button onClick={() => removeTag(tag)} className="hover:text-red-500"><X className="w-3 h-3" /></button>
                </span>
              ))}
              <div className="flex items-center gap-2">
                <input 
                  type="text" 
                  placeholder={t('add_tag')}
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addTag()}
                  className="bg-transparent border-b border-black/10 dark:border-white/10 outline-none text-sm w-24 dark:text-white"
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">
              <Palette className="w-4 h-4" /> {t('color')}
            </label>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {COLORS.map(c => (
                <button 
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-full border-2 transition-all shrink-0 ${color === c ? 'border-black dark:border-white scale-110' : 'border-transparent hover:scale-105'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {memo?.id && noteIsShared(memo) && (
            <div className="border-t border-black/10 dark:border-white/10 pt-6">
              <NoteComments memo={memo} />
            </div>
          )}
        </div>

        <div className="p-6 bg-white/40 dark:bg-black/20 backdrop-blur-sm border-t border-black/5 dark:border-white/5 flex justify-end gap-3">
          <button onClick={handleClose} disabled={isSaving} className="btn-secondary disabled:opacity-50">
            {autoSave ? (t('close') || 'Cerrar') : t('cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="btn-primary px-8 flex items-center gap-2 disabled:opacity-70"
          >
            {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
            {isSaving ? t('saving') : t('save')}
          </button>
        </div>
      </motion.div>

      {fullScreenIndex !== null && (
        <ImageLightbox
          images={galleryImages}
          index={fullScreenIndex}
          onIndexChange={setFullScreenIndex}
          onClose={() => setFullScreenIndex(null)}
          downloadName={(i) => `${title || 'imagen'}-${i + 1}.webp`}
        />
      )}
    </div>
  );
}
