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
  // The Battle Pass, season one: Italian brainrot. Never in a crate.
  { id: 'sahurdots', name: 'Tung Tung Tung Dots', rarity: 'rare', crate: 'pass', pattern: 'sahurdots', colors: ['#f1e9d8', '#8a5a36', '#3a2416'], dark: '#3a2416', furn: '#6b4326' },
  { id: 'ballerinadots', name: 'Cappuccina Dots', rarity: 'rare', crate: 'pass', pattern: 'cupdots', colors: ['#fbe9ee', '#f7f3ee', '#c98a4a', '#d8ac3f'], dark: '#7a5a3a', furn: '#d8ac3f' },
  // the two melee rewards are knife finishes that change its shape (see viewmodel.js)
  { id: 'bat', name: 'Sahur’s Bat', rarity: 'epic', crate: 'pass', shape: 'bat', body: '#8a5a36', dark: '#5a3a24', furn: '#3a2416', rough: 0.8, metal: 0 },
  { id: 'cane', name: 'Cappuccina’s Cane', rarity: 'epic', crate: 'pass', shape: 'cane', body: '#f4efe6', dark: '#c9a13b', furn: '#d8ac3f', rough: 0.25, metal: 0.7 },
  { id: 'sahurwood', name: 'Tung Tung Tung Wood', rarity: 'epic', crate: 'pass', pattern: 'sahurwood', colors: ['#a86f44', '#4a2e1a', '#f4f1e6', '#c48a58'], dark: '#4a2e1a', furn: '#7d4f2c', rough: 0.85, metal: 0 },
  { id: 'porcelain', name: 'Cappuccina Porcelain', rarity: 'legendary', crate: 'pass', pattern: 'porcelain', colors: ['#f7f3ee', '#d8ac3f', '#f4a7c0', '#c98a4a'], dark: '#c9a13b', furn: '#f4a7c0', rough: 0.18, metal: 0.45 },
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
  // the Battle Pass outfits: these change the body's shape (see avatars.js). No crate holds them.
  { id: 'sahur', name: 'Tung Tung Tung Sahur', rarity: 'legendary', crate: 'pass', shirt: '#8a5a36', pants: '#6b4326', boots: '#3a2416', wrap: '#8a5a36', head: 'wrap', shape: 'log' },
  { id: 'ballerina', name: 'Ballerina Cappuccina', rarity: 'legendary', crate: 'pass', shirt: '#d8ac3f', pants: '#f1d9c0', boots: '#d8ac3f', wrap: '#c9a13b', head: 'wrap', shape: 'cup' },
  { id: 'tunggod', name: 'Tung Tung Tung God', rarity: 'legendary', crate: 'pass', shirt: '#f4f1ea', pants: '#f4f1ea', boots: '#f4f1ea', wrap: '#f4f1ea', head: 'wrap', shape: 'god', shine: true },
  // given to one account by hand; no crate holds it. The monogram jacket worn open
  // over his yellow T-shirt, jeans and white trainers, and Morty's head (see avatars.js)
  { id: 'guccimorty', name: 'Gucci Morty', rarity: 'legendary', crate: 'owner', pattern: 'gucci', colors: ['#cbb68c', '#4a3324', '#1f6b3a', '#b3201c'], pants: '#3f5f93', boots: '#f4f4f0', wrap: '#4a2a12', head: 'morty', jacket: true },
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
  } else if (kind === 'sahurdots' || kind === 'cupdots') {
    // polka dots, each one a small character: a log with a face, or a teacup ballerina
    const step = 64;
    for (let y = 0; y < S; y += step) {
      for (let x = 0; x < S; x += step) {
        const cx = x + step / 2 + ((y / step) % 2 ? step / 2 : 0), cy = y + step / 2;
        if (kind === 'sahurdots') {
          g.fillStyle = colors[1];
          g.fillRect(cx - 9, cy - 16, 18, 32);
          g.fillStyle = colors[2];
          g.fillRect(cx - 9, cy - 16, 18, 2); g.fillRect(cx - 9, cy + 14, 18, 2);
          g.fillStyle = '#fff'; g.fillRect(cx - 7, cy - 10, 5, 6); g.fillRect(cx + 2, cy - 10, 5, 6);
          g.fillStyle = colors[2]; g.fillRect(cx - 5, cy - 8, 2, 3); g.fillRect(cx + 4, cy - 8, 2, 3); g.fillRect(cx - 6, cy + 2, 12, 2);
          g.fillStyle = colors[2]; g.fillRect(cx - 11, cy + 18, 3, 8); g.fillRect(cx + 8, cy + 18, 3, 8);        // little legs
        } else {
          g.fillStyle = colors[3];                                                          // the tutu
          g.beginPath(); g.ellipse(cx, cy + 6, 16, 6, 0, 0, Math.PI * 2); g.fill();
          g.fillStyle = colors[1]; g.fillRect(cx - 4, cy - 4, 8, 10);                     // the body
          g.fillStyle = colors[1];                                                          // the cup
          g.beginPath(); g.ellipse(cx, cy - 13, 11, 9, 0, 0, Math.PI * 2); g.fill();
          g.fillStyle = colors[2]; g.beginPath(); g.ellipse(cx, cy - 17, 9, 3, 0, 0, Math.PI * 2); g.fill();   // the coffee
          g.strokeStyle = colors[1]; g.lineWidth = 2; g.beginPath(); g.arc(cx + 12, cy - 13, 4, -1.2, 1.2); g.stroke();   // the handle
          g.fillStyle = '#2a3a4a'; g.fillRect(cx - 5, cy - 12, 3, 3); g.fillRect(cx + 2, cy - 12, 3, 3);       // the eyes
          g.fillStyle = '#c9412f'; g.fillRect(cx - 1, cy - 7, 3, 1.5);
          g.fillStyle = colors[3]; g.fillRect(cx - 3, cy + 10, 2, 8); g.fillRect(cx + 1, cy + 10, 2, 8);         // legs
        }
      }
    }
  } else if (kind === 'sahurwood') {
    // wood grain the length of the gun, with the face on one side
    for (let i = 0; i < 40; i++) {
      g.strokeStyle = i % 3 ? (colors[3] || colors[0]) : colors[1];
      g.globalAlpha = 0.3 + r() * 0.3;
      g.lineWidth = 1 + r() * 3;
      g.beginPath();
      const y0 = (i / 40) * S;
      for (let x = 0; x <= S; x += 8) g.lineTo(x, y0 + Math.sin(x * 0.03 + i) * 4 + Math.sin(x * 0.011 + i * 2) * 6);
      g.stroke();
    }
    g.globalAlpha = 1;
    // the eyes and the grim mouth, once, big
    g.fillStyle = colors[2];
    g.fillRect(56, 88, 44, 52); g.fillRect(156, 88, 44, 52);
    g.fillStyle = colors[1];
    g.fillRect(72, 100, 20, 30); g.fillRect(172, 100, 20, 30);
    g.fillRect(48, 70, 60, 8); g.fillRect(148, 70, 60, 8);        // brows
    g.fillRect(70, 170, 116, 12);                                   // the mouth
    g.fillStyle = colors[2]; g.fillRect(76, 172, 104, 4);           // teeth
  } else if (kind === 'porcelain') {
    // glazed white with gold vines and pink blossoms
    for (let i = 0; i < 9; i++) {
      g.strokeStyle = colors[1];
      g.lineWidth = 2.5;
      g.beginPath();
      let x = r() * S, y = r() * S;
      g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 60; y += (r() - 0.5) * 60; g.quadraticCurveTo(x + (r() - 0.5) * 30, y + (r() - 0.5) * 30, x, y); }
      g.stroke();
    }
    for (let i = 0; i < 26; i++) {
      const x = r() * S, y = r() * S, rad = 5 + r() * 7;
      g.fillStyle = colors[2];
      for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; g.beginPath(); g.ellipse(x + Math.cos(a) * rad * 0.7, y + Math.sin(a) * rad * 0.7, rad * 0.55, rad * 0.35, a, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = colors[1];
      g.beginPath(); g.arc(x, y, rad * 0.25, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 12; i++) {
      g.fillStyle = colors[3]; g.globalAlpha = 0.25;
      g.beginPath(); g.arc(r() * S, r() * S, 2 + r() * 3, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
  } else if (kind === 'gucci') {
    // the monogram: pairs of interlocking G's in brown on tan, row on row, offset,
    // with the green-red-green web stripe across the middle
    const step = 48;
    g.strokeStyle = colors[1];
    g.lineWidth = 3.2;
    const G = (cx, cy, rad, flip) => {
      g.beginPath();
      if (!flip) g.arc(cx, cy, rad, -Math.PI * 0.25, Math.PI * 1.55);
      else g.arc(cx, cy, rad, Math.PI * 0.75, Math.PI * 2.55);
      g.stroke();
      // the G's crossbar
      const s = flip ? -1 : 1;
      g.beginPath();
      g.moveTo(cx + s * rad * 0.15, cy + rad * 0.05);
      g.lineTo(cx + s * rad * 0.75, cy + rad * 0.05);
      g.stroke();
    };
    for (let row = 0, y = step / 2; y < S + step; y += step, row++) {
      for (let x = (row % 2) * step / 2; x < S + step; x += step) {
        G(x - 4, y, 9, false);
        G(x + 4, y, 9, true);
      }
    }
    // little diamonds between them
    g.fillStyle = colors[1];
    for (let y = 0; y < S; y += step) for (let x = 0; x < S; x += step) {
      g.beginPath(); g.moveTo(x, y - 3); g.lineTo(x + 3, y); g.lineTo(x, y + 3); g.lineTo(x - 3, y); g.closePath(); g.fill();
    }
    const y0 = S * 0.44;
    g.fillStyle = colors[2]; g.fillRect(0, y0, S, 10);
    g.fillStyle = colors[3]; g.fillRect(0, y0 + 10, S, 10);
    g.fillStyle = colors[2]; g.fillRect(0, y0 + 20, S, 10);
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
    } else if (a.kind === 'siren') {
      // red, then blue, three flashes a second each, with a hard on and off
      const S = a.base;
      const phase = (t * 3) % 2;
      const redOn = phase < 1 && (phase % 0.5) < 0.32;
      const blueOn = phase >= 1 && (phase % 0.5) < 0.32;
      S.red.color.set(redOn ? '#ff2a1c' : '#3a0806');
      S.blue.color.set(blueOn ? '#2a6cff' : '#06103a');
      S.redGlow.opacity = redOn ? 1 : 0;
      S.blueGlow.opacity = blueOn ? 1 : 0;
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

// -- golf carts ------------------------------------------------------------------
// Skins for the golf carts, from the Pit Lane Crate. Each one paints the body,
// the seat, the canopy and the wheels, and may put a livery on the bonnet, the
// sides and the roof: stripes, flames, a chequered band, a race number.
export const CARTS = [
  { id: 'fairway', name: 'Fairway', rarity: 'common', body: '#f2f2ee', seat: '#2f6b4a', canopy: '#2f6b4a', trim: '#2b2e32' },
  { id: 'clubhouse', name: 'Clubhouse Cream', rarity: 'common', body: '#efe2c4', seat: '#7a4a2a', canopy: '#efe2c4', trim: '#5a3a24' },
  { id: 'caddie', name: 'Caddie Blue', rarity: 'common', body: '#3f6fb0', seat: '#1d2633', canopy: '#f2f2ee', trim: '#1d2633' },
  { id: 'sandtrap', name: 'Sand Trap', rarity: 'common', body: '#d6bf8e', seat: '#5a4a35', canopy: '#b39a74', trim: '#5a4a35' },
  { id: 'cabbie', name: 'Yellow Cab', rarity: 'uncommon', body: '#f5c518', seat: '#1b1b1b', canopy: '#f5c518', trim: '#1b1b1b', livery: 'band', colors: ['#141414', '#f4f4f0'] },
  { id: 'patrol', name: 'Cart Patrol', rarity: 'uncommon', body: '#16181d', seat: '#16181d', canopy: '#f4f4f0', trim: '#f4f4f0', livery: 'police', colors: ['#f4f4f0', '#16181d', '#2f6fe0', '#e0302a'] },
  { id: 'woodie', name: 'Woodie', rarity: 'uncommon', body: '#efe2c4', seat: '#7a4a2a', canopy: '#efe2c4', trim: '#5a3a24', livery: 'wood', colors: ['#9a6a3e', '#6b4326', '#c48a58'] },
  { id: 'sundae', name: 'Sundae', rarity: 'uncommon', body: '#ffc8dc', seat: '#8fd8ff', canopy: '#fff6e0', trim: '#c9567f', livery: 'dots', colors: ['#ffc8dc', '#ffffff', '#8fd8ff', '#ffe08a'] },
  { id: 'lemans', name: 'Le Mans Stripes', rarity: 'rare', body: '#1f4fa8', seat: '#14181f', canopy: '#1f4fa8', trim: '#14181f', livery: 'twin', colors: ['#f4f4f0'] },
  { id: 'chequered', name: 'Chequered Flag', rarity: 'rare', body: '#f4f4f0', seat: '#141414', canopy: '#141414', trim: '#141414', livery: 'checker', colors: ['#141414', '#f4f4f0'] },
  { id: 'number7', name: 'Number 7', rarity: 'rare', body: '#d0352b', seat: '#141414', canopy: '#f4f4f0', trim: '#141414', livery: 'number', num: '7', colors: ['#f4f4f0', '#141414'] },
  { id: 'redline', name: 'Redline', rarity: 'rare', body: '#2a2c30', seat: '#d0352b', canopy: '#2a2c30', trim: '#d0352b', livery: 'single', colors: ['#d0352b'] },
  { id: 'hotrod', name: 'Hot Rod Flames', rarity: 'epic', body: '#141414', seat: '#7a1a12', canopy: '#141414', trim: '#c9a13b', livery: 'flames', colors: ['#ffe04a', '#ff8a1f', '#e0302a'], metal: 0.5 },
  { id: 'petrol', name: 'Petrol Blue', rarity: 'epic', body: '#8ec3e6', seat: '#1d2633', canopy: '#8ec3e6', trim: '#1d2633', livery: 'gulf', colors: ['#f08a1f'], num: '9' },
  { id: 'neoncart', name: 'Night Racer', rarity: 'epic', body: '#101218', seat: '#101218', canopy: '#101218', trim: '#27e6ff', livery: 'twin', colors: ['#27e6ff'], glow: '#27e6ff' },
  { id: 'inferno', name: 'Inferno', rarity: 'legendary', body: '#b0141a', seat: '#141414', canopy: '#b0141a', trim: '#d9dee3', livery: 'flames', colors: ['#ffffff', '#7fd4ff', '#2f6fe0'], metal: 0.6, rough: 0.25, glow: '#7fd4ff' },
  { id: 'goldcart', name: 'Solid Gold', rarity: 'legendary', body: '#d8ac3f', seat: '#2b2320', canopy: '#d8ac3f', trim: '#8a6a22', livery: 'twin', colors: ['#2b2320'], metal: 0.9, rough: 0.2 },
  { id: 'rainbowkart', name: 'Rainbow Road', rarity: 'legendary', body: '#1a1a2e', seat: '#1a1a2e', canopy: '#1a1a2e', trim: '#ffe94a', livery: 'rainbow', colors: ['#ff3b4a', '#ff8f1f', '#ffe94a', '#3fe05c', '#3fa0ff', '#8f4fff'], glow: '#ffffff' },
  // given to one account by hand; no crate holds it. A patrol car with a giant light
  // bar, and a Gatling turret behind it (see the turret in game.js)
  { id: 'interceptor', name: 'Interceptor', rarity: 'legendary', crate: 'owner', body: '#0f1116', seat: '#0f1116', canopy: '#f4f4f0', trim: '#f4f4f0', livery: 'police', colors: ['#f4f4f0', '#0f1116', '#2f6fe0', '#e0302a'], lightbar: true, turret: true, metal: 0.4, rough: 0.35 },
];
for (const c of CARTS) c.crate = c.crate || 'kart';
export const CART = Object.fromEntries(CARTS.map((c) => [c.id, c]));
// the giant light bar's lamps: shared by every cart that has one, flashing red then blue
let SIREN = null;
export function sirenMaterials() {
  if (SIREN) return SIREN;
  const glow = (c) => new THREE.SpriteMaterial({ map: canvasTex(glowDot(c)), color: '#ffffff', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  SIREN = {
    red: new THREE.MeshBasicMaterial({ color: '#ff1a10' }),
    blue: new THREE.MeshBasicMaterial({ color: '#1a5cff' }),
    redGlow: glow('255,40,30'),
    blueGlow: glow('40,100,255'),
  };
  animated.push({ kind: 'siren', mats: [], base: SIREN });
  return SIREN;
}
function glowDot(rgb) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, `rgba(${rgb},1)`);
  gr.addColorStop(0.35, `rgba(${rgb},0.55)`);
  gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return c;
}

// the plain cart, before any skin
export const CART_FACTORY = { id: '', name: 'Factory', rarity: 'common', body: '#f2f2ee', seat: '#2f6b4a', canopy: '#f2f2ee', trim: '#2b2e32' };

// A livery drawn for one face of a cart. 'hood' and 'roof' have u along the
// cart (the nose at u = 1) and v across it. 'sideR' is the cart's +z side and
// 'sideL' its -z side, both seen from outside, so on 'sideL' the nose is at the
// left; the art is mirrored but writing is not. The sides leave the seat
// opening, and the gap above the bonnet, clear (transparent).
// Side canvas: x = (local x + 1.15) / 2.3, y = (1.03 - height) / 0.75.
export const CART_SIDE = { x0: -1.15, x1: 1.15, y0: 0.28, y1: 1.03 };
const cartCanvasCache = new Map();
export function cartCanvas(skin, face) {
  const key = skin.id + '|' + face;
  if (cartCanvasCache.has(key)) return cartCanvasCache.get(key);
  const side = face === 'sideL' || face === 'sideR';
  const W = 512, H = side ? 168 : 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const col = skin.colors || [];
  g.fillStyle = face === 'roof' ? (skin.canopy || skin.body) : skin.body;
  g.fillRect(0, 0, W, H);
  // where a height on the side falls on the canvas
  const hy = (h) => ((CART_SIDE.y1 - h) / (CART_SIDE.y1 - CART_SIDE.y0)) * H;
  const ux = (lx) => ((lx - CART_SIDE.x0) / (CART_SIDE.x1 - CART_SIDE.x0)) * W;
  if (face === 'sideL') g.setTransform(-1, 0, 0, 1, W, 0);     // the nose on the left
  const r = rng(hashStr(skin.id + face.slice(0, 4)));
  const L = skin.livery;
  const band = (y0, y1, color) => { g.fillStyle = color; g.fillRect(0, Math.min(y0, y1), W, Math.abs(y1 - y0)); };
  if (L === 'twin') {
    if (side) { band(hy(0.5), hy(0.44), col[0]); band(hy(0.4), hy(0.34), col[0]); }
    else { band(H * 0.36, H * 0.45, col[0]); band(H * 0.55, H * 0.64, col[0]); }
  } else if (L === 'single') {
    if (side) band(hy(0.52), hy(0.36), col[0]);
    else band(H * 0.42, H * 0.58, col[0]);
  } else if (L === 'band' || L === 'checker') {
    const sq = side ? 14 : 22;
    const y0 = side ? hy(0.5) : H / 2 - sq;
    for (let x = 0; x < W; x += sq) {
      for (let k = 0; k < 2; k++) {
        g.fillStyle = col[((x / sq) + k) % 2];
        g.fillRect(x, y0 + k * sq, sq, sq);
      }
    }
    if (L === 'checker' && !side) {
      for (let y = 0; y < H; y += 32) for (let x = 0; x < W; x += 32) {
        g.fillStyle = col[((x + y) / 32) % 2];
        g.fillRect(x, y, 32, 32);
      }
    }
  } else if (L === 'police') {
    if (side) {
      g.fillStyle = col[0];
      g.fillRect(ux(-1.15), hy(1.03), ux(-0.45) - ux(-1.15), H);    // white doors at the back
      g.fillRect(ux(0.55), hy(0.92), W - ux(0.55), H);               // and at the front
      band(hy(0.38), hy(0.3), col[2]);
    } else if (face === 'roof') {
      g.fillStyle = col[2]; g.fillRect(W * 0.35, H * 0.3, W * 0.12, H * 0.4);
      g.fillStyle = col[3]; g.fillRect(W * 0.53, H * 0.3, W * 0.12, H * 0.4);
    } else band(H * 0.4, H * 0.6, col[0]);
  } else if (L === 'wood') {
    if (side) {
      g.fillStyle = col[0];
      g.fillRect(0, hy(0.98), W, hy(0.34) - hy(0.98));
      for (let i = 0; i < 26; i++) {
        g.strokeStyle = i % 3 ? col[2] : col[1];
        g.globalAlpha = 0.5;
        g.lineWidth = 1 + r() * 2;
        g.beginPath();
        const y = hy(0.95) + r() * (hy(0.36) - hy(0.95));
        for (let x = 0; x <= W; x += 16) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 3);
        g.stroke();
      }
      g.globalAlpha = 1;
      g.strokeStyle = skin.trim; g.lineWidth = 6;
      g.strokeRect(3, hy(0.98), W - 6, hy(0.34) - hy(0.98));
    }
  } else if (L === 'dots') {
    const p = patternCanvas('dots', col, skin.id);
    for (let x = 0; x < W; x += 256) for (let y = 0; y < H; y += 256) g.drawImage(p, x, y);
  } else if (L === 'rainbow') {
    const n = col.length;
    if (side) for (let i = 0; i < n; i++) band(hy(0.54 - i * 0.04), hy(0.5 - i * 0.04), col[i]);
    else for (let i = 0; i < n; i++) band(H * (0.2 + i * 0.1), H * (0.3 + i * 0.1), col[i]);
  } else if (L === 'gulf') {
    if (side) band(hy(0.55), hy(0.36), col[0]);
    else band(H * 0.35, H * 0.65, col[0]);
  } else if (L === 'flames') {
    // tongues of fire licking back from the nose (u = 1)
    const tongues = side ? 6 : 9;
    const draw = (scale, color) => {
      g.fillStyle = color;
      for (let i = 0; i < tongues; i++) {
        const t = (i + 0.5) / tongues;
        const yc = side ? hy(0.86 - t * 0.5) : H * (0.1 + t * 0.8);
        const len = W * (0.35 + 0.35 * Math.sin(t * Math.PI) + r() * 0.08) * scale;
        const th = (side ? H * 0.08 : H * 0.07) * scale;
        const x0 = W + 4;
        g.beginPath();
        g.moveTo(x0, yc - th);
        g.bezierCurveTo(x0 - len * 0.4, yc - th * 1.4, x0 - len * 0.7, yc - th * 0.2, x0 - len, yc + th * 0.6);
        g.bezierCurveTo(x0 - len * 0.75, yc + th * 0.5, x0 - len * 0.4, yc + th * 1.6, x0, yc + th);
        g.closePath();
        g.fill();
      }
    };
    draw(1.0, col[2]);
    draw(0.78, col[1]);
    draw(0.5, col[0]);
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  // writing goes on unmirrored: a race number in a roundel, the word on a patrol cart
  const text = (str, cx, cy, size, color, rotate = 0) => {
    g.save();
    g.translate(cx, cy);
    if (rotate) g.rotate(rotate);
    g.fillStyle = color;
    g.font = `bold ${size}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(str, 0, size * 0.05);
    g.restore();
  };
  const mx = (x) => (face === 'sideL' ? W - x : x);
  if (skin.num && face !== 'roof') {
    const cx = side ? mx(ux(-0.8)) : W * 0.5, cy = side ? hy(0.72) : H * 0.5, rad = side ? H * 0.2 : H * 0.28;
    g.fillStyle = '#f4f4f0';
    g.beginPath(); g.arc(cx, cy, rad, 0, Math.PI * 2); g.fill();
    // the bonnet's number reads from the driver's seat, the sides from beside the cart
    text(skin.num, cx, cy, rad * 1.35, '#141414', side ? 0 : Math.PI / 2);
  }
  if (L === 'police' && side) text('POLICE', mx(ux(-0.8)), hy(0.75), H * 0.12, col[1]);
  if (side) {
    // the seat opening, and above the bonnet: nothing there
    const cut = (x0, x1, y0, y1) => {
      const a = mx(ux(x0)), b = mx(ux(x1));
      g.clearRect(Math.min(a, b), hy(y1), Math.abs(b - a), hy(y0) - hy(y1));
    };
    cut(-0.45, 0.55, 0.56, 1.04);
    cut(0.55, 1.16, 0.92, 1.04);
  }
  cartCanvasCache.set(key, c);
  return c;
}

// a CSS background for a cart tile in the menus: its side, nose to the right,
// over the canopy colour where the seat opening is
export function cartSwatch(skin) {
  try {
    const c = cartCanvas(skin, 'sideR');
    return `url(${c.toDataURL()}) center / 100% 100%, ${skin.seat}`;
  } catch (e) {
    return skin.body;
  }
}
