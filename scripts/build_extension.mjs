// Builds the browser extension into dist/extension (and dist/wiki-trails-extension.zip).
// The recorder is bundled with the sync code it shares with the app (src/sync-core.js).
// The site's address comes from "homepage" in package.json: the toolbar button opens it, and the
// extension talks to the app only there. Run `npm run build:extension`, then load dist/extension in
// Edge or Chrome, or package it for Safari with scripts/package_safari.sh on a Mac.
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist', 'extension');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const f of ['page.js', 'appbridge.js', 'popup.html', 'popup.css', 'popup.js', 'icons']) cpSync(join(root, 'extension', f), join(out, f), { recursive: true });
await build({ entryPoints: [join(root, 'extension', 'recorder.js')], bundle: true, format: 'iife', target: 'es2020', outfile: join(out, 'recorder.js'), legalComments: 'none' });

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const man = JSON.parse(readFileSync(join(root, 'extension', 'manifest.json'), 'utf8'));
man.version = pkg.version || man.version;
const site = process.env.WIKI_TRAILS_SITE || pkg.homepage;
if (site) {
  const url = site.endsWith('/') ? site : site + '/';
  man.homepage_url = url;
  for (const cs of man.content_scripts) if (cs.js.includes('appbridge.js')) cs.matches = [url + '*'];
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify(man, null, 2) + '\n');

const zip = join(root, 'dist', 'wiki-trails-extension.zip');
rmSync(zip, { force: true });
try {
  execFileSync('zip', ['-qr', zip, '.'], { cwd: out });
  console.log(`Built ${out} and ${zip} (site: ${man.homepage_url})`);
} catch {
  console.log(`Built ${out} (no zip tool found; zip the folder yourself if you need a file)`);
}
if (!existsSync(join(out, 'recorder.js'))) process.exitCode = 1;
