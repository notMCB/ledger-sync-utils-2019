// First-person guns and hands, drawn in their own scene over the world.
// Each gun is built so its sight line runs along its local -Z axis at height
// `sight`; aiming down sights slides the gun until that line is the
// camera's centre line, so the irons / red dot sit exactly on the crosshair.

import * as THREE from 'three';
import { flashTex } from './textures.js';
import { gunMaterials } from './skins.js';

const std = (color, rough = 0.6, metal = 0.3) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
const MAT = {
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
  dot: new THREE.MeshBasicMaterial({ color: '#ff2a1a' }),
  sightDot: new THREE.MeshBasicMaterial({ color: '#f1e3a0' }),
  sleeve: std('#6b5a3e', 0.9, 0),
  nade: std('#4a5236', 0.7, 0.2),
};

// which parts of a gun a finish recolours
const ROLE = new Map([[MAT.steel, 'body'], [MAT.polymer, 'furn'], [MAT.tan, 'furn'], [MAT.wood, 'furn'], [MAT.dark, 'dark']]);

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

function buildSMG(sleeve) {
  const g = new THREE.Group();
  const S = 0.072;
  box(g, 0.055, 0.075, 0.33, MAT.steel, 0, 0, -0.06);
  box(g, 0.05, 0.03, 0.2, MAT.polymer, 0, -0.045, -0.13);         // handguard
  cyl(g, 0.012, 0.13, MAT.dark, 0, 0.012, -0.29);
  cyl(g, 0.018, 0.05, MAT.dark, 0, 0.012, -0.37);                 // muzzle device
  irons(g, S, -0.19, 0.075, 0.045, 0.045);
  box(g, 0.03, 0.1, 0.035, MAT.polymer, 0, -0.085, 0.045, -0.3);   // grip
  box(g, 0.012, 0.04, 0.06, MAT.dark, 0, -0.05, -0.005);           // trigger guard
  box(g, 0.025, 0.04, 0.2, MAT.polymer, 0, -0.005, 0.2);           // stock
  box(g, 0.03, 0.08, 0.03, MAT.polymer, 0, -0.03, 0.3);
  const charge = box(g, 0.02, 0.012, 0.03, MAT.dark, -0.035, 0.02, -0.12);
  const mag = new THREE.Group();
  box(mag, 0.028, 0.16, 0.045, MAT.dark, 0, -0.08, 0, 0.18);
  mag.position.set(0, -0.035, -0.09);
  g.add(mag);
  const h = hands(g, new THREE.Vector3(0.002, -0.085, 0.045), new THREE.Vector3(0, -0.06, -0.17), sleeve);
  return {
    group: g, sight: S, muzzle: new THREE.Vector3(0, 0.012, -0.4), mag, magHome: mag.position.clone(), charge,
    chargeHome: charge.position.clone(), hands: h,
    hip: new THREE.Vector3(0.15, -0.15, -0.4), ads: new THREE.Vector3(0, -S, -0.3), kind: 'mag',
  };
}

