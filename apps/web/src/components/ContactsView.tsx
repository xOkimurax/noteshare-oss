import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import {
  BookUser,
  Star,
  Trash2,
  Plus,
  Loader2,
  Mail,
  Search,
  MessageSquare,
  UserRound,
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { UserSearchResult } from '@noteshare/shared';
import { api, ApiError, assetUrl, type Contact } from '../api';
import { useContacts } from '../hooks/data';
import { qk } from '../query';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ContactsViewProps {
  onToast?: (message: string, type?: 'success' | 'error') => void;
  onOpenChat?: (conversationId: string) => void;
}

function initialOf(c: Contact) {
  return (c.alias || c.name || c.email).trim().charAt(0).toUpperCase() || '?';
}

export default function ContactsView({ onToast, onOpenChat }: ContactsViewProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { contacts, loading } = useContacts();

  // Accepts either an email address or a "@nickname" / bare nickname.
  const [identifierInput, setIdentifierInput] = useState('');
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Nickname-prefix typeahead — registered users matching what's typed,
  // excluding people already in the address book.
  const [suggestions, setSuggestions] = useState<UserSearchResult[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const suggestSeq = useRef(0);

  const refresh = () => qc.invalidateQueries({ queryKey: qk.contacts });

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const parseIdentifier = (raw: string): { email: string } | { username: string } | null => {
    const value = raw.trim();
    if (!value) return null;
    if (EMAIL_RE.test(value)) return { email: value.toLowerCase() };
    return { username: value.replace(/^@/, '').toLowerCase() };
  };

  useEffect(() => {
    const query = identifierInput.trim().replace(/^@/, '');
    if (EMAIL_RE.test(identifierInput.trim()) || query.length < 3) {
      setSuggestions([]);
      return;
    }
    const seq = ++suggestSeq.current;
    const id = setTimeout(async () => {
      try {
        const { items } = await api.searchUsers(query);
        if (suggestSeq.current === seq) setSuggestions(items);
      } catch {
        if (suggestSeq.current === seq) setSuggestions([]);
      }
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identifierInput]);

  const addContactWith = async (identifier: { email: string } | { username: string }) => {
    if (adding) return;
    setAdding(true);
    try {
      const created = await api.addContact(identifier);
      setIdentifierInput('');
      setSuggestions([]);
      setSuggestOpen(false);
      refresh();
      onToast?.(
        created.hasAccount
          ? t('contact_added')
          : `${t('contact_added')} — ${t('contact_invite_note')}`,
      );
    } catch (err) {
      const msg =
        err instanceof ApiError && err.status === 409
          ? t('contact_exists')
          : err instanceof ApiError && err.status === 404
            ? t('username_not_found', { defaultValue: 'No existe ningún usuario con ese nickname.' })
            : t('contact_add_error');
      onToast?.(msg, 'error');
    } finally {
      setAdding(false);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const identifier = parseIdentifier(identifierInput);
    if (!identifier) return;
    await addContactWith(identifier);
  };

  const toggleFavorite = async (c: Contact) => {
    setBusyId(c.id);
    try {
      await api.updateContact(c.id, { favorite: !c.favorite });
      refresh();
    } catch {
      onToast?.(t('contact_add_error'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const openChat = async (c: Contact) => {
    setBusyId(c.id);
    try {
      const conv = await api.openConversation({ email: c.email });
      onOpenChat?.(conv.id);
    } catch {
      onToast?.(t('contact_add_error'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (c: Contact) => {
    setBusyId(c.id);
    try {
      await api.deleteContact(c.id);
      refresh();
    } catch {
      onToast?.(t('contact_add_error'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  // Backend already returns favourites-first / name-asc; sort again so the
  // mock roster and optimistic states stay ordered too.
  const sorted = [...contacts].sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    return (a.alias || a.name).localeCompare(b.alias || b.name);
  });

  const q = search.trim().toLowerCase();
  const filtered = q
    ? sorted.filter((c) =>
        [c.name, c.email, c.alias ?? '']
          .some((field) => field.toLowerCase().includes(q)),
      )
    : sorted;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold dark:text-white flex items-center gap-3">
          <BookUser className="w-7 h-7 text-emerald-600" />
          {t('contacts')}
        </h1>
        <p className="text-stone-500 dark:text-stone-400">{t('contacts_desc')}</p>
      </header>

      {/* Add by email or @nickname */}
      <form onSubmit={handleAdd} className="card p-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <input
            type="text"
            value={identifierInput}
            onChange={(e) => setIdentifierInput(e.target.value)}
            onFocus={() => setSuggestOpen(true)}
            onBlur={() => setTimeout(() => setSuggestOpen(false), 150)}
            placeholder={t('contact_identifier_placeholder', {
              defaultValue: 'Correo o @nickname',
            })}
            className="w-full pl-10 pr-4 py-2 bg-stone-100 dark:bg-stone-800 border-transparent rounded-lg focus:bg-white dark:focus:bg-stone-700 focus:ring-2 focus:ring-emerald-500 transition-all outline-none text-sm dark:text-white"
          />
          {suggestOpen && suggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-xl shadow-xl overflow-hidden">
              {suggestions.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  disabled={adding}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => addContactWith({ username: u.username })}
                  className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-stone-50 dark:hover:bg-stone-800/60 transition-colors disabled:opacity-50"
                >
                  {u.photoURL ? (
                    <img src={assetUrl(u.photoURL)} alt={u.name} className="w-8 h-8 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
                      <UserRound className="w-4 h-4" />
                    </div>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium truncate dark:text-stone-200">{u.name}</span>
                    <span className="block text-xs text-stone-400 truncate">@{u.username}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="submit"
          disabled={adding || !identifierInput.trim()}
          className="btn-primary flex items-center justify-center gap-2 px-4 py-2 text-sm shrink-0"
        >
          {adding ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Plus className="w-4 h-4" />
          )}
          {t('add_contact')}
        </button>
      </form>

      {/* Search */}
      {!loading && contacts.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('search_contacts')}
            className="w-full pl-10 pr-4 py-2 bg-stone-50 dark:bg-stone-800 border-transparent rounded-xl focus:bg-white dark:focus:bg-stone-700 focus:ring-2 focus:ring-emerald-500 transition-all outline-none text-sm dark:text-white"
          />
        </div>
      )}

      {/* List */}
      <section className="space-y-2">
        {loading && (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-stone-400" />
          </div>
        )}

        {!loading && sorted.length === 0 && (
          <div className="text-center py-16 text-stone-400 dark:text-stone-500">
            <BookUser className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm">{t('contacts_empty')}</p>
          </div>
        )}

        {!loading && sorted.length > 0 && filtered.length === 0 && (
          <div className="text-center py-12 text-stone-400 dark:text-stone-500">
            <p className="text-sm">{t('contacts_empty')}</p>
          </div>
        )}

        {filtered.map((c) => (
          <div
            key={c.id}
            className="card p-3 flex items-center gap-3"
          >
            {c.photoURL ? (
              <img
                src={assetUrl(c.photoURL)}
                alt={c.name}
                className="w-10 h-10 rounded-full object-cover shrink-0"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 flex items-center justify-center font-bold shrink-0">
                {initialOf(c)}
              </div>
            )}

            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold truncate dark:text-stone-100">
                {c.alias || c.name}
              </p>
              <p className="text-xs text-stone-400 dark:text-stone-500 truncate">
                {c.email}
              </p>
              <span
                className={cn(
                  'inline-block mt-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full',
                  c.hasAccount
                    ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                    : 'bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400',
                )}
              >
                {c.hasAccount ? t('contact_has_account') : t('contact_no_account')}
              </span>
            </div>

            {c.hasAccount && onOpenChat && (
              <button
                onClick={() => openChat(c)}
                disabled={busyId === c.id}
                title={t('send_message')}
                className="p-2 rounded-lg text-stone-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors disabled:opacity-40"
              >
                <MessageSquare className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={() => toggleFavorite(c)}
              disabled={busyId === c.id}
              title={t('manage_contacts')}
              className={cn(
                'p-2 rounded-lg transition-colors disabled:opacity-40',
                c.favorite
                  ? 'text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                  : 'text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800',
              )}
            >
              <Star
                className="w-4 h-4"
                fill={c.favorite ? 'currentColor' : 'none'}
              />
            </button>
            <button
              onClick={() => remove(c)}
              disabled={busyId === c.id}
              title={t('remove_contact')}
              className="p-2 rounded-lg text-stone-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-40"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
