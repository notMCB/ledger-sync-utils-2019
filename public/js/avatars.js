// Other players: blocky soldiers, smoothed between server snapshots, with
// hit volumes for our own shots.

import * as THREE from 'three';
import { nameTag, softDot, wood } from './textures.js';
import { outfitMaterials, gunMaterials, chromeMaterial, OUTFIT, FINISH, rainbowCanvas } from './skins.js';
import { makeChute } from './royale.js';
import { buildPreviewGun } from './viewmodel.js';

export const TEAM_COLORS = ['#d98b2b', '#3f8fd0'];
export const TEAM_NAMES = ['Sand', 'Sky'];
const FFA_COLORS = ['#d9534a', '#4fa36b', '#8f5bc9', '#d9a441', '#3aa6b0', '#c95a9a', '#7f8f3a', '#5a78d0'];

export function playerColor(id, team) {
  if (team === 0 || team === 1) return TEAM_COLORS[team];
  return FFA_COLORS[id % FFA_COLORS.length];
}

const DELAY = 0.1; // render other players this far in the past, so there is always a snapshot either side

const lam = (c) => new THREE.MeshLambertMaterial({ color: c });
const SHARED = {
  silver: chromeMaterial(),
  skin: lam('#b58461'),
  boots: lam('#3a2f24'),
  pants: lam('#6d6452'),
  gun: lam('#26272a'),
  gunTan: lam('#8e7550'),
  strap: lam('#3d3a30'),
  glove: lam('#6b5a44'),
  shirt: lam('#a89877'),
  lip: lam('#8a5a46'),
  eye: lam('#1a1512'),
};

function bx(parent, w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = false;
  parent.add(m);
  return m;
}

// -- loadout gear: what marks each class out, whatever outfit they wear --

let iconCache = null;
function icons() {
  if (iconCache) return iconCache;
  const mk = (draw) => {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 40;
    draw(c.getContext('2d'));
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({ map: t });
  };
  iconCache = {
    ammo: mk((g) => {
      g.fillStyle = '#3f4428'; g.fillRect(0, 0, 64, 40);
      for (let i = 0; i < 3; i++) {
        const x = 14 + i * 14;
        g.fillStyle = '#d9a441'; g.fillRect(x - 4, 14, 8, 18);
        g.beginPath(); g.moveTo(x - 4, 14); g.lineTo(x, 5); g.lineTo(x + 4, 14); g.fill();
        g.fillStyle = '#8a6a22'; g.fillRect(x - 4, 28, 8, 4);
      }
    }),
    med: mk((g) => {
      g.fillStyle = '#f3efe6'; g.fillRect(0, 0, 64, 40);
      g.fillStyle = '#c9261c'; g.fillRect(26, 6, 12, 28); g.fillRect(18, 14, 28, 12);
    }),
  };
  return iconCache;
}

// a shaggy ghillie hood: strips of burlap hanging from the crown to the shoulders
let ghillieGeo = null;
function ghillieGeometry() {
  if (ghillieGeo) return ghillieGeo;
  const parts = [];
  const cols = ['#4f5a2e', '#6b6a3a', '#3e4a24', '#7a6a44', '#5c6b34', '#8a7a4a'].map((c) => new THREE.Color(c));
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) {
    const a = rnd() * Math.PI * 2;                 // round the head
    const front = Math.cos(a) < -0.55;               // leave the face open
    if (front && rnd() < 0.9) continue;
    const up = rnd();                                // crown .. sides
    const len = 0.18 + rnd() * 0.34;
    const g = new THREE.BoxGeometry(0.045, len, 0.018);
    g.translate(0, -len / 2, 0);
    const r = 0.15 + up * 0.03;
    const m = new THREE.Matrix4().makeRotationY(-a + Math.PI / 2);
    m.multiply(new THREE.Matrix4().makeRotationX(-0.25 - rnd() * 0.35));
    m.setPosition(Math.sin(a) * r, 0.12 - up * 0.1, Math.cos(a) * r * -1 * -1);
    g.applyMatrix4(m);
    const col = cols[Math.floor(rnd() * cols.length)];
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) { c[k * 3] = col.r; c[k * 3 + 1] = col.g; c[k * 3 + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    parts.push(g.index ? g.toNonIndexed() : g);
  }
  // a cap of the same stuff over the crown
  const cap = new THREE.SphereGeometry(0.17, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  cap.translate(0, 0.1, 0.02);
  const cc = new Float32Array(cap.attributes.position.count * 3).fill(0.32);
  for (let k = 0; k < cc.length; k += 3) { cc[k] = 0.31; cc[k + 1] = 0.35; cc[k + 2] = 0.18; }
  cap.setAttribute('color', new THREE.BufferAttribute(cc, 3));
  parts.push(cap.toNonIndexed());
  let total = 0;
  for (const p of parts) total += p.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const p of parts) {
    if (!p.attributes.normal) p.computeVertexNormals();
    pos.set(p.attributes.position.array, o * 3);
    nor.set(p.attributes.normal.array, o * 3);
    col.set(p.attributes.color.array, o * 3);
    o += p.attributes.position.count;
  }
  ghillieGeo = new THREE.BufferGeometry();
  ghillieGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  ghillieGeo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  ghillieGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return ghillieGeo;
}

// -- the guns in their hands -----------------------------------------------------------
// Every avatar carries the real gun: the same model the first-person view uses,
// with the player's finish on it, baked down to one mesh per material so a
// crowd of them costs next to nothing. Baked once per gun and finish and shared.
const GUN_CACHE = new Map();
const LAMBERT_TWIN = new Map();
const Y_UP = new THREE.Vector3(0, 1, 0);

// the first-person guns are lit for their own little scene; out in the town
// the same colours go on a plain material that takes the sun like everything else
function worldMaterial(m) {
  if (!m || Array.isArray(m) || !m.isMeshStandardMaterial) return m;
  let t = LAMBERT_TWIN.get(m);
  if (!t) {
    t = new THREE.MeshLambertMaterial({ color: m.color, map: m.map || null, emissive: m.emissive, emissiveIntensity: m.emissiveIntensity,
      transparent: m.transparent, opacity: m.opacity, side: m.side });
    LAMBERT_TWIN.set(m, t);
  }
  return t;
}

function mergeGeometries(geos) {
  let n = 0, hasUv = true;
  for (const g of geos) { n += g.attributes.position.count; if (!g.attributes.uv) hasUv = false; }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = hasUv ? new Float32Array(n * 2) : null;
  let o = 0;
  for (const g of geos) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    if (uv) uv.set(g.attributes.uv.array, o * 2);
    o += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (uv) out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

function bakedGun(gunId, finish, quiet, muzzleStyle) {
  const key = `${gunId}|${finish || ''}|${quiet ? 1 : 0}|${muzzleStyle || ''}`;
  let hit = GUN_CACHE.get(key);
  if (hit) return hit;
  const fitted = quiet ? { muzzle: 'suppressor', muzzleStyle } : null;
  const built = buildPreviewGun(gunId, finish, fitted);
  const root = built.group;
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.updateMatrixWorld(true);
  const byMat = new Map();
  root.traverseVisible((o) => {
    if (!o.isMesh || Array.isArray(o.material)) return;
    const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    geo.applyMatrix4(o.matrixWorld);
    if (!geo.attributes.normal) geo.computeVertexNormals();
    let list = byMat.get(o.material);
    if (!list) byMat.set(o.material, (list = []));
    list.push(geo);
  });
  const g = new THREE.Group();
  for (const [mat, geos] of byMat) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), worldMaterial(mat));
    mesh.castShadow = false;
    mesh.userData.shared = true;
    mesh.userData.gun = true;
    g.add(mesh);
    for (const x of geos) x.dispose();
  }
  root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  const h = built.hands;
  hit = {
    template: g,
    muzzle: built.muzzle.clone(),
    grip: h ? h.right.position.clone() : new THREE.Vector3(0, -0.08, 0.05),
    fore: h && built.kind !== 'knife' ? h.leftHome.clone() : null,
    kind: built.kind || 'mag',
  };
  GUN_CACHE.set(key, hit);
  return hit;
}

// two-bone arm: where the elbow goes for a shoulder S reaching for T, with the
// elbow pushed toward `pole`. Writes the elbow to E and the (reachable) hand to H.
const ARM_UPPER = 0.3, ARM_FORE = 0.3;
const IK_D = new THREE.Vector3(), IK_P = new THREE.Vector3();
function solveArm(S, T, pole, E, H) {
  IK_D.subVectors(T, S);
  let d = IK_D.length();
  if (d < 1e-4) { IK_D.set(0, -1, 0); d = 1e-4; } else IK_D.divideScalar(d);
  d = Math.min(ARM_UPPER + ARM_FORE - 0.004, Math.max(Math.abs(ARM_UPPER - ARM_FORE) + 0.01, d));
  H.copy(S).addScaledVector(IK_D, d);
  const cosA = (ARM_UPPER * ARM_UPPER + d * d - ARM_FORE * ARM_FORE) / (2 * ARM_UPPER * d);
  const a = Math.acos(Math.max(-1, Math.min(1, cosA)));
  IK_P.subVectors(pole, S);
  IK_P.addScaledVector(IK_D, -IK_P.dot(IK_D));
  if (IK_P.lengthSq() < 1e-6) IK_P.set(0, -1, 0).addScaledVector(IK_D, IK_D.y);
  IK_P.normalize();
  E.copy(S).addScaledVector(IK_D, ARM_UPPER * Math.cos(a)).addScaledVector(IK_P, ARM_UPPER * Math.sin(a));
}

