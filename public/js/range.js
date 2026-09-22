// Aim training: an underground firing range under the souk. Solo and
// offline — the range is built here, the targets live here, nothing goes
// to the server.

import * as THREE from 'three';
import { ding } from './audio.js';

const HALL_W = 9;          // half width
const HALL_H = 5;
const NEAR = 6;            // back wall, behind the firing line
const FAR = -112;          // backstop
const LANES = [-6.4, -3.2, 0, 3.2, 6.4];

// [lane, distance, moving?]
const LAYOUT = [
  [2, 10, 0], [0, 15, 0], [4, 18, 0],
  [1, 25, 0], [3, 30, 1],
  [2, 40, 0], [0, 45, 0], [4, 50, 0],
  [1, 60, 1], [3, 70, 0],
  [2, 85, 0], [0, 95, 1], [4, 105, 0],
];

// the bunker as a town map, so the normal world builder and physics can use it
export function buildRangeMap() {
  const boxes = [];
  const b = (cx, cy, cz, hx, hy, hz, mat, tint = 3) => boxes.push([cx, cy, cz, hx, hy, hz, 0, mat, tint]);
  const midZ = (NEAR + FAR) / 2, halfL = (NEAR - FAR) / 2;
  // floor, walls, ceiling
  b(0, 0.01, midZ, HALL_W, 0.02, halfL, 'tile');
  b(-HALL_W - 0.4, HALL_H / 2, midZ, 0.4, HALL_H / 2, halfL + 0.8, 'stone');
  b(HALL_W + 0.4, HALL_H / 2, midZ, 0.4, HALL_H / 2, halfL + 0.8, 'stone');
  b(0, HALL_H / 2, NEAR + 0.4, HALL_W, HALL_H / 2, 0.4, 'stone');
  b(0, HALL_H / 2, FAR - 0.4, HALL_W, HALL_H / 2, 0.4, 'stone');
  b(0, HALL_H + 0.3, midZ, HALL_W + 0.8, 0.3, halfL + 0.8, 'roof');
  // sand berm in front of the backstop
  b(0, 0.9, FAR + 1.5, HALL_W, 0.9, 1.5, 'hay');
  // arches: pillars down both walls with a beam across
  for (let z = NEAR - 8; z > FAR + 6; z -= 12) {
    b(-HALL_W + 0.35, HALL_H / 2, z, 0.35, HALL_H / 2, 0.45, 'wall');
    b(HALL_W - 0.35, HALL_H / 2, z, 0.35, HALL_H / 2, 0.45, 'wall');
    b(0, HALL_H - 0.25, z, HALL_W, 0.25, 0.35, 'wall');
  }
  // the firing line: a counter with booth dividers
  b(0, 0.52, -1.3, HALL_W, 0.52, 0.28, 'wood');
  for (let i = 0; i < LANES.length - 1; i++) {
    const x = (LANES[i] + LANES[i + 1]) / 2;
    b(x, 1.05, -0.6, 0.05, 1.05, 0.95, 'wood');
  }
  // behind the line: ammo crates and sandbags
  for (const [x, z] of [[-7.6, 3.8], [-6.5, 4.4], [7.4, 4.2], [6.2, 4.6]]) b(x, 0.45, z, 0.45, 0.45, 0.45, 'crate');
  b(-3, 0.35, 5.2, 2.2, 0.35, 0.4, 'hay');
  b(3.5, 0.35, 5.2, 1.6, 0.35, 0.4, 'hay');
  const deco = [];
  for (let z = NEAR - 2; z > FAR + 4; z -= 12) {
    deco.push({ k: 'lamp', x: -4.5, y: HALL_H - 0.6, z }, { k: 'lamp', x: 4.5, y: HALL_H - 0.6, z });
  }
  for (const d of [10, 25, 50, 75, 100]) deco.push({ k: 'sign', x: 0, z: -d, text: `${d} m` });
  deco.push({ k: 'sign', x: 0, z: 3.4, text: 'QADIR RANGE', big: 1 });
  deco.push({ k: 'rug', x: -1.6, z: 2.4, yaw: 0, c: 0 }, { k: 'rug', x: 1.8, z: 2.6, yaw: 0.1, c: 3 });
  return {
    seed: 0, bounds: [HALL_W + 2, Math.max(NEAR, -FAR) + 4], boxes, deco, sites: {}, hills: [],
    teamSpawns: [[[0, 3]], [[0, 3]]], ffaSpawns: [[0, 3]],
    areas: [{ n: 'Qadir Range', x: 0, z: -50, r: 200 }],
    indoor: true,
  };
}

