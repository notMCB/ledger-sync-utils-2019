// Cosmetics: gun finishes and outfits, their rarities, and the materials
// and textures that draw them. Everything is generated here — no image files.

import * as THREE from 'three';

export const RARITIES = [
  { id: 'common', name: 'Common', color: '#b9b3a6', weight: 55 },
  { id: 'uncommon', name: 'Uncommon', color: '#62b35d', weight: 25 },
  { id: 'rare', name: 'Rare', color: '#4a8fe0', weight: 13 },
  { id: 'epic', name: 'Epic', color: '#a860e6', weight: 5.5 },
  { id: 'legendary', name: 'Legendary', color: '#f0b43c', weight: 1.5 },
];
export const RARITY = Object.fromEntries(RARITIES.map((r) => [r.id, r]));

export const GUN_IDS = ['smg', 'lmg', 'shotgun', 'sniper', 'pistol', 'knife', 'heavy', 'revolver', 'flamer', 'pdw', 'carbine'];

// Gun finishes. Each colours three roles: body (receiver, barrel), dark
// (small parts, magazine) and furn (grip, stock, handguard).
export const FINISHES = [
  { id: 'sandblast', name: 'Sandblast', rarity: 'common', body: '#b39a74', dark: '#6f5f48', furn: '#8c7657', rough: 0.9, metal: 0.1 },
  { id: 'olive', name: 'Olive Drab', rarity: 'common', body: '#5d6340', dark: '#3b3f2a', furn: '#4c5234', rough: 0.85, metal: 0.1 },
  { id: 'slate', name: 'Slate', rarity: 'common', body: '#6c7580', dark: '#454b52', furn: '#555c64', rough: 0.7, metal: 0.3 },
  { id: 'rust', name: 'Rust Bucket', rarity: 'common', body: '#8a5236', dark: '#4d3024', furn: '#6b4331', rough: 0.95, metal: 0.2, pattern: 'rust' },
  { id: 'desertcamo', name: 'Desert Camo', rarity: 'uncommon', pattern: 'camo', colors: ['#d8bd8a', '#a8844f', '#7a5f3c', '#e8d5ad'], dark: '#5a4a35' },
  { id: 'urbancamo', name: 'Urban Camo', rarity: 'uncommon', pattern: 'camo', colors: ['#9aa0a6', '#5f656b', '#2f3338', '#c9cdd1'], dark: '#2a2d31' },
  { id: 'tealtwo', name: 'Souk Teal', rarity: 'uncommon', body: '#2f8f8a', dark: '#1d2b2e', furn: '#e8dcc6', rough: 0.55, metal: 0.25 },
  { id: 'brick', name: 'Brick & Bone', rarity: 'uncommon', body: '#a1402f', dark: '#3a2622', furn: '#d9c6a5', rough: 0.6, metal: 0.2 },
  { id: 'zellige', name: 'Zellige', rarity: 'rare', pattern: 'zellige', colors: ['#f1e9d8', '#2f8f8a', '#1f5d66', '#c9a13b'], dark: '#1d2b2e' },
  { id: 'tiger', name: 'Tiger Stripe', rarity: 'rare', pattern: 'tiger', colors: ['#e0892e', '#1b1612'], dark: '#1b1612' },
  { id: 'carbon', name: 'Carbon Weave', rarity: 'rare', pattern: 'carbon', colors: ['#2a2c30', '#17181b'], dark: '#101113', metal: 0.4, rough: 0.35 },
  { id: 'digital', name: 'Pixel Dunes', rarity: 'rare', pattern: 'digital', colors: ['#d2b27e', '#a38457', '#6e5a3e', '#e6d3a8'], dark: '#4d3f2c' },
  { id: 'damascus', name: 'Damascus', rarity: 'epic', pattern: 'damascus', colors: ['#8d949c', '#3b4046'], dark: '#2a2e33', metal: 0.8, rough: 0.3, furn: '#3a2a20' },
  { id: 'neon', name: 'Midnight Neon', rarity: 'epic', body: '#16181f', dark: '#0d0e12', furn: '#1d2029', glow: '#27e6ff', anim: 'pulse' },
  { id: 'crimsonweb', name: 'Crimson Web', rarity: 'epic', pattern: 'web', colors: ['#141214', '#d0302a'], dark: '#0e0c0d', glow: '#d0302a' },
  { id: 'gilded', name: 'Gilded', rarity: 'legendary', body: '#d8ac3f', dark: '#8a6a22', furn: '#2b2320', metal: 0.9, rough: 0.22 },
  { id: 'mirage', name: 'Mirage', rarity: 'legendary', pattern: 'mirage', colors: ['#ff7a3c', '#ffd24a', '#3fd0c9', '#7a5cff'], dark: '#1b1d24', anim: 'hue' },
  // Bazaar Case — the bright stuff
  { id: 'bubblegum', name: 'Bubblegum', rarity: 'uncommon', crate: 'bazaar', body: '#ff8fc8', dark: '#7a3b8f', furn: '#9fe3ff', rough: 0.45, metal: 0.1 },
  { id: 'limesorbet', name: 'Lime Sorbet', rarity: 'uncommon', crate: 'bazaar', body: '#b8f25a', dark: '#2f6b3a', furn: '#fff3a8', rough: 0.5, metal: 0.1 },
  { id: 'polkapop', name: 'Polka Pop', rarity: 'uncommon', crate: 'bazaar', pattern: 'dots', colors: ['#ffd23f', '#ff4f79', '#3fc1ff'], dark: '#26304a' },
  { id: 'toyblocks', name: 'Toy Blocks', rarity: 'rare', crate: 'bazaar', pattern: 'blocks', colors: ['#e63946', '#ffd23f', '#1d7cf2', '#2ec27e'], dark: '#1c1c1c' },
  { id: 'sunsetfade', name: 'Sunset Fade', rarity: 'rare', crate: 'bazaar', pattern: 'gradient', colors: ['#ff5e62', '#ff9966', '#ffd86f', '#8e54e9'], dark: '#2b1d3a', rough: 0.35, metal: 0.3 },
  { id: 'oceanwave', name: 'Ocean Wave', rarity: 'rare', crate: 'bazaar', pattern: 'waves', colors: ['#0fb9b1', '#1b6ca8', '#9ff3ec'], dark: '#0b2e4a' },
  { id: 'graffiti', name: 'Graffiti', rarity: 'epic', crate: 'bazaar', pattern: 'splat', colors: ['#1b1b22', '#ff3cac', '#2bd2ff', '#fbe44b', '#6bff5c'], dark: '#111114' },
  { id: 'galaxy', name: 'Galaxy', rarity: 'epic', crate: 'bazaar', pattern: 'galaxy', colors: ['#0b0620', '#5b2a9e', '#ff4fd8', '#3fd0ff'], dark: '#07041a', anim: 'hue' },
  { id: 'holofoil', name: 'Holo Foil', rarity: 'legendary', crate: 'bazaar', pattern: 'gradient', colors: ['#ff4f79', '#ffd23f', '#2ec27e', '#3fc1ff', '#b061ff', '#ff4f79'], dark: '#20222b', metal: 0.7, rough: 0.2, anim: 'hue' },
  { id: 'lavalamp', name: 'Lava Lamp', rarity: 'legendary', crate: 'bazaar', pattern: 'camo', colors: ['#ff2d55', '#ff5a1f', '#ffb03a', '#ffd166'], dark: '#2a0f14', glow: '#ff5a1f', anim: 'hue' },
  // Blade Crate — knife finishes only
  { id: 'polishedsteel', name: 'Polished Steel', rarity: 'common', crate: 'blade', body: '#b9c0c8', dark: '#6b7179', furn: '#3a2f26', rough: 0.3, metal: 0.8 },
  { id: 'ebony', name: 'Ebony & Silver', rarity: 'common', crate: 'blade', body: '#cdd3d9', dark: '#17151a', furn: '#17151a', rough: 0.35, metal: 0.7 },
  { id: 'camelbone', name: 'Camel Bone', rarity: 'uncommon', crate: 'blade', body: '#ded3b4', dark: '#8a7a55', furn: '#efe6cc', rough: 0.6, metal: 0.2 },
  { id: 'turquoise', name: 'Turquoise Inlay', rarity: 'uncommon', crate: 'blade', pattern: 'zellige', colors: ['#cfd6dc', '#2fb2a8', '#1f5d66', '#c9a13b'], dark: '#1d2b2e' },
  { id: 'gildedhilt', name: 'Gilded Hilt', rarity: 'rare', crate: 'blade', body: '#d9dee3', dark: '#8a6a22', furn: '#d8ac3f', rough: 0.25, metal: 0.9 },
  { id: 'obsidian', name: 'Obsidian Edge', rarity: 'rare', crate: 'blade', body: '#2a2630', dark: '#0d0b10', furn: '#4a4356', rough: 0.2, metal: 0.6, glow: '#7a5cff' },
  { id: 'bloodsteel', name: 'Blood Steel', rarity: 'epic', crate: 'blade', pattern: 'damascus', colors: ['#9b2b28', '#3a1b1b'], dark: '#1b0f10', metal: 0.85, rough: 0.28, furn: '#2b1a16', glow: '#d0302a' },
  { id: 'mirageblade', name: 'Mirage Steel', rarity: 'legendary', crate: 'blade', pattern: 'mirage', colors: ['#ff7a3c', '#ffd24a', '#3fd0c9', '#7a5cff'], dark: '#1b1d24', anim: 'hue', metal: 0.8 },
  // Tactical Camouflage Case — real camouflage, for every gun and the knife
  { id: 'desertdpm', name: 'Desert DPM', rarity: 'uncommon', crate: 'camo', pattern: 'camo', colors: ['#c9b48f', '#a88a5c', '#7a6a4a', '#e0d3b4'], dark: '#3a3226' },
  { id: 'woodlandgun', name: 'Woodland', rarity: 'uncommon', crate: 'camo', pattern: 'camo', colors: ['#4a5a36', '#2e3a24', '#6b5a3a', '#1c2216'], dark: '#1c2216' },
  { id: 'arcticgun', name: 'Arctic White', rarity: 'rare', crate: 'camo', pattern: 'camo', colors: ['#e9edf1', '#c6ccd3', '#9aa3ad', '#f7f9fb'], dark: '#7a838c' },
  { id: 'urbandigital', name: 'Urban Digital', rarity: 'rare', crate: 'camo', pattern: 'digital', colors: ['#8a8f95', '#5a5f66', '#2f3338', '#b9bec4'], dark: '#2f3338' },
  { id: 'multicamgun', name: 'Multi-Terrain', rarity: 'epic', crate: 'camo', pattern: 'camo', colors: ['#a08a62', '#6e6a4a', '#4d5a3c', '#3a3226', '#c9b48f'], dark: '#3a3226' },
  { id: 'nightcamo', name: 'Night Ops', rarity: 'legendary', crate: 'camo', pattern: 'camo', colors: ['#1c1f26', '#2c313b', '#3a4150', '#12141a'], dark: '#0d0e12', metal: 0.4, rough: 0.5 },
  // Carnival Case — bright, striped, spotted, and some of it lit
  { id: 'candycane', name: 'Candy Cane', rarity: 'uncommon', crate: 'party', pattern: 'vstripes', colors: ['#ff3b4a', '#ffffff'], dark: '#7a1a22', anim: 'scroll' },
  { id: 'polkapunch', name: 'Polka Punch', rarity: 'uncommon', crate: 'party', pattern: 'dots', colors: ['#ff4fd8', '#ffe94a', '#3fd0ff'], dark: '#7a1f66' },
  { id: 'sherbet', name: 'Sherbet Fade', rarity: 'uncommon', crate: 'party', pattern: 'gradient', colors: ['#ffb3c6', '#ffe08a', '#b8f2c2', '#a8d8ff', '#ffb3c6'], dark: '#7a5a8a' },
  { id: 'bubblecamo', name: 'Bubblegum Camo', rarity: 'rare', crate: 'party', pattern: 'camo', colors: ['#ff8fc8', '#ffe94a', '#6bff5c', '#3fd0ff'], dark: '#7a1f66' },
  { id: 'zebrapop', name: 'Zebra Pop', rarity: 'rare', crate: 'party', pattern: 'tiger', colors: ['#f4f4f0', '#111114'], dark: '#ff3cac', glow: '#ff3cac' },
  { id: 'rainbowroad', name: 'Rainbow Road', rarity: 'rare', crate: 'party', pattern: 'vstripes', colors: ['#ff3b4a', '#ff8f1f', '#ffe94a', '#3fe05c', '#3fa0ff', '#8f4fff'], dark: '#2a1f3a', anim: 'scroll' },
  { id: 'ultraviolet', name: 'Ultraviolet', rarity: 'epic', crate: 'party', pattern: 'splat', colors: ['#14101f', '#7a3cff', '#c34fff', '#3fd0ff'], dark: '#0d0a14', glow: '#8f4fff' },
  { id: 'electricstripe', name: 'Electric Stripe', rarity: 'epic', crate: 'party', pattern: 'vstripes', colors: ['#0f1218', '#27e6ff', '#0f1218', '#ff3cac'], dark: '#0a0c10', glow: '#27e6ff', anim: 'scroll' },
  { id: 'discoball', name: 'Disco Ball', rarity: 'epic', crate: 'party', pattern: 'dots', colors: ['#1a1a2e', '#ffffff', '#ffe94a', '#3fd0ff'], dark: '#0f0f1a', glow: '#ffffff', anim: 'pulse', metal: 0.8, rough: 0.2 },
  { id: 'plasma', name: 'Plasma', rarity: 'legendary', crate: 'party', pattern: 'gradient', colors: ['#ff2d55', '#ff8f1f', '#ffe94a', '#3fe05c', '#3fa0ff', '#8f4fff', '#ff2d55'], dark: '#12081f', glow: '#ff4fd8', anim: 'hue', metal: 0.6, rough: 0.25 },
  { id: 'marquee', name: 'Marquee', rarity: 'legendary', crate: 'party', pattern: 'vstripes', colors: ['#ffe94a', '#1a1a2e', '#ff3b4a', '#1a1a2e', '#3fd0ff', '#1a1a2e'], dark: '#0f0f1a', glow: '#ffe94a', anim: 'scroll' },
];
for (const f of FINISHES) f.crate = f.crate || 'armory';
export const FINISH = Object.fromEntries(FINISHES.map((f) => [f.id, f]));