// lay a limb (a capsule along y, built to its own length) from a to b
const SEG_D = new THREE.Vector3();
function poseSegment(mesh, a, b, thin = 1) {
  SEG_D.subVectors(b, a);
  const len = Math.max(0.01, SEG_D.length());
  mesh.position.copy(a).addScaledVector(SEG_D, 0.5);
  mesh.scale.set(thin, 1, thin);
  mesh.quaternion.setFromUnitVectors(Y_UP, SEG_D.divideScalar(len));
}

// a limb segment: a capsule whose overall length (rounded ends included) is `len`
function capsule(parent, r, len, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.01, len - 2 * r), 4, 10), mat);
  m.position.set(x, y, z);
  m.castShadow = false;
  parent.add(m);
  return m;
}

// the torso turned on a lathe: hips, a waist, the chest widening to the
// shoulders and closing to the neck. One smooth shape, oval in section.
function lathe(parent, profile, mat, seg = 18, phiStart = Math.PI / 2, phiLength = Math.PI * 2) {
  // phiStart of a quarter turn puts the front (-z) at u = 0.25 and the back at 0.75, so a print sits whole on each
  const m = new THREE.Mesh(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg, phiStart, phiLength), mat);
  m.scale.z = 0.64;
  m.castShadow = false;
  parent.add(m);
  return m;
}

// the flash of sun off a scope lens, shared by every avatar
let GLINT = null;
// spawn protection: a faint blue shell around a player who can't be hurt yet
const SHIELD_GEO = new THREE.CapsuleGeometry(0.45, 0.95, 4, 14);
const SHIELD_MAT = new THREE.MeshBasicMaterial({ color: 0x7fc8ff, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });

// the clothes: sleeves that end at a cuff with the arm bare below, and the kit
// an outfit's look calls for. Anything not listed wears long sleeves and nothing else.
const GARB = {
  porter: { sleeves: 'short' }, scout: { sleeves: 'short', scarf: true }, nomad: { sleeves: 'short', scarf: true },
  fatigues: { rig: true, pads: true }, nightwatch: { rig: true }, urban: { rig: true, pads: true },
  tigercamo: { rig: true, pads: true }, desertops: { rig: true, pads: true }, woodlandops: { rig: true, pads: true },
  arcticops: { rig: true, pads: true }, urbanops: { rig: true, pads: true }, multiterrain: { rig: true, pads: true },
  ghillie: { rig: true, pads: true }, midnight: { rig: true, pads: true }, mirage: { pads: true },
  zelligeguard: { scarf: true }, crimson: { rig: true, scarf: true }, sultan: { scarf: true }, festival: { scarf: true },
  royale1: { scarf: true }, candystripe: { sleeves: 'short' }, surfer: { sleeves: 'short' }, popart: { sleeves: 'short' },
  month1: { sleeves: 'short' },
};
const TEE_YELLOW = new THREE.MeshLambertMaterial({ color: '#f2d43a' });
const POUCH = new THREE.MeshLambertMaterial({ color: '#4a4f3a' });
const teeWrapCache = new Map();
// a printed T-shirt laid round the chest: the print on the front and the back, white elsewhere
function teeWrap(printMat) {
  const img = printMat && printMat.map && printMat.map.image;
  if (!img) return null;
  let m = teeWrapCache.get(img);
  if (m) return m;
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 1024, 512);
  for (const u of [0.25, 0.75]) g.drawImage(img, u * 1024 - 88, 300, 176, 118);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const t = clothTextures('cloth', 7, 3);
  m = new THREE.MeshPhongMaterial({ map: tex, bumpMap: t.bump, bumpScale: 0.004, shininess: 4, specular: '#141414' });
  teeWrapCache.set(img, m);
  return m;
}

// -- cloth ---------------------------------------------------------------------------
// Clothes are drawn as fabric: a woven or twill or knitted surface (a colour map
// and a bump map, made once on a canvas) on garments cut a little loose, with
// folds rippled into the shape. Everything here is shared between avatars.
const CLOTH_CANVAS = new Map();
function clothCanvases(kind) {
  let hit = CLOTH_CANVAS.get(kind);
  if (hit) return hit;
  const S = 128;
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = S; return c; };
  const cm = mk(), cb = mk();
  const gm = cm.getContext('2d'), gb = cb.getContext('2d');
  const im = gm.createImageData(S, S), ib = gb.createImageData(S, S);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let v;
      if (kind === 'twill') v = 0.5 + 0.11 * Math.sin((x + y) * Math.PI / 3) + 0.04 * Math.sin(x * 1.7);          // diagonal ribs
      else if (kind === 'knit') v = 0.5 + 0.13 * Math.sin(x * Math.PI / 4 + Math.sin(y * Math.PI / 5) * 1.6);    // rows of stitches
      else if (kind === 'canvas') v = ((x >> 2) & 1) ^ ((y >> 2) & 1) ? 0.57 : 0.43;                              // a coarse weave
      else if (kind === 'leather') v = 0.5 + 0.06 * Math.sin(x * 0.9 + y * 1.3) * Math.sin(x * 0.4 - y * 0.7);     // grain
      else v = ((x >> 1) & 1) ^ ((y >> 1) & 1) ? 0.56 : 0.44;                                                       // plain weave
      v += (rnd() - 0.5) * 0.07;
      const i = (y * S + x) * 4;
      const b = Math.round(Math.max(0, Math.min(1, v)) * 255);
      ib.data[i] = ib.data[i + 1] = ib.data[i + 2] = b; ib.data[i + 3] = 255;
      const m = Math.round(225 + (v - 0.5) * 70);
      im.data[i] = im.data[i + 1] = im.data[i + 2] = m; im.data[i + 3] = 255;
    }
  }
  gm.putImageData(im, 0, 0);
  gb.putImageData(ib, 0, 0);
  hit = { map: cm, bump: cb };
  CLOTH_CANVAS.set(kind, hit);
  return hit;
}
const CLOTH_TEX = new Map();
function clothTextures(kind, rx, ry) {
  const key = `${kind}|${rx}|${ry}`;
  let hit = CLOTH_TEX.get(key);
  if (hit) return hit;
  const c = clothCanvases(kind);
  const mk = (canvas, srgb) => {
    const t = new THREE.CanvasTexture(canvas);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    return t;
  };
  hit = { map: mk(c.map, true), bump: mk(c.bump, false) };
  CLOTH_TEX.set(key, hit);
  return hit;
}
// a patterned cloth (camo, stripes): the pattern with the weave multiplied in
const COMPOSITE = new Map();
function patternedCanvas(tex, kind) {
  const img = tex.image;
  const key = `${tex.uuid}|${kind}`;
  let hit = COMPOSITE.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, 512, 512);
  g.globalCompositeOperation = 'multiply';
  const w = clothCanvases(kind).map;
  for (let y = 0; y < 512; y += 128) for (let x = 0; x < 512; x += 128) g.drawImage(w, x, y);
  g.globalCompositeOperation = 'source-over';
  COMPOSITE.set(key, c);
  return c;
}
const CLOTH_MAT = new Map();
// a garment's material from an outfit's plain one: the same colour or pattern, as fabric
function clothMaterial(base, kind, rx, ry) {
  if (!base) return null;
  const key = `${base.uuid}|${kind}|${rx}|${ry}`;
  let m = CLOTH_MAT.get(key);
  if (m) return m;
  const t = clothTextures(kind, rx, ry);
  let map = t.map;
  if (base.map) {
    map = new THREE.CanvasTexture(patternedCanvas(base.map, kind));
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(Math.max(1, Math.round(rx / 3)), Math.max(1, Math.round(ry / 3)));
  }
  m = new THREE.MeshPhongMaterial({ color: base.map ? '#ffffff' : base.color, map, bumpMap: t.bump, bumpScale: 0.004,
    shininess: 4, specular: '#141414', emissive: base.emissive || 0x000000, side: base.side });
  CLOTH_MAT.set(key, m);
  return m;
}
// a material of the avatar's own (the team-tinted wrap): fabric whose colour we keep changing
function ownCloth(kind, rx, ry) {
  const t = clothTextures(kind, rx, ry);
  return new THREE.MeshPhongMaterial({ color: '#888888', map: t.map, bumpMap: t.bump, bumpScale: 0.004, shininess: 4, specular: '#141414' });
}

// folds: push the surface in and out round the shape, so the light finds creases
function ripple(geo, amp, freq, yfreq, phase = 0) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-4) continue;
    const a = Math.atan2(x, z);
    const k = 1 + amp * Math.sin(a * freq + y * yfreq + phase) * (0.6 + 0.4 * Math.sin(a * 2.3 + y * 5 + 1.3));
    p.setXYZ(i, x * k, y, z * k);
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}
// the profile of a loose limb of a garment: rounded at both ends, the radii given
// top to bottom, built standing on y from -len/2 to len/2
function limbProfile(len, radii) {
  const n = radii.length;
  const r0 = radii[0], r1 = radii[n - 1];
  const pts = [[0, -len / 2]];
  for (let i = 1; i <= 3; i++) { const t = i / 3 * Math.PI / 2; pts.push([r1 * Math.sin(t), -len / 2 + r1 * (1 - Math.cos(t))]); }
  for (let i = n - 2; i >= 1; i--) pts.push([radii[i], -len / 2 + r1 + (len - r0 - r1) * (1 - i / (n - 1))]);
  for (let i = 2; i >= 0; i--) { const t = i / 3 * Math.PI / 2; pts.push([r0 * Math.sin(t), len / 2 - r0 * (1 - Math.cos(t))]); }
  return pts;
}
const GARMENT_GEO = new Map();
function garmentGeometry(key, make) {
  let g = GARMENT_GEO.get(key);
  if (!g) { g = make(); GARMENT_GEO.set(key, g); }
  return g;
}
function garment(parent, key, make, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(garmentGeometry(key, make), mat);
  m.position.set(x, y, z);
  m.castShadow = false;
  m.userData.shared = true;
  parent.add(m);
  return m;
}
const latheGeo = (profile, seg = 20, phiStart = Math.PI / 2, phiLength = Math.PI * 2) =>
  new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg, phiStart, phiLength);

