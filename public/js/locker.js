// Your locker: dinars, what you've unlocked, and how each loadout is set up.
//
// Two ways to keep it:
//  - as a guest, in this browser (localStorage);
//  - signed in, on the server — the server rolls crates and keeps dinars,
//    and this module just mirrors what it sends.

import { RARITIES, FINISHES, OUTFITS, GUN_IDS, FINISH, OUTFIT } from './skins.js';

export const CRATES = {
  gun: { id: 'gun', name: 'Armory Crate', price: 100, blurb: 'One random gun finish for one of your five guns.' },
  outfit: { id: 'outfit', name: 'Wardrobe Crate', price: 100, blurb: 'One random outfit for your soldier.' },
  bazaar: { id: 'bazaar', name: 'Bazaar Case', price: 500, blurb: 'Bright, loud, not remotely military. Better odds, no commons — gun finishes and outfits.' },
};
export const CRATE_COST = CRATES.gun.price;
export const STARTING_DINARS = 300;
const REFUND = { common: 20, uncommon: 30, rare: 50, epic: 80, legendary: 150 };
const BAZAAR_WEIGHTS = { uncommon: 42, rare: 33, epic: 18, legendary: 7 };
const PRIMARY = ['smg', 'lmg', 'shotgun', 'sniper'];

const KEY = 'souk-siege-locker-v1';

function blank() {
  return { dinars: STARTING_DINARS, guns: [], outfits: ['standard'], equip: { outfit: 'standard', guns: {}, pistol: {}, nade: {} }, opened: 0 };
}

function normalise(s) {
  if (!s || typeof s !== 'object') s = blank();
  s.guns = Array.isArray(s.guns) ? s.guns : [];
  s.outfits = Array.isArray(s.outfits) ? s.outfits : ['standard'];
  if (!s.outfits.includes('standard')) s.outfits.unshift('standard');
  s.equip = s.equip && typeof s.equip === 'object' ? s.equip : {};
  s.equip.outfit = s.equip.outfit || 'standard';
  s.equip.guns = s.equip.guns || {};
  s.equip.pistol = s.equip.pistol || {};
  s.equip.nade = s.equip.nade || {};
  // older guest lockers kept one pistol finish for every loadout
  if (s.equip.guns.pistol) {
    for (const ld of ['0', '1', '2', '3']) if (!s.equip.pistol[ld]) s.equip.pistol[ld] = s.equip.guns.pistol;
    delete s.equip.guns.pistol;
  }
  s.dinars = Math.max(0, Math.floor(Number(s.dinars) || 0));
  return s;
}

function loadGuest() {
  try {
    return normalise(JSON.parse(localStorage.getItem(KEY) || 'null'));
  } catch (e) {
    return normalise(null);
  }
}

let guest = loadGuest();
let account = null;       // the server's copy of your locker when signed in
let server = null;        // send function to the server, when signed in
const listeners = new Set();
const pending = [];       // crate openings waiting on the server

function state() {
  return account || guest;
}

function changed() {
  if (!account) {
    try {
      localStorage.setItem(KEY, JSON.stringify(guest));
    } catch (e) {
      /* storage unavailable: the locker still works for this visit */
    }
  }
  for (const fn of listeners) fn();
}

function pickRarity(weights) {
  const entries = weights ? Object.entries(weights) : RARITIES.map((r) => [r.id, r.weight]);
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let x = Math.random() * total;
  for (const [id, w] of entries) {
    x -= w;
    if (x <= 0) return id;
  }
  return entries[0][0];
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];

// a random prize without paying — the real roll for guests, and the reel's filler tiles
export function roll(kind) {
  if (kind === 'gun') {
    const rarity = pickRarity();
    const f = pick(FINISHES.filter((x) => x.rarity === rarity && x.crate === 'armory'));
    return { kind: 'gun', weapon: pick(GUN_IDS), finish: f.id, rarity };
  }
  if (kind === 'outfit') {
    const rarity = pickRarity();
    const o = pick(OUTFITS.filter((x) => x.rarity === rarity && x.crate === 'wardrobe'));
    return { kind: 'outfit', outfit: o.id, rarity };
  }
  const rarity = pickRarity(BAZAAR_WEIGHTS);
  const guns = FINISHES.filter((x) => x.rarity === rarity && x.crate === 'bazaar');
  const outfits = OUTFITS.filter((x) => x.rarity === rarity && x.crate === 'bazaar');
  if (outfits.length && (!guns.length || Math.random() < 0.4)) return { kind: 'outfit', outfit: pick(outfits).id, rarity };
  return { kind: 'gun', weapon: pick(GUN_IDS), finish: pick(guns).id, rarity };
}

