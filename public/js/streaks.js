// Scorestreaks: what you see in the sky when someone calls one in. The scan is
// all HUD; the helicopter is a Blackhawk-style gunship circling the town with a
// Gatling in its left door; the airstrike is a pair of F-35s on full afterburner at
// two hundred feet, and the bombs they toss. The helicopter's circuit is worked out
// here from the same sums the server uses (heli_path in server/server.py), so
// everyone sees it in the same place at the same time.

import * as THREE from 'three';
import { addGatling } from './world.js';

// keep every number in step with server/server.py
export const STREAKS = [
  { k: 'scan', n: 2, name: 'Scan beacon', bind: 'streak1', what: 'Every enemy marked on the map for 30 seconds' },
  { k: 'strike', n: 5, name: 'Airstrike', bind: 'streak2', what: 'Pick a spot from above: two jets flatten it five seconds later' },
  { k: 'heli', n: 8, name: 'Helicopter gunner', bind: 'streak3', what: '45 seconds on the door gun of a helicopter over the town' },
  { k: 'carpet', n: 10, name: 'Carpet bomb', bind: 'streak4', what: 'Four jets bomb a line across the map, wherever it falls. Nothing on it lives, roof or no roof' },
];
export const HELI_FLAG = 2097152;
export const HELI_ALT = 30, HELI_MARGIN = 12, HELI_CORNER = 22, HELI_SPEED = 22;
export const HELI_SEAT = { left: 1.05, down: -1.0, back: 0.2 };   // the gunner's feet, from the hub
export const HELI_HEAT = 7.0;         // seconds of fire before the gun overheats
export const HELI_COOL = 4.0;         // seconds to cool right down after that
export const STRIKE_R = 7.5, STRIKE_KILL_R = 5.0, STRIKE_DELAY = 5;
export const BOMBER_ALT = 61;         // two hundred feet
export const BOMBER_SPEED = 175;      // full afterburner, as fast as the eye can follow
export const BOMBER_OVER = 3.4;       // seconds after the call the pair is over the target
export const BOMB_FALL = 1.6;         // and the bombs take this long to come down
export const BOMB_AWAY = BOMBER_OVER - 0.55;   // when the first bomb comes off
export const JET_BANK = 55 * Math.PI / 180;    // the pair rolls into a left turn once the bombs are away
export const JET_TURN = 0.13;                  // radians a second, once they are banked over
export const CARPET_WARN = 4, CARPET_W = 14;   // keep in step with the server: the warning, half the swath
export const CARPET_FALL = 1.7;                // the bombs take this long to come down from two hundred feet
export const CARPET_DROP = 0.4;                // seconds between one jet's bombs

const lam = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });
const bx = (parent, w, h, d, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
};

// -- the circuit -----------------------------------------------------------------

export function heliPath(bxn, bzn) {
  const X = bxn + HELI_MARGIN, Z = bzn + HELI_MARGIN;
  const C = Math.min(HELI_CORNER, X - 1, Z - 1);
  const segs = [];
  const line = (a, b) => segs.push({ kind: 'line', a, b, L: Math.hypot(b[0] - a[0], b[1] - a[1]) });
  const arc = (c, th0) => segs.push({ kind: 'arc', a: c, b: th0, L: Math.PI / 2 * C });
  line([X, 0], [X, -Z + C]); arc([X - C, -Z + C], 0);
  line([X - C, -Z], [-X + C, -Z]); arc([-X + C, -Z + C], -Math.PI / 2);
  line([-X, -Z + C], [-X, Z - C]); arc([-X + C, Z - C], Math.PI);
  line([-X + C, Z], [X - C, Z]); arc([X - C, Z - C], Math.PI / 2);
  line([X, Z - C], [X, 0]);
  return { segs, len: segs.reduce((s, g) => s + g.L, 0), C };
}

// where the helicopter is s metres round: x, z, its heading (a cart's yaw: along +x at
// zero, the gunner's door on the left) and whether it is in a bend (to bank it)
export function heliAt(path, s, out = {}) {
  s = ((s % path.len) + path.len) % path.len;
  const C = path.C;
  for (const g of path.segs) {
    if (s > g.L) { s -= g.L; continue; }
    if (g.kind === 'line') {
      const k = g.L ? s / g.L : 0;
      const dx = g.b[0] - g.a[0], dz = g.b[1] - g.a[1];
      out.x = g.a[0] + dx * k; out.z = g.a[1] + dz * k; out.yaw = Math.atan2(-dz, dx); out.bend = 0;
      return out;
    }
    const th = g.b - s / C;
    out.x = g.a[0] + C * Math.cos(th); out.z = g.a[1] + C * Math.sin(th); out.yaw = Math.PI / 2 - th; out.bend = 1;
    return out;
  }
  out.x = path.segs[0].a[0]; out.z = path.segs[0].a[1]; out.yaw = Math.PI / 2; out.bend = 0;
  return out;
}