function targetMesh() {
  const g = new THREE.Group();
  const steel = new THREE.MeshLambertMaterial({ color: '#d8d0bc' });
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.9, 0.07), new THREE.MeshLambertMaterial({ color: '#3a3a36' }));
  post.position.y = 0.45;
  g.add(post);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.4), post.material);
  foot.position.y = 0.04;
  g.add(foot);
  const pivot = new THREE.Group();
  pivot.position.y = 0.88;
  g.add(pivot);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.72, 0.04), steel);
  body.position.y = 0.37;
  pivot.add(body);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.04, 20), steel);
  head.rotation.x = Math.PI / 2;
  head.position.y = 0.9;
  pivot.add(head);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.16, 24), new THREE.MeshBasicMaterial({ color: '#b3352b' }));
  ring.position.set(0, 0.36, 0.022);
  pivot.add(ring);
  const bull = new THREE.Mesh(new THREE.CircleGeometry(0.05, 16), ring.material);
  bull.position.set(0, 0.36, 0.023);
  pivot.add(bull);
  g.userData = { pivot, steel };
  return g;
}

export class Range {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.targets = LAYOUT.map(([lane, d, moving], i) => {
      const mesh = targetMesh();
      const x = LANES[lane];
      mesh.position.set(x, 0, -d);
      this.group.add(mesh);
      return { mesh, x, z: -d, d, moving: !!moving, phase: i * 1.7, down: 0, fall: 0, flash: 0 };
    });
    this.t = 0;
    this.reset();
  }

  reset() {
    this.stats = { shots: 0, hits: 0, heads: 0, streak: 0, best: 0, bestStreak: 0 };
  }

  update(dt) {
    this.t += dt;
    for (const T of this.targets) {
      if (T.moving) {
        T.mesh.position.x = T.x + Math.sin(this.t * 0.8 + T.phase) * 2.4;
      }
      // knocked down: fall back, wait, pop up again
      if (T.down > 0) {
        T.down -= dt;
        T.fall = Math.min(1, T.fall + dt * 7);
        if (T.down <= 0) T.down = 0;
      } else if (T.fall > 0) {
        T.fall = Math.max(0, T.fall - dt * 4);
      }
      T.mesh.userData.pivot.rotation.x = -T.fall * (Math.PI / 2) * 0.95;
      if (T.flash > 0) {
        T.flash -= dt;
        T.mesh.userData.steel.color.set(T.flash > 0 ? '#ffcf6a' : '#d8d0bc');
      }
    }
  }

  // nearest standing target the ray hits: {t, part, target}
  raycast(o, d, maxT) {
    let best = null;
    for (const T of this.targets) {
      if (T.fall > 0.05) continue;
      const px = T.mesh.position.x, pz = T.mesh.position.z;
      // head: a disc facing the shooter, treated as a sphere
      const hc = new THREE.Vector3(px, 0.88 + 0.9, pz);
      const oc = new THREE.Vector3().subVectors(o, hc);
      const bq = oc.dot(d);
      const disc = bq * bq - (oc.lengthSq() - 0.14 * 0.14);
      if (disc >= 0) {
        const t = -bq - Math.sqrt(disc);
        if (t > 0 && t < maxT && (!best || t < best.t)) best = { t, part: 'h', target: T };
      }
      // body plate
      const min = [px - 0.25, 0.88 + 0.01, pz - 0.04], max = [px + 0.25, 0.88 + 0.73, pz + 0.04];
      let t0 = 0, t1 = maxT, ok = true;
      for (let i = 0; i < 3 && ok; i++) {
        const oi = [o.x, o.y, o.z][i], di = [d.x, d.y, d.z][i];
        if (Math.abs(di) < 1e-9) {
          if (oi < min[i] || oi > max[i]) ok = false;
        } else {
          let a = (min[i] - oi) / di, c = (max[i] - oi) / di;
          if (a > c) [a, c] = [c, a];
          t0 = Math.max(t0, a);
          t1 = Math.min(t1, c);
          if (t0 > t1) ok = false;
        }
      }
      if (ok && t0 > 0 && (!best || t0 < best.t - 0.02)) best = { t: t0, part: 'b', target: T };
    }
    return best;
  }

  hit(h, dist) {
    const T = h.target;
    const s = this.stats;
    s.hits++;
    if (h.part === 'h') s.heads++;
    s.streak++;
    s.bestStreak = Math.max(s.bestStreak, s.streak);
    s.best = Math.max(s.best, Math.round(dist));
    T.down = 2.2;
    T.flash = 0.12;
    ding(T.mesh.position, h.part === 'h');
  }

  miss() {
    this.stats.streak = 0;
  }

  // a grenade knocks down anything near it
  blast(p, r) {
    for (const T of this.targets) {
      if (T.fall > 0.05) continue;
      if (Math.hypot(T.mesh.position.x - p.x, T.mesh.position.z - p.z) < r) {
        T.down = 2.2;
        T.flash = 0.12;
      }
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
  }
}
