import { useState, useEffect } from 'react';
import { useAuth } from './auth';
import { useEventStream } from './hooks/useEventStream';
import { useTranslation } from 'react-i18next';
import { 
  LayoutList, 
  Trello, 
  Calendar as CalendarIcon, 
  Map as MapIcon, 
  LogOut, 
  Plus,
  Search,
  User as UserIcon,
  Settings,
  Bell,
  Languages,
  Moon,
  Sun,
  Menu,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Components
import NoteList from './components/NoteList';
import KanbanBoard from './components/KanbanBoard';
import CalendarView from './components/CalendarView';
import MapView from './components/MapView';
import MemoEditor from './components/MemoEditor';
import SettingsView from './components/Settings';
import SharedNotes from './components/SharedNotes';
import { Memo } from './types';
import { Users } from 'lucide-react';
import NotificationsBell from './components/NotificationsBell';
import ContactsView from './components/ContactsView';
import ChatView from './components/ChatView';
import { BookUser, MessagesSquare } from 'lucide-react';
import { useConversations } from './hooks/data';
import { useBackable } from './hooks/useBackable';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type View = 'list' | 'kanban' | 'calendar' | 'map' | 'shared' | 'chat' | 'contacts' | 'settings';

export default function App() {
  const { t, i18n } = useTranslation();
  const { user, loading, login, logout } = useAuth();
  useEventStream(!!user);
  const { totalUnread: chatUnread } = useConversations();
  const [activeView, setActiveView] = useState<View>('list');
  const [chatTarget, setChatTarget] = useState<string | null>(null);
  const [sharedTarget, setSharedTarget] = useState<string | null>(null);
  const openChat = (conversationId: string) => {
    setChatTarget(conversationId);
    setActiveView('chat');
    setIsNavOpen(false);
  };
  const openSharedNote = (memoId: string) => {
    setSharedTarget(memoId);
    setActiveView('shared');
    setIsNavOpen(false);
  };
  const goTo = (view: View) => {
    setActiveView(view);
    setIsNavOpen(false);
  };

  // Extension panel: a clicked desktop notification asks us to jump to the
  // note / conversation it was about.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as
        | { type?: string; target?: { conversationId?: string | null; memoId?: string | null } }
        | null;
      if (d?.type !== 'noteshare:open' || !d.target) return;
      if (d.target.conversationId) openChat(d.target.conversationId);
      else if (d.target.memoId) openSharedNote(d.target.memoId);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingMemo, setEditingMemo] = useState<Memo | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false);
  const [isNavOpen, setIsNavOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('theme') === 'dark' || 
        (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    return false;
  });

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  const handleLogin = () => login();
  const handleLogout = () => setIsLogoutConfirmOpen(true);
  const confirmLogout = () => {
    void logout();
    setIsLogoutConfirmOpen(false);
  };

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
    setIsLangMenuOpen(false);
  };

  const openEditor = (memo?: Memo) => {
    setEditingMemo(memo);
    setIsEditorOpen(true);
  };

  const closeEditor = () => {
    setEditingMemo(undefined);
    setIsEditorOpen(false);
  };

  // Mobile/browser back button steps back through the app instead of
  // leaving it — declared innermost-first (drawer, then confirm dialog,
  // then section), matching how they actually nest when opened.
  useBackable(isNavOpen, () => setIsNavOpen(false));
  useBackable(isLogoutConfirmOpen, () => setIsLogoutConfirmOpen(false));
  useBackable(activeView !== 'list', () => setActiveView('list'));

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
  };

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-stone-50 dark:bg-stone-950">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-stone-50 dark:bg-stone-950 p-4 transition-colors duration-300">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full glass p-8 rounded-3xl text-center space-y-6"
        >
          <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 rounded-2xl flex items-center justify-center mx-auto">
            <LayoutList className="w-8 h-8 text-emerald-600" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight dark:text-white">{t('app_name')}</h1>
          <p className="text-stone-500 dark:text-stone-400">
            {t('welcome_msg')}
          </p>
          <button 
            onClick={handleLogin}
            className="w-full btn-primary py-3 flex items-center justify-center gap-2 font-medium"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
            {t('continue_google')}
          </button>
          <div className="text-xs text-stone-400 dark:text-stone-500">
            {t('terms_msg')}
          </div>
        </motion.div>
      </div>
    );
  }

  const navItems = [
    { id: 'list', icon: LayoutList, label: t('notes') },
    { id: 'kanban', icon: Trello, label: t('kanban') },
    { id: 'calendar', icon: CalendarIcon, label: t('calendar') },
    { id: 'map', icon: MapIcon, label: t('map') },
    { id: 'shared', icon: Users, label: t('shared') },
    { id: 'chat', icon: MessagesSquare, label: t('chat') },
  ];
  // Contacts and Settings live in the sidebar on desktop, but on mobile they
  // stay as header icons (not in the already-full bottom bar).
  const contactsNav = { id: 'contacts', icon: BookUser, label: t('contacts') };
  const settingsNav = { id: 'settings', icon: Settings, label: t('settings') };

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

  return (
    <div className="h-screen flex flex-col md:flex-row bg-stone-50 dark:bg-stone-950 overflow-hidden transition-colors duration-300">
      {/* Sidebar - Desktop */}
      <aside className="hidden md:flex w-20 lg:w-64 bg-white dark:bg-stone-900 border-r border-stone-200 dark:border-stone-800 flex-col transition-colors duration-300">
        <div className="p-6 flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center shrink-0">
            <LayoutList className="w-6 h-6 text-white" />
          </div>
          <span className="font-bold text-xl hidden lg:block dark:text-white">{t('app_name')}</span>
        </div>

        <nav className="flex-1 px-4 space-y-2 mt-4">
          {[...navItems, contactsNav, settingsNav].map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveView(item.id as View)}
              className={cn(
                "w-full flex items-center gap-3 p-3 rounded-xl transition-all",
                activeView === item.id
                  ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 font-medium"
                  : "text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800"
              )}
            >
              <span className="relative shrink-0">
                <item.icon className="w-6 h-6" />
                {item.id === 'chat' && chatUnread > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                    {chatUnread > 9 ? '9+' : chatUnread}
                  </span>
                )}
              </span>
              <span className="hidden lg:block">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-stone-100 dark:border-stone-800 space-y-2">
          <div className="relative">
            <button 
              onClick={() => setIsLangMenuOpen(!isLangMenuOpen)}
              className="w-full flex items-center gap-3 p-3 rounded-xl text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 transition-all"
            >
              <Languages className="w-6 h-6" />
              <span className="hidden lg:block">{t('language')}</span>
            </button>
            <AnimatePresence>
              {isLangMenuOpen && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="absolute bottom-full left-0 w-full bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-xl shadow-lg mb-2 overflow-hidden z-50"
                >
                  {languages.map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => changeLanguage(lang.code)}
                      className={cn(
                        "w-full text-left p-3 text-sm hover:bg-stone-50 dark:hover:bg-stone-700 transition-colors",
                        i18n.language === lang.code ? "text-emerald-600 font-medium bg-emerald-50 dark:bg-emerald-900/20" : "text-stone-600 dark:text-stone-300"
                      )}
                    >
                      {lang.name}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <button 
            onClick={handleLogout}
            className="w-full flex items-center gap-3 p-3 rounded-xl text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
          >
            <LogOut className="w-6 h-6" />
            <span className="hidden lg:block">{t('logout')}</span>
          </button>
          
          <div className="flex items-center gap-3 p-3 mt-4">
            <img 
              src={user.photoURL || ''} 
              className="w-10 h-10 rounded-full border-2 border-white dark:border-stone-800 shadow-sm" 
              alt={user.displayName || 'User'} 
            />
            <div className="hidden lg:block overflow-hidden">
              <p className="text-sm font-semibold truncate dark:text-white">{user.displayName}</p>
              <p className="text-xs text-stone-400 truncate">{user.email}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {/* Header */}
        <header className="h-16 bg-white dark:bg-stone-900 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between px-4 md:px-6 shrink-0 transition-colors duration-300">
          <div className="flex items-center gap-3 md:gap-4 flex-1 max-w-xl">
            <button
              onClick={() => setIsNavOpen(true)}
              className="md:hidden p-2 -ml-2 rounded-lg text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition-all shrink-0 relative"
              title={t('menu') || 'Menú'}
            >
              <Menu className="w-5 h-5" />
              {chatUnread > 0 && (
                <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
              )}
            </button>
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
              <input 
                type="text" 
                placeholder={t('search_placeholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-stone-100 dark:bg-stone-800 border-transparent rounded-lg focus:bg-white dark:focus:bg-stone-700 focus:ring-2 focus:ring-emerald-500 transition-all outline-none text-sm dark:text-white"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-4 ml-2">
            {user && <NotificationsBell onOpenChat={openChat} onOpenMemo={openSharedNote} />}
            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="p-2 text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-lg transition-all"
              title={isDarkMode ? 'Light Mode' : 'Dark Mode'}
            >
              {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <button
              onClick={() => openEditor()}
              className="btn-primary flex items-center gap-2 px-3 sm:px-4 py-2 text-sm sm:text-base"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">{t('new_note')}</span>
            </button>
          </div>
        </header>

        {/* View Content */}
        <div className="flex-1 overflow-auto p-4 md:p-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeView}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="h-full"
            >
              {activeView === 'list' && <NoteList searchQuery={searchQuery} onEdit={openEditor} onSaveSuccess={(msg) => showToast(msg)} currentFolderId={currentFolderId} onFolderChange={setCurrentFolderId} />}
              {activeView === 'kanban' && <KanbanBoard onEdit={openEditor} />}
              {activeView === 'calendar' && <CalendarView onEdit={openEditor} />}
              {activeView === 'map' && <MapView />}
              {activeView === 'shared' && <SharedNotes searchQuery={searchQuery} onEdit={openEditor} onSaveSuccess={(msg) => showToast(msg)} openMemoId={sharedTarget} onOpenedMemo={() => setSharedTarget(null)} />}
              {activeView === 'chat' && <ChatView openConversationId={chatTarget} onOpenSharedNote={openSharedNote} />}
              {activeView === 'contacts' && <ContactsView onToast={(msg, type) => showToast(msg, type)} onOpenChat={openChat} />}
              {activeView === 'settings' && <SettingsView isDarkMode={isDarkMode} setIsDarkMode={setIsDarkMode} />}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Navigation drawer - Mobile (replaces the bottom bar). No
            backdrop-blur — it tanks the framerate on phones. */}
        <AnimatePresence>
          {isNavOpen && (
            <div className="md:hidden fixed inset-0 z-[105]">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                onClick={() => setIsNavOpen(false)}
                className="absolute inset-0 bg-stone-900/50"
              />
              <motion.aside
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ type: 'tween', ease: 'easeOut', duration: 0.2 }}
                className="absolute inset-y-0 left-0 w-[82%] max-w-xs bg-white dark:bg-stone-900 flex flex-col shadow-2xl will-change-transform"
              >
                <div className="p-5 flex items-center justify-between border-b border-stone-100 dark:border-stone-800">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-emerald-600 rounded-xl flex items-center justify-center shrink-0">
                      <LayoutList className="w-5 h-5 text-white" />
                    </div>
                    <span className="font-bold text-lg dark:text-white">{t('app_name')}</span>
                  </div>
                  <button
                    onClick={() => setIsNavOpen(false)}
                    className="p-2 -mr-2 rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
                  {[...navItems, contactsNav, settingsNav].map((item) => (
                    <button
                      key={item.id}
                      onClick={() => goTo(item.id as View)}
                      className={cn(
                        'w-full flex items-center gap-3 p-3 rounded-xl transition-all',
                        activeView === item.id
                          ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 font-medium'
                          : 'text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800',
                      )}
                    >
                      <span className="relative shrink-0">
                        <item.icon className="w-5 h-5" />
                        {item.id === 'chat' && chatUnread > 0 && (
                          <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                            {chatUnread > 9 ? '9+' : chatUnread}
                          </span>
                        )}
                      </span>
                      <span>{item.label}</span>
                    </button>
                  ))}
                </nav>

                <div className="p-3 border-t border-stone-100 dark:border-stone-800 space-y-1">
                  <div className="relative">
                    <button
                      onClick={() => setIsLangMenuOpen(!isLangMenuOpen)}
                      className="w-full flex items-center gap-3 p-3 rounded-xl text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition-all"
                    >
                      <Languages className="w-5 h-5 shrink-0" />
                      <span>{t('language')}</span>
                    </button>
                    <AnimatePresence>
                      {isLangMenuOpen && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 10 }}
                          className="absolute bottom-full left-0 w-full bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-xl shadow-lg mb-2 overflow-hidden z-50 max-h-64 overflow-y-auto"
                        >
                          {languages.map((lang) => (
                            <button
                              key={lang.code}
                              onClick={() => changeLanguage(lang.code)}
                              className={cn(
                                'w-full text-left p-3 text-sm hover:bg-stone-50 dark:hover:bg-stone-700 transition-colors',
                                i18n.language === lang.code
                                  ? 'text-emerald-600 font-medium bg-emerald-50 dark:bg-emerald-900/20'
                                  : 'text-stone-600 dark:text-stone-300',
                              )}
                            >
                              {lang.name}
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  <button
                    onClick={() => {
                      setIsNavOpen(false);
                      handleLogout();
                    }}
                    className="w-full flex items-center gap-3 p-3 rounded-xl text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
                  >
                    <LogOut className="w-5 h-5 shrink-0" />
                    <span>{t('logout')}</span>
                  </button>
                  <div className="flex items-center gap-3 p-3">
                    <img
                      src={user.photoURL || ''}
                      className="w-9 h-9 rounded-full border-2 border-white dark:border-stone-800 shadow-sm"
                      alt={user.displayName || 'User'}
                    />
                    <div className="overflow-hidden">
                      <p className="text-sm font-semibold truncate dark:text-white">{user.displayName}</p>
                      <p className="text-xs text-stone-400 truncate">{user.email}</p>
                    </div>
                  </div>
                </div>
              </motion.aside>
            </div>
          )}
        </AnimatePresence>
      </main>

      {/* Editor Modal */}
      {isEditorOpen && (
        <MemoEditor 
          memo={editingMemo} 
          onClose={closeEditor} 
          onSaveSuccess={(msg) => showToast(msg)}
          initialFolderId={currentFolderId}
        />
      )}

      {/* Logout Confirmation Modal */}
      <AnimatePresence>
        {isLogoutConfirmOpen && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsLogoutConfirmOpen(false)}
              className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-sm bg-white dark:bg-stone-900 rounded-3xl shadow-2xl p-8 space-y-6 overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-2xl flex items-center justify-center mx-auto text-red-600">
                <LogOut className="w-8 h-8" />
              </div>
              <div className="text-center space-y-2">
                <h3 className="text-xl font-bold dark:text-white">{t('confirm_logout') || 'Confirm Logout'}</h3>
                <p className="text-stone-500 dark:text-stone-400">
                  {t('logout_message') || 'Are you sure you want to log out? Your session will end.'}
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <button 
                  onClick={confirmLogout}
                  className="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-red-600/20"
                >
                  {t('logout') || 'Log Out'}
                </button>
                <button 
                  onClick={() => setIsLogoutConfirmOpen(false)}
                  className="w-full py-3 bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 font-bold rounded-xl transition-all"
                >
                  {t('cancel') || 'Cancel'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className={cn(
              "fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 backdrop-blur-md border",
              toast.type === 'success' 
                ? "bg-emerald-600/90 text-white border-emerald-500" 
                : "bg-red-600/90 text-white border-red-500"
            )}
          >
            {toast.type === 'success' ? <Bell className="w-5 h-5" /> : <Search className="w-5 h-5" />}
            <span className="font-medium">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