// the gunner's feet, in the left door
export function heliSeat(path, s, out) {
  const h = heliAt(path, s);
  const lx = -Math.sin(h.yaw), lz = -Math.cos(h.yaw);
  const bxx = -Math.cos(h.yaw), bzz = Math.sin(h.yaw);
  return out.set(h.x + lx * HELI_SEAT.left + bxx * HELI_SEAT.back, HELI_ALT + HELI_SEAT.down, h.z + lz * HELI_SEAT.left + bzz * HELI_SEAT.back);
}

// -- the helicopter ----------------------------------------------------------------

// A Blackhawk: a flat-sided cabin with the cockpit glazed in front, two engines in
// a hump under the main rotor, a long tail boom with the fin and the tail rotor,
// stub wings, wheels. Local +x is forward; the left door (local -z) is open with
// the Gatling on a pintle in it. Origin at the rotor hub, roughly the cabin's middle.
export function makeHeli(team = -1) {
  const g = new THREE.Group();
  const paint = lam(team === 0 ? '#4a4036' : team === 1 ? '#34424a' : '#3c4a3c');
  const dark = lam('#1e2224');
  const glass = lam('#1b2b36');
  // the cabin's walls are drawn both sides and glow a little, so the inside is not a black box
  const wall = new THREE.MeshLambertMaterial({ color: paint.color.getStyle(), emissive: '#1c201b', side: THREE.DoubleSide });
  const inner = new THREE.MeshLambertMaterial({ color: '#5c6358', emissive: '#2a2e27', side: THREE.DoubleSide });
  // the cabin: a floor, a roof, the right side, the ends, and the left side with the
  // door opening in it (x from -1.3 to 1.1) that the gun sits in
  bx(g, 4.6, 0.1, 2.3, inner, 0, -1.45, 0);              // the floor
  bx(g, 4.6, 0.1, 2.3, wall, 0, 0.35, 0);                // the roof
  bx(g, 4.6, 1.9, 0.1, wall, 0, -0.55, 1.1);             // the right side
  bx(g, 0.1, 1.9, 2.3, wall, 2.25, -0.55, 0);            // the front bulkhead
  bx(g, 0.1, 1.9, 2.3, wall, -2.25, -0.55, 0);           // the back
  bx(g, 0.8, 1.9, 0.1, wall, -1.9, -0.55, -1.1);         // the left side, behind the door
  bx(g, 1.0, 1.9, 0.1, wall, 1.8, -0.55, -1.1);          // and in front of it
  bx(g, 2.8, 0.2, 0.1, wall, -0.1, 0.25, -1.1);          // the lintel over the door
  bx(g, 1.8, 0.4, 0.5, dark, 0.2, -1.2, 0.8);            // a bench along the far side
  bx(g, 0.5, 0.9, 0.5, dark, 1.9, -1.0, 0.5);            // the pilots' seats, through the bulkhead door
  bx(g, 0.5, 0.9, 0.5, dark, 1.9, -1.0, -0.5);
  // the nose and the cockpit glazing
  const nose = bx(g, 1.9, 1.3, 2.0, paint, 3.0, -0.95, 0);
  nose.rotation.z = -0.12;
  const screen = bx(g, 1.3, 1.0, 2.1, glass, 2.65, -0.15, 0);
  screen.rotation.z = -0.5;
  bx(g, 1.2, 0.5, 2.15, paint, 2.3, 0.3, 0, 0, 0, -0.2);  // the roof over the pilots
  // the engine hump and the rotor mast
  bx(g, 3.2, 0.6, 1.5, paint, -0.4, 0.7, 0);
  for (const z of [-0.55, 0.55]) {
    const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 2.4, 10), dark);
    eng.rotation.z = Math.PI / 2;
    eng.position.set(-0.6, 0.78, z);
    g.add(eng);
  }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.7, 8), dark);
  mast.position.set(0, 1.25, 0);
  g.add(mast);
  // the main rotor: four blades, and a disc that shows when they are a blur
  const rotor = new THREE.Group();
  rotor.position.set(0, 1.55, 0);
  g.add(rotor);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.25, 10), dark);
  rotor.add(hub);
  for (let i = 0; i < 4; i++) {
    const b = bx(rotor, 8.0, 0.05, 0.42, dark, 4.0, 0, 0);
    b.rotation.y = i * Math.PI / 2;
    const pivot = new THREE.Group();
    pivot.rotation.y = i * Math.PI / 2;
    pivot.add(b);
    b.rotation.y = 0;
    rotor.add(pivot);
  }
  const disc = new THREE.Mesh(new THREE.CircleGeometry(8.1, 36), new THREE.MeshBasicMaterial({ color: '#111', transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 1.55;
  g.add(disc);
  // the tail boom, the fin, the tailplane and the tail rotor
  const boom = bx(g, 6.0, 0.9, 0.8, paint, -5.2, -0.3, 0);
  boom.rotation.z = -0.04;
  bx(g, 0.9, 2.2, 0.18, paint, -8.2, 0.7, 0, 0, 0, 0.35);
  bx(g, 0.6, 0.12, 2.6, paint, -7.6, -0.2, 0);
  const tailRotor = new THREE.Group();
  tailRotor.position.set(-8.4, 1.4, 0.3);
  g.add(tailRotor);
  for (let i = 0; i < 2; i++) {
    const b = bx(tailRotor, 0.08, 2.0, 0.22, dark, 0, 0, 0);
    b.rotation.z = i * Math.PI / 2;
  }
  const tdisc = new THREE.Mesh(new THREE.CircleGeometry(1.05, 18), new THREE.MeshBasicMaterial({ color: '#111', transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
  tdisc.rotation.y = Math.PI / 2;
  tailRotor.add(tdisc);
  // stub wings and the wheels
  for (const z of [-1.5, 1.5]) {
    bx(g, 1.3, 0.14, 1.2, paint, 0.2, -0.2, z);
    const leg = bx(g, 0.12, 0.8, 0.12, dark, 1.6, -1.85, z * 0.85);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.22, 12), dark);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(1.6, -2.25, z * 0.85);
    g.add(wheel);
    leg.visible = true;
  }
  const tw = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.16, 10), dark);
  tw.rotation.x = Math.PI / 2;
  tw.position.set(-6.6, -1.05, 0);
  g.add(tw);
  // the door opening's sill, the gun's pintle stands on it
  const frameMat = lam('#2a2e2a');
  bx(g, 2.8, 0.12, 0.2, frameMat, -0.1, -1.42, -1.16);
  // the door gun on its pintle in the doorway, aimed by the gunner (see aimHeliGuns)
  addGatling(g, { x: -HELI_SEAT.back, y: -1.42, z: -1.25, pivot: 0.62 });
  const T = g.userData.turret;
  T.yaw.rotation.y = Math.PI / 2;      // at rest it points out of the door
  // position and strobe lights
  const red = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), new THREE.MeshBasicMaterial({ color: '#ff3b2f' }));
  red.position.set(0.2, -0.2, -2.1);
  g.add(red);
  const green = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), new THREE.MeshBasicMaterial({ color: '#3bff5a' }));
  green.position.set(0.2, -0.2, 2.1);
  g.add(green);
  const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  strobe.position.set(-4.0, 0.25, 0);
  g.add(strobe);
  g.userData.rotor = rotor;
  g.userData.tailRotor = tailRotor;
  g.userData.disc = disc;
  g.userData.strobe = strobe;
  g.userData.seat = new THREE.Vector3(-HELI_SEAT.back, HELI_SEAT.down, -HELI_SEAT.left);
  g.userData.eye = new THREE.Vector3(-HELI_SEAT.back, HELI_SEAT.down + 0.65, -HELI_SEAT.left + 0.35);   // the gunner's eye: sat on the floor, a little in from the door
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return g;
}

