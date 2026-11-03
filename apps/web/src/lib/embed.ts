/**
 * "Embedded" mode: the app runs inside the browser-extension side panel (an
 * <iframe>). There it can't use cookie auth (cross-site iframe cookie
 * partitioning) or the Google redirect flow (Google blocks OAuth in frames),
 * so the extension shell owns login and hands us a personal access token over
 * postMessage; we do Bearer auth against the API with it.
 */
const params = new URLSearchParams(window.location.search);

export const IS_EMBEDDED =
  params.has('embedded') || window.self !== window.top;

const STORAGE_KEY = 'noteshare:embed-token';

let token: string | null = (() => {
  if (!IS_EMBEDDED) return null;
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
})();

export function embedToken(): string | null {
  return IS_EMBEDDED ? token : null;
}

export function setEmbedToken(t: string | null): void {
  token = t;
  try {
    if (t) sessionStorage.setItem(STORAGE_KEY, t);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// Every failed request in embedded mode calls requestParentLogin() — with
// half a dozen queries firing on boot, an expired/missing token means half a
// dozen simultaneous calls. Without this guard each one pops its own Google
// auth window. One flow at a time, and don't hammer it if the user just
// closed the popup without finishing.
let loginInFlight = false;
let lastLoginAttempt = 0;
const LOGIN_COOLDOWN_MS = 15_000;

/** Ask the extension shell to run the Google login flow (deduped). */
export function requestParentLogin(): void {
  if (loginInFlight || Date.now() - lastLoginAttempt < LOGIN_COOLDOWN_MS) return;
  loginInFlight = true;
  lastLoginAttempt = Date.now();
  window.parent?.postMessage({ type: 'noteshare:login' }, '*');
}

/** Ask the extension shell to drop the stored token. */
export function requestParentLogout(): void {
  window.parent?.postMessage({ type: 'noteshare:logout' }, '*');
}

// The shell pushes the current token on request, and again after a login /
// logout — either way, the requested flow (if any) is done.
window.addEventListener('message', (e) => {
  const d = e.data as { type?: string; token?: string | null } | null;
  if (!d || d.type !== 'noteshare:token') return;
  loginInFlight = false;
  const next = typeof d.token === 'string' ? d.token : null;
  if (next === token) return;
  setEmbedToken(next);
  if (booted) window.location.reload();
});

let booted = false;

/** main.tsx calls this right after the first render. */
export function markEmbedBooted(): void {
  booted = true;
  if (IS_EMBEDDED) window.parent?.postMessage({ type: 'noteshare:ready' }, '*');
}

/**
 * Called once before the app renders. In embedded mode, if we don't have a
 * token yet, ask the shell for one and wait briefly for it so the app doesn't
 * flash its login screen.
 */
export function awaitEmbedReady(): Promise<void> {
  if (!IS_EMBEDDED || token) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      window.removeEventListener('message', onMsg);
      resolve();
    };
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string } | null;
      if (d?.type === 'noteshare:token') done();
    };
    window.addEventListener('message', onMsg);
    window.parent?.postMessage({ type: 'noteshare:need-token' }, '*');
    setTimeout(done, 2000);
  });
}
