// Synthesised sound: gunshots, reloads, footsteps, explosions, UI blips, and a
// quiet generative track for the menu. Nothing is loaded from files; everything
// is built from noise and oscillators. Every sound goes through one of five
// mixers (guns, footsteps, the world, music, callouts) with its own volume.

import { settings } from './settings.js';

let ctx = null;
let master = null;
let noiseBuf = null;
const cats = {};                 // guns, steps, world, music, voice
const listener = { x: 0, y: 0, z: 0, yaw: 0 };
const SPEED_OF_SOUND = 340;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  master.connect(comp);
  comp.connect(ctx.destination);
  for (const k of ['guns', 'steps', 'world', 'music', 'voice', 'chat']) {
    cats[k] = ctx.createGain();
    cats[k].connect(master);
  }
  setVolumes();
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

export function unlockAudio() {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume();
}

// the volumes from the settings: the master and each mixer
export function setVolumes() {
  if (!master) return;
  master.gain.value = settings.volume;
  cats.guns.gain.value = settings.volGuns;
  cats.steps.gain.value = settings.volSteps;
  cats.world.gain.value = settings.volWorld;
  cats.music.gain.value = settings.volMusic;
  cats.voice.gain.value = settings.volVoice;
  cats.chat.gain.value = settings.volChat === undefined ? 1 : settings.volChat;
}

export function audioState() {
  return ctx ? ctx.state : 'none';
}

// a made-up voice for the tests: a warbling tone as a microphone-like stream
export function synthVoice() {
  const c = ensure();
  if (!c) return null;
  const dest = c.createMediaStreamDestination();
  const o = c.createOscillator();
  o.type = 'sawtooth';
  o.frequency.value = 180;
  const lfo = c.createOscillator();
  lfo.frequency.value = 3;
  const lg = c.createGain();
  lg.gain.value = 60;
  lfo.connect(lg); lg.connect(o.frequency);
  const g = c.createGain();
  g.gain.value = 0.4;
  o.connect(g); g.connect(dest);
  o.start(); lfo.start();
  return dest.stream;
}

// a meter on a stream that plays nothing: for the microphone's own level
export function streamMeter(stream) {
  const c = ensure();
  if (!c) return { level: () => 0 };
  const src = c.createMediaStreamSource(stream);
  const an = c.createAnalyser();
  an.fftSize = 256;
  const buf = new Uint8Array(an.fftSize);
  src.connect(an);
  return {
    level() {
      an.getByteTimeDomainData(buf);
      let peak = 0;
      for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
      return peak / 128;
    },
  };
}

// another player's voice: a stream through a muffling filter, a pan and a volume
// that the game sets every frame from where they are
export function voiceSink(stream) {
  const c = ensure();
  if (!c) return { set() {}, close() {} };
  if (c.state === 'suspended') c.resume();
  const src = c.createMediaStreamSource(stream);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 20000;
  const pan = c.createStereoPanner ? c.createStereoPanner() : null;
  const g = c.createGain();
  g.gain.value = 0;
  const an = c.createAnalyser();
  an.fftSize = 256;
  const buf = new Uint8Array(an.fftSize);
  src.connect(lp);
  src.connect(an);
  if (pan) { lp.connect(pan); pan.connect(g); } else lp.connect(g);
  g.connect(out('chat'));
  return {
    // how loud the voice coming in is, before distance (0..1), for the tests and a meter
    level() {
      an.getByteTimeDomainData(buf);
      let peak = 0;
      for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
      return peak / 128;
    },
    set(gain, side, cutoff) {
      const t = c.currentTime;
      g.gain.setTargetAtTime(Math.max(0, gain), t, 0.05);
      if (pan) pan.pan.setTargetAtTime(side, t, 0.1);
      lp.frequency.setTargetAtTime(cutoff, t, 0.1);
    },
    close() {
      try { src.disconnect(); g.disconnect(); } catch (e) { /* gone */ }
    },
  };
}

export function setVolume() {
  setVolumes();
}

export function setListener(x, y, z, yaw) {
  listener.x = x; listener.y = y; listener.z = z; listener.yaw = yaw;
}

const out = (k) => cats[k] || master;