const PRONE_LEN = 1.45;
const GRIP_AT = new THREE.Vector3(), TMP_V = new THREE.Vector3();
const SPRINT_GRIP = new THREE.Vector3(0.14, -0.4, -0.12);
const RELOAD_OFF = new THREE.Vector3(-0.04, -0.17, -0.05);
const DEFAULT_GRIP = new THREE.Vector3(0, -0.08, 0.05);
const Y_AXIS = new THREE.Vector3(0, 1, 0), X_AXIS = new THREE.Vector3(1, 0, 0);
const QA = new THREE.Quaternion(), QB = new THREE.Quaternion();
const wrapAngle = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

function glintMat() {
  if (!GLINT) {
    GLINT = new THREE.SpriteMaterial({ map: softDot('rgba(255,255,255,1)', 'rgba(150,220,255,0)'),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 });
  }
  return GLINT.clone();
}

export class Avatar {
  constructor(id, scene) {
    this.id = id;
    this.scene = scene;
    this.snaps = [];
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.flags = 0;
    this.alive = false;
    this.team = -1;
    this.name = '';
    this.loadout = 0;
    this.slot = 0;
    this.deathT = 0;
    this.walkT = 0;
    this.lastPos = new THREE.Vector3();
    this.speed = 0;
    this.stepT = 0;
    this.crouchK = 0;
    this.showName = 0;
    this.revealT = 0;

    const g = new THREE.Group();
    this.group = g;
    this.body = lam('#888');   // the team / player colour: armbands
    this.wrap = ownCloth('knit', 3, 2);   // team-tinted default for headgear and scarves
    this.parts = { pants: [], boots: [], shirt: [], sleeve: [], wrap: [] };
    const part = (role, m) => {
      this.parts[role].push(m);
      return m;
    };
    const cy = (parent, r0, r1, h, mat, x, y, z, seg = 10) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), mat);
      m.position.set(x, y, z);
      m.castShadow = false;
      parent.add(m);
      return m;
    };
    const sp = (parent, r, mat, x, y, z, seg = 10) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(6, seg - 2)), mat);
      m.position.set(x, y, z);
      m.castShadow = false;
      parent.add(m);
      return m;
    };
    // legs pivot at the hips: a thigh that tapers to the knee, a knee, a shin, a boot
    this.legs = [];
    for (const sx of [-0.11, 0.11]) {
      const leg = new THREE.Group();
      // the trouser leg: loose round the thigh, creased, gathered over the boot
      part('pants', garment(leg, 'thigh' + sx, () => ripple(latheGeo(limbProfile(0.6, [0.1, 0.1, 0.096, 0.09, 0.088])), 0.028, 6, 10, sx * 2), SHARED.pants, 0, -0.22, 0));
      const shin = new THREE.Group();
      part('pants', garment(shin, 'shin' + sx, () => ripple(latheGeo(limbProfile(0.5, [0.088, 0.086, 0.082, 0.078, 0.07])), 0.022, 5, 12, sx), SHARED.pants, 0, -0.18, 0));
      part('pants', cy(shin, 0.08, 0.086, 0.045, SHARED.pants, 0, -0.355, 0, 12));   // the cuff, bloused over the boot
      const pad = sp(shin, 0.058, SHARED.strap, 0, -0.03, -0.045, 10);              // a knee pad, for the outfits that wear them
      pad.scale.set(1, 1.25, 0.6);
      this.pads = this.pads || [];
      this.pads.push(pad);
      part('boots', bx(shin, 0.15, 0.1, 0.26, SHARED.boots, 0, -0.42, -0.04));
      part('boots', bx(shin, 0.14, 0.14, 0.14, SHARED.boots, 0, -0.38, 0.02));
      shin.position.y = -0.5;
      leg.add(shin);
      leg.userData.shin = shin;
      leg.position.set(sx, 0.95, 0);
      g.add(leg);
      this.legs.push(leg);
    }
    // upper body pivots at the waist so it can lean with aim pitch
    const upper = new THREE.Group();
    upper.position.y = 0.97;
    g.add(upper);
    this.upper = upper;
    // the torso is round in section: a pelvis the legs grow out of, a chest that
    // widens to the shoulders, and the vest in the team colour over the chest
    part('pants', lathe(upper, [[0.05, -0.12], [0.17, -0.1], [0.205, -0.02], [0.205, 0.08], [0.19, 0.18], [0.185, 0.22]], SHARED.pants));
    // the shirt: cut loose over the chest, hanging past the hips, creased down the sides
    this.chest = part('shirt', garment(upper, 'shirt', () => ripple(latheGeo([[0.19, 0.16], [0.206, 0.19], [0.206, 0.26], [0.208, 0.33], [0.232, 0.42], [0.25, 0.52], [0.245, 0.58], [0.215, 0.63], [0.135, 0.665], [0.07, 0.68], [0.0, 0.685]]), 0.028, 7, 9), this.body));
    this.chest.scale.z = 0.64;
    // a collar at the neck, and buttons down the front
    this.collar = part('shirt', new THREE.Mesh(new THREE.TorusGeometry(0.078, 0.02, 8, 20), this.body));
    this.collar.rotation.x = Math.PI / 2;
    this.collar.position.set(0, 0.665, 0.005);
    this.collar.castShadow = false;
    upper.add(this.collar);
    this.buttons = [[0.36, -0.134], [0.46, -0.149], [0.56, -0.152]].map(([y, z]) => sp(upper, 0.011, SHARED.boots, 0.0, y, z, 8));
    // a chest rig: shoulder straps front and back, a strap across, two pouches on the chest
    this.rig = new THREE.Group();
    upper.add(this.rig);
    for (const sx of [-0.085, 0.085]) {
      bx(this.rig, 0.03, 0.34, 0.012, SHARED.strap, sx, 0.45, -0.157);
      bx(this.rig, 0.03, 0.34, 0.012, SHARED.strap, sx, 0.45, 0.152);
      bx(this.rig, 0.075, 0.11, 0.05, POUCH, sx * 0.85, 0.4, -0.178);
      bx(this.rig, 0.08, 0.02, 0.055, SHARED.strap, sx * 0.85, 0.445, -0.18);
    }
    bx(this.rig, 0.3, 0.025, 0.012, SHARED.strap, 0, 0.53, -0.158);
    bx(this.rig, 0.3, 0.025, 0.012, SHARED.strap, 0, 0.53, 0.153);
    // a scarf round the neck with a tail down the chest
    this.scarf = new THREE.Group();
    upper.add(this.scarf);
    this.scarfMeshes = [];
    const scarfRing = new THREE.Mesh(new THREE.TorusGeometry(0.088, 0.034, 8, 20), this.wrap);
    scarfRing.rotation.x = Math.PI / 2;
    scarfRing.position.set(0, 0.655, 0.0);
    scarfRing.castShadow = false;
    this.scarf.add(scarfRing);
    this.scarfMeshes.push(scarfRing);
    const tail = bx(this.scarf, 0.09, 0.17, 0.02, this.wrap, 0.05, 0.56, -0.15);
    tail.rotation.z = 0.18;
    this.scarfMeshes.push(tail);
    // a jacket for the outfits that have one: an open shell over the chest, worn
    // over a T-shirt, with a stripe down each front edge
    this.jacket = new THREE.Group();
    upper.add(this.jacket);
    this.jacketBox = garment(this.jacket, 'jacket', () => ripple(latheGeo([[0.205, 0.17], [0.22, 0.3], [0.25, 0.42], [0.268, 0.52], [0.262, 0.58], [0.232, 0.63], [0.15, 0.665]], 18, Math.PI + 0.6, Math.PI * 2 - 1.2), 0.025, 6, 8), this.body);
    this.jacketBox.scale.z = 0.64;
    this.web = [];
    for (const sx of [-1, 1]) {
      this.web.push(bx(this.jacket, 0.012, 0.4, 0.012, lam('#1f6b3a'), sx * 0.118, 0.44, -0.142));
      this.web.push(bx(this.jacket, 0.012, 0.4, 0.012, lam('#b3201c'), sx * 0.13, 0.44, -0.138));
      this.web.push(bx(this.jacket, 0.012, 0.4, 0.012, lam('#1f6b3a'), sx * 0.142, 0.44, -0.133));
    }
    this.jacket.visible = false;
    bx(upper, 0.045, 0.44, 0.012, SHARED.strap, 0.08, 0.4, -0.153).rotation.z = 0.28;    // the sling, over one shoulder and across
    bx(upper, 0.045, 0.44, 0.012, SHARED.strap, 0.08, 0.4, 0.153).rotation.z = -0.28;
    // the shoulders: a ball at each top corner of the chest, which the arm grows out of
    for (const sx of [-1, 1]) part('sleeve', sp(upper, 0.086, this.body, sx * 0.205, 0.59, 0));
    cy(upper, 0.052, 0.06, 0.16, SHARED.skin, 0, 0.7, 0.01);                                   // the neck
    const head = new THREE.Group();
    head.position.y = 0.82;
    upper.add(head);
    this.head = head;
    // the head: an egg rather than a box, with a brow, a nose, ears and a mouth
    const skull = sp(head, 0.13, SHARED.skin, 0, 0.0, 0, 16);
    skull.scale.set(0.92, 1.05, 0.98);
    bx(head, 0.2, 0.03, 0.03, SHARED.skin, 0, 0.055, -0.108);                                  // the brow
    for (const sx of [-0.045, 0.045]) {
      bx(head, 0.035, 0.02, 0.012, lam('#f0ebe2'), sx, 0.03, -0.117);                          // eyes
      bx(head, 0.016, 0.018, 0.012, SHARED.eye, sx + (sx < 0 ? 0.004 : -0.004), 0.03, -0.122);
    }
    bx(head, 0.03, 0.045, 0.035, SHARED.skin, 0, -0.005, -0.125).rotation.x = 0.2;             // the nose
    bx(head, 0.06, 0.012, 0.01, SHARED.lip, 0, -0.06, -0.117);                                  // the mouth
    for (const sx of [-0.118, 0.118]) bx(head, 0.02, 0.05, 0.035, SHARED.skin, sx, 0.0, 0.0); // ears
    // headgear: one of these shows, depending on the outfit
    this.heads = {};
    const hg = (name) => {
      const h = new THREE.Group();
      head.add(h);
      this.heads[name] = h;
      return h;
    };
    const dome = (parent, r, y, mat, open = 0, seg = 16) => {
      // a cap over the crown; `open` leaves the face clear (the face is at -z)
      const geo = open ? new THREE.SphereGeometry(r, seg, 10, Math.PI * 1.5 + open / 2, Math.PI * 2 - open, 0, Math.PI * 0.62)
        : new THREE.SphereGeometry(r, seg, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      const m = new THREE.Mesh(geo, mat);
      m.position.y = y;
      m.castShadow = false;
      parent.add(m);
      return m;
    };
    const ring = (parent, r, tube, y, mat) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 24), mat);
      m.rotation.x = Math.PI / 2;
      m.position.y = y;
      m.castShadow = false;
      parent.add(m);
      return m;
    };
    // a shemagh wound round the head: a low dome, the wrap round it, a tail at the back
    const wrapG = hg('wrap');
    part('wrap', dome(wrapG, 0.14, 0.0, this.wrap)).scale.set(1, 0.85, 1.04);
    part('wrap', ring(wrapG, 0.133, 0.03, 0.005, this.wrap));
    part('wrap', ring(wrapG, 0.125, 0.022, 0.05, this.wrap)).rotation.z = 0.08;
    part('wrap', bx(wrapG, 0.13, 0.15, 0.03, this.wrap, 0, -0.06, 0.125));
    // a helmet: a low dome pulled down over the brow, a thin rim that comes down at the back, a band round it
    const helm = hg('helmet');
    const hdome = part('wrap', dome(helm, 0.168, -0.025, this.wrap));
    hdome.scale.set(1, 1.0, 1.08);
    const hrim = part('wrap', cy(helm, 0.172, 0.178, 0.022, this.wrap, 0, -0.025, 0.012, 18));
    hrim.scale.z = 1.1;
    hrim.rotation.x = 0.12;
    part('wrap', cy(helm, 0.171, 0.171, 0.03, this.wrap, 0, 0.035, 0.0, 18)).scale.set(1.01, 1, 1.09);   // the cover's band
    bx(helm, 0.016, 0.1, 0.016, SHARED.strap, -0.125, -0.1, -0.02).rotation.z = 0.12;     // chin strap
    bx(helm, 0.016, 0.1, 0.016, SHARED.strap, 0.125, -0.1, -0.02).rotation.z = -0.12;
    bx(helm, 0.2, 0.014, 0.014, SHARED.strap, 0, -0.14, -0.065);
    // a beret: a soft flat crown pulled over to one side, on a band
    const beret = hg('beret');
    const bcrown = part('wrap', sp(beret, 0.14, this.wrap, 0.03, 0.1, 0.0, 16));
    bcrown.scale.set(1.12, 0.42, 1.12);
    bcrown.rotation.z = -0.22;
    part('wrap', ring(beret, 0.126, 0.016, 0.05, this.wrap)).rotation.z = -0.06;
    // a party hat: a striped cone on the crown, a bobble on top, and a little lean
    const party = hg('party');
    const hatTex = new THREE.CanvasTexture(rainbowCanvas());
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.36, 14, 1, true), new THREE.MeshLambertMaterial({ map: hatTex }));
    hat.position.set(0.01, 0.29, 0.0);
    hat.rotation.z = -0.12;
    party.add(hat);
    const bobble = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), lam('#ffe13b'));
    bobble.position.set(0.032, 0.47, 0.0);
    party.add(bobble);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.128, 0.014, 6, 20), lam('#ffffff'));
    band.rotation.x = Math.PI / 2;
    band.position.set(0.01, 0.115, 0.0);
    band.rotation.z = -0.12;
    party.add(band);
    // a hood: a shell round the whole head, open at the face, down to a cowl on the shoulders
    const hood = hg('hood');
    const shell = part('wrap', dome(hood, 0.165, 0.0, this.wrap, 1.9));
    shell.scale.set(1, 1.08, 1.02);
    part('wrap', cy(hood, 0.14, 0.2, 0.12, this.wrap, 0, -0.12, 0.02, 16)).scale.z = 0.95;
    // Morty's head: big and round, brown hair over the top and the back, the two
    // wide eyes with their little pupils, a small nose, ears, and the wobbly mouth
    const morty = hg('morty');
    const mortySkin = lam('#f7d5b4');
    const sph = (parent, r, sx, sy, sz, mat, x, y, z, seg = 18) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.round(seg * 0.75)), mat);
      m.scale.set(sx, sy, sz);
      m.position.set(x, y, z);
      parent.add(m);
      return m;
    };
    sph(morty, 0.2, 1.08, 0.98, 1, mortySkin, 0, 0.05, 0, 22);                    // the head
    part('wrap', sph(morty, 0.2, 1.1, 0.82, 1.04, this.wrap, 0, 0.13, 0.03, 22));    // the hair, over the top and back
    sph(morty, 0.045, 0.6, 1, 0.8, mortySkin, -0.215, 0.03, 0.01);                   // ears
    sph(morty, 0.045, 0.6, 1, 0.8, mortySkin, 0.215, 0.03, 0.01);
    const eyeW = lam('#ffffff'), eyeB = lam('#111111');
    sph(morty, 0.07, 1, 1, 0.45, eyeW, -0.068, 0.07, -0.178);                        // the eyes, touching
    sph(morty, 0.07, 1, 1, 0.45, eyeW, 0.068, 0.07, -0.178);
    sph(morty, 0.014, 1, 1, 0.6, eyeB, -0.058, 0.074, -0.21, 8);                     // pupils, looking two ways
    sph(morty, 0.014, 1, 1, 0.6, eyeB, 0.082, 0.064, -0.21, 8);
    sph(morty, 0.022, 1, 0.8, 0.8, mortySkin, 0, -0.01, -0.2, 10);                  // the nose
    const lip = lam('#5a2a1a');
    for (const [x, y, rz] of [[-0.05, -0.075, 0.35], [-0.012, -0.08, -0.3], [0.03, -0.074, 0.3], [0.064, -0.078, -0.2]]) {
      const m = bx(morty, 0.042, 0.011, 0.01, lip, x, y, -0.184);                       // the wobbly mouth
      m.rotation.z = rz;
    }
    // a gold chain round the neck
    const chain = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.017, 6, 22), new THREE.MeshLambertMaterial({ color: '#e6bd45', emissive: '#3a2a08' }));
    chain.rotation.x = Math.PI / 2 - 0.45;
    chain.position.set(0, -0.2, -0.05);
    morty.add(chain);
    this.visor = bx(head, 0.21, 0.035, 0.015, new THREE.MeshBasicMaterial({ color: '#27e6ff' }), 0, 0.03, -0.132);
    this.visor.visible = false;
    // arms and gun: the arms pivot at the shoulders and reach for the gun's grip
    // and foregrip every frame, so they fit whichever gun is in hand
    const arms = new THREE.Group();
    arms.position.set(0, 0.52, 0);
    upper.add(arms);
    this.arms = arms;
    this.armThin = 1;
    this.armsOf = [];
    for (const sx of [1, -1]) {
      const A = {
        shoulder: new THREE.Vector3(sx * 0.215, 0.07, 0),
        pole: new THREE.Vector3(sx * 0.4, -0.7, -0.05),
        upper: capsule(arms, 0.05, ARM_UPPER + 0.06, SHARED.skin),
        fore: capsule(arms, 0.044, ARM_FORE + 0.05, SHARED.skin),
        sleeveU: part('sleeve', garment(arms, 'sleeveU' + sx, () => ripple(latheGeo(limbProfile(ARM_UPPER + 0.05, [0.074, 0.072, 0.07, 0.068, 0.066]), 14), 0.02, 5, 14, sx), this.body)),
        sleeveF: part('sleeve', garment(arms, 'sleeveF' + sx, () => ripple(latheGeo(limbProfile(ARM_FORE - 0.01, [0.066, 0.064, 0.06, 0.057, 0.054]), 14), 0.018, 5, 14, sx + 1), this.body)),
        cuff: part('sleeve', cy(arms, 0.058, 0.062, 0.03, this.body, 0, 0, 0, 10)),
        band: cy(arms, 0.071, 0.073, 0.05, this.body, 0, 0, 0, 10),        // armband in the team colour
        hand: sp(arms, 0.046, SHARED.glove, 0, 0, 0, 10),
        E: new THREE.Vector3(), H: new THREE.Vector3(), T: new THREE.Vector3(),
      };
      this.armsOf.push(A);
    }
    this.adsK = 0;
    this.sprintK = 0;
    this.reloadT = 0;
    this.jumpK = 0;
    this.lastY = 0;
    this.vy = 0;
    // the log body: a tall square trunk with a face on the front, over the
    // usual torso and head, for the outfit shaped that way
    const woodM = new THREE.MeshLambertMaterial({ map: wood(), color: '#8a5a36' });
    const grain = lam('#c9a06a');
    const white = lam('#f4f1e6'), black = lam('#141210');
    const gold = lam('#d8ac3f'), porcelain = lam('#f7f3ee'), pearl = new THREE.MeshLambertMaterial({ color: '#f4f1ea', emissive: '#3a3628' });
    const cylm = (parent, r0, r1, h, mat, x, y, z, seg = 18) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), mat);
      m.position.set(x, y, z);
      parent.add(m);
      return m;
    };
    // Tung Tung Tung Sahur: a rounded log, sawn top and bottom, the face on the front
    const logG = new THREE.Group();
    cylm(logG, 0.29, 0.29, 1.4, woodM, 0, 0.6, 0);
    cylm(logG, 0.3, 0.3, 0.05, grain, 0, 1.3, 0);
    cylm(logG, 0.3, 0.3, 0.05, grain, 0, -0.1, 0);
    for (const sx of [-0.12, 0.12]) {
      bx(logG, 0.15, 0.17, 0.02, white, sx, 0.98, -0.27);               // the eyes, wide
      bx(logG, 0.07, 0.09, 0.02, black, sx + 0.015, 0.965, -0.28);
      bx(logG, 0.16, 0.035, 0.02, black, sx, 1.1, -0.275).rotation.z = sx < 0 ? 0.25 : -0.25;   // the brows, down in the middle
    }
    bx(logG, 0.36, 0.05, 0.02, black, 0, 0.72, -0.27);                 // the mouth, a thin grim line
    bx(logG, 0.3, 0.02, 0.02, white, 0, 0.735, -0.28);                // teeth
    cylm(logG, 0.31, 0.31, 0.08, this.body, 0, 0.3, 0);                // a band in the team colour, so sides still read
    logG.visible = false;
    upper.add(logG);
    this.log = logG;
    // Ballerina Cappuccina: the teacup head with its coffee and latte art, the bodice, the tutu
    const cupG = new THREE.Group();
    cylm(cupG, 0.34, 0.26, 0.46, porcelain, 0, 1.02, 0, 22);           // the cup, wide at the top
    cylm(cupG, 0.31, 0.31, 0.03, lam('#c98a4a'), 0, 1.24, 0, 22);      // the coffee
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), lam('#f1e0c0'));
    leaf.scale.set(0.9, 0.12, 1.6);
    leaf.position.set(0, 1.26, 0);
    cupG.add(leaf);
    for (const dz of [-0.14, 0.14]) { const l2 = leaf.clone(); l2.scale.set(0.5, 0.1, 0.7); l2.position.set(0, 1.26, dz); l2.rotation.y = dz < 0 ? 0.5 : -0.5; cupG.add(l2); }
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.03, 8, 16, Math.PI), porcelain);
    handle.position.set(0.36, 1.02, 0);
    handle.rotation.z = -Math.PI / 2;
    cupG.add(handle);
    for (const sx of [-0.11, 0.11]) {
      bx(cupG, 0.17, 0.2, 0.02, white, sx, 1.02, -0.31);                // big eyes
      bx(cupG, 0.1, 0.12, 0.02, lam('#5a8aa8'), sx, 1.01, -0.32);       // grey-blue irises
      bx(cupG, 0.05, 0.06, 0.02, black, sx, 1.0, -0.33);
      bx(cupG, 0.19, 0.03, 0.02, black, sx, 1.135, -0.32);              // lashes
    }
    bx(cupG, 0.12, 0.04, 0.02, lam('#c9412f'), 0, 0.86, -0.31);         // red lips
    bx(cupG, 0.5, 0.4, 0.3, gold, 0, 0.42, 0);                           // the gold bodice, over the vest
    cylm(cupG, 0.62, 0.66, 0.05, gold, 0, 0.13, 0, 24);                  // the tutu
    cylm(cupG, 0.72, 0.6, 0.04, lam('#e6b84a'), 0, 0.09, 0, 24);
    cylm(cupG, 0.28, 0.28, 0.06, this.body, 0, 0.19, 0);                 // the waistband in the team colour
    cupG.visible = false;
    upper.add(cupG);
    this.cup = cupG;
    // Tung Tung Tung God: a tall pearl-white capsule, the calm face, a halo and golden wings
    const godG = new THREE.Group();
    const cap = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.5, 6, 18), pearl);
    cap.position.set(0, 0.75, 0);
    godG.add(cap);
    for (const sx of [-0.12, 0.12]) {
      bx(godG, 0.13, 0.15, 0.02, white, sx, 1.2, -0.295);               // eyes
      bx(godG, 0.08, 0.1, 0.02, lam('#3f8fd0'), sx, 1.19, -0.305);      // blue
      bx(godG, 0.035, 0.05, 0.02, black, sx, 1.18, -0.315);
      bx(godG, 0.15, 0.025, 0.02, lam('#8a8070'), sx, 1.32, -0.3);      // gentle brows
    }
    const smile = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.014, 6, 14, Math.PI), black);
    smile.position.set(0, 0.98, -0.3);
    smile.rotation.z = Math.PI;
    godG.add(smile);
    bx(godG, 0.04, 0.08, 0.02, lam('#e8e2d6'), 0, 1.06, -0.31);          // the nose
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.025, 8, 24), gold);
    halo.position.set(0, 1.85, 0);
    halo.rotation.x = Math.PI / 2;
    godG.add(halo);
    for (const sx of [-1, 1]) {
      const wing = new THREE.Group();
      bx(wing, 0.9, 0.55, 0.04, lam('#f1e6c2'), sx * 0.5, 0.05, 0);
      bx(wing, 0.7, 0.3, 0.04, gold, sx * 0.62, -0.22, 0.005);
      bx(wing, 0.45, 0.2, 0.04, lam('#f1e6c2'), sx * 0.85, -0.4, 0.01);
      wing.position.set(sx * 0.2, 1.0, 0.24);
      wing.rotation.y = sx * 0.55;
      wing.rotation.z = sx * 0.25;
      godG.add(wing);
    }
    cylm(godG, 0.32, 0.32, 0.08, this.body, 0, 0.3, 0);                  // the team band
    godG.visible = false;
    upper.add(godG);
    this.god = godG;
    this.gunSkins = {};
    this.outfit = 'standard';
    this.gun = new THREE.Group();
    this.gun.position.set(0.08, 0.02, -0.3);
    arms.add(this.gun);
    this.gunModel = null;
    this.gunInfo = null;
    this.muzzleLocal = new THREE.Vector3(0, 0.02, -0.5);
    this.buildGear(upper, head);

    this.tagMat = new THREE.SpriteMaterial({ transparent: true, depthTest: true, depthWrite: false });
    // scope glare: sits where their eye is, and only shines when they face you
    this.glint = new THREE.Sprite(glintMat());
    this.glint.scale.set(0.5, 0.5, 1);
    this.glint.visible = false;
    g.add(this.glint);
    this.glintK = 0;
    // a laser on their gun: a beam out to whatever it lands on
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.laser = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.8, depthWrite: false }));
    this.laser.frustumCulled = false;
    this.laser.visible = false;
    scene.add(this.laser);
    this.laserDot = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: 0xff2020, transparent: true, depthWrite: false }));
    this.laserDot.scale.set(0.09, 0.09, 1);
    this.laserDot.visible = false;
    scene.add(this.laserDot);
    this.proneK = 0;       // lying flat
    this.backK = 0;        // rolled onto the back
    this.byaw = 0;         // which way the body lies (from the server)
    this.bodyYaw = 0;
    this.shield = new THREE.Mesh(SHIELD_GEO, SHIELD_MAT);
    this.shield.position.y = 0.95;
    this.shield.visible = false;
    g.add(this.shield);
    this.chute = null;        // a parachute, made the first time they open one
    this.tag = new THREE.Sprite(this.tagMat);
    this.tag.scale.set(1.2, 0.3, 1);
    this.tag.position.y = 2.2;
    this.tag.visible = false;
    g.add(this.tag);
    g.visible = false;
    scene.add(g);
    this.tagKey = '';
    this.setOutfit('standard');
    this.poseArms();
  }

  buildGear(upper, head) {
    const ic = icons();
    const pouch = (bag, icon) => {
      const g = new THREE.Group();
      const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.06, 14), SHARED.strap);   // belt round the waist
      belt.position.y = 0.17;
      belt.scale.z = 0.64;
      belt.castShadow = false;
      g.add(belt);
      bx(g, 0.3, 0.15, 0.12, lam(bag), 0, 0.15, -0.14);                   // the pouch
      bx(g, 0.28, 0.03, 0.125, SHARED.strap, 0, 0.235, -0.14);            // flap seam
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.1), icon);
      plate.position.set(0, 0.145, -0.2005);
      plate.rotation.y = Math.PI;
      g.add(plate);
      upper.add(g);
      return g;
    };
    const lad = new THREE.Group();
    const metal = lam('#6a6d70'), woodM = lam('#8a6a44');
    for (const x of [-0.13, 0.13]) bx(lad, 0.035, 1.15, 0.035, metal, x, 0, 0);
    for (let y = -0.45; y <= 0.46; y += 0.22) bx(lad, 0.26, 0.03, 0.03, woodM, 0, y, 0);
    bx(lad, 0.5, 0.04, 0.02, SHARED.strap, 0, 0.18, -0.02);
    lad.position.set(0.03, 0.42, 0.2);
    lad.rotation.set(0.08, 0, 0.12);
    upper.add(lad);
    const ghillie = new THREE.Mesh(ghillieGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    head.add(ghillie);
    this.gear = { ammo: pouch('#4c5230', ic.ammo), med: pouch('#d8d2c4', ic.med), ladder: lad, ghillie };
    this.setGear(0);
  }

  // each loadout's kit: 0 assault, 1 support, 2 breacher, 3 marksman
  setGear(ld) {
    this.gearLd = ld;
    const g = this.gear;
    g.ammo.visible = ld === 0;
    g.med.visible = ld === 1;
    g.ladder.visible = ld === 2;
    g.ghillie.visible = ld === 3;
    // the hood covers the headgear
    for (const k in this.heads) if (ld === 3) this.heads[k].visible = false;
    if (ld !== 3 && this.outfit) {
      const m = outfitMaterials(this.outfit);
      for (const k in this.heads) this.heads[k].visible = k === (m.head || 'wrap');
    }
  }

  // clothing from an outfit; anything the outfit leaves open uses team colours
  setOutfit(id) {
    this.outfit = id || 'standard';
    const m = outfitMaterials(this.outfit);
    const o = OUTFIT[this.outfit];
    // the animated outfits keep their changing materials; everything else is cut from cloth
    const cloth = !(o && o.anim);
    const shirtBase = m.shirt || SHARED.shirt;
    const C = cloth ? {
      shirt: clothMaterial(shirtBase, 'cloth', 7, 3), sleeve: clothMaterial(shirtBase, 'cloth', 3, 2),
      pants: clothMaterial(m.pants, 'twill', 3, 3), wrap: m.wrap ? clothMaterial(m.wrap, 'knit', 3, 2) : this.wrap,
      boots: clothMaterial(m.boots, 'leather', 2, 2),
    } : { shirt: shirtBase, sleeve: shirtBase, pants: m.pants, wrap: m.wrap || this.wrap, boots: m.boots };
    for (const x of this.parts.pants) x.material = C.pants;
    for (const x of this.parts.boots) x.material = C.boots;
    for (const x of this.parts.shirt) x.material = C.shirt;
    for (const x of this.parts.sleeve) x.material = C.sleeve;
    for (const x of this.parts.wrap) x.material = C.wrap;
    for (const k in this.heads) this.heads[k].visible = k === (m.head || 'wrap') && this.gearLd !== 3;
    this.visor.visible = !!m.glow;
    if (m.glow) this.visor.material = m.glow;
    const shape = (o && o.shape) || '';
    const garb = { sleeves: 'long', rig: false, pads: false, scarf: false, ...(GARB[this.outfit] || {}) };
    this.sleeves = garb.sleeves;
    // a printed T-shirt goes round the chest; a jacket is worn open over a yellow tee
    const printed = !!(o && o.tee && m.tee);
    const wrapMat = printed && teeWrap(m.tee[4]);
    const jacket = !!(o && o.jacket) && !printed;
    this.jacket.visible = jacket;
    this.jacketBox.material = cloth ? clothMaterial(shirtBase, 'cloth', 7, 3) : shirtBase;
    if (wrapMat) this.chest.material = wrapMat;
    else if (jacket) this.chest.material = clothMaterial(TEE_YELLOW, 'cloth', 7, 3);
    this.collar.visible = !jacket && !printed && !shape;
    for (const b of this.buttons) b.visible = !jacket && !printed && !shape && !garb.rig;
    this.rig.visible = garb.rig && !shape;
    for (const pd of this.pads) pd.visible = garb.pads;
    this.scarf.visible = garb.scarf && !shape;
    for (const x of this.scarfMeshes) x.material = C.wrap;
    if (this.armsOf) this.poseArms();
    this.logOn = !!shape;              // any of the shaped bodies: the head is inside it
    this.log.visible = shape === 'log';
    this.cup.visible = shape === 'cup';
    this.god.visible = shape === 'god';
    this.head.visible = !shape;
    // the brainrot bodies have thin arms and legs
    const thin = shape ? 0.6 : 1;
    for (const leg of this.legs) leg.scale.set(thin, 1, thin);
    this.armThin = thin;
  }

  setCosmetics(cs) {
    if (!cs) return;
    if (cs.o !== this.outfit) this.setOutfit(cs.o);
    this.gunSkins = cs.g || {};
    this.muzzleStyle = cs.ms || '';
    const w = this.gunId;
    this.gunId = null;
    if (w) this.setGun(w);
  }

  setIdentity(name, team) {
    this.team = team;
    this.name = name;
    const col = playerColor(this.id, team);
    this.body.color.set(col);
    this.wrap.color.set(new THREE.Color(col).multiplyScalar(0.7));
    const key = name + '|' + col;
    if (key !== this.tagKey) {
      this.tagKey = key;
      if (this.tagMat.map) this.tagMat.map.dispose();
      this.tagMat.map = nameTag(name, col);
      this.tagMat.needsUpdate = true;
    }
  }

  setGun(w) {
    if (this.gunId === w) return;
    this.gunId = w;
    const quiet = w === 'sniper' || (w === 'pistol' && (this.loadout === 2 || this.loadout === 3));
    const info = bakedGun(w, this.gunSkins[w] || '', quiet, this.muzzleStyle || '');
    if (this.gunModel) this.gun.remove(this.gunModel);
    this.gunModel = info.template.clone();
    this.gun.add(this.gunModel);
    this.gunInfo = info;
    this.muzzleLocal.copy(info.muzzle);
    this.poseArms();
    if (this._xray) {
      this.gunModel.traverse((o) => { if (o.isMesh) o.renderOrder = 999; });
    }
  }

  push(t, x, y, z, yaw, pitch, flags, byaw = yaw) {
    this.snaps.push({ t, x, y, z, yaw, pitch, flags, byaw });
    if (this.snaps.length > 30) this.snaps.shift();
  }

  sample(rt) {
    const s = this.snaps;
    if (!s.length) return;
    let a = s[0], b = s[0];
    for (let i = s.length - 1; i >= 0; i--) {
      if (s[i].t <= rt) {
        a = s[i];
        b = s[i + 1] || s[i];
        break;
      }
    }
    const span = b.t - a.t;
    const k = span > 1e-4 ? Math.min(1, Math.max(0, (rt - a.t) / span)) : 1;
    // a big jump means a respawn — snap instead of sliding across the map
    if (Math.hypot(b.x - a.x, b.z - a.z) > 6) {
      this.pos.set(b.x, b.y, b.z);
    } else {
      this.pos.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
    }
    let dy = b.yaw - a.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw = a.yaw + dy * k;
    this.byaw = a.byaw + wrapAngle(b.byaw - a.byaw) * k;
    this.pitch = a.pitch + (b.pitch - a.pitch) * k;
    this.flags = k < 0.5 ? a.flags : b.flags;
  }

  update(dt, rt) {
    this.sample(rt);
    const alive = !!(this.flags & 1);
    if (alive && !this.alive) {
      this.deathT = 0;
      this.group.rotation.set(0, 0, 0);
      this.head.rotation.set(0, 0, 0);
    }
    if (!alive && this.alive) this.deathT = 0.0001;
    this.alive = alive;
    const crouch = !!(this.flags & 2);
    this.crouchK += ((crouch ? 1 : 0) - this.crouchK) * Math.min(1, dt * 12);
    const prone = !!(this.flags & 512), onBack = !!(this.flags & 1024);
    this.proneK += ((prone ? 1 : 0) - this.proneK) * Math.min(1, dt * 7);
    this.backK += ((onBack ? 1 : 0) - this.backK) * Math.min(1, dt * 8);
    this.bodyYaw = prone || this.proneK > 0.02 ? this.byaw : this.yaw;
    const g = this.group;
    g.position.copy(this.pos);
    // speed for walk cycle and footsteps
    const moved = Math.hypot(this.pos.x - this.lastPos.x, this.pos.z - this.lastPos.z);
    this.speed += ((dt > 0 ? moved / dt : 0) - this.speed) * Math.min(1, dt * 8);
    const vy = dt > 0 ? (this.pos.y - this.lastPos.y) / dt : 0;
    this.vy += (Math.max(-12, Math.min(12, vy)) - this.vy) * Math.min(1, dt * 10);
    this.lastPos.copy(this.pos);
    if (this.deathT > 0) {
      this.deathT += dt;
      const k = Math.min(1, this.deathT / 0.45);
      g.rotation.set(0, this.yaw, 0);
      g.rotateX(-k * k * Math.PI / 2 * 0.95);
      g.position.y = this.pos.y + 0.1 * k;
      g.visible = this.deathT < 5;
      this.tag.visible = false;
      // slack: knees give, the arms drop, the head lolls
      this.legs[0].rotation.x = 0.5 * k;
      this.legs[1].rotation.x = -0.25 * k;
      this.legs[0].userData.shin.rotation.x = 0.8 * k;
      this.legs[1].userData.shin.rotation.x = 0.3 * k;
      this.arms.rotation.x = -0.7 * k;
      this.head.rotation.x = 0.45 * k;
      this.head.rotation.z = 0.3 * k;
      this.poseArms();
      return;
    }
    // flying a drone: the body stands where it was, head down over the controller
    this.piloting = !!(this.flags & 2048);
    this.inHeli = !!(this.flags & 2097152);     // in a helicopter's door: sat down, like a driver
    if (this.flags & 256) this.showName = Math.max(this.showName, 0.4);   // talking: their name shows
    this.driving = !!(this.flags & 16384) || this.inHeli;
    this.burning = !!(this.flags & 32768);
    this.aboard = !!(this.flags & 262144);
    this.falling = !!(this.flags & 65536);
    const chute = !!(this.flags & 131072);
    g.visible = alive && !this.aboard;
    if (!alive || this.aboard) { if (this.chute) this.chute.visible = false; return; }
    if (this.falling) {
      // in the air: arms and legs out, body flat, a chute overhead when it is open
      g.rotation.set(0, this.yaw, 0);
      if (!chute) g.rotateX(-Math.PI / 2 * 0.8);
      g.position.set(this.pos.x, this.pos.y + (chute ? 0 : 0.6), this.pos.z);
      this.legs[0].rotation.set(0, 0, 0.45);
      this.legs[1].rotation.set(0, 0, -0.45);
      this.legs[0].userData.shin.rotation.x = this.legs[1].userData.shin.rotation.x = 0;
      this.legs[0].position.y = this.legs[1].position.y = 0.95;
      this.upper.position.y = 0.97;
      this.upper.rotation.x = 0;
      this.arms.rotation.x = chute ? -2.6 : -1.4;
      this.head.rotation.set(chute ? 0 : -0.6, 0, 0);
      if (chute && !this.chute) { this.chute = makeChute(); g.add(this.chute); }
      if (this.chute) this.chute.visible = chute;
      this.tag.position.set(0, chute ? 2.2 : 1.2, 0);
      this.showName = Math.max(0, this.showName - dt);
      this.revealT = Math.max(0, this.revealT - dt);
      return;
    }
    if (this.chute && this.chute.visible) this.chute.visible = false;
    this.legs[0].rotation.z = this.legs[1].rotation.z = 0;
    const pk = this.proneK, bk = this.backK;
    if (pk > 0.01) {
      // lay the body down along its own direction, head where the player is,
      // and roll it over when they look far enough behind them
      QA.setFromAxisAngle(Y_AXIS, this.bodyYaw);
      QB.setFromAxisAngle(X_AXIS, -Math.PI / 2 * pk);
      QA.multiply(QB);
      if (bk > 0.01) {
        QB.setFromAxisAngle(Y_AXIS, Math.PI * bk);
        QA.multiply(QB);
      }
      g.quaternion.copy(QA);
      const fx = -Math.sin(this.bodyYaw), fz = -Math.cos(this.bodyYaw);
      g.position.set(this.pos.x - fx * PRONE_LEN * pk, this.pos.y + 0.16 * pk, this.pos.z - fz * PRONE_LEN * pk);
    } else g.rotation.set(0, this.yaw, 0);
    if (this.driving) g.position.y = this.pos.y + (this.inHeli ? 0.2 : (this.seatY ?? 0.55));   // up on the seat: a forklift's, or lower in a golf cart
    // the name and the scope glint ride above the head whichever way the body lies
    this.tag.position.set(0, 2.2 * (1 - pk) + 1.5 * pk, 1.0 * pk * (1 - 2 * bk));
    // walk
    const sp = Math.min(this.speed, 8);
    if (sp > 0.4) this.walkT += dt * sp * 1.9 * (1 - pk * 0.6);
    const swing = Math.sin(this.walkT) * Math.min(1, sp / 4) * 0.7 * (1 - pk * 0.5);
    const c = this.driving ? 1 : this.crouchK * (1 - pk);   // sitting: knees up
    this.legs[0].rotation.x = swing - c * 1.3;
    this.legs[1].rotation.x = -swing - c * 0.2;
    this.legs[0].userData.shin.rotation.x = Math.max(0, -swing) * 0.8 + c * 1.6;
    this.legs[1].userData.shin.rotation.x = Math.max(0, swing) * 0.8 + c * 0.9;
    this.legs[0].position.y = this.legs[1].position.y = 0.95 - c * 0.38;
    this.upper.position.y = 0.97 - c * 0.42;
    this.upper.rotation.x = 0;
    // prone: arms out ahead with the gun, head up, and the head turned the way they look
    this.arms.rotation.x = this.piloting ? -0.9 : this.pitch * (1 - pk) - 1.35 * pk;
    this.head.rotation.x = this.piloting ? 0.7 : this.pitch * 0.6 * (1 - pk) - 0.8 * pk;
    this.head.rotation.y = pk ? wrapAngle(this.yaw - this.bodyYaw) * (1 - bk) * 0.6 : 0;
    this.head.rotation.z = 0;
    // what they are doing with the gun: aiming, running, reloading
    const ads = !!(this.flags & 8) && !this.driving, sprint = !!(this.flags & 32) && sp > 2 && !this.driving;
    this.adsK += ((ads ? 1 : 0) - this.adsK) * Math.min(1, dt * 9);
    this.sprintK += ((sprint ? 1 : 0) - this.sprintK) * Math.min(1, dt * 7);
    this.reloadT = this.flags & 16 ? this.reloadT + dt : 0;
    // in the air: knees up
    const air = !this.driving && pk < 0.1 && Math.abs(this.vy) > 1.0;
    this.jumpK += ((air ? 1 : 0) - this.jumpK) * Math.min(1, dt * 10);
    const jk = this.jumpK;
    this.legs[0].rotation.x += -0.5 * jk;
    this.legs[1].rotation.x += -0.2 * jk;
    this.legs[0].userData.shin.rotation.x += 0.8 * jk;
    this.legs[1].userData.shin.rotation.x += 0.45 * jk;
    // the torso: a lean into a run, a twist and a bob with the stride
    const stride = Math.min(1, sp / 4) * (1 - pk);
    this.upper.rotation.x = c * 0.15 + 0.22 * this.sprintK * (1 - pk);
    this.upper.rotation.y = Math.sin(this.walkT) * 0.07 * stride;
    this.upper.position.y += Math.abs(Math.sin(this.walkT)) * 0.025 * stride;
    this.head.rotation.x += Math.sin(this.walkT * 2) * 0.03 * stride;
    this.stride = stride;
    this.poseArms();
    this.showName = Math.max(0, this.showName - dt);
    this.revealT = Math.max(0, this.revealT - dt);
    this.pingT = Math.max(0, (this.pingT || 0) - dt);
  }

  // the arms reach for the gun: the right hand on the grip, the left on the
  // foregrip (or working the magazine), the gun held at the hip, up at the
  // shoulder to aim, or swung low and across when running
  poseArms() {
    const info = this.gunInfo;
    const G = this.gun;
    const ads = this.adsK, spr = this.sprintK;
    const grip = info ? info.grip : DEFAULT_GRIP;
    GRIP_AT.set(0.09 + (0.03 - 0.09) * ads, -0.3 + (0.06 + 0.3) * ads, -0.26 + (-0.3 + 0.26) * ads);
    GRIP_AT.lerp(SPRINT_GRIP, spr);
    if (this.stride) GRIP_AT.y += Math.sin(this.walkT * 2) * 0.012 * this.stride * (1 - ads);
    G.rotation.set(-0.35 * spr, 0.5 * spr, 0);
    TMP_V.copy(grip).applyQuaternion(G.quaternion);
    G.position.copy(GRIP_AT).sub(TMP_V);
    const R = this.armsOf[0], L = this.armsOf[1];
    R.T.copy(GRIP_AT);
    if (info && info.fore) L.T.copy(info.fore).applyQuaternion(G.quaternion).add(G.position);
    else L.T.set(-0.2, -0.32, -0.2);
    if (this.reloadT > 0 && info && info.kind !== 'knife') {
      const k = 0.5 - 0.5 * Math.cos(this.reloadT * 7);
      L.T.lerp(TMP_V.copy(GRIP_AT).add(RELOAD_OFF), k);
    }
    for (const A of this.armsOf) {
      solveArm(A.shoulder, A.T, A.pole, A.E, A.H);
      poseSegment(A.upper, A.shoulder, A.E, this.armThin);
      poseSegment(A.fore, A.E, A.H, this.armThin);
      // the sleeves ride on the arm; short ones stop above the elbow, long ones at the wrist
      A.sleeveU.position.copy(A.upper.position);
      A.sleeveU.quaternion.copy(A.upper.quaternion);
      A.sleeveU.scale.copy(A.upper.scale);
      const long = this.sleeves !== 'short';
      A.sleeveF.visible = long;
      if (long) {
        A.sleeveF.position.lerpVectors(A.E, A.H, 0.46);
        A.sleeveF.quaternion.copy(A.fore.quaternion);
        A.sleeveF.scale.copy(A.fore.scale);
        A.cuff.position.lerpVectors(A.E, A.H, 0.86);
        A.cuff.quaternion.copy(A.fore.quaternion);
        A.cuff.scale.set(0.9 * this.armThin, 1, 0.9 * this.armThin);
      } else {
        A.cuff.position.lerpVectors(A.shoulder, A.E, 0.8);
        A.cuff.quaternion.copy(A.upper.quaternion);
        A.cuff.scale.set(this.armThin, 1, this.armThin);
      }
      A.band.position.lerpVectors(A.shoulder, A.E, 0.42);
      A.band.quaternion.copy(A.upper.quaternion);
      A.band.scale.set(this.armThin, 1, this.armThin);
      A.hand.position.copy(A.H);
      A.hand.quaternion.copy(G.quaternion);
      A.hand.scale.set(0.85 * this.armThin, 0.7, 1.15);
    }
  }

  // A scoped player's lens catches the light. It is brightest when they are
  // looking straight at you, and fades off within a few degrees.
  // the beam of a laser sight, from their muzzle along where they look
  updateLaser(physics) {
    const kind = this.flags & 4096 ? 'red' : this.flags & 8192 ? 'green' : null;
    const on = !!kind && this.alive && !this.piloting && physics;
    this.laser.visible = on;
    this.laserDot.visible = on;
    if (!on) return;
    const col = kind === 'green' ? 0x30ff40 : 0xff2020;
    this.laser.material.color.setHex(col);
    this.laserDot.material.color.setHex(col);
    this.group.updateMatrixWorld();
    const origin = this.gun.localToWorld(this.muzzleLocal.clone());
    const cp = Math.cos(this.pitch);
    const dir = new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    const hit = physics.raycast(origin, dir, 100);
    const end = hit ? hit.point : origin.clone().addScaledVector(dir, 100);
    const p = this.laser.geometry.attributes.position;
    p.setXYZ(0, origin.x, origin.y, origin.z);
    p.setXYZ(1, end.x, end.y, end.z);
    p.needsUpdate = true;
    this.laserDot.position.copy(end).addScaledVector(hit ? hit.normal : dir.clone().negate(), 0.02);
  }

  updateGlint(dt, camera, friendly) {
    this.shield.visible = this.alive && !!(this.flags & 128);
    if (this.shield.visible) this.shield.scale.y = 1 - this.crouchK * 0.3;
    const scoped = this.alive && !!(this.flags & 64) && !friendly;
    let want = 0;
    if (scoped) {
      const dx = camera.position.x - this.pos.x, dz = camera.position.z - this.pos.z;
      const dist = Math.hypot(dx, dz) || 1e-6;
      // which way they are facing, in the same terms
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      const dot = (dx / dist) * fx + (dz / dist) * fz;
      // within about 25 degrees, from 8 m out; brightest looking straight at you
      want = dist > 8 ? Math.min(1, Math.max(0, (dot - 0.9) / 0.06) * 1.4) : 0;
    }
    this.glintK += (want - this.glintK) * Math.min(1, dt * 6);
    const on = this.glintK > 0.02;
    this.glint.visible = on;
    if (!on) return;
    const flicker = 0.8 + 0.2 * Math.sin(performance.now() / 70 + this.id);
    this.glint.material.opacity = Math.min(1, this.glintK * flicker * 1.2);
    // a small sharp lens flare at the eye, a touch bigger far away so it still reads
    const dist = camera.position.distanceTo(this.pos);
    const s = (0.2 + this.glintK * 0.25) * (1 + Math.min(1, dist / 80));
    this.glint.scale.set(s, s, 1);
    const pk = this.proneK;
    this.glint.position.set(0, (1.62 - this.crouchK * 0.44) * (1 - pk) + 1.5 * pk, 0.5 * pk * (1 - 2 * this.backK) - (this.logOn ? 0.26 : 0));
  }

  headCenter(out) {
    if (this.proneK > 0.5) return out.set(this.pos.x, this.pos.y + 0.3, this.pos.z);
    return out.set(this.pos.x, this.pos.y + 1.73 - this.crouchK * 0.44, this.pos.z);
  }

  bodyTop() {
    if (this.proneK > 0.5) return 0.55;
    return 1.5 - this.crouchK * 0.44;
  }

  muzzle(out) {
    this.group.updateMatrixWorld(true);
    return out.copy(this.muzzleLocal).applyMatrix4(this.gun.matrixWorld);
  }

  dispose() {
    this.scene.remove(this.laser);
    this.scene.remove(this.laserDot);
    if (this.glint.material.map) this.glint.material.dispose();
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry && !o.userData.shared) o.geometry.dispose();
    });
    if (this.tagMat.map) this.tagMat.map.dispose();
  }
}

