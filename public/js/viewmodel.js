// First-person guns and hands, drawn in their own scene over the world.
// Each gun is built so its sight line runs along its local -Z axis at height
// `sight`; aiming down sights slides the gun until that line is the
// camera's centre line, so the irons / red dot sit exactly on the crosshair.

import * as THREE from 'three';
import { flashTex } from './textures.js';
import { gunMaterials, chromeMaterial } from './skins.js';

const std = (color, rough = 0.6, metal = 0.3) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
const MAT = {
  silver: std('#c9ced4', 0.28, 0.9),
  chrome: chromeMaterial(),
  steel: std('#5a5f66', 0.45, 0.35),
  dark: std('#3c3f44', 0.55, 0.3),
  polymer: std('#5b5c55', 0.8, 0.05),
  tan: std('#b8976a', 0.75, 0.05),
  wood: std('#8a5a36', 0.7, 0.05),
  brass: std('#b58a3c', 0.35, 0.8),
  red: std('#8a2f22', 0.6, 0.1),
  glove: std('#6b5a44', 0.9, 0),
  skin: std('#b98a66', 0.8, 0),
  glass: new THREE.MeshStandardMaterial({ color: '#6a8a7a', roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.18, depthWrite: false }),
  lens: new THREE.MeshStandardMaterial({ color: '#10202a', roughness: 0.1, metalness: 0.5 }),
  // the glass you see when the scope is down at the hip: you can look through it
  scopeGlass: new THREE.MeshStandardMaterial({ color: '#9fd7e6', roughness: 0.05, metalness: 0.4,
    transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }),
  bore: new THREE.MeshStandardMaterial({ color: '#0b0e12', roughness: 0.9, metalness: 0, side: THREE.BackSide }),
  dot: new THREE.MeshBasicMaterial({ color: '#ff2a1a' }),
  sightDot: new THREE.MeshBasicMaterial({ color: '#f1e3a0' }),
  sleeve: std('#6b5a3e', 0.9, 0),
  nade: std('#4a5236', 0.7, 0.2),
  bottle: new THREE.MeshStandardMaterial({ color: '#8fb08a', roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.75 }),
  rag: std('#d8cfb0', 0.9, 0),
};

// which parts of a gun a finish recolours
const ROLE = new Map([[MAT.steel, 'body'], [MAT.chrome, 'body'], [MAT.polymer, 'furn'], [MAT.tan, 'furn'], [MAT.wood, 'furn'], [MAT.dark, 'dark']]);

// put a finish on a gun (null = factory finish)
export function skinGun(group, finishId) {
  const mats = finishId ? gunMaterials(finishId) : null;
  group.traverse((m) => {
    if (!m.isMesh) return;
    if (!m.userData.base) m.userData.base = m.material;
    const role = ROLE.get(m.userData.base);
    if (!role) return;
    m.material = mats ? mats[role] : m.userData.base;
  });
}

function box(parent, w, h, d, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}

function cyl(parent, r, len, mat, x = 0, y = 0, z = 0, seg = 12, r2 = r) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r2, len, seg), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

function sphere(parent, r, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

// iron sights: a front post whose tip sits on the sight line, and a rear
// notch whose two ears straddle it
function irons(g, S, zFront, zRear, frontBaseY, rearBaseY, mat = MAT.steel) {
  const postH = S - frontBaseY;
  box(g, 0.022, 0.014, 0.02, mat, 0, frontBaseY - 0.007, zFront);
  box(g, 0.004, postH, 0.006, mat, 0, frontBaseY + postH / 2, zFront);
  const tip = new THREE.Mesh(new THREE.CircleGeometry(0.0016, 8), MAT.sightDot);
  tip.position.set(0, S - 0.0018, zFront + 0.0035);
  g.add(tip);
  const earH = S + 0.004 - rearBaseY;
  box(g, 0.024, 0.006, 0.01, mat, 0, rearBaseY - 0.003, zRear);
  box(g, 0.005, earH, 0.006, mat, -0.0075, rearBaseY + earH / 2, zRear);
  box(g, 0.005, earH, 0.006, mat, 0.0075, rearBaseY + earH / 2, zRear);
}

// a small reflex sight: open frame, tinted glass, red dot on the sight line
function reflex(g, S, fz, baseY) {
  box(g, 0.026, S - 0.018 - baseY, 0.05, MAT.dark, 0, baseY + (S - 0.018 - baseY) / 2, fz + 0.005);
  box(g, 0.036, 0.005, 0.016, MAT.dark, 0, S + 0.017, fz);
  box(g, 0.005, 0.036, 0.016, MAT.dark, -0.0175, S, fz);
  box(g, 0.005, 0.036, 0.016, MAT.dark, 0.0175, S, fz);
  box(g, 0.036, 0.006, 0.016, MAT.dark, 0, S - 0.017, fz);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.03), MAT.glass);
  glass.position.set(0, S, fz);
  g.add(glass);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0009, 12), MAT.dot);
  dot.position.set(0, S, fz + 0.001);
  g.add(dot);
}

// a holographic sight: boxy hood, wide window, a circle-and-dot reticle
function holo(g, S, fz, baseY) {
  const len = 0.07;
  box(g, 0.05, S - 0.024 - baseY, len, MAT.dark, 0, baseY + (S - 0.024 - baseY) / 2, fz);          // base
  box(g, 0.056, 0.007, len, MAT.dark, 0, S + 0.024, fz);                                        // hood
  box(g, 0.007, 0.052, len, MAT.dark, -0.0285, S, fz);
  box(g, 0.007, 0.052, len, MAT.dark, 0.0285, S, fz);
  box(g, 0.02, 0.012, 0.02, MAT.dark, 0.035, S - 0.012, fz + 0.01);                             // buttons
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.046), MAT.glass);
  glass.position.set(0, S, fz - len / 2 + 0.004);
  g.add(glass);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.0052, 0.0061, 40), MAT.dot);
  ring.position.set(0, S, fz - len / 2 + 0.005);
  g.add(ring);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0007, 12), MAT.dot);
  dot.position.set(0, S, fz - len / 2 + 0.005);
  g.add(dot);
}

function hands(g, grip, fore, sleeveMat) {
  // right hand on the grip, forearm running back and down out of view
  const right = new THREE.Group();
  box(right, 0.045, 0.06, 0.07, MAT.glove, 0, 0, 0);
  box(right, 0.07, 0.07, 0.34, sleeveMat, 0.02, -0.04, 0.2, 0.25, 0.1, 0);
  right.position.copy(grip);
  g.add(right);
  const left = new THREE.Group();
  box(left, 0.05, 0.045, 0.08, MAT.glove, 0, 0, 0);
  box(left, 0.07, 0.07, 0.36, sleeveMat, -0.05, -0.06, 0.18, 0.35, -0.45, 0);
  left.position.copy(fore);
  g.add(left);
  return { right, left, leftHome: fore.clone() };
}

// -- the guns -----------------------------------------------------------------

// A sight you can see through when it's down at the hip: an open tube with a
// dark bore and a pane of glass at each end.
function tubeWithGlass(parent, S, z, len, r, bodyMat) {
  const outer = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 16, 1, true), bodyMat);
  outer.rotation.x = Math.PI / 2;
  outer.position.set(0, S, z);
  parent.add(outer);
  const bore = new THREE.Mesh(new THREE.CylinderGeometry(r - 0.003, r - 0.003, len - 0.004, 16, 1, true), MAT.bore);
  bore.rotation.x = Math.PI / 2;
  bore.position.set(0, S, z);
  parent.add(bore);
  for (const [dz, ry] of [[-len / 2 + 0.004, Math.PI], [len / 2 - 0.004, 0]]) {
    const pane = new THREE.Mesh(new THREE.CircleGeometry(r - 0.002, 20), MAT.scopeGlass);
    pane.position.set(0, S, z + dz);
    pane.rotation.y = ry;
    parent.add(pane);
  }
}

// a scope tube, for the SMG's 3x and 6x optics
function scopeTube(parent, S, len, z, bodyMat, ringMat) {
  tubeWithGlass(parent, S, z, len, 0.021, bodyMat);
  cyl(parent, 0.029, 0.05, bodyMat, 0, S, z - len / 2 + 0.02, 16, 0.024);
  cyl(parent, 0.027, 0.045, bodyMat, 0, S, z + len / 2 - 0.02, 16, 0.023);
  for (const rz of [z - 0.05, z + 0.05]) box(parent, 0.016, S - 0.045, 0.02, ringMat, 0, 0.045 + (S - 0.045) / 2, rz);
  box(parent, 0.022, 0.018, 0.022, ringMat, 0, S + 0.026, z + 0.01);
}

// a short, chunky 3x sight: squared body, big front bell, a chevron in the glass
function acogBody(parent, S, z, bodyMat = MAT.dark) {
  box(parent, 0.038, 0.038, 0.13, bodyMat, 0, S, z);
  tubeWithGlass(parent, S, z, 0.19, 0.019, bodyMat);                  // the sight line, bored through
  cyl(parent, 0.026, 0.055, bodyMat, 0, S, z - 0.085, 14, 0.022);     // front bell
  cyl(parent, 0.021, 0.035, bodyMat, 0, S, z + 0.075, 14);            // eyepiece
  box(parent, 0.044, 0.008, 0.03, bodyMat, 0, S + 0.022, z - 0.02);   // fibre optic housing
  box(parent, 0.03, 0.005, 0.02, MAT.brass, 0, S + 0.027, z - 0.02);
  box(parent, 0.016, 0.016, 0.016, bodyMat, 0.026, S, z + 0.02);      // windage turret
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.019, 0.026, 18), bodyMat);
  ring.position.set(0, S, z - 0.112);
  ring.rotation.y = Math.PI;
  parent.add(ring);
  // the chevron you aim with, on the sight line
  const tri = new THREE.Shape();
  tri.moveTo(0, 0.0016);
  tri.lineTo(-0.0016, -0.0014);
  tri.lineTo(0.0016, -0.0014);
  const chev = new THREE.Mesh(new THREE.ShapeGeometry(tri), MAT.dot);
  chev.position.set(0, S, z - 0.056);
  parent.add(chev);
}

// a shotgun ghost ring: a big open rear aperture with a bead out front
function ghostRing(g, S, zFront, zRear, mat = MAT.steel) {
  box(g, 0.006, S - 0.034, 0.008, mat, 0, 0.034 + (S - 0.034) / 2, zFront);   // front post
  const hood = new THREE.Mesh(new THREE.TorusGeometry(0.013, 0.0028, 6, 16), mat);
  hood.position.set(0, S, zFront);
  g.add(hood);
  sphere(g, 0.0042, MAT.brass, 0, S, zFront + 0.002);                          // bead
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.0035, 6, 20), mat);
  ring.position.set(0, S, zRear);
  g.add(ring);
  box(g, 0.008, S - 0.035, 0.012, mat, 0, 0.035 + (S - 0.035) / 2, zRear);     // ring stem
}

