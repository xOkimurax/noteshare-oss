import { ext, getToken, clearToken } from './browser.js';
import { WEB_URL } from './config.js';
import { checkAndNotify } from './notify.js';

const APP_ORIGIN = new URL(WEB_URL).origin;
const iframe = document.getElementById('app');

// Let the background know the panel is open (port drops when it closes).
try {
  ext.runtime.connect({ name: 'panel' });
} catch {
  /* ignore */
}

function reply(msg) {
  iframe.contentWindow?.postMessage(msg, APP_ORIGIN);
}

// A short chime, synthesised — the panel is a real page so it can play audio
// directly (the service worker can't).
function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    for (const [f, at] of [
      [880, 0],
      [1174.66, 0.08],
    ]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      o.connect(g).connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, now + at);
      g.gain.exponentialRampToValueAtTime(0.22, now + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.32);
      o.start(now + at);
      o.stop(now + at + 0.36);
    }
    setTimeout(() => ctx.close(), 800);
  } catch {
    /* ignore */
  }
}

// The embedded app owns the whole UI; the panel brokers auth + notifications.
window.addEventListener('message', async (e) => {
  if (e.origin !== APP_ORIGIN) return;
  const d = e.data;
  if (!d || typeof d !== 'object') return;

  switch (d.type) {
    case 'noteshare:need-token':
      reply({ type: 'noteshare:token', token: (await getToken()) || null });
      break;
    case 'noteshare:login': {
      const r = await ext.runtime.sendMessage({ type: 'login' });
      reply({ type: 'noteshare:token', token: r?.ok ? await getToken() : null });
      break;
    }
    case 'noteshare:logout':
      await clearToken();
      reply({ type: 'noteshare:token', token: null });
      break;
    case 'noteshare:notify':
      checkAndNotify(chime);
      break;
    case 'noteshare:ready':
      flushPendingNav();
      break;
  }
});

iframe.src = `${WEB_URL}/?embedded=1`;

// While the panel is open it's a more reliable place to poll than the worker.
checkAndNotify(chime);
setInterval(() => checkAndNotify(chime), 30000);

// A clicked notification leaves a target in storage — forward it to the app
// so it opens that note / conversation.
async function flushPendingNav() {
  const { pendingNav } = await ext.storage.local.get('pendingNav');
  if (!pendingNav) return;
  await ext.storage.local.remove('pendingNav');
  reply({ type: 'noteshare:open', target: pendingNav });
}
iframe.addEventListener('load', () => {
  // give the app a beat to attach its listener
  setTimeout(flushPendingNav, 400);
});
ext.storage.onChanged.addListener((c, area) => {
  if (area === 'local' && c.pendingNav?.newValue) flushPendingNav();
});
