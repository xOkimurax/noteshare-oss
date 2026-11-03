import { useEffect, useRef } from 'react';

/**
 * Makes the mobile/browser back button (and the swipe-back gesture) close an
 * in-app view instead of leaving Noteshare — so the app feels like a native
 * screen stack rather than a single web page. One `history.pushState` per
 * open layer (chat thread, info panel, a modal, a lightbox, ...); a single
 * shared `popstate` listener pops the top of our own stack and calls that
 * layer's close callback. Nest freely (e.g. lightbox open on top of a modal
 * on top of a chat thread) — each back press only closes the top-most one.
 *
 * Closing a layer some other way than the back button (an in-app "X" or
 * back-arrow calling the same setter) is kept in sync automatically: on
 * teardown, if this layer is still the live top of the stack (nothing else
 * popped it first), it calls `history.back()` itself so the browser's
 * history doesn't accumulate a phantom entry the user would otherwise have
 * to press back through later without anything visibly happening.
 *
 * The actual pushState is deferred to a macrotask (setTimeout 0) rather than
 * done straight in the effect body. Reason: React StrictMode's dev-only
 * double-invoke synchronously mounts -> cleans up -> re-mounts every effect
 * once, to surface exactly this kind of not-idempotent side effect. Pushing
 * history immediately would have the *synthetic* first cleanup see itself as
 * "still the live top" and call a real `history.back()` for a mount that
 * was never real — corrupting the stack's correspondence with actual
 * browser history before the component ever settles. Deferring means that
 * synthetic pass cancels its own pending push before it ever runs, so it
 * touches neither `stack` nor `history`; only the settled mount's timeout
 * actually fires.
 */

interface StackEntry {
  close: () => void;
}

const stack: StackEntry[] = [];
let listenerInstalled = false;

function ensureListener() {
  if (listenerInstalled) return;
  listenerInstalled = true;
  window.addEventListener('popstate', () => {
    const entry = stack.pop();
    entry?.close();
  });
}

// True only for the top-level browsing context (a normal tab or an installed
// PWA) — false whenever this code runs inside an <iframe>, such as the
// browser extension's side panel embedding the whole SPA. This matters
// because of a real, reproduced timing difference: when a layer's teardown
// calls `history.back()` (see below) at the same time another layer's effect
// schedules a `pushState` via `setTimeout(fn, 0)` — which happens on every
// mobile/narrow-width nav-drawer tap, since `goTo()` in App.tsx flips
// `isNavOpen` false and `activeView` in the same event handler — the
// resulting `popstate` from that `history.back()` reliably arrives at the
// top level *before* the sibling's `setTimeout(0)` macrotask runs, but
// inside an iframe it reliably arrives *after* (an iframe's history
// navigation is coordinated through an extra browser-process round trip,
// while a top-level same-document history change is not). When it arrives
// late, it pops the *new* entry that was just pushed instead of the one that
// was actually closing, calling that new layer's `onClose` and immediately
// reverting it — this was the confirmed cause of the extension side panel
// "can't navigate between sections" bug. A side panel has no physical back
// gesture to intercept anyway, so the whole mechanism is simply skipped
// there rather than made to race-proof itself.
const IS_TOP_LEVEL = typeof window !== 'undefined' && window.self === window.top;

export function useBackable(isOpen: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen || !IS_TOP_LEVEL) return;
    ensureListener();

    let entry: StackEntry | null = null;
    const timer = setTimeout(() => {
      entry = { close: () => onCloseRef.current() };
      stack.push(entry);
      history.pushState({ noteshareBack: stack.length }, '');
    }, 0);

    return () => {
      clearTimeout(timer);
      if (!entry) return; // never actually pushed (see StrictMode note above)

      const idx = stack.indexOf(entry);
      if (idx === -1) {
        // Already removed — a real back-navigation got here first (the
        // popstate listener already popped and closed us).
        return;
      }
      if (idx === stack.length - 1) {
        // Still the live top of the stack: this teardown must be from an
        // in-app close, not the back button. Go back ourselves so the
        // history entry we pushed doesn't linger as a phantom the user
        // would otherwise have to press back through later — but don't
        // touch `stack` here. Let the resulting popstate's own
        // `stack.pop()` remove (and re-close, harmlessly) this exact entry,
        // so removal-from-stack and history-position always change in the
        // same step. Splicing here too would desync them: the popstate
        // that follows would then pop whatever is now on top instead —
        // typically the layer just underneath — closing it by mistake.
        history.back();
      } else {
        // Not on top — some layer opened after this one is still open (an
        // unusual, out-of-order close). Remove just this entry and leave
        // history alone, so we don't pop that still-open layer instead.
        stack.splice(idx, 1);
      }
    };
  }, [isOpen]);
}