// parts that can be swapped in the Locker: one of each kind is shown at a time
// laser modules for any gun: a small box under or beside the barrel with a
// coloured lens, one per colour, shown when fitted
const LENS = { red: new THREE.MeshBasicMaterial({ color: '#ff3030' }), green: new THREE.MeshBasicMaterial({ color: '#40ff50' }) };
function laserModules(add, x, y, z) {
  add('laser', 'none', {}, () => {});
  for (const id of ['red', 'green']) {
    add('laser', id, {}, (m) => {
      box(m, 0.024, 0.02, 0.05, MAT.dark, x, y, z);
      box(m, 0.012, 0.012, 0.004, LENS[id], x, y, z - 0.027);
      box(m, 0.008, 0.006, 0.01, MAT.steel, x, y + 0.013, z + 0.01);   // the switch
    });
  }
}

// fore-end grips for any long gun: a straight post, an angled wedge or a stubby one
function gripModules(add, y, z, which = ['none', 'straight', 'angled', 'short']) {
  const kinds = {
    none: () => {},
    straight: (m) => box(m, 0.024, 0.055, 0.03, MAT.polymer, 0, y - 0.027, z),
    angled: (m) => { box(m, 0.024, 0.04, 0.05, MAT.polymer, 0, y - 0.02, z - 0.01, 0.55); },
    short: (m) => box(m, 0.03, 0.035, 0.034, MAT.polymer, 0, y - 0.017, z),
  };
  for (const id of which) add('grip', id, {}, kinds[id]);
}

// barrels for any gun: the standard one, an extended one with a thread
// protector, and a shortened one. The breech end stays put; the tip moves,
// and `dz` says how far the muzzle devices move with it.
function barrelParts(add, y, zBreech, r, lens, mat = MAT.dark) {
  for (const id in lens) {
    const L = lens[id];
    add('barrel', id, { tip: zBreech - L, my: y, dz: -(L - lens.normal) }, (b) => {
      cyl(b, r, L, mat, 0, y, zBreech - L / 2, 10);
      if (id === 'ext') cyl(b, r * 1.2, 0.024, MAT.steel, 0, y, zBreech - L + 0.012, 10);
    });
  }
}

function partSet(g) {
  const sets = { optic: {}, muzzle: {}, mag: {}, ammo: {}, trigger: {}, laser: {}, grip: {}, barrel: {} };
  const add = (kind, id, data, build, parent) => {
    const o = new THREE.Group();
    build(o);
    o.userData = data || {};
    o.visible = false;
    (parent || g).add(o);
    sets[kind][id] = o;
    return o;
  };
  return { sets, add };
}

// wire `gun.setAttach(fitted)` up to a set of swappable parts
function attachable(gun, sets, defaults) {
  gun.parts = sets;
  gun.setAttach = (fitted) => {
    const pick = (kind) => {
      const set = sets[kind];
      const ids = Object.keys(set);
      if (!ids.length) return null;
      const want = (fitted && fitted[kind]) || defaults[kind] || ids[0];
      const chosen = set[want] || set[defaults[kind]] || set[ids[0]];
      for (const k of ids) set[k].visible = set[k] === chosen;
      return chosen;
    };
    const o = pick('optic');
    const m = pick('muzzle');
    pick('mag');
    pick('ammo');
    pick('trigger');
    pick('laser');
    pick('grip');
    const b = pick('barrel');
    // a longer or shorter barrel carries the muzzle devices out or back with it
    const dz = (b && b.userData.dz) || 0;
    for (const id in sets.muzzle) sets.muzzle[id].position.z = dz;
    if (b && b.userData.tip !== undefined) {
      gun.muzzle.set(0, b.userData.my !== undefined ? b.userData.my : gun.muzzle.y, b.userData.tip);
      if (gun.flash) {
        gun.flash.position.copy(gun.muzzle);
        gun.flash.position.z -= 0.03;
      }
    }
    if (o && o.userData.S !== undefined) {
      gun.sight = o.userData.S;
      gun.ads.set(0, -o.userData.S, o.userData.adsZ);
    }
    if (m && m.userData.tip !== undefined) {
      gun.muzzle.set(0, m.userData.my !== undefined ? m.userData.my : gun.muzzle.y, m.userData.tip + dz);
      if (gun.flash) {
        gun.flash.position.copy(gun.muzzle);
        gun.flash.position.z -= 0.03;
      }
    }
  };
  gun.setAttach(null);
  return gun;
}

function buildSMG(sleeve) {
  const g = new THREE.Group();
  box(g, 0.055, 0.075, 0.33, MAT.steel, 0, 0, -0.06);
  box(g, 0.05, 0.03, 0.2, MAT.polymer, 0, -0.045, -0.13);         // handguard
  box(g, 0.03, 0.1, 0.035, MAT.polymer, 0, -0.085, 0.045, -0.3);   // grip
  box(g, 0.012, 0.04, 0.06, MAT.dark, 0, -0.05, -0.005);           // trigger guard
  box(g, 0.025, 0.04, 0.2, MAT.polymer, 0, -0.005, 0.2);           // stock
  box(g, 0.03, 0.08, 0.03, MAT.polymer, 0, -0.03, 0.3);
  box(g, 0.045, 0.014, 0.16, MAT.dark, 0, 0.044, -0.04);           // top rail for the optics
  const charge = box(g, 0.02, 0.012, 0.03, MAT.dark, -0.035, 0.02, -0.12);

  // -- optics, one shown at a time --
  const optics = {};
  const optic = (id, S, adsZ, scope, build) => {
    const o = new THREE.Group();
    build(o);
    o.userData = { S, adsZ, scope: !!scope };
    o.visible = false;
    g.add(o);
    optics[id] = o;
  };
  optic('irons', 0.072, -0.3, false, (o) => irons(o, 0.072, -0.19, 0.075, 0.045, 0.045));
  optic('reddot', 0.082, -0.3, false, (o) => reflex(o, 0.082, -0.01, 0.051));
  optic('holo', 0.104, -0.22, false, (o) => holo(o, 0.104, -0.02, 0.051));
  optic('acog', 0.096, -0.18, true, (o) => {
    box(o, 0.03, 0.018, 0.1, MAT.dark, 0, 0.055, -0.03);
    acogBody(o, 0.096, -0.03, MAT.tan);
  });
  optic('scope6', 0.1, -0.14, true, (o) => {
    box(o, 0.03, 0.02, 0.14, MAT.dark, 0, 0.058, -0.02);
    scopeTube(o, 0.1, 0.3, -0.02, MAT.dark, MAT.steel);
  });

  // -- muzzle devices --
  const muzzles = {};
  const dev = (id, tip, build) => {
    const m = new THREE.Group();
    build(m);
    m.userData = { tip };
    m.visible = false;
    g.add(m);
    muzzles[id] = m;
  };
  dev('none', -0.37, () => {});
  dev('hider', -0.44, (m) => {
    cyl(m, 0.017, 0.07, MAT.dark, 0, 0.012, -0.39, 10);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      box(m, 0.006, 0.006, 0.05, MAT.dark, Math.cos(a) * 0.014, 0.012 + Math.sin(a) * 0.014, -0.415);
    }
  });
  dev('brake', -0.45, (m) => {
    cyl(m, 0.019, 0.085, MAT.dark, 0, 0.012, -0.397, 10);
    for (const z of [-0.375, -0.4, -0.425]) {
      box(m, 0.042, 0.006, 0.008, MAT.steel, 0, 0.012, z);
    }
  });
  dev('suppressor', -0.58, (m) => {
    cyl(m, 0.025, 0.21, MAT.dark, 0, 0.012, -0.47, 16);
    cyl(m, 0.027, 0.02, MAT.steel, 0, 0.012, -0.372, 16);
  });
  dev('longbrake', -0.51, (m) => {
    cyl(m, 0.021, 0.145, MAT.dark, 0, 0.012, -0.43, 12);
    for (const z of [-0.375, -0.405, -0.435, -0.465]) {
      box(m, 0.05, 0.007, 0.009, MAT.steel, 0, 0.012, z);
      box(m, 0.007, 0.05, 0.009, MAT.steel, 0, 0.012, z);
    }
    cyl(m, 0.024, 0.016, MAT.steel, 0, 0.012, -0.498, 12);
  });

  // -- magazines --
  const mag = new THREE.Group();
  const mags = {};
  const magazine = (id, build) => {
    const m = new THREE.Group();
    build(m);
    m.visible = false;
    mag.add(m);
    mags[id] = m;
  };
  magazine('normal', (m) => box(m, 0.028, 0.16, 0.045, MAT.dark, 0, -0.08, 0, 0.18));
  magazine('fast', (m) => {
    box(m, 0.028, 0.16, 0.045, MAT.dark, 0, -0.08, 0, 0.18);
    box(m, 0.034, 0.05, 0.05, MAT.tan, 0, -0.1, 0.005, 0.18);      // pull tab and tape
    box(m, 0.03, 0.02, 0.048, MAT.brass, 0, -0.155, 0.015, 0.18);
  });
  magazine('large', (m) => {
    box(m, 0.03, 0.25, 0.046, MAT.dark, 0, -0.125, 0.01, 0.18);
    box(m, 0.032, 0.02, 0.048, MAT.steel, 0, -0.045, -0.005, 0.18);
  });
  mag.position.set(0, -0.035, -0.09);
  g.add(mag);
  const lasers = {}, gripsS = {}, barrelsS = {};
  {
    const { sets, add } = partSet(g);
    laserModules(add, 0, -0.072, -0.2);
    gripModules(add, -0.06, -0.15);
    barrelParts(add, 0.012, -0.225, 0.012, { normal: 0.13, ext: 0.25, short: 0.06 });
    Object.assign(lasers, sets.laser);
    Object.assign(gripsS, sets.grip);
    Object.assign(barrelsS, sets.barrel);
  }

  const h = hands(g, new THREE.Vector3(0.002, -0.085, 0.045), new THREE.Vector3(0, -0.06, -0.17), sleeve);
  const gun = {
    group: g, sight: 0.072, muzzle: new THREE.Vector3(0, 0.012, -0.37), mag, magHome: mag.position.clone(), charge,
    chargeHome: charge.position.clone(), hands: h, optics, muzzles, mags,
    hip: new THREE.Vector3(0.15, -0.15, -0.4), ads: new THREE.Vector3(0, -0.072, -0.3), kind: 'mag',
  };
  // fit a set of attachments: show those parts, and move the sight line and muzzle to match
  gun.setAttach = (fitted) => {
    const o = optics[(fitted && fitted.optic) || 'irons'] || optics.irons;
    const m = muzzles[(fitted && fitted.muzzle) || 'none'] || muzzles.none;
    const k = mags[(fitted && fitted.mag) || 'normal'] || mags.normal;
    const l = lasers[(fitted && fitted.laser) || 'none'] || lasers.none;
    const gr = gripsS[(fitted && fitted.grip) || 'none'] || gripsS.none;
    const br = barrelsS[(fitted && fitted.barrel) || 'normal'] || barrelsS.normal;
    for (const id in optics) optics[id].visible = optics[id] === o;
    for (const id in muzzles) muzzles[id].visible = muzzles[id] === m;
    for (const id in mags) mags[id].visible = mags[id] === k;
    for (const id in lasers) lasers[id].visible = lasers[id] === l;
    for (const id in gripsS) gripsS[id].visible = gripsS[id] === gr;
    for (const id in barrelsS) barrelsS[id].visible = barrelsS[id] === br;
    const dz = br.userData.dz || 0;
    for (const id in muzzles) muzzles[id].position.z = dz;
    gun.sight = o.userData.S;
    gun.ads.set(0, -o.userData.S, o.userData.adsZ);
    gun.muzzle.set(0, 0.012, m.userData.tip + dz);
    if (gun.flash) {
      gun.flash.position.copy(gun.muzzle);
      gun.flash.position.z -= 0.03;
    }
  };
  gun.setAttach(null);
  return gun;
}

