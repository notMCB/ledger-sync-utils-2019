// Scorestreaks: what you see in the sky when someone calls one in. The scan is
// all HUD; the helicopter is a Blackhawk-style gunship circling the town with a
// Gatling in its left door; the airstrike is three B-1s in formation at two
// thousand feet, and the bombs they drop. The helicopter's circuit is worked out
// here from the same sums the server uses (heli_path in server/server.py), so
// everyone sees it in the same place at the same time.

import * as THREE from 'three';
import { addGatling } from './world.js';

// keep every number in step with server/server.py
export const STREAKS = [
  { k: 'scan', n: 2, name: 'Scan beacon', bind: 'streak1', what: 'Every enemy marked on the map for 30 seconds' },
  { k: 'strike', n: 5, name: 'Airstrike', bind: 'streak2', what: 'Pick a spot from above: three bombers flatten it five seconds later' },
  { k: 'heli', n: 8, name: 'Helicopter gunner', bind: 'streak3', what: '45 seconds on the door gun of a helicopter over the town' },
];
export const HELI_FLAG = 2097152;
export const HELI_ALT = 30, HELI_MARGIN = 12, HELI_CORNER = 22, HELI_SPEED = 22;
export const HELI_SEAT = { left: 1.05, down: -1.0, back: 0.2 };   // the gunner's feet, from the hub
export const HELI_HEAT = 7.0;         // seconds of fire before the gun overheats
export const HELI_COOL = 4.0;         // seconds to cool right down after that
export const STRIKE_R = 7.5, STRIKE_KILL_R = 5.0, STRIKE_DELAY = 5;
export const BOMBER_ALT = 600;        // two thousand feet
export const BOMBER_SPEED = 120;
export const BOMBER_OVER = 3.0;       // seconds after the call the formation is over the target
export const BOMB_FALL = 2.0;         // and the bombs take this long to come down

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

// -- the bombers ----------------------------------------------------------------------

// A B-2: a flying wing, nothing else. A broad arrowhead with the sawtooth trailing
// edge, a low hump in the middle for the crew and the engines, no fin or tail at all.
// Local +x is forward. Seen from two thousand feet below it is a dark shape, so the
// outline is what matters: fifty-odd metres across, twenty from nose to the notch.
export function makeBomber() {
  const g = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: '#050506', side: THREE.DoubleSide });     // black, as they are
  // the wing's outline in the x (forward) / z (span) plane, drawn as a flat shape
  const half = 26, nose = 11, tail = -9, notch = -4, mid = -6;
  const pts = [
    [nose, 0], [tail + 3, half], [tail + 1, half],                           // nose to the wingtip
    [mid, half * 0.72], [tail, half * 0.5], [notch, half * 0.26], [tail, 0],  // the sawtooth back edge
    [notch, -half * 0.26], [tail, -half * 0.5], [mid, -half * 0.72], [tail + 1, -half], [tail + 3, -half],
  ];
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.9, bevelEnabled: false });
  const wing = new THREE.Mesh(geo, skin);
  wing.rotation.x = Math.PI / 2;        // the shape's y becomes world z (the span); depth goes down
  wing.position.y = 0.45;
  g.add(wing);
  // the hump: the crew compartment up front, the engine bays either side of it
  const hump = new THREE.Mesh(new THREE.SphereGeometry(4.2, 12, 8), skin);
  hump.scale.set(1.6, 0.42, 1.0);
  hump.position.set(1.5, 0.7, 0);
  g.add(hump);
  for (const side of [-1, 1]) {
    const bay = new THREE.Mesh(new THREE.SphereGeometry(3.2, 10, 6), skin);
    bay.scale.set(1.8, 0.32, 1.1);
    bay.position.set(-1.5, 0.75, side * 7.5);
    g.add(bay);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return g;
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

// An airstrike from the call to the last bomb: the formation crosses the town at two
// thousand feet, over the target eight seconds in, the bombs come down two seconds
// later and the ring on the ground burns red the whole time. The server lands the
// damage at ten seconds; this only shows it.
export class StrikeShow {
  constructor(scene, fx, target, t0, heading, mine) {
    this.scene = scene;
    this.fx = fx;
    this.p = target.clone();
    this.t0 = t0;
    this.mine = mine;
    this.done = false;
    this.dir = new THREE.Vector3(Math.cos(heading), 0, -Math.sin(heading));
    this.yaw = heading;
    this.ring = makeStrikeRing();
    this.ring.position.copy(this.p).add(new THREE.Vector3(0, 0.08, 0));
    scene.add(this.ring);
    // lead, and one back on each side: a vic the width of a street
    this.planes = [[0, 0], [-40, -50], [-40, 50]].map(([back, side]) => {
      const m = makeBomber();
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
      const at = BOMBER_OVER - 0.4 + i * 0.12;     // released in a stick as the lead passes over
      const land = STRIKE_DELAY + (i / n) * 0.9;
      this.bombs.push({ x: this.p.x + Math.cos(a) * r, z: this.p.z + Math.sin(a) * r, at, land, mesh: null, hit: false });
    }
    this.whistled = false;
    this.flare = 0;
  }

  // the formation's lead at time t after the call (out now = it is still in the sky)
  leadAt(t, out) {
    const d = (t - BOMBER_OVER) * BOMBER_SPEED;
    return out.set(this.p.x + this.dir.x * d, BOMBER_ALT, this.p.z + this.dir.z * d);
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
    // the planes: in sight almost at once, gone a few seconds after the bombs
    const inSky = t > 0.3 && t < BOMBER_OVER + 7;
    this.leadAt(t, this.lead);
    for (const P of this.planes) {
      P.m.visible = inSky;
      if (!inSky) continue;
      const rx = Math.sin(this.yaw), rz = Math.cos(this.yaw);    // right of the heading
      P.m.position.set(this.lead.x + this.dir.x * P.back + rx * P.side, BOMBER_ALT + (P.side ? 6 : 0), this.lead.z + this.dir.z * P.back + rz * P.side);
      P.m.rotation.set(0, this.yaw, 0);
    }
    if (inSky && sfx) sfx.jetRoar(true, this.lead);
    else if (sfx) sfx.jetRoar(false);
    // the bombs: dropped from the lead as it passes over, down in two seconds
    for (const b of this.bombs) {
      if (t < b.at || b.hit) continue;
      if (!b.mesh) {
        b.mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.18, 2.4, 8), new THREE.MeshLambertMaterial({ color: '#2a2d30' }));
        this.scene.add(b.mesh);
        if (!this.whistled && sfx) { this.whistled = true; sfx.bombWhistle(this.p, b.land - t); }
      }
      const f = Math.min(1, (t - b.at) / (b.land - b.at));
      const y = this.p.y + (BOMBER_ALT - this.p.y) * (1 - f * f);     // faster and faster, like something falling
      b.mesh.position.set(b.x, y, b.z);
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
