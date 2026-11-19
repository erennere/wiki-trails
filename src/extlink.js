// The Wiki Trails browser extension, when it's installed in this browser. Its small script on this
// page (extension/appbridge.js) passes messages both ways:
//   extension -> page: { wikiTrailsExt: 'status', status }   recording on/off, pages today, its sync state
//                      { wikiTrailsExt: 'pushed' }           it just sent pages to GitHub
//                      { wikiTrailsExt: 'connected', result } the answer to 'connect'
//   page -> extension: { wikiTrailsPage: 'hello' | 'connect' | 'recording' }
import { emit } from './app.js';

export const ext = { present: false, status: null };

const send = (m) => window.postMessage({ wikiTrailsPage: m.type, ...m }, location.origin);

window.addEventListener('message', (e) => {
  if (e.source !== window || e.origin !== location.origin) return;
  const d = e.data;
  if (!d || typeof d.wikiTrailsExt !== 'string') return;
  ext.present = true;
  if (d.wikiTrailsExt === 'status' && d.status) { ext.status = d.status; emit('ext', ext.status); }
  else if (d.wikiTrailsExt === 'pushed') emit('ext-pushed');
  else if (d.wikiTrailsExt === 'connected') emit('ext-connected', d.result || {});
});

export function helloExtension() { send({ type: 'hello' }); }
/** Give the extension the same GitHub repository and token, so it sends what it records there. */
export function connectExtension(repo, token) { send({ type: 'connect', repo, token }); }
export function setRecording(on) { send({ type: 'recording', on: !!on }); }