// muzzle devices for any gun: drawn on a barrel of radius r at height y,
// with the bare barrel ending at z. Each one moves the muzzle further out.
function muzzleDevices(add, y, z, r, which = ['none', 'hider', 'brake', 'suppressor', 'longbrake']) {
  const kinds = {
    none: [0, () => {}],
    hider: [0.07, (m) => {
      cyl(m, r * 1.35, 0.07, MAT.dark, 0, y, z - 0.035, 10);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        box(m, r * 0.5, r * 0.5, 0.05, MAT.dark, Math.cos(a) * r * 1.1, y + Math.sin(a) * r * 1.1, z - 0.045);
      }
    }],
    brake: [0.085, (m) => {
      cyl(m, r * 1.5, 0.085, MAT.dark, 0, y, z - 0.042, 10);
      for (const dz of [-0.02, -0.042, -0.064]) box(m, r * 3.2, r * 0.5, 0.008, MAT.steel, 0, y, z + dz);
    }],
    suppressor: [0.21, (m) => {
      cyl(m, r * 2, 0.21, MAT.dark, 0, y, z - 0.105, 16);
      cyl(m, r * 2.1, 0.02, MAT.steel, 0, y, z - 0.008, 16);
    }],
    longbrake: [0.145, (m) => {
      cyl(m, r * 1.65, 0.145, MAT.dark, 0, y, z - 0.072, 12);
      for (const dz of [-0.022, -0.052, -0.082, -0.112]) {
        box(m, r * 3.6, r * 0.55, 0.009, MAT.steel, 0, y, z + dz);
        box(m, r * 0.55, r * 3.6, 0.009, MAT.steel, 0, y, z + dz);
      }
      cyl(m, r * 1.85, 0.016, MAT.steel, 0, y, z - 0.138, 12);
    }],
  };
  for (const id of which) {
    const [len, build] = kinds[id];
    add('muzzle', id, { tip: z - len, my: y }, build);
  }
}

function buildLMG(sleeve) {
  const g = new THREE.Group();
  box(g, 0.075, 0.095, 0.42, MAT.steel, 0, 0, -0.05);
  box(g, 0.068, 0.02, 0.24, MAT.dark, 0, 0.058, -0.02);            // top rail
  const cover = new THREE.Group();                                  // feed cover, opens on reload
  box(cover, 0.07, 0.02, 0.14, MAT.steel, 0, 0.01, -0.07);
  cover.position.set(0, 0.048, 0.12);
  g.add(cover);
  cyl(g, 0.028, 0.3, MAT.polymer, 0, 0.005, -0.41, 14);             // shroud
  box(g, 0.012, 0.012, 0.28, MAT.dark, -0.02, -0.035, -0.46, 0.08);   // folded bipod
  box(g, 0.012, 0.012, 0.28, MAT.dark, 0.02, -0.035, -0.46, 0.08);
  box(g, 0.032, 0.11, 0.04, MAT.polymer, 0, -0.1, 0.07, -0.3);      // grip
  box(g, 0.035, 0.065, 0.25, MAT.polymer, 0, -0.01, 0.27);          // stock
  const mag = new THREE.Group();
  mag.position.set(0.0, -0.045, -0.08);
  g.add(mag);
  const { sets, add } = partSet(g);
  const rail = 0.068;
  add('optic', 'irons', { S: 0.098, adsZ: -0.26 }, (o) => irons(o, 0.098, -0.3, 0.05, rail, rail));
  add('optic', 'reddot', { S: 0.104, adsZ: -0.26 }, (o) => reflex(o, 0.104, -0.02, rail));
  add('optic', 'holo', { S: 0.104, adsZ: -0.2 }, (o) => holo(o, 0.104, -0.02, rail));
  add('optic', 'acog', { S: 0.116, adsZ: -0.14 }, (o) => {
    box(o, 0.034, 0.03, 0.12, MAT.dark, 0, rail + 0.02, -0.03);
    acogBody(o, 0.116, -0.03, MAT.dark);
  });
  add('optic', 'scope6', { S: 0.118, adsZ: -0.1 }, (o) => {
    box(o, 0.034, 0.03, 0.16, MAT.dark, 0, rail + 0.02, -0.02);
    scopeTube(o, 0.118, 0.3, -0.02, MAT.dark, MAT.steel);
  });
  barrelParts(add, 0.005, -0.55, 0.013, { normal: 0.18, ext: 0.3 });
  muzzleDevices(add, 0.005, -0.73, 0.014);
  laserModules(add, 0.048, -0.005, -0.38);
  gripModules(add, -0.042, -0.3);
  add('mag', 'normal', {}, (m) => {
    box(m, 0.1, 0.12, 0.13, MAT.tan, 0, -0.06, 0);
    box(m, 0.1, 0.02, 0.02, MAT.dark, 0, -0.11, 0.05);
  }, mag);
  add('mag', 'fast', {}, (m) => {
    box(m, 0.1, 0.12, 0.13, MAT.tan, 0, -0.06, 0);
    box(m, 0.11, 0.05, 0.05, MAT.dark, 0, -0.08, -0.05);
    box(m, 0.1, 0.02, 0.02, MAT.brass, 0, -0.11, 0.05);
  }, mag);
  add('mag', 'large', {}, (m) => {
    box(m, 0.11, 0.18, 0.14, MAT.tan, 0, -0.09, 0);
    box(m, 0.11, 0.02, 0.02, MAT.dark, 0, -0.17, 0.05);
  }, mag);
  const h = hands(g, new THREE.Vector3(0.002, -0.1, 0.07), new THREE.Vector3(0, -0.04, -0.33), sleeve);
  const gun = {
    group: g, sight: 0.104, muzzle: new THREE.Vector3(0, 0.005, -0.78), mag, magHome: mag.position.clone(), cover,
    hands: h, hip: new THREE.Vector3(0.16, -0.17, -0.42), ads: new THREE.Vector3(0, -0.104, -0.2), kind: 'box',
  };
  return attachable(gun, sets, { optic: 'irons', muzzle: 'none', mag: 'normal', barrel: 'normal' });
}

function buildShotgun(sleeve) {
  const g = new THREE.Group();
  box(g, 0.055, 0.07, 0.24, MAT.steel, 0, 0, 0.0);
  cyl(g, 0.014, 0.56, MAT.dark, 0, 0.02, -0.39);
  const pump = new THREE.Group();
  box(pump, 0.045, 0.045, 0.17, MAT.wood, 0, 0, 0);
  for (let i = 0; i < 5; i++) box(pump, 0.047, 0.004, 0.006, MAT.dark, 0, 0.018, -0.06 + i * 0.03);
  pump.position.set(0, -0.014, -0.29);
  g.add(pump);
  box(g, 0.03, 0.09, 0.04, MAT.wood, 0, -0.07, 0.12, -0.35);         // grip
  box(g, 0.04, 0.07, 0.28, MAT.wood, 0, -0.03, 0.3, -0.08);          // stock
  const { sets, add } = partSet(g);
  // the magazine tube under the barrel: a short one holds four
  add('mag', 'normal', {}, (m) => cyl(m, 0.012, 0.44, MAT.steel, 0, -0.014, -0.33));
  add('mag', 'small', {}, (m) => {
    cyl(m, 0.012, 0.3, MAT.steel, 0, -0.014, -0.26);
    cyl(m, 0.014, 0.02, MAT.brass, 0, -0.014, -0.4);
  });
  add('optic', 'irons', { S: 0.058, adsZ: -0.3 }, (o) => ghostRing(o, 0.058, -0.66, 0.09));
  add('optic', 'reddot', { S: 0.075, adsZ: -0.3 }, (o) => reflex(o, 0.075, -0.02, 0.035));
  add('optic', 'holo', { S: 0.092, adsZ: -0.24 }, (o) => holo(o, 0.092, -0.02, 0.035));
  muzzleDevices(add, 0.02, -0.67, 0.015, ['none', 'suppressor']);
  laserModules(add, 0.036, -0.004, -0.45);
  gripModules(add, -0.04, -0.52);
  // buckshot or a single slug in the chamber window
  add('ammo', 'buck', {}, () => {});
  add('ammo', 'slug', {}, (a) => {
    box(a, 0.02, 0.012, 0.03, MAT.brass, -0.028, 0.006, 0.02);
    cyl(a, 0.009, 0.03, MAT.steel, -0.028, 0.006, -0.01, 8);
  });
  const shell = new THREE.Group();
  cyl(shell, 0.011, 0.055, MAT.red, 0, 0, 0, 10);
  cyl(shell, 0.0115, 0.014, MAT.brass, 0, 0, 0.03, 10);
  shell.visible = false;
  g.add(shell);
  const h = hands(g, new THREE.Vector3(0.002, -0.07, 0.12), new THREE.Vector3(0, -0.04, -0.29), sleeve);
  const gun = {
    group: g, sight: 0.058, muzzle: new THREE.Vector3(0, 0.02, -0.68), pump, pumpHome: pump.position.clone(), shell,
    hands: h, hip: new THREE.Vector3(0.15, -0.15, -0.4), ads: new THREE.Vector3(0, -0.058, -0.3), kind: 'shell',
  };
  return attachable(gun, sets, { optic: 'irons', muzzle: 'none', mag: 'normal', ammo: 'buck' });
}

