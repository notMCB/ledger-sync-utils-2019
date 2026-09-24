// Synthesised sound: gunshots, reloads, footsteps, explosions, UI blips.
// Nothing is loaded from files; everything is built from noise and oscillators.

import { settings } from './settings.js';

let ctx = null;
let master = null;
let noiseBuf = null;
const listener = { x: 0, y: 0, z: 0, yaw: 0 };

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = settings.volume;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  master.connect(comp);
  comp.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

export function unlockAudio() {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume();
}

export function setVolume(v) {
  if (master) master.gain.value = v;
}

export function setListener(x, y, z, yaw) {
  listener.x = x; listener.y = y; listener.z = z; listener.yaw = yaw;
}

// distance attenuation and stereo pan for a world position (null = in your head)
function spatial(pos, range = 60) {
  const c = ctx;
  const g = c.createGain();
  let pan = null;
  if (!pos) return { input: g, output: g, gain: 1 };
  const dx = pos.x - listener.x, dy = pos.y - listener.y, dz = pos.z - listener.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const vol = 1 / (1 + (d / (range * 0.18)) ** 1.6);
  if (vol < 0.01) return null;
  // right vector of the listener
  const rx = Math.cos(listener.yaw), rz = -Math.sin(listener.yaw);
  const side = d > 0.01 ? (dx * rx + dz * rz) / d : 0;
  if (c.createStereoPanner) {
    pan = c.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, side * 0.85));
    g.connect(pan);
  }
  // muffle far sounds
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 18000 / (1 + d / 18);
  (pan || g).connect(lp);
  return { input: g, output: lp, gain: vol };
}

function noiseBurst(dest, t, dur, f0, f1, q, vol, type = 'bandpass') {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(dest);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}

