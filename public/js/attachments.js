// Gun attachments, unlocked by kills with that gun.
//
// Each one lists what it changes on the weapon: a multiplier on spread,
// recoil or reload, a different sight, a bigger magazine. `apply` below
// folds a set of them into the weapon's numbers.
//
// The pistol is the same gun for every loadout, so its attachments follow
// you between classes.

export const SLOT_NAMES = {
  optic: 'Optic',
  muzzle: 'Muzzle',
  mag: 'Magazine',
  ammo: 'Ammo',
  trigger: 'Trigger',
  laser: 'Laser',
  grip: 'Grip',
  barrel: 'Barrel',
};

// mods: mag (x capacity), reload (x time), spread (x), recoil (x),
// move (x sprint/walk speed), sight / zoom / adsTime (the sight picture),
// flash (x muzzle flash), quiet (suppressed), auto (fires while held),
// slug (a shotgun firing one heavy slug)
const reddot = (unlock) => ({ id: 'reddot', name: 'Red Dot', unlock, blurb: 'A single dot. Fast and clear.', mods: { sight: 'reddot', zoom: 1.1 } });
const holo = (unlock) => ({ id: 'holo', name: 'Holographic', unlock, blurb: 'A 2× ring and dot.', mods: { sight: 'holo', zoom: 2.0, adsTime: 0.2 } });
const acog = (unlock) => ({ id: 'acog', name: '3× ACOG', unlock, blurb: 'A short, chunky 3× sight with a chevron.', mods: { sight: 'scope', zoom: 3.0, adsTime: 0.26 } });
const hider = (unlock) => ({ id: 'hider', name: 'Flash Hider', unlock, blurb: 'Hides most of your muzzle flash.', mods: { flash: 0.3 } });
const brake = (unlock) => ({ id: 'brake', name: 'Muzzle Brake', unlock, blurb: 'Slightly less spread and recoil.', mods: { spread: 0.9, recoil: 0.9 } });
const longbrake = (unlock) => ({ id: 'longbrake', name: 'Long Muzzle Brake', unlock, blurb: 'A heavier brake: less spread and recoil than the short one.', mods: { spread: 0.8, recoil: 0.78 } });
const suppressor = (unlock) => ({ id: 'suppressor', name: 'Suppressor', unlock, blurb: 'Quiet, barely any flash, and you stay off enemy minimaps.', mods: { quiet: true, flash: 0.25 } });
const noMuzzle = { id: 'none', name: 'No Muzzle', unlock: 0, blurb: 'Bare barrel.', mods: {} };
const fastMag = (unlock, rounds) => ({ id: 'fast', name: 'Fast Mag', unlock, blurb: `Same ${rounds} rounds, 10% quicker to reload.`, mods: { reload: 0.9 } });
// lasers tighten your hip fire (hip: a multiplier on the spread you have when not aiming) — and everyone can see the beam
const noLaser = { id: 'none', name: 'No Laser', unlock: 0, blurb: 'Nothing under the barrel.', mods: {} };
const redLaser = (unlock) => ({ id: 'red', name: 'Red Laser', unlock, blurb: 'Hip fire 30% tighter. Enemies can see the beam.', mods: { hip: 0.7, laser: 'red' } });
const greenLaser = (unlock) => ({ id: 'green', name: 'Green Laser', unlock, blurb: 'Hip fire 70% tighter. Enemies can see the beam.', mods: { hip: 0.3, laser: 'green' } });
const lasers = (red, green) => [noLaser, redLaser(red), greenLaser(green)];
// grips: a hand on the fore-end
const noGrip = { id: 'none', name: 'No Grip', unlock: 0, blurb: 'Bare fore-end.', mods: {} };
const angledGrip = (unlock) => ({ id: 'angled', name: 'Angled Grip', unlock, blurb: 'Tighter from the hip, and a little quicker on your feet.', mods: { hip: 0.85, move: 1.04 } });
const straightGrip = (unlock) => ({ id: 'straight', name: 'Straight Grip', unlock, blurb: 'A little less spread and recoil.', mods: { spread: 0.94, recoil: 0.94 } });
const shortGrip = (unlock) => ({ id: 'short', name: 'Short Grip', unlock, blurb: 'Noticeably less spread and recoil.', mods: { spread: 0.85, recoil: 0.85 } });
const grips = (straight, angled, short) => [noGrip, straightGrip(straight), angledGrip(angled), shortGrip(short)];