// put the helicopter where it is now: on its circuit, banked into the bends, the rotors turning
export function poseHeli(mesh, path, s, dt, clock) {
  const h = heliAt(path, s);
  mesh.position.set(h.x, HELI_ALT + Math.sin(clock * 1.7) * 0.25, h.z);
  mesh.rotation.set(0, h.yaw, 0, 'YXZ');
  const want = h.bend ? -0.28 : 0;        // the bends all turn left, so it leans left into them
  mesh.userData.bank = (mesh.userData.bank || 0) + (want - (mesh.userData.bank || 0)) * Math.min(1, dt * 1.5);
  mesh.rotateX(mesh.userData.bank);
  mesh.rotateZ(0.06);                     // nose a touch down, the way they fly
  mesh.userData.rotor.rotation.y += dt * 28;
  mesh.userData.tailRotor.rotation.x += dt * 70;
  mesh.userData.strobe.visible = clock % 1.1 < 0.08;
}

// -- the jets ------------------------------------------------------------------------

// An F-35: a stubby single-engine fighter, fifteen metres nose to nozzle, eleven
// across. Chined nose, a bubble canopy well forward, the big cheek intakes, a
// trapezoid wing, small all-moving tailplanes and the two fins canted outward,
// with one fat nozzle and the afterburner flame behind it. Local +x is forward.
export function makeJet() {
  const g = new THREE.Group();
  const grey = lam('#7b8189');
  const dark = lam('#3a3d42');
  const glass = new THREE.MeshLambertMaterial({ color: '#c9a44a', emissive: '#3a2a08', transparent: true, opacity: 0.9 });
  // the fuselage: a long box with the top edges softened by a second, narrower box
  bx(g, 10.5, 1.5, 2.1, grey, -0.5, 0, 0);
  bx(g, 9.5, 0.7, 1.3, grey, -0.3, 0.95, 0);
  // the nose: a cone sitting on the chine, pointing forward
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.95, 4.4, 10), grey);
  nose.rotation.z = -Math.PI / 2;
  nose.scale.set(1, 1, 0.8);
  nose.position.set(6.9, 0.1, 0);
  g.add(nose);
  // the canopy, a bubble well forward
  const can = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), glass);
  can.scale.set(2.2, 0.75, 0.85);
  can.position.set(3.2, 1.15, 0);
  g.add(can);
  // the cheek intakes either side, with a dark mouth
  for (const side of [-1, 1]) {
    bx(g, 4.0, 1.3, 0.9, grey, 2.0, -0.25, side * 1.45);
    bx(g, 0.2, 1.0, 0.7, dark, 4.05, -0.25, side * 1.45);
  }
  // the wing: one trapezoid across the whole span, swept forward edge, straight back edge
  const half = 5.4, root = 5.6, tip = 1.5;
  const wingShape = new THREE.Shape([[root * 0.45, 0], [tip * 0.2 - 1.2, half], [-tip - 1.2, half], [-root * 0.55, 0], [-tip - 1.2, -half], [tip * 0.2 - 1.2, -half]].map(([x, z]) => new THREE.Vector2(x, z)));
  const wing = new THREE.Mesh(new THREE.ExtrudeGeometry(wingShape, { depth: 0.22, bevelEnabled: false }), grey);
  wing.rotation.x = Math.PI / 2;
  wing.position.set(-0.4, -0.2, 0);
  g.add(wing);
  // the tailplanes, smaller, right at the back
  const tailShape = new THREE.Shape([[1.2, 0], [-0.6, 2.6], [-2.0, 2.6], [-2.0, 0], [-2.0, -2.6], [-0.6, -2.6]].map(([x, z]) => new THREE.Vector2(x, z)));
  const tail = new THREE.Mesh(new THREE.ExtrudeGeometry(tailShape, { depth: 0.16, bevelEnabled: false }), grey);
  tail.rotation.x = Math.PI / 2;
  tail.position.set(-4.4, 0.1, 0);
  g.add(tail);
  // the two fins, canted out
  const finShape = new THREE.Shape([[2.2, 0], [0.4, 2.4], [-1.0, 2.4], [-1.4, 0]].map(([x, y]) => new THREE.Vector2(x, y)));
  for (const side of [-1, 1]) {
    const fin = new THREE.Mesh(new THREE.ExtrudeGeometry(finShape, { depth: 0.14, bevelEnabled: false }), grey);
    fin.position.set(-4.0, 0.6, side * 1.0);
    fin.rotation.x = side * 0.35;
    g.add(fin);
  }
  // the nozzle and the flame behind it
  const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.72, 1.2, 12), dark);
  noz.rotation.z = Math.PI / 2;
  noz.position.set(-6.2, 0, 0);
  g.add(noz);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.62, 7, 10, 1, true), new THREE.MeshBasicMaterial({ color: '#ff7a1e', transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
  flame.rotation.z = Math.PI / 2;
  flame.position.set(-10.2, 0, 0);
  g.add(flame);
  const core = new THREE.Mesh(new THREE.ConeGeometry(0.34, 4.5, 8, 1, true), new THREE.MeshBasicMaterial({ color: '#fff3c4', transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }));
  core.rotation.z = Math.PI / 2;
  core.position.set(-9.0, 0, 0);
  g.add(core);
  g.userData.flame = flame;
  g.userData.core = core;
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return g;
}
export const makeBomber = makeJet;

// the afterburner flickers: call every frame
export function poseJet(mesh, clock) {
  const f = mesh.userData.flame, c = mesh.userData.core;
  if (!f) return;
  const k = 0.85 + 0.3 * Math.abs(Math.sin(clock * 47) * Math.sin(clock * 31 + 1));
  f.scale.set(1, k, 1);
  f.position.x = -6.8 - 3.5 * k;
  c.scale.set(1, 0.9 + 0.25 * Math.sin(clock * 61), 1);
}

// the ring on the ground that marks where the bombs will land
export function makeStrikeRing() {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(STRIKE_R - 0.35, STRIKE_R, 48), new THREE.MeshBasicMaterial({ color: '#ff3a2a', transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  g.add(ring);
  const inner = new THREE.Mesh(new THREE.RingGeometry(STRIKE_KILL_R - 0.2, STRIKE_KILL_R, 40), new THREE.MeshBasicMaterial({ color: '#ff3a2a', transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
  inner.rotation.x = -Math.PI / 2;
  g.add(inner);
  const fill = new THREE.Mesh(new THREE.CircleGeometry(STRIKE_R, 48), new THREE.MeshBasicMaterial({ color: '#ff3a2a', transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
  fill.rotation.x = -Math.PI / 2;
  g.add(fill);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 60, 6), new THREE.MeshBasicMaterial({ color: '#ff5a4a', transparent: true, opacity: 0.35, depthWrite: false }));
  post.position.y = 30;
  g.add(post);
  g.userData.ring = ring;
  g.userData.fill = fill;
  return g;
}

// An airstrike from the call to the last bomb: the pair comes across the town at two
// hundred feet and full afterburner, over the target three and a bit seconds in, the
// bombs are tossed from just short of it and come down, and the ring on the ground
// burns red the whole time. The server lands the damage at five seconds; this only
// shows it.
export class StrikeShow {
  constructor(scene, fx, target, t0, heading, mine) {
    this.scene = scene;
    this.fx = fx;
    this.p = target.clone();
    this.t0 = t0;
    this.mine = mine;
    this.done = false;
    this.h0 = heading;
    this.yaw = heading;
    this.dir = new THREE.Vector3(Math.cos(heading), 0, -Math.sin(heading));
    this.bank = 0;
    this.ring = makeStrikeRing();
    this.ring.position.copy(this.p).add(new THREE.Vector3(0, 0.08, 0));
    scene.add(this.ring);
    // the lead and a wingman just back on its right, a street apart
    this.planes = [[0, 0], [-14, 16]].map(([back, side]) => {
      const m = makeJet();
      m.visible = false;
      scene.add(m);
      return { m, back, side };
    });
    this.bombs = [];
    this.booms = [];
    this.lead = new THREE.Vector3();
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * (STRIKE_R - 1.5);
      const at = BOMBER_OVER - 0.55 + (i % 4) * 0.07;     // tossed in a stick from just short of the target
      const land = STRIKE_DELAY + (i / n) * 0.7;
      this.bombs.push({ x: this.p.x + Math.cos(a) * r, z: this.p.z + Math.sin(a) * r, at, land, from: i % 2, mesh: null, hit: false, x0: 0, y0: 0, z0: 0 });
    }
    this.whistled = false;
    this.flare = 0;
  }

  // how far into the bank the pair is at t: nothing until the bombs are away, then
  // rolled over within a second
  bankAt(t) {
    const s = Math.max(0, Math.min(1, (t - BOMB_AWAY) / 1.0));
    return s * s * (3 - 2 * s);
  }

  // the lead at time t after the call: straight in until the bombs are off, then a
  // gentle left turn that tightens as the bank comes on. Sets this.yaw and this.dir
  // to the heading there. (Stepped, so everyone's sums come out the same.)
  leadAt(t, out) {
    const dx = Math.cos(this.h0), dz = -Math.sin(this.h0);
    const tb = Math.min(t, BOMB_AWAY);
    let x = this.p.x + dx * (tb - BOMBER_OVER) * BOMBER_SPEED, z = this.p.z + dz * (tb - BOMBER_OVER) * BOMBER_SPEED;
    let h = this.h0, y = BOMBER_ALT;
    if (t > BOMB_AWAY) {
      const n = Math.ceil((t - BOMB_AWAY) / 0.05);
      const step = (t - BOMB_AWAY) / n;
      for (let i = 0; i < n; i++) {
        const tt = BOMB_AWAY + (i + 0.5) * step;
        h += JET_TURN * this.bankAt(tt) * step;
        x += Math.cos(h) * BOMBER_SPEED * step;
        z += -Math.sin(h) * BOMBER_SPEED * step;
      }
      y += 10 * this.bankAt(t);     // and a touch of climb as they pull
    }
    this.yaw = h;
    this.dir.set(Math.cos(h), 0, -Math.sin(h));
    this.bank = JET_BANK * this.bankAt(t);
    return out.set(x, y, z);
  }

  update(dt, clock, sfx, shake) {
    const t = clock - this.t0;
    const k = Math.min(1, t / STRIKE_DELAY);
    this.ring.userData.ring.material.opacity = 0.55 + 0.4 * Math.abs(Math.sin(t * (4 + k * 10)));
    this.ring.userData.fill.material.opacity = 0.08 + 0.1 * k;
    // the marker flare: a column of red smoke at the spot
    this.flare -= dt;
    if (this.flare <= 0 && t < STRIKE_DELAY) {
      this.flare = 0.12;
      this.fx.flare(this.p, 0xff3a2a);
    }
    // the jets: in sight almost at once, gone a few seconds after the bombs
    const inSky = t > 0.3 && t < BOMBER_OVER + 7;
    this.leadAt(t, this.lead);
    const rx = Math.sin(this.yaw), rz = Math.cos(this.yaw);    // right of the heading
    for (const P of this.planes) {
      P.m.visible = inSky;
      if (!inSky) continue;
      // the wingman keeps station in the lead's frame, so it banks and turns with it
      const up = Math.sin(this.bank) * P.side;     // a left bank lifts the right-hand wingman
      P.m.position.set(this.lead.x + this.dir.x * P.back + rx * P.side * Math.cos(this.bank), this.lead.y + 2 * (P.side ? 1 : 0) + up, this.lead.z + this.dir.z * P.back + rz * P.side * Math.cos(this.bank));
      P.m.rotation.order = 'YXZ';
      P.m.rotation.set(-this.bank, this.yaw, 0);
      poseJet(P.m, clock);
    }
    if (inSky && sfx) sfx.jetRoar(true, this.lead);
    else if (sfx) sfx.jetRoar(false);
    // the pass shakes the ground under it
    if (inSky && shake && this.lead.y > 0) shake(this.lead, 110);
    // the bombs: tossed from the jets just short of the spot, arcing on to it
    for (const b of this.bombs) {
      if (t < b.at || b.hit) continue;
      if (!b.mesh) {
        b.mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.18, 2.4, 8), new THREE.MeshLambertMaterial({ color: '#2a2d30' }));
        const J = this.planes[b.from].m.position;
        b.x0 = J.x; b.y0 = J.y - 0.6; b.z0 = J.z;
        this.scene.add(b.mesh);
        if (!this.whistled && sfx) { this.whistled = true; sfx.bombWhistle(this.p, Math.max(0.2, b.land - t)); }
      }
      const f = Math.min(1, (t - b.at) / (b.land - b.at));
      const y = this.p.y + (b.y0 - this.p.y) * (1 - f * f);     // faster and faster, like something falling
      b.mesh.position.set(b.x0 + (b.x - b.x0) * f, y, b.z0 + (b.z - b.z0) * f);
      b.mesh.rotation.z = -(1 - f) * 1.2;
      b.mesh.rotation.y = this.yaw;
      if (t >= b.land) {
        b.hit = true;
        this.scene.remove(b.mesh);
        b.mesh = null;
        const at = new THREE.Vector3(b.x, this.p.y, b.z);
        this.fx.explosion(at);
        this.fx.explosion(at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 0.8, (Math.random() - 0.5) * 2)));
        this.fx.bigSmoke(at);
        if (sfx) sfx.explosion(at, 2.2);
        if (shake) shake(at, 110);
      }
    }
    if (t > STRIKE_DELAY + 1.0 && this.ring.parent) this.scene.remove(this.ring);
    if (t > BOMBER_OVER + 8) this.end();
  }

  end() {
    if (this.done) return;
    this.done = true;
    this.scene.remove(this.ring);
    for (const P of this.planes) this.scene.remove(P.m);
    for (const b of this.bombs) if (b.mesh) this.scene.remove(b.mesh);
  }
}


// A carpet bombing: four F-35s in echelon come in slow over the edge of the map and
// walk their bombs down a line nobody chose, the front of the blasts moving at the
// speed the server kills at. Past the far end they light the afterburners, roll into
// a 55 degree left bank and climb out of the map. A red stripe on the ground shows the
// line for the four seconds before the first bomb lands. The server does the killing;
// this only shows it.
export class CarpetShow {
  constructor(scene, fx, a, b, t0, speed, mine, groundAt) {
    this.scene = scene;
    this.fx = fx;
    this.t0 = t0;            // when the first bomb lands at a
    this.v = speed;
    this.mine = mine;
    this.done = false;
    this.a = a.clone();
    this.dir = b.clone().sub(a);
    this.L = this.dir.length();
    this.dir.normalize();
    this.h0 = Math.atan2(-this.dir.z, this.dir.x);
    this.yaw = this.h0;
    this.bank = 0;
    this.right = new THREE.Vector3(-this.dir.z, 0, this.dir.x);
    this.lead = new THREE.Vector3();
    this.tEnd = t0 + this.L / speed;             // the last bomb lands
    this.carry = speed * CARPET_FALL * 0.85;     // how far a bomb flies on after it is let go
    // the stripe: quads every few metres, each on the ground where it is
    const strip = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: '#ff3a2a', transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false });
    const edge = new THREE.MeshBasicMaterial({ color: '#ff3a2a', transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
    const step = 4;
    for (let s = 0; s < this.L; s += step) {
      const len = Math.min(step, this.L - s);
      const c = this.a.clone().addScaledVector(this.dir, s + len / 2);
      const y = groundAt ? groundAt(c.x, c.z) : 0;
      const q = new THREE.Mesh(new THREE.PlaneGeometry(len, CARPET_W * 2), mat);
      q.rotation.order = 'YXZ';
      q.rotation.set(-Math.PI / 2, this.h0, 0);
      q.position.set(c.x, y + 0.1, c.z);
      strip.add(q);
      for (const side of [-1, 1]) {
        const e = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.4), edge);
        e.rotation.order = 'YXZ';
        e.rotation.set(-Math.PI / 2, this.h0, 0);
        e.position.set(c.x + this.right.x * side * CARPET_W, y + 0.12, c.z + this.right.z * side * CARPET_W);
        strip.add(e);
      }
    }
    this.strip = strip;
    this.stripMat = mat;
    this.edgeMat = edge;
    scene.add(strip);
    // the four in a finger four: the lead, its wingman back on the left, the second
    // element's lead back on the right and that one's wingman further back and out,
    // each with its own moment to break off at the end, its own bank, rate of turn and climb
    this.planes = [[0, 0, 0.0], [-10, -16, 1.4], [-10, 16, 0.7], [-20, 32, 2.3]].map(([back, side, delay]) => {
      const m = makeJet();
      m.visible = false;
      scene.add(m);
      return { m, back, side, delay, bank: JET_BANK * (0.85 + 0.3 * Math.random()), turn: JET_TURN * (1.2 + 0.7 * Math.random()), climb: 6 + 7 * Math.random(), free: null, burn: 0 };
    });
    // every bomb, worked out now: from the first that lands at a to the last past b
    this.bombs = [];
    const tFirst = t0 - CARPET_FALL;
    for (let i = 0; i < 4; i++) {
      const P = this.planes[i];
      for (let tr = tFirst + i * (CARPET_DROP / 4) + (P.back / speed); ; tr += CARPET_DROP) {
        const sLand = (tr + CARPET_FALL - t0) * speed;
        if (sLand > this.L + 2) break;
        const lat = (P.side - 8) * 0.5 + (Math.random() - 0.5) * 5;
        const p = this.a.clone().addScaledVector(this.dir, sLand).addScaledVector(this.right, lat);
        const y = groundAt ? groundAt(p.x, p.z) : 0;
        this.bombs.push({ x: p.x, y, z: p.z, at: tr, land: tr + CARPET_FALL, from: i, mesh: null, hit: false, x0: 0, y0: 0, z0: 0, loud: this.bombs.length % 3 === 0 });
      }
    }
    this.flare = 0;
    this.roared = false;
  }

  // where a jet is at t: steady down the line at the bombing speed, ahead of the
  // blasts by the fall time, in its place in the formation; once its own moment to
  // break comes, the throttle goes up and it rolls left and climbs on its own, so the
  // four peel off one after another rather than turning as one
  placeJet(P, t, dt) {
    const tBreak = this.tEnd + P.delay;
    if (t <= tBreak || !P.free) {
      const tb = Math.min(t, tBreak);
      const s = (tb - this.t0 + CARPET_FALL) * this.v - this.carry + P.back;
      const x = this.a.x + this.dir.x * s + this.right.x * P.side, z = this.a.z + this.dir.z * s + this.right.z * P.side;
      const y = BOMBER_ALT + (P.side !== 0 ? 1.5 : 0);
      if (t > tBreak) P.free = { x, y, z, h: this.h0, t: tBreak, bk: 0 };
      else {
        P.m.position.set(x, y, z);
        P.m.rotation.order = 'YXZ';
        P.m.rotation.set(0, this.h0, 0);
        P.burn = 0;
        return;
      }
    }
    const F = P.free;
    const step = Math.min(0.1, Math.max(0, t - F.t));
    F.t = t;
    const k = Math.min(1, (t - tBreak) / 2.2);                 // the afterburner, pushed up over two seconds
    const v = this.v + (BOMBER_SPEED - this.v) * k;
    const sb = Math.max(0, Math.min(1, (t - tBreak) / 1.1));   // rolled over inside a second
    F.bk = sb * sb * (3 - 2 * sb);
    F.h += P.turn * F.bk * step;
    F.x += Math.cos(F.h) * v * step;
    F.z += -Math.sin(F.h) * v * step;
    F.y += P.climb * k * step;
    P.burn = Math.min(1, (t - tBreak) / 1.5);
    P.m.position.set(F.x, F.y, F.z);
    P.m.rotation.order = 'YXZ';
    P.m.rotation.set(-P.bank * F.bk, F.h, 0);
  }

  update(dt, clock, sfx, shake) {
    const t = clock;
    const warn = t < this.t0;
    if (this.strip.parent) {
      if (t > this.tEnd + 0.5) this.scene.remove(this.strip);
      else {
        const k = warn ? Math.max(0, Math.min(1, (t - (this.t0 - CARPET_WARN)) / CARPET_WARN)) : 1;
        this.stripMat.opacity = 0.15 + 0.15 * Math.abs(Math.sin(t * (4 + k * 10)));
        this.edgeMat.opacity = 0.5 + 0.45 * Math.abs(Math.sin(t * (4 + k * 10)));
      }
    }
    // marker smoke at the near end while the warning runs
    this.flare -= dt;
    if (this.flare <= 0 && warn) {
      this.flare = 0.15;
      const s = Math.max(0, Math.min(this.L, 6));
      this.fx.flare(this.a.clone().addScaledVector(this.dir, s), 0xff3a2a);
    }
    const inSky = t > this.t0 - CARPET_FALL - 3.0 && t < this.tEnd + 12;
    for (const P of this.planes) {
      P.m.visible = inSky;
      if (!inSky) continue;
      this.placeJet(P, t, dt);
      poseJet(P.m, clock);
      // the afterburner flame short on the run in, full once they push it up
      const f = P.m.userData.flame, c = P.m.userData.core;
      const k = 0.45 + 0.55 * P.burn;
      f.scale.x = k; c.scale.x = k;
    }
    const lead = this.planes[0];
    this.lead.copy(lead.m.position);
    this.yaw = lead.free ? lead.free.h : this.h0;
    this.bank = lead.free ? lead.bank * lead.free.bk : 0;
    this.burn = lead.burn;
    if (inSky && sfx) sfx.jetRoar(true, this.lead);
    else if (sfx) sfx.jetRoar(false);
    if (inSky && shake && this.burn > 0) shake(this.lead, 140);
    for (const b of this.bombs) {
      if (t < b.at || b.hit) continue;
      if (!b.mesh) {
        b.mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.18, 2.4, 8), new THREE.MeshLambertMaterial({ color: '#2a2d30' }));
        const J = this.planes[b.from].m.position;
        b.x0 = J.x; b.y0 = J.y - 0.6; b.z0 = J.z;
        this.scene.add(b.mesh);
        if (b.loud && sfx) sfx.bombWhistle(new THREE.Vector3(b.x, b.y, b.z), Math.max(0.2, b.land - t));
      }
      const f = Math.min(1, (t - b.at) / (b.land - b.at));
      const y = b.y + (b.y0 - b.y) * (1 - f * f);
      b.mesh.position.set(b.x0 + (b.x - b.x0) * f, y, b.z0 + (b.z - b.z0) * f);
      b.mesh.rotation.z = -(1 - f) * 1.2;
      b.mesh.rotation.y = this.h0;
      if (t >= b.land) {
        b.hit = true;
        this.scene.remove(b.mesh);
        b.mesh = null;
        const at = new THREE.Vector3(b.x, b.y, b.z);
        this.fx.explosion(at);
        if (b.loud) this.fx.bigSmoke(at);
        if (sfx && b.loud) sfx.explosion(at, 2.2);
        if (shake) shake(at, 90);
      }
    }
    if (t > this.tEnd + 12) this.end();
  }

  end() {
    if (this.done) return;
    this.done = true;
    this.scene.remove(this.strip);
    for (const P of this.planes) this.scene.remove(P.m);
    for (const b of this.bombs) if (b.mesh) this.scene.remove(b.mesh);
  }
}