function thump(dest, t, f0, f1, dur, vol) {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(dest);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function click(dest, t, freq, vol, dur = 0.03) {
  noiseBurst(dest, t, dur, freq, freq * 0.7, 8, vol);
}

const GUN = {
  smg:     { crack: [2600, 700, 0.09, 0.8], body: [140, 60, 0.08, 0.5], tail: 0.25 },
  lmg:     { crack: [1900, 500, 0.12, 0.9], body: [110, 45, 0.12, 0.7], tail: 0.35 },
  shotgun: { crack: [1400, 200, 0.22, 1.0], body: [90, 35, 0.2, 1.0], tail: 0.6 },
  sniper:  { crack: [3200, 300, 0.2, 1.0], body: [80, 30, 0.25, 1.0], tail: 0.9 },
  pistol:  { crack: [2900, 800, 0.08, 0.75], body: [160, 70, 0.07, 0.45], tail: 0.22 },
  heavy:   { crack: [2400, 150, 0.4, 1.0], body: [55, 18, 0.6, 1.0], tail: 1.8 },
  revolver: { crack: [2500, 600, 0.13, 0.9], body: [120, 45, 0.13, 0.75], tail: 0.45 },
  pdw:     { crack: [2800, 800, 0.08, 0.8], body: [150, 65, 0.07, 0.5], tail: 0.22 },
  carbine: { crack: [2300, 600, 0.1, 0.85], body: [130, 55, 0.1, 0.6], tail: 0.3 },
};

export function gunshot(weapon, pos, local, suppressed = false) {
  if (!ensure()) return;
  if (suppressed) return suppressedShot(weapon, pos, local);
  // the .50 carries across the whole town
  const sp = spatial(pos, weapon === 'heavy' ? 420 : weapon === 'sniper' ? 160 : 110);
  if (!sp) return;
  const g = GUN[weapon] || GUN.smg;
  const t = ctx.currentTime;
  sp.input.gain.value = sp.gain * (local ? 0.55 : 0.8) * (weapon === 'heavy' ? 1.3 : 1);
  sp.output.connect(master);
  const [c0, c1, cd, cv] = g.crack;
  noiseBurst(sp.input, t, cd, c0 * (0.95 + Math.random() * 0.1), c1, 0.7, cv);
  noiseBurst(sp.input, t, g.tail, 900, 120, 0.4, cv * 0.35, 'lowpass');
  const [b0, b1, bd, bv] = g.body;
  thump(sp.input, t, b0, b1, bd, bv);
  // mechanical clack for the shooter
  if (local) click(sp.input, t + 0.01, 4200, 0.12, 0.02);
}

// a suppressed shot: a muffled thump and the action cycling, heard much closer in
function suppressedShot(weapon, pos, local) {
  const sp = spatial(pos, 35);
  if (!sp) return;
  const t = ctx.currentTime;
  sp.input.gain.value = sp.gain * (local ? 0.5 : 0.7);
  sp.output.connect(master);
  noiseBurst(sp.input, t, 0.09, 1400, 400, 0.6, weapon === 'sniper' ? 0.7 : 0.5, 'lowpass');
  thump(sp.input, t, weapon === 'sniper' ? 120 : 170, 60, 0.07, 0.35);
  click(sp.input, t + 0.015, 3200, 0.18, 0.02);
}

// the knife: a short whoosh, and a wet thud when it lands
export function knifeSwing(pos) {
  if (!ensure()) return;
  const sp = spatial(pos || null, 20);
  if (!sp) return;
  sp.output.connect(master);
  noiseBurst(sp.input, ctx.currentTime, 0.14, 1800, 300, 0.5, 0.22, 'bandpass');
}

export function knifeHit(pos) {
  if (!ensure()) return;
  const sp = spatial(pos || null, 25);
  if (!sp) return;
  sp.output.connect(master);
  const t = ctx.currentTime;
  thump(sp.input, t, 220, 70, 0.09, 0.5);
  noiseBurst(sp.input, t, 0.07, 900, 200, 0.6, 0.3, 'lowpass');
}

export function dryFire() {
  if (!ensure()) return;
  const sp = spatial(null);
  sp.output.connect(master);
  click(sp.input, ctx.currentTime, 3500, 0.25, 0.025);
}

// reload noises timed to the viewmodel animation
export function reloadSound(weapon, dur, empty, pos) {
  if (!ensure()) return;
  const sp = spatial(pos || null, 25);
  if (!sp) return;
  sp.input.gain.value = pos ? sp.gain * 0.6 : 0.6;
  sp.output.connect(master);
  const t = ctx.currentTime;
  if (weapon === 'lmg') {
    click(sp.input, t + dur * 0.12, 2200, 0.35);
    click(sp.input, t + dur * 0.3, 1400, 0.4, 0.05);
    click(sp.input, t + dur * 0.62, 1600, 0.45, 0.05);
    click(sp.input, t + dur * 0.84, 2400, 0.4);
  } else {
    click(sp.input, t + dur * 0.2, 1800, 0.35, 0.04);
    click(sp.input, t + dur * 0.62, 1500, 0.45, 0.05);
    if (empty || weapon === 'sniper') click(sp.input, t + dur * 0.8, 2600, 0.4, 0.04);
  }
}

export function shellSound() {
  if (!ensure()) return;
  const sp = spatial(null);
  sp.output.connect(master);
  sp.input.gain.value = 0.5;
  click(sp.input, ctx.currentTime + 0.28, 1300, 0.5, 0.05);
}

export function pumpSound(delay = 0) {
  if (!ensure()) return;
  const sp = spatial(null);
  sp.output.connect(master);
  sp.input.gain.value = 0.55;
  const t = ctx.currentTime + delay;
  click(sp.input, t + 0.05, 1100, 0.5, 0.06);
  click(sp.input, t + 0.25, 1500, 0.5, 0.06);
}

export function boltSound(delay = 0) {
  if (!ensure()) return;
  const sp = spatial(null);
  sp.output.connect(master);
  sp.input.gain.value = 0.5;
  const t = ctx.currentTime + delay;
  click(sp.input, t + 0.08, 2600, 0.35, 0.03);
  click(sp.input, t + 0.3, 1400, 0.45, 0.05);
  click(sp.input, t + 0.5, 1700, 0.45, 0.05);
  click(sp.input, t + 0.62, 2800, 0.35, 0.03);
}

export function footstep(pos, loud = 1) {
  if (!ensure()) return;
  const sp = spatial(pos, 30);
  if (!sp) return;
  sp.input.gain.value = sp.gain * 0.35 * loud;
  sp.output.connect(master);
  const t = ctx.currentTime;
  noiseBurst(sp.input, t, 0.07, 600 + Math.random() * 300, 200, 1.2, 0.6, 'lowpass');
}

export function explosion(pos) {
  if (!ensure()) return;
  const sp = spatial(pos, 200);
  if (!sp) return;
  sp.input.gain.value = sp.gain;
  sp.output.connect(master);
  const t = ctx.currentTime;
  noiseBurst(sp.input, t, 1.4, 1200, 60, 0.3, 1.0, 'lowpass');
  thump(sp.input, t, 90, 25, 0.9, 1.0);
  noiseBurst(sp.input, t + 0.02, 0.2, 3000, 800, 0.5, 0.5);
}

export function hitMarker(kill, head) {
  if (!ensure()) return;
  const sp = spatial(null);
  sp.output.connect(master);
  sp.input.gain.value = 0.35;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.value = kill ? 520 : head ? 1600 : 1250;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.5, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + (kill ? 0.25 : 0.06));
  o.connect(g); g.connect(sp.input);
  o.start(t); o.stop(t + 0.3);
  if (kill) thump(sp.input, t, 300, 120, 0.2, 0.4);
}

