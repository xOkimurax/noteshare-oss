import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App.tsx';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import PublicNoteView from './components/PublicNoteView.tsx';
import { AuthProvider } from './auth.tsx';
import { queryClient } from './query.ts';
import { installVersionRecovery } from './lib/reload.ts';
import { awaitEmbedReady, markEmbedBooted } from './lib/embed.ts';
import './index.css';
import './i18n';

installVersionRecovery();

// Without this, dropping a file anywhere outside an app drop zone (a stray
// pixel off target, the sidebar, a gap between elements) makes the browser
// navigate the whole tab to that file, blowing away all app state.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

// A public note link must render without ever touching the authenticated app
// shell — no login screen flash, no auth requirement. `p` is the current
// short-slug format (?p=<publicSlug>); `public` is kept for links shared
// before that feature existed (?public=<memoId>).
const params = new URLSearchParams(window.location.search);
const publicSlug = params.get('p');
const publicMemoId = params.get('public');

void awaitEmbedReady().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        {publicSlug || publicMemoId ? (
          <PublicNoteView
            slug={publicSlug || undefined}
            memoId={publicMemoId || undefined}
          />
        ) : (
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <App />
            </AuthProvider>
          </QueryClientProvider>
        )}
      </ErrorBoundary>
    </StrictMode>,
  );
  markEmbedBooted();
});
