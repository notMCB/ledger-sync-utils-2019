import { apply as applyAttachments } from './attachments.js';

// Weapon handling. Damage lives on the server (server/server.py WEAPONS);
// the numbers repeated here are for display and for the client's feel.
// Spreads are cone half-angles in degrees.

export const WEAPONS = {
  smg: {
    id: 'smg', name: 'Qadir SMG', short: 'SMG', auto: true, rpm: 800, mag: 30, reserve: 75,
    reload: 2.1, pellets: 1, dmg: 24, range: 120,
    base: 1.5, bloomShot: 0.32, bloomMax: 5.0, recover: 9, move: 1.6, air: 5,
    adsMul: 0.32, sight: 'irons', zoom: 1.2, adsTime: 0.16, moveMul: 1.05,
    recoilUp: 0.0105, recoilSide: 0.004, kick: 0.035,
    tracer: 0xffd27a, sound: 'smg',
  },
  lmg: {
    id: 'lmg', name: 'Barakh LMG', short: 'LMG', auto: true, rpm: 640, mag: 100, reserve: 100,
    reload: 4.6, pellets: 1, dmg: 30, range: 160,
    base: 2.2, bloomShot: 0.28, bloomMax: 6.5, recover: 6, move: 2.4, air: 6,
    adsMul: 0.3, sight: 'holo', zoom: 2.0, adsTime: 0.28, moveMul: 0.86,
    recoilUp: 0.0125, recoilSide: 0.006, kick: 0.05,
    tracer: 0xff9a4a, sound: 'lmg',
  },
  shotgun: {
    id: 'shotgun', name: 'Hamada 12-gauge', short: 'Shotgun', auto: false, rpm: 70, mag: 6, reserve: 18,
    reload: 0.52, pellets: 9, dmg: 16, range: 60, perShell: true,
    base: 4.2, pelletSpread: 4.2, bloomShot: 1.0, bloomMax: 2.0, recover: 4, move: 1.0, air: 3,
    adsMul: 0.72, sight: 'irons', zoom: 1.15, adsTime: 0.2, moveMul: 0.98,
    recoilUp: 0.05, recoilSide: 0.012, kick: 0.12,
    tracer: 0xffe0a0, sound: 'shotgun',
  },
  sniper: {
    id: 'sniper', name: 'Saqr .338', short: 'Sniper', auto: false, rpm: 45, mag: 5, reserve: 12,
    reload: 3.2, pellets: 1, dmg: 95, range: 300, bolt: true,
    base: 7.0, bloomShot: 4, bloomMax: 6, recover: 5, move: 5, air: 9,
    adsMul: 0.004, sight: 'scope', zoom: 6.0, adsTime: 0.3, moveMul: 0.92,
    recoilUp: 0.06, recoilSide: 0.01, kick: 0.14,
    tracer: 0xfff2c0, sound: 'sniper',
  },
  // the Assault's (and Breacher's) grenade launcher: it fires your grenades, flat and fast,
  // and they go off where they land. Not a bullet: see fireLauncher in game.js
  // the Engineer's RPG: a rocket, straight and fast, that goes off on whatever it hits.
  // A direct hit on a player kills; the blast is bigger than a frag's; vehicles and
  // cover walls go up. Three rockets a life, and they are the perk's uses, not your grenades.
  rpg: {
    id: 'rpg', name: 'Saqr RPG', short: 'RPG', auto: false, rpm: 40, mag: 3, reserve: 0,
    reload: 2.8, pellets: 1, dmg: 160, range: 300, launcher: true, rocket: true, blurb: 'A rocket, dead straight. Kills what it hits, blasts what is near, wrecks vehicles and cover walls.',
    base: 0.3, bloomShot: 0, bloomMax: 0, recover: 9, move: 0.6, air: 2,
    adsMul: 0.3, sight: 'irons', zoom: 1.5, adsTime: 0.3, moveMul: 0.85,
    recoilUp: 0.12, recoilSide: 0.02, kick: 0.3,
    tracer: 0xffffff, sound: 'launcher',
  },
  launcher: {
    id: 'launcher', name: 'Qanas 40mm', short: 'Launcher', auto: false, rpm: 50, mag: 3, reserve: 0,
    reload: 2.2, pellets: 1, dmg: 125, range: 150, launcher: true, blurb: 'Fires whichever grenade you carry. Goes off on landing.',
    base: 0.6, bloomShot: 0, bloomMax: 0, recover: 9, move: 0.8, air: 3,
    adsMul: 0.5, sight: 'irons', zoom: 1.15, adsTime: 0.22, moveMul: 0.96,
    recoilUp: 0.05, recoilSide: 0.01, kick: 0.14,
    tracer: 0xffffff, sound: 'launcher',
  },
  knife: {
    id: 'knife', name: 'Jambiya', short: 'Knife', melee: true, auto: false, rpm: 110, mag: 0, reserve: 0,
    reload: 0, pellets: 1, dmg: 55, range: 2.4, blurb: 'A kill to the head or from behind; two stabs from the front.',
    base: 0, bloomShot: 0, bloomMax: 0, recover: 9, move: 0, air: 0,
    adsMul: 1, sight: 'none', zoom: 1, adsTime: 0.12, moveMul: 1.12,
    recoilUp: 0, recoilSide: 0, kick: 0.02,
    tracer: 0xffffff, sound: 'knife',
  },
  pistol: {
    id: 'pistol', name: 'Nimr 9mm', short: 'Pistol', auto: false, rpm: 380, mag: 12, reserve: 30,
    reload: 1.6, pellets: 1, dmg: 34, range: 120,
    base: 1.1, bloomShot: 0.85, bloomMax: 4.5, recover: 7, move: 1.2, air: 4,
    adsMul: 0.35, sight: 'irons', zoom: 1.2, adsTime: 0.13, moveMul: 1.08,
    recoilUp: 0.02, recoilSide: 0.006, kick: 0.07,
    tracer: 0xffd27a, sound: 'pistol',
  },
  // the Marksman's other rifle: one round, one kill, and the whole town hears it
  heavy: {
    id: 'heavy', name: 'Kabir .50', short: 'Heavy', auto: false, rpm: 30, mag: 1, reserve: 8,
    reload: 3.4, pellets: 1, dmg: 130, range: 400, bolt: true, oneShot: true,
    base: 8.0, bloomShot: 5, bloomMax: 8, recover: 4, move: 6, air: 10,
    adsMul: 0.003, sight: 'scope', zoom: 8.0, adsTime: 0.6, moveMul: 0.72, turnMul: 0.85, reticle: 'tri',
    recoilUp: 0.11, recoilSide: 0.015, kick: 0.22,
    tracer: 0xfff2c0, sound: 'heavy',
  },
  // the other secondary: a silver six-shooter that reaches out
  revolver: {
    id: 'revolver', name: 'Asad .44', short: 'Revolver', auto: false, rpm: 150, mag: 6, reserve: 24,
    reload: 2.4, pellets: 1, dmg: 40, range: 160,
    base: 0.75, bloomShot: 0.7, bloomMax: 3.0, recover: 7, move: 1.0, air: 4,
    adsMul: 0.3, sight: 'irons', zoom: 1.25, adsTime: 0.15, moveMul: 1.05,
    recoilUp: 0.032, recoilSide: 0.007, kick: 0.1,
    tracer: 0xffe0a0, sound: 'revolver',
  },
  // the Breacher's other primary: a flamethrower, fuel instead of rounds
  flamer: {
    id: 'flamer', name: 'Nar Flamethrower', short: 'Flamer', auto: true, rpm: 400, mag: 100, reserve: 0,
    reload: 0, pellets: 3, dmg: 7, range: 6, flame: true, fuelPerShot: 0.75,
    base: 3.0, bloomShot: 0, bloomMax: 0, recover: 9, move: 0.5, air: 1,
    adsMul: 1.0, sight: 'irons', zoom: 1.05, adsTime: 0.14, moveMul: 0.9, crosshair: 'circle',
    recoilUp: 0.0, recoilSide: 0.0, kick: 0.01,
    tracer: 0xff9a4a, sound: 'flamer',
  },
  // the Assault's other SMG: a compact room-clearer that empties in under a second
  pdw: {
    id: 'pdw', name: 'Barq PDW', short: 'PDW', auto: true, rpm: 1050, mag: 17, reserve: 68,
    reload: 1.9, pellets: 1, dmg: 30, range: 60,
    base: 1.9, bloomShot: 0.45, bloomMax: 6.0, recover: 10, move: 1.5, air: 5,
    adsMul: 0.36, sight: 'irons', zoom: 1.15, adsTime: 0.13, moveMul: 1.08,
    recoilUp: 0.014, recoilSide: 0.006, kick: 0.04,
    tracer: 0xffd27a, sound: 'pdw',
  },
  // the all-rounder: between the SMG and the LMG, for the Assault and the Medic
  carbine: {
    id: 'carbine', name: 'Rimah Carbine', short: 'Carbine', auto: true, rpm: 720, mag: 30, reserve: 90,
    reload: 2.4, pellets: 1, dmg: 27, range: 150,
    base: 1.7, bloomShot: 0.28, bloomMax: 5.2, recover: 8, move: 1.9, air: 5,
    adsMul: 0.3, sight: 'irons', zoom: 1.2, adsTime: 0.2, moveMul: 0.98,
    recoilUp: 0.011, recoilSide: 0.0045, kick: 0.04,
    tracer: 0xffd27a, sound: 'carbine',
  },
  // the Gatling on the Interceptor's roof: fired from the turret, never carried.
  // Fifty rounds a second, no recoil, a tight cone (see the turret in game.js)
  minigun: {
    id: 'minigun', name: 'Gatling', short: 'Gatling', auto: true, rpm: 3000, mag: 9999, reserve: 0,
    reload: 0, pellets: 1, dmg: 18, range: 300,
    base: 0.35, bloomShot: 0, bloomMax: 0, recover: 9, move: 0, air: 0,
    adsMul: 1, sight: 'none', zoom: 1, adsTime: 0.1, moveMul: 1,
    recoilUp: 0, recoilSide: 0, kick: 0,
    tracer: 0xffb04a, sound: 'minigun',
  },
};
WEAPONS.shotgun.crosshair = 'circle';

