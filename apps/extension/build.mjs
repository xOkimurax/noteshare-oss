// Build the Noteshare extension for Chrome/Edge and Firefox.
//   node build.mjs [--api=<api url>] [--web=<web url>]
// Produces dist/<target>/ (loadable unpacked) and dist/noteshare-<target>-<ver>.zip
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const src = resolve(root, 'src');
const out = resolve(root, 'dist');

// URLs come from the environment (or flags), never hardcoded:
//   EXT_API_URL=https://api.example.com EXT_WEB_URL=https://app.example.com node build.mjs
//   node build.mjs --api=https://api.example.com --web=https://app.example.com
// Defaults target a local dev stack.
const flag = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const strip = (u) => u.replace(/\/$/, '');
const cfg = {
  api: strip(flag('api') || process.env.EXT_API_URL || 'http://localhost:3001'),
  web: strip(flag('web') || process.env.EXT_WEB_URL || 'http://localhost:3000'),
};
for (const [k, v] of Object.entries(cfg)) {
  try {
    new URL(v);
  } catch {
    throw new Error(`invalid ${k} url: ${v}`);
  }
}
const env = `${cfg.api} / ${cfg.web}`;

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const version = pkg.version;

const COMMON = [
  'background.js',
  'browser.js',
  'notify.js',
  'panel.js',
  'panel.html',
  'panel.css',
  'offscreen.html',
  'offscreen.js',
];

rmSync(out, { recursive: true, force: true });

for (const target of ['chrome', 'firefox']) {
  const dir = resolve(out, target);
  mkdirSync(dir, { recursive: true });

  for (const f of COMMON) cpSync(resolve(src, f), resolve(dir, f));
  cpSync(resolve(src, 'icons'), resolve(dir, 'icons'), { recursive: true });

  writeFileSync(
    resolve(dir, 'config.js'),
    `export const API_URL = ${JSON.stringify(cfg.api)};\n` +
      `export const WEB_URL = ${JSON.stringify(cfg.web)};\n`,
  );

  const m = JSON.parse(
    readFileSync(resolve(src, `manifest.${target}.json`), 'utf8'),
  );
  m.version = version;
  m.host_permissions = [`${cfg.api}/*`, `${cfg.web}/*`];
  writeFileSync(resolve(dir, 'manifest.json'), JSON.stringify(m, null, 2));

  const zip = resolve(out, `noteshare-${target}-${version}.zip`);
  execFileSync('zip', ['-r', '-q', zip, '.'], { cwd: dir });
  console.log(`${target}: ${dir}  →  ${zip}`);
}

// Make the Chrome/Edge zip downloadable from the web app's Settings page.
const publicDir = resolve(root, '../web/public');
cpSync(
  resolve(out, `noteshare-chrome-${version}.zip`),
  resolve(publicDir, 'noteshare-extension-chrome.zip'),
);

console.log(`\nurls=${env}  version=${version}`);