// Outfits: clothing for the soldier model. The vest keeps the team (or
// free-for-all) colour so sides stay readable whatever people wear.
export const OUTFITS = [
  { id: 'standard', name: 'Standard Issue', rarity: 'common', shirt: null, pants: '#6d6452', boots: '#3a2f24', wrap: null, head: 'wrap', starter: true },
  { id: 'porter', name: 'Market Porter', rarity: 'common', shirt: '#c9b48f', pants: '#7a6a52', boots: '#4a3a2a', wrap: '#e8e0cc', head: 'wrap' },
  { id: 'scout', name: 'Sand Scout', rarity: 'common', shirt: '#b89568', pants: '#8a7050', boots: '#5a4632', wrap: '#b89568', head: 'hood' },
  { id: 'fatigues', name: 'Olive Fatigues', rarity: 'common', shirt: '#5d6340', pants: '#4c5234', boots: '#2a2a22', wrap: '#4c5234', head: 'helmet' },
  { id: 'nightwatch', name: 'Night Watch', rarity: 'uncommon', shirt: '#2e3440', pants: '#232830', boots: '#15171b', wrap: '#1b1e24', head: 'beret' },
  { id: 'urban', name: 'Urban Grey', rarity: 'uncommon', pattern: 'camo', colors: ['#9aa0a6', '#5f656b', '#2f3338', '#c9cdd1'], boots: '#1d1f22', wrap: '#3a3e44', head: 'helmet' },
  { id: 'nomad', name: 'Desert Nomad', rarity: 'uncommon', shirt: '#ece0c6', pants: '#c9b48f', boots: '#6a4a2e', wrap: '#2f5f8f', head: 'wrap' },
  { id: 'tigercamo', name: 'Tiger Camo', rarity: 'rare', pattern: 'tiger', colors: ['#c98a3a', '#2a2218'], boots: '#1f1a14', wrap: '#2a2218', head: 'helmet' },
  { id: 'zelligeguard', name: 'Zellige Guard', rarity: 'rare', pattern: 'zellige', colors: ['#f1e9d8', '#2f8f8a', '#1f5d66', '#c9a13b'], pants: '#1f5d66', boots: '#1d2b2e', wrap: '#2f8f8a', head: 'beret' },
  { id: 'crimson', name: 'Crimson Raider', rarity: 'epic', shirt: '#8a2a22', pants: '#2a1c1a', boots: '#140e0d', wrap: '#c9412f', head: 'hood' },
  { id: 'midnight', name: 'Midnight Operative', rarity: 'epic', shirt: '#15181f', pants: '#101217', boots: '#0a0b0e', wrap: '#101217', head: 'helmet', glow: '#27e6ff', anim: 'pulse' },
  { id: 'sultan', name: 'Golden Sultan', rarity: 'legendary', shirt: '#d4a93c', pants: '#5a1f2a', boots: '#2a1414', wrap: '#f1e3a0', head: 'wrap', shine: true },
  { id: 'mirage', name: 'Mirage Phantom', rarity: 'legendary', pattern: 'mirage', colors: ['#ff7a3c', '#ffd24a', '#3fd0c9', '#7a5cff'], boots: '#15161b', wrap: '#1b1d24', head: 'hood', anim: 'hue' },
  // Bazaar Case
  { id: 'tracksuit', name: 'Tracksuit Legend', rarity: 'uncommon', crate: 'bazaar', pattern: 'stripes', colors: ['#1d7cf2', '#ffffff', '#e63946'], boots: '#f2f2f2', wrap: '#1d7cf2', head: 'beret' },
  { id: 'candystripe', name: 'Candy Stripe', rarity: 'uncommon', crate: 'bazaar', pattern: 'stripes', colors: ['#ff8fc8', '#ffffff'], pants: '#ff8fc8', boots: '#ffffff', wrap: '#ff4f79', head: 'wrap' },
  { id: 'surfer', name: 'Sunset Surfer', rarity: 'rare', crate: 'bazaar', pattern: 'floral', colors: ['#1fb5c9', '#ff5e62', '#ffd23f', '#2ec27e'], pants: '#f3d9a4', boots: '#8a5a36', wrap: '#ffd23f', head: 'beret' },
  { id: 'popart', name: 'Pop Art', rarity: 'rare', crate: 'bazaar', pattern: 'dots', colors: ['#ffd23f', '#e63946', '#1d1d1d'], pants: '#1d7cf2', boots: '#1d1d1d', wrap: '#e63946', head: 'helmet' },
  { id: 'festival', name: 'Festival Neon', rarity: 'epic', crate: 'bazaar', shirt: '#1a1a2e', pants: '#16213e', boots: '#0f0f1a', wrap: '#ff3cac', head: 'hood', glow: '#6bff5c', anim: 'pulse' },
  { id: 'stargazer', name: 'Stargazer', rarity: 'legendary', crate: 'bazaar', pattern: 'galaxy', colors: ['#0b0620', '#5b2a9e', '#ff4fd8', '#3fd0ff'], boots: '#07041a', wrap: '#5b2a9e', head: 'helmet', glow: '#3fd0ff', anim: 'hue' },
  // Tactical Camouflage Case — camouflage that works: beacons miss you, aim help ignores you, names show less
  { id: 'desertops', name: 'Desert Ops', rarity: 'uncommon', crate: 'camo', pattern: 'camo', colors: ['#c9b48f', '#a88a5c', '#7a6a4a', '#e0d3b4'], boots: '#5a4632', wrap: '#a88a5c', head: 'helmet', camo: 'sand' },
  { id: 'woodlandops', name: 'Woodland Ops', rarity: 'uncommon', crate: 'camo', pattern: 'camo', colors: ['#4a5a36', '#2e3a24', '#6b5a3a', '#1c2216'], boots: '#1c2216', wrap: '#2e3a24', head: 'helmet', camo: 'green' },
  { id: 'arcticops', name: 'Arctic Ops', rarity: 'rare', crate: 'camo', pattern: 'camo', colors: ['#e9edf1', '#c6ccd3', '#9aa3ad', '#f7f9fb'], boots: '#7a838c', wrap: '#c6ccd3', head: 'hood', camo: 'snow' },
  { id: 'urbanops', name: 'Urban Ops', rarity: 'rare', crate: 'camo', pattern: 'digital', colors: ['#8a8f95', '#5a5f66', '#2f3338', '#b9bec4'], boots: '#1d1f22', wrap: '#5a5f66', head: 'helmet', camo: 'concrete' },
  { id: 'multiterrain', name: 'Multi-Terrain Ops', rarity: 'epic', crate: 'camo', pattern: 'camo', colors: ['#a08a62', '#6e6a4a', '#4d5a3c', '#3a3226', '#c9b48f'], boots: '#3a3226', wrap: '#6e6a4a', head: 'helmet', camo: 'all' },
  { id: 'ghillie', name: 'Ghillie', rarity: 'legendary', crate: 'camo', pattern: 'camo', colors: ['#5a6a3a', '#3e4a2c', '#8a7a4a', '#2a3020', '#a89a6a'], boots: '#2a3020', wrap: '#3e4a2c', head: 'hood', camo: 'all' },
  // Souk Royale, season one: only a winner wears it
  { id: 'royale1', name: 'Royale Champion · Season 1', rarity: 'legendary', crate: 'royale', shirt: '#c9412f', pants: '#1a1206', boots: '#d8ac3f', wrap: '#f0b43c', head: 'beret', shine: true, glow: '#ffd24a', anim: 'pulse' },
  // a tall square log with a face: the body itself changes shape (see avatars.js). No crate holds it.
  { id: 'sahur', name: 'Tung Tung Tung Sahur', rarity: 'legendary', crate: 'owner', shirt: '#8a5a36', pants: '#6b4326', boots: '#3a2416', wrap: '#8a5a36', head: 'wrap', shape: 'log' },
];
// the camouflage outfits, by id
export const CAMO_OUTFITS = new Set(OUTFITS.filter((o) => o.camo).map((o) => o.id));
for (const o of OUTFITS) o.crate = o.crate || (o.starter ? 'starter' : 'wardrobe');
export const OUTFIT = Object.fromEntries(OUTFITS.map((o) => [o.id, o]));

