// Builds the browser extension into dist/extension (and dist/wiki-trails-extension.zip):
// the recorder (extension/) plus a copy of Wiki Trails itself in app/.
// Run `npm run build:extension`, then load dist/extension in Edge, or package it for Safari
// with scripts/package_safari.sh on a Mac.
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist', 'extension');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'app'), { recursive: true });

for (const f of ['manifest.json', 'recorder.js', 'page.js', 'popup.html', 'popup.css', 'popup.js', 'icons']) cpSync(join(root, 'extension', f), join(out, f), { recursive: true });
for (const f of ['index.html', 'css', 'vendor', 'LICENSE']) cpSync(join(root, f), join(out, 'app', f), { recursive: true });
mkdirSync(join(out, 'app', 'js'), { recursive: true });
for (const f of ['app.js', 'early.js', 'THIRD-PARTY-LICENSES.txt']) cpSync(join(root, 'js', f), join(out, 'app', 'js', f));
mkdirSync(join(out, 'app', 'data'), { recursive: true });
for (const f of ['wikispeedia-1000.js', 'wikispeedia-2years.js']) cpSync(join(root, 'data', f), join(out, 'app', 'data', f));

// keep the extension's version in step with package.json
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const man = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
man.version = pkg.version || man.version;
writeFileSync(join(out, 'manifest.json'), JSON.stringify(man, null, 2) + '\n');

const zip = join(root, 'dist', 'wiki-trails-extension.zip');
rmSync(zip, { force: true });
try {
  execFileSync('zip', ['-qr', zip, '.'], { cwd: out });
  console.log(`Built ${out} and ${zip}`);
} catch {
  console.log(`Built ${out} (no zip tool found; zip the folder yourself if you need a file)`);
}
if (!existsSync(join(out, 'app', 'js', 'app.js'))) process.exitCode = 1;
