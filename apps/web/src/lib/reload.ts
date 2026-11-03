/**
 * Recover from stale-asset errors after a deploy.
 *
 * When a new version ships, the running page still references the old
 * content-hashed chunk filenames. The next dynamic import (jspdf / docx /
 * xlsx / html2canvas) then 404s. Instead of showing an error, reload once —
 * guarded so a genuinely broken build can't loop.
 */
const KEY = 'ns:last-recovery-reload';
const COOLDOWN_MS = 20_000;

export function reloadForNewVersion(): void {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < COOLDOWN_MS) return; // already tried very recently
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
  window.location.reload();
}

const CHUNK_ERROR =
  /Loading chunk|dynamically imported module|Failed to fetch dynamically|ChunkLoadError|Importing a module script failed|error loading dynamically imported module/i;

export function isStaleAssetError(err: unknown): boolean {
  const msg =
    err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return CHUNK_ERROR.test(msg);
}

export function installVersionRecovery(): void {
  window.addEventListener('vite:preloadError', (e) => {
    e.preventDefault();
    reloadForNewVersion();
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (isStaleAssetError(e.reason)) reloadForNewVersion();
  });
}