// distance attenuation and stereo pan for a world position (null = in your head)
function spatial(pos, range = 60) {
  const c = ctx;
  const g = c.createGain();
  let pan = null;
  if (!pos) return { input: g, output: g, gain: 1, d: 0, dy: 0 };
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
  return { input: g, output: lp, gain: vol, d, dy, pan };
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

// Each gun's voice: the crack (a bright transient), the body (a low thump), the
// mechanical clack, a tail that rings on after, and how far it carries.
//   crack: [start Hz, end Hz, seconds, level]   body: [start Hz, end Hz, seconds, level]
const GUN = {
  smg:      { crack: [3000, 900, 0.07, 0.75], body: [150, 70, 0.07, 0.45], tail: 0.22, ring: 0, mech: [4200, 0.12], range: 110 },
  pdw:      { crack: [3400, 1100, 0.06, 0.7], body: [170, 80, 0.06, 0.4], tail: 0.18, ring: 0, mech: [4600, 0.12], range: 100 },
  carbine:  { crack: [2400, 650, 0.1, 0.9], body: [125, 55, 0.11, 0.65], tail: 0.34, ring: 1900, mech: [3600, 0.14], range: 140 },
  lmg:      { crack: [1800, 450, 0.13, 0.95], body: [100, 42, 0.14, 0.8], tail: 0.42, ring: 1400, mech: [3000, 0.16], range: 150 },
  shotgun:  { crack: [1300, 180, 0.24, 1.0], body: [85, 32, 0.24, 1.0], tail: 0.7, ring: 0, mech: [2200, 0.1], range: 130 },
  sniper:   { crack: [3400, 320, 0.2, 1.0], body: [75, 28, 0.3, 1.0], tail: 1.1, ring: 2600, mech: [3200, 0.16], range: 200 },
  heavy:    { crack: [2200, 140, 0.45, 1.0], body: [50, 16, 0.7, 1.0], tail: 2.2, ring: 900, mech: [2600, 0.2], range: 480 },
  pistol:   { crack: [3100, 850, 0.07, 0.7], body: [165, 72, 0.07, 0.42], tail: 0.2, ring: 0, mech: [4400, 0.1], range: 95 },
  revolver: { crack: [2600, 560, 0.14, 0.95], body: [115, 42, 0.14, 0.8], tail: 0.5, ring: 2100, mech: [3800, 0.12], range: 150 },
  flamer:   { crack: [900, 300, 0.1, 0.3], body: [120, 60, 0.1, 0.3], tail: 0.2, ring: 0, mech: [2000, 0.05], range: 60 },
  launcher: { crack: [700, 160, 0.16, 0.7], body: [90, 40, 0.22, 1.0], tail: 0.5, ring: 0, mech: [1800, 0.12], range: 120 },
};

// a soft ring after the crack, the way a rifle's report hangs in the air
function ringTone(dest, t, freq, dur, vol) {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(dest);
  o.start(t); o.stop(t + dur + 0.02);
}

// A gunshot. Close up it is the crack, the body and the action; further off the
// crack softens and the body takes over; far away it is a dull boom that arrives
// late, at the speed of sound, from the direction it came, so distant fire can be
// placed. The big guns ring on and echo. Your own shots are shaped for the ear at
// the stock.
export function gunshot(weapon, pos, local, suppressed = false) {
  if (!ensure()) return;
  if (suppressed) return suppressedShot(weapon, pos, local);
  const g = GUN[weapon] || GUN.smg;
  const sp = spatial(pos, g.range);
  if (!sp) return;
  const d = sp.d;
  const t = ctx.currentTime + (local ? 0 : d / SPEED_OF_SOUND);
  const big = weapon === 'heavy' || weapon === 'sniper' || weapon === 'shotgun' || weapon === 'lmg';
  sp.input.gain.value = sp.gain * (local ? 0.6 : 0.85) * (weapon === 'heavy' ? 1.3 : 1);
  sp.output.connect(out('guns'));
  // near: the crack is everything; it fades with distance faster than the body does
  const nearK = local ? 1 : 1 / (1 + (d / 45) ** 2);
  const farK = local ? 0 : Math.min(1, d / 90);
  const [c0, c1, cd, cv] = g.crack;
  if (nearK > 0.02) noiseBurst(sp.input, t, cd, c0 * (0.95 + Math.random() * 0.1), c1, 0.7, cv * nearK);
  noiseBurst(sp.input, t, g.tail, 900, 120, 0.4, cv * 0.35, 'lowpass');
  const [b0, b1, bd, bv] = g.body;
  thump(sp.input, t, b0, b1, bd * (1 + farK * 0.6), bv);
  // far off: a second, duller boom rolling in behind, the report off the ground and walls
  if (farK > 0.05) {
    noiseBurst(sp.input, t + 0.03, 0.35 + farK * 0.4, 420, 90, 0.5, 0.5 * farK * (big ? 1.2 : 0.8), 'lowpass');
    thump(sp.input, t + 0.02, 70, 30, 0.5, 0.5 * farK);
  }
  if (g.ring && nearK > 0.05) ringTone(sp.input, t + 0.005, g.ring * (0.97 + Math.random() * 0.06), g.tail * 0.8, 0.09 * nearK * (local ? 0.6 : 1));
  // outdoors the big guns echo back off the town
  if (big) {
    for (const [dt, v] of [[0.13, 0.22], [0.29, 0.1]]) noiseBurst(sp.input, t + dt, 0.18, 600, 150, 0.6, cv * v, 'lowpass');
  }
  // the action cycling, for the one holding it
  if (local) click(sp.input, t + 0.012, g.mech[0], g.mech[1], 0.02);
}

// A suppressed shot: no crack at all. A short breath of gas, the bolt going back
// and forth, a faint thump. Heard within twenty-odd metres, nothing beyond it.
function suppressedShot(weapon, pos, local) {
  const g = GUN[weapon] || GUN.smg;
  const sp = spatial(pos, 28);
  if (!sp) return;
  const t = ctx.currentTime;
  const bigQ = weapon === 'sniper' || weapon === 'heavy' || weapon === 'shotgun';
  sp.input.gain.value = sp.gain * (local ? 0.42 : 0.55);
  sp.output.connect(out('guns'));
  noiseBurst(sp.input, t, bigQ ? 0.11 : 0.07, 1100, 350, 0.7, bigQ ? 0.55 : 0.4, 'lowpass');
  thump(sp.input, t, bigQ ? 110 : 150, 55, 0.06, bigQ ? 0.3 : 0.2);
  click(sp.input, t + 0.012, g.mech[0] * 0.8, 0.16, 0.018);
  if (weapon !== 'sniper' && weapon !== 'shotgun') click(sp.input, t + 0.06, g.mech[0] * 0.55, 0.1, 0.02);
}

// the knife: a short whoosh, and a wet thud when it lands
export function knifeSwing(pos) {
  if (!ensure()) return;
  const sp = spatial(pos || null, 20);
  if (!sp) return;
  sp.output.connect(out('guns'));
  noiseBurst(sp.input, ctx.currentTime, 0.14, 1800, 300, 0.5, 0.22, 'bandpass');
}

export function knifeHit(pos) {
  if (!ensure()) return;
  const sp = spatial(pos || null, 25);
  if (!sp) return;
  sp.output.connect(out('guns'));
  const t = ctx.currentTime;
  thump(sp.input, t, 220, 70, 0.09, 0.5);
  noiseBurst(sp.input, t, 0.07, 900, 200, 0.6, 0.3, 'lowpass');
}

export function dryFire() {
  if (!ensure()) return;
  const sp = spatial(null);
  sp.output.connect(out('guns'));
  click(sp.input, ctx.currentTime, 3500, 0.25, 0.025);
}

// reload noises timed to the viewmodel animation
export function reloadSound(weapon, dur, empty, pos) {
  if (!ensure()) return;
  const sp = spatial(pos || null, 25);
  if (!sp) return;
  sp.input.gain.value = pos ? sp.gain * 0.6 : 0.6;
  sp.output.connect(out('guns'));
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
  sp.output.connect(out('guns'));
  sp.input.gain.value = 0.5;
  click(sp.input, ctx.currentTime + 0.28, 1300, 0.5, 0.05);
}

export function pumpSound(delay = 0) {
  if (!ensure()) return;
  const sp = spatial(null);
  sp.output.connect(out('guns'));
  sp.input.gain.value = 0.55;
  const t = ctx.currentTime + delay;
  click(sp.input, t + 0.05, 1100, 0.5, 0.06);
  click(sp.input, t + 0.25, 1500, 0.5, 0.06);
}

export function boltSound(delay = 0) {
  if (!ensure()) return;
  const sp = spatial(null);
  sp.output.connect(out('guns'));
  sp.input.gain.value = 0.5;
  const t = ctx.currentTime + delay;
  click(sp.input, t + 0.08, 2600, 0.35, 0.03);
  click(sp.input, t + 0.3, 1400, 0.45, 0.05);
  click(sp.input, t + 0.5, 1700, 0.45, 0.05);
  click(sp.input, t + 0.62, 2800, 0.35, 0.03);
}

// Footsteps. Someone on another floor is heard through it: a dull thud with the
// top taken off, from above or below; someone on your own floor is the crisp step.
export function footstep(pos, loud = 1) {
  if (!ensure()) return;
  const sp = spatial(pos, 30);
  if (!sp) return;
  const t = ctx.currentTime;
  const dy = pos ? sp.dy : 0;
  const other = pos && Math.abs(dy) > 1.6 && sp.d < 22;
  sp.output.connect(out('steps'));
  if (other) {
    // through the floor or the ceiling
    sp.input.gain.value = sp.gain * 0.5 * loud;
    thump(sp.input, t, dy > 0 ? 95 : 70, 40, 0.09, 0.6);
    noiseBurst(sp.input, t, 0.06, 260, 120, 1.0, 0.25, 'lowpass');
    return;
  }
  sp.input.gain.value = sp.gain * 0.35 * loud;
  noiseBurst(sp.input, t, 0.07, 600 + Math.random() * 300, 200, 1.2, 0.6, 'lowpass');
  if (!pos || sp.d < 6) click(sp.input, t + 0.005, 1800 + Math.random() * 600, 0.08, 0.015);
}

export function explosion(pos, size = 1) {
  if (!ensure()) return;
  const sp = spatial(pos, 200 * size);
  if (!sp) return;
  sp.input.gain.value = sp.gain;
  sp.output.connect(out('world'));
  const t = ctx.currentTime;
  noiseBurst(sp.input, t, 1.4 * size, 1200, 60, 0.3, 1.0, 'lowpass');
  thump(sp.input, t, 90, 25, 0.9 * size, 1.0);
  noiseBurst(sp.input, t + 0.02, 0.2, 3000, 800, 0.5, 0.5);
  if (size > 1) {
    // a bomb: a deeper, longer rumble under it
    thump(sp.input, t + 0.05, 48, 18, 1.6, 1.0);
    noiseBurst(sp.input, t + 0.1, 2.6, 400, 40, 0.4, 0.8, 'lowpass');
  }
}

export function hitMarker(kill, head) {
  if (!ensure()) return;
  const sp = spatial(null);
  sp.output.connect(out('voice'));
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
  sp.output.connect(out('voice'));
  sp.input.gain.value = 0.4;
  thump(sp.input, ctx.currentTime, 180, 60, 0.15, 0.7);
}

export function beep(freq = 1800, dur = 0.08, vol = 0.3, pos = null) {
  if (!ensure()) return;
  const sp = spatial(pos, 60);
  if (!sp) return;
  sp.output.connect(out('voice'));
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
  sp.output.connect(out('steps'));
  sp.input.gain.value = 0.35;
  noiseBurst(sp.input, ctx.currentTime, 0.7, 900, 250, 0.8, 0.5, 'lowpass');
}

export function vault() {
  if (!ensure()) return;
  const sp = spatial(null);
  sp.output.connect(out('steps'));
  sp.input.gain.value = 0.4;
  const t = ctx.currentTime;
  noiseBurst(sp.input, t, 0.12, 700, 300, 1, 0.5, 'lowpass');
  noiseBurst(sp.input, t + 0.25, 0.1, 600, 250, 1, 0.6, 'lowpass');
}

export function heal() {
  if (!ensure()) return;
  const sp = spatial(null);
  sp.output.connect(out('voice'));
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
  sp.output.connect(out('world'));
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
  sp.output.connect(out('world'));
  noiseBurst(sp.input, ctx.currentTime, 0.16, 500 + Math.random() * 200, 180, 0.6, 0.5, 'lowpass');
}

// the crackle of being on fire
export function burnCrackle() {
  if (!ensure()) return;
  const t = ctx.currentTime;
  noiseBurst(out('world'), t, 0.12, 2400, 900, 1.2, 0.18, 'bandpass');
}

// a smoke grenade: a pop, then a long hiss as it pours out
export function smokePop(pos) {
  if (!ensure()) return;
  const sp = spatial(pos, 90);
  if (!sp) return;
  sp.input.gain.value = sp.gain;
  sp.output.connect(out('world'));
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
  o.connect(g); g.connect(out('voice'));
  o.start(t); o.stop(t + dur + 0.05);
}

// a steel target ringing when it's hit
// a chest lid coming up, and something picked up off the ground
export function chestOpen(pos) {
  const c = ensure();
  if (!c) return;
  const sp = spatial(pos, 30);
  if (!sp) return;
  sp.output.connect(out('world'));
  const t = c.currentTime;
  click(sp.input, t, 900, 0.5 * sp.gain, 0.03);
  noiseBurst(sp.input, t + 0.03, 0.12, 1200, 400, 1.2, 0.18 * sp.gain, 'bandpass');
  click(sp.input, t + 0.16, 500, 0.3 * sp.gain, 0.05);
}

export function pickup() {
  const c = ensure();
  if (!c) return;
  const t = c.currentTime;
  click(out('world'), t, 1400, 0.25, 0.04);
  click(out('world'), t + 0.06, 2000, 0.2, 0.05);
}

// a vest going on: straps pulled and velcro pressed
export function vestOn() {
  const c = ensure();
  if (!c) return;
  const t = c.currentTime;
  noiseBurst(out('world'), t, 0.35, 2500, 900, 0.8, 0.25, 'bandpass');
  noiseBurst(out('world'), t + 0.5, 0.25, 1800, 600, 0.8, 0.2, 'bandpass');
  click(out('world'), t + 0.9, 300, 0.35, 0.05);
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
    g.connect(out('voice'));
    o.start(t + i * 0.45);
    o.stop(t + i * 0.45 + 0.45);
  }
}