function buildSniper(sleeve) {
  const g = new THREE.Group();
  box(g, 0.055, 0.07, 0.3, MAT.steel, 0, 0, -0.02);
  box(g, 0.06, 0.06, 0.4, MAT.tan, 0, -0.035, -0.2);                // fore-end
  box(g, 0.015, 0.03, 0.02, MAT.dark, 0, 0.05, -0.1);                // scope mounts
  box(g, 0.015, 0.03, 0.02, MAT.dark, 0, 0.05, 0.05);
  const bolt = new THREE.Group();
  cyl(bolt, 0.008, 0.05, MAT.steel, 0.02, 0, 0, 8).rotation.set(0, 0, Math.PI / 2);
  sphere(bolt, 0.012, MAT.steel, 0.048, 0, 0);
  bolt.position.set(0.02, 0.02, 0.09);
  g.add(bolt);
  box(g, 0.03, 0.1, 0.04, MAT.tan, 0, -0.08, 0.14, -0.35);           // grip
  box(g, 0.045, 0.09, 0.3, MAT.tan, 0, -0.04, 0.33);                 // stock
  box(g, 0.04, 0.04, 0.12, MAT.tan, 0, 0.03, 0.34);                  // cheek rest
  const mag = new THREE.Group();
  mag.position.set(0, -0.035, 0.01);
  g.add(mag);
  const { sets, add } = partSet(g);
  add('optic', 'scope6', { S: 0.078, adsZ: -0.1 }, (o) => {
    tubeWithGlass(o, 0.078, -0.04, 0.3, 0.02, MAT.dark);
    cyl(o, 0.03, 0.08, MAT.dark, 0, 0.078, -0.22, 16, 0.024);
    cyl(o, 0.027, 0.06, MAT.dark, 0, 0.078, 0.12, 16, 0.022);
    box(o, 0.025, 0.02, 0.025, MAT.dark, 0, 0.103, -0.05);           // turret
  });
  add('optic', 'acog', { S: 0.082, adsZ: -0.16 }, (o) => acogBody(o, 0.082, -0.05, MAT.tan));
  add('optic', 'reddot', { S: 0.072, adsZ: -0.26 }, (o) => reflex(o, 0.072, -0.05, 0.05));
  barrelParts(add, 0.012, -0.16, 0.014, { normal: 0.62, ext: 0.8 });
  muzzleDevices(add, 0.012, -0.78, 0.015);
  laserModules(add, 0.036, 0.0, -0.5);
  gripModules(add, -0.065, -0.3);
  add('mag', 'normal', {}, (m) => box(m, 0.03, 0.08, 0.07, MAT.dark, 0, -0.04, 0), mag);
  add('mag', 'fast', {}, (m) => {
    box(m, 0.03, 0.08, 0.07, MAT.dark, 0, -0.04, 0);
    box(m, 0.036, 0.03, 0.03, MAT.tan, 0, -0.06, 0.03);
  }, mag);
  add('mag', 'ext', {}, (m) => {
    box(m, 0.032, 0.13, 0.07, MAT.dark, 0, -0.065, 0);
    box(m, 0.034, 0.015, 0.072, MAT.steel, 0, -0.125, 0);
  }, mag);
  const h = hands(g, new THREE.Vector3(0.002, -0.08, 0.14), new THREE.Vector3(0, -0.07, -0.25), sleeve);
  const gun = {
    group: g, sight: 0.078, muzzle: new THREE.Vector3(0, 0.012, -0.78), mag, magHome: mag.position.clone(), bolt,
    boltHome: bolt.position.clone(), hands: h, hip: new THREE.Vector3(0.15, -0.16, -0.42), ads: new THREE.Vector3(0, -0.078, -0.1),
    kind: 'bolt',
  };
  return attachable(gun, sets, { optic: 'scope6', muzzle: 'none', mag: 'normal', barrel: 'normal' });
}

function buildPistol(sleeve) {
  const g = new THREE.Group();
  const slide = new THREE.Group();
  for (let i = 0; i < 5; i++) box(slide, 0.032, 0.026, 0.004, MAT.dark, 0, 0, 0.07 + i * 0.006);
  slide.position.set(0, 0.03, -0.06);
  g.add(slide);
  box(g, 0.028, 0.022, 0.16, MAT.polymer, 0, 0.004, -0.05);
  box(g, 0.029, 0.11, 0.045, MAT.polymer, 0, -0.055, 0.02, -0.22);
  box(g, 0.01, 0.03, 0.05, MAT.polymer, 0, -0.012, -0.02);
  const mag = new THREE.Group();
  mag.rotation.x = -0.22;
  mag.position.set(0, -0.005, 0.018);
  g.add(mag);
  const { sets, add } = partSet(g);
  add('optic', 'irons', { S: 0.058, adsZ: -0.34 }, (o) => irons(o, 0.058, -0.14, 0.022, 0.047, 0.047));
  add('optic', 'reddot', { S: 0.078, adsZ: -0.32 }, (o) => {
    box(o, 0.026, 0.012, 0.06, MAT.dark, 0, 0.052, -0.03);
    reflex(o, 0.078, -0.03, 0.056);
  });
  // barrels: the slide is the standard one; a threaded barrel stands out of an
  // extended one; a shortened one is a snub slide
  add('barrel', 'normal', { dz: 0 }, (b) => box(b, 0.03, 0.034, 0.19, MAT.steel, 0, 0, 0), slide);
  add('barrel', 'ext', { dz: -0.06 }, (b) => {
    box(b, 0.03, 0.034, 0.19, MAT.steel, 0, 0, 0);
    cyl(b, 0.009, 0.08, MAT.dark, 0, 0, -0.13, 10);
    cyl(b, 0.011, 0.02, MAT.steel, 0, 0, -0.16, 10);
  }, slide);
  add('barrel', 'short', { dz: 0.04 }, (b) => box(b, 0.03, 0.034, 0.15, MAT.steel, 0, 0, 0.02), slide);
  muzzleDevices(add, 0.03, -0.165, 0.012, ['none', 'brake', 'suppressor', 'longbrake']);
  laserModules(add, 0, -0.004, -0.13);
  add('mag', 'normal', {}, (m) => box(m, 0.022, 0.1, 0.034, MAT.dark, 0, -0.05, 0), mag);
  add('mag', 'fast', {}, (m) => {
    box(m, 0.022, 0.1, 0.034, MAT.dark, 0, -0.05, 0);
    box(m, 0.028, 0.03, 0.038, MAT.tan, 0, -0.085, 0);
  }, mag);
  add('mag', 'drum', {}, (m) => {
    box(m, 0.022, 0.06, 0.034, MAT.dark, 0, -0.03, 0);
    cyl(m, 0.046, 0.026, MAT.dark, 0, -0.088, 0.005, 20);            // the drum faces forward
    cyl(m, 0.038, 0.03, MAT.steel, 0, -0.088, 0.005, 20, 0.038);
    cyl(m, 0.014, 0.034, MAT.dark, 0, -0.088, 0.005, 10);            // hub
  }, mag);
  add('trigger', 'semi', {}, () => {});
  add('trigger', 'auto', {}, (t) => box(t, 0.008, 0.012, 0.022, MAT.red, -0.018, 0.012, 0.01));
  const h = hands(g, new THREE.Vector3(0.002, -0.06, 0.03), new THREE.Vector3(-0.012, -0.07, 0.02), sleeve);
  h.left.rotation.set(0, 0.3, 0);
  const gun = {
    group: g, sight: 0.058, muzzle: new THREE.Vector3(0, 0.03, -0.17), mag, magHome: mag.position.clone(), slide,
    slideHome: slide.position.clone(), hands: h, hip: new THREE.Vector3(0.13, -0.14, -0.38), ads: new THREE.Vector3(0, -0.058, -0.34),
    kind: 'pistol',
  };
  return attachable(gun, sets, { optic: 'irons', muzzle: 'none', mag: 'normal', trigger: 'semi', barrel: 'normal' });
}

// a tactical fighting knife: straight clip-point blade, textured grip
// the Kabir .50: a long, heavy anti-materiel rifle with a big brake and a folded bipod
function buildHeavy(sleeve) {
  const g = new THREE.Group();
  box(g, 0.075, 0.095, 0.5, MAT.dark, 0, 0, -0.05);                      // receiver
  box(g, 0.07, 0.02, 0.36, MAT.dark, 0, 0.055, -0.08);                    // top rail
  cyl(g, 0.02, 0.75, MAT.steel, 0, 0.012, -0.66, 14);                     // barrel
  cyl(g, 0.026, 0.14, MAT.dark, 0, 0.012, -0.98, 10);                     // the brake
  for (const dz of [-0.94, -0.98, -1.02]) box(g, 0.064, 0.012, 0.008, MAT.dark, 0, 0.012, dz);
  for (const sx of [-1, 1]) {                                             // folded bipod legs
    box(g, 0.01, 0.01, 0.3, MAT.dark, sx * 0.03, -0.045, -0.5, 0.08, 0, sx * 0.1);
  }
  box(g, 0.05, 0.03, 0.25, MAT.polymer, 0, -0.06, -0.38);                // fore-end
  box(g, 0.032, 0.11, 0.045, MAT.polymer, 0, -0.1, 0.11, -0.3);           // grip
  box(g, 0.05, 0.1, 0.32, MAT.polymer, 0, -0.03, 0.36);                   // stock
  box(g, 0.04, 0.04, 0.14, MAT.polymer, 0, 0.045, 0.36);                  // cheek rest
  box(g, 0.012, 0.09, 0.012, MAT.dark, 0, -0.1, 0.46);                    // monopod
  const bolt = new THREE.Group();
  cyl(bolt, 0.009, 0.05, MAT.steel, 0.02, 0, 0, 8).rotation.set(0, 0, Math.PI / 2);
  sphere(bolt, 0.013, MAT.steel, 0.05, 0, 0);
  bolt.position.set(0.03, 0.03, 0.12);
  g.add(bolt);
  const mag = new THREE.Group();
  mag.position.set(0, -0.045, 0.0);
  g.add(mag);
  const { sets, add } = partSet(g);
  add('optic', 'scope8', { S: 0.108, adsZ: -0.1 }, (o) => {
    tubeWithGlass(o, 0.108, -0.04, 0.36, 0.026, MAT.dark);
    cyl(o, 0.036, 0.09, MAT.dark, 0, 0.108, -0.25, 16, 0.03);
    cyl(o, 0.03, 0.07, MAT.dark, 0, 0.108, 0.14, 16, 0.026);
    box(o, 0.03, 0.024, 0.03, MAT.dark, 0, 0.14, -0.06);
    box(o, 0.03, 0.018, 0.03, MAT.dark, 0.03, 0.108, -0.06);
  });
  add('optic', 'reddot', { S: 0.086, adsZ: -0.26 }, (o) => reflex(o, 0.086, -0.06, 0.065));
  muzzleDevices(add, 0.012, -1.05, 0.02, ['none', 'suppressor']);
  laserModules(add, 0.045, 0.0, -0.55);
  gripModules(add, -0.075, -0.4, ['none', 'angled']);
  add('mag', 'normal', {}, (m) => box(m, 0.036, 0.09, 0.09, MAT.dark, 0, -0.045, 0), mag);
  add('mag', 'fast', {}, (m) => {
    box(m, 0.036, 0.09, 0.09, MAT.dark, 0, -0.045, 0);
    box(m, 0.04, 0.03, 0.04, MAT.tan, 0, -0.07, 0.03);
  }, mag);
  const h = hands(g, new THREE.Vector3(0.002, -0.1, 0.12), new THREE.Vector3(0, -0.075, -0.35), sleeve);
  const gun = {
    group: g, sight: 0.108, muzzle: new THREE.Vector3(0, 0.012, -1.05), mag, magHome: mag.position.clone(), bolt,
    boltHome: bolt.position.clone(), hands: h, hip: new THREE.Vector3(0.16, -0.17, -0.44), ads: new THREE.Vector3(0, -0.108, -0.1),
    kind: 'bolt',
  };
  return attachable(gun, sets, { optic: 'scope8', muzzle: 'none', mag: 'normal', laser: 'none', grip: 'none' });
}

