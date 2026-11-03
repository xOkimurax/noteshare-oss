# Noteshare — browser extension

A side panel / sidebar to jot notes into Noteshare without leaving the tab
you're on. Chrome, Edge and Firefox.

**Phase 1 (current):** quick capture — title + body + paste/drop images →
saves straight to Noteshare. Recent-notes list. "Open full Noteshare" button.
Login via the browser's OAuth flow; the API hands back a personal access token
(stored in `storage.local`, Bearer auth — no cookies).

**Phase 2 (planned):** the panel embeds the full Noteshare web app in an
iframe (same design, all features), reusing the Phase 1 token.

## Layout

```
src/
  manifest.chrome.json   MV3 + side_panel (Chrome/Edge)
  manifest.firefox.json  MV3 + sidebar_action + gecko id + update_url
  background.js           service worker — runs the launchWebAuthFlow login
  browser.js             chrome/browser API shim + token helpers
  panel.html / .css / .js the side panel UI
  config.js              API_URL / WEB_URL (overwritten per env by build.mjs)
  icons/                 16/32/48/128 png
build.mjs                → dist/<chrome|firefox>/ + zips, per --env=dev|prod
```

## Build

URLs are never hardcoded; pass your deployment's URLs:

```
EXT_API_URL=https://api.your-domain.com EXT_WEB_URL=https://app.your-domain.com node build.mjs
# or: node build.mjs --api=https://api.your-domain.com --web=https://app.your-domain.com
```

Without arguments it targets `http://localhost:3001` / `http://localhost:3000`.
Outputs `dist/chrome/`, `dist/firefox/` (loadable unpacked) and
`dist/noteshare-<target>-<version>.zip`; the Chrome zip is also copied to
`../web/public/noteshare-extension-chrome.zip`.

## Load for testing (unpacked)

- **Chrome/Edge:** `chrome://extensions` → Developer mode → *Load unpacked* →
  pick `dist/chrome`. Click the toolbar icon to open the side panel.
- **Firefox:** `about:debugging#/runtime/this-firefox` → *Load Temporary
  Add-on* → pick `dist/firefox/manifest.json`.

## Distribution

Self-host the zip, or publish to the Chrome Web Store / AMO. For Firefox,
replace the placeholder gecko `id` in `src/manifest.firefox.json` with your own
and add an `update_url` if you self-distribute signed builds.