// the plane: a drone of four engines that follows it about the sky, heard from
// the ground as it comes over, the note bending down as it passes; call every frame
let plane = null;
export function planeHum(on, pos) {
  const c = ensure();
  if (!c) return;
  if (!on) {
    if (plane) { plane.g.gain.setTargetAtTime(0.0001, c.currentTime, 0.3); setTimeout(() => { try { plane.o.stop(); plane.o2.stop(); plane.o3.stop(); } catch (e) { /* done */ } }, 800); plane = null; }
    return;
  }
  if (!plane) {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 62;
    const o2 = c.createOscillator();
    o2.type = 'sawtooth';
    o2.frequency.value = 93;
    const o3 = c.createOscillator();
    o3.type = 'square';
    o3.frequency.value = 31;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 260;
    const g = c.createGain();
    g.gain.value = 0.0001;
    const g3 = c.createGain();
    g3.gain.value = 0.35;
    o.connect(f); o2.connect(f); o3.connect(g3); g3.connect(f); f.connect(g); g.connect(out('world'));
    o.start(); o2.start(); o3.start();
    plane = { o, o2, o3, g, f, lastD: null, lastT: c.currentTime };
  }
  const dx = pos.x - listener.x, dy = pos.y - listener.y, dz = pos.z - listener.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const vol = 0.5 / (1 + (d / 150) ** 1.5);
  plane.g.gain.setTargetAtTime(Math.max(0.0001, vol), c.currentTime, 0.1);
  plane.f.frequency.setTargetAtTime(110 + 500 / (1 + d / 90), c.currentTime, 0.1);
  // doppler: closing raises the note, going away drops it
  const now = c.currentTime;
  if (plane.lastD !== null && now > plane.lastT + 0.05) {
    const v = (d - plane.lastD) / (now - plane.lastT);
    const k = Math.max(0.85, Math.min(1.15, SPEED_OF_SOUND / (SPEED_OF_SOUND + v)));
    plane.o.frequency.setTargetAtTime(62 * k, now, 0.2);
    plane.o2.frequency.setTargetAtTime(93 * k, now, 0.2);
    plane.o3.frequency.setTargetAtTime(31 * k, now, 0.2);
    plane.lastD = d; plane.lastT = now;
  } else if (plane.lastD === null) { plane.lastD = d; plane.lastT = now; }
}