// -- patterns -----------------------------------------------------------------

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const patternCache = new Map();

export function patternCanvas(kind, colors, seedKey = kind) {
  const key = kind + colors.join() + seedKey;
  if (patternCache.has(key)) return patternCache.get(key);
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = rng(hashStr(key));
  g.fillStyle = colors[0];
  g.fillRect(0, 0, S, S);
  if (kind === 'camo') {
    for (let layer = 1; layer < colors.length; layer++) {
      g.fillStyle = colors[layer];
      for (let i = 0; i < 14; i++) {
        const x = r() * S, y = r() * S;
        g.beginPath();
        for (let k = 0; k < 9; k++) {
          const a = (k / 9) * Math.PI * 2;
          const rad = 14 + r() * 26;
          const px = x + Math.cos(a) * rad * (1.4 + r() * 0.4), py = y + Math.sin(a) * rad;
          if (k) g.lineTo(px, py); else g.moveTo(px, py);
        }
        g.closePath();
        g.fill();
      }
    }
  } else if (kind === 'tiger') {
    g.fillStyle = colors[1];
    for (let i = 0; i < 12; i++) {
      const y0 = r() * S;
      g.beginPath();
      g.moveTo(-10, y0);
      for (let x = 0; x <= S + 10; x += 16) g.lineTo(x, y0 + Math.sin(x * 0.05 + i) * 10 + (r() - 0.5) * 8);
      for (let x = S + 10; x >= -10; x -= 16) g.lineTo(x, y0 + 5 + Math.sin(x * 0.05 + i) * 8 + r() * 6);
      g.closePath();
      g.fill();
    }
  } else if (kind === 'zellige') {
    const n = 4, t = S / n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const cx = x * t + t / 2, cy = y * t + t / 2;
        g.fillStyle = colors[(x + y) % 2 ? 1 : 2];
        g.beginPath();
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          const rad = k % 2 ? t * 0.22 : t * 0.44;
          g.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
        }
        g.closePath();
        g.fill();
        g.fillStyle = colors[3] || colors[0];
        g.beginPath();
        g.arc(cx, cy, t * 0.08, 0, Math.PI * 2);
        g.fill();
      }
    }
  } else if (kind === 'carbon') {
    const n = 16, t = S / n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const grd = (x + y) % 2
          ? g.createLinearGradient(x * t, y * t, x * t + t, y * t)
          : g.createLinearGradient(x * t, y * t, x * t, y * t + t);
        grd.addColorStop(0, colors[1]);
        grd.addColorStop(0.5, colors[0]);
        grd.addColorStop(1, colors[1]);
        g.fillStyle = grd;
        g.fillRect(x * t, y * t, t, t);
      }
    }
  } else if (kind === 'digital') {
    const t = 8;
    for (let y = 0; y < S; y += t) {
      for (let x = 0; x < S; x += t) {
        const v = Math.sin(x * 0.03 + y * 0.011) + Math.sin(y * 0.041 - x * 0.017) + r() * 0.9;
        g.fillStyle = colors[Math.max(0, Math.min(colors.length - 1, Math.floor((v + 2) / 4.9 * colors.length)))];
        g.fillRect(x, y, t, t);
      }
    }
  } else if (kind === 'damascus') {
    for (let i = 0; i < 60; i++) {
      g.strokeStyle = i % 2 ? colors[1] : colors[0];
      g.lineWidth = 2 + r() * 3;
      g.beginPath();
      const y0 = (i / 60) * S * 1.4 - S * 0.2;
      for (let x = 0; x <= S; x += 6) g.lineTo(x, y0 + Math.sin(x * 0.04 + i * 0.3) * 18 + Math.sin(x * 0.013) * 22);
      g.stroke();
    }
  } else if (kind === 'web') {
    g.strokeStyle = colors[1];
    g.lineWidth = 2;
    for (let i = 0; i < 26; i++) {
      let x = r() * S, y = r() * S;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += (r() - 0.5) * 70;
        y += (r() - 0.5) * 70;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  } else if (kind === 'mirage') {
    const grd = g.createLinearGradient(0, 0, S, S);
    colors.forEach((col, i) => grd.addColorStop(i / (colors.length - 1), col));
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
    g.globalAlpha = 0.25;
    for (let i = 0; i < 20; i++) {
      g.fillStyle = '#ffffff';
      g.fillRect(0, (i / 20) * S, S, 2);
    }
    g.globalAlpha = 1;
  } else if (kind === 'dots') {
    const step = 32;
    for (let y = 0; y < S; y += step) {
      for (let x = 0; x < S; x += step) {
        g.fillStyle = colors[1 + ((x / step + y / step) % (colors.length - 1))];
        g.beginPath();
        g.arc(x + (y / step % 2 ? step / 2 : 0), y + step / 2, 9, 0, Math.PI * 2);
        g.fill();
      }
    }
  } else if (kind === 'blocks') {
    const t = 64;
    for (let y = 0; y < S; y += t) {
      for (let x = 0; x < S; x += t) {
        g.fillStyle = colors[Math.floor(r() * colors.length)];
        g.fillRect(x + 2, y + 2, t - 4, t - 4);
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.beginPath();
        g.arc(x + t / 2, y + t / 2, 10, 0, Math.PI * 2);
        g.fill();
      }
    }
  } else if (kind === 'gradient') {
    const grd = g.createLinearGradient(0, 0, S, S * 0.6);
    colors.forEach((col, i) => grd.addColorStop(i / (colors.length - 1), col));
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
  } else if (kind === 'waves') {
    for (let i = 0; i < 18; i++) {
      g.strokeStyle = colors[i % colors.length];
      g.lineWidth = 9;
      g.beginPath();
      const y0 = (i / 18) * S * 1.2 - 10;
      for (let x = 0; x <= S; x += 4) g.lineTo(x, y0 + Math.sin(x * 0.05 + i * 0.7) * 9);
      g.stroke();
    }
  } else if (kind === 'splat') {
    for (let i = 0; i < 40; i++) {
      g.fillStyle = colors[1 + Math.floor(r() * (colors.length - 1))];
      const x = r() * S, y = r() * S, rad = 5 + r() * 22;
      g.beginPath();
      g.arc(x, y, rad, 0, Math.PI * 2);
      g.fill();
      for (let k = 0; k < 5; k++) {
        g.beginPath();
        g.arc(x + (r() - 0.5) * rad * 3, y + (r() - 0.5) * rad * 3, 1 + r() * 4, 0, Math.PI * 2);
        g.fill();
      }
    }
  } else if (kind === 'galaxy') {
    for (let i = 0; i < 7; i++) {
      const x = r() * S, y = r() * S, rad = 40 + r() * 70;
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, colors[1 + (i % (colors.length - 1))] + 'cc');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, S, S);
    }
    for (let i = 0; i < 160; i++) {
      g.fillStyle = `rgba(255,255,255,${0.4 + r() * 0.6})`;
      g.fillRect(r() * S, r() * S, r() < 0.1 ? 2 : 1, r() < 0.1 ? 2 : 1);
    }
  } else if (kind === 'stripes') {
    const n = 8, h = S / n;
    for (let i = 0; i < n; i++) {
      g.fillStyle = colors[i % colors.length];
      g.fillRect(0, i * h, S, h);
    }
  } else if (kind === 'vstripes') {
    // bands across the texture's width: on a gun they run around it and can be scrolled along it
    const n = colors.length * 2, w = S / n;
    for (let i = 0; i < n; i++) {
      g.fillStyle = colors[i % colors.length];
      g.fillRect(i * w, 0, w + 1, S);
    }
  } else if (kind === 'floral') {
    for (let i = 0; i < 16; i++) {
      const x = r() * S, y = r() * S, rad = 10 + r() * 12;
      g.fillStyle = colors[1 + Math.floor(r() * (colors.length - 1))];
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + i;
        g.beginPath();
        g.ellipse(x + Math.cos(a) * rad * 0.7, y + Math.sin(a) * rad * 0.7, rad * 0.6, rad * 0.35, a, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#fff3c4';
      g.beginPath();
      g.arc(x, y, rad * 0.25, 0, Math.PI * 2);
      g.fill();
    }
  } else if (kind === 'rust') {
    for (let i = 0; i < 70; i++) {
      const x = r() * S, y = r() * S, rad = 6 + r() * 26;
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, r() < 0.5 ? 'rgba(60,30,15,0.55)' : 'rgba(190,110,60,0.45)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
  }
  patternCache.set(key, c);
  return c;
}

function canvasTex(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// -- materials ----------------------------------------------------------------

const animated = [];

// the three materials for a finish, shared by every gun that wears it
const gunMatCache = new Map();

// Polished nickel: a mirror finish needs something to reflect, and the game
// has no environment map, so this paints one — a sky above a horizon above
// dusty ground — onto the six faces of a small cube. Shared by every chrome
// part, first and third person alike.
let chromeMat = null;
export function chromeMaterial() {
  if (chromeMat) return chromeMat;
  chromeMat = new THREE.MeshStandardMaterial({ color: '#a9aeb5', roughness: 0.16, metalness: 1.0 });
  try {
    const face = (kind) => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const x = c.getContext('2d');
      if (kind === 'up') { x.fillStyle = '#bcd6ee'; x.fillRect(0, 0, 64, 64); }
      else if (kind === 'down') { x.fillStyle = '#6e5a42'; x.fillRect(0, 0, 64, 64); }
      else {
        const gr = x.createLinearGradient(0, 0, 0, 64);
        gr.addColorStop(0, '#bcd6ee'); gr.addColorStop(0.45, '#eef2f4'); gr.addColorStop(0.5, '#d9c9a8'); gr.addColorStop(1, '#6e5a42');
        x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
      }
      return c;
    };
    const env = new THREE.CubeTexture([face('side'), face('side'), face('up'), face('down'), face('side'), face('side')]);
    env.colorSpace = THREE.SRGBColorSpace;
    env.needsUpdate = true;
    chromeMat.envMap = env;
    chromeMat.envMapIntensity = 0.8;
  } catch (e) {
    // no canvas here: plain bright metal will do
    chromeMat.metalness = 0.6;
  }
  return chromeMat;
}
// plain = true gives the same finish with its lights switched off: what other
// players see, so a lit-up skin never gives its owner away in the dark
export function gunMaterials(finishId, plain = false) {
  const f = FINISH[finishId];
  if (!f) return null;
  const key = finishId + (plain ? '|plain' : '');
  if (gunMatCache.has(key)) return gunMatCache.get(key);
  const rough = f.rough !== undefined ? f.rough : 0.6;
  const metal = f.metal !== undefined ? f.metal : 0.2;
  const mk = (color, withPattern) => {
    const m = new THREE.MeshStandardMaterial({ color: color || '#ffffff', roughness: rough, metalness: metal });
    if (withPattern && f.pattern) {
      m.map = canvasTex(patternCanvas(f.pattern, f.colors || [f.body || '#888', f.dark || '#444'], f.id));
      if (f.pattern === 'rust') m.color.set(f.body);
      else m.color.set('#ffffff');
    }
    if (f.glow && !plain) {
      m.emissive = new THREE.Color(f.glow);
      m.emissiveIntensity = f.pattern ? 0.35 : 0.0;
    }
    return m;
  };
  const body = mk(f.body, true);
  const furn = f.furn ? mk(f.furn, false) : mk(f.body, true);
  const dark = new THREE.MeshStandardMaterial({ color: f.dark || '#333', roughness: rough, metalness: metal });
  if (f.glow && !f.pattern && !plain) {
    // neon: dark parts carry the glowing edge
    dark.emissive = new THREE.Color(f.glow);
    dark.emissiveIntensity = 0.9;
  }
  const set = { body, dark, furn };
  if (f.anim) animated.push({ kind: f.anim, mats: [body, dark, furn], base: f });
  gunMatCache.set(key, set);
  return set;
}

const outfitMatCache = new Map();
export function outfitMaterials(outfitId) {
  const o = OUTFIT[outfitId] || OUTFIT.standard;
  if (outfitMatCache.has(o.id)) return outfitMatCache.get(o.id);
  const lam = (color) => new THREE.MeshLambertMaterial({ color });
  let shirt = null, pants;
  if (o.pattern) {
    const tex = canvasTex(patternCanvas(o.pattern, o.colors, o.id));
    shirt = new THREE.MeshLambertMaterial({ map: tex });
    pants = o.pants ? lam(o.pants) : new THREE.MeshLambertMaterial({ map: tex });
  } else {
    shirt = o.shirt ? lam(o.shirt) : null;
    pants = lam(o.pants);
  }
  if (shirt && o.shine) shirt.emissive = new THREE.Color('#5a3e0a');
  const boots = lam(o.boots);
  const wrap = o.wrap ? lam(o.wrap) : null;
  const glow = o.glow ? new THREE.MeshBasicMaterial({ color: o.glow }) : null;
  const set = { shirt, pants, boots, wrap, glow, head: o.head };
  if (o.anim) animated.push({ kind: o.anim, mats: [shirt, pants, glow].filter(Boolean), base: o });
  outfitMatCache.set(o.id, set);
  return set;
}

// animated finishes: a neon pulse, or a slow hue drift
export function tickSkins(t) {
  for (const a of animated) {
    if (a.kind === 'pulse') {
      const k = 0.55 + 0.45 * Math.sin(t * 3.2);
      for (const m of a.mats) {
        if (m.emissive && m.emissiveIntensity !== undefined && m.emissive.getHex() !== 0) m.emissiveIntensity = 0.3 + 0.9 * k;
        if (m.isMeshBasicMaterial) m.color.set(a.base.glow).multiplyScalar(0.5 + 0.5 * k);
      }
    } else if (a.kind === 'hue') {
      for (const m of a.mats) {
        if (!m.map) continue;
        m.map.offset.set((t * 0.05) % 1, (t * 0.03) % 1);
      }
    } else if (a.kind === 'scroll') {
      // stripes run from the stock to the muzzle
      for (const m of a.mats) {
        if (!m.map) continue;
        m.map.offset.set((-t * 0.35) % 1, 0);
      }
    }
  }
}

// a CSS background for a finish or outfit tile in the menus
const swatchCache = new Map();
export function swatch(item) {
  if (swatchCache.has(item.id + (item.shirt || ''))) return swatchCache.get(item.id + (item.shirt || ''));
  let css;
  if (item.pattern) {
    const c = patternCanvas(item.pattern, item.colors || [item.body || '#888', item.dark || '#444'], item.id);
    css = `url(${c.toDataURL()}) center / 140% auto`;
  } else if (item.body) {
    css = `linear-gradient(135deg, ${item.body} 0 55%, ${item.dark} 55% 75%, ${item.furn || item.body} 75%)`;
  } else {
    const top = item.shirt || '#8a7a60';
    css = `linear-gradient(180deg, ${item.wrap || top} 0 22%, ${top} 22% 60%, ${item.pants || top} 60% 90%, ${item.boots} 90%)`;
  }
  swatchCache.set(item.id + (item.shirt || ''), css);
  return css;
}
