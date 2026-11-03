import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, LogOut, Pencil, Plus, Search, ShieldCheck, ShieldOff, Trash2, UserRound, Users } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { ChatGroupInfo as GroupMeta } from '@noteshare/shared';
import { api, assetUrl } from '../api';
import { qk } from '../query';
import { useContacts } from '../hooks/data';
import { describeUploadFailure } from '../lib/uploadDiagnostics';
import { useBackable } from '../hooks/useBackable';
import SharedMedia from './SharedMedia';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ChatGroupInfoProps {
  group: GroupMeta;
  conversationId: string;
  viewerId: string;
  /** Whether the viewer is one of this group's (possibly several) admins. */
  viewerIsAdmin: boolean;
  /** Called after the viewer leaves (or is the target of a removal that
   * turns out to be themself) — ChatView drops back to the conversation list. */
  onLeft: () => void;
  onOpenSharedNote?: (memoId: string) => void;
  onViewImage: (images: string[], index: number) => void;
}

/**
 * Group info as an in-place view inside the chat panel — same convention as
 * ChatContactInfo: ChatView owns the back-button header, this renders only
 * the scrollable body.
 */
export default function ChatGroupInfo({
  group,
  conversationId,
  viewerId,
  viewerIsAdmin,
  onLeft,
  onOpenSharedNote,
  onViewImage,
}: ChatGroupInfoProps) {
  const qc = useQueryClient();
  const { contacts } = useContacts();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  useBackable(confirmLeaveOpen, () => setConfirmLeaveOpen(false));

  const { data: members = [], isLoading } = useQuery({
    queryKey: qk.groupMembers(conversationId),
    queryFn: () => api.listGroupMembers(conversationId),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: qk.groupMembers(conversationId) });
    qc.invalidateQueries({ queryKey: qk.conversations });
  };

  const removeMember = async (userId: string) => {
    setBusyId(userId);
    setError(null);
    try {
      await api.removeGroupMember(conversationId, userId);
      if (userId === viewerId) {
        onLeft();
        return;
      }
      refresh();
    } catch {
      setError('No se pudo completar la acción. Intentá de nuevo.');
    } finally {
      setBusyId(null);
    }
  };

  const memberIds = new Set(members.map((m) => m.id));
  const candidates = useMemo(() => {
    const notInGroup = contacts.filter((c) => c.hasAccount && !memberIds.has(c.id));
    const q = addSearch.trim().toLowerCase();
    if (!q) return notInGroup;
    return notInGroup.filter((c) =>
      [c.name, c.email, c.alias ?? ''].some((field) => field.toLowerCase().includes(q)),
    );
    // memberIds is a new Set every render (derived from `members`); depend on
    // `members` itself instead so this only recomputes when it actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, members, addSearch]);

  const addMember = async (email: string) => {
    setAdding(true);
    setError(null);
    try {
      await api.addGroupMembers(conversationId, [email]);
      refresh();
    } catch {
      setError('No se pudo agregar a esa persona.');
    } finally {
      setAdding(false);
    }
  };

  const promoteMember = async (userId: string) => {
    setBusyId(userId);
    setError(null);
    try {
      await api.promoteToAdmin(conversationId, userId);
      refresh();
    } catch {
      setError('No se pudo designar como admin.');
    } finally {
      setBusyId(null);
    }
  };

  const demoteMember = async (userId: string) => {
    setBusyId(userId);
    setError(null);
    try {
      await api.demoteAdmin(conversationId, userId);
      refresh();
    } catch {
      setError('No se pudo quitar como admin.');
    } finally {
      setBusyId(null);
    }
  };

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setPhotoError('Elegí un archivo de imagen.');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setPhotoError('La imagen es demasiado grande (máx. 15MB).');
      return;
    }
    setPhotoError(null);
    setUploadingPhoto(true);
    try {
      await api.updateGroupPhoto(conversationId, file);
      refresh();
    } catch (err) {
      setPhotoError(await describeUploadFailure(err));
    } finally {
      setUploadingPhoto(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
      <div className="flex flex-col items-center gap-3 px-6 py-8 border-b border-stone-100 dark:border-stone-800">
        <div className="relative w-28 h-28 group">
          {group.photoURL ? (
            <button
              type="button"
              onClick={() => onViewImage([assetUrl(group.photoURL)], 0)}
              className="cursor-zoom-in rounded-full block"
              title="Ver foto"
            >
              <img
                src={assetUrl(group.photoURL)}
                alt={group.name}
                className="w-28 h-28 rounded-full object-cover shadow-lg"
              />
            </button>
          ) : (
            <div className="w-28 h-28 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 flex items-center justify-center">
              <Users className="w-12 h-12" />
            </div>
          )}
          {viewerIsAdmin && (
            <>
              {/* Small corner badge instead of a full-circle overlay — the
                  overlay used to sit on top of the "view photo" button below
                  and swallow every tap, so admins could never view the photo,
                  only change it. */}
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                disabled={uploadingPhoto}
                title="Cambiar foto del grupo"
                className={cn(
                  'absolute bottom-0 right-0 w-8 h-8 flex items-center justify-center rounded-full text-white shadow-lg transition-colors',
                  uploadingPhoto ? 'bg-black/70' : 'bg-black/60 hover:bg-black/80',
                )}
              >
                {uploadingPhoto ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Pencil className="w-4 h-4" />
                )}
              </button>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                onChange={handlePhotoChange}
                className="hidden"
              />
            </>
          )}
        </div>
        {photoError && (
          <p className="text-xs text-red-500 text-center max-w-[14rem] leading-snug">{photoError}</p>
        )}
        <div className="text-center">
          <p className="text-lg font-bold dark:text-white">{group.name}</p>
          <p className="text-sm text-stone-400">{group.memberCount} miembros</p>
        </div>
      </div>

      <SharedMedia
        conversationId={conversationId}
        onOpenSharedNote={onOpenSharedNote}
        onViewImage={onViewImage}
      />

      {error && (
        <div className="mx-4 mt-4 px-3 py-2 rounded-xl bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 text-xs">
          {error}
        </div>
      )}

      <div className="p-4 space-y-2 border-t border-stone-100 dark:border-stone-800">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold uppercase tracking-wider text-stone-400">
            Miembros
          </h4>
          {viewerIsAdmin && (
            <button
              type="button"
              onClick={() => setAddOpen((v) => !v)}
              className="flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700"
            >
              <Plus className="w-3.5 h-3.5" />
              Agregar
            </button>
          )}
        </div>

        {addOpen && (
          <div className="border border-stone-200 dark:border-stone-700 rounded-2xl p-2 space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400" />
              <input
                type="text"
                value={addSearch}
                onChange={(e) => setAddSearch(e.target.value)}
                placeholder="Buscar contactos..."
                className="w-full pl-8 pr-2 py-1.5 bg-stone-50 dark:bg-stone-900 border-transparent rounded-lg focus:bg-white dark:focus:bg-stone-800 focus:ring-2 focus:ring-emerald-500 transition-all outline-none text-xs dark:text-white"
              />
            </div>
            <div className="space-y-1 max-h-44 overflow-y-auto">
              {candidates.length === 0 ? (
                <p className="text-xs text-stone-400 italic px-2 py-1">
                  {addSearch
                    ? 'Ningún contacto coincide.'
                    : 'No hay más contactos para agregar.'}
                </p>
              ) : (
                candidates.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={adding}
                    onClick={() => void addMember(c.email)}
                    className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-xl text-left hover:bg-stone-50 dark:hover:bg-stone-800/60 transition-colors disabled:opacity-50"
                  >
                    {c.photoURL ? (
                      <img src={assetUrl(c.photoURL)} alt="" className="w-7 h-7 rounded-full object-cover" />
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 flex items-center justify-center">
                        <UserRound className="w-3.5 h-3.5" />
                      </div>
                    )}
                    <span className="text-xs font-medium truncate dark:text-stone-200">
                      {c.alias || c.name}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-stone-400" />
          </div>
        ) : (
          <div className="space-y-1">
            {members.map((m) => (
              <div
                key={m.id}
                className="flex items-center gap-3 px-2 py-2 rounded-xl"
              >
                {m.photoURL ? (
                  <img src={assetUrl(m.photoURL)} alt="" className="w-9 h-9 rounded-full object-cover" />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 flex items-center justify-center">
                    <UserRound className="w-4 h-4" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate dark:text-stone-200">
                    {m.name}
                    {m.isAdmin && (
                      <span className="ml-1.5 text-[10px] font-bold uppercase text-indigo-500">
                        Admin
                      </span>
                    )}
                    {m.id === viewerId && (
                      <span className="ml-1.5 text-[10px] text-stone-400">(vos)</span>
                    )}
                    {m.id === group.ownerId && (
                      <span className="ml-1.5 text-[10px] text-stone-400">(Creador)</span>
                    )}
                  </p>
                  <p className="text-xs text-stone-400 truncate">{m.email}</p>
                </div>
                {viewerIsAdmin && !m.isAdmin && (
                  <button
                    type="button"
                    disabled={busyId === m.id}
                    onClick={() => void promoteMember(m.id)}
                    title="Hacer admin"
                    className="p-1.5 rounded-lg text-stone-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition-colors disabled:opacity-40"
                  >
                    <ShieldCheck className="w-4 h-4" />
                  </button>
                )}
                {viewerIsAdmin && m.isAdmin && m.id !== group.ownerId && m.id !== viewerId && (
                  <button
                    type="button"
                    disabled={busyId === m.id}
                    onClick={() => void demoteMember(m.id)}
                    title="Quitar como admin"
                    className="p-1.5 rounded-lg text-stone-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors disabled:opacity-40"
                  >
                    <ShieldOff className="w-4 h-4" />
                  </button>
                )}
                {viewerIsAdmin && m.id !== viewerId && (
                  <button
                    type="button"
                    disabled={busyId === m.id}
                    onClick={() => void removeMember(m.id)}
                    title="Quitar del grupo"
                    className="p-1.5 rounded-lg text-stone-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-40"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="p-4 border-t border-stone-100 dark:border-stone-800">
        <button
          type="button"
          disabled={busyId === viewerId}
          onClick={() => setConfirmLeaveOpen(true)}
          className={cn(
            'w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl text-sm font-semibold transition-colors',
            'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50',
          )}
        >
          {busyId === viewerId ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <LogOut className="w-4 h-4" />
          )}
          Salir del grupo
        </button>
      </div>

      <AnimatePresence>
        {confirmLeaveOpen && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
            onClick={() => setConfirmLeaveOpen(false)}
          >
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
                <h3 className="text-lg font-bold dark:text-white">Salir del grupo</h3>
                <p className="text-stone-500 dark:text-stone-400 text-sm">
                  {`¿Estás seguro de que querés salir de "${group.name}"?`}
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmLeaveOpen(false)}
                  className="flex-1 py-2.5 bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 font-bold rounded-xl transition-all text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmLeaveOpen(false);
                    void removeMember(viewerId);
                  }}
                  disabled={busyId === viewerId}
                  className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-red-600/10 text-sm disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {busyId === viewerId ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    'Salir del grupo'
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
