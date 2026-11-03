/**
 * When an image upload fails without the server ever responding — `fetch()`
 * itself throws, which is exactly what happens when a browser extension or a
 * DNS-level content filter intercepts the request before it leaves the
 * browser — the raw error that bubbles up is a browser-specific, useless
 * string like "Failed to fetch". This turns that into something the user can
 * actually act on, without assuming any particular cause: a follow-up probe
 * against a tiny unauthenticated endpoint tells apart "nothing is reachable"
 * (a real connectivity problem) from "the server answered fine, so something
 * is selectively blocking just this upload" (an extension, filtered DNS, or
 * anything else in that class — we can't know which, so we don't guess).
 */
import { ApiError, API_URL } from '../api';

const BLOCKED_MSG =
  'No se pudo subir la imagen. Nos conectamos al servidor sin problema, así que algo ' +
  'en tu navegador o tu red está bloqueando específicamente esta subida — puede ser ' +
  'una extensión (bloqueadores de anuncios o de privacidad, por ejemplo) o un DNS con ' +
  'filtrado de contenido (por ejemplo AdGuard). Desactivá lo que sospeches que puede ' +
  'estar interfiriendo y volvé a intentar.';

const NO_CONNECTION_MSG =
  'Parece que no tenés conexión con el servidor en este momento. Revisá tu conexión ' +
  'a internet e intentá de nuevo.';

export async function describeUploadFailure(err: unknown): Promise<string> {
  // The server responded (even with an error status) — a real API error,
  // not a blocked request. Leave its own message as-is.
  if (err instanceof ApiError) return err.message;

  try {
    await fetch(`${API_URL}/api/health`);
    // The probe got through: general connectivity is fine, so the upload
    // request specifically was blocked before it left the browser.
    return BLOCKED_MSG;
  } catch {
    // Nothing is reachable right now — a general connectivity issue, not
    // something singling out uploads.
    return NO_CONNECTION_MSG;
  }
}