export const locker = {
  get dinars() {
    return state().dinars;
  },

  get signedIn() {
    return !!account;
  },

  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  // -- signing in and out --

  useAccount(lk, send) {
    account = normalise(lk);
    server = send;
    changed();
  },

  updateAccount(lk) {
    if (!account) return;
    account = normalise(lk);
    changed();
  },

  signOut() {
    account = null;
    server = null;
    guest = loadGuest();
    changed();
  },

  guestData() {
    return guest;
  },

  // -- dinars --

  // dinars from a match; when signed in the server sends the new balance
  earn(n, balance) {
    const s = state();
    if (account && typeof balance === 'number') s.dinars = balance;
    else s.dinars += Math.max(0, Math.floor(n));
    changed();
  },

  // -- what you own --

  ownsGun(weapon, finish) {
    return state().guns.includes(`${weapon}:${finish}`);
  },

  ownsOutfit(id) {
    return state().outfits.includes(id);
  },

  gunSkins(weapon) {
    return state().guns.filter((k) => k.startsWith(weapon + ':')).map((k) => k.split(':')[1]).filter((f) => FINISH[f]);
  },

  outfits() {
    return state().outfits.filter((o) => OUTFIT[o]);
  },

  totalGunSkins() {
    return FINISHES.length * GUN_IDS.length;
  },

  // -- crates --

  // resolves to the prize, or null if you can't afford it
  open(kind) {
    const crate = CRATES[kind];
    const s = state();
    if (!crate || s.dinars < crate.price) return Promise.resolve(null);
    if (account) {
      return new Promise((resolve) => {
        const job = { resolve, done: false };
        pending.push(job);
        server({ t: 'crate', kind });
        // never leave the reel waiting on a server that went quiet
        setTimeout(() => {
          if (!job.done) {
            job.done = true;
            resolve(null);
          }
        }, 8000);
      });
    }
    s.dinars -= crate.price;
    s.opened = (s.opened || 0) + 1;
    const prize = roll(kind);
    if (prize.kind === 'gun') {
      const key = `${prize.weapon}:${prize.finish}`;
      prize.dup = s.guns.includes(key);
      if (!prize.dup) s.guns.push(key);
    } else {
      prize.dup = s.outfits.includes(prize.outfit);
      if (!prize.dup) s.outfits.push(prize.outfit);
    }
    prize.refund = prize.dup ? REFUND[prize.rarity] : 0;
    s.dinars += prize.refund;
    changed();
    return Promise.resolve(prize);
  },

  // the server's answer to a crate
  crateResult(prize, lk) {
    this.updateAccount(lk);
    while (pending.length) {
      const job = pending.shift();
      if (job.done) continue;
      job.done = true;
      job.resolve(prize);
      break;
    }
  },

  // -- equipping --

  equippedGun(weapon) {
    const f = state().equip.guns[weapon];
    return f && FINISH[f] && this.ownsGun(weapon, f) ? f : null;
  },

  equippedPistol(ld) {
    const f = state().equip.pistol[String(ld)];
    return f && FINISH[f] && this.ownsGun('pistol', f) ? f : null;
  },

  equippedOutfit() {
    const o = state().equip.outfit;
    return OUTFIT[o] && this.ownsOutfit(o) ? o : 'standard';
  },

  nadeFor(ld) {
    return String(ld) === '2' && state().equip.nade['2'] === 'flash' ? 'flash' : 'frag';
  },

  equipGun(weapon, finish) {
    if (finish && !this.ownsGun(weapon, finish)) return;
    const e = state().equip;
    if (finish) e.guns[weapon] = finish;
    else delete e.guns[weapon];
    this.saved();
  },

  equipPistol(ld, finish) {
    if (finish && !this.ownsGun('pistol', finish)) return;
    const e = state().equip;
    if (finish) e.pistol[String(ld)] = finish;
    else delete e.pistol[String(ld)];
    this.saved();
  },

  equipOutfit(id) {
    if (!this.ownsOutfit(id)) return;
    state().equip.outfit = id;
    this.saved();
  },

  setNade(ld, kind) {
    if (String(ld) !== '2') return;
    state().equip.nade['2'] = kind === 'flash' ? 'flash' : 'frag';
    this.saved();
  },

  saved() {
    if (account && server) server({ t: 'equip', equip: account.equip });
    changed();
  },

  // what other players should see for a loadout, sent to the server
  cosmetics(ld = 0) {
    const g = {};
    const primary = PRIMARY[ld] || 'smg';
    const f = this.equippedGun(primary);
    if (f) g[primary] = f;
    const p = this.equippedPistol(ld);
    if (p) g.pistol = p;
    return { o: this.equippedOutfit(), g };
  },
};