// How damage falls off and what a headshot is worth: the server's table
// (server/server.py WEAPONS and SLUG), repeated here for the gun stats page.
// head: headshot multiplier; full damage out to `near` metres, falling to
// `min` of it by `far`.
export const DAMAGE = {
  smg: { head: 1.8, near: 15, far: 40, min: 0.6 },
  lmg: { head: 1.8, near: 25, far: 60, min: 0.7 },
  shotgun: { head: 1.5, near: 8, far: 30, min: 0.2 },
  sniper: { head: 2.5, near: 999, far: 999, min: 1.0 },
  pistol: { head: 2.0, near: 20, far: 50, min: 0.7 },
  knife: { head: 1.0, near: 999, far: 999, min: 1.0 },
  heavy: { head: 1.0, near: 999, far: 999, min: 1.0 },
  revolver: { head: 1.5, near: 30, far: 80, min: 0.75 },
  flamer: { head: 1.0, near: 999, far: 999, min: 1.0 },
  pdw: { head: 1.6, near: 7, far: 20, min: 0.3 },
  carbine: { head: 1.8, near: 22, far: 55, min: 0.65 },
  slug: { head: 1.5, near: 30, far: 90, min: 0.55 },
  minigun: { head: 1.5, near: 999, far: 999, min: 1.0 },
};

