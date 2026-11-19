// Adds a version to the page's own files (js/app.js?v=…), so browsers fetch the new ones as soon as
// the site changes instead of using a cached copy for a while. Runs after every build.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const page = join(root, 'index.html');
let html = readFileSync(page, 'utf8');
for (const f of ['css/style.css', 'css/skins.css', 'js/early.js', 'vendor/d3.min.js', 'js/app.js']) {
  const v = createHash('sha256').update(readFileSync(join(root, f))).digest('hex').slice(0, 10);
  const esc = f.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  html = html.replace(new RegExp(`(["'])${esc}(\\?v=[0-9a-f]*)?\\1`, 'g'), `$1${f}?v=${v}$1`);
}
writeFileSync(page, html);
