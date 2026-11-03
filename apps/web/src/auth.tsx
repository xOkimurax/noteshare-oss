import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { UserProfile } from '@noteshare/shared';
import { api, ApiError } from './api';
import { IS_EMBEDDED, requestParentLogin, requestParentLogout } from './lib/embed';

interface AuthState {
  user: UserProfile | null;
  loading: boolean;
  login: () => void;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      setUser(await api.me());
    } catch (err) {
      // Access token expired? Try one silent refresh before giving up.
      if (err instanceof ApiError && err.status === 401) {
        try {
          setUser(await api.refresh());
          return;
        } catch {
          /* fall through */
        }
      }
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // Keep the session alive so an open tab never lands on "no connection".
  //  - a heartbeat every 4 min renews the 1 h access token well before it dies,
  //    even while the tab just sits there untouched;
  //  - and again the moment the tab/window regains focus or the network
  //    returns, before the app fires its focus refetches.
  // (Embedded mode has no cookie session — the extension owns auth there.)
  useEffect(() => {
    if (IS_EMBEDDED) return;

    let alive = true;
    const renew = () => {
      if (!alive || document.visibilityState === 'hidden') return;
      api
        .refresh()
        .then((u) => alive && setUser(u))
        .catch((e) => {
          if (e instanceof ApiError && e.status === 401) {
            window.dispatchEvent(new Event('noteshare:auth-lost'));
          }
        });
    };
    const onFocus = () => {
      if (document.visibilityState === 'visible') renew();
    };

    const beat = setInterval(renew, 4 * 60 * 1000);
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);

    // The API client fires this when a refresh genuinely failed (session dead).
    const onLost = () => alive && setUser(null);
    window.addEventListener('noteshare:auth-lost', onLost);

    return () => {
      alive = false;
      clearInterval(beat);
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
      window.removeEventListener('noteshare:auth-lost', onLost);
    };
  }, []);

  const value: AuthState = {
    user,
    loading,
    login: () => {
      if (IS_EMBEDDED) {
        requestParentLogin();
        return;
      }
      window.location.href = api.loginUrl();
    },
    logout: async () => {
      await api.logout().catch(() => {});
      setUser(null);
      if (IS_EMBEDDED) requestParentLogout();
    },
    refresh: load,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