// Each loadout's perk. Uses are per life.
export const PERKS = {
  launcher: { id: 'launcher', name: 'Grenade Launcher', uses: 0, blurb: 'A break-action 40 mm launcher that fires whichever grenade your class carries: frag, molotov or flash. Press the perk key to bring it up and put it away, aim down its leaf sight, and the round goes off where it lands. It uses your grenades.' },
  ammo: { id: 'ammo', name: 'Ammo Crate', uses: 2, blurb: 'Drop a crate: you and your team walk up to it to restock spare ammo. Stand on it again 15 seconds later and it restocks you again. (Grenades don’t come back.)' },
  med: { id: 'med', name: 'Medic Crate', uses: 2, blurb: 'Drop a crate: you and your team walk up to it to heal to full. Come back 15 seconds later and it heals you again.' },
  ladder: { id: 'ladder', name: 'Breaching Ladder', uses: 1, blurb: 'Stand it against a wall to climb in through high windows. Anyone can use it.' },
  beacon: { id: 'beacon', name: 'Recon Beacon', uses: 1, blurb: 'Drop it and it pulses for 30 seconds, scanning 35 m around it. Your whole team sees the area on the map, with every enemy inside marked as a red dot.' },
  wall: { id: 'wall', name: 'Cover Wall', uses: 2, blurb: 'Put up a steel barricade in front of you: two players wide and chest high. Crouch behind it and you are hidden; stand up and your head shows. It takes 900 damage before it falls.' },
  knives: { id: 'knives', name: 'Throwing Knives', uses: 3, blurb: 'Three knives a life. Dead accurate and a kill wherever one lands, but it drops fast: fifteen metres at best.' },
  rpg: { id: 'rpg', name: 'RPG', uses: 3, blurb: 'Three rockets a life. Press the perk key to shoulder the launcher and put it away. It flies dead straight with a leaf sight on it, so it reaches like a rifle: a direct hit kills, the blast hurts for five metres round, and a vehicle or a cover wall it hits is wrecked.' },
  mines: { id: 'mines', name: 'Land Mines', uses: 3, blurb: 'Three mines a life, laid at your feet. Armed a second and a half later. A vehicle that drives over one is wrecked and an enemy who steps on one is blown up. Your team sees a small light on yours; the other side has to look for a dark plate in the ground.' },
  drone: { id: 'drone', name: 'Bomb Drone', uses: 1, unlock: { weapon: 'sniper', kills: 75 }, blurb: 'Launch a drone and fly it over the town to see where everyone is, then click to bring it down and blow it like a frag grenade. Your body stands where you left it, so keep it somewhere safe. The battery lasts one trip across the town and back. Anyone can shoot it down.' },
};