// a sound that follows something about the sky, heard from the ground; call it every
// frame with where the thing is, and once with on = false when it has gone
function flyer(state, on, pos, make, vol0, range) {
  if (!on && !state.cur) return null;
  const c = ensure();
  if (!c) return null;
  if (!on) {
    if (state.cur) { const s = state.cur; s.g.gain.setTargetAtTime(0.0001, c.currentTime, 0.3); setTimeout(() => { try { s.stop(); } catch (e) { /* done */ } }, 900); state.cur = null; }
    return null;
  }
  if (!state.cur) state.cur = make(c);
  const s = state.cur;
  const dx = pos.x - listener.x, dy = pos.y - listener.y, dz = pos.z - listener.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const vol = vol0 / (1 + (d / range) ** 1.5);
  s.g.gain.setTargetAtTime(Math.max(0.0001, vol), c.currentTime, 0.1);
  s.d = d;
  return s;
}

// the helicopter: the rotor's slap, four and a bit beats a second, over a turbine whine
const heli = { cur: null };
export function heliBeat(on, pos) {
  const s = flyer(heli, on, pos, (c) => {
    const src = c.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 220;
    const chop = c.createGain();
    chop.gain.value = 0.3;
    const lfo = c.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 4.3;
    const lfoG = c.createGain();
    lfoG.gain.value = 0.7;
    lfo.connect(lfoG); lfoG.connect(chop.gain);
    const whine = c.createOscillator();
    whine.type = 'sawtooth';
    whine.frequency.value = 340;
    const wf = c.createBiquadFilter();
    wf.type = 'bandpass';
    wf.frequency.value = 900;
    wf.Q.value = 2;
    const wg = c.createGain();
    wg.gain.value = 0.08;
    const g = c.createGain();
    g.gain.value = 0.0001;
    src.connect(f); f.connect(chop); chop.connect(g);
    whine.connect(wf); wf.connect(wg); wg.connect(g);
    g.connect(out('world'));
    src.start(); lfo.start(); whine.start();
    return { g, f, stop() { src.stop(); lfo.stop(); whine.stop(); } };
  }, 0.9, 120);
  if (s) s.f.frequency.setTargetAtTime(140 + 400 / (1 + s.d / 60), ctx.currentTime, 0.1);
}

