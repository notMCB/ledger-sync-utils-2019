// Souk Royale's own things to look at: the plane, parachutes, loot chests
// (eskies), what spills out of them, the gas wall and the winner's fireworks.

import * as THREE from 'three';
import { nameTag, softDot } from './textures.js';
import { RARITY } from './skins.js';
import { WEAPONS, NADE_INFO, PERKS } from './weapons.js';

const lam = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });
const bx = (parent, w, h, d, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
};

export const AMMO_NAMES = { light: 'Light rounds', medium: 'Medium rounds', shells: 'Shotgun shells', heavy: 'Heavy rounds', pistol: 'Pistol rounds' };
export const AMMO_COLORS = { light: '#ffd23f', medium: '#ff8f1f', shells: '#e63946', heavy: '#f4f4f0', pistol: '#3fd0c9' };
export const RARITY_NAMES = { default: 'Standard', common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };

export function rarityColor(r) {
  if (!r || r === 'default') return '#d9d4c7';
  return RARITY[r] ? RARITY[r].color : '#d9d4c7';
}

// what an item is called on the ground and in the prompts
export function itemName(it) {
  if (it.k === 'gun') return (WEAPONS[it.w] ? WEAPONS[it.w].name : it.w);
  if (it.k === 'ammo') return `${AMMO_NAMES[it.a] || it.a} ×${it.n}`;
  if (it.k === 'vest') return it.n > 1 ? `Vests ×${it.n}` : 'Vest';
  if (it.k === 'med') return 'Medkit';
  if (it.k === 'nade') return `${(NADE_INFO[it.nk] || NADE_INFO.frag).name} grenade${it.n > 1 ? ' ×' + it.n : ''}`;
  if (it.k === 'perk') return PERKS[it.pk] ? PERKS[it.pk].name : it.pk;
  return 'Something';
}

export function itemColor(it) {
  if (it.k === 'gun') return rarityColor(it.r);
  if (it.k === 'ammo') return AMMO_COLORS[it.a] || '#fff';
  if (it.k === 'vest') return '#7fc8ff';
  if (it.k === 'med') return '#ff8a7a';
  if (it.k === 'nade') return '#b8d07a';
  return '#f0c25a';
}

// -- the plane -------------------------------------------------------------------

