// Your locker: dinars, what you have unlocked, and what you have equipped.
// Kept in this browser (localStorage) — there are no accounts yet.

import { RARITIES, FINISHES, OUTFITS, GUN_IDS, FINISH, OUTFIT } from './skins.js';

export const CRATE_COST = 100;
export const STARTING_DINARS = 300;
// what a duplicate gives back, by rarity
const REFUND = { common: 20, uncommon: 30, rare: 50, epic: 80, legendary: 150 };

const KEY = 'souk-siege-locker-v1';

function load() {
  let s = null;
  try {
    s = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch (e) {
    s = null;
  }
  if (!s || typeof s !== 'object') s = { dinars: STARTING_DINARS, guns: [], outfits: ['standard'], equip: { outfit: 'standard', guns: {} }, opened: 0 };
  s.guns = Array.isArray(s.guns) ? s.guns : [];
  s.outfits = Array.isArray(s.outfits) ? s.outfits : ['standard'];
  if (!s.outfits.includes('standard')) s.outfits.unshift('standard');
  s.equip = s.equip || { outfit: 'standard', guns: {} };
  s.equip.guns = s.equip.guns || {};
  s.dinars = Math.max(0, Math.floor(Number(s.dinars) || 0));
  return s;
}

const state = load();
const listeners = new Set();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    /* storage unavailable: the locker still works for this visit */
  }
  for (const fn of listeners) fn();
}

function pickRarity() {
  const total = RARITIES.reduce((a, r) => a + r.weight, 0);
  let x = Math.random() * total;
  for (const r of RARITIES) {
    x -= r.weight;
    if (x <= 0) return r.id;
  }
  return 'common';
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// a random prize, without taking payment — used for the reel's filler tiles too
export function rollGun() {
  const rarity = pickRarity();
  const f = pick(FINISHES.filter((x) => x.rarity === rarity));
  return { kind: 'gun', weapon: pick(GUN_IDS), finish: f.id, rarity };
}

export function rollOutfit() {
  const rarity = pickRarity();
  const pool = OUTFITS.filter((x) => x.rarity === rarity && !x.starter);
  const o = pick(pool.length ? pool : OUTFITS.filter((x) => !x.starter));
  return { kind: 'outfit', outfit: o.id, rarity: o.rarity };
}

export const locker = {
  get dinars() {
    return state.dinars;
  },
  get opened() {
    return state.opened || 0;
  },

  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  earn(n) {
    state.dinars += Math.max(0, Math.floor(n));
    save();
  },

  ownsGun(weapon, finish) {
    return state.guns.includes(`${weapon}:${finish}`);
  },

  ownsOutfit(id) {
    return state.outfits.includes(id);
  },

  gunSkins(weapon) {
    return state.guns.filter((k) => k.startsWith(weapon + ':')).map((k) => k.split(':')[1]).filter((f) => FINISH[f]);
  },

  outfits() {
    return state.outfits.filter((o) => OUTFIT[o]);
  },

  // open a crate: pay, roll, add to the locker. Returns the prize, or null if you can't afford it.
  open(kind) {
    if (state.dinars < CRATE_COST) return null;
    state.dinars -= CRATE_COST;
    state.opened = (state.opened || 0) + 1;
    let prize;
    if (kind === 'gun') {
      prize = rollGun();
      const key = `${prize.weapon}:${prize.finish}`;
      prize.dup = state.guns.includes(key);
      if (!prize.dup) state.guns.push(key);
    } else {
      prize = rollOutfit();
      prize.dup = state.outfits.includes(prize.outfit);
      if (!prize.dup) state.outfits.push(prize.outfit);
    }
    prize.refund = prize.dup ? REFUND[prize.rarity] : 0;
    state.dinars += prize.refund;
    save();
    return prize;
  },

  equippedGun(weapon) {
    const f = state.equip.guns[weapon];
    return f && FINISH[f] && this.ownsGun(weapon, f) ? f : null;
  },

  equippedOutfit() {
    const o = state.equip.outfit;
    return OUTFIT[o] && this.ownsOutfit(o) ? o : 'standard';
  },

  equipGun(weapon, finish) {
    if (finish && !this.ownsGun(weapon, finish)) return;
    if (finish) state.equip.guns[weapon] = finish;
    else delete state.equip.guns[weapon];
    save();
  },

  equipOutfit(id) {
    if (!this.ownsOutfit(id)) return;
    state.equip.outfit = id;
    save();
  },

  // what other players should see, sent to the server
  cosmetics() {
    const g = {};
    for (const w of GUN_IDS) {
      const f = this.equippedGun(w);
      if (f) g[w] = f;
    }
    return { o: this.equippedOutfit(), g };
  },

  totalGunSkins() {
    return FINISHES.length * GUN_IDS.length;
  },
};