// the jets: an afterburner's roar, heard from the ground. Far off it is a low thunder;
// as the pair comes over at two hundred feet it opens right up into a tearing,
// crackling scream that drops in pitch as they go away again. Loud on purpose.
const jets = { cur: null };
export function jetRoar(on, pos) {
  const s = flyer(jets, on, pos, (c) => {
    const src = c.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 120;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 400;
    f.Q.value = 0.7;
    // the afterburner's crackle: the roar chopped by a second, very slow noise
    const crk = c.createBufferSource();
    crk.buffer = noiseBuf;
    crk.loop = true;
    crk.playbackRate.value = 0.02;
    const crkF = c.createBiquadFilter();
    crkF.type = 'lowpass';
    crkF.frequency.value = 40;
    const crkG = c.createGain();
    crkG.gain.value = 0.6;
    const chop = c.createGain();
    chop.gain.value = 0.8;
    crk.connect(crkF); crkF.connect(crkG); crkG.connect(chop.gain);
    // the engine's thunder underneath, and a thin whine on top for the Doppler
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 62;
    const og = c.createGain();
    og.gain.value = 0.35;
    const w = c.createOscillator();
    w.type = 'sawtooth';
    w.frequency.value = 1900;
    const wf = c.createBiquadFilter();
    wf.type = 'bandpass';
    wf.frequency.value = 2200;
    wf.Q.value = 3;
    const wg = c.createGain();
    wg.gain.value = 0.05;
    const g = c.createGain();
    g.gain.value = 0.0001;
    src.connect(hp); hp.connect(f); f.connect(chop); chop.connect(g);
    o.connect(og); og.connect(f);
    w.connect(wf); wf.connect(wg); wg.connect(g);
    g.connect(out('world'));
    src.start(); crk.start(); o.start(); w.start();
    return { g, f, o, w, wg, lastD: null, lastT: 0, stop() { src.stop(); crk.stop(); o.stop(); w.stop(); } };
  }, 4.5, 230);
  if (!s) return;
  const now = ctx.currentTime;
  // the roar opens up as they close in: far off only the thunder gets through
  s.f.frequency.setTargetAtTime(300 + 7000 / (1 + (s.d / 90) ** 2), now, 0.15);
  // Doppler: pitch up coming at you, and down and away once they have gone past
  if (s.lastD !== null && now > s.lastT + 0.05) {
    const v = (s.d - s.lastD) / (now - s.lastT);        // metres a second, away from you
    const k = Math.max(0.55, Math.min(1.5, 1 - v / SPEED_OF_SOUND));
    s.o.frequency.setTargetAtTime(62 * k, now, 0.12);
    s.w.frequency.setTargetAtTime(1900 * k, now, 0.12);
    s.wg.gain.setTargetAtTime(0.02 + 0.08 / (1 + s.d / 120), now, 0.15);
    s.lastD = s.d; s.lastT = now;
  } else if (s.lastD === null) { s.lastD = s.d; s.lastT = now; }
}

