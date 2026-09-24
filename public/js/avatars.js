// Other players: blocky soldiers, smoothed between server snapshots, with
// hit volumes for our own shots.

import * as THREE from 'three';
import { nameTag, softDot } from './textures.js';
import { outfitMaterials, gunMaterials } from './skins.js';

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
  silver: new THREE.MeshStandardMaterial({ color: '#c9ced4', roughness: 0.3, metalness: 0.85 }),
  skin: lam('#b58461'),
  boots: lam('#3a2f24'),
  pants: lam('#6d6452'),
  gun: lam('#26272a'),
  gunTan: lam('#8e7550'),
  strap: lam('#3d3a30'),
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

const GUN_SIZES = {
  smg: [0.06, 0.1, 0.5], lmg: [0.09, 0.13, 0.85], shotgun: [0.06, 0.08, 0.85], sniper: [0.06, 0.09, 1.05], pistol: [0.04, 0.08, 0.2],
  knife: [0.03, 0.04, 0.28], heavy: [0.08, 0.11, 1.35], revolver: [0.035, 0.08, 0.28], flamer: [0.07, 0.1, 0.8],
};

// the flash of sun off a scope lens, shared by every avatar
let GLINT = null;
// spawn protection: a faint blue shell around a player who can't be hurt yet
const SHIELD_GEO = new THREE.CapsuleGeometry(0.45, 0.95, 4, 14);
const SHIELD_MAT = new THREE.MeshBasicMaterial({ color: 0x7fc8ff, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });

