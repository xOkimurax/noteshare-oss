import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import { X, Plus, Mail, Users, Key, AlertCircle, Loader2, Globe, Copy, Check, Search, Star, UserRound } from 'lucide-react';
import { Memo } from '../types';
import { checkUserExistsByEmail } from '../collaborators';
import { api } from '../api';
import { useContacts } from '../hooks/data';
import { useQueryClient } from '@tanstack/react-query';
import { qk } from '../query';
import { useBackable } from '../hooks/useBackable';

interface ShareModalProps {
  memo: Memo;
  isOpen: boolean;
  onClose: () => void;
  onSaveSuccess: (msg: string) => void;
}

export default function ShareModal({ memo, isOpen, onClose, onSaveSuccess }: ShareModalProps) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [allowAnyone, setAllowAnyone] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [publicSlug, setPublicSlug] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);
  const [emails, setEmails] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [contactSearch, setContactSearch] = useState('');
  const [showAllContacts, setShowAllContacts] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCheckingEmail, setIsCheckingEmail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const qc = useQueryClient();
  const { contacts, loading: contactsLoading } = useContacts();

  useEffect(() => {
    if (memo) {
      if (memo.shareCode || (memo.allowedEmails && memo.allowedEmails.length > 0) || memo.allowAnyone) {
        setCode(memo.shareCode || '');
        setAllowAnyone(memo.allowAnyone || false);
        setEmails((memo.allowedEmails || []).map((e) => e.toLowerCase()));
      } else {
        setCode('');
        setAllowAnyone(false);
        setEmails([]);
      }
      setIsPublic(memo.isPublic || false);
      setPublicSlug(memo.publicSlug || '');
      setLinkCopied(false);
      setContactSearch('');
      setShowAllContacts(false);
      setNewEmail('');
      setError(null);
      setInfo(null);
    }
  }, [memo]);

  const generateSlug = () => Math.random().toString(36).slice(2, 8);

  const handleTogglePublic = (checked: boolean) => {
    setIsPublic(checked);
    if (checked && !publicSlug.trim()) {
      setPublicSlug(generateSlug());
    }
  };

  const handleSlugChange = (val: string) => {
    // Keep it URL-friendly: lowercase, no spaces, letters/numbers/dashes only.
    const clean = val.toLowerCase().replace(/[^a-z0-9-]/g, '');
    setPublicSlug(clean);
  };

  const publicLink = `${window.location.origin}${window.location.pathname}?p=${publicSlug || memo.id}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicLink);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch (err) {
      console.error('Error copying link:', err);
    }
  };

  useBackable(isOpen, onClose);

  if (!isOpen) return null;

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Validates a candidate email (format, dupes) and adds it to the local
  // `emails` list. Returns true on success.
  const tryAddEmail = async (candidate: string): Promise<boolean> => {
    const trimmed = candidate.trim().toLowerCase();
    if (!trimmed) return false;

    if (!emailRegex.test(trimmed)) {
      setError(t('invalid_email') || 'Correo electrónico no válido');
      return false;
    }

    if (emails.includes(trimmed)) {
      setError(t('email_already_added') || 'Este correo ya ha sido añadido');
      return false;
    }

    setIsCheckingEmail(true);
    setError(null);
    try {
      // Non-registered addresses are allowed — they get an email invite and
      // the note resolves for them via allowedEmails once they log in.
      const exists = await checkUserExistsByEmail(trimmed).catch(() => true);
      setEmails((prev) => [...prev, trimmed]);
      setNewEmail('');
      setError(null);
      if (!exists) {
        setInfo(
          t('email_invite_sent') ||
            'Esa persona todavía no tiene cuenta — le llegará una invitación por correo.',
        );
      }
      return true;
    } finally {
      setIsCheckingEmail(false);
    }
  };

  const handleAddEmail = () => {
    if (!newEmail.trim() || isCheckingEmail) return;
    tryAddEmail(newEmail);
  };

  const removeEmail = (email: string) => {
    setEmails((prev) => prev.filter((e) => e !== email));
  };

  // Tick / untick a contact → add or drop its email from allowedEmails.
  const toggleContact = (email: string) => {
    const e = email.trim().toLowerCase();
    setError(null);
    setEmails((prev) => (prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]));
  };

  const contactEmails = new Set(contacts.map((c) => c.email.toLowerCase()));
  const q = contactSearch.trim().toLowerCase();
  const visibleContacts = [...contacts]
    .filter(
      (c) =>
        !q ||
        c.email.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        (c.alias ?? '').toLowerCase().includes(q),
    )
    .sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  // Long address books get capped to the first 8 (favourites sort first);
  // "Ver más" reveals the rest. A search always shows every match.
  const CONTACT_CAP = 8;
  const capActive = !q && !showAllContacts && visibleContacts.length > CONTACT_CAP;
  const shownContacts = capActive ? visibleContacts.slice(0, CONTACT_CAP) : visibleContacts;
  const hiddenCount = visibleContacts.length - shownContacts.length;

  // Selected emails that aren't in the address book — shown as removable chips.
  const manualEmails = emails.filter((e) => !contactEmails.has(e));

  const handleCodeChange = (val: string) => {
    const cleanVal = val.replace(/\s+/g, '');
    setCode(cleanVal);
    setError(val.includes(' ') ? t('code_no_spaces') : null);
  };

  const handleSave = async () => {
    let finalEmails = [...emails];
    if (newEmail.trim()) {
      // Any text left in the "other email" input must still pass validation
      // before it's included — never silently add an unchecked address.
      const added = await tryAddEmail(newEmail);
      if (!added) return;
      finalEmails = [...emails, newEmail.trim().toLowerCase()];
    }

    if (allowAnyone && !code.trim()) {
      setError(t('code_empty'));
      return;
    }

    if (!allowAnyone && !isPublic && finalEmails.length === 0 && !code.trim()) {
      setError(t('code_empty'));
      return;
    }

    if (isPublic && !publicSlug.trim()) {
      setError(t('public_link_empty') || 'El enlace público no puede estar vacío.');
      return;
    }

    setIsSaving(true);
    setError(null);

    const trimmedSlug = publicSlug.trim();
    try {
      if (code.trim()) {
        const { unique } = await api.checkShareCode(memo.id, code.trim());
        if (!unique) {
          setError(t('code_already_exists'));
          setIsSaving(false);
          return;
        }
      }
      if (isPublic && trimmedSlug) {
        const { unique } = await api.checkSlug(memo.id, trimmedSlug);
        if (!unique) {
          setError(t('public_link_already_exists') || 'Ese enlace público ya está en uso, elegí otro.');
          setIsSaving(false);
          return;
        }
      }

      // The backend persists sharing config, keeps each collaborator's view in
      // sync, and seeds every allowedEmail into the sharer's contacts.
      await api.updateShare(memo.id, {
        shareCode: code.trim() || null,
        allowAnyone,
        allowedEmails: finalEmails,
        isPublic,
        publicSlug: isPublic ? trimmedSlug : (memo.publicSlug || null),
      });
      qc.invalidateQueries({ queryKey: qk.memos });
      qc.invalidateQueries({ queryKey: qk.shared });
      qc.invalidateQueries({ queryKey: qk.contacts });

      onSaveSuccess(t('share_success'));
      onClose();
    } catch (err) {
      console.error('Error saving share configuration:', err);
      setError(t('error_saving'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveShare = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await api.removeShare(memo.id);
      qc.invalidateQueries({ queryKey: qk.memos });
      qc.invalidateQueries({ queryKey: qk.shared });

      onSaveSuccess(t('unshare_success'));
      onClose();
    } catch (err) {
      console.error('Error removing share:', err);
      setError(t('error_saving'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white dark:bg-stone-900 w-full max-w-md rounded-3xl shadow-2xl p-6 flex flex-col gap-5 overflow-hidden max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-stone-100 dark:border-stone-800 pb-3">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-emerald-600" />
            <h2 className="text-xl font-bold dark:text-white">{t('share_note')}</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-full transition-all">
            <X className="w-5 h-5 text-stone-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-5 pr-1">
          {error && (
            <div className="bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 p-3 rounded-xl flex items-center gap-2 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {info && !error && (
            <div className="bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 p-3 rounded-xl flex items-center gap-2 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{info}</span>
            </div>
          )}

          {/* Public link toggle */}
          <div className="space-y-2">
            <label className="flex items-start gap-3 p-3 bg-indigo-50 dark:bg-indigo-950/20 hover:bg-indigo-100 dark:hover:bg-indigo-950/30 rounded-2xl cursor-pointer transition-all">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => handleTogglePublic(e.target.checked)}
                className="mt-1 w-4 h-4 text-indigo-600 border-stone-300 rounded focus:ring-indigo-500 accent-indigo-600"
              />
              <div className="space-y-0.5 flex-1">
                <span className="text-sm font-semibold dark:text-stone-200 flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-indigo-500" />
                  {t('public_link') || 'Enlace público'}
                </span>
                <p className="text-[11px] text-stone-400 dark:text-stone-500">
                  {t('public_link_desc') || 'Cualquier persona con el enlace puede ver esta nota, sin necesidad de iniciar sesión. Solo lectura.'}
                </p>
              </div>
            </label>

            <AnimatePresence>
              {isPublic && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden space-y-2 pt-2"
                >
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wide">
                      {t('public_link_slug') || 'Enlace corto personalizado'}
                    </label>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-stone-400 dark:text-stone-500 shrink-0 truncate max-w-[35%]">
                        {window.location.origin}{window.location.pathname}?p=
                      </span>
                      <input
                        type="text"
                        value={publicSlug}
                        onChange={(e) => handleSlugChange(e.target.value)}
                        placeholder="mi-nota"
                        className="flex-1 min-w-0 px-3 py-1.5 bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg focus:ring-2 focus:ring-indigo-500 transition-all outline-none text-sm dark:text-white"
                      />
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={publicLink}
                      onFocus={(e) => e.target.select()}
                      className="flex-1 px-4 py-2 bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-xl outline-none text-xs text-stone-500 dark:text-stone-400 truncate"
                    />
                    <button
                      type="button"
                      onClick={handleCopyLink}
                      className="px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl flex items-center justify-center transition-all shadow-sm shrink-0"
                    >
                      {linkCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Code Input */}
          <div className="space-y-2">
            <label className="text-sm font-semibold dark:text-stone-300 flex items-center gap-2">
              <Key className="w-4 h-4 text-stone-400" />
              <span>
                {t('share_code')}
                {!allowAnyone && <span className="text-[10px] font-normal text-stone-400 ml-2">{t('optional_code')}</span>}
              </span>
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => handleCodeChange(e.target.value)}
              placeholder={t('share_code_placeholder')}
              className="w-full px-4 py-2.5 bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-xl focus:ring-2 focus:ring-emerald-500 transition-all outline-none text-sm dark:text-white"
            />
            <p className="text-[11px] text-stone-400 dark:text-stone-500">
              {!allowAnyone && emails.length > 0 ? t('code_optional_desc') : t('code_no_spaces')}
            </p>
          </div>

          {/* Toggle Anyone */}
          <label className="flex items-start gap-3 p-3 bg-stone-50 dark:bg-stone-800/50 hover:bg-stone-100 dark:hover:bg-stone-800/80 rounded-2xl cursor-pointer transition-all">
            <input
              type="checkbox"
              checked={allowAnyone}
              onChange={(e) => setAllowAnyone(e.target.checked)}
              className="mt-1 w-4 h-4 text-emerald-600 border-stone-300 rounded focus:ring-emerald-500 accent-emerald-600"
            />
            <div className="space-y-0.5">
              <span className="text-sm font-semibold dark:text-stone-200">{t('allow_anyone')}</span>
              <p className="text-[11px] text-stone-400 dark:text-stone-500">
                {t('allow_anyone_desc') || 'Cualquier persona que ingrese el código tendrá acceso a editar esta nota.'}
              </p>
            </div>
          </label>

          {/* Contacts picker (only when not "anyone with the code") */}
          <AnimatePresence>
            {!allowAnyone && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="space-y-3 overflow-hidden"
              >
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold dark:text-stone-300 flex items-center gap-2">
                    <Users className="w-4 h-4 text-stone-400" />
                    {t('share_with_contacts') || 'Compartir con contactos'}
                  </label>
                  {emails.length > 0 && (
                    <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                      {emails.length} {t('selected') || 'seleccionados'}
                    </span>
                  )}
                </div>

                {/* Search */}
                <div className="relative">
                  <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={contactSearch}
                    onChange={(e) => setContactSearch(e.target.value)}
                    placeholder={t('search_contacts') || 'Buscar contacto...'}
                    className="w-full pl-9 pr-3 py-2 bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-xl focus:ring-2 focus:ring-emerald-500 transition-all outline-none text-sm dark:text-white"
                  />
                </div>

                {/* Contact list */}
                <div className="border border-stone-200 dark:border-stone-700 rounded-xl overflow-hidden">
                  <ul className="max-h-52 overflow-y-auto divide-y divide-stone-100 dark:divide-stone-800">
                    {contactsLoading && (
                      <li className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-stone-400">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {t('loading') || 'Cargando...'}
                      </li>
                    )}

                    {!contactsLoading &&
                      shownContacts.map((c) => {
                        const email = c.email.toLowerCase();
                        const checked = emails.includes(email);
                        return (
                          <li key={c.id}>
                            <label className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-800/60 transition-colors">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleContact(email)}
                                className="w-4 h-4 text-emerald-600 border-stone-300 rounded focus:ring-emerald-500 accent-emerald-600 shrink-0"
                              />
                              {c.photoURL ? (
                                <img
                                  src={c.photoURL}
                                  alt=""
                                  className="w-7 h-7 rounded-full object-cover shrink-0"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <span className="w-7 h-7 rounded-full bg-stone-200 dark:bg-stone-700 flex items-center justify-center shrink-0">
                                  <UserRound className="w-4 h-4 text-stone-500 dark:text-stone-400" />
                                </span>
                              )}
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-1">
                                  <span className="text-sm font-medium dark:text-stone-200 truncate">
                                    {c.alias || c.name}
                                  </span>
                                  {c.favorite && (
                                    <Star className="w-3 h-3 text-amber-400 fill-amber-400 shrink-0" />
                                  )}
                                </span>
                                <span className="block text-[11px] text-stone-400 dark:text-stone-500 truncate">
                                  {c.email}
                                  {!c.hasAccount && ` · ${t('contact_no_account') || 'sin cuenta'}`}
                                </span>
                              </span>
                            </label>
                          </li>
                        );
                      })}

                    {!contactsLoading && visibleContacts.length === 0 && (
                      <li className="px-3 py-6 text-center text-xs text-stone-400 dark:text-stone-500 italic">
                        {contacts.length === 0
                          ? t('no_contacts_yet') || 'Todavía no tenés contactos guardados.'
                          : t('no_contacts_match') || 'Ningún contacto coincide con la búsqueda.'}
                      </li>
                    )}
                  </ul>

                  {!q && !contactsLoading && (capActive || showAllContacts) && visibleContacts.length > CONTACT_CAP && (
                    <button
                      type="button"
                      onClick={() => setShowAllContacts((v) => !v)}
                      className="w-full px-3 py-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 border-t border-stone-100 dark:border-stone-800 transition-colors"
                    >
                      {showAllContacts
                        ? t('show_less', { defaultValue: 'Ver menos' })
                        : t('show_more_contacts', { count: hiddenCount, defaultValue: 'Ver más ({{count}})' })}
                    </button>
                  )}
                </div>

                {/* "Other email" fallback */}
                <div className="space-y-2">
                  <label className="text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wide flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5" />
                    {t('other_email') || 'Otro correo'}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddEmail())}
                      placeholder={t('add_email_placeholder')}
                      disabled={isCheckingEmail}
                      className="flex-1 px-4 py-2 bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-xl focus:ring-2 focus:ring-emerald-500 transition-all outline-none text-sm dark:text-white disabled:opacity-60"
                    />
                    <button
                      type="button"
                      onClick={handleAddEmail}
                      disabled={!newEmail.trim() || isCheckingEmail}
                      title={isCheckingEmail ? (t('checking_email') || 'Verificando...') : undefined}
                      className="px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl flex items-center justify-center transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isCheckingEmail ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                    </button>
                  </div>
                  <p className="text-[11px] text-stone-400 dark:text-stone-500">
                    {t('contacts_autosaved_hint') ||
                      'Las personas con las que compartís se guardan en tus contactos.'}
                  </p>
                </div>

                {/* Manually-typed emails not in the address book */}
                {manualEmails.length > 0 && (
                  <div className="flex flex-wrap gap-2 p-1">
                    {manualEmails.map((email) => (
                      <span
                        key={email}
                        className="flex items-center gap-1.5 pl-3 pr-2 py-1 bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 text-xs font-medium rounded-full border border-stone-200/50 dark:border-stone-700/50"
                      >
                        <span className="truncate max-w-[150px]">{email}</span>
                        <button
                          type="button"
                          onClick={() => removeEmail(email)}
                          className="p-0.5 hover:bg-stone-200 dark:hover:bg-stone-700 rounded-full transition-all text-stone-400 hover:text-red-500"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex flex-col gap-2 pt-3 border-t border-stone-100 dark:border-stone-800">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-emerald-600/10 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isSaving ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                className="w-4 h-4 border-2 border-white border-t-transparent rounded-full"
              />
            ) : t('share') || 'Compartir'}
          </button>

          {(memo.shareCode || (memo.allowedEmails && memo.allowedEmails.length > 0) || memo.allowAnyone || memo.isPublic) && (
            <button
              onClick={handleRemoveShare}
              disabled={isSaving}
              className="w-full py-2.5 bg-stone-100 dark:bg-stone-800 text-red-600 dark:text-red-400 font-bold rounded-xl transition-all hover:bg-red-50 dark:hover:bg-red-950/20"
            >
              {t('remove_sharing') || 'Dejar de Compartir'}
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
