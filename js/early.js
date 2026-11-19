// Apply the saved appearance before the first paint, so there's no flash.
// (A separate file rather than inline, so the page also runs inside the browser extension.)
try {
  var s = JSON.parse(localStorage.getItem('wiki-trails.settings')) || {}, h = document.documentElement;
  var dark = (s.theme || 'system') === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches : s.theme === 'dark';
  h.dataset.theme = dark ? 'dark' : 'light';
  if (s.skin) h.dataset.skin = s.skin;
  if (s.left === false) h.dataset.left = 'closed';
  if (s.right === false) h.dataset.right = 'closed';
} catch (e) { /* storage unavailable */ }
