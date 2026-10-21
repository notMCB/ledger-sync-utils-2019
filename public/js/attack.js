// Attack and Defend: what the points look like. A Rush point is a bomb built like a
// server tower (a rack of screens and drives with the charge wired through it), armed
// with a hold of E; a Breakthrough point is a patch of ground or a building's floor
// that changes hands. Everything in here is drawn; the rules live on the server.

import * as THREE from 'three';

export const AD_MODES = ['rush', 'breakthrough'];
export const AD_REACH = 2.8;

const lam = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });
const bx = (parent, w, h, d, mat, x = 0, y = 0, z = 0, ry = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  parent.add(m);
  return m;
};

// -- the Rush bomb: a server tower with the charge in it ----------------------------------
export function makeTowerBomb() {
  const g = new THREE.Group();
  const dark = lam('#3a3f48', { emissive: '#14171c' });     // lit a little from within: these stand in dark rooms
  const steel = lam('#6a7078', { emissive: '#1a1d22' });
  const screenMat = new THREE.MeshBasicMaterial({ color: '#8fd4ff' });
  const screenOff = lam('#0b1218');
  const ledMat = new THREE.MeshBasicMaterial({ color: '#39ff6a' });
  const armMat = new THREE.MeshBasicMaterial({ color: '#ff2a1a' });
  const wire = lam('#c73a2a');
  const wire2 = lam('#e0c040');
  const charge = lam('#6b6f55');
  // the rack: a tall cabinet on a plinth, open at the front
  bx(g, 1.3, 0.12, 1.1, steel, 0, 0.06, 0);
  bx(g, 1.2, 2.2, 0.9, dark, 0, 1.22, -0.05);
  bx(g, 0.08, 2.2, 0.08, steel, -0.56, 1.22, 0.42);
  bx(g, 0.08, 2.2, 0.08, steel, 0.56, 1.22, 0.42);
  // the drives: rows of blades with a green light each
  const leds = [];
  for (let i = 0; i < 6; i++) {
    const y = 0.35 + i * 0.22;
    bx(g, 1.0, 0.16, 0.5, steel, 0, y, 0.2);
    const led = bx(g, 0.05, 0.05, 0.02, ledMat, -0.42 + (i % 3) * 0.08, y, 0.46);
    leds.push(led);
  }
  // two screens on top, lit, and a keyboard shelf
  const screens = [];
  for (const sx of [-0.28, 0.28]) {
    bx(g, 0.52, 0.4, 0.06, dark, sx, 1.95, 0.44);
    const s = bx(g, 0.46, 0.33, 0.01, screenMat, sx, 1.95, 0.48);
    screens.push(s);
  }
  bx(g, 1.0, 0.04, 0.3, steel, 0, 1.68, 0.5);
  // the charge: a fat olive block slotted in the middle of the rack, with the wires out of it
  bx(g, 0.8, 0.5, 0.5, charge, 0, 1.3, 0.25);
  bx(g, 0.5, 0.12, 0.08, dark, 0, 1.3, 0.52);       // a panel on it, with the arming light
  const armLight = bx(g, 0.1, 0.06, 0.02, armMat, 0.15, 1.3, 0.57);
  armLight.visible = false;
  // exposed wiring: loops of cable hanging out of the rack and over the charge
  const loop = (mat, x, y, z, r, ry) => {
    const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.018, 6, 16, Math.PI * 1.3), mat);
    t.position.set(x, y, z);
    t.rotation.set(Math.PI / 2, 0, ry);
    g.add(t);
  };
  loop(wire, -0.45, 1.55, 0.5, 0.14, 0.4);
  loop(wire2, -0.3, 1.1, 0.5, 0.1, -0.3);
  loop(wire, 0.4, 1.0, 0.5, 0.12, 1.1);
  loop(wire2, 0.35, 1.62, 0.5, 0.09, 0.9);
  for (let i = 0; i < 5; i++) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.9, 5), i % 2 ? wire : wire2);
    c.position.set(-0.5 + i * 0.25, 0.9, 0.5);
    c.rotation.z = 0.25 - i * 0.12;
    g.add(c);
  }
  // a countdown display, lit only once armed
  const timerMat = new THREE.MeshBasicMaterial({ color: '#ff5a3a' });
  const timer = bx(g, 0.36, 0.1, 0.02, timerMat, 0, 0.18, 0.56);
  timer.visible = false;
  g.userData = { leds, screens, armLight, timer, screenMat, screenOff, ledMat, armMat };
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return g;
}

// the bomb's state on its lights: idle (green drives, blue screens), armed (red light,
// screens and lights flashing faster as the time runs down), gone (blackened and leaning)
export function poseTowerBomb(mesh, state, clock, left = 0) {
  const u = mesh.userData;
  if (state === 'gone') {
    if (!u.wrecked) {
      u.wrecked = true;
      mesh.rotation.z = 0.35;
      mesh.rotation.x = -0.2;
      mesh.position.y -= 0.1;
      mesh.traverse((o) => { if (o.isMesh && o.material && o.material.color) { o.material = o.material.clone(); o.material.color.setHex(0x1a1612); if (o.material.emissive) o.material.emissive.setHex(0x000000); } });
    }
    return;
  }
  const armed = state === 'armed';
  const rate = armed ? (left < 10 ? 8 : left < 25 ? 4 : 2) : 0;
  const blink = armed ? (Math.sin(clock * rate * Math.PI) > 0) : true;
  u.armLight.visible = armed && blink;
  u.timer.visible = armed;
  for (const s of u.screens) s.material = armed && !blink ? u.screenOff : u.screenMat;
  for (const [i, l] of u.leds.entries()) l.visible = !armed || ((Math.floor(clock * 6) + i) % 2 === 0);
}

// -- a Breakthrough point: the ground that changes hands -------------------------------------
export function makeZone(zone) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
  const edge = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide });
  if (zone.k === 'circle') {
    const fill = new THREE.Mesh(new THREE.CircleGeometry(zone.r, 40), mat);
    fill.rotation.x = -Math.PI / 2;
    fill.position.y = zone.y0 + 1.06;
    g.add(fill);
    const ring = new THREE.Mesh(new THREE.RingGeometry(zone.r - 0.3, zone.r, 48), edge);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = zone.y0 + 1.08;
    g.add(ring);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(zone.r, zone.r, 2.2, 40, 1, true), mat);
    wall.position.y = zone.y0 + 2.1;
    g.add(wall);
    g.position.set(zone.x, 0, zone.z);
  } else {
    // a building's floor: the footprint as a low glowing slab, and its edges
    const h = zone.y1 - zone.y0 - 1.0;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(zone.hw * 2, 0.05, zone.hd * 2), mat);
    slab.position.y = zone.y0 + 1.05;
    g.add(slab);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(zone.hw * 2, h, zone.hd * 2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.08, depthWrite: false, side: THREE.BackSide }));
    frame.position.y = zone.y0 + 1.0 + h / 2;
    g.add(frame);
    g.position.set(zone.x, 0, zone.z);
    g.rotation.y = -zone.yaw;
  }
  g.userData = { mats: [mat, edge] };
  return g;
}

export function colourZone(mesh, hex, pulse = 0) {
  for (const m of mesh.userData.mats) m.color.setHex(hex);
  mesh.userData.mats[0].opacity = 0.14 + pulse * 0.12;
}
