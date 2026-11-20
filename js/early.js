// Apply the saved appearance before the first paint, so there's no flash.
// (A separate file rather than inline, so the page also runs inside the browser extension.)
try {
  var s = JSON.parse(localStorage.getItem('wiki-trails.settings')) || {}, h = document.documentElement;
  var dark = (s.theme || 'system') === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches : s.theme === 'dark';
  h.dataset.theme = dark ? 'dark' : 'light';
  if (s.skin && (s.skinPicked || s.skin !== 'plain')) h.dataset.skin = s.skin; // else the default (Desktop 95)
  h.dataset.left = 'closed'; h.dataset.right = 'closed'; // side panels start closed
} catch (e) { /* storage unavailable */ }
