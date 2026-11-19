// Turns your history repository (one file per month, see src/sync-core.js) into one file the site can
// show to visitors: data/trails.json. Used by .github/workflows/pages.yml; you can also run it yourself:
//   node scripts/publish_history.mjs path/to/wiki-trails-data data/trails.json "Your name"
// Deleted trails are left out, and so is what only syncing needs (when a trail was edited, removed pages).
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { validate } from '../src/model.js';

const [dir, out = 'data/trails.json', owner = ''] = process.argv.slice(2);
if (!dir || !existsSync(join(dir, 'trails'))) { console.log(`No trails/ folder in ${dir}: nothing to publish.`); process.exit(0); }
const byId = new Map();
for (const f of readdirSync(join(dir, 'trails')).filter((n) => /^\d{4}-\d{2}\.json$/.test(n)).sort()) {
  let doc; try { doc = JSON.parse(readFileSync(join(dir, 'trails', f), 'utf8')); } catch { console.warn(`Skipping ${f}: not valid JSON`); continue; }
  for (const t of doc.trails || []) if (t?.id) byId.set(t.id, t);
}
const live = [...byId.values()].filter((t) => !t.deleted);
const state = validate({ trails: live });
for (const t of state.trails) { delete t.updated; delete t.removed; }
state.trails.sort((a, b) => (Date.parse(a.created) || 0) - (Date.parse(b.created) || 0));
// the language most pages were read in, for links
const langs = new Map();
for (const t of state.trails) for (const v of t.visits) if (v.lang) langs.set(v.lang, (langs.get(v.lang) || 0) + 1);
const lang = [...langs].sort((a, b) => b[1] - a[1])[0]?.[0] || 'en';
const pages = state.trails.reduce((n, t) => n + t.visits.length, 0);
writeFileSync(out, JSON.stringify({ app: 'wiki-trails', version: 2, owner, lang, trails: state.trails }) + '\n');
console.log(`Published ${state.trails.length} trails, ${pages} pages, to ${out}`);