export function hurt() {
  if (!ensure()) return;
  const sp = spatial(null);
  sp.output.connect(master);
  sp.input.gain.value = 0.4;
  thump(sp.input, ctx.currentTime, 180, 60, 0.15, 0.7);
}

export function beep(freq = 1800, dur = 0.08, vol = 0.3, pos = null) {
  if (!ensure()) return;
  const sp = spatial(pos, 60);
  if (!sp) return;
  sp.output.connect(master);
  sp.input.gain.value = pos ? sp.gain * vol : vol;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'square';
  o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.25, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(sp.input);
  o.start(t); o.stop(t + dur + 0.02);
}

export function uiBlip() {
  beep(900, 0.05, 0.15);
}

export function slide() {
  if (!ensure()) return;
  const sp = spatial(null);
  sp.output.connect(master);
  sp.input.gain.value = 0.35;
  noiseBurst(sp.input, ctx.currentTime, 0.7, 900, 250, 0.8, 0.5, 'lowpass');
}

export function vault() {
  if (!ensure()) return;
  const sp = spatial(null);
  sp.output.connect(master);
  sp.input.gain.value = 0.4;
  const t = ctx.currentTime;
  noiseBurst(sp.input, t, 0.12, 700, 300, 1, 0.5, 'lowpass');
  noiseBurst(sp.input, t + 0.25, 0.1, 600, 250, 1, 0.6, 'lowpass');
}

export function heal() {
  if (!ensure()) return;
  const sp = spatial(null);
  sp.output.connect(master);
  sp.input.gain.value = 0.3;
  const t = ctx.currentTime;
  noiseBurst(sp.input, t, 0.3, 3000, 1500, 2, 0.3);
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(520, t + 0.15);
  o.frequency.exponentialRampToValueAtTime(880, t + 0.45);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.25, t + 0.15);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
  o.connect(g); g.connect(sp.input);
  o.start(t + 0.15); o.stop(t + 0.65);
}

export function flashPop(pos) {
  if (!ensure()) return;
  const sp = spatial(pos, 140);
  if (!sp) return;
  sp.input.gain.value = sp.gain;
  sp.output.connect(master);
  const t = ctx.currentTime;
  noiseBurst(sp.input, t, 0.35, 4000, 600, 0.4, 1.0);
  thump(sp.input, t, 140, 50, 0.25, 0.7);
}

// a flamethrower's roar: a short low rush, called every tick while it fires
export function flame(pos, local) {
  if (!ensure()) return;
  const sp = spatial(pos, 60);
  if (!sp) return;
  sp.input.gain.value = sp.gain * (local ? 0.35 : 0.5);
  sp.output.connect(master);
  noiseBurst(sp.input, ctx.currentTime, 0.16, 500 + Math.random() * 200, 180, 0.6, 0.5, 'lowpass');
}

// the crackle of being on fire
export function burnCrackle() {
  if (!ensure()) return;
  const t = ctx.currentTime;
  noiseBurst(master, t, 0.12, 2400, 900, 1.2, 0.18, 'bandpass');
}

// a smoke grenade: a pop, then a long hiss as it pours out
export function smokePop(pos) {
  if (!ensure()) return;
  const sp = spatial(pos, 90);
  if (!sp) return;
  sp.input.gain.value = sp.gain;
  sp.output.connect(master);
  const t = ctx.currentTime;
  thump(sp.input, t, 160, 60, 0.12, 0.5);
  noiseBurst(sp.input, t + 0.05, 2.2, 3200, 1400, 0.6, 0.35, 'bandpass');
}

// the whine in your ears after a flash
export function flashRing(strength) {
  if (!ensure()) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.value = 3100;
  const g = ctx.createGain();
  const dur = 0.8 + strength * 3.2;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.18 * strength + 0.02, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}

