import React from 'react';
import { formatDistanceToNow, type Locale } from 'date-fns';
import { de, enUS, es, fr, it, ja, pt, zhCN } from 'date-fns/locale';
import { saveAs } from 'file-saver';
import { URL_REGEX } from '@noteshare/shared';
import i18n from './i18n';

/**
 * Download an image by URL. `saveAs(url)` alone doesn't force a download for
 * cross-origin URLs (the API is on another subdomain) — the browser just
 * opens it. Fetching the blob first works because /uploads is CORS-enabled.
 */
export async function downloadImage(url: string, name = 'imagen.webp'): Promise<void> {
  try {
    const res = await fetch(url, { mode: 'cors' });
    const blob = await res.blob();
    saveAs(blob, name);
  } catch {
    // last resort — open in a new tab so the user can save manually
    window.open(url, '_blank', 'noopener');
  }
}

// Matches the language codes offered in the app's language picker (App.tsx /
// Settings.tsx). i18next only carries UI-string translations for those, but
// date-fns' relative-time wording ("5 days ago") is separate from that and
// defaults to English unless told otherwise — this maps the same codes to
// their date-fns locale.
const DATE_FNS_LOCALES: Record<string, Locale> = {
  es,
  en: enUS,
  fr,
  de,
  it,
  pt,
  zh: zhCN,
  ja,
};

/** Relative time that never throws on a bad/absent date. */
export const timeAgo = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    const locale = DATE_FNS_LOCALES[i18n.language] ?? es;
    return formatDistanceToNow(d, { addSuffix: true, locale });
  } catch {
    return '';
  }
};

export const renderWithLinks = (
  text: string,
  linkClassName = 'text-emerald-600 hover:underline',
) => {
  if (!text) return text;
  return text.split(URL_REGEX).map((part, i) => {
    if (part.match(URL_REGEX)) {
      const href = /^https?:\/\//i.test(part) ? part : `https://${part}`;
      return (
        <a
          key={i}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={linkClassName}
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </a>
      );
    }
    return part;
  });
};
