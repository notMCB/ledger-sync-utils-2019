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

export function ground() {
  const S = 512;
  const [c, g] = canvas(S);
  const r = rng(3);
  g.fillStyle = '#c9a877';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 140; i++) {
    const x = r() * S, y = r() * S, rad = 20 + r() * 70;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, r() < 0.5 ? 'rgba(150,115,70,0.16)' : 'rgba(230,205,160,0.18)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  speckle(g, S, r, 9000, ['rgba(110,85,50,0.3)', 'rgba(245,225,190,0.3)', 'rgba(90,70,45,0.22)'], 1, 2.5);
  // pebbles
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(${120 + r() * 60},${100 + r() * 40},${70 + r() * 30},0.55)`;
    g.beginPath();
    g.ellipse(r() * S, r() * S, 1 + r() * 3, 1 + r() * 2, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
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