// the Asad .44: a big nickel-plated N-frame six-shooter in the old style, a
// full underlug beneath a round barrel, a target hammer and walnut grips; the
// cylinder is its magazine
function buildRevolver(sleeve) {
  const g = new THREE.Group();
  const C = MAT.chrome;
  // the frame: a top strap over the cylinder window, the breech behind it, the lug ahead
  box(g, 0.024, 0.008, 0.07, C, 0, 0.045, -0.035);                         // top strap
  box(g, 0.03, 0.012, 0.07, C, 0, -0.017, -0.035);                         // lower frame
  box(g, 0.03, 0.062, 0.03, C, 0, 0.015, 0.01);                            // breech and recoil shield
  cyl(g, 0.015, 0.03, C, 0, 0.032, 0.01, 12);                              // the rounded top of the shield
  box(g, 0.03, 0.062, 0.02, C, 0, 0.015, -0.075);                          // barrel lug
  box(g, 0.004, 0.008, 0.016, MAT.steel, -0.017, 0.022, 0.006);            // cylinder latch, left side
  box(g, 0.024, 0.006, 0.014, MAT.dark, 0, 0.052, -0.006);                 // adjustable rear sight base
  // the hammer: a wide target spur, cocked back
  box(g, 0.008, 0.03, 0.012, MAT.dark, 0, 0.05, 0.034, 0.55);
  box(g, 0.014, 0.005, 0.014, MAT.dark, 0, 0.066, 0.043, 0.55);
  // trigger guard, a rounded loop
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.017, 0.0032, 6, 18), C);
  guard.rotation.y = Math.PI / 2;
  guard.position.set(0, -0.032, -0.03);
  g.add(guard);
  box(g, 0.004, 0.017, 0.006, MAT.dark, 0, -0.027, -0.028, 0.3);           // trigger
  // the grip: the frame's backstrap between two walnut panels, a square butt
  box(g, 0.022, 0.1, 0.044, C, 0, -0.07, 0.03, -0.28);
  box(g, 0.012, 0.094, 0.04, MAT.wood, -0.015, -0.07, 0.031, -0.28);
  box(g, 0.012, 0.094, 0.04, MAT.wood, 0.015, -0.07, 0.031, -0.28);
  box(g, 0.04, 0.006, 0.048, C, 0, -0.121, 0.045, -0.28);                  // butt cap
  const mag = new THREE.Group();                                           // the cylinder
  mag.position.set(0, 0.015, -0.035);
  g.add(mag);
  const { sets, add } = partSet(g);
  const chambers = (m, n, ring, mat) => {
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; cyl(m, 0.0045, 0.064, mat, Math.cos(a) * ring, Math.sin(a) * ring, 0, 6); }
  };
  const flutes = (m, n, r) => {
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2 + Math.PI / n; box(m, 0.007, 0.004, 0.034, MAT.steel, Math.cos(a) * r, Math.sin(a) * r, 0.002, 0, 0, a + Math.PI / 2); }
  };
  add('mag', 'normal', {}, (m) => { cyl(m, 0.026, 0.06, C, 0, 0, 0, 16); chambers(m, 6, 0.016, MAT.dark); flutes(m, 6, 0.026); }, mag);
  add('mag', 'cyl8', {}, (m) => { cyl(m, 0.03, 0.064, C, 0, 0, 0, 16); chambers(m, 8, 0.02, MAT.dark); }, mag);
  add('mag', 'fast', {}, (m) => { cyl(m, 0.026, 0.06, C, 0, 0, 0, 16); chambers(m, 6, 0.016, MAT.brass); flutes(m, 6, 0.026); }, mag);
  // barrels: a round barrel with a top rib and a full underlug; the front sight
  // rides at the muzzle, so the muzzle moves with the barrel's length
  const barrel = (id, len, tip) => add('barrel', id, { tip, my: 0.031 }, (b) => {
    const zc = -0.085 - len / 2;
    cyl(b, 0.012, len, C, 0, 0.031, zc, 14);                               // the barrel
    box(b, 0.012, 0.005, len, C, 0, 0.0455, zc);                            // top rib
    box(b, 0.018, 0.02, len - 0.012, C, 0, 0.009, zc + 0.006);              // underlug over the ejector rod
    cyl(b, 0.005, 0.012, MAT.steel, 0, 0.004, tip + 0.012, 8);              // ejector rod tip
    box(b, 0.006, 0.014, 0.018, MAT.dark, 0, 0.055, tip + 0.014);           // ramp front sight
    box(b, 0.0025, 0.008, 0.008, MAT.red, 0, 0.058, tip + 0.009);           // its red insert
  });
  barrel('medium', 0.15, -0.235);
  barrel('long', 0.22, -0.305);
  barrel('short', 0.07, -0.155);
  // the rear notch alone: every barrel carries its own front blade
  add('optic', 'irons', { S: 0.062, adsZ: -0.36 }, (o) => {
    box(o, 0.005, 0.01, 0.008, MAT.steel, -0.0075, 0.06, -0.006);
    box(o, 0.005, 0.01, 0.008, MAT.steel, 0.0075, 0.06, -0.006);
  });
  add('optic', 'reddot', { S: 0.09, adsZ: -0.34 }, (o) => {
    box(o, 0.026, 0.012, 0.05, MAT.dark, 0, 0.061, -0.03);
    reflex(o, 0.09, -0.04, 0.067);
  });
  add('optic', 'acog', { S: 0.1, adsZ: -0.22 }, (o) => {
    box(o, 0.026, 0.012, 0.06, MAT.dark, 0, 0.061, -0.03);
    acogBody(o, 0.1, -0.03, MAT.dark);
  });
  add('optic', 'scope6', { S: 0.104, adsZ: -0.18 }, (o) => {
    box(o, 0.026, 0.012, 0.07, MAT.dark, 0, 0.061, -0.03);
    scopeTube(o, 0.104, 0.2, -0.03, MAT.dark, MAT.silver);
  });
  laserModules(add, 0, -0.012, -0.12);
  const h = hands(g, new THREE.Vector3(0.002, -0.078, 0.046), new THREE.Vector3(-0.014, -0.088, 0.028), sleeve);
  h.left.rotation.set(0, 0.3, 0);
  const gun = {
    group: g, sight: 0.062, muzzle: new THREE.Vector3(0, 0.031, -0.235), mag, magHome: mag.position.clone(),
    hands: h, hip: new THREE.Vector3(0.14, -0.15, -0.4), ads: new THREE.Vector3(0, -0.062, -0.36),
    kind: 'revolver',
  };
  return attachable(gun, sets, { optic: 'irons', mag: 'normal', laser: 'none', barrel: 'medium' });
}

// the Barq PDW: a long flat upper with the bore along its bottom edge, a deep
// slab of a lower under the front where the bolt drops, the magazine ahead of
// the trigger, the grip well back, a skeleton stock
function buildPDW(sleeve) {
  const g = new THREE.Group();
  box(g, 0.048, 0.04, 0.36, MAT.polymer, 0, 0.03, -0.1);                // upper: z -0.28 .. 0.08
  box(g, 0.045, 0.012, 0.34, MAT.dark, 0, 0.056, -0.1);                 // top rail
  box(g, 0.05, 0.11, 0.2, MAT.polymer, 0, -0.045, -0.16);               // the deep lower, z -0.26 .. -0.06
  box(g, 0.05, 0.075, 0.05, MAT.polymer, 0, -0.06, -0.28, 0.55);        // its slanted nose
  box(g, 0.045, 0.05, 0.16, MAT.polymer, 0, -0.015, 0.02);              // trigger housing, z -0.06 .. 0.1
  box(g, 0.03, 0.09, 0.035, MAT.polymer, 0, -0.085, 0.09, -0.25);       // grip, right at the back
  box(g, 0.012, 0.03, 0.05, MAT.dark, 0, -0.055, 0.03);                 // trigger guard
  for (const z of [-0.12, -0.17, -0.22]) box(g, 0.054, 0.006, 0.008, MAT.dark, 0, -0.03, z);   // side rail ribs
  box(g, 0.054, 0.006, 0.008, MAT.dark, 0, -0.03, -0.07);
  for (const sx of [-1, 1]) box(g, 0.008, 0.016, 0.18, MAT.dark, sx * 0.018, 0.03, 0.19);     // the skeleton stock
  box(g, 0.045, 0.07, 0.02, MAT.polymer, 0, 0.015, 0.29);               // butt
  const charge = box(g, 0.018, 0.012, 0.03, MAT.dark, -0.034, 0.035, -0.2);
  const mag = new THREE.Group();
  mag.position.set(0, -0.1, -0.08);
  g.add(mag);
  const { sets, add } = partSet(g);
  const rail = 0.062;
  add('optic', 'irons', { S: 0.083, adsZ: -0.3 }, (o) => irons(o, 0.083, -0.25, 0.06, rail, rail));
  add('optic', 'reddot', { S: 0.093, adsZ: -0.3 }, (o) => reflex(o, 0.093, -0.02, rail));
  add('optic', 'holo', { S: 0.115, adsZ: -0.22 }, (o) => holo(o, 0.115, -0.03, rail));
  add('optic', 'acog', { S: 0.107, adsZ: -0.18 }, (o) => {
    box(o, 0.03, 0.018, 0.1, MAT.dark, 0, 0.067, -0.03);
    acogBody(o, 0.107, -0.03, MAT.tan);
  });
  barrelParts(add, 0.012, -0.28, 0.011, { normal: 0.07, ext: 0.17, short: 0.04 });
  muzzleDevices(add, 0.012, -0.35, 0.011, ['none', 'brake', 'suppressor', 'longbrake']);
  laserModules(add, 0, -0.112, -0.23);
  gripModules(add, -0.1, -0.15);
  add('mag', 'normal', {}, (m) => box(m, 0.026, 0.11, 0.04, MAT.dark, 0, -0.055, 0), mag);
  add('mag', 'fast', {}, (m) => {
    box(m, 0.026, 0.11, 0.04, MAT.dark, 0, -0.055, 0);
    box(m, 0.03, 0.04, 0.044, MAT.tan, 0, -0.08, 0.004);
    box(m, 0.028, 0.016, 0.042, MAT.brass, 0, -0.105, 0.012);
  }, mag);
  add('mag', 'large', {}, (m) => {
    box(m, 0.028, 0.2, 0.042, MAT.dark, 0, -0.1, 0.004);
    box(m, 0.03, 0.016, 0.044, MAT.steel, 0, -0.03, 0);
  }, mag);
  const h = hands(g, new THREE.Vector3(0.002, -0.1, 0.09), new THREE.Vector3(0, -0.11, -0.2), sleeve);
  const gun = {
    group: g, sight: 0.083, muzzle: new THREE.Vector3(0, 0.012, -0.35), mag, magHome: mag.position.clone(), charge,
    chargeHome: charge.position.clone(), hands: h,
    hip: new THREE.Vector3(0.15, -0.15, -0.38), ads: new THREE.Vector3(0, -0.083, -0.3), kind: 'mag',
  };
  return attachable(gun, sets, { optic: 'irons', muzzle: 'none', mag: 'normal', laser: 'none', grip: 'none', barrel: 'normal' });
}