export const ATTACHMENTS = {
  smg: {
    optic: [
      { id: 'irons', name: 'Iron Sights', unlock: 0, blurb: 'Standard post and notch.', mods: {} },
      reddot(10),
      { ...holo(25), blurb: 'The LMG’s 2× sight: a ring and a dot.' },
      acog(50),
      { id: 'scope6', name: '6× Scope', unlock: 100, blurb: 'The Saqr’s scope, bolted onto an SMG. Slowest to aim.', mods: { sight: 'scope', zoom: 6.0, adsTime: 0.32 } },
    ],
    muzzle: [noMuzzle, hider(10), brake(25), suppressor(50), longbrake(100)],
    mag: [
      { id: 'normal', name: 'Standard Mag', unlock: 0, blurb: '30 rounds.', mods: {} },
      fastMag(25, 30),
      { id: 'large', name: 'Large Mag', unlock: 100, blurb: '50% more rounds: 45 a magazine.', mods: { mag: 1.5 } },
    ],
    laser: lasers(15, 50),
    grip: grips(20, 25, 100),
  },
  lmg: {
    optic: [
      { id: 'irons', name: 'Iron Sights', unlock: 0, blurb: 'Standard post and notch.', mods: { sight: 'irons', zoom: 1.2, adsTime: 0.28 } },
      { ...reddot(10), mods: { sight: 'reddot', zoom: 1.1, adsTime: 0.26 } },
      { ...holo(25), blurb: 'The 2× ring and dot the Barakh came with.', mods: { sight: 'holo', zoom: 2.0, adsTime: 0.28 } },
      { ...acog(50), mods: { sight: 'scope', zoom: 3.0, adsTime: 0.34 } },
      { id: 'scope6', name: '6× Scope', unlock: 100, blurb: 'The Saqr’s scope on a machine gun. Slowest to aim.', mods: { sight: 'scope', zoom: 6.0, adsTime: 0.4 } },
    ],
    muzzle: [noMuzzle, hider(10), brake(25), suppressor(50), longbrake(100)],
    mag: [
      { id: 'normal', name: 'Standard Box', unlock: 0, blurb: '100 rounds.', mods: {} },
      { ...fastMag(25, 100), name: 'Fast Box' },
      { id: 'large', name: 'Large Box', unlock: 100, blurb: '50% more rounds: 150 a box.', mods: { mag: 1.5 } },
    ],
    laser: lasers(15, 50),
    grip: grips(20, 25, 100),
  },
  shotgun: {
    optic: [
      { id: 'irons', name: 'Ghost Ring', unlock: 0, blurb: 'A bead inside a big open ring.', mods: {} },
      reddot(25),
      holo(50),
    ],
    ammo: [
      { id: 'buck', name: 'Buckshot', unlock: 0, blurb: 'Nine pellets. Devastating up close.', mods: {} },
      { id: 'slug', name: 'Slugs', unlock: 10, blurb: 'One heavy slug: fires like a rifle, reaches across the street.', mods: { slug: true } },
    ],
    mag: [
      { id: 'normal', name: 'Standard Tube', unlock: 0, blurb: 'Six shells.', mods: {} },
      { id: 'small', name: 'Short Tube', unlock: 25, blurb: 'Four shells, but quicker to fill and lighter to run with.', mods: { mag: 0.667, reload: 0.85, move: 1.08 } },
    ],
    muzzle: [noMuzzle, suppressor(50)],
    laser: lasers(25, 50),
    grip: grips(10, 25, 50),
  },
  sniper: {
    optic: [
      { id: 'scope6', name: '6× Scope', unlock: 0, blurb: 'The Saqr’s own long scope.', mods: {} },
      { ...acog(10), blurb: 'A short 3× sight: quicker to aim, easier up close.' },
      { ...reddot(100), blurb: 'No magnification at all. For a quickscoper.', mods: { sight: 'reddot', zoom: 1.1, adsTime: 0.2 } },
    ],
    muzzle: [noMuzzle, suppressor(10), brake(25), longbrake(100)],
    mag: [
      { id: 'normal', name: 'Standard Mag', unlock: 0, blurb: 'Five rounds.', mods: {} },
      fastMag(25, 5),
      { id: 'ext', name: 'Extended Mag', unlock: 50, blurb: 'Eight rounds a magazine.', mods: { mag: 1.6 } },
    ],
    laser: lasers(25, 75),
    grip: grips(10, 25, 50),
  },
  heavy: {
    optic: [
      { id: 'scope8', name: '8× Scope', unlock: 0, blurb: 'The Kabir’s own long scope, with a green chevron.', mods: {} },
      { ...reddot(100), blurb: 'No magnification at all. For a very brave quickscoper.', mods: { sight: 'reddot', zoom: 1.1, adsTime: 0.3 } },
    ],
    muzzle: [noMuzzle, suppressor(300)],
    mag: [
      { id: 'normal', name: 'Single Round', unlock: 0, blurb: 'One round, then a full reload.', mods: {} },
      { ...fastMag(200, 1), name: 'Quick Mag', blurb: 'Still one round, but 10% quicker to reload.' },
    ],
    laser: [noLaser, redLaser(50), greenLaser(150)],
    grip: [noGrip, angledGrip(200)],
  },
  pistol: {
    optic: [
      { id: 'irons', name: 'Iron Sights', unlock: 0, blurb: 'Standard post and notch.', mods: {} },
      reddot(10),
    ],
    muzzle: [noMuzzle, brake(10), suppressor(25), longbrake(50)],
    mag: [
      { id: 'normal', name: 'Standard Mag', unlock: 0, blurb: '12 rounds.', mods: {} },
      fastMag(25, 12),
      { id: 'drum', name: 'Drum Mag', unlock: 100, blurb: '24 rounds, but a quarter slower to reload and you lose the pistol’s sprint bonus.', mods: { mag: 2, reload: 1.25, move: 0.926 } },
    ],
    trigger: [
      { id: 'semi', name: 'Semi-Auto', unlock: 0, blurb: 'One shot a trigger pull.', mods: {} },
      { id: 'auto', name: 'Full Auto', unlock: 100, blurb: 'Hold the trigger down. Much less accurate.', mods: { auto: true, spread: 1.6 } },
    ],
    laser: lasers(25, 75),
  },
  revolver: {
    optic: [
      { id: 'irons', name: 'Iron Sights', unlock: 0, blurb: 'A blade and a notch.', mods: {} },
      reddot(10),
      { ...acog(25), blurb: 'A 3× sight on a revolver. Why not.', mods: { sight: 'scope', zoom: 3.0, adsTime: 0.24 } },
      { id: 'scope6', name: '6× Scope', unlock: 100, blurb: 'A 6× scope on a revolver. Slowest to aim.', mods: { sight: 'scope', zoom: 6.0, adsTime: 0.3 } },
    ],
    mag: [
      { id: 'normal', name: '6-Round Cylinder', unlock: 0, blurb: 'Six rounds.', mods: {} },
      { id: 'cyl8', name: '8-Round Cylinder', unlock: 50, blurb: 'Eight rounds.', mods: { mag: 1.334 } },
      { id: 'fast', name: 'Fast Cylinder', unlock: 75, blurb: 'Six rounds, 10% quicker to reload with a speedloader.', mods: { reload: 0.9 } },
    ],
    laser: lasers(25, 75),
    barrel: [
      { id: 'medium', name: 'Medium Barrel', unlock: 0, blurb: 'The barrel it comes with.', mods: {} },
      { id: 'long', name: 'Long Barrel', unlock: 50, blurb: 'Even more accurate shots.', mods: { spread: 0.8, recoil: 0.9 } },
      { id: 'short', name: 'Short Barrel', unlock: 100, blurb: 'Normal accuracy, tighter from the hip.', mods: { hip: 0.75 } },
    ],
  },
};

