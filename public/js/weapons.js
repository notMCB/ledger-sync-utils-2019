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
  knife: {
    id: 'knife', name: 'Jambiya', short: 'Knife', melee: true, auto: false, rpm: 110, mag: 0, reserve: 0,
    reload: 0, pellets: 1, dmg: 55, range: 2.4,
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
};

// Each loadout's perk. Uses are per life.
export const PERKS = {
  ammo: { id: 'ammo', name: 'Ammo Crate', uses: 2, blurb: 'Drop a crate: you and your team walk up to it to restock spare ammo. Stand on it again 15 seconds later and it restocks you again. (Grenades don’t come back.)' },
  med: { id: 'med', name: 'Medic Crate', uses: 2, blurb: 'Drop a crate: you and your team walk up to it to heal to full. Come back 15 seconds later and it heals you again.' },
  ladder: { id: 'ladder', name: 'Breaching Ladder', uses: 1, blurb: 'Stand it against a wall to climb in through high windows. Anyone can use it.' },
  beacon: { id: 'beacon', name: 'Recon Beacon', uses: 1, blurb: 'Drop it and it pulses for 30 seconds, scanning 35 m around it. Your whole team sees the area on the map, with every enemy inside marked as a red dot.' },
  wall: { id: 'wall', name: 'Cover Wall', uses: 2, blurb: 'Put up a steel barricade in front of you: two players wide and chest high. Crouch behind it and you are hidden; stand up and your head shows. It takes 900 damage before it falls.' },
  drone: { id: 'drone', name: 'Bomb Drone', uses: 1, blurb: 'Launch a drone and fly it over the town to see where everyone is, then click to bring it down and blow it like a frag grenade. The battery lasts one trip across the town and back. Anyone can shoot it down.' },
};

export const LOADOUTS = [
  { id: 0, weapon: 'smg', perk: 'ammo', perks: ['ammo'], nadeKinds: ['frag'], nades: 3, title: 'Assault', blurb: 'Fast-firing SMG and three grenades. Quick to aim, strong up close. Kills with it unlock attachments.' },
  { id: 1, weapon: 'lmg', perk: 'med', perks: ['med', 'wall'], nadeKinds: ['frag', 'smoke'], nades: 2, title: 'Medic', blurb: '100-round LMG. Heavy, slow to reload. Medic crate or a cover wall; frag or smoke grenades.' },
  { id: 2, weapon: 'shotgun', perk: 'ladder', perks: ['ladder'], nadeKinds: ['frag', 'flash'], nades: 2, title: 'Breacher', blurb: 'Pump shotgun, devastating in rooms and doorways. Frag or flash grenades.' },
  { id: 3, weapon: 'sniper', perk: 'drone', perks: ['drone', 'beacon'], nadeKinds: ['frag'], nades: 2, title: 'Marksman', blurb: 'Bolt-action rifle with a 6× scope. One headshot kills. Flies a bomb drone, or drops a recon beacon.' },
];

export const NADES_PER_LIFE = 2;
export const nadesFor = (ld, kind = 'frag') => (LOADOUTS[ld] ? LOADOUTS[ld].nades : 2);
export const NADE_INFO = {
  frag: { id: 'frag', name: 'Frag', blurb: 'Explodes — up to 125 damage' },
  flash: { id: 'flash', name: 'Flash', blurb: 'Blinds anyone looking — no damage' },
  smoke: { id: 'smoke', name: 'Smoke', blurb: 'A thick cloud, fifteen metres across, for 15 seconds — no damage' },
};

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