function buildLMG(sleeve) {
  const g = new THREE.Group();
  const S = 0.1;
  box(g, 0.075, 0.095, 0.42, MAT.steel, 0, 0, -0.05);
  box(g, 0.068, 0.02, 0.24, MAT.dark, 0, 0.058, -0.02);            // top rail
  const cover = new THREE.Group();                                  // feed cover, opens on reload
  box(cover, 0.07, 0.02, 0.14, MAT.steel, 0, 0.01, -0.07);
  cover.position.set(0, 0.048, 0.12);
  g.add(cover);
  cyl(g, 0.028, 0.3, MAT.polymer, 0, 0.005, -0.41, 14);             // shroud
  cyl(g, 0.013, 0.18, MAT.dark, 0, 0.005, -0.64);
  cyl(g, 0.02, 0.06, MAT.dark, 0, 0.005, -0.74);
  box(g, 0.012, 0.012, 0.28, MAT.dark, -0.02, -0.035, -0.46, 0.08);   // folded bipod
  box(g, 0.012, 0.012, 0.28, MAT.dark, 0.02, -0.035, -0.46, 0.08);
  box(g, 0.032, 0.11, 0.04, MAT.polymer, 0, -0.1, 0.07, -0.3);      // grip
  box(g, 0.035, 0.065, 0.25, MAT.polymer, 0, -0.01, 0.27);          // stock
  // red dot: mount, a square window frame round the sight line, tinted glass, the dot
  box(g, 0.03, 0.016, 0.07, MAT.dark, 0, 0.074, -0.02);
  const fz = -0.03;
  box(g, 0.05, 0.006, 0.02, MAT.dark, 0, S + 0.022, fz);
  box(g, 0.006, 0.05, 0.02, MAT.dark, -0.022, S, fz);
  box(g, 0.006, 0.05, 0.02, MAT.dark, 0.022, S, fz);
  box(g, 0.05, 0.012, 0.02, MAT.dark, 0, S - 0.024, fz);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.04), MAT.glass);
  glass.position.set(0, S, fz);
  g.add(glass);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0011, 12), MAT.dot);
  dot.position.set(0, S, fz + 0.001);
  g.add(dot);
  const mag = new THREE.Group();
  box(mag, 0.1, 0.12, 0.13, MAT.tan, 0, -0.06, 0);
  box(mag, 0.1, 0.02, 0.02, MAT.dark, 0, -0.11, 0.05);
  mag.position.set(0.0, -0.045, -0.08);
  g.add(mag);
  const h = hands(g, new THREE.Vector3(0.002, -0.1, 0.07), new THREE.Vector3(0, -0.04, -0.33), sleeve);
  return {
    group: g, sight: S, muzzle: new THREE.Vector3(0, 0.005, -0.78), mag, magHome: mag.position.clone(), cover,
    hands: h, hip: new THREE.Vector3(0.16, -0.17, -0.42), ads: new THREE.Vector3(0, -S, -0.2), kind: 'box',
  };
}

function buildShotgun(sleeve) {
  const g = new THREE.Group();
  const S = 0.045;
  box(g, 0.055, 0.07, 0.24, MAT.steel, 0, 0, 0.0);
  cyl(g, 0.014, 0.56, MAT.dark, 0, 0.02, -0.39);
  cyl(g, 0.012, 0.44, MAT.steel, 0, -0.014, -0.33);
  const pump = new THREE.Group();
  box(pump, 0.045, 0.045, 0.17, MAT.wood, 0, 0, 0);
  for (let i = 0; i < 5; i++) box(pump, 0.047, 0.004, 0.006, MAT.dark, 0, 0.018, -0.06 + i * 0.03);
  pump.position.set(0, -0.014, -0.29);
  g.add(pump);
  // bead front, shallow notch at the rear of the receiver
  box(g, 0.006, S - 0.034, 0.008, MAT.steel, 0, 0.034 + (S - 0.034) / 2, -0.66);
  sphere(g, 0.004, MAT.brass, 0, S - 0.001, -0.66);
  const earH = S + 0.003 - 0.035;
  box(g, 0.005, earH, 0.006, MAT.steel, -0.0075, 0.035 + earH / 2, 0.09);
  box(g, 0.005, earH, 0.006, MAT.steel, 0.0075, 0.035 + earH / 2, 0.09);
  box(g, 0.03, 0.09, 0.04, MAT.wood, 0, -0.07, 0.12, -0.35);         // grip
  box(g, 0.04, 0.07, 0.28, MAT.wood, 0, -0.03, 0.3, -0.08);          // stock
  const shell = new THREE.Group();
  cyl(shell, 0.011, 0.055, MAT.red, 0, 0, 0, 10);
  cyl(shell, 0.0115, 0.014, MAT.brass, 0, 0, 0.03, 10);
  shell.visible = false;
  g.add(shell);
  const h = hands(g, new THREE.Vector3(0.002, -0.07, 0.12), new THREE.Vector3(0, -0.04, -0.29), sleeve);
  return {
    group: g, sight: S, muzzle: new THREE.Vector3(0, 0.02, -0.68), pump, pumpHome: pump.position.clone(), shell,
    hands: h, hip: new THREE.Vector3(0.15, -0.15, -0.4), ads: new THREE.Vector3(0, -S, -0.3), kind: 'shell',
  };
}

