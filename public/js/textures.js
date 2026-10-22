// Procedural textures drawn on canvases, so the game ships no image files.

import * as THREE from 'three';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

function tex(c, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function speckle(g, size, r, n, colors, min = 1, max = 3) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[Math.floor(r() * colors.length)];
    const s = min + r() * (max - min);
    g.fillRect(r() * size, r() * size, s, s);
  }
}

// -- noise, for ground that reads as ground rather than a stipple -------------------

// tileable value noise: an n by n lattice of random values, smoothly interpolated
// across an S by S field, wrapping at the edges
function valueNoise(S, n, r, out, amp) {
  const lat = new Float32Array(n * n);
  for (let i = 0; i < lat.length; i++) lat[i] = r();
  const k = n / S;
  for (let y = 0; y < S; y++) {
    const fy = y * k, iy = Math.floor(fy), ty0 = fy - iy, ty = ty0 * ty0 * (3 - 2 * ty0);
    const y0 = iy % n, y1 = (iy + 1) % n;
    for (let x = 0; x < S; x++) {
      const fx = x * k, ix = Math.floor(fx), tx0 = fx - ix, tx = tx0 * tx0 * (3 - 2 * tx0);
      const x0 = ix % n, x1 = (ix + 1) % n;
      const a = lat[y0 * n + x0], b = lat[y0 * n + x1], c = lat[y1 * n + x0], d = lat[y1 * n + x1];
      out[y * S + x] += amp * ((a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty);
    }
  }
}

// layered noise in [0, 1]: `base` cells across the tile at the coarsest layer
function fbm(S, r, base = 4, octaves = 5, gain = 0.5) {
  const out = new Float32Array(S * S);
  let amp = 1, total = 0, n = base;
  for (let o = 0; o < octaves; o++) {
    valueNoise(S, n, r, out, amp);
    total += amp;
    amp *= gain;
    n *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

// a normal map from a height field, wrapping, `strength` scaling the slopes
function normalMap(S, h, strength = 2) {
  const [c, g] = canvas(S);
  const img = g.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    const yu = (y + S - 1) % S, yd = (y + 1) % S;
    for (let x = 0; x < S; x++) {
      const xl = (x + S - 1) % S, xr = (x + 1) % S;
      const dx = (h[y * S + xr] - h[y * S + xl]) * strength;
      const dy = (h[yd * S + x] - h[yu * S + x]) * strength;
      const L = Math.hypot(dx, dy, 1);
      const i = (y * S + x) * 4;
      d[i] = (-dx / L * 0.5 + 0.5) * 255;
      d[i + 1] = (-dy / L * 0.5 + 0.5) * 255;
      d[i + 2] = (1 / L * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const mix = (a, b, t) => a + (b - a) * t;

// paint a colour field: fn(i, x, y) returns [r, g, b] for the pixel
function paint(g, S, fn) {
  const img = g.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const [r, gg, b] = fn(i, x, y);
      d[i * 4] = clamp255(r); d[i * 4 + 1] = clamp255(gg); d[i * 4 + 2] = clamp255(b); d[i * 4 + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

// dry sand: dunes of tone, wind ripples, damp patches, pebbles and the odd stone.
// Returns the colour and the normal map; nine metres to the tile
export function groundSet() {
  const S = 1024;
  const [c, g] = canvas(S);
  const r = rng(3);
  const tone = fbm(S, r, 3, 4, 0.55), fine = fbm(S, r, 24, 4, 0.5), damp = fbm(S, r, 5, 3, 0.5), rip = fbm(S, r, 6, 2, 0.5);
  const h = new Float32Array(S * S);
  paint(g, S, (i, x, y) => {
    // wind ripples: a wave running across the tile, bent by the noise
    const w = Math.sin((x * 0.9 + y * 0.35) * (Math.PI * 2 / 48) + rip[i] * 6) * 0.5 + 0.5;
    const t = tone[i], f = fine[i], d = Math.max(0, damp[i] - 0.58) * 2.5;
    const base = [mix(205, 232, t), mix(168, 196, t), mix(118, 150, t)];
    const k = 1 + (f - 0.5) * 0.22 + (w - 0.5) * 0.08 - d * 0.22;
    h[i] = w * 0.5 + f * 0.5;
    return [base[0] * k, base[1] * k, base[2] * k];
  });
  // pebbles and small stones, each with a shadowed side
  for (let i = 0; i < 1400; i++) {
    const x = r() * S, y = r() * S, rad = 1.5 + r() * 3.5, dark = r() < 0.6;
    g.fillStyle = dark ? `rgba(${110 + r() * 40},${90 + r() * 30},${60 + r() * 25},0.75)` : `rgba(${225 + r() * 25},${210 + r() * 25},${180 + r() * 25},0.7)`;
    g.beginPath(); g.ellipse(x, y, rad, rad * 0.7, r() * 3, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(70,55,35,0.35)';
    g.beginPath(); g.ellipse(x + rad * 0.3, y + rad * 0.4, rad * 0.9, rad * 0.5, 0, 0, Math.PI * 2); g.fill();
  }
  speckle(g, S, r, 20000, ['rgba(110,85,50,0.25)', 'rgba(250,235,200,0.25)'], 1, 2);
  return { map: tex(c), normalMap: normalMap(S, h, 3.5) };
}
export function ground() { return groundSet().map; }

// a lawn: a carpet of fine blades in two greens, worn and yellow in patches, with
// faint mowing stripes
export function grassSet() {
  const S = 1024;
  const [c, g] = canvas(S);
  const r = rng(77);
  const tone = fbm(S, r, 3, 4, 0.55), fine = fbm(S, r, 40, 3, 0.5), worn = fbm(S, r, 4, 3, 0.5);
  const h = new Float32Array(S * S);
  paint(g, S, (i, x, y) => {
    const t = tone[i], f = fine[i], wn = Math.max(0, worn[i] - 0.6) * 2.2;
    const stripe = Math.sin(y * (Math.PI * 2 / 128)) > 0 ? 1.0 : 0.93;
    const gr = [mix(86, 120, t), mix(140, 176, t), mix(52, 70, t)];
    const dry = [160, 148, 72];
    const k = (0.82 + f * 0.36) * stripe;
    h[i] = f;
    return [mix(gr[0], dry[0], wn) * k, mix(gr[1], dry[1], wn) * k, mix(gr[2], dry[2], wn) * k];
  });
  // blades: short strokes leaning every way
  g.lineWidth = 1;
  for (let i = 0; i < 26000; i++) {
    const x = r() * S, y = r() * S, L = 3 + r() * 5, a = -Math.PI / 2 + (r() - 0.5) * 1.2;
    g.strokeStyle = r() < 0.5 ? 'rgba(60,110,40,0.35)' : 'rgba(150,200,90,0.3)';
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke();
  }
  return { map: tex(c), normalMap: normalMap(S, h, 2.2) };
}
export function grass() { return grassSet().map; }

// packed snow: soft drifts, a blue cast in the hollows, wind-scoured crust and a sparkle
export function snowSet() {
  const S = 1024;
  const [c, g] = canvas(S);
  const r = rng(43);
  const drift = fbm(S, r, 3, 4, 0.5), fine = fbm(S, r, 20, 4, 0.5), crust = fbm(S, r, 8, 2, 0.5);
  const h = new Float32Array(S * S);
  paint(g, S, (i, x, y) => {
    const d = drift[i], f = fine[i];
    const scour = Math.sin((x * 0.7 + y * 0.7) * (Math.PI * 2 / 90) + crust[i] * 5) * 0.5 + 0.5;
    h[i] = d * 0.6 + f * 0.3 + scour * 0.1;
    const hollow = 1 - d;
    const k = 0.9 + f * 0.12 + scour * 0.04;
    return [mix(244, 214, hollow * 0.6) * k, mix(247, 226, hollow * 0.6) * k, mix(251, 240, hollow * 0.6) * k];
  });
  speckle(g, S, r, 14000, ['rgba(255,255,255,0.7)', 'rgba(190,205,225,0.25)'], 1, 2);
  return { map: tex(c), normalMap: normalMap(S, h, 4.0) };
}
export function snow() { return snowSet().map; }

// poured concrete: aggregate showing through, stains, hairline cracks and a joint
// round the slab
export function concreteSet() {
  const S = 512;
  const [c, g] = canvas(S);
  const r = rng(41);
  const tone = fbm(S, r, 2, 4, 0.55), fine = fbm(S, r, 16, 4, 0.5), stain = fbm(S, r, 3, 3, 0.5);
  const h = new Float32Array(S * S);
  paint(g, S, (i) => {
    const t = tone[i], f = fine[i], st = Math.max(0, stain[i] - 0.62) * 2.5;
    const k = (0.86 + f * 0.26) * (1 - st * 0.18) * (0.94 + t * 0.12);
    h[i] = f;
    return [181 * k, 180 * k, 174 * k];
  });
  speckle(g, S, r, 9000, ['rgba(60,60,58,0.3)', 'rgba(225,225,220,0.3)'], 1, 2);
  g.strokeStyle = 'rgba(50,50,48,0.5)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, S - 2, S - 2);
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    let x = r() * S, y = r() * S;
    g.moveTo(x, y);
    for (let k = 0; k < 7; k++) { x += (r() - 0.5) * 50; y += (r() - 0.5) * 50; g.lineTo(x, y); }
    g.strokeStyle = 'rgba(40,40,38,0.4)';
    g.lineWidth = 1;
    g.stroke();
  }
  return { map: tex(c), normalMap: normalMap(S, h, 1.6) };
}
export function concrete() { return concreteSet().map; }

// light plaster, tinted per building through vertex colours
export function plaster() {
  const S = 256;
  const [c, g] = canvas(S);
  const r = rng(7);
  g.fillStyle = '#e9dcc3';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 60; i++) {
    const x = r() * S, y = r() * S, rad = 10 + r() * 40;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    const a = 0.04 + r() * 0.08;
    grd.addColorStop(0, r() < 0.5 ? `rgba(160,130,90,${a})` : `rgba(255,250,235,${a})`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  speckle(g, S, r, 1800, ['rgba(120,95,60,0.18)', 'rgba(255,255,255,0.25)', 'rgba(90,70,45,0.12)'], 1, 2);
  // hairline cracks
  g.strokeStyle = 'rgba(110,85,55,0.25)';
  g.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    let x = r() * S, y = r() * S;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += (r() - 0.5) * 24;
      y += r() * 14;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  return tex(c);
}

export function stone() {
  const S = 256;
  const [c, g] = canvas(S);
  const r = rng(11);
  g.fillStyle = '#b89c74';
  g.fillRect(0, 0, S, S);
  const rows = 8;
  const h = S / rows;
  for (let y = 0; y < rows; y++) {
    let x = y % 2 ? -h * 0.7 : 0;
    while (x < S) {
      const w = h * (1.2 + r() * 1.2);
      const l = 62 + r() * 18;
      g.fillStyle = `hsl(${32 + r() * 8}, ${28 + r() * 14}%, ${l}%)`;
      g.fillRect(x + 2, y * h + 2, w - 4, h - 4);
      x += w;
    }
  }
  speckle(g, S, r, 1500, ['rgba(80,60,40,0.2)', 'rgba(255,245,225,0.2)'], 1, 2);
  return tex(c);
}



// white marble with grey veins
export function marble() {
  const S = 256;
  const [c, g] = canvas(S);
  const r = rng(91);
  g.fillStyle = '#eef0ee';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 26; i++) {
    g.strokeStyle = `rgba(120,125,135,${0.12 + r() * 0.2})`;
    g.lineWidth = 0.6 + r() * 1.6;
    g.beginPath();
    let x = r() * S, y = r() * S;
    g.moveTo(x, y);
    for (let k = 0; k < 8; k++) {
      x += (r() - 0.5) * 70;
      y += (r() - 0.5) * 70;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  speckle(g, S, r, 1500, ['rgba(200,205,210,0.4)', 'rgba(255,255,255,0.5)'], 1, 2);
  return tex(c);
}

// a clipped hedge: dense dark leaves
export function hedge() {
  const S = 256;
  const [c, g] = canvas(S);
  const r = rng(83);
  g.fillStyle = '#2f5e2a';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const x = r() * S, y = r() * S, rad = 2 + r() * 5;
    g.fillStyle = r() < 0.5 ? `rgba(${40 + r() * 40},${100 + r() * 50},${30 + r() * 30},0.8)` : `rgba(${20 + r() * 20},${60 + r() * 30},${20 + r() * 20},0.8)`;
    g.beginPath();
    g.ellipse(x, y, rad, rad * 0.7, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  return tex(c);
}



// corrugated steel: vertical ribs, tinted per piece through vertex colours
export function corrugated() {
  const S = 128;
  const [c, g] = canvas(S);
  const r = rng(47);
  g.fillStyle = '#b4b8bc';
  g.fillRect(0, 0, S, S);
  for (let x = 0; x < S; x += 8) {
    const grd = g.createLinearGradient(x, 0, x + 8, 0);
    grd.addColorStop(0, 'rgba(255,255,255,0.22)');
    grd.addColorStop(0.5, 'rgba(0,0,0,0.02)');
    grd.addColorStop(1, 'rgba(0,0,0,0.3)');
    g.fillStyle = grd;
    g.fillRect(x, 0, 8, S);
  }
  speckle(g, S, r, 500, ['rgba(120,70,40,0.3)', 'rgba(60,60,60,0.25)'], 1, 3);
  return tex(c);
}

// a shipping container's side: deep ribs every 40 cm or so, weathered paint
export function containerSkin() {
  const S = 256;
  const [c, g] = canvas(S);
  const r = rng(71);
  g.fillStyle = '#b9bcbf';
  g.fillRect(0, 0, S, S);
  const rib = 32;
  for (let x = 0; x < S; x += rib) {
    const grd = g.createLinearGradient(x, 0, x + rib, 0);
    grd.addColorStop(0, 'rgba(0,0,0,0.38)');
    grd.addColorStop(0.18, 'rgba(255,255,255,0.18)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.05)');
    grd.addColorStop(0.82, 'rgba(0,0,0,0.12)');
    grd.addColorStop(1, 'rgba(0,0,0,0.42)');
    g.fillStyle = grd;
    g.fillRect(x, 0, rib, S);
  }
  for (let i = 0; i < 26; i++) {
    const x = r() * S, y = r() * S, rad = 6 + r() * 26;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, r() < 0.6 ? 'rgba(110,60,30,0.28)' : 'rgba(40,40,40,0.2)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  speckle(g, S, r, 900, ['rgba(120,70,40,0.35)', 'rgba(255,255,255,0.15)'], 1, 2);
  return tex(c);
}

// grey mountain rock
export function rock() {
  const S = 256;
  const [c, g] = canvas(S);
  const r = rng(53);
  g.fillStyle = '#767470';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 70; i++) {
    const x = r() * S, y = r() * S, rad = 12 + r() * 50;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, r() < 0.5 ? 'rgba(40,40,38,0.3)' : 'rgba(170,165,155,0.25)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  speckle(g, S, r, 4000, ['rgba(30,30,28,0.35)', 'rgba(200,195,185,0.2)'], 1, 3);
  return tex(c);
}

// zellige-ish floor tiles for interiors
export function tiles() {
  const S = 256;
  const [c, g] = canvas(S);
  const r = rng(5);
  const n = 8;
  const t = S / n;
  const pal = ['#d8c7a4', '#cdb893', '#e2d4b5', '#2f7f7a', '#c5a77a', '#d9cbaa'];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const k = (x + y) % 4 === 0 && r() < 0.6 ? 3 : Math.floor(r() * pal.length);
      g.fillStyle = k === 3 ? pal[3] : pal[k === 3 ? 0 : k];
      g.fillRect(x * t + 1, y * t + 1, t - 2, t - 2);
    }
  }
  g.strokeStyle = 'rgba(90,70,45,0.5)';
  g.lineWidth = 2;
  for (let i = 0; i <= n; i++) {
    g.beginPath(); g.moveTo(i * t, 0); g.lineTo(i * t, S); g.stroke();
    g.beginPath(); g.moveTo(0, i * t); g.lineTo(S, i * t); g.stroke();
  }
  speckle(g, S, r, 1200, ['rgba(60,45,30,0.15)', 'rgba(255,255,255,0.12)'], 1, 2);
  return tex(c);
}

export function wood() {
  const S = 256;
  const [c, g] = canvas(S);
  const r = rng(9);
  g.fillStyle = '#8a6036';
  g.fillRect(0, 0, S, S);
  const planks = 5;
  const ph = S / planks;
  for (let i = 0; i < planks; i++) {
    g.fillStyle = `hsl(${26 + r() * 8}, ${40 + r() * 15}%, ${30 + r() * 12}%)`;
    g.fillRect(0, i * ph + 2, S, ph - 4);
    g.strokeStyle = 'rgba(40,25,10,0.35)';
    for (let k = 0; k < 7; k++) {
      g.beginPath();
      const y = i * ph + 4 + r() * (ph - 8);
      g.moveTo(0, y);
      g.bezierCurveTo(S * 0.3, y + (r() - 0.5) * 6, S * 0.6, y + (r() - 0.5) * 6, S, y);
      g.stroke();
    }
  }
  g.fillStyle = 'rgba(30,20,10,0.6)';
  g.fillRect(0, 0, S, 4);
  g.fillRect(0, S - 4, S, 4);
  g.fillRect(0, 0, 4, S);
  g.fillRect(S - 4, 0, 4, S);
  return tex(c);
}

export function crate() {
  const S = 256;
  const [c, g] = canvas(S);
  const r = rng(13);
  g.fillStyle = '#9a7244';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 6; i++) {
    g.fillStyle = `hsl(${30 + r() * 6}, ${38 + r() * 12}%, ${34 + r() * 10}%)`;
    g.fillRect(0, i * (S / 6) + 1, S, S / 6 - 2);
  }
  g.strokeStyle = '#5a3d1f';
  g.lineWidth = 18;
  g.strokeRect(9, 9, S - 18, S - 18);
  g.lineWidth = 14;
  g.beginPath();
  g.moveTo(14, 14); g.lineTo(S - 14, S - 14);
  g.stroke();
  speckle(g, S, r, 600, ['rgba(30,20,10,0.25)'], 1, 2);
  return tex(c, false);
}

export function metal() {
  const S = 128;
  const [c, g] = canvas(S);
  const r = rng(17);
  g.fillStyle = '#9aa0a2';
  g.fillRect(0, 0, S, S);
  speckle(g, S, r, 900, ['rgba(120,70,40,0.35)', 'rgba(60,60,60,0.3)', 'rgba(200,200,200,0.2)'], 1, 3);
  return tex(c);
}

export function cloth(color) {
  const S = 128;
  const [c, g] = canvas(S);
  g.fillStyle = color;
  g.fillRect(0, 0, S, S);
  g.fillStyle = 'rgba(255,255,255,0.22)';
  for (let i = 0; i < 8; i += 2) g.fillRect(i * (S / 8), 0, S / 8, S);
  g.fillStyle = 'rgba(0,0,0,0.12)';
  for (let y = 0; y < S; y += 3) g.fillRect(0, y, S, 1);
  return tex(c);
}

// a leafy sprig for hedges and bushes: a cluster of small leaves on a cut-out
export function leafTuft() {
  const S = 128;
  const [c, g] = canvas(S);
  g.clearRect(0, 0, S, S);
  const r = rng(91);
  for (let i = 0; i < 26; i++) {
    const x = 20 + r() * 88, y = 14 + r() * 100, w = 7 + r() * 9, h = 4 + r() * 5;
    g.fillStyle = r() < 0.5 ? '#3d7a34' : r() < 0.5 ? '#5a9a44' : '#2f6228';
    g.beginPath();
    g.ellipse(x, y, w, h, r() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  return tex(c, false);
}

// a tuft of grass: a fan of blades on a cut-out
export function grassTuft() {
  const S = 128;
  const [c, g] = canvas(S);
  g.clearRect(0, 0, S, S);
  const r = rng(97);
  for (let i = 0; i < 22; i++) {
    const x0 = 24 + r() * 80, lean = (r() - 0.5) * 60, h = 50 + r() * 70;
    g.strokeStyle = r() < 0.5 ? '#7fae46' : r() < 0.5 ? '#5f8f35' : '#9cc45a';
    g.lineWidth = 2 + r() * 2.5;
    g.beginPath();
    g.moveTo(x0, S);
    g.quadraticCurveTo(x0 + lean * 0.3, S - h * 0.6, x0 + lean, S - h);
    g.stroke();
  }
  return tex(c, false);
}

export function palmLeaf() {
  const S = 128;
  const [c, g] = canvas(S);
  g.clearRect(0, 0, S, S);
  g.strokeStyle = '#4d6b2a';
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, S / 2); g.lineTo(S, S / 2); g.stroke();
  for (let i = 4; i < S; i += 5) {
    const l = 40 * Math.sin((i / S) * Math.PI) + 6;
    g.strokeStyle = i % 2 ? '#5f8233' : '#46652a';
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(i, S / 2); g.lineTo(i + 8, S / 2 - l); g.stroke();
    g.beginPath(); g.moveTo(i, S / 2); g.lineTo(i + 8, S / 2 + l); g.stroke();
  }
  const t = tex(c, false);
  return t;
}

export function softDot(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const S = 64;
  const [c, g] = canvas(S);
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function flashTex() {
  const S = 128;
  const [c, g] = canvas(S);
  g.translate(S / 2, S / 2);
  const grd = g.createRadialGradient(0, 0, 0, 0, 0, S / 2);
  grd.addColorStop(0, 'rgba(255,255,230,1)');
  grd.addColorStop(0.25, 'rgba(255,210,110,0.95)');
  grd.addColorStop(0.6, 'rgba(255,140,40,0.35)');
  grd.addColorStop(1, 'rgba(255,100,20,0)');
  g.fillStyle = grd;
  for (let i = 0; i < 7; i++) {
    g.rotate((Math.PI * 2) / 7);
    g.beginPath();
    g.moveTo(-6, 0);
    g.lineTo(0, -S / 2);
    g.lineTo(6, 0);
    g.fill();
  }
  g.beginPath();
  g.arc(0, 0, S / 4, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function holeTex() {
  const S = 64;
  const [c, g] = canvas(S);
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(20,14,8,1)');
  grd.addColorStop(0.3, 'rgba(40,30,20,0.9)');
  grd.addColorStop(0.55, 'rgba(90,70,50,0.35)');
  grd.addColorStop(1, 'rgba(90,70,50,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function siteDecal(label, color) {
  const S = 512;
  const [c, g] = canvas(S);
  g.clearRect(0, 0, S, S);
  g.strokeStyle = color;
  g.lineWidth = 14;
  g.setLineDash([36, 22]);
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2 - 12, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = color;
  g.font = 'bold 260px "Reem Kufi", "Arial Black", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.globalAlpha = 0.85;
  g.fillText(label, S / 2, S / 2 + 10);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function nameTag(text, color) {
  const [c, g] = canvas(256);
  c.height = 64;
  g.font = '600 34px "Barlow Semi Condensed", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(0,0,0,0.75)';
  g.strokeText(text, 128, 32);
  g.fillStyle = color;
  g.fillText(text, 128, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// packed dirt road with two worn wheel ruts along it (v runs along the road)
export function road() {
  const S = 256;
  const [c, g] = canvas(S);
  const r = rng(21);
  g.fillStyle = '#a88a5c';
  g.fillRect(0, 0, S, S);
  for (const x of [0.28, 0.72]) {
    const grd = g.createLinearGradient((x - 0.1) * S, 0, (x + 0.1) * S, 0);
    grd.addColorStop(0, 'rgba(90,68,40,0)');
    grd.addColorStop(0.5, 'rgba(90,68,40,0.45)');
    grd.addColorStop(1, 'rgba(90,68,40,0)');
    g.fillStyle = grd;
    g.fillRect((x - 0.1) * S, 0, 0.2 * S, S);
  }
  // soft edges blend into the sand
  const e = g.createLinearGradient(0, 0, S, 0);
  e.addColorStop(0, 'rgba(201,168,119,0.9)');
  e.addColorStop(0.12, 'rgba(201,168,119,0)');
  e.addColorStop(0.88, 'rgba(201,168,119,0)');
  e.addColorStop(1, 'rgba(201,168,119,0.9)');
  g.fillStyle = e;
  g.fillRect(0, 0, S, S);
  speckle(g, S, r, 3000, ['rgba(70,52,30,0.3)', 'rgba(230,205,160,0.25)'], 1, 2.5);
  const tx = tex(c);
  return tx;
}

// asphalt with a dashed centre line, packed snow with two tyre tracks,
// raked gravel, and a clay tennis court
export function roadStyle(style) {
  const S = 256;
  const [c, g] = canvas(S);
  const r = rng(style === 'snow' ? 61 : style === 'gravel' ? 67 : style === 'court' ? 71 : 59);
  if (style === 'gravel') {
    g.fillStyle = '#b9ae98';
    g.fillRect(0, 0, S, S);
    speckle(g, S, r, 9000, ['rgba(80,70,55,0.35)', 'rgba(235,228,210,0.45)', 'rgba(150,140,120,0.4)'], 1, 2.5);
    const e = g.createLinearGradient(0, 0, S, 0);
    e.addColorStop(0, 'rgba(111,154,60,0.9)');
    e.addColorStop(0.08, 'rgba(111,154,60,0)');
    e.addColorStop(0.92, 'rgba(111,154,60,0)');
    e.addColorStop(1, 'rgba(111,154,60,0.9)');
    g.fillStyle = e;
    g.fillRect(0, 0, S, S);
  } else if (style === 'court') {
    g.fillStyle = '#b8583a';
    g.fillRect(0, 0, S, S);
    speckle(g, S, r, 5000, ['rgba(120,50,30,0.25)', 'rgba(230,150,110,0.2)'], 1, 2);
  } else if (style === 'snow') {
    // packed, dirty snow with tyre tracks: a road through the white
    g.fillStyle = '#b9bcbf';
    g.fillRect(0, 0, S, S);
    for (const x of [0.3, 0.7]) {
      const grd = g.createLinearGradient((x - 0.12) * S, 0, (x + 0.12) * S, 0);
      grd.addColorStop(0, 'rgba(70,72,76,0)');
      grd.addColorStop(0.5, 'rgba(70,72,76,0.55)');
      grd.addColorStop(1, 'rgba(70,72,76,0)');
      g.fillStyle = grd;
      g.fillRect((x - 0.12) * S, 0, 0.24 * S, S);
    }
    speckle(g, S, r, 3000, ['rgba(255,255,255,0.35)', 'rgba(80,84,90,0.3)', 'rgba(120,100,80,0.2)'], 1, 2.5);
    const e = g.createLinearGradient(0, 0, S, 0);
    e.addColorStop(0, 'rgba(233,237,241,0.95)');
    e.addColorStop(0.15, 'rgba(233,237,241,0)');
    e.addColorStop(0.85, 'rgba(233,237,241,0)');
    e.addColorStop(1, 'rgba(233,237,241,0.95)');
    g.fillStyle = e;
    g.fillRect(0, 0, S, S);
  } else {
    g.fillStyle = '#4b4c50';
    g.fillRect(0, 0, S, S);
    speckle(g, S, r, 5000, ['rgba(20,20,22,0.3)', 'rgba(140,140,138,0.2)'], 1, 2);
    g.fillStyle = 'rgba(240,236,220,0.85)';
    for (let y = 0; y < S; y += 64) g.fillRect(S / 2 - 3, y + 8, 6, 34);
    g.fillStyle = 'rgba(240,236,220,0.6)';
    g.fillRect(6, 0, 4, S);
    g.fillRect(S - 10, 0, 4, S);
  }
  return tex(c);
}

export function clockFace() {
  const S = 256;
  const [c, g] = canvas(S);
  g.fillStyle = '#efe6cf';
  g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 4, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#3a2c1c';
  g.lineWidth = 10;
  g.stroke();
  g.fillStyle = '#3a2c1c';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.save();
    g.translate(S / 2 + Math.sin(a) * 96, S / 2 - Math.cos(a) * 96);
    g.rotate(a);
    g.fillRect(-4, -12, 8, 24);
    g.restore();
  }
  g.lineCap = 'round';
  g.lineWidth = 9;
  g.beginPath(); g.moveTo(S / 2, S / 2); g.lineTo(S / 2 + 45, S / 2 - 30); g.stroke();
  g.lineWidth = 6;
  g.beginPath(); g.moveTo(S / 2, S / 2); g.lineTo(S / 2 - 20, S / 2 - 80); g.stroke();
  return tex(c, false);
}

export function paving(dirt) {
  const S = 256;
  const [c, g] = canvas(S);
  const r = rng(dirt ? 31 : 29);
  if (dirt) {
    g.fillStyle = '#b39468';
    g.fillRect(0, 0, S, S);
    speckle(g, S, r, 4000, ['rgba(80,60,35,0.3)', 'rgba(230,205,160,0.3)', 'rgba(120,150,60,0.15)'], 1, 3);
  } else {
    const n = 8, t = S / n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        g.fillStyle = `hsl(${34 + r() * 8}, ${22 + r() * 10}%, ${64 + r() * 10}%)`;
        g.fillRect(x * t + 1.5, y * t + 1.5, t - 3, t - 3);
      }
    }
  }
  const tx = tex(c);
  return tx;
}

export function rug(color) {
  const S = 128;
  const [c, g] = canvas(S);
  g.fillStyle = color;
  g.fillRect(0, 0, S, S);
  g.strokeStyle = '#f1e3c0';
  g.lineWidth = 6;
  g.strokeRect(8, 8, S - 16, S - 16);
  g.strokeStyle = 'rgba(20,10,5,0.5)';
  g.lineWidth = 3;
  g.strokeRect(18, 18, S - 36, S - 36);
  g.fillStyle = '#f1e3c0';
  g.beginPath();
  g.moveTo(S / 2, 30); g.lineTo(S - 34, S / 2); g.lineTo(S / 2, S - 30); g.lineTo(34, S / 2);
  g.closePath();
  g.fill();
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(S / 2, 46); g.lineTo(S - 50, S / 2); g.lineTo(S / 2, S - 46); g.lineTo(50, S / 2);
  g.closePath();
  g.fill();
  return tex(c, false);
}

// the face of a glass tower: four windows across and two storeys up in each repeat
// (6.4 m), some of them lit, with the spandrel bands between the floors
export function windows() {
  const S = 256;
  const [c, g] = canvas(S);
  const r = rng(83);
  g.fillStyle = '#34424f';
  g.fillRect(0, 0, S, S);
  speckle(g, S, r, 600, ['rgba(255,255,255,0.06)', 'rgba(0,0,0,0.12)'], 1, 2);
  for (let row = 0; row < 2; row++) {
    const y0 = row * (S / 2);
    g.fillStyle = '#242c34';
    g.fillRect(0, y0, S, 14);                      // the spandrel
    g.fillRect(0, y0 + S / 2 - 10, S, 10);
    for (let col = 0; col < 4; col++) {
      const x0 = col * (S / 4);
      g.fillStyle = '#242c34';
      g.fillRect(x0, y0, 5, S / 2);                // the mullion
      const lit = r() < 0.28;
      const grd = g.createLinearGradient(x0, y0 + 14, x0 + S / 4, y0 + S / 2 - 10);
      grd.addColorStop(0, lit ? 'rgba(255,226,172,0.8)' : 'rgba(160,196,224,0.55)');
      grd.addColorStop(1, lit ? 'rgba(255,200,130,0.6)' : 'rgba(62,84,104,0.6)');
      g.fillStyle = grd;
      g.fillRect(x0 + 5, y0 + 14, S / 4 - 5, S / 2 - 24);
      g.fillStyle = 'rgba(255,255,255,0.1)';
      g.fillRect(x0 + 10, y0 + 18, 10, S / 2 - 32);   // a reflection down one edge
    }
  }
  return tex(c);
}