// attachments are earned: every unlock takes half as many kills again
for (const w in ATTACHMENTS) {
  for (const slot in ATTACHMENTS[w]) {
    ATTACHMENTS[w][slot] = ATTACHMENTS[w][slot].map((a) => ({ ...a, unlock: Math.round(a.unlock * 1.5) }));
  }
}

export const HAS_ATTACHMENTS = Object.keys(ATTACHMENTS);

// the slots a gun has, in the order they're shown
export function slotsFor(weapon) {
  const w = ATTACHMENTS[weapon];
  return w ? Object.keys(w).map((id) => ({ id, name: SLOT_NAMES[id] || id })) : [];
}

export function slotList(weapon, slot) {
  const w = ATTACHMENTS[weapon];
  return (w && w[slot]) || [];
}

export function find(weapon, slot, id) {
  return slotList(weapon, slot).find((a) => a.id === id) || slotList(weapon, slot)[0] || null;
}

// the unlocks a gun offers, in the order they come
export function unlockSteps(weapon) {
  const out = new Map();
  for (const slot of slotsFor(weapon)) {
    for (const a of slotList(weapon, slot.id)) {
      if (!a.unlock) continue;
      if (!out.has(a.unlock)) out.set(a.unlock, []);
      out.get(a.unlock).push({ ...a, slot: slot.id });
    }
  }
  return [...out.entries()].sort((a, b) => a[0] - b[0]);
}