function buildSniper(sleeve) {
  const g = new THREE.Group();
  const S = 0.078;
  box(g, 0.055, 0.07, 0.3, MAT.steel, 0, 0, -0.02);
  cyl(g, 0.014, 0.62, MAT.dark, 0, 0.012, -0.47);
  cyl(g, 0.02, 0.08, MAT.dark, 0, 0.012, -0.8);
  box(g, 0.06, 0.06, 0.4, MAT.tan, 0, -0.035, -0.2);                // fore-end
  // scope
  cyl(g, 0.02, 0.3, MAT.dark, 0, S, -0.04, 16);
  cyl(g, 0.03, 0.08, MAT.dark, 0, S, -0.22, 16, 0.024);
  cyl(g, 0.027, 0.06, MAT.dark, 0, S, 0.12, 16, 0.022);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.026, 20), MAT.lens);
  lens.position.set(0, S, -0.262);
  lens.rotation.y = Math.PI;
  g.add(lens);
  box(g, 0.015, 0.03, 0.02, MAT.dark, 0, 0.05, -0.1);
  box(g, 0.015, 0.03, 0.02, MAT.dark, 0, 0.05, 0.05);
  box(g, 0.025, 0.02, 0.025, MAT.dark, 0, S + 0.025, -0.05);         // turret
  const bolt = new THREE.Group();
  cyl(bolt, 0.008, 0.05, MAT.steel, 0.02, 0, 0, 8).rotation.set(0, 0, Math.PI / 2);
  sphere(bolt, 0.012, MAT.steel, 0.048, 0, 0);
  bolt.position.set(0.02, 0.02, 0.09);
  g.add(bolt);
  box(g, 0.03, 0.1, 0.04, MAT.tan, 0, -0.08, 0.14, -0.35);           // grip
  box(g, 0.045, 0.09, 0.3, MAT.tan, 0, -0.04, 0.33);                 // stock
  box(g, 0.04, 0.04, 0.12, MAT.tan, 0, 0.03, 0.34);                  // cheek rest
  const mag = new THREE.Group();
  box(mag, 0.03, 0.08, 0.07, MAT.dark, 0, -0.04, 0);
  mag.position.set(0, -0.035, 0.01);
  g.add(mag);
  const h = hands(g, new THREE.Vector3(0.002, -0.08, 0.14), new THREE.Vector3(0, -0.07, -0.25), sleeve);
  return {
    group: g, sight: S, muzzle: new THREE.Vector3(0, 0.012, -0.85), mag, magHome: mag.position.clone(), bolt,
    boltHome: bolt.position.clone(), hands: h, hip: new THREE.Vector3(0.15, -0.16, -0.42), ads: new THREE.Vector3(0, -S, -0.1),
    kind: 'bolt',
  };
}