export const LOADOUTS = [
  { id: 0, weapon: 'smg', weapons: ['smg', 'pdw', 'carbine'], perk: 'launcher', perks: ['launcher', 'ammo'], nadeKinds: ['frag', 'molotov'], nades: 3, title: 'Assault', blurb: 'SMG, the Barq PDW or the Rimah Carbine, with three grenades or two molotovs and a launcher to fire them from, or an ammo crate instead. Quick to aim, strong up close. Kills with it unlock attachments.' },
  { id: 1, weapon: 'lmg', weapons: ['lmg', 'carbine'], perk: 'med', perks: ['med', 'wall'], nadeKinds: ['frag', 'smoke'], nades: 2, title: 'Medic', blurb: '100-round LMG, or the Rimah Carbine. Heavy, slow to reload. Medic crate or a cover wall; frag or smoke grenades.' },
  { id: 2, weapon: 'shotgun', weapons: ['shotgun', 'flamer'], perk: 'ladder', perks: ['ladder', 'launcher'], nadeKinds: ['frag', 'flash', 'molotov'], nades: 2, title: 'Breacher', blurb: 'Pump shotgun or a flamethrower, devastating in rooms and doorways. Frag, flash or molotov, thrown or from a launcher; or a breaching ladder.' },
  { id: 3, weapon: 'sniper', weapons: ['sniper', 'heavy'], perk: 'beacon', perks: ['beacon', 'drone', 'knives'], nadeKinds: ['frag'], nades: 2, title: 'Marksman', blurb: 'Bolt-action rifle with a 6× scope, or the one-shot .50. Drops a recon beacon, flies a bomb drone, or carries three throwing knives.' },
  { id: 4, weapon: 'shotgun', weapons: ['shotgun', 'smg', 'pdw', 'carbine'], perk: 'rpg', perks: ['rpg', 'mines'], nadeKinds: ['frag', 'atnade'], nades: 2, speed: 0.92, title: 'Engineer', blurb: 'Shotgun, SMG, PDW or Carbine, with an RPG on the shoulder or three land mines, and frag or anti-tank grenades. Wrecks vehicles and cover walls. Walks a little slower under all that kit.' },
];

export const NADES_PER_LIFE = 2;
// molotovs come two to a life whoever carries them
export const nadesFor = (ld, kind = 'frag') => (kind === 'molotov' ? 2 : LOADOUTS[ld] ? LOADOUTS[ld].nades : 2);
export const NADE_INFO = {
  frag: { id: 'frag', name: 'Frag', blurb: 'Explodes — up to 125 damage' },
  flash: { id: 'flash', name: 'Flash', blurb: 'Blinds anyone looking — no damage' },
  smoke: { id: 'smoke', name: 'Smoke', blurb: 'A thick cloud, fifteen metres across, for 15 seconds — no damage' },
  molotov: { id: 'molotov', name: 'Molotov', blurb: 'Half a frag’s blast, then 4.5 m of fire for 15 seconds. Anyone it touches burns for 10 seconds after — 5 a second. Two a life.' },
  atnade: { id: 'atnade', name: 'Anti-Tank', blurb: 'A stick grenade. Half a frag’s damage to people, but a vehicle it lands on is wrecked outright, and one near it is badly hurt.' },
};
// the secondaries every loadout may carry
export const SECONDARIES = ['pistol', 'revolver'];
// Souk Royale's ammo: which guns share a pool, and how much of each you can carry
export const AMMO_OF = { smg: 'light', pdw: 'light', carbine: 'medium', lmg: 'medium', shotgun: 'shells', sniper: 'heavy', pistol: 'pistol', revolver: 'pistol' };
export const AMMO_CAP = { light: 250, medium: 200, shells: 50, heavy: 50, pistol: 50 };

// nothing is suppressed out of the box any more: fit a suppressor to a gun
// in the Locker and it turns quiet, flashes less and keeps you off enemy minimaps
export function isSuppressed() {
  return false;
}
export const NADE_FUSE = 2.2;
export const NADE_RADIUS = 7;
export const FLASH_RANGE = 22;

export function makeWeaponState(id, fitted) {
  const d = applyAttachments(WEAPONS[id], fitted);
  return { id, def: d, mag: d.mag, reserve: d.reserve, bloom: 0, nextFire: 0, lastShot: -9, reloading: false,
    reloadT: 0, boltT: 0, shellT: 0, pumping: 0 };
}
