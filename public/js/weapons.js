// Weapon handling. Damage lives on the server (server/server.py WEAPONS);
// the numbers repeated here are for display and for the client's feel.
// Spreads are cone half-angles in degrees.

export const WEAPONS = {
  smg: {
    id: 'smg', name: 'Qadir SMG', short: 'SMG', auto: true, rpm: 800, mag: 30, reserve: 150,
    reload: 2.1, pellets: 1, dmg: 24, range: 120,
    base: 1.5, bloomShot: 0.32, bloomMax: 5.0, recover: 9, move: 1.6, air: 5,
    adsMul: 0.32, sight: 'reddot', zoom: 1.1, adsTime: 0.16, moveMul: 1.05,
    recoilUp: 0.0105, recoilSide: 0.004, kick: 0.035,
    tracer: 0xffd27a, sound: 'smg',
  },
  lmg: {
    id: 'lmg', name: 'Barakh LMG', short: 'LMG', auto: true, rpm: 640, mag: 100, reserve: 200,
    reload: 4.6, pellets: 1, dmg: 30, range: 160,
    base: 2.2, bloomShot: 0.28, bloomMax: 6.5, recover: 6, move: 2.4, air: 6,
    adsMul: 0.3, sight: 'holo', zoom: 2.0, adsTime: 0.28, moveMul: 0.86,
    recoilUp: 0.0125, recoilSide: 0.006, kick: 0.05,
    tracer: 0xff9a4a, sound: 'lmg',
  },
  shotgun: {
    id: 'shotgun', name: 'Hamada 12-gauge', short: 'Shotgun', auto: false, rpm: 70, mag: 6, reserve: 36,
    reload: 0.52, pellets: 9, dmg: 16, range: 60, perShell: true,
    base: 4.2, pelletSpread: 4.2, bloomShot: 1.0, bloomMax: 2.0, recover: 4, move: 1.0, air: 3,
    adsMul: 0.72, sight: 'irons', zoom: 1.15, adsTime: 0.2, moveMul: 0.98,
    recoilUp: 0.05, recoilSide: 0.012, kick: 0.12,
    tracer: 0xffe0a0, sound: 'shotgun',
  },
  sniper: {
    id: 'sniper', name: 'Saqr .338', short: 'Sniper', auto: false, rpm: 45, mag: 5, reserve: 25,
    reload: 3.2, pellets: 1, dmg: 95, range: 300, bolt: true,
    base: 7.0, bloomShot: 4, bloomMax: 6, recover: 5, move: 5, air: 9,
    adsMul: 0.004, sight: 'scope', zoom: 6.0, adsTime: 0.3, moveMul: 0.92,
    recoilUp: 0.06, recoilSide: 0.01, kick: 0.14,
    tracer: 0xfff2c0, sound: 'sniper',
  },
  pistol: {
    id: 'pistol', name: 'Nimr 9mm', short: 'Pistol', auto: false, rpm: 380, mag: 12, reserve: 60,
    reload: 1.6, pellets: 1, dmg: 34, range: 120,
    base: 1.1, bloomShot: 0.85, bloomMax: 4.5, recover: 7, move: 1.2, air: 4,
    adsMul: 0.35, sight: 'irons', zoom: 1.2, adsTime: 0.13, moveMul: 1.08,
    recoilUp: 0.02, recoilSide: 0.006, kick: 0.07,
    tracer: 0xffd27a, sound: 'pistol',
  },
};

// Each loadout's perk. Uses are per life.
export const PERKS = {
  ammo: { id: 'ammo', name: 'Ammo Kit', uses: 2, blurb: 'Refills the ammo for both your guns and gives back a grenade.' },
  med: { id: 'med', name: 'Medical Kit', uses: 2, blurb: 'Patches you up for 50 health.' },
  ladder: { id: 'ladder', name: 'Breaching Ladder', uses: 1, blurb: 'Stand it against a wall to climb in through high windows. Anyone can use it.' },
  beacon: { id: 'beacon', name: 'Recon Beacon', uses: 1, blurb: 'Drop it to reveal enemies within 30 m to your team every few seconds, for 20 seconds.' },
};

export const LOADOUTS = [
  { id: 0, weapon: 'smg', perk: 'ammo', title: 'Assault', blurb: 'Fast-firing SMG with a red dot. Quick to aim, strong up close.' },
  { id: 1, weapon: 'lmg', perk: 'med', title: 'Support', blurb: '100-round LMG with a 2× holographic sight. Heavy, slow to reload.' },
  { id: 2, weapon: 'shotgun', perk: 'ladder', title: 'Breacher', blurb: 'Pump shotgun. Devastating in rooms and doorways. Frag or flash grenades.' },
  { id: 3, weapon: 'sniper', perk: 'beacon', title: 'Marksman', blurb: 'Bolt-action rifle with a 6× scope. One headshot kills.' },
];

export const NADES_PER_LIFE = 2;
export const NADE_FUSE = 2.2;
export const NADE_RADIUS = 7;
export const FLASH_RANGE = 22;

export function makeWeaponState(id) {
  const d = WEAPONS[id];
  return { id, def: d, mag: d.mag, reserve: d.reserve, bloom: 0, nextFire: 0, lastShot: -9, reloading: false,
    reloadT: 0, boltT: 0, shellT: 0, pumping: 0 };
}