function buildPistol(sleeve) {
  const g = new THREE.Group();
  const S = 0.058;
  const slide = new THREE.Group();
  box(slide, 0.03, 0.034, 0.19, MAT.steel, 0, 0, 0);
  for (let i = 0; i < 5; i++) box(slide, 0.032, 0.026, 0.004, MAT.dark, 0, 0, 0.07 + i * 0.006);
  // sights ride on the slide
  const fh = S - 0.047;
  box(slide, 0.004, fh + 0.004, 0.006, MAT.steel, 0, 0.017 + fh / 2, -0.085);
  const tip = new THREE.Mesh(new THREE.CircleGeometry(0.0014, 8), MAT.sightDot);
  tip.position.set(0, S - 0.03 - 0.0016, -0.081);
  slide.add(tip);
  const eh = S + 0.004 - 0.047;
  box(slide, 0.007, eh + 0.004, 0.008, MAT.steel, -0.0075, 0.017 + eh / 2, 0.08);
  box(slide, 0.007, eh + 0.004, 0.008, MAT.steel, 0.0075, 0.017 + eh / 2, 0.08);
  slide.position.set(0, 0.03, -0.06);
  g.add(slide);
  box(g, 0.028, 0.022, 0.16, MAT.polymer, 0, 0.004, -0.05);
  box(g, 0.029, 0.11, 0.045, MAT.polymer, 0, -0.055, 0.02, -0.22);
  box(g, 0.01, 0.03, 0.05, MAT.polymer, 0, -0.012, -0.02);
  const mag = new THREE.Group();
  box(mag, 0.022, 0.1, 0.034, MAT.dark, 0, -0.05, 0);
  mag.rotation.x = -0.22;
  mag.position.set(0, -0.005, 0.018);
  g.add(mag);
  const h = hands(g, new THREE.Vector3(0.002, -0.06, 0.03), new THREE.Vector3(-0.012, -0.07, 0.02), sleeve);
  h.left.rotation.set(0, 0.3, 0);
  return {
    group: g, sight: S, muzzle: new THREE.Vector3(0, 0.03, -0.17), mag, magHome: mag.position.clone(), slide,
    slideHome: slide.position.clone(), hands: h, hip: new THREE.Vector3(0.13, -0.14, -0.38), ads: new THREE.Vector3(0, -S, -0.34),
    kind: 'pistol',
  };
}

function buildNadeHand(sleeve) {
  const g = new THREE.Group();
  box(g, 0.05, 0.06, 0.07, MAT.glove, 0, 0, 0);
  box(g, 0.07, 0.07, 0.34, sleeve, 0.02, -0.04, 0.2, 0.25, 0.1, 0);
  const n = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 10), MAT.nade);
  body.scale.set(1, 1.25, 1);
  n.add(body);
  box(n, 0.015, 0.02, 0.015, MAT.steel, 0, 0.04, 0);
  box(n, 0.01, 0.05, 0.012, MAT.steel, 0.012, 0.02, 0, 0, 0, 0.2);
  n.position.set(0, 0.04, -0.01);
  g.add(n);
  return g;
}

export const GUN_BUILDERS = { smg: buildSMG, lmg: buildLMG, shotgun: buildShotgun, sniper: buildSniper, pistol: buildPistol };

// a gun on its own, for the locker preview
export function buildPreviewGun(id, finishId) {
  const g = GUN_BUILDERS[id](MAT.sleeve);
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
      sniper: buildSniper(this.sleeve), pistol: buildPistol(this.sleeve),
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
    this.bobT = 0;
    this.sway = new THREE.Vector2();
    this.swayTarget = new THREE.Vector2();
    this.reload = null;       // {t, dur, kind, empty}
    this.shellAnim = -1;
    this.pumpAnim = -1;
    this.boltAnim = -1;
    this.slideAnim = -1;
    this.nadeAnim = -1;
    this.sprint = 0;
    this.ads = 0;
    this.visible = true;
    this.scoped = false;
  }

  setTeamColor(hex) {
    this.sleeve.color.set(hex);
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

  fire(kick) {
    this.kickV += kick * 14;
    this.flashT = 0.05;
    if (this.cur && this.cur.slide) this.slideAnim = 0;
  }

  throwNade() {
    this.nadeAnim = 0;
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
    const down = this.pending ? ease(this.lowering) : 1 - ease(this.switchT);

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
    g.group.position.copy(pos);
    g.group.rotation.set(rx, ry, rz, 'YXZ');

    // muzzle flash
    this.flashT -= dt;
    g.flash.visible = this.flashT > 0 && !this.scoped;
    if (g.flash.visible) {
      g.flash.material.rotation = Math.random() * Math.PI;
      const s = 0.05 + Math.random() * 0.04;
      g.flash.scale.set(s, s, 1);
    }
    this.flashLight.intensity = this.flashT > 0 ? 3 : 0;
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
    if (g.kind === 'mag' || g.kind === 'pistol' || g.kind === 'bolt') {
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