const PRONE_LEN = 1.45;
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
    this.body = lam('#888');   // vest: always the team / player colour
    this.wrap = lam('#888');   // team-tinted default for headgear
    this.parts = { pants: [], boots: [], shirt: [], wrap: [] };
    const part = (role, m) => {
      this.parts[role].push(m);
      return m;
    };
    // legs pivot at the hips
    this.legs = [];
    for (const sx of [-0.11, 0.11]) {
      const leg = new THREE.Group();
      part('pants', bx(leg, 0.17, 0.5, 0.19, SHARED.pants, 0, -0.25, 0));
      const shin = new THREE.Group();
      part('pants', bx(shin, 0.16, 0.42, 0.18, SHARED.pants, 0, -0.21, 0));
      part('boots', bx(shin, 0.18, 0.1, 0.27, SHARED.boots, 0, -0.42, -0.04));
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
    part('pants', bx(upper, 0.44, 0.3, 0.25, SHARED.pants, 0, 0.08, 0));
    bx(upper, 0.48, 0.42, 0.28, this.body, 0, 0.4, 0);       // vest in team colour
    bx(upper, 0.1, 0.44, 0.3, SHARED.strap, 0.12, 0.4, 0.001);
    part('shirt', bx(upper, 0.5, 0.1, 0.26, this.body, 0, 0.64, 0)); // collar and shoulders
    const head = new THREE.Group();
    head.position.y = 0.76;
    upper.add(head);
    this.head = head;
    bx(head, 0.23, 0.25, 0.25, SHARED.skin, 0, 0, 0);
    bx(head, 0.2, 0.04, 0.02, SHARED.boots, 0, 0.03, -0.13); // eyes shadow
    // headgear: one of these shows, depending on the outfit
    this.heads = {};
    const hg = (name) => {
      const h = new THREE.Group();
      head.add(h);
      this.heads[name] = h;
      return h;
    };
    const wrapG = hg('wrap');
    part('wrap', bx(wrapG, 0.26, 0.12, 0.28, this.wrap, 0, 0.1, 0.01));
    part('wrap', bx(wrapG, 0.26, 0.1, 0.12, this.wrap, 0, -0.08, 0.08));
    const helm = hg('helmet');
    part('wrap', bx(helm, 0.3, 0.14, 0.31, this.wrap, 0, 0.13, 0.01));
    part('wrap', bx(helm, 0.32, 0.03, 0.34, this.wrap, 0, 0.07, 0.01));
    const beret = hg('beret');
    const b = part('wrap', bx(beret, 0.27, 0.06, 0.27, this.wrap, 0.02, 0.15, 0.01));
    b.rotation.z = -0.18;
    const hood = hg('hood');
    part('wrap', bx(hood, 0.29, 0.3, 0.2, this.wrap, 0, 0.02, 0.06));
    part('wrap', bx(hood, 0.29, 0.07, 0.3, this.wrap, 0, 0.15, 0.0));
    part('wrap', bx(hood, 0.3, 0.1, 0.12, this.wrap, 0, -0.1, 0.07));
    this.visor = bx(head, 0.21, 0.035, 0.015, new THREE.MeshBasicMaterial({ color: '#27e6ff' }), 0, 0.03, -0.132);
    this.visor.visible = false;
    // arms and gun
    const arms = new THREE.Group();
    arms.position.set(0, 0.52, 0);
    upper.add(arms);
    this.arms = arms;
    part('shirt', bx(arms, 0.12, 0.12, 0.4, this.body, 0.2, -0.02, -0.14));
    part('shirt', bx(arms, 0.12, 0.12, 0.4, this.body, -0.16, -0.04, -0.22));
    bx(arms, 0.1, 0.1, 0.1, SHARED.boots, 0.14, -0.04, -0.34);
    bx(arms, 0.1, 0.1, 0.1, SHARED.boots, -0.04, -0.03, -0.5);
    this.gunSkins = {};
    this.outfit = 'standard';
    this.gun = new THREE.Group();
    this.gun.position.set(0.08, 0.02, -0.3);
    arms.add(this.gun);
    this.gunMesh = bx(this.gun, 0.06, 0.1, 0.6, SHARED.gun, 0, 0, -0.2);
    this.muzzleLocal = new THREE.Vector3(0, 0.02, -0.5);
    this.can = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 10), SHARED.gun);
    this.can.rotation.x = Math.PI / 2;
    this.can.visible = false;
    this.gun.add(this.can);
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
    this.tag = new THREE.Sprite(this.tagMat);
    this.tag.scale.set(1.2, 0.3, 1);
    this.tag.position.y = 2.2;
    this.tag.visible = false;
    g.add(this.tag);
    g.visible = false;
    scene.add(g);
    this.tagKey = '';
    this.setOutfit('standard');
  }

  buildGear(upper, head) {
    const ic = icons();
    const pouch = (bag, icon) => {
      const g = new THREE.Group();
      bx(g, 0.5, 0.06, 0.28, SHARED.strap, 0, 0.17, 0);                    // belt round the waist
      bx(g, 0.32, 0.15, 0.12, lam(bag), 0, 0.15, -0.19);                  // the pouch
      bx(g, 0.3, 0.03, 0.125, SHARED.strap, 0, 0.235, -0.19);             // flap seam
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.1), icon);
      plate.position.set(0, 0.145, -0.2505);
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
    for (const x of this.parts.pants) x.material = m.pants;
    for (const x of this.parts.boots) x.material = m.boots;
    for (const x of this.parts.shirt) x.material = m.shirt || this.body;
    for (const x of this.parts.wrap) x.material = m.wrap || this.wrap;
    for (const k in this.heads) this.heads[k].visible = k === (m.head || 'wrap') && this.gearLd !== 3;
    this.visor.visible = !!m.glow;
    if (m.glow) this.visor.material = m.glow;
  }

  setCosmetics(cs) {
    if (!cs) return;
    if (cs.o !== this.outfit) this.setOutfit(cs.o);
    this.gunSkins = cs.g || {};
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
    const s = GUN_SIZES[w] || GUN_SIZES.smg;
    this.gunMesh.scale.set(s[0] / 0.06, s[1] / 0.1, s[2] / 0.6);
    this.gunMesh.position.z = -s[2] / 2 + 0.1;
    const skin = this.gunSkins[w] && gunMaterials(this.gunSkins[w], true);
    this.gunMesh.material = skin ? skin.body : w === 'sniper' || w === 'lmg' ? SHARED.gunTan : w === 'revolver' ? SHARED.silver : SHARED.gun;
    this.muzzleLocal.set(0, 0.02, -s[2] + 0.1);
    const quiet = w === 'sniper' || (w === 'pistol' && (this.loadout === 2 || this.loadout === 3));
    this.can.visible = quiet;
    if (quiet) {
      this.can.position.set(0, 0, -s[2] + 0.02);
      this.muzzleLocal.z -= 0.22;
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
    this.lastPos.copy(this.pos);
    if (this.deathT > 0) {
      this.deathT += dt;
      const k = Math.min(1, this.deathT / 0.45);
      g.rotation.set(0, this.yaw, 0);
      g.rotateX(-k * k * Math.PI / 2 * 0.95);
      g.position.y = this.pos.y + 0.1 * k;
      g.visible = this.deathT < 5;
      this.tag.visible = false;
      return;
    }
    // flying a drone: the body stands where it was, head down over the controller
    this.piloting = !!(this.flags & 2048);
    this.driving = !!(this.flags & 16384);
    this.burning = !!(this.flags & 32768);
    g.visible = alive;
    if (!alive) return;
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
    if (this.driving) g.position.y = this.pos.y + 0.55;   // up on the forklift's seat
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
    this.upper.rotation.x = c * 0.15;
    this.showName = Math.max(0, this.showName - dt);
    this.revealT = Math.max(0, this.revealT - dt);
    this.pingT = Math.max(0, (this.pingT || 0) - dt);
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
    this.glint.position.set(0, (1.62 - this.crouchK * 0.44) * (1 - pk) + 1.5 * pk, 0.5 * pk * (1 - 2 * this.backK));
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
      if (o.geometry) o.geometry.dispose();
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