// the Rimah Carbine: flat-top upper with the port cover and forward assist, a
// round ribbed handguard behind a delta ring, an A-frame front sight, a curved
// magazine, a collapsible stock on its buffer tube
function buildCarbine(sleeve) {
  const g = new THREE.Group();
  box(g, 0.05, 0.055, 0.2, MAT.dark, 0, 0.022, 0.0);                    // upper receiver
  box(g, 0.045, 0.012, 0.2, MAT.dark, 0, 0.056, 0.0);                    // flat-top rail
  box(g, 0.008, 0.024, 0.05, MAT.steel, 0.028, 0.016, -0.02);            // ejection port cover
  box(g, 0.012, 0.03, 0.012, MAT.dark, 0.03, 0.01, 0.02, 0, 0, 0.3);     // brass deflector
  const fa = cyl(g, 0.009, 0.02, MAT.dark, 0.032, 0.02, 0.05, 8);         // forward assist
  fa.rotation.set(0, 0, Math.PI / 2);
  box(g, 0.045, 0.05, 0.16, MAT.dark, 0, -0.03, 0.03);                    // lower receiver
  box(g, 0.042, 0.045, 0.04, MAT.dark, 0, -0.07, -0.02);                  // magazine well
  box(g, 0.03, 0.1, 0.035, MAT.polymer, 0, -0.1, 0.085, -0.35);           // grip
  box(g, 0.012, 0.03, 0.05, MAT.dark, 0, -0.06, 0.025);                   // trigger guard
  cyl(g, 0.027, 0.2, MAT.polymer, 0, 0.018, -0.2, 12, 0.023);             // the round handguard, tapering forward
  for (let z = -0.13; z > -0.28; z -= 0.02) cyl(g, 0.029, 0.005, MAT.polymer, 0, 0.018, z, 12, 0.029);   // its ribs
  cyl(g, 0.032, 0.025, MAT.dark, 0, 0.018, -0.1, 12);                     // delta ring
  cyl(g, 0.03, 0.02, MAT.dark, 0, 0.018, -0.3, 12, 0.026);                // handguard cap
  box(g, 0.02, 0.05, 0.03, MAT.dark, 0, 0.045, -0.33);                    // the front sight base
  box(g, 0.005, 0.03, 0.02, MAT.dark, -0.012, 0.078, -0.33, 0, 0, 0.35);  // its A-frame ears
  box(g, 0.005, 0.03, 0.02, MAT.dark, 0.012, 0.078, -0.33, 0, 0, -0.35);
  cyl(g, 0.016, 0.2, MAT.dark, 0, 0.025, 0.2, 10);                        // buffer tube
  box(g, 0.036, 0.05, 0.12, MAT.polymer, 0, 0.005, 0.24);                 // the stock riding it
  box(g, 0.036, 0.09, 0.025, MAT.polymer, 0, -0.01, 0.31);                // butt
  box(g, 0.02, 0.03, 0.1, MAT.polymer, 0, -0.03, 0.24, 0.3);              // the stock's angled lower arm
  const charge = box(g, 0.03, 0.01, 0.035, MAT.dark, 0, 0.05, 0.11);
  const mag = new THREE.Group();
  mag.position.set(0, -0.09, -0.02);
  g.add(mag);
  const { sets, add } = partSet(g);
  const rail = 0.062;
  add('optic', 'irons', { S: 0.09, adsZ: -0.28 }, (o) => irons(o, 0.09, -0.33, 0.08, 0.07, rail));
  add('optic', 'reddot', { S: 0.093, adsZ: -0.28 }, (o) => reflex(o, 0.093, -0.02, rail));
  add('optic', 'holo', { S: 0.115, adsZ: -0.2 }, (o) => holo(o, 0.115, -0.02, rail));
  add('optic', 'acog', { S: 0.107, adsZ: -0.16 }, (o) => {
    box(o, 0.03, 0.018, 0.1, MAT.dark, 0, 0.067, -0.02);
    acogBody(o, 0.107, -0.02, MAT.dark);
  });
  add('optic', 'scope6', { S: 0.111, adsZ: -0.12 }, (o) => {
    box(o, 0.03, 0.02, 0.14, MAT.dark, 0, 0.068, -0.01);
    scopeTube(o, 0.111, 0.3, -0.01, MAT.dark, MAT.steel);
  });
  barrelParts(add, 0.018, -0.3, 0.011, { normal: 0.14, ext: 0.24, short: 0.08 });
  muzzleDevices(add, 0.018, -0.44, 0.011, ['none', 'brake', 'suppressor', 'longbrake']);
  laserModules(add, 0.038, 0.012, -0.22);
  gripModules(add, -0.008, -0.2);
  // the curved thirty-round magazine: two lengths, the lower one swept forward
  const stanag = (m, long) => {
    box(m, 0.028, 0.08, 0.05, MAT.dark, 0, -0.04, 0, 0.1);
    box(m, 0.028, long ? 0.16 : 0.09, 0.05, MAT.dark, 0, long ? -0.15 : -0.115, -0.012, 0.32);
  };
  add('mag', 'normal', {}, (m) => stanag(m, false), mag);
  add('mag', 'fast', {}, (m) => {
    stanag(m, false);
    box(m, 0.034, 0.04, 0.054, MAT.tan, 0, -0.1, -0.01, 0.32);
    box(m, 0.03, 0.016, 0.052, MAT.brass, 0, -0.155, -0.026, 0.32);
  }, mag);
  add('mag', 'large', {}, (m) => {
    stanag(m, true);
    box(m, 0.032, 0.018, 0.054, MAT.steel, 0, -0.085, -0.004, 0.32);
  }, mag);
  const h = hands(g, new THREE.Vector3(0.002, -0.1, 0.085), new THREE.Vector3(0, -0.03, -0.2), sleeve);
  const gun = {
    group: g, sight: 0.09, muzzle: new THREE.Vector3(0, 0.018, -0.44), mag, magHome: mag.position.clone(), charge,
    chargeHome: charge.position.clone(), hands: h,
    hip: new THREE.Vector3(0.15, -0.15, -0.4), ads: new THREE.Vector3(0, -0.09, -0.28), kind: 'mag',
  };
  return attachable(gun, sets, { optic: 'irons', muzzle: 'none', mag: 'normal', laser: 'none', grip: 'none', barrel: 'normal' });
}

// the Nar flamethrower: a tank and hose behind, a long nozzle with a pilot light ahead
function buildFlamer(sleeve) {
  const g = new THREE.Group();
  box(g, 0.06, 0.07, 0.28, MAT.dark, 0, 0, 0.0);                          // body
  cyl(g, 0.012, 0.42, MAT.steel, 0, 0.012, -0.34, 10);                    // the lance
  cyl(g, 0.02, 0.05, MAT.dark, 0, 0.012, -0.55, 10);                      // nozzle
  const pilot = sphere(g, 0.012, MAT.red, 0, 0.012, -0.585);               // the pilot light
  const jet = new THREE.Group();                                           // fire out of the nozzle while the trigger is held
  const jetMat = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false });
  cyl(jet, 0.014, 0.42, jetMat('#ff7a1e', 0.55), 0, 0, -0.21, 10, 0.06);
  cyl(jet, 0.008, 0.28, jetMat('#fff1a8', 0.8), 0, 0, -0.14, 8, 0.03);
  jet.position.set(0, 0.012, -0.6);
  jet.visible = false;
  g.add(jet);
  cyl(g, 0.03, 0.14, MAT.steel, 0, -0.01, -0.16, 12);                      // the mixing chamber
  box(g, 0.03, 0.1, 0.04, MAT.polymer, 0, -0.085, 0.06, -0.3);            // grip
  box(g, 0.02, 0.05, 0.08, MAT.polymer, 0, -0.06, -0.24);                 // fore grip
  box(g, 0.025, 0.02, 0.05, MAT.dark, 0.02, 0.046, 0.02);                 // gauge housing
  box(g, 0.02, 0.006, 0.02, MAT.brass, 0.02, 0.058, 0.02);
  cyl(g, 0.02, 0.5, MAT.tan, 0, -0.03, 0.4, 10);                          // the hose running back
  const { sets, add } = partSet(g);
  add('optic', 'irons', { S: 0.052, adsZ: -0.3 }, (o) => irons(o, 0.052, -0.3, 0.06, 0.038, 0.038));
  const h = hands(g, new THREE.Vector3(0.002, -0.09, 0.06), new THREE.Vector3(0, -0.075, -0.24), sleeve);
  const gun = {
    group: g, sight: 0.052, muzzle: new THREE.Vector3(0, 0.012, -0.6), hands: h, pilot, jet,
    hip: new THREE.Vector3(0.15, -0.15, -0.4), ads: new THREE.Vector3(0, -0.052, -0.3), kind: 'flame',
  };
  return attachable(gun, sets, { optic: 'irons' });
}

function buildKnife(sleeve) {
  const root = new THREE.Group();
  // the whole knife is built pointing forward, then held point-up and
  // tilted a little across the body, the way a fighting knife is carried
  const g = new THREE.Group();
  g.rotation.set(1.25, 0, 0.3);
  g.position.set(0.0, -0.02, 0.0);
  root.add(g);
  const edge = MAT.steel;
  // blade: a flat bar with a bevelled spine, tapering to a clipped point
  box(g, 0.026, 0.008, 0.2, edge, 0, 0.012, -0.135);
  box(g, 0.016, 0.004, 0.2, MAT.dark, 0, 0.017, -0.135);            // blood groove
  const clip = box(g, 0.02, 0.007, 0.06, edge, 0, 0.012, -0.256);   // clipped tip
  clip.rotation.x = 0.12;
  box(g, 0.009, 0.006, 0.03, edge, 0, 0.006, -0.288);
  // serrations along the back of the blade, near the guard
  for (let i = 0; i < 5; i++) box(g, 0.026, 0.006, 0.008, MAT.dark, 0, 0.018, -0.06 - i * 0.018);
  // guard with a forward finger choil
  box(g, 0.05, 0.02, 0.018, MAT.dark, 0, 0.012, -0.022);
  box(g, 0.02, 0.03, 0.016, MAT.dark, 0, -0.002, -0.032);
  // grip: black polymer with finger grooves, and a pommel with a lanyard hole
  box(g, 0.03, 0.034, 0.1, MAT.polymer, 0, 0.01, 0.032);
  for (let i = 0; i < 4; i++) box(g, 0.032, 0.012, 0.012, MAT.dark, 0, -0.006, 0.0 + i * 0.024);
  box(g, 0.032, 0.03, 0.022, MAT.dark, 0, 0.01, 0.092);
  const h = hands(root, new THREE.Vector3(0, 0.02, 0.0), new THREE.Vector3(0, 0, 0), sleeve);
  h.left.visible = false;
  return {
    group: root, sight: 0.05, muzzle: new THREE.Vector3(0, 0.02, -0.2), hands: h,
    hip: new THREE.Vector3(0.15, -0.16, -0.33), ads: new THREE.Vector3(0.11, -0.14, -0.29), kind: 'knife',
  };
}