// A four-engined transport with a high wing and a ramp open at the back.
// Its nose points down local -z. Inside is a cargo bay you sit in.
export function makePlane() {
  const g = new THREE.Group();
  const skin = lam('#6b7a6a');
  const dark = lam('#2f3634');
  const glass = lam('#1a2a33');
  const inner = new THREE.MeshLambertMaterial({ color: '#7a836c', emissive: '#2c3128', side: THREE.BackSide });
  const R = 2.2, L = 30;
  // the fuselage: a tube, a rounded nose, a tapered tail with the ramp opening
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(R, R, L * 0.62, 24, 1, true), skin);
  tube.rotation.x = Math.PI / 2;
  tube.position.z = -1;
  g.add(tube);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(R, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2), skin);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -1 - L * 0.31;
  nose.scale.z = 1.6;
  g.add(nose);
  const cockpit = bx(g, 2.4, 0.7, 1.4, glass, 0, 1.2, -1 - L * 0.31 + 0.6);
  cockpit.rotation.x = 0.2;
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(2.0, R, L * 0.3, 24, 1, true), skin);
  tail.rotation.x = Math.PI / 2;
  tail.position.set(0, 0.6, -1 + L * 0.31 + L * 0.15);
  g.add(tail);
  // the inside: dark walls, a deck, red seats along each side, lights
  const bay = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.05, R - 0.05, L * 0.62 + 0.2, 24, 1, true), inner);
  bay.rotation.x = Math.PI / 2;
  bay.position.z = -1;
  g.add(bay);
  const bayTail = new THREE.Mesh(new THREE.CylinderGeometry(1.95, R - 0.05, L * 0.3, 24, 1, true), inner);
  bayTail.rotation.x = Math.PI / 2;
  bayTail.position.set(0, 0.6, -1 + L * 0.31 + L * 0.15);
  g.add(bayTail);
  bx(g, 3.6, 0.1, L * 0.9, dark, 0, -1.55, 2.4);                          // the deck
  bx(g, 3.2, 0.02, L * 0.9, new THREE.MeshLambertMaterial({ color: '#555d55', emissive: '#1c201c' }), 0, -1.49, 2.4);
  const seat = lam('#8a2a22');
  for (const sx of [-1, 1]) {
    bx(g, 0.5, 0.08, 14, seat, sx * 1.5, -1.05, -2);                      // canvas seats
    bx(g, 0.08, 0.7, 14, seat, sx * 1.75, -0.6, -2);
    for (let z = -8; z < 6; z += 1.4) bx(g, 0.05, 0.05, 0.5, dark, sx * 1.6, -1.3, z, 0.6);
  }
  for (let z = -10; z < 12; z += 4) {
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.8), new THREE.MeshBasicMaterial({ color: '#ffe9b0' }));
    light.position.set(0, R - 0.25, z);
    g.add(light);
  }
  // a red jump light by the door
  const lampMat = new THREE.MeshBasicMaterial({ color: '#ff3b2f' });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), lampMat);
  lamp.position.set(1.3, 1.2, 9);
  g.add(lamp);
  g.userData.lamp = lampMat;
  // the ramp: hinged at the deck, swung down and open
  const ramp = bx(g, 3.4, 0.14, 6.5, dark, 0, -1.55, 12.5 + 2.6, 0.45);
  ramp.position.set(0, -1.55 - Math.sin(0.45) * 3.2, 12.5 + Math.cos(0.45) * 3.2);
  bx(g, 3.6, 0.15, 3.6, dark, 0, 2.2, 13.2, -0.5);                          // the upper door, swung up
  // the wing: high, straight, with four engines and their props
  const wing = bx(g, 40, 0.5, 5.2, skin, 0, R - 0.3, -2);
  wing.position.y = R - 0.3;
  const props = [];
  for (const x of [-12.5, -5.5, 5.5, 12.5]) {
    const nac = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 4.6, 12), dark);
    nac.rotation.x = Math.PI / 2;
    nac.position.set(x, R - 0.8, -3.4);
    g.add(nac);
    const prop = new THREE.Mesh(new THREE.CircleGeometry(2.0, 24), new THREE.MeshBasicMaterial({ color: '#222', transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
    prop.position.set(x, R - 0.8, -5.8);
    g.add(prop);
    props.push(prop);
    const blade = bx(g, 0.2, 4.0, 0.06, dark, x, R - 0.8, -5.85);
    props.push(blade);
  }
  // the tail: a tall fin with the tailplane on top
  bx(g, 0.3, 6.5, 5.0, skin, 0, R + 2.6, 12.5, 0, 0, 0).rotation.x = 0.35;
  bx(g, 14, 0.3, 3.4, skin, 0, R + 5.6, 13.6);
  g.userData.props = props;
  g.userData.seat = new THREE.Vector3(0, -1.45, 12.0);   // where you stand aboard: on the deck at the top of the ramp, looking out
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return g;
}

// -- a parachute: a round canopy on lines, over the shoulders --
export function makeChute() {
  const g = new THREE.Group();
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(2.4, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2.2), lam('#e6a23c', { side: THREE.DoubleSide }));
  canopy.position.y = 4.6;
  canopy.scale.y = 0.7;
  g.add(canopy);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const line = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 3.6, 4), lam('#efe4cf'));
    line.position.set(Math.cos(a) * 1.0, 3.0, Math.sin(a) * 1.0);
    line.rotation.z = -Math.cos(a) * 0.55;
    line.rotation.x = Math.sin(a) * 0.55;
    g.add(line);
  }
  return g;
}

// -- loot chests: eskies, with a glow underneath until they are opened --
const ESKY = {};
export function makeChest() {
  if (!ESKY.body) {
    ESKY.body = lam('#f1eee6');
    ESKY.lid = lam('#3f8fd0');
    ESKY.dark = lam('#26292c');
    ESKY.inside = lam('#0f1418');
    ESKY.glowTex = softDot('rgba(90,170,255,0.9)', 'rgba(90,170,255,0)');
  }
  const g = new THREE.Group();
  bx(g, 0.92, 0.5, 0.56, ESKY.body, 0, 0.25, 0);
  bx(g, 0.86, 0.02, 0.5, ESKY.inside, 0, 0.5, 0);
  for (const z of [-0.22, 0.22]) bx(g, 0.96, 0.06, 0.06, ESKY.dark, 0, 0.12, z);      // trim bands
  const lid = new THREE.Group();
  bx(lid, 0.96, 0.12, 0.6, ESKY.lid, 0, 0.06, 0.3);
  bx(lid, 0.42, 0.05, 0.08, ESKY.dark, 0, 0.15, 0.3);                                  // the handle
  bx(lid, 0.16, 0.06, 0.04, ESKY.dark, 0, 0.02, 0.6);                                  // the latch
  lid.position.set(0, 0.5, -0.3);
  g.add(lid);
  // the glow lies flat on the ground under it
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.2, 28), new THREE.MeshBasicMaterial({ map: ESKY.glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 }));
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.03;
  g.add(disc);
  g.userData.lid = lid;
  g.userData.disc = disc;
  return g;
}

export function openChest(g) {
  g.userData.lid.rotation.x = -1.95;
  g.userData.disc.visible = false;
}