// a bomb coming down: the whistle rises as it falls, from where it will land
export function bombWhistle(pos, secs = 2) {
  if (!ensure()) return;
  secs = Math.max(0.15, secs);     // a bomb that is all but down still gets a short one
  const sp = spatial(pos, 400);
  if (!sp) return;
  sp.input.gain.value = sp.gain;
  sp.output.connect(out('world'));
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(900, t);
  o.frequency.exponentialRampToValueAtTime(2600, t + secs);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.35, t + secs * 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, t + secs + 0.05);
  o.connect(g); g.connect(sp.input);
  o.start(t); o.stop(t + secs + 0.1);
}

// the scan's sweep: a soft radar chirp in your head
export function radarPing() {
  const c = ensure();
  if (!c) return;
  const t = c.currentTime;
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(1400, t);
  o.frequency.exponentialRampToValueAtTime(700, t + 0.35);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.14, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
  o.connect(g); g.connect(out('voice'));
  o.start(t); o.stop(t + 0.45);
}

// a scorestreak earned: a rising three-note call
export function streakReady() {
  const c = ensure();
  if (!c) return;
  const t = c.currentTime;
  [660, 880, 1320].forEach((f, i) => {
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t + i * 0.12);
    g.gain.exponentialRampToValueAtTime(0.18, t + i * 0.12 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.12 + 0.3);
    o.connect(g); g.connect(out('voice'));
    o.start(t + i * 0.12); o.stop(t + i * 0.12 + 0.35);
  });
}

