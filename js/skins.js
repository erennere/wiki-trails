// Skins: window chrome lives in css/skins.css ([data-skin=…]); graph colours live here.
export const SKINS = [
  {
    id: 'win95', name: 'Windows 95',
    hub: ['#1d6b36', '#2fd35a', '#a8ff4d', '#ffe14d', '#ffaa00'],
    trails: ['#ffff55', '#55ffff', '#ff55ff', '#ff5555', '#55ff55', '#ffaa00', '#7f7fff', '#ffffff', '#ff9ecf', '#aaff00'],
    boot: ['WIKITRAILS BIOS v2.0  (C) 1996 Hyperlink Systems', '', 'Memory test: 640K OK'],
  },
  {
    id: 'synth', name: "Synthwave '84",
    hub: ['#5a189a', '#9d4edd', '#ff2fd0', '#ff6c11', '#fff200'],
    trails: ['#2de2e6', '#ff2fd0', '#fff200', '#ff6c11', '#00ff9f', '#ff3864', '#b388ff', '#ffffff', '#7df9ff', '#f9c80e'],
    boot: ['NEON//TRAILS  OS 1984', '', 'Charging flux capacitor... 1.21 GW'],
  },
  {
    id: 'gameboy', name: 'Game Boy',
    hub: ['#8bac0f', '#306230', '#0f380f'],
    trails: ['#0f380f', '#8e2a5c', '#2d4fb3', '#9a5b00', '#306230', '#5c2a8e', '#1f6f6f', '#7a1f1f', '#3b3b3b', '#4f6f00'],
    boot: ['Nintendo-ish(R)', '', 'TRAILS.GB  ROM 32KB OK'],
  },
  {
    id: 'mac', name: 'System 7',
    hub: ['#bbbbbb', '#777777', '#000000'],
    trails: ['#dd0806', '#0000d4', '#1fb714', '#f20884', '#ff6403', '#4700a5', '#02abea', '#562c05', '#c9a400', '#90713a'],
    boot: ['Welcome to Wiki Trails.', '', 'Extensions: Hyperlinks, Curiosity, Synapses'],
  },
  {
    id: 'amber', name: 'Amber Terminal',
    hub: ['#5a3a00', '#b37400', '#ffb000', '#ffd27a', '#fff2cc'],
    trails: ['#ffffff', '#ff5f1f', '#ffe066', '#7fff00', '#00e5ff', '#ff4fd8', '#ffb000', '#ff9e80', '#b2ff59', '#80d8ff'],
    boot: ['C:\\> WIKITRLS.COM /AMBER', '', 'HIMEM is testing extended memory... done.'],
  },
];

const KEY = 'wiki-trails.skin';
export const skinById = (id) => SKINS.find((s) => s.id === id) || SKINS[0];
export function savedSkin() { try { return skinById(localStorage.getItem(KEY)); } catch { return SKINS[0]; } }
export function rememberSkin(id) { try { localStorage.setItem(KEY, id); } catch { /* ignore */ } }