// -- things on the ground --
const GUN_SIZES = {
  smg: [0.06, 0.1, 0.5], lmg: [0.09, 0.13, 0.85], shotgun: [0.06, 0.08, 0.85], sniper: [0.06, 0.09, 1.05], pistol: [0.04, 0.08, 0.2],
  heavy: [0.08, 0.11, 1.35], revolver: [0.04, 0.09, 0.33], flamer: [0.07, 0.1, 0.8], pdw: [0.06, 0.11, 0.45], carbine: [0.06, 0.1, 0.78],
};
const ITEM_MATS = {};
function itemMats() {
  if (ITEM_MATS.gun) return ITEM_MATS;
  ITEM_MATS.gun = lam('#26272a');
  ITEM_MATS.mag = lam('#3c3f44');
  ITEM_MATS.ammo = lam('#56603a');
  ITEM_MATS.vest = lam('#1d3557');
  ITEM_MATS.strap = lam('#3d3a30');
  ITEM_MATS.med = lam('#e9e4d8');
  ITEM_MATS.cross = new THREE.MeshBasicMaterial({ color: '#c9261c' });
  ITEM_MATS.nade = { frag: lam('#4a5236'), smoke: lam('#6f7a6a'), flash: lam('#c9ccd1'), molotov: lam('#3f6b3a') };
  ITEM_MATS.perk = lam('#8a6a3a');
  ITEM_MATS.ringTex = softDot('rgba(255,255,255,0.9)', 'rgba(255,255,255,0)');
  return ITEM_MATS;
}

export function makeItem(it) {
  const M = itemMats();
  const g = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.32;
  g.add(body);
  if (it.k === 'gun') {
    const s = GUN_SIZES[it.w] || GUN_SIZES.smg;
    bx(body, s[0], s[1], s[2], M.gun, 0, 0, 0);
    bx(body, s[0] * 0.8, s[1] * 1.6, s[0] * 1.4, M.mag, 0, -s[1] * 0.9, s[2] * 0.05);
    bx(body, s[0] * 0.8, s[1] * 0.9, s[2] * 0.25, M.mag, 0, -s[1] * 0.5, s[2] * 0.42, 0.3);
    body.rotation.z = 0.35;
  } else if (it.k === 'ammo') {
    bx(body, 0.3, 0.2, 0.2, M.ammo, 0, 0, 0);
    bx(body, 0.31, 0.06, 0.21, lam(AMMO_COLORS[it.a] || '#fff'), 0, 0.03, 0);
  } else if (it.k === 'vest') {
    bx(body, 0.42, 0.48, 0.16, M.vest, 0, 0, 0);
    bx(body, 0.12, 0.2, 0.17, M.strap, -0.13, 0.28, 0);
    bx(body, 0.12, 0.2, 0.17, M.strap, 0.13, 0.28, 0);
    bx(body, 0.44, 0.05, 0.17, M.strap, 0, -0.1, 0);
  } else if (it.k === 'med') {
    bx(body, 0.36, 0.26, 0.26, M.med, 0, 0, 0);
    bx(body, 0.2, 0.06, 0.27, M.cross, 0, 0, 0);
    bx(body, 0.06, 0.2, 0.27, M.cross, 0, 0, 0);
  } else if (it.k === 'nade') {
    if (it.nk === 'molotov') {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.24, 10), M.nade.molotov);
      body.add(b);
    } else {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), M.nade[it.nk] || M.nade.frag);
      b.scale.y = 1.25;
      body.add(b);
    }
  } else if (it.k === 'perk') {
    bx(body, 0.34, 0.28, 0.3, M.perk, 0, 0, 0);
    bx(body, 0.36, 0.06, 0.32, M.strap, 0, 0.06, 0);
  }
  const col = new THREE.Color(itemColor(it));
  const ring = new THREE.Mesh(new THREE.CircleGeometry(0.55, 24), new THREE.MeshBasicMaterial({ map: M.ringTex, color: col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: it.k === 'gun' ? 0.9 : 0.45 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  g.add(ring);
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false }));
  tag.scale.set(1.6, 0.4, 1);
  tag.position.y = 0.95;
  tag.visible = false;
  g.add(tag);
  g.userData = { body, tag, spin: Math.random() * Math.PI * 2, it, labelled: false };
  return g;
}

// a name over an item, made when it is first needed
export function labelItem(g) {
  const u = g.userData;
  if (u.labelled) return;
  u.labelled = true;
  const it = u.it;
  let text = itemName(it);
  if (it.k === 'gun') text += ' · ' + RARITY_NAMES[it.r || 'default'];
  u.tag.material.map = nameTag(text, itemColor(it));
  u.tag.material.needsUpdate = true;
  const w = Math.min(3.2, 0.3 + text.length * 0.085);
  u.tag.scale.set(w, w / 4, 1);
}