// a walkie-talkie keyed: the squelch of the push-to-talk and a short tone
export function radioKey(end = false) {
  const c = ensure();
  if (!c) return;
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2100;
  bp.Q.value = 1.2;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(end ? 0.12 : 0.2, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + (end ? 0.07 : 0.11));
  src.connect(bp); bp.connect(g); g.connect(out('voice'));
  src.start(t); src.stop(t + 0.15);
  if (!end) {
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.value = 1400;
    const og = c.createGain();
    og.gain.setValueAtTime(0.0001, t + 0.09);
    og.gain.exponentialRampToValueAtTime(0.05, t + 0.1);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    o.connect(og); og.connect(out('voice'));
    o.start(t + 0.09); o.stop(t + 0.2);
  }
}

// a door swinging on dry hinges: a short creak that rises, then the latch
export function doorCreak(pos, open = true) {
  const c = ensure();
  if (!c) return;
  const sp = spatial(pos, 30);
  if (!sp) return;
  sp.input.gain.value = sp.gain * 0.8;
  sp.output.connect(out('world'));
  const t = c.currentTime;
  const o = c.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(open ? 180 : 260, t);
  o.frequency.exponentialRampToValueAtTime(open ? 340 : 200, t + 0.28);
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 900;
  f.Q.value = 3;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.12, t + 0.04);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
  o.connect(f); f.connect(g); g.connect(sp.input);
  o.start(t); o.stop(t + 0.35);
  // the latch
  const k = c.createBufferSource();
  k.buffer = noiseBuf;
  const kg = c.createGain();
  kg.gain.setValueAtTime(0.0001, t + 0.3);
  kg.gain.exponentialRampToValueAtTime(0.25, t + 0.31);
  kg.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);
  k.connect(kg); kg.connect(sp.input);
  k.start(t + 0.3); k.stop(t + 0.4);
}

// a window going: a sharp crack and a shower of glass ringing down
export function glassBreak(pos) {
  const c = ensure();
  if (!c) return;
  const sp = spatial(pos, 90);
  if (!sp) return;
  sp.input.gain.value = sp.gain;
  sp.output.connect(out('world'));
  const t = c.currentTime;
  const k = c.createBufferSource();
  k.buffer = noiseBuf;
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2500;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.6, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
  k.connect(hp); hp.connect(g); g.connect(sp.input);
  k.start(t); k.stop(t + 0.55);
  // shards tinkling: a scatter of short high tones
  for (let i = 0; i < 9; i++) {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = 2200 + Math.random() * 3500;
    const og = c.createGain();
    const at = t + 0.05 + Math.random() * 0.45;
    og.gain.setValueAtTime(0.0001, at);
    og.gain.exponentialRampToValueAtTime(0.08, at + 0.005);
    og.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
    o.connect(og); og.connect(sp.input);
    o.start(at); o.stop(at + 0.15);
  }
}

