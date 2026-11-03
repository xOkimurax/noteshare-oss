import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  User,
  Mail,
  AtSign,
  Languages,
  Moon,
  Sun,
  Trash2,
  Palette,
  FileText,
  LogOut,
  Terminal,
  Copy,
  Check,
  AlertTriangle,
  X,
  Plus,
  Loader2,
  Puzzle,
  Download,
  Pencil,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { api, ApiError, API_URL } from '../api';
import { useAuth } from '../auth';
import { useAutoSave } from '../hooks/useAutoSave';
import { qk } from '../query';
import { describeUploadFailure } from '../lib/uploadDiagnostics';
import { useBackable } from '../hooks/useBackable';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface SettingsProps {
  isDarkMode: boolean;
  setIsDarkMode: (val: boolean) => void;
}

export default function Settings({ isDarkMode, setIsDarkMode }: SettingsProps) {
  const { t, i18n } = useTranslation();
  const { user, logout, refresh } = useAuth();
  const qc = useQueryClient();
  const [autoSave, setAutoSave] = useAutoSave();

  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useBackable(isDeleteModalOpen, () => setIsDeleteModalOpen(false));

  const photoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
  const [usernameInput, setUsernameInput] = useState(user?.username ?? '');
  const [usernameStatus, setUsernameStatus] = useState<
    'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'saving' | 'saved' | 'error'
  >('idle');

  // Debounced availability check as the user types a new handle.
  useEffect(() => {
    const value = usernameInput.trim().toLowerCase();
    if (!value || value === (user?.username ?? '')) {
      setUsernameStatus('idle');
      return;
    }
    if (!USERNAME_RE.test(value)) {
      setUsernameStatus('invalid');
      return;
    }
    setUsernameStatus('checking');
    const h = setTimeout(async () => {
      try {
        const { exists } = await api.lookupUsername(value);
        setUsernameStatus(exists ? 'taken' : 'available');
      } catch {
        setUsernameStatus('error');
      }
    }, 400);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usernameInput]);

  const saveUsername = async () => {
    const value = usernameInput.trim().toLowerCase();
    if (usernameStatus !== 'available') return;
    setUsernameStatus('saving');
    try {
      await api.updateProfile({ username: value });
      await refresh();
      setUsernameStatus('saved');
    } catch (err) {
      setUsernameStatus(err instanceof ApiError && err.status === 409 ? 'taken' : 'error');
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
    if (file.size > 8 * 1024 * 1024) {
      setPhotoError('La imagen es demasiado grande (máx. 8MB).');
      return;
    }
    setPhotoError(null);
    setUploadingPhoto(true);
    try {
      await api.updateProfilePhoto(file);
      await refresh();
    } catch (err) {
      console.error('Error uploading photo:', err);
      setPhotoError(await describeUploadFailure(err));
    } finally {
      setUploadingPhoto(false);
    }
  };

  const { data: tokens = [] } = useQuery({
    queryKey: qk.tokens,
    queryFn: api.listTokens,
  });
  const [newToken, setNewToken] = useState<string | null>(null);
  const [creatingToken, setCreatingToken] = useState(false);
  const [copied, setCopied] = useState(false);

  const languages = [
    { code: 'es', name: t('spanish') },
    { code: 'en', name: t('english') },
    { code: 'fr', name: t('french') },
    { code: 'de', name: t('german') },
    { code: 'it', name: t('italian') },
    { code: 'pt', name: t('portuguese') },
    { code: 'zh', name: t('chinese') },
    { code: 'ja', name: t('japanese') },
  ];

  const changeLanguage = (lng: string) => i18n.changeLanguage(lng);

  const handleCreateToken = async () => {
    setCreatingToken(true);
    try {
      const created = await api.createToken('MCP');
      setNewToken(created.token ?? null);
      qc.invalidateQueries({ queryKey: qk.tokens });
    } catch (e) {
      console.error(e);
    } finally {
      setCreatingToken(false);
    }
  };

  const handleDeleteToken = async (id: string) => {
    try {
      await api.deleteToken(id);
      qc.invalidateQueries({ queryKey: qk.tokens });
    } catch (e) {
      console.error(e);
    }
  };

  const copyToken = () => {
    if (newToken) {
      navigator.clipboard.writeText(newToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    setError(null);
    try {
      await api.deleteAccount();
      await logout();
      window.location.href = '/';
    } catch (err) {
      console.error('Error deleting account:', err);
      setError(
        t('error_deleting_account') ||
          'An error occurred while deleting your account. Please try again.',
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const configSnippet = `"mcpServers": {
  "noteshare": {
    "command": "node",
    "args": ["/ruta/absoluta/a/noteshare-mcp.js"],
    "env": {
      "NOTESHARE_API_URL": "${API_URL}",
      "NOTESHARE_TOKEN": "TU_TOKEN_AQUI"
    }
  }
}`;

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-20">
      <header>
        <h1 className="text-3xl font-bold dark:text-white">{t('settings')}</h1>
        <p className="text-stone-500 dark:text-stone-400">
          {t('manage_profile_desc') ||
            'Manage your account settings and preferences.'}
        </p>
      </header>

      {/* Profile Section */}
      <section className="card p-6 space-y-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 rounded-2xl flex items-center justify-center">
            <User className="w-6 h-6 text-emerald-600" />
          </div>
          <h2 className="text-xl font-bold dark:text-white">
            {t('profile') || 'Profile'}
          </h2>
        </div>

        <div className="flex flex-col md:flex-row gap-8 items-start md:items-center">
          <div className="shrink-0 space-y-2">
            <div className="relative w-24 h-24 group">
              <img
                src={user?.photoURL || ''}
                alt={user?.displayName || ''}
                className="w-24 h-24 rounded-3xl border-4 border-white dark:border-stone-800 shadow-xl object-cover"
              />
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                disabled={uploadingPhoto}
                title="Cambiar foto"
                className={cn(
                  'absolute inset-0 flex items-center justify-center rounded-3xl text-white transition-opacity',
                  uploadingPhoto
                    ? 'opacity-100 bg-black/50'
                    : 'opacity-0 group-hover:opacity-100 bg-black/40',
                )}
              >
                {uploadingPhoto ? (
                  <Loader2 className="w-6 h-6 animate-spin" />
                ) : (
                  <Pencil className="w-6 h-6" />
                )}
              </button>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                onChange={handlePhotoChange}
                className="hidden"
              />
            </div>
            {photoError && (
              <p className="text-xs text-red-500 max-w-[6.5rem] leading-snug">
                {photoError}
              </p>
            )}
          </div>
          <div className="space-y-4 flex-1 w-full">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-bold uppercase tracking-wider text-stone-400">
                  {t('display_name') || 'Display Name'}
                </label>
                <div className="flex items-center gap-3 p-3 bg-stone-50 dark:bg-stone-800 rounded-xl border border-stone-100 dark:border-stone-700">
                  <User className="w-4 h-4 text-stone-400" />
                  <span className="dark:text-white font-medium">
                    {user?.displayName}
                  </span>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold uppercase tracking-wider text-stone-400">
                  {t('username') || 'Nickname'}
                </label>
                <div
                  className={cn(
                    'flex items-center gap-3 p-3 bg-stone-50 dark:bg-stone-800 rounded-xl border transition-colors',
                    usernameStatus === 'taken' ||
                      usernameStatus === 'invalid' ||
                      usernameStatus === 'error'
                      ? 'border-red-300 dark:border-red-800'
                      : usernameStatus === 'available' || usernameStatus === 'saved'
                        ? 'border-emerald-300 dark:border-emerald-800'
                        : 'border-stone-100 dark:border-stone-700',
                  )}
                >
                  <AtSign className="w-4 h-4 text-stone-400 shrink-0" />
                  <input
                    value={usernameInput}
                    onChange={(e) => {
                      setUsernameInput(e.target.value);
                      if (usernameStatus === 'saved') setUsernameStatus('idle');
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && saveUsername()}
                    placeholder={t('username_placeholder', { defaultValue: 'nickname' })}
                    maxLength={20}
                    className="flex-1 min-w-0 bg-transparent outline-none dark:text-white font-medium text-sm"
                  />
                  {usernameStatus === 'checking' && (
                    <Loader2 className="w-4 h-4 text-stone-400 animate-spin shrink-0" />
                  )}
                  {usernameStatus === 'available' && (
                    <button
                      type="button"
                      onClick={saveUsername}
                      title={t('save') || 'Save'}
                      className="text-emerald-600 hover:text-emerald-700 shrink-0"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                  )}
                  {usernameStatus === 'saving' && (
                    <Loader2 className="w-4 h-4 text-emerald-600 animate-spin shrink-0" />
                  )}
                  {usernameStatus === 'saved' && (
                    <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                  )}
                  {(usernameStatus === 'taken' ||
                    usernameStatus === 'invalid' ||
                    usernameStatus === 'error') && (
                    <X className="w-4 h-4 text-red-500 shrink-0" />
                  )}
                </div>
                {usernameStatus === 'taken' && (
                  <p className="text-[11px] text-red-500">
                    {t('username_taken', { defaultValue: 'Ese nickname ya está en uso.' })}
                  </p>
                )}
                {usernameStatus === 'invalid' && (
                  <p className="text-[11px] text-red-500">
                    {t('username_invalid', {
                      defaultValue: '3-20 caracteres: minúsculas, números o guion bajo.',
                    })}
                  </p>
                )}
                {usernameStatus === 'available' && (
                  <p className="text-[11px] text-emerald-600">
                    {t('username_available', {
                      defaultValue: 'Disponible — presioná Enter para guardar.',
                    })}
                  </p>
                )}
                {usernameStatus === 'error' && (
                  <p className="text-[11px] text-red-500">{t('error_saving')}</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold uppercase tracking-wider text-stone-400">
                  {t('email_address') || 'Email Address'}
                </label>
                <div className="flex items-center gap-3 p-3 bg-stone-50 dark:bg-stone-800 rounded-xl border border-stone-100 dark:border-stone-700">
                  <Mail className="w-4 h-4 text-stone-400" />
                  <span className="dark:text-white font-medium">{user?.email}</span>
                </div>
              </div>
            </div>
            <button
              onClick={() => {
                void logout();
                window.location.href = '/';
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 font-medium text-sm hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              {t('logout') || 'Cerrar sesión'}
            </button>
          </div>
        </div>
      </section>

      {/* Language Section */}
      <section className="card p-6 space-y-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-2xl flex items-center justify-center">
            <Languages className="w-6 h-6 text-blue-600" />
          </div>
          <h2 className="text-xl font-bold dark:text-white">{t('language')}</h2>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {languages.map((lang) => (
            <button
              key={lang.code}
              onClick={() => changeLanguage(lang.code)}
              className={cn(
                'flex items-center justify-between p-3 rounded-xl border transition-all',
                i18n.language === lang.code
                  ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400 font-medium'
                  : 'bg-white dark:bg-stone-800 border-stone-100 dark:border-stone-700 text-stone-600 dark:text-stone-400 hover:border-stone-300',
              )}
            >
              <span>{lang.name}</span>
              {i18n.language === lang.code && <Check className="w-4 h-4" />}
            </button>
          ))}
        </div>
      </section>

      {/* Appearance Section */}
      <section className="card p-6 space-y-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-amber-100 dark:bg-amber-900/30 rounded-2xl flex items-center justify-center">
            <Palette className="w-6 h-6 text-amber-600" />
          </div>
          <h2 className="text-xl font-bold dark:text-white">
            {t('appearance') || 'Appearance'}
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            onClick={() => setIsDarkMode(false)}
            className={cn(
              'flex items-center gap-4 p-4 rounded-2xl border transition-all',
              !isDarkMode
                ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 font-medium'
                : 'bg-white dark:bg-stone-800 border-stone-100 dark:border-stone-700 text-stone-600 dark:text-stone-400 hover:border-stone-300',
            )}
          >
            <div className="w-10 h-10 bg-white shadow-sm rounded-xl flex items-center justify-center border border-stone-100">
              <Sun className="w-5 h-5 text-amber-500" />
            </div>
            <div className="text-left">
              <p className="font-bold">{t('light_mode') || 'Light Mode'}</p>
              <p className="text-xs opacity-70">
                {t('light_mode_desc') || 'Clean and bright interface'}
              </p>
            </div>
          </button>

          <button
            onClick={() => setIsDarkMode(true)}
            className={cn(
              'flex items-center gap-4 p-4 rounded-2xl border transition-all',
              isDarkMode
                ? 'bg-stone-800 border-stone-700 text-white font-medium'
                : 'bg-white dark:bg-stone-800 border-stone-100 dark:border-stone-700 text-stone-600 dark:text-stone-400 hover:border-stone-300',
            )}
          >
            <div className="w-10 h-10 bg-stone-900 shadow-sm rounded-xl flex items-center justify-center border border-stone-800">
              <Moon className="w-5 h-5 text-stone-400" />
            </div>
            <div className="text-left">
              <p className="font-bold">{t('dark_mode') || 'Dark Mode'}</p>
              <p className="text-xs opacity-70">
                {t('dark_mode_desc') || 'Easy on the eyes in the dark'}
              </p>
            </div>
          </button>
        </div>
      </section>

      {/* Editor Section */}
      <section className="card p-6 space-y-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 rounded-2xl flex items-center justify-center">
            <FileText className="w-6 h-6 text-emerald-600" />
          </div>
          <h2 className="text-xl font-bold dark:text-white">{t('editor') || 'Editor'}</h2>
        </div>

        <label className="flex items-start gap-4 p-4 rounded-2xl border border-stone-100 dark:border-stone-700 bg-white dark:bg-stone-800 cursor-pointer">
          <input
            type="checkbox"
            checked={autoSave}
            onChange={(e) => setAutoSave(e.target.checked)}
            className="mt-1 w-4 h-4 accent-emerald-600"
          />
          <div className="space-y-0.5">
            <p className="font-bold dark:text-stone-200">
              {t('autosave') || 'Guardado automático'}
            </p>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              {t('autosave_desc') ||
                'Guarda los cambios automáticamente mientras editás una nota.'}
            </p>
          </div>
        </label>
      </section>

      {/* MCP Integration Section */}
      <section className="card p-6 space-y-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-indigo-100 dark:bg-indigo-900/30 rounded-2xl flex items-center justify-center">
            <Terminal className="w-6 h-6 text-indigo-600" />
          </div>
          <h2 className="text-xl font-bold dark:text-white">Integración MCP (AI)</h2>
        </div>
        <div className="space-y-4">
          <p className="text-sm text-stone-600 dark:text-stone-400 leading-relaxed">
            El <strong>Model Context Protocol (MCP)</strong> permite a
            inteligencias artificiales (como Claude Desktop) conectarse de forma
            segura a tu cuenta de Noteshare para gestionar tus notas y carpetas.
          </p>

          <div className="p-4 bg-stone-50 dark:bg-stone-800/50 rounded-2xl border border-stone-200 dark:border-stone-700 space-y-3">
            <h3 className="font-bold text-sm dark:text-stone-200">
              1. Tokens de acceso
            </h3>
            <p className="text-xs text-stone-500">
              Generá un token para la IA. Se muestra una sola vez — copialo y
              guardalo en un lugar seguro. No lo compartas con nadie.
            </p>

            {newToken && (
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl space-y-2">
                <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide">
                  Nuevo token (copialo ahora)
                </p>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={newToken}
                    className="flex-1 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2 text-xs font-mono text-stone-600 dark:text-stone-300"
                  />
                  <button
                    onClick={copyToken}
                    className="p-2 bg-emerald-600 text-white hover:bg-emerald-700 rounded-lg transition-colors shrink-0"
                  >
                    {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {tokens.map((tok) => (
                <div
                  key={tok.id}
                  className="flex items-center justify-between bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2"
                >
                  <div className="text-xs">
                    <span className="font-medium dark:text-stone-200">
                      {tok.name}
                    </span>
                    <span className="text-stone-400 ml-2">
                      {tok.lastUsedAt
                        ? `usado ${new Date(tok.lastUsedAt).toLocaleDateString()}`
                        : 'sin usar'}
                    </span>
                  </div>
                  <button
                    onClick={() => handleDeleteToken(tok.id)}
                    className="p-1.5 text-stone-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            <button
              onClick={handleCreateToken}
              disabled={creatingToken}
              className="inline-flex items-center gap-2 px-3 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 transition-colors disabled:opacity-50"
            >
              {creatingToken ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              Generar token
            </button>
          </div>

          <div className="p-4 bg-stone-50 dark:bg-stone-800/50 rounded-2xl border border-stone-200 dark:border-stone-700">
            <h3 className="font-bold text-sm mb-2 dark:text-stone-200">
              2. Instalación en Claude Desktop
            </h3>
            <p className="text-xs text-stone-500 mb-4 leading-relaxed">
              Descargá el script de conexión y configuralo en tu archivo{' '}
              <code className="bg-stone-200 dark:bg-stone-700 px-1 py-0.5 rounded">
                claude_desktop_config.json
              </code>
              :
            </p>
            <div className="bg-stone-900 text-stone-300 p-3 rounded-lg text-xs font-mono overflow-x-auto whitespace-pre">
              {configSnippet}
            </div>
            <div className="mt-4">
              <a
                href="/noteshare-mcp.js"
                download="noteshare-mcp.js"
                className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-600/20"
              >
                <Terminal className="w-4 h-4" />
                Descargar noteshare-mcp.js
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Browser Extension Section */}
      <section className="card p-6 space-y-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-2xl flex items-center justify-center">
            <Puzzle className="w-6 h-6 text-purple-600" />
          </div>
          <h2 className="text-xl font-bold dark:text-white">
            Extensión del navegador
          </h2>
        </div>

        <p className="text-sm text-stone-600 dark:text-stone-400 leading-relaxed">
          Abrí Noteshare como un panel lateral en tu navegador — con las
          mismas notas, chat y notificaciones nativas, sin necesidad de una
          pestaña aparte. Funciona en <strong>Chrome</strong>,{' '}
          <strong>Edge</strong>, <strong>Brave</strong> y otros navegadores
          basados en Chromium. (Firefox todavía no está soportado por esta
          vía.)
        </p>

        <div className="p-4 bg-stone-50 dark:bg-stone-800/50 rounded-2xl border border-stone-200 dark:border-stone-700 space-y-4">
          <div>
            <h3 className="font-bold text-sm mb-2 dark:text-stone-200">
              Cómo instalarla
            </h3>
            <ol className="text-xs text-stone-500 dark:text-stone-400 leading-relaxed space-y-1.5 list-decimal list-inside">
              <li>Descargá el archivo .zip de abajo y descomprimilo en una carpeta.</li>
              <li>
                Abrí{' '}
                <code className="bg-stone-200 dark:bg-stone-700 px-1 py-0.5 rounded">
                  chrome://extensions
                </code>{' '}
                (o{' '}
                <code className="bg-stone-200 dark:bg-stone-700 px-1 py-0.5 rounded">
                  edge://extensions
                </code>
                ,{' '}
                <code className="bg-stone-200 dark:bg-stone-700 px-1 py-0.5 rounded">
                  brave://extensions
                </code>
                ) en tu navegador.
              </li>
              <li>Activá el interruptor <strong>"Modo de desarrollador"</strong>, arriba a la derecha.</li>
              <li>Hacé clic en <strong>"Cargar descomprimida"</strong> y elegí la carpeta que descomprimiste.</li>
              <li>
                Listo — el ícono de Noteshare va a aparecer en la barra de
                extensiones. Fijalo (📌) para tenerlo siempre a mano.
              </li>
            </ol>
          </div>
          <a
            href="/noteshare-extension-chrome.zip"
            download="noteshare-extension-chrome.zip"
            className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-xl text-sm font-bold hover:bg-purple-700 transition-colors shadow-lg shadow-purple-600/20"
          >
            <Download className="w-4 h-4" />
            Descargar para Chrome / Edge / Brave
          </a>
        </div>
      </section>

      {/* Danger Zone */}
      <section className="card p-6 space-y-6 border-red-100 dark:border-red-900/30">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-2xl flex items-center justify-center">
            <Trash2 className="w-6 h-6 text-red-600" />
          </div>
          <h2 className="text-xl font-bold text-red-600">
            {t('danger_zone') || 'Danger Zone'}
          </h2>
        </div>

        <div className="p-4 bg-red-50 dark:bg-red-900/10 rounded-2xl border border-red-100 dark:border-red-900/20 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <p className="font-bold text-red-700 dark:text-red-400">
              {t('delete_account') || 'Delete Account'}
            </p>
            <p className="text-xs text-red-600/70 dark:text-red-400/60">
              {t('delete_account_warning') ||
                'This action is irreversible. All your data will be permanently removed.'}
            </p>
          </div>
          <button
            onClick={() => setIsDeleteModalOpen(true)}
            className="px-6 py-2 bg-red-600 text-white rounded-xl font-bold text-sm hover:bg-red-700 transition-all shadow-lg shadow-red-600/20"
          >
            {t('delete_account') || 'Delete Account'}
          </button>
        </div>
      </section>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {isDeleteModalOpen && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white dark:bg-stone-900 w-full max-w-md rounded-3xl shadow-2xl overflow-hidden border border-stone-200 dark:border-stone-800"
            >
              <div className="p-6 space-y-6">
                <div className="flex items-center justify-between">
                  <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-2xl flex items-center justify-center">
                    <AlertTriangle className="w-6 h-6 text-red-600" />
                  </div>
                  <button
                    onClick={() => setIsDeleteModalOpen(false)}
                    className="p-2 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-xl transition-colors"
                  >
                    <X className="w-5 h-5 text-stone-400" />
                  </button>
                </div>

                <div className="space-y-2">
                  <h3 className="text-xl font-bold dark:text-white">
                    {t('delete_account_confirm_title') || 'Delete your account?'}
                  </h3>
                  <p className="text-stone-500 dark:text-stone-400 text-sm leading-relaxed">
                    {t('delete_account_confirm_desc') ||
                      'This will permanently delete your account and all your notes. This action cannot be undone.'}
                  </p>
                </div>

                {error && (
                  <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 rounded-2xl text-red-600 dark:text-red-400 text-sm font-medium">
                    {error}
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={() => setIsDeleteModalOpen(false)}
                    disabled={isDeleting}
                    className="flex-1 px-6 py-3 bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 rounded-2xl font-bold hover:bg-stone-200 dark:hover:bg-stone-700 transition-all disabled:opacity-50"
                  >
                    {t('cancel')}
                  </button>
                  <button
                    onClick={handleDeleteAccount}
                    disabled={isDeleting}
                    className="flex-1 px-6 py-3 bg-red-600 text-white rounded-2xl font-bold hover:bg-red-700 transition-all shadow-lg shadow-red-600/20 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isDeleting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {t('deleting') || 'Deleting...'}
                      </>
                    ) : (
                      t('delete_account')
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