// -- the gas: a tall green wall of smoke round the safe circle, and the next circle on the ground --
export function makeGas() {
  const g = new THREE.Group();
  // a smoke texture that tiles: every blob is drawn wrapped round the edges
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const x = c.getContext('2d');
  x.fillStyle = '#000000';
  x.fillRect(0, 0, S, S);
  let seed = 11;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) {
    const px = r() * S, py = r() * S, rad = 18 + r() * 46, a = 0.25 + r() * 0.4;
    for (const ox of [-S, 0, S]) {
      for (const oy of [-S, 0, S]) {
        const grd = x.createRadialGradient(px + ox, py + oy, 0, px + ox, py + oy, rad);
        grd.addColorStop(0, `rgba(255,255,255,${a})`);
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = grd;
        x.fillRect(px + ox - rad, py + oy - rad, rad * 2, rad * 2);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  // the wall itself: smoke from the texture, thickest near the ground and gone by the top,
  // and never so solid that it hides what is behind it
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, t: { value: 0 }, radius: { value: 100 } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    vertexShader: `varying vec2 vUv; varying float vDist;
      void main() { vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vDist = distance(wp.xyz, cameraPosition);
        gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform sampler2D map; uniform float t; uniform float radius; varying vec2 vUv; varying float vDist;
      void main() {
        float around = vUv.x * radius * 0.45;          // the smoke repeats every fourteen metres round the wall
        float a1 = texture2D(map, vec2(around + t * 0.02, vUv.y * 18.0 - t * 0.05)).r;
        float a2 = texture2D(map, vec2(around * 0.53 - t * 0.015, vUv.y * 9.0 + t * 0.03)).r;
        float smoke = a1 * 0.7 + a2 * 0.6;
        float height = 1.0 - smoothstep(0.1, 0.7, vUv.y);       // thins out with height
        float base = 1.0 - smoothstep(0.0, 0.04, vUv.y);        // and is a wall of it at the ground
        float far = 0.6 + 0.4 / (1.0 + vDist / 350.0);
        float alpha = clamp((smoke * 0.7 + base * 0.4) * (height + 0.04) * far, 0.0, 0.9);
        vec3 col = mix(vec3(0.12, 0.36, 0.12), vec3(0.5, 0.86, 0.32), smoke * 0.6);
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
      }`,
  });
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 260, 128, 1, true), mat);
  wall.position.y = 128;
  wall.frustumCulled = false;
  g.add(wall);
  const wall2 = wall;      // one layer does the whole job
  const tex2 = tex;
  const next = new THREE.Mesh(new THREE.RingGeometry(0.99, 1.0, 128), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, fog: false }));
  next.rotation.x = -Math.PI / 2;
  next.position.y = 0.15;
  g.add(next);
  const nextWall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 40, 96, 1, true), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false, fog: false }));
  nextWall.position.y = 20;
  g.add(nextWall);
  g.userData = { wall, wall2, next, nextWall, tex, tex2, mat };
  g.visible = false;
  return g;
}

export function updateGas(g, gs, dt, t) {
  if (!gs) { g.visible = false; return; }
  g.visible = true;
  const u = g.userData;
  u.wall.position.set(gs.c[0], 128, gs.c[1]);
  const r = Math.max(0.5, gs.r);
  u.wall.scale.set(r, 1, r);
  u.mat.uniforms.t.value = t;
  u.mat.uniforms.radius.value = r;
  const showNext = gs.ph === 'wait' && gs.nr > 0;
  u.next.visible = showNext;
  u.nextWall.visible = showNext;
  if (showNext) {
    u.next.position.set(gs.nc[0], 0.15, gs.nc[1]);
    u.next.scale.set(gs.nr, gs.nr, 1);
    u.nextWall.position.set(gs.nc[0], 20, gs.nc[1]);
    u.nextWall.scale.set(gs.nr, 1, gs.nr);
  }
}

// -- fireworks over the winner --
export function fireworks(fx, centre, k) {
  const cols = [0xffd23f, 0xff4f79, 0x3fc1ff, 0x6bff5c, 0xff8f1f, 0xb061ff];
  const col = cols[k % cols.length];
  const p = centre.clone().add(new THREE.Vector3((Math.random() - 0.5) * 30, 18 + Math.random() * 16, (Math.random() - 0.5) * 30));
  fx.light(p, 60, col, 0.4);
  for (let i = 0; i < 46; i++) {
    const a = Math.random() * Math.PI * 2, b = Math.acos(2 * Math.random() - 1);
    const v = new THREE.Vector3(Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a)).multiplyScalar(9 + Math.random() * 5);
    fx.particle(fx.sparkTex, p, v, 0.35, 0.4, 1.4 + Math.random() * 0.6, 4, 1, true, 0.4);
  }
  for (let i = 0; i < 12; i++) {
    const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(4);
    fx.particle(fx.fireTex, p, v, 0.8, 1.5, 0.5, 1, 1, true);
  }
}