// a firework going up and bursting
export function firework(pos) {
  const c = ensure();
  if (!c) return;
  const sp = spatial(pos, 120);
  if (!sp) return;
  sp.output.connect(out('world'));
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
  noiseBurst(out('world'), t, 0.25, 1500, 300, 0.7, 0.5, 'bandpass');
  thump(out('world'), t, 120, 50, 0.2, 0.3);
}

export function ding(pos, head) {
  if (!ensure()) return;
  const sp = spatial(pos, 140);
  if (!sp) return;
  sp.input.gain.value = Math.max(0.25, sp.gain);
  sp.output.connect(out('voice'));
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

// -- music -------------------------------------------------------------------------
// A slow, quiet piece for the menu and the warm-up: a pad on a drifting chord and a
// plucked line over it, in a scale with a souk's colour. It fades out when a match
// goes live and comes back after. Nothing repeats exactly.
let music = null;
const SCALE = [0, 1, 4, 5, 7, 8, 10];                     // Phrygian dominant, on D
const CHORDS = [[0, 4, 7], [-2, 1, 5], [-4, 0, 3], [-5, -1, 2]];
const NOTE = (semi) => 146.83 * Math.pow(2, semi / 12);   // D3

function musicTick() {
  if (!music || !ctx) return;
  const t = ctx.currentTime;
  // Only queue a bar once the last one has played. If the sound can't play (not
  // allowed yet, the tab put away) or its clock has stopped while the page's
  // timers carry on (a laptop asleep with the lid shut), queuing anyway would
  // stack bar on bar and play them all at once when it wakes.
  if (ctx.state !== 'running' || document.hidden || t < music.until - 0.5) {
    music.timer = setTimeout(musicTick, 500);
    return;
  }
  music.until = t + 7.6;
  const chord = CHORDS[music.bar % CHORDS.length];
  // the pad: three soft voices sliding to the chord
  chord.forEach((semi, i) => {
    const o = music.pad[i];
    o.frequency.setTargetAtTime(NOTE(semi - 12), t, 1.2);
  });
  music.bar++;
  // the plucked line: a few notes from the scale over the bar
  const n = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    const at = t + 0.3 + Math.random() * 6.4;
    const semi = SCALE[Math.floor(Math.random() * SCALE.length)] + (Math.random() < 0.3 ? 12 : 0);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = NOTE(semi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.16, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 1.4);
    o.connect(g); g.connect(music.g);
    o.start(at); o.stop(at + 1.5);
  }
  music.timer = setTimeout(musicTick, 7600);
}

export function musicOn(on) {
  const c = ensure();
  if (!c) return;
  if (on && !music) {
    const g = c.createGain();
    g.gain.value = 0.0001;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    f.connect(g);
    g.connect(out('music'));
    const pad = [];
    for (let i = 0; i < 3; i++) {
      const o = c.createOscillator();
      o.type = i === 1 ? 'triangle' : 'sine';
      o.frequency.value = NOTE(CHORDS[0][i] - 12);
      const pg = c.createGain();
      pg.gain.value = 0.11;
      o.connect(pg); pg.connect(f);
      o.start();
      pad.push(o);
    }
    // the filter breathes
    const lfo = c.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.07;
    const lg = c.createGain();
    lg.gain.value = 350;
    lfo.connect(lg); lg.connect(f.frequency);
    lfo.start();
    music = { g, f, pad, lfo, bar: 0, timer: 0, until: 0 };
    g.gain.setTargetAtTime(1.0, c.currentTime, 2.5);
    musicTick();
  } else if (!on && music) {
    const m = music;
    music = null;
    clearTimeout(m.timer);
    m.g.gain.setTargetAtTime(0.0001, c.currentTime, 1.2);
    setTimeout(() => { try { for (const o of m.pad) o.stop(); m.lfo.stop(); } catch (e) { /* done */ } }, 5000);
  }
}
