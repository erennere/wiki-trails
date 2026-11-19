// Appearance: the skin (Desktop 95 by default) and light/dark, which follows the system unless set in Settings.
import { app, emit, setSetting } from './app.js';
import { skinById } from './skins.js';

let graph = null, fx = null;
const darkQuery = matchMedia('(prefers-color-scheme: dark)');

export function resolvedTheme() {
  const t = app.settings.theme;
  return t === 'system' ? (darkQuery.matches ? 'dark' : 'light') : t;
}

export function initAppearance(g, f) {
  graph = g; fx = f;
  darkQuery.addEventListener('change', () => { if (app.settings.theme === 'system') applySkin(app.settings.skin, { persist: false }); });
  applySkin(app.settings.skin, { persist: false });
}

export function applySkin(id, { persist = true } = {}) {
  const skin = skinById(id);
  app.skin = skin;
  const html = document.documentElement;
  html.dataset.skin = skin.id;
  html.dataset.chrome = skin.chrome || 'bevel';
  html.dataset.theme = resolvedTheme();
  const pal = skin.dark && html.dataset.theme === 'dark' ? { ...skin, ...skin.dark } : skin;
  app.colors = pal.trails.slice();
  graph?.setPalette(pal);
  fx?.set(skin.fx);
  if (persist) { app.settings.skinPicked = true; setSetting('skin', skin.id); }
  emit('skin');
}

export function setTheme(theme) { setSetting('theme', theme); applySkin(app.settings.skin, { persist: false }); }
