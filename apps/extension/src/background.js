import { ext, setToken } from './browser.js';
import { API_URL } from './config.js';
import { checkAndNotify } from './notify.js';

// --- side panel -----------------------------------------------------------

if (ext.sidePanel) {
  ext.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {});
}
ext.action?.onClicked.addListener(async (tab) => {
  try {
    if (ext.sidePanel?.open) {
      await ext.sidePanel.open(
        tab?.windowId ? { windowId: tab.windowId } : { tabId: tab.id },
      );
      return;
    }
  } catch {
    /* fall through */
  }
  ext.windows?.create({
    url: ext.runtime.getURL('panel.html'),
    type: 'popup',
    width: 440,
    height: 760,
  });
});

// --- panel-open tracking ----------------------------------------------

let panelOpen = false;
ext.runtime.onConnect.addListener((port) => {
  if (port.name !== 'panel') return;
  panelOpen = true;
  port.onDisconnect.addListener(() => {
    panelOpen = false;
  });
});

// --- messages -----------------------------------------------------------

ext.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'login') {
    login().then((r) => {
      if (r.ok) poll();
      sendResponse(r);
    });
    return true;
  }
  if (msg?.type === 'poll') {
    poll().finally(() => sendResponse({ ok: true }));
    return true;
  }
});

// Belt-and-suspenders alongside the panel-side dedup: even if several
// {type:'login'} messages land here together, only one launchWebAuthFlow
// window actually opens — the rest await the same in-flight attempt.
let loginPromise = null;
function login() {
  if (!loginPromise) {
    loginPromise = doLogin().finally(() => {
      loginPromise = null;
    });
  }
  return loginPromise;
}

async function doLogin() {
  try {
    const redirectUri = ext.identity.getRedirectURL();
    console.log('[noteshare] redirect URI:', redirectUri);
    const authUrl = `${API_URL}/api/auth/google?flow=ext&redirect=${encodeURIComponent(
      redirectUri,
    )}`;
    const finalUrl = await ext.identity.launchWebAuthFlow({
      url: authUrl,
      interactive: true,
    });
    console.log('[noteshare] auth flow returned:', finalUrl);
    const m = /[#&?]token=([^&\s]+)/.exec(finalUrl || '');
    if (!m) return { ok: false, error: `sin token: ${finalUrl}` };
    await setToken(decodeURIComponent(m[1]));
    return { ok: true };
  } catch (e) {
    console.warn('[noteshare] login failed:', e);
    return { ok: false, error: e?.message || String(e) };
  }
}

// --- notification polling ----------------------------------------------

const POLL_ALARM = 'noteshare-poll';

const poll = (why) => {
  console.log('[noteshare] poll', why, new Date().toISOString());
  return checkAndNotify(ding);
};

function armPolling() {
  ext.alarms?.create(POLL_ALARM, { periodInMinutes: 1 });
  poll('arm');
}
armPolling();
ext.runtime.onInstalled.addListener(() => armPolling());
ext.runtime.onStartup.addListener(() => armPolling());
ext.alarms?.onAlarm.addListener((a) => {
  if (a.name === POLL_ALARM) poll('alarm');
});
ext.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.token) poll();
});

ext.notifications.onClicked.addListener(async (id) => {
  ext.notifications.clear(id);

  const { navTargets = {} } = await ext.storage.local.get('navTargets');
  const target = navTargets[id] || null;
  if (target) await ext.storage.local.set({ pendingNav: target });

  let win;
  try {
    win = await ext.windows.getLastFocused();
  } catch {
    try {
      win = await ext.windows.getCurrent();
    } catch {
      /* ignore */
    }
  }

  if (panelOpen) {
    // Already docked — the panel's storage listener will navigate. Just bring
    // the browser window forward.
    if (win) ext.windows.update(win.id, { focused: true }).catch(() => {});
    return;
  }

  // Panel closed: try to dock it. Brave sometimes rejects sidePanel.open()
  // outside a toolbar click — then we just leave the badge + pendingNav and
  // the user opens the panel with the icon (it'll jump straight there).
  try {
    if (ext.sidePanel?.open && win) {
      await ext.sidePanel.open({ windowId: win.id });
      if (win) ext.windows.update(win.id, { focused: true }).catch(() => {});
      return;
    }
  } catch (e) {
    console.warn('[noteshare] sidePanel.open from notification blocked', e);
  }
  if (win) ext.windows.update(win.id, { focused: true }).catch(() => {});
});

// A service worker can't play audio → ask a hidden offscreen document to.
async function ding() {
  if (!ext.offscreen) return; // Firefox: OS notification sound
  try {
    if (!(await ext.offscreen.hasDocument?.())) {
      await ext.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Sonido al llegar una notificación de Noteshare',
      });
    }
    ext.runtime.sendMessage({ type: 'noteshare:ding' });
  } catch {
    /* ignore */
  }
}