function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : -1;
}

// vertical cylinder from y0 to y1
function rayCylinder(o, d, cx, cz, r, y0, y1) {
  const ox = o.x - cx, oz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;
  let best = -1;
  if (a > 1e-9) {
    const b = ox * d.x + oz * d.z;
    const c = ox * ox + oz * oz - r * r;
    const disc = b * b - a * c;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / a;
      if (t >= 0) {
        const y = o.y + d.y * t;
        if (y >= y0 && y <= y1) best = t;
      }
    }
  }
  // caps
  if (Math.abs(d.y) > 1e-9) {
    for (const yc of [y0, y1]) {
      const t = (yc - o.y) / d.y;
      if (t >= 0 && (best < 0 || t < best)) {
        const x = o.x + d.x * t - cx, z = o.z + d.z * t - cz;
        if (x * x + z * z <= r * r) best = t;
      }
    }
  }
  return best;
}

export class Avatars {
  constructor(scene) {
    this.scene = scene;
    this.map = new Map();
    this.roster = new Map();
    this._h = new THREE.Vector3();
  }

  clear() {
    for (const a of this.map.values()) a.dispose();
    this.map.clear();
  }

  // the owner's wall-hack: every figure drawn over the town, whatever is in the way
  xray(on) {
    for (const a of this.map.values()) {
      if (a._xray === on) continue;
      a._xray = on;
      a.group.traverse((o) => {
        if (!o.isMesh || o.userData.gun) return;
        o.renderOrder = on ? 999 : 0;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const mt of mats) { mt.depthTest = !on; mt.needsUpdate = true; }
      });
    }
  }

  get(id) {
    return this.map.get(id);
  }

  setRoster(list) {
    this.roster = new Map(list.map((p) => [p.id, p]));
    for (const [id, a] of this.map) {
      const r = this.roster.get(id);
      if (!r) {
        a.dispose();
        this.map.delete(id);
      } else {
        a.setIdentity(r.n, r.tm);
        a.setCosmetics(r.cs);
      }
    }
  }

  sync(list, myId, t) {
    for (const p of list) {
      const [id, x, y, z, yaw, pitch, flags, ld, slot, , byaw] = p;
      if (id === myId) continue;
      let a = this.map.get(id);
      if (!a) {
        a = new Avatar(id, this.scene);
        this.map.set(id, a);
        const r = this.roster.get(id);
        if (r) {
          a.setIdentity(r.n, r.tm);
          a.setCosmetics(r.cs);
        }
      }
      if (a.loadout !== ld || a.gearLd !== ld) {
        a.loadout = ld;
        a.setGear(ld);
        a.gunId = null;
      }
      a.slot = slot;
      const rr = this.roster.get(id);
      const primary = (rr && rr.pw) || ['smg', 'lmg', 'shotgun', 'sniper'][ld] || 'smg';
      const secondary = (rr && rr.sw) || 'pistol';
      a.setGun(slot === 2 ? 'knife' : slot === 1 ? secondary : primary);
      a.push(t, x, y, z, yaw, pitch, flags, typeof byaw === 'number' ? byaw : yaw);
    }
  }

  update(dt, t, camera, myTeam, teamMode, physics = null) {
    const rt = t - DELAY;
    for (const a of this.map.values()) {
      a.update(dt, rt);
      a.updateLaser(physics);
      const friendly = teamMode && a.team === myTeam;
      a.tag.visible = a.alive && (friendly || a.showName > 0);
      a.tagMat.depthTest = !friendly;
      a.tag.renderOrder = friendly ? 5 : 0;
      a.updateGlint(dt, camera, friendly);
      // keep the tag readable at range
      const d = camera.position.distanceTo(a.pos);
      const s = Math.max(1, d / 14);
      a.tag.scale.set(1.2 * s, 0.3 * s, 1);
      a.tag.position.y = 2.15 - a.crouchK * 0.44 + (s - 1) * 0.1;
    }
  }

  // nearest living player hit by the ray, skipping those `skip` rejects
  raycast(o, d, maxT, skip) {
    let best = null;
    const h = this._h;
    for (const a of this.map.values()) {
      if (!a.alive || (skip && skip(a))) continue;
      if (a.proneK > 0.5) {
        // lying down: a head at the front and a row of spheres along the body
        const fx = -Math.sin(a.bodyYaw), fz = -Math.cos(a.bodyYaw);
        h.set(a.pos.x, a.pos.y + 0.3, a.pos.z);
        let t = raySphere(o, d, h, 0.2);
        let part = 'h';
        for (const back of [0.4, 0.75, 1.1, 1.4]) {
          h.set(a.pos.x - fx * back, a.pos.y + 0.25, a.pos.z - fz * back);
          const tb = raySphere(o, d, h, 0.3);
          if (tb >= 0 && (t < 0 || tb < t - 0.05)) { t = tb; part = 'b'; }
        }
        if (t >= 0 && t < maxT && (!best || t < best.t)) best = { id: a.id, t, part, avatar: a };
        continue;
      }
      a.headCenter(h);
      let t = raySphere(o, d, h, 0.2);
      let part = 'h';
      const tb = rayCylinder(o, d, a.pos.x, a.pos.z, 0.3, a.pos.y, a.pos.y + a.bodyTop());
      if (tb >= 0 && (t < 0 || tb < t - 0.05)) {
        t = tb;
        part = 'b';
      }
      if (t >= 0 && t < maxT && (!best || t < best.t)) best = { id: a.id, t, part, avatar: a };
    }
    return best;
  }
}
