// Other players: blocky soldiers, smoothed between server snapshots, with
// hit volumes for our own shots.

import * as THREE from 'three';
import { nameTag } from './textures.js';

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

const GUN_SIZES = {
  smg: [0.06, 0.1, 0.5], lmg: [0.09, 0.13, 0.85], shotgun: [0.06, 0.08, 0.85], sniper: [0.06, 0.09, 1.05], pistol: [0.04, 0.08, 0.2],
};

class Avatar {
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
    this.body = lam('#888');
    this.wrap = lam('#888');
    // legs pivot at the hips
    this.legs = [];
    for (const sx of [-0.11, 0.11]) {
      const leg = new THREE.Group();
      bx(leg, 0.17, 0.5, 0.19, SHARED.pants, 0, -0.25, 0);
      const shin = new THREE.Group();
      bx(shin, 0.16, 0.42, 0.18, SHARED.pants, 0, -0.21, 0);
      bx(shin, 0.18, 0.1, 0.27, SHARED.boots, 0, -0.42, -0.04);
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
    bx(upper, 0.44, 0.3, 0.25, SHARED.pants, 0, 0.08, 0);
    bx(upper, 0.48, 0.42, 0.28, this.body, 0, 0.4, 0);       // vest in team colour
    bx(upper, 0.1, 0.44, 0.3, SHARED.strap, 0.12, 0.4, 0.001);
    const head = new THREE.Group();
    head.position.y = 0.76;
    upper.add(head);
    this.head = head;
    bx(head, 0.23, 0.25, 0.25, SHARED.skin, 0, 0, 0);
    bx(head, 0.26, 0.12, 0.28, this.wrap, 0, 0.1, 0.01);     // headwrap
    bx(head, 0.26, 0.1, 0.12, this.wrap, 0, -0.08, 0.08);    // scarf
    bx(head, 0.2, 0.04, 0.02, SHARED.boots, 0, 0.03, -0.13); // eyes shadow
    // arms and gun
    const arms = new THREE.Group();
    arms.position.set(0, 0.52, 0);
    upper.add(arms);
    this.arms = arms;
    bx(arms, 0.12, 0.12, 0.4, this.body, 0.2, -0.02, -0.14);
    bx(arms, 0.12, 0.12, 0.4, this.body, -0.16, -0.04, -0.22);
    bx(arms, 0.1, 0.1, 0.1, SHARED.boots, 0.14, -0.04, -0.34);
    bx(arms, 0.1, 0.1, 0.1, SHARED.boots, -0.04, -0.03, -0.5);
    this.gun = new THREE.Group();
    this.gun.position.set(0.08, 0.02, -0.3);
    arms.add(this.gun);
    this.gunMesh = bx(this.gun, 0.06, 0.1, 0.6, SHARED.gun, 0, 0, -0.2);
    this.muzzleLocal = new THREE.Vector3(0, 0.02, -0.5);

    this.tagMat = new THREE.SpriteMaterial({ transparent: true, depthTest: true, depthWrite: false });
    this.tag = new THREE.Sprite(this.tagMat);
    this.tag.scale.set(1.2, 0.3, 1);
    this.tag.position.y = 2.2;
    this.tag.visible = false;
    g.add(this.tag);
    g.visible = false;
    scene.add(g);
    this.tagKey = '';
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
    this.gunMesh.material = w === 'sniper' || w === 'lmg' ? SHARED.gunTan : SHARED.gun;
    this.muzzleLocal.set(0, 0.02, -s[2] + 0.1);
  }

  push(t, x, y, z, yaw, pitch, flags) {
    this.snaps.push({ t, x, y, z, yaw, pitch, flags });
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
    g.visible = alive;
    if (!alive) return;
    g.rotation.set(0, this.yaw, 0);
    // walk
    const sp = Math.min(this.speed, 8);
    if (sp > 0.4) this.walkT += dt * sp * 1.9;
    const swing = Math.sin(this.walkT) * Math.min(1, sp / 4) * 0.7;
    const c = this.crouchK;
    this.legs[0].rotation.x = swing - c * 1.3;
    this.legs[1].rotation.x = -swing - c * 0.2;
    this.legs[0].userData.shin.rotation.x = Math.max(0, -swing) * 0.8 + c * 1.6;
    this.legs[1].userData.shin.rotation.x = Math.max(0, swing) * 0.8 + c * 0.9;
    this.legs[0].position.y = this.legs[1].position.y = 0.95 - c * 0.38;
    this.upper.position.y = 0.97 - c * 0.42;
    this.upper.rotation.x = 0;
    this.arms.rotation.x = this.pitch;
    this.head.rotation.x = this.pitch * 0.6;
    this.upper.rotation.x = c * 0.15;
    this.showName = Math.max(0, this.showName - dt);
    this.revealT = Math.max(0, this.revealT - dt);
  }

  headCenter(out) {
    return out.set(this.pos.x, this.pos.y + 1.73 - this.crouchK * 0.44, this.pos.z);
  }

  bodyTop() {
    return 1.5 - this.crouchK * 0.44;
  }

  muzzle(out) {
    this.group.updateMatrixWorld(true);
    return out.copy(this.muzzleLocal).applyMatrix4(this.gun.matrixWorld);
  }

  dispose() {
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
      }
    }
  }

  sync(list, myId, t) {
    for (const p of list) {
      const [id, x, y, z, yaw, pitch, flags, ld, slot] = p;
      if (id === myId) continue;
      let a = this.map.get(id);
      if (!a) {
        a = new Avatar(id, this.scene);
        this.map.set(id, a);
        const r = this.roster.get(id);
        if (r) a.setIdentity(r.n, r.tm);
      }
      a.loadout = ld;
      a.slot = slot;
      a.setGun(slot === 1 ? 'pistol' : ['smg', 'lmg', 'shotgun', 'sniper'][ld] || 'smg');
      a.push(t, x, y, z, yaw, pitch, flags);
    }
  }

  update(dt, t, camera, myTeam, teamMode) {
    const rt = t - DELAY;
    for (const a of this.map.values()) {
      a.update(dt, rt);
      const friendly = teamMode && a.team === myTeam;
      a.tag.visible = a.alive && (friendly || a.showName > 0);
      a.tagMat.depthTest = !friendly;
      a.tag.renderOrder = friendly ? 5 : 0;
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