export function nextUnlock(weapon, kills) {
  for (const [at, items] of unlockSteps(weapon)) {
    if (kills < at) return { at, items, left: at - kills };
  }
  return null;
}

// fold the fitted attachments into a weapon's numbers
export function apply(def, fitted) {
  if (!fitted) return def;
  const out = { ...def, attach: fitted };
  for (const slot of slotsFor(def.id)) {
    const a = find(def.id, slot.id, fitted[slot.id]);
    if (!a) continue;
    const m = a.mods;
    if (m.mag) out.mag = Math.max(1, Math.round(def.mag * m.mag));
    if (m.reload) out.reload = +(out.reload * m.reload).toFixed(3);
    if (m.spread) {
      out.base = +(out.base * m.spread).toFixed(3);
      out.bloomShot = +(out.bloomShot * m.spread).toFixed(3);
      out.bloomMax = +(out.bloomMax * m.spread).toFixed(3);
      out.move = +(out.move * m.spread).toFixed(3);
      if (out.pelletSpread) out.pelletSpread = +(out.pelletSpread * m.spread).toFixed(3);
    }
    if (m.recoil) {
      out.recoilUp = +(out.recoilUp * m.recoil).toFixed(5);
      out.recoilSide = +(out.recoilSide * m.recoil).toFixed(5);
      out.kick = +(out.kick * m.recoil).toFixed(4);
    }
    if (m.move) out.moveMul = +(out.moveMul * m.move).toFixed(3);
    if (m.sight) out.sight = m.sight;
    if (m.zoom) out.zoom = m.zoom;
    if (m.adsTime) out.adsTime = m.adsTime;
    if (m.flash) out.flash = m.flash;
    if (m.quiet) out.quiet = true;
    if (m.auto) out.auto = true;
    if (m.hip) out.hip = m.hip;
    if (m.laser) out.laser = m.laser;
    // a slug turns the shotgun into a single hard-hitting rifle round
    if (m.slug) {
      out.slug = true;
      out.pellets = 1;
      out.pelletSpread = 0;
      out.perShell = true;
      out.dmg = 85;
      out.range = 200;
      out.base = 1.4;
      out.bloomShot = 1.2;
      out.bloomMax = 3.5;
      out.adsMul = 0.25;
      out.tracer = 0xffe0a0;
    }
  }
  // a bigger magazine still holds the same spare rounds in total
  return out;
}

// what's fitted, dropping anything not unlocked yet
export function clean(weapon, fitted, kills) {
  const out = {};
  for (const slot of slotsFor(weapon)) {
    const want = fitted && fitted[slot.id];
    const a = slotList(weapon, slot.id).find((x) => x.id === want);
    out[slot.id] = a && kills >= a.unlock ? a.id : slotList(weapon, slot.id)[0].id;
  }
  return out;
}

// what the server needs to know about (only the ones that change damage)
export function serverFlags(weapon, fitted) {
  return { slug: !!(weapon === 'shotgun' && fitted && fitted.ammo === 'slug') };
}