// a steel target ringing when it's hit
// a chest lid coming up, and something picked up off the ground
export function chestOpen(pos) {
  const c = ensure();
  if (!c) return;
  const sp = spatial(pos, 30);
  if (!sp) return;
  sp.output.connect(master);
  const t = c.currentTime;
  click(sp.input, t, 900, 0.5 * sp.gain, 0.03);
  noiseBurst(sp.input, t + 0.03, 0.12, 1200, 400, 1.2, 0.18 * sp.gain, 'bandpass');
  click(sp.input, t + 0.16, 500, 0.3 * sp.gain, 0.05);
}

export function pickup() {
  const c = ensure();
  if (!c) return;
  const t = c.currentTime;
  click(master, t, 1400, 0.25, 0.04);
  click(master, t + 0.06, 2000, 0.2, 0.05);
}

// a vest going on: straps pulled and velcro pressed
export function vestOn() {
  const c = ensure();
  if (!c) return;
  const t = c.currentTime;
  noiseBurst(master, t, 0.35, 2500, 900, 0.8, 0.25, 'bandpass');
  noiseBurst(master, t + 0.5, 0.25, 1800, 600, 0.8, 0.2, 'bandpass');
  click(master, t + 0.9, 300, 0.35, 0.05);
}

// the gas warning: a two-tone siren
export function siren() {
  const c = ensure();
  if (!c) return;
  const t = c.currentTime;
  for (let i = 0; i < 4; i++) {
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.value = i % 2 ? 520 : 400;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t + i * 0.45);
    g.gain.exponentialRampToValueAtTime(0.12, t + i * 0.45 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.45 + 0.42);
    o.connect(g);
    g.connect(master);
    o.start(t + i * 0.45);
    o.stop(t + i * 0.45 + 0.45);
  }
}

// the plane: a drone of engines that follows it about the sky; call every frame
let plane = null;
export function planeHum(on, pos) {
  const c = ensure();
  if (!c) return;
  if (!on) {
    if (plane) { plane.g.gain.setTargetAtTime(0.0001, c.currentTime, 0.3); setTimeout(() => { try { plane.o.stop(); plane.o2.stop(); } catch (e) { /* done */ } }, 800); plane = null; }
    return;
  }
  if (!plane) {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 62;
    const o2 = c.createOscillator();
    o2.type = 'sawtooth';
    o2.frequency.value = 93;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 260;
    const g = c.createGain();
    g.gain.value = 0.0001;
    o.connect(f); o2.connect(f); f.connect(g); g.connect(master);
    o.start(); o2.start();
    plane = { o, o2, g, f };
  }
  const dx = pos.x - listener.x, dy = pos.y - listener.y, dz = pos.z - listener.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const vol = 0.22 / (1 + (d / 60) ** 1.4);
  plane.g.gain.setTargetAtTime(Math.max(0.0001, vol), c.currentTime, 0.1);
  plane.f.frequency.setTargetAtTime(160 + 400 / (1 + d / 40), c.currentTime, 0.1);
}

// a firework going up and bursting
export function firework(pos) {
  const c = ensure();
  if (!c) return;
  const sp = spatial(pos, 120);
  if (!sp) return;
  sp.output.connect(master);
  const t = c.currentTime;
  thump(sp.input, t, 160, 40, 0.4, 0.5 * sp.gain);
  noiseBurst(sp.input, t, 0.5, 3000, 300, 0.6, 0.35 * sp.gain, 'bandpass');
  for (let i = 0; i < 6; i++) click(sp.input, t + 0.1 + Math.random() * 0.5, 1200 + Math.random() * 2000, 0.12 * sp.gain, 0.03);
}

// the parachute snapping open
export function chutePop() {
  const c = ensure();
  if (!c) return;
  const t = c.currentTime;
  noiseBurst(master, t, 0.25, 1500, 300, 0.7, 0.5, 'bandpass');
  thump(master, t, 120, 50, 0.2, 0.3);
}

export function ding(pos, head) {
  if (!ensure()) return;
  const sp = spatial(pos, 140);
  if (!sp) return;
  sp.input.gain.value = Math.max(0.25, sp.gain);
  sp.output.connect(master);
  const t = ctx.currentTime;
  for (const [f, v] of [[head ? 2400 : 1700, 0.3], [head ? 3900 : 2750, 0.12]]) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g); g.connect(sp.input);
    o.start(t); o.stop(t + 0.65);
  }
}