function buildNadeHand(sleeve) {
  const g = new THREE.Group();
  box(g, 0.05, 0.06, 0.07, MAT.glove, 0, 0, 0);
  box(g, 0.07, 0.07, 0.34, sleeve, 0.02, -0.04, 0.2, 0.25, 0.1, 0);
  // a frag: the pineapple with its lever
  const frag = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 10), MAT.nade);
  body.scale.set(1, 1.25, 1);
  frag.add(body);
  box(frag, 0.015, 0.02, 0.015, MAT.steel, 0, 0.04, 0);
  box(frag, 0.01, 0.05, 0.012, MAT.steel, 0.012, 0.02, 0, 0, 0, 0.2);
  frag.position.set(0, 0.04, -0.01);
  g.add(frag);
  // a molotov: a bottle with a rag in its neck
  const molotov = new THREE.Group();
  cyl(molotov, 0.022, 0.09, MAT.bottle, 0, 0, 0, 12).rotation.x = 0;
  cyl(molotov, 0.009, 0.04, MAT.bottle, 0, 0.06, 0, 10).rotation.x = 0;
  cyl(molotov, 0.012, 0.03, MAT.rag, 0, 0.085, 0, 8).rotation.x = 0;
  box(molotov, 0.02, 0.03, 0.006, MAT.rag, 0.012, 0.09, 0.008, 0.3, 0, -0.5);
  molotov.position.set(0, 0.05, -0.01);
  g.add(molotov);
  // a canister: smoke or flash
  const can = new THREE.Group();
  cyl(can, 0.02, 0.09, MAT.steel, 0, 0, 0, 12).rotation.x = 0;
  cyl(can, 0.012, 0.02, MAT.dark, 0, 0.055, 0, 10).rotation.x = 0;
  box(can, 0.01, 0.05, 0.012, MAT.steel, 0.012, 0.03, 0, 0, 0, 0.2);
  can.position.set(0, 0.04, -0.01);
  g.add(can);
  // a throwing knife, held by the blade's tip, ready to go
  const tknife = new THREE.Group();
  box(tknife, 0.018, 0.005, 0.2, MAT.silver, 0, 0.06, -0.06, -0.35);
  box(tknife, 0.022, 0.018, 0.08, MAT.dark, 0, 0.01, 0.04, -0.35);
  tknife.position.set(0, 0.03, -0.01);
  g.add(tknife);
  g.kinds = { frag, molotov, can, tknife };
  return g;
}

export const GUN_BUILDERS = { smg: buildSMG, lmg: buildLMG, shotgun: buildShotgun, sniper: buildSniper, pistol: buildPistol, knife: buildKnife, heavy: buildHeavy, revolver: buildRevolver, flamer: buildFlamer, pdw: buildPDW, carbine: buildCarbine };

// a gun on its own, for the locker preview
export function buildPreviewGun(id, finishId, fitted) {
  const g = GUN_BUILDERS[id](MAT.sleeve);
  if (g.setAttach) g.setAttach(fitted);
  g.hands.right.visible = false;
  g.hands.left.visible = false;
  skinGun(g.group, finishId);
  return g;
}

// -- easing helpers -------------------------------------------------------------

const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const seg = (t, a, b) => ease((t - a) / (b - a));
const lerp = (a, b, t) => a + (b - a) * t;

