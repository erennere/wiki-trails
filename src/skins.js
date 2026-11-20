// Skin definitions. Window chrome + colours of the UI live in css/skins.css;
// this file holds what the graph and the app logic need.
//
// Fields: id, name, cat, blurb, chrome (bevel|flat|neon|terminal|console|gloss|onebit),
//   hub[] (node colours, rarely → often visited), trails[] (trail colours), dark{hub, trails} (Plain only),
//   shape (square|circle|diamond|tri|hex|star|spark), hollow, glow (strong links glow),
//   edge (plain|dotted|blocks|pulse), bend (curve amount), labelSize, walker,
//   fx {type, c1, c2, c3} (none|stars|nebula|rain|radar|grid|bubbles|sparkles|dust|matrix|scan|vhs|clouds), sound {wave, f}

const VGA = ['#ffff55', '#55ffff', '#ff55ff', '#ff5555', '#55ff55', '#ffaa00', '#7f7fff', '#ffffff', '#ff9ecf', '#aaff00'];

export const CATS = [
  ['plain', 'Plain'], ['retro', 'Retro computing'], ['future', 'Futuristic'], ['synth', 'Synthwave'], ['minimal', 'Minimal'],
];

export const SKINS = [
  { id: 'plain', name: 'Plain', cat: 'plain', blurb: 'Clean and quiet. Follows your light or dark setting.', chrome: 'flat',
    hub: ['#d3d8e0', '#a3adbd', '#6b778b', '#38404d'], trails: ['#2f6fdb', '#e07a2f', '#2a9d8f', '#d1495b', '#8e6cc9', '#c79a1c', '#3d8b40', '#d4628f', '#5d6b7a', '#b5651d'],
    dark: { hub: ['#3b404a', '#5d6576', '#8f99ab', '#d9dee7'], trails: ['#7aa2f7', '#f0a35e', '#4fd1c5', '#f2777a', '#b794f6', '#ecc94b', '#68d391', '#f687b3', '#a0aec0', '#ed8936'] },
    shape: 'circle', glow: false, bend: 0.12, labelSize: 12.5, sound: { wave: 'sine', f: 880 } },
  // ---------------- retro computing ----------------
  { id: 'desktop95', name: 'Desktop 95', cat: 'retro', blurb: 'Beveled windows and a green phosphor CRT.', chrome: 'bevel',
    hub: ['#1d6b36', '#2fd35a', '#a8ff4d', '#ffe14d', '#ffaa00'], trails: VGA, shape: 'square',
    sound: { wave: 'square', f: 880 } },
  { id: 'amber', name: 'Amber Terminal', cat: 'retro', blurb: 'A DOS box in warm amber with double-line borders.', chrome: 'terminal',
    hub: ['#5a3a00', '#b37400', '#ffb000', '#ffd27a', '#fff2cc'], trails: ['#ffffff', '#ff5f1f', '#ffe066', '#7fff00', '#00e5ff', '#ff4fd8', '#ffb000', '#ff9e80', '#b2ff59', '#80d8ff'],
    shape: 'square', sound: { wave: 'square', f: 440 } },
  // ---------------- futuristic ----------------
  { id: 'starchart', name: 'Star Chart', cat: 'future', blurb: 'Articles are stars, trails are constellations.', chrome: 'flat',
    hub: ['#6a7fdb', '#a9c1ff', '#ffffff', '#ffe7a3'], trails: ['#ffe7a3', '#8fd3ff', '#ff9fd2', '#a7ffb5', '#c3a6ff', '#ffb38a', '#ffffff', '#7fe0ff', '#fff59d', '#ff8a8a'],
    shape: 'star', bend: 0, fx: { type: 'nebula', c1: '#7b5cff', c2: '#2d9bff', c3: '#ff5cc8' },
    sound: { wave: 'sine', f: 784 } },
  // ---------------- synthwave ----------------
  { id: 'neonrain', name: 'Neon Rain', cat: 'synth', blurb: 'Cyberpunk hazard tape, glitchy titles and neon rain.', chrome: 'neon',
    hub: ['#ff003c', '#ff6b00', '#fcee0a', '#00f0ff'], trails: ['#fcee0a', '#00f0ff', '#ff003c', '#ff6bff', '#00ff9c', '#ff9a00', '#ffffff', '#9a7bff', '#5cffe9', '#ffd000'],
    shape: 'diamond', fx: { type: 'rain', c1: '#00f0ff', c2: '#ff003c' },
    sound: { wave: 'sawtooth', f: 880 } },

  // ---------------- minimal ----------------
  { id: 'swiss', name: 'Swiss Paper', cat: 'minimal', blurb: 'White paper, black rules, one red accent. Straight lines only.', chrome: 'flat',
    hub: ['#bbbbbb', '#555555', '#111111', '#e30613'], trails: ['#e30613', '#111111', '#0057b8', '#f2a900', '#00875a', '#7a3e9d', '#d9480f', '#495057', '#0b7285', '#5c940d'],
    shape: 'circle', glow: false, bend: 0, labelSize: 12,
    sound: { wave: 'sine', f: 880 } },
  { id: 'midnight', name: 'Midnight Mono', cat: 'minimal', blurb: 'Quiet dark mode: thin lines, soft greys, no noise.', chrome: 'flat',
    hub: ['#3f3f46', '#71717a', '#d4d4d8', '#ffffff'], trails: ['#9b8afb', '#5eead4', '#fda4af', '#fcd34d', '#93c5fd', '#c4b5fd', '#86efac', '#fdba74', '#f9a8d4', '#a5b4fc'],
    shape: 'circle', glow: false, bend: 0.1, labelSize: 12,
    sound: { wave: 'sine', f: 660 } },
];

// a look that no longer exists falls back to the default
export const skinById = (id) => SKINS.find((s) => s.id === id) || SKINS.find((s) => s.id === 'desktop95');
