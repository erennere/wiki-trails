// Copies sql.js into vendor/ for reading the Wikipedia app's export. It's only loaded when you open one.
// The WebAssembly part ships as a script so it also loads when index.html is opened from disk.
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
const dist = 'node_modules/sql.js/dist/';
copyFileSync(dist + 'sql-wasm.js', 'vendor/sql-wasm.js');
copyFileSync('node_modules/sql.js/LICENSE', 'vendor/sql-wasm.LICENSE');
const b64 = readFileSync(dist + 'sql-wasm.wasm').toString('base64');
writeFileSync('vendor/sql-wasm-binary.js', `window.__wikiTrailsSqlWasm="${b64}";\n`);
console.log('vendor/sql-wasm.js, vendor/sql-wasm-binary.js written');