export class ViewModel {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.01, 10);
    this.hemi = new THREE.HemisphereLight('#e8eef4', '#9a7a55', 2.4);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight('#fff0d8', 2.6);
    this.key.position.set(0.5, 1, 0.3);
    this.scene.add(this.key);
    this.flashLight = new THREE.PointLight('#ffb35a', 0, 1.5, 2);
    this.scene.add(this.flashLight);
    this.sleeve = MAT.sleeve.clone();
    this.guns = {
      smg: buildSMG(this.sleeve), lmg: buildLMG(this.sleeve), shotgun: buildShotgun(this.sleeve),
      sniper: buildSniper(this.sleeve), pistol: buildPistol(this.sleeve), knife: buildKnife(this.sleeve),
      heavy: buildHeavy(this.sleeve), revolver: buildRevolver(this.sleeve), flamer: buildFlamer(this.sleeve),
      pdw: buildPDW(this.sleeve), carbine: buildCarbine(this.sleeve),
    };
    this.root = new THREE.Group();
    this.scene.add(this.root);
    for (const k in this.guns) {
      const gun = this.guns[k];
      gun.group.visible = false;
      this.root.add(gun.group);
      const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex(), blending: THREE.AdditiveBlending,
        depthWrite: false, transparent: true }));
      fl.scale.set(0.07, 0.07, 1);
      fl.position.copy(gun.muzzle);
      fl.position.z -= 0.03;
      fl.visible = false;
      gun.group.add(fl);
      gun.flash = fl;
    }
    this.nadeHand = buildNadeHand(this.sleeve);
    this.nadeHand.visible = false;
    this.root.add(this.nadeHand);

    this.cur = null;
    this.curId = null;
    this.pending = null;
    this.switchT = 1;         // 0..1 raise progress
    this.lowering = 0;
    this.kick = 0;
    this.kickV = 0;
    this.flashT = 0;
    this.jetT = 0;            // the flamethrower's jet stays lit this long after the last frame of fire
    this.bobT = 0;
    this.sway = new THREE.Vector2();
    this.swayTarget = new THREE.Vector2();
    this.reload = null;       // {t, dur, kind, empty}
    this.shellAnim = -1;
    this.pumpAnim = -1;
    this.boltAnim = -1;
    this.slideAnim = -1;
    this.nadeAnim = -1;
    this.swingAnim = -1;
    this.sprint = 0;
    this.ads = 0;
    this.visible = true;
    this.scoped = false;
    this.vestT = 0;           // a vest going on: the gun goes down for the while
    this.vestDur = 1;
  }

  applyVest(dur) {
    this.vestT = dur;
    this.vestDur = dur;
  }

  setTeamColor(hex) {
    this.sleeve.color.set(hex);
  }

  // fit attachments to a gun
  setAttachments(weapon, fitted) {
    const gun = this.guns[weapon];
    if (gun && gun.setAttach) gun.setAttach(fitted);
  }

  // finishes per weapon: { smg: 'zellige', ... }
  setSkins(map) {
    for (const k in this.guns) skinGun(this.guns[k].group, (map && map[k]) || null);
  }

  setWeapon(id) {
    for (const k in this.guns) this.guns[k].group.visible = false;
    this.cur = this.guns[id];
    this.curId = id;
    this.cur.group.visible = true;
    this.switchT = 0;
    this.pending = null;
    this.lowering = 0;
    this.cancelReload();
  }

  switchTo(id) {
    if (id === this.curId && !this.pending) return;
    this.pending = id;
    this.lowering = 1e-4;
    this.cancelReload();
  }

  get busySwitching() {
    return !!this.pending || this.switchT < 0.8;
  }

  cancelReload() {
    this.reload = null;
    this.shellAnim = -1;
    const g = this.cur;
    if (!g) return;
    if (g.mag) { g.mag.position.copy(g.magHome); g.mag.visible = true; }
    if (g.hands) g.hands.left.position.copy(g.hands.leftHome);
    if (g.shell) g.shell.visible = false;
    if (g.cover) g.cover.rotation.x = 0;
    if (g.charge) g.charge.position.copy(g.chargeHome);
  }

  startReload(dur, empty) {
    if (!this.cur) return;
    this.reload = { t: 0, dur, empty };
  }

  // shotgun: one shell pushed into the tube
  shell(dur) {
    this.reload = { t: 0, dur, shell: true };
  }

  endReload() {
    this.cancelReload();
  }

  pump() {
    this.pumpAnim = 0;
  }

  bolt() {
    this.boltAnim = 0;
  }

  fire(kick, suppressed = false) {
    this.kickV += kick * 14;
    this.flashT = 0.05;
    this.flashSmall = suppressed;
    if (this.cur && this.cur.slide) this.slideAnim = 0;
  }

  // called every frame the flamethrower's trigger is held
  flameOn() {
    this.jetT = 0.06;
  }

  throwNade(kind = 'frag') {
    this.nadeAnim = 0;
    const K = this.nadeHand.kinds;
    if (K) {
      K.frag.visible = kind === 'frag';
      K.molotov.visible = kind === 'molotov';
      K.can.visible = kind === 'smoke' || kind === 'flash';
      K.tknife.visible = kind === 'tknife';
    }
  }

  // the knife: wind up across the body, then slash down and across
  swing() {
    this.swingAnim = 0;
  }

  muzzleWorld(camera, out) {
    if (!this.cur) return out.copy(camera.position);
    const p = this.cur.muzzle.clone();
    this.cur.group.updateMatrixWorld(true);
    this.root.updateMatrixWorld(true);
    p.applyMatrix4(this.cur.group.matrixWorld);
    // viewmodel space is camera space
    return out.copy(p).applyMatrix4(camera.matrixWorld);
  }

  // where the barrel points, in world space (the laser follows this, not the crosshair)
  muzzleDirWorld(camera, out) {
    if (!this.cur) return out.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const a = this.cur.muzzle.clone();
    const b = this.cur.muzzle.clone().add(new THREE.Vector3(0, 0, -1));
    this.cur.group.updateMatrixWorld(true);
    a.applyMatrix4(this.cur.group.matrixWorld).applyMatrix4(camera.matrixWorld);
    b.applyMatrix4(this.cur.group.matrixWorld).applyMatrix4(camera.matrixWorld);
    return out.copy(b).sub(a).normalize();
  }

  update(dt, st) {
    const g = this.cur;
    if (!g) return;
    // switching
    if (this.pending) {
      this.lowering += dt / 0.2;
      if (this.lowering >= 1) {
        const id = this.pending;
        this.setWeapon(id);
      }
    } else if (this.switchT < 1) {
      this.switchT = Math.min(1, this.switchT + dt / 0.3);
    }
    let down = this.pending ? ease(this.lowering) : 1 - ease(this.switchT);
    if (this.vestT > 0) {
      this.vestT -= dt;
      const t = 1 - this.vestT / this.vestDur;
      down = Math.max(down, seg(t, 0, 0.12) * (1 - seg(t, 0.85, 1)));
    }

    this.ads = st.ads;
    this.sprint += ((st.sprint ? 1 : 0) - this.sprint) * Math.min(1, dt * 10);
    // recoil spring
    this.kickV += (-this.kick * 260 - this.kickV * 22) * dt;
    this.kick += this.kickV * dt;
    // bob
    const speed = st.speed;
    if (speed > 0.5 && st.grounded) this.bobT += dt * (speed * 1.55);
    const bobAmt = Math.min(1, speed / 5) * (1 - this.ads * 0.85);
    const bx = Math.sin(this.bobT) * 0.012 * bobAmt;
    const by = -Math.abs(Math.cos(this.bobT)) * 0.012 * bobAmt;
    // sway from looking around
    this.swayTarget.set(-st.look[0] * 0.00035, st.look[1] * 0.00035);
    this.swayTarget.clampScalar(-0.04, 0.04);
    this.sway.lerp(this.swayTarget, Math.min(1, dt * 12));
    const swayMul = 1 - this.ads * 0.8;

    const a = ease(this.ads);
    const pos = new THREE.Vector3().lerpVectors(g.hip, g.ads, a);
    pos.x += bx + this.sway.x * swayMul;
    pos.y += by + this.sway.y * swayMul - down * 0.3 - (st.crouch ? 0.006 : 0);
    pos.z += this.kick;
    let rx = this.kick * 1.6 + down * -0.6 + this.sway.y * 2 * swayMul;
    let ry = this.sway.x * 2 * swayMul;
    let rz = 0;
    // run pose
    const sp = this.sprint * (1 - a);
    pos.x += sp * -0.05; pos.y += sp * -0.05; pos.z += sp * 0.03;
    rx += sp * -0.35; ry += sp * 0.75; rz += sp * 0.25;
    if (st.landed) this.kickV -= st.landed * 0.02;

    // reload poses
    this.animateReload(dt, g);
    if (this.reload) {
      const r = this.reload;
      const t = r.shell ? 0.5 : r.t / r.dur;
      const tilt = r.shell ? 1 : seg(t, 0, 0.12) * (1 - seg(t, 0.86, 1));
      if (g.kind === 'bolt') { rz += tilt * 0.35; rx += tilt * 0.12; pos.y -= tilt * 0.02; }
      else if (g.kind === 'shell') { rz += tilt * -0.5; rx += tilt * 0.12; pos.x -= tilt * 0.02; pos.y -= tilt * 0.01; }
      else if (g.kind === 'box') { rz += tilt * 0.3; rx += tilt * 0.22; pos.y -= tilt * 0.02; }
      else { rz += tilt * 0.45; rx += tilt * 0.18; pos.y -= tilt * 0.015; }
    }
    // grenade throw: lower the gun, bring the hand up and over
    if (this.nadeAnim >= 0) {
      this.nadeAnim += dt / 0.55;
      const t = this.nadeAnim;
      const low = seg(t, 0, 0.2) * (1 - seg(t, 0.75, 1));
      pos.y -= low * 0.35;
      rx -= low * 0.5;
      const nh = this.nadeHand;
      nh.visible = t < 0.62;
      const wind = seg(t, 0.05, 0.35), fling = seg(t, 0.35, 0.6);
      nh.position.set(0.12 - fling * 0.08, -0.25 + wind * 0.25 - fling * 0.05, -0.28 + wind * 0.08 - fling * 0.25);
      nh.rotation.set(-0.2 + wind * 0.9 - fling * 1.6, 0, 0);
      if (t >= 1) { this.nadeAnim = -1; nh.visible = false; }
    }
    // knife jab: a short cock of the wrist, then the blade snaps straight
    // out and straight back, all along the line of sight, over a third of a second
    if (this.swingAnim >= 0) {
      this.swingAnim += dt / 0.32;
      const t = this.swingAnim;
      const cock = seg(t, 0, 0.12), snap = seg(t, 0.12, 0.28), back = seg(t, 0.28, 0.6);
      const out = snap - back;               // 1 at full extension
      pos.x += cock * 0.02 - out * 0.01;
      pos.y += cock * 0.02 - out * 0.02;
      pos.z += cock * 0.06 - out * 0.32;
      rx -= out * 0.15;
      ry += cock * 0.1 - out * 0.12;
      rz += cock * 0.12;
      if (t >= 1) this.swingAnim = -1;
    }
    g.group.position.copy(pos);
    g.group.rotation.set(rx, ry, rz, 'YXZ');

    // muzzle flash
    this.flashT -= dt;
    g.flash.visible = this.flashT > 0 && !this.scoped;
    if (g.flash.visible) {
      g.flash.material.rotation = Math.random() * Math.PI;
      const s = (0.05 + Math.random() * 0.04) * (this.flashSmall ? 0.3 : 1);
      g.flash.scale.set(s, s, 1);
    }
    this.flashLight.intensity = this.flashT > 0 ? (this.flashSmall ? 0.5 : 3) : 0;
    this.jetT -= dt;
    if (g.jet) {
      g.jet.visible = this.jetT > 0 && !this.scoped;
      if (g.jet.visible) {
        const f = 0.85 + Math.random() * 0.3;
        g.jet.scale.set(f, f, 0.8 + Math.random() * 0.4);
        g.jet.rotation.z = Math.random() * Math.PI;
      }
      if (g.jet.visible) this.flashLight.intensity = Math.max(this.flashLight.intensity, 1.5);
    }
    this.flashLight.position.copy(pos).add(g.muzzle);
    this.root.visible = this.visible && !this.scoped;
    const light = st.indoor ? 0.55 : 1;
    this.hemi.intensity += (2.4 * light - this.hemi.intensity) * Math.min(1, dt * 4);
    this.key.intensity += (2.6 * light - this.key.intensity) * Math.min(1, dt * 4);
  }

  animateReload(dt, g) {
    // slide / pump / bolt one-shots
    if (this.slideAnim >= 0 && g.slide) {
      this.slideAnim += dt / 0.09;
      const t = this.slideAnim;
      g.slide.position.z = g.slideHome.z + (t < 0.4 ? t / 0.4 : Math.max(0, 1 - (t - 0.4) / 0.6)) * 0.035;
      if (t >= 1) { this.slideAnim = -1; g.slide.position.copy(g.slideHome); }
    }
    if (this.pumpAnim >= 0 && g.pump) {
      this.pumpAnim += dt / 0.42;
      const t = this.pumpAnim;
      const back = seg(t, 0.05, 0.45) * (1 - seg(t, 0.55, 0.95));
      g.pump.position.z = g.pumpHome.z + back * 0.08;
      g.hands.left.position.z = g.hands.leftHome.z + back * 0.08;
      if (t >= 1) { this.pumpAnim = -1; g.pump.position.copy(g.pumpHome); g.hands.left.position.copy(g.hands.leftHome); }
    }
    if (this.boltAnim >= 0 && g.bolt) {
      this.boltAnim += dt / 0.75;
      const t = this.boltAnim;
      const up = seg(t, 0.1, 0.25) * (1 - seg(t, 0.7, 0.85));
      const back = seg(t, 0.28, 0.45) * (1 - seg(t, 0.5, 0.68));
      g.bolt.rotation.z = up * 1.1;
      g.bolt.position.z = g.boltHome.z + back * 0.07;
      g.hands.right.position.x = 0.002 + up * 0.03;
      if (t >= 1) { this.boltAnim = -1; g.bolt.rotation.z = 0; g.bolt.position.copy(g.boltHome); g.hands.right.position.x = 0.002; }
    }
    const r = this.reload;
    if (!r) return;
    r.t += dt;
    const L = g.hands.left, home = g.hands.leftHome;
    if (r.shell) {
      // one shell: hand dips below, comes up to the loading port, pushes it in
      const t = Math.min(1, r.t / r.dur);
      const dip = Math.sin(Math.min(1, t / 0.45) * Math.PI);
      const push = seg(t, 0.45, 0.8);
      L.position.set(home.x, lerp(-0.14, -0.05, seg(t, 0.1, 0.45)) - dip * 0.05, lerp(home.z + 0.25, 0.02, seg(t, 0.0, 0.45)) - push * 0.0);
      g.shell.visible = t > 0.08 && t < 0.8;
      g.shell.position.set(0, L.position.y + 0.03 + push * 0.015, L.position.z - 0.02 - push * 0.06);
      if (t >= 1) {
        g.shell.visible = false;
        L.position.copy(home);
      }
      return;
    }
    const t = Math.min(1, r.t / r.dur);
    if (g.kind === 'mag' || g.kind === 'pistol' || g.kind === 'bolt' || g.kind === 'revolver') {
      // out: 0.12–0.3, new mag up: 0.35–0.62, seat: 0.62–0.7
      const out = seg(t, 0.14, 0.3);
      const inn = seg(t, 0.36, 0.62);
      const drop = out * (1 - inn);
      const home2 = g.magHome;
      g.mag.position.set(home2.x, home2.y - drop * 0.35 - (t > 0.3 && t < 0.36 ? 0.35 : 0), home2.z + drop * 0.05);
      g.mag.visible = !(t > 0.3 && t < 0.36);
      // the hand follows the magazine
      const toMag = seg(t, 0.08, 0.2) * (1 - seg(t, 0.68, 0.84));
      const hx = lerp(home.x, home2.x - 0.01, toMag);
      const hy = lerp(home.y, home2.y - 0.1 - drop * 0.3, toMag);
      const hz = lerp(home.z, home2.z + 0.01, toMag);
      L.position.set(hx, hy, hz);
      if (g.charge) {
        const pull = r.empty ? seg(t, 0.72, 0.8) * (1 - seg(t, 0.82, 0.9)) : 0;
        g.charge.position.z = g.chargeHome.z + pull * 0.05;
      }
      if (g.slide && r.empty) {
        g.slide.position.z = g.slideHome.z + (t < 0.75 ? 0.03 : 0.03 * (1 - seg(t, 0.75, 0.82)));
      }
    } else if (g.kind === 'box') {
      // LMG: cover up, box off, new box on, belt, cover down
      g.cover.rotation.x = -seg(t, 0.08, 0.18) * (1 - seg(t, 0.78, 0.88)) * 1.1;
      const out = seg(t, 0.22, 0.38);
      const inn = seg(t, 0.44, 0.66);
      const drop = out * (1 - inn);
      g.mag.position.set(g.magHome.x - drop * 0.05, g.magHome.y - drop * 0.4, g.magHome.z);
      g.mag.visible = !(t > 0.38 && t < 0.44);
      const toMag = seg(t, 0.14, 0.24) * (1 - seg(t, 0.7, 0.8));
      const toCover = seg(t, 0.02, 0.1) * (1 - seg(t, 0.14, 0.2)) + seg(t, 0.74, 0.8) * (1 - seg(t, 0.88, 0.96));
      L.position.set(
        lerp(home.x, g.magHome.x - 0.06, toMag),
        lerp(home.y, g.magHome.y - 0.1 - drop * 0.35, toMag) + toCover * 0.14,
        lerp(home.z, g.magHome.z, Math.max(toMag, toCover)) + toCover * 0.2,
      );
    }
    if (t >= 1) {
      this.reload = null;
      this.cancelReload();
    }
  }
}
