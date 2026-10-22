// Builds the town the server sent: merged meshes per material, props,
// sky and sun. Collision lives in physics.js.

import * as THREE from 'three';
import * as T from './textures.js';
import { Physics } from './physics.js';
import { cartCanvas, CART_SIDE, chromeMaterial, sirenMaterials } from './skins.js';

const WALL_TINTS = ['#f3e9d6', '#ecd3a6', '#dcb68a', '#e9cdbd', '#d4c7ad', '#e0ab7e'];
const CAR_TINTS = ['#8e3b2a', '#4e6f8f', '#d9d4c7', '#5d7a4a', '#c9a13b', '#3b3430'];
const CLOTH = ['#b3352b', '#2f7f7a', '#d49a2a', '#6b3f7a', '#2d5f9a', '#c46a2e'];
const BARREL = ['#35577a', '#8a4a26', '#5a6b3a'];
const CONCRETE_TINTS = ['#a6a59f', '#8f8e89', '#b8b6ae'];
const GLASS_TINTS = ['#8fa6b8', '#7c8e9c', '#9db3c4'];       // the towers downtown
const VELVET_TINTS = ['#8a2a2e', '#2e4a7a', '#4a6a3a'];      // crimson, royal blue, sage
const BOOK_TINTS = ['#7a2a2a', '#2a3f6a', '#3f6a3a', '#8a6a2a', '#5a2a5a', '#2a5a5a', '#a08a5a'];
// the paintings: sky, ground, a figure, a building — landscape or portrait in oils
const PAINTINGS = [
  ['#9fb8d6', '#5f7a3c', '#e2c9a0', '#6b4a2a'], ['#3a3a4a', '#6a4a2a', '#e8d2b0', '#8a2a2a'], ['#dbe6ee', '#8a9a6a', '#d8b890', '#4a5a7a'],
  ['#2f3f5f', '#1f2a3a', '#c9b090', '#7a5a2a'], ['#f0d8a0', '#a07a4a', '#8a6a5a', '#2f4a2a'], ['#8fb0c8', '#3f6a8a', '#f0e0c0', '#2a2a2a'],
  ['#d0c0a0', '#5a4a3a', '#a08060', '#8a2a4a'], ['#4a6a8a', '#2a4a3a', '#e0c0a0', '#c9a13b'],
];
const STEEL_TINTS = ['#d1b83c', '#8f949a', '#5b636c', '#4d6b3f'];          // crane yellow, grey, dark, generator green
const CONTAINER_TINTS = ['#b8412f', '#2e6fa3', '#3f7a4a', '#d9a13a', '#7a7f85', '#8a3f7a'];
// sky, fog and light for each kind of map
const THEMES = {
  sand: { top: '#5d93c9', mid: '#bcd3e2', bot: '#e9d6b4', fog: '#d9cdb4', near: 70, far: 260, hemi: ['#cfe0ee', '#a9855a', 1.1], sun: ['#fff0d6', 2.7, [55, 62, 35]] },
  concrete: { top: '#5a8dc4', mid: '#c2d4e0', bot: '#dcdad4', fog: '#d6d6d1', near: 70, far: 260, hemi: ['#dbe6ef', '#8c8c88', 1.5], sun: ['#fff6e8', 3.2, [40, 62, -30]] },
  snow: { top: '#6f8fb0', mid: '#d5dde6', bot: '#e6ebf0', fog: '#dfe5ec', near: 45, far: 210, hemi: ['#dbe6f2', '#b9c0c8', 1.2], sun: ['#fff8f0', 2.2, [-45, 40, 30]] },
  garden: { top: '#4f8fd0', mid: '#bcd6ea', bot: '#e4ecd8', fog: '#d6dfcf', near: 75, far: 270, hemi: ['#d6e6f2', '#5f7a3c', 1.15], sun: ['#fff4e0', 2.8, [50, 66, 40]] },
  // the royale map is big and seen from a plane: the haze sits further off
  royale: { top: '#5590c8', mid: '#bdd2e2', bot: '#e6d8bc', fog: '#d8cfba', near: 130, far: 460, hemi: ['#d2e0ec', '#9a8560', 1.15], sun: ['#fff0d6', 2.7, [55, 62, 35]] },
};
// the same maps after dark: a deep sky, a little moon, and the lamps do the rest
const NIGHT = {
  sand: { top: '#070c1c', mid: '#121d3a', bot: '#2e3040', fog: '#12172a', near: 34, far: 190, hemi: ['#4a5c86', '#2a231c', 0.5], sun: ['#9fb2dc', 0.5] },
  concrete: { top: '#060b1e', mid: '#111f3a', bot: '#262c38', fog: '#111624', near: 34, far: 190, hemi: ['#485a80', '#1e2024', 0.5], sun: ['#a4b6de', 0.5] },
  snow: { top: '#080e22', mid: '#172544', bot: '#323a4c', fog: '#1a2134', near: 30, far: 170, hemi: ['#52628a', '#2a2e3a', 0.55], sun: ['#b2c0e2', 0.55] },
  garden: { top: '#070c1e', mid: '#121f3c', bot: '#242c2a', fog: '#121824', near: 36, far: 195, hemi: ['#485a84', '#1e2418', 0.5], sun: ['#9fb4da', 0.5] },
};
// what each kind of lamp does: colour, how bright, how far, and the glow on the ground
const LAMP = {
  flood: { c: '#e8efff', i: 55, r: 56, pool: 11.0, bulb: 0.32 },
  wall: { c: '#ffd9a6', i: 20, r: 24, pool: 5.5, bulb: 0.18 },
  path: { c: '#ffd2a0', i: 7, r: 13, pool: 3.6, bulb: 0.12 },
  bulb: { c: '#ffe2b8', i: 9, r: 12, pool: 0, bulb: 0.14 },
  string: { c: '#ffc98a', i: 8, r: 14, pool: 4.0, bulb: 0 },
};
const POOL = 14;             // real point lights in play at once; the nearest lamps get them

let texCache = null;
function textures() {
  if (texCache) return texCache;
  const ground = T.groundSet(), snow = T.snowSet(), grass = T.grassSet(), concrete = T.concreteSet();
  texCache = {
    plaster: T.plaster(), stone: T.stone(), ground: ground.map, groundN: ground.normalMap, tiles: T.tiles(), wood: T.wood(),
    crate: T.crate(), metal: T.metal(), leaf: T.palmLeaf(),
    cloth: CLOTH.map((c) => T.cloth(c)),
    concrete: concrete.map, concreteN: concrete.normalMap, snow: snow.map, snowN: snow.normalMap, corrugated: T.corrugated(), rock: T.rock(), container: T.containerSkin(),
    grass: grass.map, grassN: grass.normalMap, marble: T.marble(), hedge: T.hedge(), windows: T.windows(), asphalt: T.roadStyle('asphalt'),
    tuft: T.leafTuft(), grassTuft: T.grassTuft(),
  };
  return texCache;
}

// -- geometry helpers -------------------------------------------------------

class GeoBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
  }

  // a box face as two triangles; corners in world space
  quad(a, b, c, d, n, uvs, color) {
    const P = this.pos, N = this.nor, U = this.uv, C = this.col;
    const tri = [a, b, c, a, c, d];
    const tuv = [uvs[0], uvs[1], uvs[2], uvs[0], uvs[2], uvs[3]];
    for (let i = 0; i < 6; i++) {
      const v = tri[i];
      P.push(v[0], v[1], v[2]);
      N.push(n[0], n[1], n[2]);
      U.push(tuv[i][0], tuv[i][1]);
      const shade = color.ao ? Math.min(1, 0.72 + 0.28 * Math.min(1, v[1] / 1.4)) : 1;
      C.push(color.r * shade, color.g * shade, color.b * shade);
    }
  }

  // one triangle, lit flat across its face
  tri(a, b, c, uva, uvb, uvc, color) {
    const P = this.pos, N = this.nor, U = this.uv, C = this.col;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz) || 1;
    nx /= L; ny /= L; nz /= L;
    for (const [v, uv] of [[a, uva], [b, uvb], [c, uvc]]) {
      P.push(v[0], v[1], v[2]);
      N.push(nx, ny, nz);
      U.push(uv[0], uv[1]);
      const shade = color.ao ? Math.min(1, 0.72 + 0.28 * Math.min(1, v[1] / 1.4)) : 1;
      C.push(color.r * shade, color.g * shade, color.b * shade);
    }
  }

  // a craggy block: the box cut into a grid and every point nudged by a hash of
  // where it sits in the world, so the faces stay sealed along their edges, and
  // each triangle lit flat. Rocks, cliffs and, with a small amount and a puff
  // outward, hedges. flatTop keeps a walkable top walkable.
  rock(cx, cy, cz, hx, hy, hz, yaw, color, scale, opts = {}) {
    const amp = opts.amp !== undefined ? opts.amp : Math.min(0.45, 0.22 * Math.min(hx, hy, hz));
    const segLen = opts.seg || 1.2, maxSeg = opts.maxSeg || 10;
    const n = (h) => Math.max(1, Math.min(maxSeg, Math.round((2 * h) / segLen)));
    const nx = n(hx), ny = n(hy), nz = n(hz);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const seed = opts.seed || 0, puff = opts.puff || 0, flatTop = !!opts.flatTop;
    // cross: the puff goes out from the block's long axis rather than along each
    // face's normal, so a vertex shared by two faces (or by two blocks laid end to
    // end, with the same seed) moves the same way and the surface stays sealed
    const cross = !!opts.cross, longX = hx >= hz;
    const W = (lx, ly, lz) => [cx + c * lx + s * lz, cy + ly, cz - s * lx + c * lz];
    const vert = (lx, ly, lz, fn) => {
      const w = W(lx, ly, lz);
      const qx = Math.round(w[0] * 100), qy = Math.round(w[1] * 100), qz = Math.round(w[2] * 100);
      let ox = (jit(qx, qy, qz, seed) - 0.5) * 2 * amp, oy = (jit(qx, qy, qz, seed + 1) - 0.5) * 2 * amp, oz = (jit(qx, qy, qz, seed + 2) - 0.5) * 2 * amp;
      if (flatTop && ly >= hy - 1e-6) oy *= 0.1;
      if (ly <= -hy + 1e-6) oy = Math.min(0, oy);
      let pn;
      if (cross) {
        const dx = longX ? 0 : lx / hx, dy = ly / hy, dz = longX ? lz / hz : 0;
        const L = Math.hypot(dx, dy, dz) || 1;
        pn = [(c * dx + s * dz) / L, dy / L, (-s * dx + c * dz) / L];
      } else {
        // the puff goes out along the face, in the world frame
        pn = [c * fn[0] + s * fn[2], fn[1], -s * fn[0] + c * fn[2]];
      }
      const k = puff * (0.6 + 0.8 * jit(qz, qx, qy, seed + 3));
      return [w[0] + ox + pn[0] * k, w[1] + oy + pn[1] * k, w[2] + oz + pn[2] * k];
    };
    const u = (v) => v / scale;
    // each face: its normal, the two axes that span it, and the grid counts along them
    const faces = [
      [[1, 0, 0], [0, 0, -1], [0, 1, 0], nz, ny], [[-1, 0, 0], [0, 0, 1], [0, 1, 0], nz, ny],
      [[0, 0, 1], [1, 0, 0], [0, 1, 0], nx, ny], [[0, 0, -1], [-1, 0, 0], [0, 1, 0], nx, ny],
      [[0, 1, 0], [1, 0, 0], [0, 0, -1], nx, nz], [[0, -1, 0], [1, 0, 0], [0, 0, 1], nx, nz],
    ];
    const H = [hx, hy, hz];
    for (const [fn, ua, va, nu, nv] of faces) {
      if (opts.skipBottom && fn[1] === -1) continue;
      const hu = Math.abs(ua[0]) ? hx : Math.abs(ua[1]) ? hy : hz;
      const hv = Math.abs(va[0]) ? hx : Math.abs(va[1]) ? hy : hz;
      const at = (i, j) => {
        const du = -hu + (2 * hu * i) / nu, dv = -hv + (2 * hv * j) / nv;
        const l = [fn[0] * H[0] + ua[0] * du + va[0] * dv, fn[1] * H[1] + ua[1] * du + va[1] * dv, fn[2] * H[2] + ua[2] * du + va[2] * dv];
        return [vert(l[0], l[1], l[2], fn), [u(du), u(dv)]];
      };
      for (let i = 0; i < nu; i++) {
        for (let j = 0; j < nv; j++) {
          const [a, uva] = at(i, j), [b, uvb] = at(i + 1, j), [cc, uvc] = at(i + 1, j + 1), [d, uvd] = at(i, j + 1);
          this.tri(a, b, cc, uva, uvb, uvc, color);
          this.tri(a, cc, d, uva, uvc, uvd, color);
        }
      }
    }
  }

  // oriented box with world-scaled UVs (scale = metres per texture repeat)
  box(cx, cy, cz, hx, hy, hz, yaw, color, scale, opts = {}) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    // corners snapped to a millimetre, so two boxes that meet share the exact same
    // edge and no hairline of what is behind shows through the seam
    const q = (v) => Math.round(v * 1000) / 1000;
    const W = (lx, ly, lz) => [q(cx + c * lx + s * lz), q(cy + ly), q(cz - s * lx + c * lz)];
    const Nv = (lx, ly, lz) => [c * lx + s * lz, ly, -s * lx + c * lz];
    // a stable frame for UVs so neighbouring wall pieces line up
    const ox = c * cx - s * cz;
    const oz = s * cx + c * cz;
    const u = (v) => v / scale;
    const unit = opts.unitUV;
    const x0 = -hx, x1 = hx, y0 = -hy, y1 = hy, z0 = -hz, z1 = hz;
    const yb = cy - hy, yt = cy + hy;
    const skipBottom = opts.skipBottom;
    const side = opts.sideColor || color;
    const only = opts.faces || 'all';   // 'top', 'sides' or 'all'
    const f = (a, b, cc, d, n, uv) => {
      if (only === 'top' && n[1] !== 1) return;
      if (only === 'sides' && n[1] !== 0) return;
      this.quad(W(...a), W(...b), W(...cc), W(...d), Nv(...n), uv, n[1] === 0 ? side : color);
    };
    const UV = (u0, v0, u1, v1) => unit ? [[0, 0], [1, 0], [1, 1], [0, 1]] : [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    // +x
    f([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], UV(u(-(oz + z1)), u(yb), u(-(oz + z0)), u(yt)));
    // -x
    f([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], UV(u(oz + z0), u(yb), u(oz + z1), u(yt)));
    // +z
    f([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], UV(u(ox + x0), u(yb), u(ox + x1), u(yt)));
    // -z
    f([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], UV(u(-(ox + x1)), u(yb), u(-(ox + x0)), u(yt)));
    // top (a road's top runs its texture across the width and along its length)
    f([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0],
      opts.roadUV ? [[0, 0], [1, 0], [1, u(2 * hz)], [0, u(2 * hz)]] : UV(u(ox + x0), u(-(oz + z1)), u(ox + x1), u(-(oz + z0))));
    // bottom
    if (!skipBottom) f([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], UV(u(ox + x0), u(oz + z0), u(ox + x1), u(oz + z1)));
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }

  get empty() {
    return this.pos.length === 0;
  }
}

// merge arbitrary three geometries (transformed) into one, with a vertex colour each
function mergeInto(list) {
  let n = 0;
  const parts = list.map(({ geo, matrix, color }) => {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(matrix);
    n += g.attributes.position.count;
    return { g, color };
  });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 3);
  let o = 0;
  for (const { g, color } of parts) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    for (let i = 0; i < c; i++) {
      col[(o + i) * 3] = color.r;
      col[(o + i) * 3 + 1] = color.g;
      col[(o + i) * 3 + 2] = color.b;
    }
    o += c;
    g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

const M4 = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
// how strongly each ground's normal map shows
const NORMAL_SCALE = { ground: new THREE.Vector2(0.9, 0.9), snow: new THREE.Vector2(0.8, 0.8), grass: new THREE.Vector2(0.6, 0.6), concrete: new THREE.Vector2(0.5, 0.5) };

// a ground material: the colour and its normal map, lit like everything else
// (Phong with next to no shine, so it matches the Lambert walls), plus any extras
function groundMat(tx, kind, extra = {}) {
  return new THREE.MeshPhongMaterial({ map: tx[kind], normalMap: tx[kind + 'N'], normalScale: NORMAL_SCALE[kind], specular: '#101010', shininess: 4, ...extra });
}

// the height of a map's smooth ground at a point, from its grid of cell heights:
// the four cells round the point blended, except across a cliff (a jump of more
// than 2.5 m), where the nearest cell wins so the edge stays an edge. The same
// sums as surface_at in server/mapgen.py, so everyone agrees where the ground is.
export function surfaceAt(H, x, z) {
  const nx = H.nx, nz = H.nz, h = H.h;
  let fx = (x - H.x0) / H.cell - 0.5, fz = (z - H.z0) / H.cell - 0.5;
  let ix = Math.floor(fx), iz = Math.floor(fz);
  let tx = fx - ix, tz = fz - iz;
  if (ix < 0) { ix = 0; tx = 0; } else if (ix > nx - 2) { ix = nx - 2; tx = 1; }
  if (iz < 0) { iz = 0; tz = 0; } else if (iz > nz - 2) { iz = nz - 2; tz = 1; }
  const h00 = h[ix][iz], h10 = h[ix + 1][iz], h01 = h[ix][iz + 1], h11 = h[ix + 1][iz + 1];
  const lo = Math.min(h00, h10, h01, h11), hi = Math.max(h00, h10, h01, h11);
  if (hi - lo > 2.5) return h[ix + (tx >= 0.5 ? 1 : 0)][iz + (tz >= 0.5 ? 1 : 0)];
  const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
  return (h00 + (h10 - h00) * sx) * (1 - sz) + (h01 + (h11 - h01) * sx) * sz;
}

// a number in [0, 1) that is always the same for the same point and seed
function jit(x, y, z, seed = 0) {
  const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 0.618) * 43758.5453;
  return h - Math.floor(h);
}

// a sphere with its surface nudged about: canopies, bushes, topiary
function blobGeometry(seed = 0, amount = 0.12) {
  const g = new THREE.SphereGeometry(1, 10, 8);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + (jit(Math.round(x * 50), Math.round(y * 50), Math.round(z * 50), seed) - 0.5) * 2 * amount;
    p.setXYZ(i, x * k, y * k, z * k);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

// a cone with a ragged rim, for the tiers of a pine
function raggedConeGeometry(seed = 0) {
  const g = new THREE.ConeGeometry(1, 1, 11);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (y > -0.4) continue;          // only the rim
    const k = 0.84 + 0.32 * jit(Math.round(x * 100), 0, Math.round(z * 100), seed);
    p.setXYZ(i, x * k, y + (jit(Math.round(z * 100), 1, Math.round(x * 100), seed) - 0.5) * 0.16, z * k);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

function mtx(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  E.set(rx, ry, rz, 'YXZ');
  Q.setFromEuler(E);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), Q, new THREE.Vector3(sx, sy, sz));
}

function colorOf(hex, mul = 1) {
  const c = new THREE.Color(hex);
  c.r *= mul; c.g *= mul; c.b *= mul;
  return c;
}

// -- the world ---------------------------------------------------------------

export class World {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.root = null;
    this.physics = null;
    this.map = null;
    this.setupSky();
  }

  setupSky() {
    const scene = this.scene;
    const skyGeo = new THREE.SphereGeometry(900, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color('#5d93c9') },
        mid: { value: new THREE.Color('#bcd3e2') },
        bot: { value: new THREE.Color('#e9d6b4') },
        sunDir: { value: new THREE.Vector3(0.55, 0.62, 0.35).normalize() },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`,
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bot; uniform vec3 sunDir; varying vec3 vDir;
        void main(){
          float h = vDir.y;
          vec3 c = h > 0.0 ? mix(mid, top, pow(clamp(h,0.0,1.0), 0.55)) : mix(mid, bot, clamp(-h*4.0,0.0,1.0));
          float s = max(dot(normalize(vDir), sunDir), 0.0);
          c += vec3(1.0,0.85,0.6) * pow(s, 400.0) * 3.0 + vec3(1.0,0.8,0.55) * pow(s, 12.0) * 0.25;
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    scene.add(this.sky);
    scene.fog = new THREE.Fog('#d9cdb4', 70, 260);

    this.hemi = new THREE.HemisphereLight('#cfe0ee', '#a9855a', 1.1);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff0d6', 2.7);
    this.sun.position.set(55, 62, 35);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const sc = this.sun.shadow.camera;
    sc.left = -95; sc.right = 95; sc.top = 95; sc.bottom = -95; sc.near = 1; sc.far = 260;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun);
    scene.add(this.sun.target);
  }

  // the look of the sky, the haze and the light for this kind of map
  applyTheme(name) {
    let t = THEMES[name] || THEMES.sand;
    if (this.night) {
      const n = NIGHT[name] || NIGHT.sand;
      t = { ...t, ...n, sun: [n.sun[0], n.sun[1], t.sun[2]] };
    }
    const u = this.sky.material.uniforms;
    u.top.value.set(t.top);
    u.mid.value.set(t.mid);
    u.bot.value.set(t.bot);
    this.scene.fog.color.set(t.fog);
    this.scene.fog.near = t.near;
    this.scene.fog.far = t.far;
    this.hemi.color.set(t.hemi[0]);
    this.hemi.groundColor.set(t.hemi[1]);
    this.hemi.intensity = t.hemi[2];
    this.sun.color.set(t.sun[0]);
    this.sun.intensity = t.sun[1];
    this.sun.position.set(...t.sun[2]);
    u.sunDir.value.copy(this.sun.position).normalize();
    this.outdoor = null;   // setIndoor takes a fresh copy of these
  }

  // underground: the sun is shut out, lamps light the hall
  setIndoor(on, root, map) {
    if (!this.outdoor) this.outdoor = { sun: this.sun.intensity, hemi: this.hemi.intensity, fog: this.scene.fog.color.clone(), near: this.scene.fog.near, far: this.scene.fog.far };
    const o = this.outdoor;
    this.sky.visible = !on;
    this.sun.intensity = on ? 0 : o.sun;
    this.hemi.intensity = on ? 0.55 : o.hemi;
    this.scene.fog.color.set(on ? '#2a2016' : o.fog);
    this.scene.fog.near = on ? 30 : o.near;
    this.scene.fog.far = on ? 190 : o.far;
    if (on && root) {
      // three lamps actually light the hall — the rest just glow — to keep it smooth
      for (const z of [0, -40, -85]) {
        const l = new THREE.PointLight('#ffc27a', 14, 45, 1.4);
        l.position.set(0, 4.2, z);
        root.add(l);
      }
    }
  }

  // a lamp: its fixture by day, and by night the bulb lit, a glow on the ground and,
  // when it is one of the nearest, a real light from the pool
  addLamp(root, d) {
    const L = LAMP[d.kind] || LAMP.bulb;
    const dark = this.lampMat || (this.lampMat = new THREE.MeshLambertMaterial({ color: '#2c2f33' }));
    const y0 = this.physics ? this.physics.floorAt(d.x, d.z) : 0;
    if (d.kind === 'flood') {
      const h = d.y - 0.2 - y0;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, h, 8), dark);
      pole.position.set(d.x, y0 + h / 2, d.z);
      root.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.35, 0.5), dark);
      head.position.set(d.x, d.y, d.z);
      head.rotation.y = d.yaw || 0;
      root.add(head);
    } else if (d.kind === 'path') {
      const h = Math.max(0.3, d.y - y0 + 0.1);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, h, 6), dark);
      post.position.set(d.x, d.y + 0.1 - h / 2, d.z);
      root.add(post);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.1, 0.12, 8), dark);
      cap.position.set(d.x, d.y + 0.14, d.z);
      root.add(cap);
    } else if (d.kind === 'wall') {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.22, 0.3), dark);
      box.position.set(d.x, d.y + 0.12, d.z);
      box.rotation.y = d.yaw || 0;
      root.add(box);
    } else if (d.kind === 'bulb') {
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.35, 4), dark);
      cord.position.set(d.x, d.y + 0.2, d.z);
      root.add(cord);
    }
    if (!this.night) return;
    // lit: the bulb itself, the glow round it, the pool it throws on the ground
    if (L.bulb) {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(L.bulb, 10, 8), new THREE.MeshBasicMaterial({ color: L.c }));
      bulb.position.set(d.x, d.y, d.z);
      root.add(bulb);
    }
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.haloTex || (this.haloTex = T.softDot('rgba(255,225,170,0.55)', 'rgba(255,225,170,0)')), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: d.kind === 'flood' ? 0.9 : 0.6 }));
    halo.scale.setScalar(d.kind === 'flood' ? 5 : d.kind === 'bulb' ? 1.6 : 2.2);
    halo.position.set(d.x, d.y, d.z);
    root.add(halo);
    if (L.pool) {
      const pool = new THREE.Mesh(new THREE.CircleGeometry(L.pool, 24), new THREE.MeshBasicMaterial({ map: this.poolTex || (this.poolTex = T.softDot('rgba(255,215,150,0.42)', 'rgba(255,215,150,0)')), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(d.x, y0 + 0.04, d.z);
      root.add(pool);
    }
    this.lamps.push({ x: d.x, y: d.y, z: d.z, L });
  }

  // the nearest lamps get the real lights, and the rest keep their glow
  updateLights(pos) {
    if (!this.night || !this.lamps || !this.lamps.length || !this.root) return;
    const now = performance.now();
    if (this.lightsAt && now - this.lightsAt < 250) return;
    this.lightsAt = now;
    if (!this.pool.length) {
      for (let i = 0; i < POOL; i++) {
        const l = new THREE.PointLight('#ffffff', 0, 10, 1.3);
        l.visible = false;
        this.root.add(l);
        this.pool.push(l);
      }
    }
    const near = this.lamps.map((l) => ({ l, d: Math.hypot(l.x - pos.x, l.y - pos.y, l.z - pos.z) })).filter((e) => e.d < 95).sort((a, b) => a.d - b.d).slice(0, POOL);
    this.pool.forEach((pl, i) => {
      const e = near[i];
      if (!e) { pl.visible = false; return; }
      pl.visible = true;
      pl.color.set(e.l.L.c);
      pl.intensity = e.l.L.i;
      pl.distance = e.l.L.r;
      pl.position.set(e.l.x, e.l.y, e.l.z);
    });
  }

  // on a map too big for one shadow map, the sun's shadow box follows the camera
  // about in big hops, re-rendering only when it moves
  followShadows(pos) {
    this.updateLights(pos);
    if (!this.map || !this.renderer.shadowMap.enabled) return;
    const [bx, bz] = this.map.bounds;
    if (Math.max(bx, bz) <= 100) return;
    const c = this.shadowCentre || (this.shadowCentre = new THREE.Vector3(1e9, 0, 1e9));
    if (Math.hypot(pos.x - c.x, pos.z - c.z) < 45) return;
    c.set(pos.x, 0, pos.z);
    const t = THEMES[this.map.theme] || THEMES.sand;
    this.sun.target.position.set(pos.x, 0, pos.z);
    this.sun.position.set(pos.x + t.sun[2][0], t.sun[2][1], pos.z + t.sun[2][2]);
    this.sun.target.updateMatrixWorld();
    const sc = this.sun.shadow.camera;
    sc.left = -110; sc.right = 110; sc.top = 110; sc.bottom = -110; sc.far = 320;
    sc.updateProjectionMatrix();
    this.renderer.shadowMap.needsUpdate = true;
  }

  setShadows(on) {
    this.renderer.shadowMap.enabled = on;
    this.sun.castShadow = on;
    this.scene.traverse((o) => {
      if (o.material) o.material.needsUpdate = true;
    });
    this.renderer.shadowMap.needsUpdate = true;
  }

  dispose() {
    if (!this.root) return;
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) {
          if (m.userData.own && m.map) m.map.dispose();
          m.dispose();
        }
      }
    });
    this.root = null;
  }

  build(map) {
    this.dispose();
    this.map = map;
    this.night = !!map.night;
    this.lamps = [];
    this.pool = [];
    this.surface = map.height ? (x, z) => surfaceAt(map.height, x, z) : null;
    this.physics = new Physics(map.boxes, map.bounds, map.tunnels, this.surface);
    const tx = textures();
    const root = new THREE.Group();
    this.root = root;
    this.applyTheme(map.theme);
    this.hasTerrain = map.boxes.some((b) => b[7] === 'terrain');

    const mats = {
      wall: new THREE.MeshLambertMaterial({ map: tx.plaster, vertexColors: true }),
      tile: new THREE.MeshLambertMaterial({ map: tx.tiles, vertexColors: true }),
      stone: new THREE.MeshLambertMaterial({ map: tx.stone, vertexColors: true }),
      wood: new THREE.MeshLambertMaterial({ map: tx.wood, vertexColors: true }),
      crate: new THREE.MeshLambertMaterial({ map: tx.crate, vertexColors: true }),
      car: new THREE.MeshLambertMaterial({ map: tx.metal, vertexColors: true }),
      concrete: new THREE.MeshLambertMaterial({ map: tx.concrete, vertexColors: true }),
      steel: new THREE.MeshLambertMaterial({ map: tx.corrugated, vertexColors: true }),
      container: new THREE.MeshLambertMaterial({ map: tx.container, vertexColors: true }),
      flatroof: new THREE.MeshLambertMaterial({ map: tx.concrete, vertexColors: true }),
      rock: new THREE.MeshLambertMaterial({ map: tx.rock, vertexColors: true }),
      terrain: new THREE.MeshLambertMaterial({ map: tx.rock, vertexColors: true }),
      terraintop: groundMat(tx, map.theme === 'snow' ? 'snow' : map.theme === 'garden' ? 'grass' : 'ground', { vertexColors: true }),
      // stepped ground can carry its own texture by tint: snow, grass or concrete
      terraintop1: groundMat(tx, 'snow', { vertexColors: true }),
      terraintop2: groundMat(tx, 'grass', { vertexColors: true }),
      terraintop3: groundMat(tx, 'concrete', { vertexColors: true }),
      marble: new THREE.MeshLambertMaterial({ map: tx.marble, vertexColors: true }),
      hedge: new THREE.MeshLambertMaterial({ map: tx.hedge, vertexColors: true }),
      velvet: new THREE.MeshLambertMaterial({ map: tx.plaster, vertexColors: true }),
      lacquer: new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 90, specular: '#666666' }),
      asphalt: new THREE.MeshLambertMaterial({ map: tx.asphalt, vertexColors: true }),
      glass: new THREE.MeshLambertMaterial({ map: tx.windows, vertexColors: true }),
      gold: new THREE.MeshPhongMaterial({ map: tx.marble, vertexColors: true, shininess: 70, specular: '#8a6a20' }),
      barrier: new THREE.MeshLambertMaterial({ map: tx.concrete, vertexColors: true }),
    };
    const builders = {};
    const B = (k) => builders[k] || (builders[k] = new GeoBuilder());
    const tufts = [];
    const tuftGeo = new THREE.PlaneGeometry(0.6, 0.5);
    tuftGeo.translate(0, 0.1, 0);

    for (const [cx, cy, cz, hx, hy, hz, yaw, mat, tint] of map.boxes) {
      if (mat === 'inv') continue;
      if (mat === 'wall') {
        B('wall').box(cx, cy, cz, hx, hy, hz, yaw, Object.assign(colorOf(WALL_TINTS[tint % 6]), { ao: true }), 2.2);
      } else if (mat === 'roof') {
        B('wall').box(cx, cy, cz, hx, hy, hz, yaw, colorOf(WALL_TINTS[tint % 6], 0.9), 2.2);
      } else if (mat === 'tile') {
        B('tile').box(cx, cy, cz, hx, hy, hz, yaw, colorOf('#ffffff'), 2.0, { skipBottom: cy - hy < 0.01 });
      } else if (mat === 'stair') {
        B('stone').box(cx, cy, cz, hx, hy, hz, yaw, colorOf('#e8dcc6'), 1.4);
      } else if (mat === 'stone') {
        B('stone').box(cx, cy, cz, hx, hy, hz, yaw, Object.assign(colorOf('#f2e6d2'), { ao: true }), 3.0);
      } else if (mat === 'wood') {
        B('wood').box(cx, cy, cz, hx, hy, hz, yaw, colorOf('#ffffff'), 1.5);
      } else if (mat === 'crate') {
        B('crate').box(cx, cy, cz, hx, hy, hz, yaw, colorOf('#ffffff'), 1, { unitUV: true });
      } else if (mat === 'car') {
        continue;   // drawn from the 'car' deco instead, with wheels and windows
      } else if (mat === 'hay') {
        B('wood').box(cx, cy, cz, hx, hy, hz, yaw, colorOf('#e8c96a', 1.25), 1.2);
      } else if (mat === 'concrete') {
        B('concrete').box(cx, cy, cz, hx, hy, hz, yaw, Object.assign(colorOf(CONCRETE_TINTS[tint % 3]), { ao: true }), 2.5);
      } else if (mat === 'steel') {
        B('steel').box(cx, cy, cz, hx, hy, hz, yaw, colorOf(STEEL_TINTS[tint % 4]), 1.0);
      } else if (mat === 'container') {
        B('container').box(cx, cy, cz, hx, hy, hz, yaw, colorOf(CONTAINER_TINTS[tint % 6]), 3.4);
      } else if (mat === 'terrain') {
        if (map.height) continue;     // smooth ground: drawn as one surface below
        // stepped ground: snow (or the tint's texture) on top, rock on the risers
        B(tint ? 'terraintop' + (tint % 4) : 'terraintop').box(cx, cy, cz, hx, hy, hz, yaw, colorOf(tint === 3 ? '#c9c8c2' : '#ffffff'), tint === 3 ? 2.5 : 9.0, { faces: 'top' });
        if (hy > 0.04) B('terrain').box(cx, cy, cz, hx, hy, hz, yaw, colorOf(tint === 1 ? '#9a9c9e' : '#b8a888'), 3.0, { faces: 'sides' });
      } else if (mat === 'flatroof') {
        B('flatroof').box(cx, cy, cz, hx, hy, hz, yaw, colorOf('#7d7b76'), 3.0);
      } else if (mat === 'marble') {
        B('marble').box(cx, cy, cz, hx, hy, hz, yaw, Object.assign(colorOf('#f4f2ec'), { ao: true }), 2.4);
      } else if (mat === 'hedge') {
        // a clipped hedge: bulging, uneven, with sprigs of leaf poking out of it
        // one seed for every hedge and a puff out from the long axis, so hedges laid end to end meet without a gap
        B('hedge').rock(cx, cy, cz, hx, hy, hz, yaw, colorOf('#ffffff'), 1.2, { amp: 0.06, seg: 0.45, maxSeg: 40, puff: 0.07, seed: 11, cross: true, skipBottom: true });
        const c = Math.cos(yaw), sn = Math.sin(yaw);
        const long = Math.max(hx, hz), short = Math.min(hx, hz);
        for (let t = -long + 0.3; t <= long - 0.3; t += 0.55) {
          for (const side of [-1, 1]) {
            const lx = hx >= hz ? t : side * (short + 0.08), lz = hx >= hz ? side * (short + 0.08) : t;
            const wx = cx + c * lx + sn * lz, wz = cz - sn * lx + c * lz;
            const j = jit(Math.round(wx * 10), 0, Math.round(wz * 10), 5);
            const y = cy - hy + 0.25 + (2 * hy - 0.4) * j;
            const sc = 0.45 + 0.25 * jit(Math.round(wz * 10), 1, Math.round(wx * 10), 6);
            tufts.push({ geo: tuftGeo, matrix: mtx(wx, y, wz, 0, j * 6.28, 0, sc, sc, sc), color: colorOf(j < 0.5 ? '#cfe3b8' : '#e4f0cc') });
            tufts.push({ geo: tuftGeo, matrix: mtx(wx, y, wz, 0, j * 6.28 + 1.57, 0, sc, sc, sc), color: colorOf(j < 0.5 ? '#cfe3b8' : '#e4f0cc') });
          }
        }
      } else if (mat === 'velvet') {
        B('velvet').box(cx, cy, cz, hx, hy, hz, yaw, colorOf(VELVET_TINTS[tint % 3]), 1.0);
      } else if (mat === 'lacquer') {
        B('lacquer').box(cx, cy, cz, hx, hy, hz, yaw, colorOf('#141416'), 1.0);
      } else if (mat === 'asphalt') {
        // a road: the markings run along it, the kerb face is plain
        B('asphalt').box(cx, cy, cz, hx, hy, hz, yaw, colorOf('#ffffff'), 8.0, { roadUV: true, sideColor: colorOf('#55565a') });
      } else if (mat === 'glass') {
        B('glass').box(cx, cy, cz, hx, hy, hz, yaw, colorOf(GLASS_TINTS[tint % 3]), 6.4);
      } else if (mat === 'barrier') {
        // the Derby's track barriers, red and white in turn
        B('barrier').box(cx, cy, cz, hx, hy, hz, yaw, colorOf(tint ? '#f2f0ea' : '#d0352b'), 6.0);
      } else if (mat === 'gold') {
        B('gold').box(cx, cy, cz, hx, hy, hz, yaw, colorOf('#e6bd45'), 2.0);
      } else if (mat === 'rock') {
        const snowy = map.theme === 'snow';
        // rock is never a box: cliffs and boulders are craggy, and a rock step keeps a walkable top
        const big = hx > 40 || hz > 40;
        B('rock').rock(cx, cy, cz, hx, hy, hz, yaw, Object.assign(colorOf(snowy ? '#d9dce0' : '#ffffff'), { ao: true }), 3.0,
          { amp: big ? 0.8 : Math.min(0.5, 0.26 * Math.min(hx, hy, hz)), seg: big ? 3.0 : 0.9, maxSeg: big ? 40 : 8,
            flatTop: !big && (cy - hy <= 0.25 || hy < 1.0), seed: Math.round(cx * 7 + cz * 13), skipBottom: cy - hy <= 0.05 });
      }
    }
    for (const k in builders) {
      if (builders[k].empty) continue;
      const mesh = new THREE.Mesh(builders[k].geometry(), mats[k]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
    }
    if (tufts.length) {
      const mesh = new THREE.Mesh(mergeInto(tufts), new THREE.MeshLambertMaterial({ map: tx.tuft, vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.5 }));
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      root.add(mesh);
    }
    tuftGeo.dispose();

    // ground, with a hole cut wherever a hatch drops into the tunnels
    const [bx, bz] = map.bounds;
    const W = bx * 2 + 300, D = bz * 2 + 300;
    const holes = ((map.tunnels && map.tunnels.hatches) || []).map((h) => ({ x: h[0], z: h[1], r: (map.tunnels.r || 0.8) + 0.02 }));
    let gg;
    if (holes.length) {
      // the shape is drawn in x/y and then laid flat, so its y stands for -z
      const shape = new THREE.Shape();
      shape.moveTo(-W / 2, -D / 2);
      shape.lineTo(W / 2, -D / 2);
      shape.lineTo(W / 2, D / 2);
      shape.lineTo(-W / 2, D / 2);
      shape.closePath();
      for (const h of holes) {
        const p = new THREE.Path();
        p.moveTo(h.x - h.r, -h.z - h.r);
        p.lineTo(h.x - h.r, -h.z + h.r);
        p.lineTo(h.x + h.r, -h.z + h.r);
        p.lineTo(h.x + h.r, -h.z - h.r);
        p.closePath();
        shape.holes.push(p);
      }
      gg = new THREE.ShapeGeometry(shape);
      gg.rotateX(-Math.PI / 2);      // lay it flat, facing up
      const pos = gg.attributes.position;
      const uv = gg.attributes.uv;
      for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 9, pos.getZ(i) / 9);
    } else {
      // at night the ground is cut fine, so the lamps can light it
      gg = this.night ? new THREE.PlaneGeometry(W, D, Math.ceil(W / 5), Math.ceil(D / 5)) : new THREE.PlaneGeometry(W, D);
      gg.rotateX(-Math.PI / 2);
      const guv = gg.attributes.uv;
      for (let i = 0; i < guv.count; i++) guv.setXY(i, guv.getX(i) * W / 9, guv.getY(i) * D / 9);
    }
    const gkind = map.theme === 'concrete' ? 'concrete' : map.theme === 'snow' ? 'snow' : map.theme === 'garden' ? 'grass' : 'ground';
    // drawn from underneath as well, so nobody under the street sees through it
    const ground = new THREE.Mesh(gg, groundMat(tx, gkind, { side: THREE.DoubleSide }));
    ground.receiveShadow = true;
    root.add(ground);
    if (map.height) this.addHeightfield(map, root, tx, gkind);
    if (gkind === 'snow' || gkind === 'ground') this.addDrifts(map, root, tx, gkind);

    this.buildDeco(map, root, tx);
    this.buildDoors(map, root, tx);
    this.setIndoor(!!map.indoor, root, map);
    this.scene.add(root);
    this.renderer.shadowMap.needsUpdate = true;
  }

  buildDeco(map, root, tx) {
    const barrels = [], trunks = [], leaves = [], domes = [], cloth = CLOTH.map(() => []), poles = [], goods = [], wheels = [];
    const cars = new GeoBuilder();
    const steel = new GeoBuilder();      // crane fittings, lattice towers, generators, masts
    const paint = new GeoBuilder();      // white and coloured plain-painted bits
    const tanks = [], cones = [], canopies = [], figures = [], brass = [], glow = [];
    const canopyGeo = new THREE.SphereGeometry(1, 12, 9);
    const blobs = [blobGeometry(1), blobGeometry(2, 0.16), blobGeometry(3, 0.1)];
    const ragged = [raggedConeGeometry(1), raggedConeGeometry(2), raggedConeGeometry(3)];
    const sprigGeo = new THREE.PlaneGeometry(0.6, 0.5);
    sprigGeo.translate(0, 0.1, 0);
    const bladeGeo = new THREE.PlaneGeometry(0.55, 0.42);
    bladeGeo.translate(0, 0.21, 0);
    const sprigs = [], blades = [];
    const stones = new GeoBuilder(), lips = new GeoBuilder();
    const snowy = map.theme === 'snow';
    const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 22);
    const coneGeo = new THREE.ConeGeometry(1, 1, 9);
    const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 16);
    const hubGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.26, 12);
    const cyl = new THREE.CylinderGeometry(0.32, 0.32, 1.0, 14);
    const trunkSeg = new THREE.CylinderGeometry(0.16, 0.22, 1, 8);
    const leafGeo = new THREE.PlaneGeometry(3.2, 1.0, 4, 1);
    // bend the leaf downwards along its length
    {
      const p = leafGeo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i) + 1.6;
        p.setX(i, x);
        p.setZ(i, -0.12 * x * x);
      }
      leafGeo.rotateX(-Math.PI / 2);
      leafGeo.computeVertexNormals();
    }
    const white = new THREE.Color('#ffffff');
    for (const d of map.deco) {
      if (d.k === 'barrel') {
        barrels.push({ geo: cyl, matrix: mtx(d.x, (d.y || 0) + 0.5, d.z), color: colorOf(BARREL[d.c % 3]) });
      } else if (d.k === 'car') {
        this.addCar(cars, wheels, wheelGeo, hubGeo, d);
      } else if (d.k === 'wreck') {
        this.addWreck(cars, wheels, wheelGeo, d);
      } else if (d.k === 'truck') {
        this.addTruck(cars, wheels, wheelGeo, d);
      } else if (d.k === 'cbox') {
        this.addContainerTrim(steel, paint, d);
      } else if (d.k === 'portal') {
        this.addPortal(steel, paint, root, d);
      } else if (d.k === 'rig') {
        this.addRig(cars, steel, paint, wheels, wheelGeo, d);
      } else if (d.k === 'forklift') {
        if (d.id === undefined) this.addForklift(steel, paint, wheels, wheelGeo, d);
      } else if (d.k === 'golfcart') {
        if (d.id === undefined) this.addGolfCart(steel, paint, wheels, wheelGeo, d);
      } else if (d.k === 'tree') {
        this.addTree(trunks, canopies, trunkSeg, blobs, d);
      } else if (d.k === 'topiary') {
        // a clipped ball on a stem, a smaller one on top
        canopies.push({ geo: blobs[2], matrix: mtx(d.x, (d.y || 0) + 0.3 + d.r, d.z, 0, 0.7, 0, d.r, d.r * 0.92, d.r), color: colorOf('#2f6b2e') });
        canopies.push({ geo: blobs[1], matrix: mtx(d.x, (d.y || 0) + 0.3 + d.r * 2.2, d.z, 0, 2.1, 0, d.r * 0.5, d.r * 0.45, d.r * 0.5), color: colorOf('#356f32') });
        trunks.push({ geo: trunkSeg, matrix: mtx(d.x, (d.y || 0) + 0.2, d.z, 0, 0, 0, 0.35, 0.5, 0.35), color: colorOf('#5a3f2a') });
        trunks.push({ geo: trunkSeg, matrix: mtx(d.x, (d.y || 0) + 0.3 + d.r * 1.75, d.z, 0, 0, 0, 0.3, d.r * 0.6, 0.3), color: colorOf('#5a3f2a') });
      } else if (d.k === 'bush') {
        this.addBush(canopies, sprigs, blobs, sprigGeo, d, snowy);
      } else if (d.k === 'grass') {
        // a clump of tufts, each a pair of crossed blades
        const n = d.n || 5;
        const cols = d.c === 1 ? ['#c9b36a', '#b8a455', '#d7c58a'] : ['#6f9a3c', '#86b04a', '#5c8a33'];
        for (let i = 0; i < n; i++) {
          const a = jit(d.x, i, d.z, 1) * 6.28, r = 0.2 + jit(d.x, i, d.z, 2) * 1.0;
          const x = d.x + Math.cos(a) * r, z = d.z + Math.sin(a) * r;
          const sc = 0.7 + jit(d.x, i, d.z, 3) * 0.6;
          const col = colorOf(cols[i % 3]);
          blades.push({ geo: bladeGeo, matrix: mtx(x, d.y || 0, z, 0, a, 0, sc, sc, sc), color: col });
          blades.push({ geo: bladeGeo, matrix: mtx(x, d.y || 0, z, 0, a + 1.57, 0, sc, sc, sc), color: col });
        }
      } else if (d.k === 'cliff') {
        this.addCliff(stones, lips, d);
      } else if (d.k === 'stone') {
        const sz = d.s || 0.5;
        stones.rock(d.x, (d.y || 0) + sz * 0.38, d.z, sz, sz * 0.42, sz * 0.72, d.yaw || 0, Object.assign(colorOf(snowy ? '#cfd3d8' : '#d9cdb4'), { ao: false }), 3.0,
          { amp: sz * 0.3, seg: sz * 0.55, maxSeg: 4, seed: Math.round(d.x * 3 + d.z * 5), skipBottom: true });
      } else if (d.k === 'statue') {
        this.addStatue(figures, d);
      } else if (d.k === 'painting') {
        this.addPainting(root, paint, d);
      } else if (d.k === 'chandelier') {
        this.addChandelier(brass, glow, d);
      } else if (d.k === 'books') {
        // rows of spines down the face of a bookcase
        const yaw = d.yaw || 0;
        const c = Math.cos(yaw), s = Math.sin(yaw);
        for (let row = 0; row < 5; row++) {
          for (let k = 0; k < d.w / 0.16; k++) {
            const u = -d.w / 2 + 0.1 + k * 0.16;
            const px = d.x + c * u, pz = d.z - s * u;
            const [ox, oz] = [s * 0.24, c * 0.24];
            paint.box(px + ox, (d.y || 0) + 0.35 + row * 0.5, pz + oz, 0.06, 0.16, 0.04, yaw, colorOf(BOOK_TINTS[(k + row) % BOOK_TINTS.length]), 1);
          }
        }
      } else if (d.k === 'net') {
        const yaw = d.yaw || 0;
        const c = Math.cos(yaw), s = Math.sin(yaw);
        for (const sx of [-1, 1]) {
          const u = sx * d.w / 2;
          steel.box(d.x + c * u, 0.55, d.z - s * u, 0.05, 0.55, 0.05, yaw, colorOf('#2b2e32'), 1);
        }
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(d.w, 0.9), new THREE.MeshLambertMaterial({ color: '#2a2a2a', side: THREE.DoubleSide, transparent: true, opacity: 0.55 }));
        mesh.position.set(d.x, 0.5, d.z);
        mesh.rotation.y = yaw;
        root.add(mesh);
        paint.box(d.x, 0.96, d.z, d.w / 2, 0.02, 0.01, yaw, colorOf('#f3f1e6'), 1);
      } else if (d.k === 'tank') {
        const ty = d.y || 0;
        tanks.push({ geo: unitCyl, matrix: mtx(d.x, ty + d.h / 2, d.z, 0, 0, 0, d.r, d.h, d.r), color: colorOf('#c9c4b8') });
        tanks.push({ geo: unitCyl, matrix: mtx(d.x, ty + d.h * 0.72, d.z, 0, 0, 0, d.r * 1.015, 0.35, d.r * 1.015), color: colorOf('#b8352a') });
        tanks.push({ geo: unitCyl, matrix: mtx(d.x, ty + d.h + 0.08, d.z, 0, 0, 0, d.r * 1.03, 0.16, d.r * 1.03), color: colorOf('#8d8a84') });
        // a ladder up the side
        for (let y = 0.3; y < d.h - 0.2; y += 0.35) steel.box(d.x + d.r + 0.18, ty + y, d.z, 0.18, 0.02, 0.02, 0, colorOf('#5b636c'), 1);
        steel.box(d.x + d.r + 0.18, ty + d.h / 2, d.z + 0.2, 0.03, d.h / 2, 0.03, 0, colorOf('#5b636c'), 1);
        steel.box(d.x + d.r + 0.18, ty + d.h / 2, d.z - 0.2, 0.03, d.h / 2, 0.03, 0, colorOf('#5b636c'), 1);
      } else if (d.k === 'mast') {
        const my = d.y || 0;
        steel.box(d.x, my + d.h - 0.35, d.z, 0.7, 0.16, 0.28, 0, colorOf('#3a3f45'), 1);
        for (const dx of [-0.35, 0.35]) paint.box(d.x + dx, my + d.h - 0.35, d.z + 0.3, 0.22, 0.12, 0.01, 0, colorOf('#fff6d8', 1.4), 1);
      } else if (d.k === 'crane') {
        this.addCrane(steel, paint, d);
      } else if (d.k === 'lines') {
        paint.box(d.x, d.y || 0.02, d.z, 0.07, 0.008, d.l / 2, d.yaw || 0, colorOf('#f3f1e6'), 1);
      } else if (d.k === 'helipad') {
        const g = new THREE.CircleGeometry(d.r, 40);
        g.rotateX(-Math.PI / 2);
        const pad = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: '#5a5d61', polygonOffset: true, polygonOffsetFactor: -1 }));
        pad.position.set(d.x, (d.y || 0) + 0.02, d.z);
        pad.receiveShadow = true;
        root.add(pad);
        const lg = new THREE.PlaneGeometry(d.r * 1.4, d.r * 1.4);
        lg.rotateX(-Math.PI / 2);
        const lm = new THREE.MeshBasicMaterial({ map: T.siteDecal('H', '#f3f1e6'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, fog: true });
        lm.userData.own = true;
        const label = new THREE.Mesh(lg, lm);
        label.position.set(d.x, (d.y || 0) + 0.035, d.z);
        label.renderOrder = 1;
        root.add(label);
      } else if (d.k === 'radome') {
        const drum = new THREE.CylinderGeometry(d.r * 0.72, d.r * 0.8, 1.0, 28, 1, true);
        domes.push({ geo: drum, matrix: mtx(d.x, d.y + 0.5, d.z), color: colorOf('#bfc2c4') });
        const sph = new THREE.SphereGeometry(d.r, 30, 20);
        domes.push({ geo: sph, matrix: mtx(d.x, d.y + 0.9 + d.r * 0.82, d.z), color: colorOf('#f4f4f0') });
      } else if (d.k === 'tower') {
        this.addTower(steel, paint, d);
      } else if (d.k === 'generator') {
        const c = Math.cos(d.yaw), s = Math.sin(d.yaw), gy = d.y || 0;
        const W = (lx, lz) => [d.x + c * lx + s * lz, d.z - s * lx + c * lz];
        const [ex, ez] = W(-1.1, 0.4);
        steel.box(ex, gy + 2.05, ez, 0.08, 0.5, 0.08, d.yaw, colorOf('#3a3f45'), 1);          // exhaust stack
        for (let i = 0; i < 5; i++) {                                                     // vent louvres
          const [vx, vz] = W(-0.9 + i * 0.35, 0.82);
          steel.box(vx, gy + 1.05, vz, 0.12, 0.28, 0.02, d.yaw, colorOf('#2e3236'), 1);
        }
        const [px, pz] = W(1.2, 0);
        paint.box(px, gy + 1.62, pz, 0.12, 0.03, 0.12, d.yaw, colorOf('#d1b83c'), 1);          // fuel cap
      } else if (d.k === 'pine') {
        this.addPine(trunks, cones, trunkSeg, ragged, d, snowy);
      } else if (d.k === 'palm') {
        const segs = 5;
        let x = d.x, z = d.z, y = 0;
        const lean = ((d.s % 360) / 360) * Math.PI * 2;
        const lx = Math.cos(lean), lz = Math.sin(lean);
        const segH = d.h / segs;
        for (let i = 0; i < segs; i++) {
          const k = (i / segs) * 0.35;
          trunks.push({ geo: trunkSeg, matrix: mtx(x + lx * k * 0.25, y + segH / 2, z + lz * k * 0.25, 0, 0, 0, 1 - i * 0.06, segH * 1.02, 1 - i * 0.06),
            color: colorOf(i % 2 ? '#8a6a45' : '#7a5c3b') });
          x += lx * k * 0.5; z += lz * k * 0.5; y += segH;
        }
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2 + d.s;
          leaves.push({ geo: leafGeo, matrix: mtx(x, y, z, 0, a, 0.45 - (i % 3) * 0.2, 1, 1, 1), color: colorOf(i % 2 ? '#e9f0d8' : '#cfdcb8') });
        }
      } else if (d.k === 'dome') {
        const tint = colorOf(d.t % 2 ? '#2f8f8a' : '#f1e9d8');
        const drum = new THREE.CylinderGeometry(d.r * 1.02, d.r * 1.02, 0.9, 32, 1, true);
        domes.push({ geo: drum, matrix: mtx(d.x, d.y + 0.45, d.z), color: colorOf('#efe2c8') });
        const sph = new THREE.SphereGeometry(d.r, 32, 14, 0, Math.PI * 2, 0, Math.PI / 2);
        domes.push({ geo: sph, matrix: mtx(d.x, d.y + 0.9, d.z, 0, 0, 0, 1, 1.15, 1), color: tint });
        const fin = new THREE.CylinderGeometry(0.05, 0.12, 1.2, 6);
        domes.push({ geo: fin, matrix: mtx(d.x, d.y + 0.9 + d.r * 1.15 + 0.5, d.z), color: colorOf('#c9a13b') });
        const ball = new THREE.SphereGeometry(0.18, 10, 8);
        domes.push({ geo: ball, matrix: mtx(d.x, d.y + 0.9 + d.r * 1.15 + 0.9, d.z), color: colorOf('#d8b24a') });
      } else if (d.k === 'minaret') {
        const shaft = new THREE.CylinderGeometry(0.95, 1.1, d.h, 12);
        domes.push({ geo: shaft, matrix: mtx(d.x, d.y + d.h / 2, d.z), color: colorOf('#efe2c8') });
        const bal = new THREE.CylinderGeometry(1.5, 1.2, 0.6, 12);
        domes.push({ geo: bal, matrix: mtx(d.x, d.y + d.h * 0.78, d.z), color: colorOf('#dcc9a6') });
        const top = new THREE.CylinderGeometry(0.75, 0.9, 2.2, 12);
        domes.push({ geo: top, matrix: mtx(d.x, d.y + d.h + 1.1, d.z), color: colorOf('#efe2c8') });
        const cone = new THREE.ConeGeometry(0.9, 2.2, 12);
        domes.push({ geo: cone, matrix: mtx(d.x, d.y + d.h + 3.3, d.z), color: colorOf('#2f8f8a') });
      } else if (d.k === 'awning') {
        const g = new THREE.PlaneGeometry(d.w, 1.5, 1, 1);
        g.rotateX(-Math.PI / 2 + 0.38);
        const m = new THREE.Matrix4().makeRotationY(d.yaw);
        m.setPosition(d.x, d.y, d.z);
        cloth[d.c % CLOTH.length].push({ geo: g, matrix: m, color: white });
      } else if (d.k === 'stall') {
        const m = new THREE.Matrix4().makeRotationY(d.yaw);
        const c = Math.cos(d.yaw), s = Math.sin(d.yaw);
        const pole = new THREE.CylinderGeometry(0.04, 0.04, 2.4, 6);
        for (const [px, pz] of [[-1.4, -0.8], [1.4, -0.8], [-1.4, 0.8], [1.4, 0.8]]) {
          poles.push({ geo: pole, matrix: mtx(d.x + c * px + s * pz, 1.2 + (pz > 0 ? 0.15 : 0), d.z - s * px + c * pz), color: colorOf('#6b4a2b') });
        }
        const roof = new THREE.PlaneGeometry(3.1, 1.9);
        roof.rotateX(-Math.PI / 2 - 0.16);
        const rm = m.clone();
        rm.setPosition(d.x, 2.45, d.z);
        cloth[d.c % CLOTH.length].push({ geo: roof, matrix: rm, color: white });
        // goods on the table
        const gcol = [['#d2502f', '#e08a2f', '#a8342a'], ['#e8c36a', '#c79a3b', '#f0d890'], ['#6f8f3a', '#9ab24a', '#4f6f2a']][d.g % 3];
        for (let i = 0; i < 6; i++) {
          const gx = -1.0 + (i % 3) * 1.0, gz = i < 3 ? -0.22 : 0.22;
          const sg = new THREE.SphereGeometry(0.22, 8, 6);
          goods.push({ geo: sg, matrix: mtx(d.x + c * gx + s * gz, 0.98, d.z - s * gx + c * gz, 0, 0, 0, 1, 0.55, 1), color: colorOf(gcol[i % 3]) });
        }
      } else if (d.k === 'hatch') {
        // a timber rim round the hole, and a ladder down the shaft
        const wood = new THREE.MeshLambertMaterial({ map: tx.wood });
        const r = d.r, lip = 0.12;
        for (const [ox, oz, sx, sz] of [[0, -r, r + lip, lip], [0, r, r + lip, lip], [-r, 0, lip, r], [r, 0, lip, r]]) {
          const rim = new THREE.Mesh(new THREE.BoxGeometry(sx * 2, 0.12, sz * 2), wood);
          rim.position.set(d.x + ox, 0.06, d.z + oz);
          rim.castShadow = true;
          root.add(rim);
        }
        const steel = new THREE.MeshLambertMaterial({ color: '#6a6f75' });
        const h = -d.d;
        for (const ox of [-0.22, 0.22]) {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, h, 0.06), steel);
          rail.position.set(d.x - r + 0.16, d.d + h / 2, d.z + ox);
          root.add(rail);
        }
        for (let y = d.d + 0.3; y < -0.1; y += 0.34) {
          const rung = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.5), steel);
          rung.position.set(d.x - r + 0.16, y, d.z);
          root.add(rung);
        }
      } else if (d.k === 'light') {
        this.addLamp(root, d);
      } else if (d.k === 'lamp') {
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffdc9a' }));
        bulb.position.set(d.x, d.y, d.z);
        root.add(bulb);
        const shade = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.3, 12, 1, true), new THREE.MeshLambertMaterial({ color: '#3a3a36', side: THREE.DoubleSide }));
        shade.position.set(d.x, d.y + 0.15, d.z);
        root.add(shade);
        const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.6, 4), new THREE.MeshBasicMaterial({ color: '#1a1a1a' }));
        cord.position.set(d.x, d.y + 0.6, d.z);
        root.add(cord);
      } else if (d.k === 'sign') {
        const c = document.createElement('canvas');
        c.width = d.big ? 512 : 256; c.height = 96;
        const g = c.getContext('2d');
        g.fillStyle = d.big ? '#2f5f5a' : '#e9dcc3';
        g.fillRect(0, 0, c.width, 96);
        g.fillStyle = d.big ? '#f1e3c0' : '#2a2016';
        g.font = `700 ${d.big ? 40 : 60}px "Reem Kufi", "Arial Black", sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(d.text, c.width / 2, 52);
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        const mat = new THREE.MeshLambertMaterial({ map: tex, emissive: '#221a10' });
        mat.userData.own = true;
        const plate = new THREE.Mesh(new THREE.PlaneGeometry(d.big ? 4.4 : 1.6, d.big ? 0.83 : 0.6), mat);
        if (d.big) {
          // hung from the first arch downrange, facing the shooters
          plate.position.set(d.x, 3.7, -8.6);
        } else {
          plate.position.set(d.x + 8.55, 2.2, d.z);
          plate.rotation.y = -Math.PI / 2;
        }
        root.add(plate);
      } else if (d.k === 'road') {
        this.addRoad(root, d);
      } else if (d.k === 'checker') {
        this.addChecker(root, d);
      } else if (d.k === 'ground') {
        // a patch of different ground under a whole quarter of the royale map
        const g = new THREE.PlaneGeometry(d.w, d.d);
        g.rotateX(-Math.PI / 2);
        const kind = d.c === 'concrete' ? 'concrete' : d.c === 'grass' ? 'grass' : d.c === 'snow' ? 'snow' : 'ground';
        const t = tx[kind].clone(), tn = tx[kind + 'N'].clone();
        t.repeat.set(d.w / 9, d.d / 9); tn.repeat.set(d.w / 9, d.d / 9);
        t.needsUpdate = true; tn.needsUpdate = true;
        const m = new THREE.Mesh(g, new THREE.MeshPhongMaterial({ map: t, normalMap: tn, normalScale: NORMAL_SCALE[kind], specular: '#111111', shininess: 4, polygonOffset: true, polygonOffsetFactor: -0.5 }));
        m.material.userData.own = true;
        m.position.set(d.x, 0.012, d.z);
        m.receiveShadow = true;
        root.add(m);
      } else if (d.k === 'pond') {
        const water = new THREE.Mesh(new THREE.CircleGeometry(d.r, 48), new THREE.MeshPhongMaterial({ color: '#2f7f8f', shininess: 90, specular: '#cfefff', transparent: true, opacity: 0.88 }));
        water.rotation.x = -Math.PI / 2;
        water.position.set(d.x, 0.05, d.z);
        root.add(water);
        const rim = new THREE.Mesh(new THREE.RingGeometry(d.r - 0.05, d.r + 1.1, 48), new THREE.MeshLambertMaterial({ color: '#8a7250' }));
        rim.rotation.x = -Math.PI / 2;
        rim.position.set(d.x, 0.035, d.z);
        rim.receiveShadow = true;
        root.add(rim);
      } else if (d.k === 'pool') {
        // pale tiles under clear blue water, lane lines down the middle
        const tiles = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.d), new THREE.MeshLambertMaterial({ map: tx.tiles, color: '#bfe2ea' }));
        tiles.material.map = tx.tiles.clone();
        tiles.material.map.repeat.set(d.w / 1.5, d.d / 1.5);
        tiles.material.map.needsUpdate = true;
        tiles.rotation.x = -Math.PI / 2;
        tiles.position.set(d.x, 0.035, d.z);
        root.add(tiles);
        const water = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.d), new THREE.MeshPhongMaterial({ color: '#3f9fd0', shininess: 110, specular: '#dff6ff', transparent: true, opacity: 0.72 }));
        water.rotation.x = -Math.PI / 2;
        water.position.set(d.x, 0.07, d.z);
        root.add(water);
        for (const dz of [-d.d / 4, 0, d.d / 4]) paint.box(d.x, 0.045, d.z + dz, d.w / 2 - 0.3, 0.005, 0.06, 0, colorOf('#1f4f80'), 1);
      } else if (d.k === 'paving' || d.k === 'scorch' || d.k === 'rug') {
        this.addDecal(root, d);
      } else if (d.k === 'well') {
        const stone = new THREE.MeshLambertMaterial({ map: tx.stone, color: '#e8dcc6' });
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.0, 1.0, 20), stone);
        ring.position.set(d.x, 0.5, d.z);
        ring.castShadow = true;
        root.add(ring);
        const hole = new THREE.Mesh(new THREE.CircleGeometry(0.72, 20), new THREE.MeshBasicMaterial({ color: '#10141a' }));
        hole.rotation.x = -Math.PI / 2;
        hole.position.set(d.x, 1.005, d.z);
        root.add(hole);
        const woodM = new THREE.MeshLambertMaterial({ map: tx.wood });
        for (const sx of [-0.85, 0.85]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.2, 0.12), woodM);
          post.position.set(d.x + sx, 1.1, d.z);
          root.add(post);
        }
        const beam = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 0.12), woodM);
        beam.position.set(d.x, 2.1, d.z);
        root.add(beam);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.8, 4), new THREE.MeshLambertMaterial({ color: '#a4452f' }));
        roof.position.set(d.x, 2.55, d.z);
        roof.rotation.y = Math.PI / 4;
        roof.castShadow = true;
        root.add(roof);
      } else if (d.k === 'clock') {
        const face = new THREE.MeshLambertMaterial({ map: T.clockFace(), emissive: '#2a2418' });
        face.userData.own = true;
        const c = Math.cos(d.yaw), s = Math.sin(d.yaw);
        for (let i = 0; i < 4; i++) {
          const a = d.yaw + (i * Math.PI) / 2;
          const m = new THREE.Mesh(new THREE.CircleGeometry(1.15, 32), face);
          m.position.set(d.x + Math.sin(a) * 1.72, d.y - 2.2, d.z + Math.cos(a) * 1.72);
          m.rotation.y = a;
          root.add(m);
        }
        const cap = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.4, 3.8), new THREE.MeshLambertMaterial({ map: tx.plaster, color: '#d9c4a0' }));
        cap.position.set(d.x, d.y + 0.2, d.z);
        cap.rotation.y = d.yaw;
        root.add(cap);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(2.6, 3.4, 4), new THREE.MeshLambertMaterial({ color: '#2f8f8a' }));
        roof.position.set(d.x, d.y + 2.1, d.z);
        roof.rotation.y = d.yaw + Math.PI / 4;
        roof.castShadow = true;
        root.add(roof);
        void c; void s;
      } else if (d.k === 'watertower') {
        const metalM = new THREE.MeshLambertMaterial({ map: tx.metal, color: '#8a6a4a' });
        for (const sx of [-1.6, 1.6]) {
          for (const sz of [-1.6, 1.6]) {
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, d.h, 8), metalM);
            leg.position.set(d.x + sx, d.h / 2, d.z + sz);
            leg.castShadow = true;
            root.add(leg);
          }
        }
        for (const y of [2.5, 5.5]) {
          for (const [ax, az, len, ry] of [[0, -1.6, 3.2, 0], [0, 1.6, 3.2, 0], [-1.6, 0, 3.2, Math.PI / 2], [1.6, 0, 3.2, Math.PI / 2]]) {
            const b = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.08), metalM);
            b.position.set(d.x + ax, y, d.z + az);
            b.rotation.y = ry;
            root.add(b);
          }
        }
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 3.2, 24), new THREE.MeshLambertMaterial({ map: tx.metal, color: '#5f9a93' }));
        tank.position.set(d.x, d.h + 1.6, d.z);
        tank.castShadow = true;
        root.add(tank);
        const top = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.2, 24), new THREE.MeshLambertMaterial({ color: '#4a7a74' }));
        top.position.set(d.x, d.h + 3.8, d.z);
        root.add(top);
      } else if (d.k === 'column') {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, d.h, 12), new THREE.MeshLambertMaterial({ map: tx.stone, color: '#efe2c8' }));
        col.position.set(d.x, d.h / 2, d.z);
        col.castShadow = true;
        col.receiveShadow = true;
        root.add(col);
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.3, 0.85), new THREE.MeshLambertMaterial({ map: tx.stone }));
        base.position.set(d.x, 0.15, d.z);
        root.add(base);
      } else if (d.k === 'lanterns') {
        const [ax, az] = d.a, [bx, bz] = d.b;
        const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, Math.hypot(bx - ax, bz - az), 4), new THREE.MeshBasicMaterial({ color: '#2a2016' }));
        wire.position.set((ax + bx) / 2, 3.4, (az + bz) / 2);
        wire.rotation.set(0, Math.atan2(bx - ax, bz - az), 0);
        wire.rotateX(Math.PI / 2);
        root.add(wire);
        const cols = ['#ffcf6a', '#ff8a5a', '#9fe36a', '#6ad0ff'];
        for (let i = 0; i <= 10; i++) {
          const t = i / 10;
          const l = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshBasicMaterial({ color: cols[i % 4] }));
          l.position.set(ax + (bx - ax) * t, 3.25 - Math.sin(t * Math.PI) * 0.35, az + (bz - az) * t);
          root.add(l);
        }
        for (const [px, pz] of [[ax, az], [bx, bz]]) {
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.5, 6), new THREE.MeshLambertMaterial({ color: '#5a4630' }));
          pole.position.set(px, 1.75, pz);
          root.add(pole);
        }
      } else if (d.k === 'site') {
        const g = new THREE.PlaneGeometry(d.r * 2, d.r * 2);
        g.rotateX(-Math.PI / 2);
        const mat = new THREE.MeshBasicMaterial({ map: T.siteDecal(d.l, '#c23a2b'), transparent: true, depthWrite: false,
          polygonOffset: true, polygonOffsetFactor: -2, fog: true });
        mat.userData.own = true;
        const mesh = new THREE.Mesh(g, mat);
        mesh.position.set(d.x, (d.y || 0) + 0.03, d.z);
        mesh.renderOrder = 1;
        root.add(mesh);
      }
    }
    const add = (list, mat, shadow = true) => {
      if (!list.length) return;
      const mesh = new THREE.Mesh(mergeInto(list), mat);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      root.add(mesh);
    };
    add(barrels, new THREE.MeshLambertMaterial({ map: tx.metal, vertexColors: true }));
    add(wheels, new THREE.MeshLambertMaterial({ vertexColors: true }));
    add(tanks, new THREE.MeshLambertMaterial({ map: tx.metal, vertexColors: true }));
    add(cones, new THREE.MeshLambertMaterial({ vertexColors: true }));
    for (const [gb, mat] of [[steel, new THREE.MeshLambertMaterial({ map: tx.metal, vertexColors: true })], [paint, new THREE.MeshLambertMaterial({ vertexColors: true })]]) {
      if (gb.empty) continue;
      const mesh = new THREE.Mesh(gb.geometry(), mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
    }
    unitCyl.dispose(); coneGeo.dispose();
    if (!cars.empty) {
      const mesh = new THREE.Mesh(cars.geometry(), new THREE.MeshLambertMaterial({ map: tx.metal, vertexColors: true }));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
    }
    wheelGeo.dispose(); hubGeo.dispose();
    add(trunks, new THREE.MeshLambertMaterial({ vertexColors: true }));
    add(canopies, new THREE.MeshLambertMaterial({ vertexColors: true }));
    add(figures, new THREE.MeshLambertMaterial({ vertexColors: true }));
    add(brass, new THREE.MeshLambertMaterial({ vertexColors: true }));
    add(glow, new THREE.MeshBasicMaterial({ vertexColors: true }), false);
    canopyGeo.dispose();
    add(leaves, new THREE.MeshLambertMaterial({ map: tx.leaf, vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.5 }));
    add(sprigs, new THREE.MeshLambertMaterial({ map: tx.tuft, vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.5 }), false);
    add(blades, new THREE.MeshLambertMaterial({ map: tx.grassTuft, vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.5 }), false);
    if (!stones.empty) {
      const mesh = new THREE.Mesh(stones.geometry(), new THREE.MeshLambertMaterial({ map: tx.rock, vertexColors: true }));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
    }
    if (!lips.empty) {
      // the snow on top of the cliff, running back under the shelf
      const mesh = new THREE.Mesh(lips.geometry(), new THREE.MeshLambertMaterial({ map: tx.snow, vertexColors: true }));
      mesh.receiveShadow = true;
      root.add(mesh);
    }
    for (const g of blobs) g.dispose();
    for (const g of ragged) g.dispose();
    sprigGeo.dispose(); bladeGeo.dispose();
    add(domes, new THREE.MeshLambertMaterial({ map: tx.plaster, vertexColors: true }));
    add(poles, new THREE.MeshLambertMaterial({ vertexColors: true }));
    add(goods, new THREE.MeshLambertMaterial({ vertexColors: true }));
    cloth.forEach((list, i) => add(list, new THREE.MeshLambertMaterial({ map: tx.cloth[i], side: THREE.DoubleSide, vertexColors: true })));
    cyl.dispose(); trunkSeg.dispose(); leafGeo.dispose();
  }

  // a parked car: body, bonnet and boot, a glazed cabin, bumpers, lights
  // and four wheels. Sits exactly over the two collision boxes mapgen laid.
  addCar(cars, wheels, wheelGeo, hubGeo, d) {
    const yaw = d.yaw || 0;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const W = (lx, lz) => [d.x + c * lx + s * lz, d.z - s * lx + c * lz];
    const paint = colorOf(CAR_TINTS[(d.c || 0) % CAR_TINTS.length]);
    const dark = colorOf('#2a2a2e');
    const glass = colorOf('#5d7f96', 0.9);
    const box = (lx, ly, lz, hx, hy, hz, color, extraYaw = 0) => {
      const [x, z] = W(lx, lz);
      cars.box(x, ly, z, hx, hy, hz, yaw + extraYaw, color, 2);
    };
    // lower body, from wheel height to the window line
    box(0, 0.66, 0, 2.05, 0.3, 0.86, paint);
    // sills and wheel arches: a darker skirt under the doors
    box(0, 0.4, 0, 1.95, 0.06, 0.88, dark);
    // bonnet slopes up to the windscreen; boot is a little lower
    box(1.55, 0.98, 0, 0.55, 0.05, 0.84, paint);
    box(-1.65, 0.99, 0, 0.45, 0.04, 0.84, paint);
    // cabin: glass all round, painted pillars and roof
    box(-0.2, 1.23, 0, 1.0, 0.24, 0.76, glass);
    box(-0.2, 1.23, 0, 1.02, 0.24, 0.05, dark);              // a centre pillar line
    box(-0.2, 1.5, 0, 1.03, 0.05, 0.8, paint);               // roof
    box(0.86, 1.23, 0, 0.06, 0.24, 0.8, dark, 0);             // windscreen frame
    box(-1.26, 1.23, 0, 0.06, 0.24, 0.8, dark, 0);            // rear window frame
    // bumpers, headlights and tail lights
    box(2.08, 0.5, 0, 0.08, 0.1, 0.86, dark);
    box(-2.08, 0.5, 0, 0.08, 0.1, 0.86, dark);
    box(2.06, 0.78, 0.58, 0.03, 0.07, 0.14, colorOf('#fff2c0', 1.3));
    box(2.06, 0.78, -0.58, 0.03, 0.07, 0.14, colorOf('#fff2c0', 1.3));
    box(-2.06, 0.78, 0.58, 0.03, 0.06, 0.14, colorOf('#d8352a', 1.2));
    box(-2.06, 0.78, -0.58, 0.03, 0.06, 0.14, colorOf('#d8352a', 1.2));
    // wing mirrors and door handles
    box(0.75, 1.1, 0.92, 0.06, 0.04, 0.06, paint);
    box(0.75, 1.1, -0.92, 0.06, 0.04, 0.06, paint);
    box(0.1, 0.9, 0.87, 0.1, 0.02, 0.02, dark);
    box(-0.9, 0.9, 0.87, 0.1, 0.02, 0.02, dark);
    box(0.1, 0.9, -0.87, 0.1, 0.02, 0.02, dark);
    box(-0.9, 0.9, -0.87, 0.1, 0.02, 0.02, dark);
    // wheels: rubber tyre and a lighter hub, axles across the car
    for (const lx of [1.3, -1.3]) {
      for (const lz of [0.9, -0.9]) {
        const [x, z] = W(lx, lz);
        wheels.push({ geo: wheelGeo, matrix: mtx(x, 0.34, z, Math.PI / 2, yaw, 0), color: colorOf('#1d1d1f') });
        wheels.push({ geo: hubGeo, matrix: mtx(x, 0.34, z, Math.PI / 2, yaw, 0), color: colorOf('#a9a9a3') });
      }
    }
  }

  // the burnt-out truck at the wreck landmark: a charred hull on its wheels,
  // a cab knocked askew and an exhaust stack, over the same three collision boxes
  addWreck(cars, wheels, wheelGeo, d) {
    const yaw = d.yaw || 0;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const W = (lx, lz, extra = 0) => {
      const cc = Math.cos(yaw + extra), ss = Math.sin(yaw + extra);
      return [d.x + cc * lx + ss * lz, d.z - ss * lx + cc * lz];
    };
    const char = colorOf('#2a2523');
    const rust = colorOf('#5a3a28');
    const box = (lx, ly, lz, hx, hy, hz, color, extra = 0) => {
      const [x, z] = W(lx, lz, extra);
      cars.box(x, ly, z, hx, hy, hz, yaw + extra, color, 2);
    };
    // hull (the long way runs along local z here, as the collision box does)
    box(0, 0.75, 0, 1.7, 0.72, 3.1, char);
    box(0, 1.5, 0.4, 1.55, 0.06, 2.5, rust);                  // scorched flatbed edge
    for (let i = 0; i < 4; i++) box(0, 1.6, -1.6 + i * 1.1, 1.62, 0.12, 0.08, rust);   // ribs across the bed
    // cab, knocked a quarter turn askew, with dark window holes
    const [cx, cz] = W(0, -0.3);
    const cab = (lx, ly, lz, hx, hy, hz, color) => {
      const cc = Math.cos(yaw + 0.25), ss = Math.sin(yaw + 0.25);
      cars.box(cx + cc * lx + ss * lz, ly, cz - ss * lx + cc * lz, hx, hy, hz, yaw + 0.25, color, 2);
    };
    cab(0, 1.9, 0, 1.1, 0.4, 1.3, char);
    cab(0, 1.95, -1.31, 0.9, 0.25, 0.03, colorOf('#0d0d0f'));
    cab(1.11, 1.95, 0, 0.03, 0.25, 0.9, colorOf('#0d0d0f'));
    cab(-1.11, 1.95, 0, 0.03, 0.25, 0.9, colorOf('#0d0d0f'));
    // exhaust stack
    const [px, pz] = W(0.2, -3.3, 0.25);
    cars.box(px, 1.95, pz, 0.12, 0.12, 1.8, yaw + 0.25, rust, 2);
    // wheels, blackened, axles across the hull
    for (const lz of [2.0, -2.0]) {
      for (const lx of [1.7, -1.7]) {
        const [x, z] = W(lx, lz);
        wheels.push({ geo: wheelGeo, matrix: mtx(x, 0.34, z, Math.PI / 2, yaw + Math.PI / 2, 0, 1.3, 1, 1.3), color: colorOf('#161617') });
      }
    }
  }

  // an articulated truck: a cab up front and a box trailer on its wheels behind,
  // with the rear doors open on some. The collision boxes are laid by mapgen.
  addRig(cars, steel, paint, wheels, wheelGeo, d) {
    const yaw = d.yaw || 0;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const W = (lx, lz) => [d.x + c * lx + s * lz, d.z - s * lx + c * lz];
    const TL = 6.6, TH = 1.35, TW = 1.25, FLOOR = 1.15;
    const paintCol = colorOf(['#b03a2e', '#2f5f8f', '#e0e0d8', '#3c6b3c'][Math.abs(Math.round(d.x + d.z)) % 4]);
    const white = colorOf('#e8e8e2');
    const dark = colorOf('#26292c');
    const box = (gb, lx, ly, lz, hx, hy, hz, color) => {
      const [x, z] = W(lx, lz);
      gb.box(x, ly, z, hx, hy, hz, yaw, color, 2);
    };
    // tractor
    box(cars, TL + 2.3, 0.9, 0, 2.2, 0.35, 1.15, dark);              // chassis
    box(cars, TL + 3.1, 2.15, 0, 1.25, 0.9, 1.2, paintCol);          // cab
    box(cars, TL + 4.36, 2.35, 0, 0.03, 0.5, 1.0, colorOf('#0f1114'));   // windscreen
    box(cars, TL + 3.1, 2.35, 1.21, 0.9, 0.4, 0.02, colorOf('#0f1114'));
    box(cars, TL + 3.1, 2.35, -1.21, 0.9, 0.4, 0.02, colorOf('#0f1114'));
    box(cars, TL + 4.45, 1.0, 0, 0.1, 0.2, 1.2, dark);               // bumper
    box(steel, TL + 1.6, 3.3, 0.6, 0.12, 0.7, 0.12, colorOf('#8f949a'));   // exhaust stacks
    box(steel, TL + 1.6, 3.3, -0.6, 0.12, 0.7, 0.12, colorOf('#8f949a'));
    box(cars, TL + 1.4, 1.4, 0, 0.9, 0.15, 1.0, dark);               // fifth wheel plate
    // trailer body (open ones are hollow: walls only)
    if (d.open) {
      box(steel, 0, FLOOR - 0.1, 0, TL, 0.1, TW, white);
      box(steel, 0, FLOOR + 2 * TH, 0, TL, 0.08, TW, white);
      box(steel, 0, FLOOR + TH, TW - 0.08, TL, TH, 0.08, white);
      box(steel, 0, FLOOR + TH, -TW + 0.08, TL, TH, 0.08, white);
      box(steel, TL - 0.08, FLOOR + TH, 0, 0.08, TH, TW, white);
      box(steel, -TL - 1.2, FLOOR + TH, TW + 0.06, 1.2, TH, 0.04, white);
      box(steel, -TL - 1.2, FLOOR + TH, -TW - 0.06, 1.2, TH, 0.04, white);
    } else {
      box(steel, 0, FLOOR + TH, 0, TL, TH, TW, white);
      // door seams at the back
      box(steel, -TL - 0.01, FLOOR + TH, 0, 0.01, TH - 0.1, 0.02, dark);
      for (const lz of [-0.6, 0.6]) box(steel, -TL - 0.03, FLOOR + TH, lz, 0.02, TH - 0.2, 0.05, dark);
    }
    // rails, underframe and landing legs
    box(cars, 0, FLOOR - 0.3, 0, TL - 0.2, 0.15, TW - 0.1, dark);
    box(cars, TL - 1.2, 0.55, 0.7, 0.08, 0.5, 0.08, dark);
    box(cars, TL - 1.2, 0.55, -0.7, 0.08, 0.5, 0.08, dark);
    box(cars, 0, FLOOR - 0.45, TW - 0.05, TL - 0.5, 0.06, 0.03, colorOf('#c8352a'));   // marker rails
    box(cars, 0, FLOOR - 0.45, -TW + 0.05, TL - 0.5, 0.06, 0.03, colorOf('#c8352a'));
    for (const lx of [-TL + 1.3, -TL + 2.6, TL + 1.2, TL + 3.7]) {
      for (const lz of [1.1, -1.1]) {
        const [x, z] = W(lx, lz);
        wheels.push({ geo: wheelGeo, matrix: mtx(x, 0.5, z, Math.PI / 2, yaw, 0, 1.5, 1.4, 1.5), color: colorOf('#1d1d1f') });
      }
    }
  }

  // a tunnel mouth in the boundary: a concrete frame round a black opening, so
  // a road that reaches the edge looks as if it carries on underground
  addPortal(steel, paint, root, d) {
    const yaw = d.yaw || 0;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const W = (lx, lz) => [d.x + c * lx + s * lz, d.z - s * lx + c * lz];
    const y0 = d.y || 0;
    const hw = d.w / 2, H = d.h;
    const frame = colorOf('#77787a');
    // posts and a header standing proud of the face (the face runs along local x, the opening faces -z... 
    // i.e. towards where the road comes from, which is +z in local terms)
    for (const lx of [-hw - 0.4, hw + 0.4]) {
      const [x, z] = W(lx, 0.25);
      steel.box(x, y0 + H / 2 + 0.3, z, 0.4, H / 2 + 0.3, 0.45, yaw, frame, 2.0);
    }
    const [hx, hz] = W(0, 0.25);
    steel.box(hx, y0 + H + 0.35, hz, hw + 0.8, 0.35, 0.45, yaw, frame, 2.0);
    // the black opening, flat against the wall face
    const g = new THREE.PlaneGeometry(d.w, H);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x000000, fog: false }));
    const [px, pz] = W(0, 0.02);
    m.position.set(px, y0 + H / 2, pz);
    m.rotation.y = yaw;
    root.add(m);
    // dark tarmac running in, so the road continues into the dark
    const [rx, rz] = W(0, 0.7);
    paint.box(rx, y0 + 0.015, rz, hw, 0.01, 0.7, yaw, colorOf('#2a2b2e'), 1);
  }

  // the fittings that make a box read as a container: corner castings and
  // posts, top and bottom rails, and a pair of barred doors at each end
  addContainerTrim(steel, paint, d) {
    const yaw = d.yaw || 0;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const W = (lx, lz) => [d.x + c * lx + s * lz, d.z - s * lx + c * lz];
    const hx = d.l, hz = 1.3, H = 2.6;
    const y0 = (d.y || 0) + (d.lv || 0) * H;
    const base = new THREE.Color(CONTAINER_TINTS[(d.t || 0) % 6]);
    const dark = { r: base.r * 0.45, g: base.g * 0.45, b: base.b * 0.45 };
    const P = (lx, ly, lz, ax, ay, az, color, extra = 0) => {
      const [x, z] = W(lx, lz);
      steel.box(x, y0 + ly, z, ax, ay, az, yaw + extra, color, 1);
    };
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) P(sx * (hx - 0.06), H / 2, sz * (hz - 0.06), 0.07, H / 2 + 0.01, 0.07, dark);   // corner posts
      P(0, 0.08, sx * hz, hx, 0.05, 0.03, dark);                  // bottom rails
      P(0, H - 0.08, sx * hz, hx, 0.05, 0.03, dark);              // top rails
      // doors on each end: two leaves, three locking bars each
      for (const lz of [-0.62, -0.2, 0.2, 0.62]) P(sx * (hx + 0.01), H / 2, lz, 0.02, H / 2 - 0.15, 0.035, dark);
      P(sx * (hx + 0.005), H / 2, 0, 0.02, H / 2 - 0.12, 0.012, dark);   // the seam between the leaves
      for (const ly of [0.55, 1.45]) P(sx * (hx + 0.02), ly, 0.4, 0.02, 0.03, 0.09, dark);   // handles
      for (const ly of [0.55, 1.45]) P(sx * (hx + 0.02), ly, -0.4, 0.02, 0.03, 0.09, dark);
    }
    // a faded owner's mark on one side
    const [mx, mz] = W(-hx * 0.55, hz + 0.012);
    paint.box(mx, y0 + H * 0.62, mz, hx * 0.22, 0.28, 0.005, yaw, colorOf('#f0ede4', 0.95), 1);
  }

  // a military truck: chassis, cab and a canvas-covered bed on six wheels
  addTruck(cars, wheels, wheelGeo, d) {
    const yaw = d.yaw || 0;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const W = (lx, lz) => [d.x + c * lx + s * lz, d.z - s * lx + c * lz];
    const olive = colorOf('#4c5a3c');
    const canvas = colorOf('#5f6a48');
    const dark = colorOf('#26292c');
    const box = (lx, ly, lz, hx, hy, hz, color) => {
      const [x, z] = W(lx, lz);
      cars.box(x, ly, z, hx, hy, hz, yaw, color, 2);
    };
    const dy = d.y || 0;
    box(0, dy + 0.85, 0, 3.3, 0.22, 1.05, dark);            // chassis
    box(2.5, dy + 1.55, 0, 1.0, 0.55, 1.15, olive);              // cab
    box(1.52, dy + 1.75, 0, 0.03, 0.3, 0.9, colorOf('#0f1114')); // windscreen
    box(2.5, dy + 1.75, 1.16, 0.7, 0.28, 0.02, colorOf('#0f1114'));
    box(2.5, dy + 1.75, -1.16, 0.7, 0.28, 0.02, colorOf('#0f1114'));
    box(3.35, dy + 1.25, 0, 0.5, 0.35, 1.1, olive);              // bonnet
    box(3.9, dy + 0.95, 0, 0.08, 0.15, 1.15, dark);              // bumper
    box(-0.9, dy + 1.15, 0, 2.3, 0.15, 1.2, olive);              // bed floor
    box(-0.9, dy + 1.95, 0, 2.2, 0.72, 1.2, canvas);             // canvas tilt
    box(-0.9, dy + 2.66, 0, 2.2, 0.03, 1.22, canvas);
    box(-3.15, dy + 1.6, 0, 0.05, 0.4, 1.15, olive);             // tailgate
    for (const lx of [2.6, -0.8, -2.2]) {
      for (const lz of [1.15, -1.15]) {
        const [x, z] = W(lx, lz);
        wheels.push({ geo: wheelGeo, matrix: mtx(x, dy + 0.5, z, Math.PI / 2, yaw, 0, 1.5, 1.2, 1.5), color: colorOf('#1d1d1f') });
      }
    }
  }

  // a forklift: yellow body, black mast and forks, an overhead guard
  addForklift(steel, paint, wheels, wheelGeo, d) {
    const yaw = d.yaw || 0;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const W = (lx, lz) => [d.x + c * lx + s * lz, d.z - s * lx + c * lz];
    const yellow = colorOf('#e0b422');
    const dark = colorOf('#2b2e32');
    const P = (lx, ly, lz, hx, hy, hz, color, gb = paint) => {
      const [x, z] = W(lx, lz);
      gb.box(x, ly, z, hx, hy, hz, yaw, color, 1);
    };
    P(-0.1, 0.62, 0, 0.75, 0.32, 0.55, yellow);              // body
    P(-0.75, 0.75, 0, 0.25, 0.45, 0.5, dark);                // counterweight
    P(0.1, 1.05, 0, 0.3, 0.12, 0.3, dark);                   // seat
    for (const lz of [-0.32, 0.32]) P(0.92, 1.1, lz, 0.05, 1.1, 0.05, dark, steel);   // mast
    P(0.92, 2.15, 0, 0.05, 0.05, 0.4, dark, steel);
    for (const lz of [-0.25, 0.25]) P(1.5, 0.12, lz, 0.55, 0.025, 0.06, dark, steel); // forks
    for (const [lx, lz] of [[0.55, -0.5], [0.55, 0.5], [-0.65, -0.5], [-0.65, 0.5]]) P(lx, 1.5, lz, 0.04, 0.55, 0.04, dark, steel);
    P(-0.05, 2.06, 0, 0.7, 0.03, 0.55, dark, steel);         // overhead guard
    for (const [lx, lz] of [[0.6, 0.62], [0.6, -0.62], [-0.55, 0.62], [-0.55, -0.62]]) {
      const [x, z] = W(lx, lz);
      wheels.push({ geo: wheelGeo, matrix: mtx(x, 0.3, z, Math.PI / 2, yaw, 0, 0.9, 0.9, 0.9), color: colorOf('#1d1d1f') });
    }
  }

  // a golf cart: a white body on four small wheels, a bench seat, a canopy on four posts
  addGolfCart(steel, paint, wheels, wheelGeo, d, skin = null) {
    const yaw = d.yaw || 0;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const W = (lx, lz) => [d.x + c * lx + s * lz, d.z - s * lx + c * lz];
    // a skin paints the body, the seat, the canopy and the trim
    const white = colorOf(skin ? skin.body : '#f2f2ee');
    const dark = colorOf(skin ? skin.trim : '#2b2e32');
    const green = colorOf(skin ? skin.seat : '#2f6b4a');
    const top = colorOf(skin ? skin.canopy || skin.body : '#f2f2ee');
    const P = (lx, ly, lz, hx, hy, hz, color, gb = paint) => {
      const [x, z] = W(lx, lz);
      gb.box(x, ly, z, hx, hy, hz, yaw, color, 1);
    };
    P(0, 0.42, 0, 1.15, 0.14, 0.6, white);                     // the floor pan
    P(0.85, 0.72, 0, 0.3, 0.2, 0.55, white);                   // the front cowl
    P(-0.8, 0.75, 0, 0.35, 0.28, 0.55, white);                 // the rear box
    P(-0.15, 0.78, 0, 0.32, 0.12, 0.5, green);                 // the seat
    P(-0.45, 1.05, 0, 0.06, 0.28, 0.5, green);                 // the seat back
    P(0.55, 0.85, 0, 0.03, 0.12, 0.03, dark, steel);           // the steering column
    P(0.5, 1.0, 0, 0.14, 0.02, 0.14, dark, steel);             // the wheel
    for (const [lx, lz] of [[0.95, -0.5], [0.95, 0.5], [-0.95, -0.5], [-0.95, 0.5]]) P(lx, 1.2, lz, 0.03, 0.65, 0.03, dark, steel);
    P(0, 1.9, 0, 1.15, 0.03, 0.62, top);                       // the canopy
    for (const [lx, lz] of [[0.75, 0.62], [0.75, -0.62], [-0.75, 0.62], [-0.75, -0.62]]) {
      const [x, z] = W(lx, lz);
      wheels.push({ geo: wheelGeo, matrix: mtx(x, 0.26, z, Math.PI / 2, yaw, 0, 0.75, 0.75, 0.75), color: colorOf('#1d1d1f') });
    }
  }

  // a broadleaf garden tree: a trunk and a round canopy
  // -- doors that open and glass that breaks (the Manor) ------------------------

  // every door hung in its opening (a wide one as a pair of leaves) and every
  // window pane, each with its collision box so you walk into them until a door
  // is opened or a pane broken
  buildDoors(map, root, tx) {
    this.doors = new Map();
    this.panes = new Map();
    this.doorRoot = new THREE.Group();
    root.add(this.doorRoot);
    const wood = new THREE.MeshLambertMaterial({ map: tx.wood, color: '#c89a68' });
    const dark = new THREE.MeshLambertMaterial({ color: '#7a5636' });
    const brass = new THREE.MeshPhongMaterial({ color: '#c9a040', shininess: 80, specular: '#fff2c0' });
    for (const d of map.doors || []) {
      const c = Math.cos(d.yaw), s = Math.sin(d.yaw);
      const along = new THREE.Vector3(c, 0, -s), normal = new THREE.Vector3(s, 0, c);
      const double = d.w > 2.1;
      const leaves = [];
      for (const hinge of double ? [-1, 1] : [-1]) {
        const lw = double ? d.w / 2 : d.w;
        const hx = d.x + along.x * hinge * d.w / 2, hz = d.z + along.z * hinge * d.w / 2;   // the hinge, at the end of the opening
        const pivot = new THREE.Group();
        pivot.position.set(hx, d.y, hz);
        const leaf = new THREE.Group();
        // the leaf grows from the hinge towards the middle of the opening
        const dirIn = -hinge;
        const panel = new THREE.Mesh(new THREE.BoxGeometry(lw - 0.03, d.h - 0.02, 0.08), wood);
        panel.position.set(dirIn * lw / 2, d.h / 2, 0);
        leaf.add(panel);
        for (const [py, ph] of [[d.h * 0.28, d.h * 0.36], [d.h * 0.7, d.h * 0.3]]) {
          for (const side of [-1, 1]) {
            const inset = new THREE.Mesh(new THREE.BoxGeometry(lw * 0.62, ph, 0.02), dark);
            inset.position.set(dirIn * lw / 2, py, side * 0.045);
            leaf.add(inset);
          }
        }
        const knob = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), brass);
        knob.position.set(dirIn * (lw - 0.14), 1.0, 0.07);
        leaf.add(knob);
        const knob2 = knob.clone();
        knob2.position.z = -0.07;
        leaf.add(knob2);
        leaf.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        pivot.add(leaf);
        pivot.rotation.y = d.yaw;
        this.doorRoot.add(pivot);
        // the leaf's box when shut, and when swung open (always away from the hinge, to the +normal side)
        const shut = [hx + along.x * dirIn * lw / 2, d.y + d.h / 2, hz + along.z * dirIn * lw / 2, lw / 2, d.h / 2, 0.06, d.yaw, 'door'];
        const open = [hx + normal.x * lw / 2, d.y + d.h / 2, hz + normal.z * lw / 2, 0.06, d.h / 2, lw / 2, d.yaw, 'door'];
        const box = this.physics.add(shut);
        box.door = d.id;
        leaves.push({ pivot, hinge, dirIn, shut, open, box, angle: 0 });
      }
      this.doors.set(d.id, { d, leaves, open: false, along, normal });
    }
    const glass = new THREE.MeshPhongMaterial({ color: '#dbe9f1', transparent: true, opacity: 0.32, shininess: 90, specular: '#ffffff', side: THREE.DoubleSide, depthWrite: false });
    const mullion = new THREE.MeshLambertMaterial({ color: '#e8e4da' });
    for (const p of map.panes || []) {
      const g = new THREE.Group();
      g.position.set(p.x, p.y + p.h / 2, p.z);
      g.rotation.y = p.yaw;
      const sheet = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.h), glass);
      g.add(sheet);
      const bars = new THREE.Group();
      bars.add(new THREE.Mesh(new THREE.BoxGeometry(0.04, p.h, 0.05), mullion));
      const hbar = new THREE.Mesh(new THREE.BoxGeometry(p.w, 0.04, 0.05), mullion);
      hbar.position.y = p.h * 0.1;
      bars.add(hbar);
      g.add(bars);
      this.doorRoot.add(g);
      const box = this.physics.add([p.x, p.y + p.h / 2, p.z, p.w / 2, p.h / 2, 0.03, p.yaw, 'pane']);
      box.pane = p.id;
      this.panes.set(p.id, { p, group: g, sheet, bars, box, broken: false });
    }
  }

  // a door swings: its leaves turn over a third of a second and the collision box
  // moves at once, so a door you open is a door you can walk through
  setDoor(id, open) {
    const D = this.doors && this.doors.get(id);
    if (!D || D.open === open) return false;
    D.open = open;
    for (const L of D.leaves) {
      this.physics.remove(L.box);
      L.box = this.physics.add(open ? L.open : L.shut);
      L.box.door = id;
    }
    return true;
  }

  updateDoors(dt) {
    if (!this.doors) return;
    for (const D of this.doors.values()) {
      for (const L of D.leaves) {
        // a leaf on the far hinge swings the other way to open towards +normal too
        const want = D.open ? -L.dirIn * Math.PI / 2 * 0.95 : 0;
        if (Math.abs(L.angle - want) < 1e-3) continue;
        L.angle += (want - L.angle) * Math.min(1, dt * 9);
        if (Math.abs(L.angle - want) < 0.01) L.angle = want;
        L.pivot.rotation.y = D.d.yaw + L.angle;
      }
    }
  }

  // the door nearest to a point within reach, with how far it is
  doorNear(pos, reach = 2.2) {
    if (!this.doors) return null;
    let best = null;
    for (const D of this.doors.values()) {
      const d = D.d;
      if (Math.abs(d.y - pos.y) > 1.6) continue;
      const dist = Math.hypot(pos.x - d.x, pos.z - d.z) - d.w * 0.3;
      if (dist < reach && (!best || dist < best.dist)) best = { id: d.id, open: D.open, dist, D };
    }
    return best;
  }

  // the pane a body (a cylinder: feet at pos, radius r, height h) is pushing into
  paneHit(pos, r, h) {
    if (!this.panes) return null;
    for (const P of this.panes.values()) {
      if (P.broken) continue;
      const b = P.box;
      if (b.maxY < pos.y + 0.1 || b.minY > pos.y + h) continue;
      if (Physics.overlapsCircle(b, pos.x, pos.z, r)) return P.p.id;
    }
    return null;
  }

  // a pane shatters: the glass goes, the bars stay, and nothing stops you now
  breakPane(id) {
    const P = this.panes && this.panes.get(id);
    if (!P || P.broken) return null;
    P.broken = true;
    P.group.remove(P.sheet);
    this.physics.remove(P.box);
    return new THREE.Vector3(P.p.x, P.p.y + P.p.h / 2, P.p.z);
  }

  // drifts of snow (or sand) banked against the outside walls of buildings: a low
  // wedge along every outward-facing wall, its height wandering along the length,
  // in the ground's own material so it reads as the ground piled up. A face is
  // outward if the ground just in front of it is open: not inside another wall, a
  // floor slab or any other box.
  addDrifts(map, root, tx, kind) {
    const phys = this.physics, S = this.surface;
    const groundAt = (x, z) => (S ? S(x, z) : 0);
    const pos = [], uv = [], idx = [];
    const near = [];
    const open = (x, z, y) => {
      phys.query(x - 0.3, z - 0.3, x + 0.3, z + 0.3, near);
      for (const b of near) {
        if (b.mat === 'inv' || b.mat === 'terrain') continue;
        if (b.maxY < y + 0.05 || b.minY > y + 0.6) continue;
        if (Physics.overlapsCircle(b, x, z, 0.12)) return false;
      }
      return true;
    };
    const walls = new Set(['wall', 'concrete', 'stone', 'marble']);
    const scale = kind === 'snow' ? 1.2 : 0.8;
    for (const [cx, cy, cz, hx, hy, hz, yaw, mat] of map.boxes) {
      if (!walls.has(mat) || hy * 2 < 1.8 || hx > 60 || hz > 60) continue;
      const base = cy - hy, g0 = groundAt(cx, cz);
      if (Math.abs(base - g0) > 0.35) continue;        // not standing on the ground here
      const c = Math.cos(yaw), s = Math.sin(yaw);
      // the four faces: normal (local), the axis the face runs along, its half length
      for (const [fnx, fnz, ax, az, half] of [[1, 0, 0, 1, hz], [-1, 0, 0, 1, hz], [0, 1, 1, 0, hx], [0, -1, 1, 0, hx]]) {
        if (half < 0.9) continue;
        const nx = c * fnx + s * fnz, nz = -s * fnx + c * fnz;
        const dx = c * ax + s * az, dz = -s * ax + c * az;
        const fx = cx + nx * (fnx ? hx : hz), fz = cz + nz * (fnx ? hx : hz);   // the face's centre
        const step = 0.5, n = Math.max(2, Math.round(2 * half / step));
        const seed = Math.round(fx * 7 + fz * 13);
        // a run of open ground along the face becomes one wedge: three vertices per
        // sample (at the wall, halfway out, on the ground), shared between samples
        const flush = (i0, i1) => {
          if (i1 - i0 < 3) return;
          const first = pos.length / 3;
          for (let i = i0; i <= i1; i++) {
            const t = -half + (2 * half * i) / n;
            const px = fx + dx * t, pz = fz + dz * t;
            const edge = i === i0 || i === i1;
            const h = edge ? 0 : (0.16 + 0.22 * jit(Math.round(px * 10), 0, Math.round(pz * 10), seed)) * scale;
            const out = edge ? 0.3 : 0.7 + 0.5 * jit(Math.round(pz * 10), 1, Math.round(px * 10), seed);
            const pts = [
              [px - nx * 0.02, groundAt(px, pz) + h, pz - nz * 0.02],
              [px + nx * out * 0.5, groundAt(px + nx * out * 0.5, pz + nz * out * 0.5) + h * 0.42, pz + nz * out * 0.5],
              [px + nx * out, groundAt(px + nx * out, pz + nz * out) + 0.01, pz + nz * out],
            ];
            for (const v of pts) { pos.push(v[0], v[1], v[2]); uv.push(v[0] / 9, v[2] / 9); }
          }
          for (let i = 0; i < i1 - i0; i++) {
            const a = first + i * 3, b = a + 3;
            for (let k = 0; k < 2; k++) {
              // wound so the face points up and out, whichever way the run goes
              const flip = (dx * nz - dz * nx) > 0;
              if (flip) idx.push(a + k, b + k + 1, b + k, a + k, a + k + 1, b + k + 1);
              else idx.push(a + k, b + k, b + k + 1, a + k, b + k + 1, a + k + 1);
            }
          }
        };
        let runStart = null;
        for (let i = 0; i <= n; i++) {
          const t = -half + (2 * half * i) / n;
          const px = fx + dx * t + nx * 0.55, pz = fz + dz * t + nz * 0.55;
          const ok = open(px, pz, groundAt(px, pz)) && Math.abs(groundAt(px, pz) - base) < 0.5;
          if (ok && runStart === null) runStart = i;
          if ((!ok || i === n) && runStart !== null) { flush(runStart, ok ? i : i - 1); runStart = null; }
        }
      }
    }
    if (!idx.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // any triangle wound the wrong way still shows: both sides are drawn
    const mesh = new THREE.Mesh(g, groundMat(tx, kind, { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }));
    mesh.receiveShadow = true;
    root.add(mesh);
  }

  // the ground of a map with a height grid (Ridgeline) as one smooth surface: the
  // cell heights interpolated on a metre grid, snow on it, the steep bits turning to
  // rock through the vertex colour. The stepped terrain boxes still come in the map
  // (the minimap and the server use them) but are not drawn or walked on.
  addHeightfield(map, root, tx, kind) {
    const H = map.height;
    const [bx, bz] = map.bounds;
    const step = 1.0;
    const nx = Math.round(bx * 2 / step) + 1, nz = Math.round(bz * 2 / step) + 1;
    const pos = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2), col = new Float32Array(nx * nz * 3);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const x = -bx + i * step, z = -bz + j * step;
        const k = j * nx + i;
        pos[k * 3] = x; pos[k * 3 + 1] = surfaceAt(H, x, z); pos[k * 3 + 2] = z;
        uv[k * 2] = x / 9; uv[k * 2 + 1] = -z / 9;
      }
    }
    const idx = [];
    for (let j = 0; j + 1 < nz; j++) {
      for (let i = 0; i + 1 < nx; i++) {
        const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const nrm = g.attributes.normal;
    const rock = kind === 'snow' ? [0.52, 0.54, 0.57] : [0.62, 0.56, 0.48];
    for (let k = 0; k < nx * nz; k++) {
      // flat: the ground's own colour; steeper than about 35 degrees: bare rock
      const ny = nrm.getY(k);
      const t = Math.max(0, Math.min(1, (0.82 - ny) / 0.25));
      col[k * 3] = 1 - (1 - rock[0]) * t; col[k * 3 + 1] = 1 - (1 - rock[1]) * t; col[k * 3 + 2] = 1 - (1 - rock[2]) * t;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, groundMat(tx, kind, { vertexColors: true }));
    mesh.receiveShadow = true;
    root.add(mesh);
  }

  // the ridge's face on Ridgeline as one rock wall: the server sends the smoothed
  // line it stands on (x, z, foot, riser, crag) every half metre; columns of
  // jittered vertices between the foot and the top make a craggy face lit flat,
  // and a snowy lip runs back under the shelf so no gap shows from above
  addCliff(B, L, d) {
    const pts = d.pts || [];
    if (pts.length < 2) return;
    const top = d.top || 0, R = 7;
    const rock = Object.assign(colorOf('#d9dce0'), { ao: true }), snow = colorOf('#ffffff');
    const V = pts.map(([x, z, g, r, c], i) => {
      const col = [];
      const bottom = g - 0.7;
      for (let j = 0; j <= R; j++) {
        const t = j / R, y0 = bottom + (top - bottom) * t;
        const mid = j > 0 && j < R;
        const h1 = jit(Math.round(x * 10), j, 7, 21), h2 = jit(j, Math.round(x * 10), 3, 22), h3 = jit(Math.round(x * 10), 5, j, 23);
        const crag = (j === R ? 0.22 : j === 0 ? 0.45 : 0.75) * (c === undefined ? 1 : c);
        col.push([x + (mid ? (h1 - 0.5) * 0.4 : 0), y0 + (mid ? (h2 - 0.5) * 0.7 : 0), z + h3 * crag]);
      }
      col.back = r - 1.3;      // past the drop the smooth ground makes just behind the riser
      return col;
    });
    for (let i = 0; i + 1 < V.length; i++) {
      const a = V[i], b = V[i + 1];
      for (let j = 0; j < R; j++) {
        const uv = (v) => [v[0] / 3, v[1] / 3];
        B.tri(a[j], b[j], b[j + 1], uv(a[j]), uv(b[j]), uv(b[j + 1]), rock);
        B.tri(a[j], b[j + 1], a[j + 1], uv(a[j]), uv(b[j + 1]), uv(a[j + 1]), rock);
      }
      // the lip: from the top of the face back under the shelf
      const t0 = a[R], t1 = b[R], y = top - 0.03;
      const p0 = [t0[0], y, Math.min(a.back, b.back)], p1 = [t1[0], y, Math.min(a.back, b.back)];
      const uv = (v) => [v[0] / 9, v[2] / 9];
      L.tri(t0, t1, p1, uv(t0), uv(t1), uv(p1), snow);
      L.tri(t0, p1, p0, uv(t0), uv(p1), uv(p0), snow);
    }
  }

  addTree(trunks, canopies, trunkSeg, blobs, d) {
    const greens = ['#3f7a35', '#4d8a3c', '#35662f'];
    const h = d.h || 4.5, r = d.r || 2.6, c = d.c || 0;
    const lean = (jit(d.x, 0, d.z, 4) - 0.5) * 0.12;
    // a trunk that leans a touch and thins as it rises, with two branches into the crown
    trunks.push({ geo: trunkSeg, matrix: mtx(d.x, h * 0.3 + 0.2, d.z, lean, 0, lean * 0.6, 1.4, h * 0.6 + 0.4, 1.4), color: colorOf('#5a3f2a') });
    trunks.push({ geo: trunkSeg, matrix: mtx(d.x + lean * h * 0.4, h * 0.75, d.z + lean * h * 0.25, lean, 0, lean * 0.6, 0.9, h * 0.55, 0.9), color: colorOf('#5a3f2a') });
    for (const sx of [-1, 1]) {
      trunks.push({ geo: trunkSeg, matrix: mtx(d.x + sx * 0.35, h * 0.9, d.z + sx * 0.15, 0.3, sx * 1.2, sx * 0.7, 0.45, r * 0.8, 0.45), color: colorOf('#51382a') });
    }
    // the crown: one big blob and four smaller ones lumped round it, no two the same green
    canopies.push({ geo: blobs[0], matrix: mtx(d.x, h + r * 0.3, d.z, 0, jit(d.x, 1, d.z) * 6, 0, r, r * 0.82, r), color: colorOf(greens[c % 3]) });
    for (let k = 0; k < 4; k++) {
      const a = k * 1.57 + jit(d.x, k, d.z, 7) * 0.8;
      const rr = r * (0.55 + 0.2 * jit(d.x, k, d.z, 8));
      const off = r * 0.5;
      canopies.push({ geo: blobs[1 + (k % 2)], matrix: mtx(d.x + Math.cos(a) * off, h + r * (0.1 + 0.35 * jit(d.x, k, d.z, 9)), d.z + Math.sin(a) * off, 0, a, 0, rr, rr * 0.85, rr),
        color: colorOf(greens[(c + k + 1) % 3], 0.92 + 0.12 * jit(d.x, k, d.z, 10)) });
    }
  }

  // a bush: a few blobs lumped low to the ground with sprigs of leaf out of the sides
  addBush(canopies, sprigs, blobs, sprigGeo, d, snowy) {
    const r = d.r || 0.7, y = d.y || 0;
    const cols = d.c === 2 ? ['#7a8a62', '#6b7a55', '#8a9a6a'] : d.c === 1 ? ['#2f5e2a', '#3a6b33', '#26512a'] : ['#3f7a35', '#4d8a3c', '#35662f'];
    canopies.push({ geo: blobs[0], matrix: mtx(d.x, y + r * 0.55, d.z, 0, jit(d.x, 0, d.z) * 6, 0, r, r * 0.7, r * 0.9), color: colorOf(cols[0]) });
    for (let k = 0; k < 3; k++) {
      const a = k * 2.1 + jit(d.x, k, d.z, 11) * 1.2, rr = r * (0.45 + 0.25 * jit(d.x, k, d.z, 12));
      canopies.push({ geo: blobs[1 + (k % 2)], matrix: mtx(d.x + Math.cos(a) * r * 0.55, y + rr * 0.6, d.z + Math.sin(a) * r * 0.55, 0, a, 0, rr, rr * 0.75, rr), color: colorOf(cols[(k + 1) % 3]) });
    }
    if (snowy && d.c === 2) canopies.push({ geo: blobs[2], matrix: mtx(d.x, y + r * 0.95, d.z, 0, 0, 0, r * 0.7, r * 0.25, r * 0.6), color: colorOf('#eef2f5') });
    const tint = d.c === 2 ? '#d9dcc4' : '#cfe3b8';
    for (let k = 0; k < 4; k++) {
      const a = k * 1.57 + jit(d.x, k, d.z, 13) * 1.0, sc = 0.5 + 0.3 * jit(d.x, k, d.z, 14);
      sprigs.push({ geo: sprigGeo, matrix: mtx(d.x + Math.cos(a) * r * 0.85, y + r * 0.45, d.z + Math.sin(a) * r * 0.85, 0, a, 0, sc, sc, sc), color: colorOf(tint) });
    }
  }

  // a marble figure on its plinth: a standing form, head and shoulders, one of four poses
  addStatue(figures, d) {
    const p = d.p || 0;
    const white = colorOf('#e8e6df');
    const yaw = d.yaw || 0;
    const at = (lx, ly, lz, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
      // local offsets turned by the statue's yaw
      const c = Math.cos(yaw), sn = Math.sin(yaw);
      return mtx(d.x + c * lx + sn * lz, (d.y || 0) + ly, d.z - sn * lx + c * lz, rx, ry + yaw, rz, sx, sy, sz);
    };
    if (!this._figGeo) {
      this._figGeo = {
        body: new THREE.CapsuleGeometry(0.22, 1.05, 4, 10), head: new THREE.SphereGeometry(0.16, 10, 8),
        arm: new THREE.CapsuleGeometry(0.07, 0.55, 3, 8), skirt: new THREE.ConeGeometry(0.36, 0.9, 12, 1, true),
      };
    }
    const G = this._figGeo;
    figures.push({ geo: G.body, matrix: at(0, 0.85, 0), color: white });
    figures.push({ geo: G.head, matrix: at(0, 1.62, 0), color: white });
    figures.push({ geo: G.skirt, matrix: at(0, 0.45, 0), color: white });
    if (p === 0) figures.push({ geo: G.arm, matrix: at(0.3, 1.25, 0.1, 0, 0, -0.9), color: white });
    else if (p === 1) figures.push({ geo: G.arm, matrix: at(-0.28, 1.1, 0.15, -0.9, 0, 0.5), color: white });
    else if (p === 2) figures.push({ geo: G.arm, matrix: at(0.26, 1.45, 0, 0, 0, -2.6), color: white });
    else figures.push({ geo: G.arm, matrix: at(0.3, 1.0, 0, 0, 0, -0.3), color: white });
  }

  // a framed painting on a wall: a gilt frame round a canvas, the picture a
  // few blocks of colour, hung facing `yaw`
  addPainting(root, paint, d) {
    const w = d.w || 1.4, h = d.h || 1.0;
    const yaw = d.yaw || 0;
    paint.box(d.x, d.y || 2.0, d.z, (w + 0.12) / 2, (h + 0.12) / 2, 0.025, yaw, colorOf('#c9a13b'), 1);
    const c = document.createElement('canvas');
    c.width = 96; c.height = Math.max(8, Math.round(96 * h / w));
    const x = c.getContext('2d');
    const W = c.width, Hh = c.height;
    const P = PAINTINGS[(d.c || 0) % PAINTINGS.length];
    const seed = Math.abs(Math.round(d.x * 7 + d.z * 13 + (d.y || 0) * 3));
    const r = (seed % 11) / 11;
    const kind = (seed + (d.c || 0)) % 6;
    x.fillStyle = P[0];
    x.fillRect(0, 0, W, Hh);
    const ell = (cx, cy, rx, ry, col) => { x.fillStyle = col; x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); x.fill(); };
    if (kind === 0) {
      // a landscape: hills under a sun, a tree on the ridge
      ell(W * (0.25 + r * 0.5), Hh * 0.28, W * 0.09, W * 0.09, '#f6e2a0');
      x.fillStyle = P[1];
      x.beginPath(); x.moveTo(0, Hh); x.lineTo(0, Hh * 0.62);
      for (let i = 0; i <= 6; i++) x.lineTo(W * i / 6, Hh * (0.55 + 0.12 * Math.sin(i * 1.7 + r * 6)));
      x.lineTo(W, Hh); x.fill();
      x.fillStyle = P[3]; x.fillRect(W * (0.6 + r * 0.2), Hh * 0.42, W * 0.02, Hh * 0.2);
      ell(W * (0.61 + r * 0.2), Hh * 0.4, W * 0.08, Hh * 0.12, P[2]);
    } else if (kind === 1) {
      // a portrait: a face and shoulders on a dark ground
      x.fillStyle = P[1]; x.fillRect(0, Hh * 0.62, W, Hh);
      ell(W * 0.5, Hh * 0.72, W * 0.32, Hh * 0.25, P[3]);
      ell(W * 0.5, Hh * 0.4, W * 0.16, Hh * 0.2, P[2]);
      ell(W * 0.5, Hh * 0.3, W * 0.17, Hh * 0.1, P[1]);
    } else if (kind === 2) {
      // a still life: a table with fruit and a jug
      x.fillStyle = P[1]; x.fillRect(0, Hh * 0.6, W, Hh);
      x.fillStyle = P[3]; x.fillRect(W * 0.55, Hh * 0.3, W * 0.16, Hh * 0.32);
      ell(W * 0.63, Hh * 0.3, W * 0.1, Hh * 0.05, P[3]);
      for (let i = 0; i < 4; i++) ell(W * (0.15 + i * 0.1), Hh * (0.56 - (i % 2) * 0.05), W * 0.06, W * 0.06, i % 2 ? P[2] : '#c8483a');
    } else if (kind === 3) {
      // a seascape: bands of water, a sail
      for (let i = 0; i < 5; i++) { x.fillStyle = i % 2 ? P[1] : P[0]; x.fillRect(0, Hh * (0.5 + i * 0.1), W, Hh * 0.1); }
      x.fillStyle = P[2]; x.beginPath(); x.moveTo(W * (0.4 + r * 0.2), Hh * 0.2); x.lineTo(W * (0.4 + r * 0.2), Hh * 0.55); x.lineTo(W * (0.58 + r * 0.2), Hh * 0.55); x.fill();
      x.fillStyle = P[3]; x.fillRect(W * (0.33 + r * 0.2), Hh * 0.55, W * 0.3, Hh * 0.05);
    } else if (kind === 4) {
      // an abstract: blocks of colour
      x.fillStyle = P[1]; x.fillRect(W * 0.1, Hh * 0.1, W * 0.35, Hh * 0.5);
      x.fillStyle = P[2]; x.fillRect(W * 0.5, Hh * 0.2, W * 0.4, Hh * 0.3);
      x.fillStyle = P[3]; x.fillRect(W * 0.2, Hh * 0.65, W * 0.6, Hh * 0.2);
      ell(W * (0.3 + r * 0.4), Hh * 0.5, W * 0.1, W * 0.1, '#f0e6d0');
    } else {
      // a hunt: riders on a green field under a pale sky
      x.fillStyle = P[1]; x.fillRect(0, Hh * 0.5, W, Hh);
      for (let i = 0; i < 3; i++) {
        const hx = W * (0.2 + i * 0.28 + r * 0.05), hy = Hh * (0.66 + (i % 2) * 0.08);
        ell(hx, hy, W * 0.09, Hh * 0.06, P[3]);
        ell(hx, hy - Hh * 0.1, W * 0.03, Hh * 0.07, P[2]);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const canvas = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: tex }));
    canvas.position.set(d.x + Math.sin(yaw) * 0.03, d.y || 2.0, d.z + Math.cos(yaw) * 0.03);
    canvas.rotation.y = yaw;
    root.add(canvas);
  }

  // a chandelier: a chain, a brass ring of candles, flames that glow
  addChandelier(brass, glow, d) {
    const r = d.r || 1.0;
    const y = d.y || 3.0;
    const top = d.top || y + 0.5;
    if (!this._chGeo) {
      this._chGeo = {
        chain: new THREE.CylinderGeometry(0.02, 0.02, 1, 5), rings: {},
        stem: new THREE.CylinderGeometry(0.06, 0.1, 0.5, 8), candle: new THREE.CylinderGeometry(0.03, 0.03, 0.22, 6),
        flame: new THREE.SphereGeometry(0.045, 6, 5),
      };
    }
    const G = this._chGeo;
    const ring = G.rings[r] || (G.rings[r] = new THREE.TorusGeometry(r * 0.6, 0.035, 6, 24));
    const gold = colorOf('#c9a13b');
    const len = Math.max(0.1, top - y);
    brass.push({ geo: G.chain, matrix: mtx(d.x, y + len / 2, d.z, 0, 0, 0, 1, len, 1), color: colorOf('#3a3a3a') });
    brass.push({ geo: ring, matrix: mtx(d.x, y, d.z, Math.PI / 2, 0, 0), color: gold });
    brass.push({ geo: G.stem, matrix: mtx(d.x, y - 0.2, d.z), color: gold });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      brass.push({ geo: G.candle, matrix: mtx(d.x + Math.cos(a) * r * 0.6, y + 0.12, d.z + Math.sin(a) * r * 0.6), color: colorOf('#f4efe0') });
      glow.push({ geo: G.flame, matrix: mtx(d.x + Math.cos(a) * r * 0.6, y + 0.28, d.z + Math.sin(a) * r * 0.6), color: colorOf('#ffe6a8') });
    }
  }

  // a gantry crane's fittings: bracing on the legs, a trolley and hook under the beam, a cab
  addCrane(steel, paint, d) {
    const yaw = d.yaw || 0;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const W = (lx, lz) => [d.x + c * lx + s * lz, d.z - s * lx + c * lz];
    const yellow = colorOf('#d1b83c');
    const dark = colorOf('#3a3f45');
    for (const side of [-1, 1]) {
      const lz = side * d.span / 2;
      for (const f of [0.25, 0.5, 0.75]) {
        const [x, z] = W(0, lz);
        steel.box(x, d.h * f, z, 1.6, 0.08, 0.08, yaw, yellow, 1);
      }
      const [fx, fz] = W(0, lz);
      steel.box(fx, d.h - 0.4, fz, 2.2, 0.35, 0.6, yaw, yellow, 1);        // leg head
    }
    const [tx, tz] = W(0, d.span * 0.15);
    steel.box(tx, d.h - 0.35, tz, 1.2, 0.35, 1.2, yaw, dark, 1);            // trolley
    steel.box(tx, d.h * 0.62, tz, 0.03, d.h * 0.28, 0.03, yaw, dark, 1);   // cable
    steel.box(tx, d.h * 0.34, tz, 0.45, 0.3, 0.25, yaw, dark, 1);          // hook block
    const [cx, cz] = W(0, -d.span / 2 + 2.2);
    steel.box(cx, d.h - 1.2, cz, 0.9, 0.7, 0.9, yaw, yellow, 1);            // cab
    paint.box(cx, d.h - 1.1, cz + 0.91, 0.6, 0.35, 0.01, yaw, colorOf('#0f1114'), 1);
  }

  // a lattice comms tower: four posts, rungs every few metres, dishes and a beacon
  addTower(steel, paint, d) {
    const grey = colorOf('#8f949a');
    const red = colorOf('#c8352a');
    const yaw = Math.PI / 4;
    const ty = d.y || 0;
    for (const [lx, lz] of [[0.45, 0.45], [0.45, -0.45], [-0.45, 0.45], [-0.45, -0.45]]) {
      const x = d.x + Math.cos(yaw) * lx + Math.sin(yaw) * lz, z = d.z - Math.sin(yaw) * lx + Math.cos(yaw) * lz;
      steel.box(x, ty + d.h / 2, z, 0.06, d.h / 2, 0.06, yaw, grey, 1);
    }
    for (let y = 1.5; y < d.h; y += 2.5) {
      steel.box(d.x, ty + y, d.z, 0.47, 0.035, 0.035, yaw, grey, 1);
      steel.box(d.x, ty + y, d.z, 0.035, 0.035, 0.47, yaw, grey, 1);
    }
    paint.box(d.x + 0.7, ty + d.h - 2, d.z, 0.06, 0.45, 0.55, 0.5, colorOf('#f4f4f0'), 1);   // dishes
    paint.box(d.x - 0.7, ty + d.h - 3.5, d.z, 0.06, 0.45, 0.55, -0.6, colorOf('#f4f4f0'), 1);
    paint.box(d.x, ty + d.h + 0.4, d.z, 0.1, 0.4, 0.1, 0, red, 1);                          // beacon
  }

  // a pine: a trunk and three tiers of dark green, each dusted with snow
  addPine(trunks, cones, trunkSeg, ragged, d, snowy) {
    const h = d.h || 7;
    const py = d.y || 0;
    const s = d.s || 0;
    const greens = ['#2f5a34', '#264a2c', '#37633a'];
    // the trunk in two pieces, thinner above, and four ragged tiers that each lean a little their own way
    trunks.push({ geo: trunkSeg, matrix: mtx(d.x, py + h * 0.25, d.z, 0, 0, 0, 1.0, h * 0.5, 1.0), color: colorOf('#4a3524') });
    trunks.push({ geo: trunkSeg, matrix: mtx(d.x, py + h * 0.64, d.z, 0, 0, 0, 0.55, h * 0.5, 0.55), color: colorOf('#4a3524') });
    for (let i = 0; i < 4; i++) {
      const t = i / 3;
      const base = py + h * (0.2 + i * 0.19);
      const th = h * (0.36 - i * 0.04);
      const r = h * 0.21 * (1 - t * 0.62) * (0.9 + 0.2 * jit(d.x, i, d.z, 1));
      const rz = r * (0.85 + 0.3 * jit(d.x, i, d.z, 2));
      const rot = s * 0.7 + i * 0.9;
      const tilt = (jit(d.x, i, d.z, 3) - 0.5) * 0.14;
      const geo = ragged[(s + i) % 3];
      cones.push({ geo, matrix: mtx(d.x, base + th / 2, d.z, tilt, rot, tilt * 0.5, r, th, rz), color: colorOf(greens[(s + i) % 3]) });
      if (snowy) cones.push({ geo, matrix: mtx(d.x, base + th / 2 + 0.14, d.z, tilt, rot, tilt * 0.5, r * 0.8, th, rz * 0.8), color: colorOf('#eef2f5') });
    }
  }

  // a dirt road: one strip following the points, a little above the sand
  addRoad(root, d) {
    if (d.solid) return;      // a solid road is built from its boxes; this entry is for the map
    const pos = [], uv = [], idx = [];
    const pts = d.pts;
    // on smooth ground every vertex is laid on the surface, five across, so the
    // strip follows the land instead of cutting into it
    const S = this.surface, across = S ? 5 : 2;
    let along = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x, z, ry] = pts[i];
      const y = (ry || 0) + 0.02 + (d.h || 0);   // roads over stepped ground carry their own height; overlapping ones are stacked a hair apart
      const p = pts[Math.max(0, i - 1)], n = pts[Math.min(pts.length - 1, i + 1)];
      let tx = n[0] - p[0], tz = n[1] - p[1];
      const L = Math.hypot(tx, tz) || 1;
      tx /= L; tz /= L;
      const nx = -tz * d.w / 2, nz = tx * d.w / 2;
      if (i) along += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]);
      for (let k = 0; k < across; k++) {
        const f = 1 - 2 * k / (across - 1);
        const vx = x + nx * f, vz = z + nz * f;
        pos.push(vx, S ? S(vx, vz) + 0.05 + (d.h || 0) : y, vz);
        uv.push(k / (across - 1), along / 5);
      }
      if (i) {
        const a = (i - 1) * across, b = i * across;
        for (let k = 0; k + 1 < across; k++) idx.push(a + k, a + k + 1, b + k, a + k + 1, b + k + 1, b + k);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    if (!this._roadTex) this._roadTex = { dirt: T.road(), asphalt: T.roadStyle('asphalt'), snow: T.roadStyle('snow'), gravel: T.roadStyle('gravel'), court: T.roadStyle('court') };
    const mat = new THREE.MeshLambertMaterial({ map: this._roadTex[d.c] || this._roadTex.dirt, polygonOffset: true, polygonOffsetFactor: -1, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    root.add(mesh);
  }

  // the chequered start line across a race track, d.yaw being the way the track runs
  addChecker(root, d) {
    const c = document.createElement('canvas');
    c.width = 32; c.height = 192;
    const x = c.getContext('2d');
    for (let i = 0; i < 2; i++) for (let j = 0; j < 12; j++) {
      x.fillStyle = (i + j) % 2 ? '#141414' : '#f4f4f0';
      x.fillRect(i * 16, j * 16, 16, 16);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const g = new THREE.PlaneGeometry(1.6, d.w || 10);
    g.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -3 });
    mat.userData.own = true;
    const m = new THREE.Mesh(g, mat);
    m.position.set(d.x, 0.04, d.z);
    m.rotation.y = d.yaw || 0;
    m.receiveShadow = true;
    root.add(m);
  }

  // flat things on the ground: paved squares, scorch marks, rugs
  addDecal(root, d) {
    let geo, mat;
    if (d.k === 'rug') {
      geo = new THREE.PlaneGeometry(2.2, 1.5);
      mat = new THREE.MeshLambertMaterial({ map: T.rug(['#a33a2c', '#2f5f8f', '#c98a2a', '#6b3f7a', '#2f7f7a', '#8a2a4a'][d.c % 6]) });
      mat.userData.own = true;
    } else if (d.k === 'scorch') {
      geo = new THREE.CircleGeometry(d.r, 32);
      mat = new THREE.MeshBasicMaterial({ map: T.softDot('rgba(25,18,12,0.85)', 'rgba(25,18,12,0)'), transparent: true, depthWrite: false });
      mat.userData.own = true;
    } else {
      geo = new THREE.CircleGeometry(d.r, 40);
      const tex = T.paving(!!d.dirt);
      tex.repeat.set(d.r / 2.5, d.r / 2.5);
      mat = new THREE.MeshLambertMaterial({ map: tex });
      mat.userData.own = true;
    }
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    if (d.k === 'rug') m.rotation.z = d.yaw || 0;
    m.position.set(d.x, (d.y || 0) + (d.k === 'rug' ? 0.035 : 0.025), d.z);
    m.receiveShadow = true;
    root.add(m);
  }

  // footprints of every building, for the minimap
  footprints() {
    const out = [];
    if (!this.map) return out;
    for (const [cx, cy, cz, hx, hy, hz, yaw, mat] of this.map.boxes) {
      if (mat === 'roof' || mat === 'flatroof') out.push({ x: cx, z: cz, hx, hz, yaw, h: cy });
    }
    return out;
  }

  props() {
    const out = [];
    if (!this.map) return out;
    for (const [cx, cy, cz, hx, hy, hz, yaw, mat] of this.map.boxes) {
      if (mat === 'crate' || mat === 'car' || mat === 'stone' || mat === 'inv' || mat === 'container' || mat === 'steel' || mat === 'concrete' || mat === 'hedge') {
        // on stepped ground a prop sits on its cell, so anything below head height counts
        if (cy - hy > (this.hasTerrain ? 12 : 0.2) || hy > 4) continue;
        if ((mat === 'stone' || mat === 'concrete') && (hx > 30 || hz > 30)) continue;
        out.push({ x: cx, z: cz, hx, hz, yaw, mat });
      }
    }
    return out;
  }

  // rock terrain (the ridge and its terraces), for the minimap
  terrain() {
    const out = [];
    if (!this.map) return out;
    for (const [cx, cy, cz, hx, hy, hz, yaw, mat, tint] of this.map.boxes) {
      if ((mat === 'rock' || mat === 'terrain') && cy - hy <= 0.2 && hx < 150) out.push({ x: cx, z: cz, hx, hz, yaw, h: cy + hy, tint: mat === 'terrain' ? tint : -1 });
    }
    return out;
  }
}


// a forklift as its own object, for the ones that drive about: the same look as
// the parked ones, built as a small group at the origin facing -z... (local +x is forward)
export function makeGolfCartGroup(skin = null) {
  const tx = textures();
  const steel = new GeoBuilder(), paint = new GeoBuilder();
  const wheels = [];
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 16);
  World.prototype.addGolfCart.call({}, steel, paint, wheels, wheelGeo, { x: 0, z: 0, yaw: 0 }, skin);
  const g = new THREE.Group();
  const shiny = skin && skin.metal;
  const paintMat = shiny ? new THREE.MeshStandardMaterial({ vertexColors: true, metalness: skin.metal, roughness: skin.rough ?? 0.35 })
    : new THREE.MeshLambertMaterial({ vertexColors: true });
  if (shiny) paintMat.envMap = chromeMaterial().envMap || null;
  if (skin && skin.livery) addCartLivery(g, skin);
  if (skin && skin.lightbar) addLightBar(g, skin.turret ? 0.72 : 0.1);
  if (skin && skin.turret) { addGatling(g); addArmour(g); }
  for (const [gb, mat] of [[steel, new THREE.MeshLambertMaterial({ map: tx.metal, vertexColors: true })], [paint, paintMat]]) {
    if (gb.empty) continue;
    const mesh = new THREE.Mesh(gb.geometry(), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  if (wheels.length) {
    const mesh = new THREE.Mesh(mergeInto(wheels), new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.castShadow = true;
    g.add(mesh);
  }
  wheelGeo.dispose();
  return g;
}

// a giant police light bar across the roof: a red lamp and a blue one taking turns,
// each with a glow round it that shows from far off and through the dark
function addLightBar(g, x = 0.1) {
  const S = sirenMaterials();
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 1.36), new THREE.MeshLambertMaterial({ color: '#16181d' }));
  base.position.set(x, 2.0, 0);
  g.add(base);
  for (const [z, mat, glow] of [[0.34, S.red, S.redGlow], [-0.34, S.blue, S.blueGlow]]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.3, 0.6), mat);
    lamp.position.set(x, 2.2, z);
    g.add(lamp);
    const halo = new THREE.Sprite(glow);
    halo.position.set(x, 2.22, z);
    halo.scale.set(2.4, 2.4, 1);
    g.add(halo);
    (g.userData.halos = g.userData.halos || []).push(halo);
  }
  const rim = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.04, 1.4), chromeMaterial());
  rim.position.set(x, 2.37, 0);
  g.add(rim);
}

// bulletproof walls all round the cart, like an armoured army truck: thick panels
// with small slit windows front, sides and back, in the patrol colours (black, white
// doors, a blue stripe). Hidden until the driver puts them up: g.userData.armour.
function addArmour(g) {
  const A = new THREE.Group();
  A.visible = false;
  g.add(A);
  const black = new THREE.MeshStandardMaterial({ color: '#14161b', metalness: 0.5, roughness: 0.5 });
  const white = new THREE.MeshStandardMaterial({ color: '#eceae4', metalness: 0.3, roughness: 0.5 });
  const blue = new THREE.MeshLambertMaterial({ color: '#2f6fe0' });
  // thick tinted glass you can see out of (and in through, darkly)
  const glass = new THREE.MeshStandardMaterial({ color: '#3a5670', metalness: 0.6, roughness: 0.1, transparent: true, opacity: 0.32, depthWrite: false });
  const B = (x0, x1, y0, y1, z0, z1, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    m.castShadow = true;
    A.add(m);
    return m;
  };
  const X = 1.25, Z = 0.68, T = 0.06;          // the walls' outer faces, and their thickness
  const lo = 0.2, sill = 1.32, head = 1.6, top = 1.88;
  for (const s of [-1, 1]) {
    const z0 = s > 0 ? Z - T : -Z, z1 = s > 0 ? Z : -Z + T;
    B(-X, X, lo, sill, z0, z1, black);                       // below the windows
    B(-X, X, head, top, z0, z1, black);                      // above them
    // the window band: two small windows, solid between
    for (const [a, b] of [[-X, -0.55], [-0.15, 0.25], [0.65, X]]) B(a, b, sill, head, z0, z1, black);
    for (const [a, b] of [[-0.55, -0.15], [0.25, 0.65]]) B(a, b, sill, head, z0 + T * 0.3, z1 - T * 0.3, glass);
    // the patrol livery: a white door panel, the blue stripe, the word
    const out = s * (Z + 0.012);
    B(-0.62, 0.55, 0.42, 1.24, out - 0.012, out + 0.012, white);
    B(-X, X, 0.3, 0.38, out - 0.014, out + 0.014, blue);
    const word = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.22), new THREE.MeshLambertMaterial({ map: policeWord(), transparent: true }));
    word.position.set(-0.03, 0.86, out + s * 0.016);
    if (s < 0) word.rotation.y = Math.PI;
    A.add(word);
  }
  // the front: a windscreen slit you drive through, and a bull bar
  B(X - T, X, lo, sill, -Z, Z, black);
  B(X - T, X, head, top, -Z, Z, black);
  for (const [a, b] of [[-Z, -0.42], [0.42, Z]]) B(X - T, X, sill, head, a, b, black);
  B(X - T * 0.7, X - T * 0.3, sill, head, -0.42, 0.42, glass);
  B(X + 0.04, X + 0.12, 0.25, 0.8, -0.6, 0.6, black);
  for (const z of [-0.45, 0, 0.45]) B(X, X + 0.12, 0.25, 0.8, z - 0.04, z + 0.04, black);
  // the back: one small window
  B(-X, -X + T, lo, sill, -Z, Z, black);
  B(-X, -X + T, head, top, -Z, Z, black);
  for (const [a, b] of [[-Z, -0.2], [0.2, Z]]) B(-X, -X + T, sill, head, a, b, black);
  B(-X + T * 0.3, -X + T * 0.7, sill, head, -0.2, 0.2, glass);
  B(-X - 0.01, -X + 0.01, 0.3, 0.38, -Z, Z, blue);
  g.userData.armour = A;
}

let POLICE_WORD = null;
function policeWord() {
  if (POLICE_WORD) return POLICE_WORD;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#14161b';
  x.font = 'bold 46px sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText('POLICE', 128, 34);
  POLICE_WORD = new THREE.CanvasTexture(c);
  POLICE_WORD.colorSpace = THREE.SRGBColorSpace;
  return POLICE_WORD;
}

// a six-barrelled Gatling gun on a turret at the back of the roof. It turns on
// its base (yaw), tips up and down on its cradle (pitch), and the barrels spin.
// Its parts are left in g.userData.turret for the game to aim; local +x is forward.
export const TURRET_AT = { x: -0.55, y: 1.95, z: 0, pivot: 0.62 };   // the barrels clear the light bar
// (the helicopter's door gun is the same piece, on a pintle in its doorway: see streaks.js)
export function addGatling(g, at = TURRET_AT) {
  const dark = new THREE.MeshStandardMaterial({ color: '#2a2d33', metalness: 0.7, roughness: 0.4 });
  const steel = chromeMaterial();
  const yaw = new THREE.Group();
  yaw.position.set(at.x, at.y, at.z || 0);
  g.add(yaw);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 0.12, 20), dark);
  ring.position.y = 0.06;
  yaw.add(ring);
  for (const z of [-0.26, 0.26]) {
    const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.66, 0.06), dark);
    cheek.position.set(0, 0.42, z);
    yaw.add(cheek);
  }
  const pitch = new THREE.Group();
  pitch.position.y = at.pivot;
  yaw.add(pitch);
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.3, 0.42), dark);
  housing.position.x = -0.05;
  pitch.add(housing);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.36, 16), steel);
  drum.rotation.x = Math.PI / 2;
  drum.position.set(-0.25, -0.26, 0);
  pitch.add(drum);
  // the barrel cluster: six long barrels round a spindle, pointing forward (+x)
  const spin = new THREE.Group();
  spin.position.x = 0.26;
  pitch.add(spin);
  const barrelGeo = new THREE.CylinderGeometry(0.035, 0.035, 1.5, 8);
  barrelGeo.rotateZ(Math.PI / 2);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const b = new THREE.Mesh(barrelGeo, steel);
    b.position.set(0.75, Math.cos(a) * 0.1, Math.sin(a) * 0.1);
    spin.add(b);
  }
  for (const x of [0.12, 0.9, 1.45]) {
    const clamp = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.06, 14).rotateZ(Math.PI / 2), dark);
    clamp.position.x = x;
    spin.add(clamp);
  }
  const muzzle = new THREE.Object3D();
  muzzle.position.x = 1.55;
  spin.add(muzzle);
  g.userData.turret = { yaw, pitch, spin, muzzle };
}

// the livery on a skinned cart: decals a hair proud of the bonnet, the sides and the roof
const liveryGeo = {};
function addCartLivery(g, skin) {
  const mk = (face) => {
    const t = new THREE.CanvasTexture(cartCanvas(skin, face));
    t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.MeshLambertMaterial({ map: t, transparent: face.startsWith('side'), alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2 });
    if (skin.glow) { m.emissive = new THREE.Color(skin.glow); m.emissiveMap = t; m.emissiveIntensity = 0.35; }
    return m;
  };
  const S = CART_SIDE;
  if (!liveryGeo.hood) {
    liveryGeo.hood = new THREE.PlaneGeometry(0.6, 1.1).rotateX(-Math.PI / 2);
    liveryGeo.roof = new THREE.PlaneGeometry(2.3, 1.24).rotateX(-Math.PI / 2);
    liveryGeo.side = new THREE.PlaneGeometry(S.x1 - S.x0, S.y1 - S.y0);
    for (const k in liveryGeo) liveryGeo[k].userData.shared = true;    // every skinned cart uses these
  }
  const hood = new THREE.Mesh(liveryGeo.hood, mk('hood'));
  hood.position.set(0.85, 0.925, 0);
  const roof = new THREE.Mesh(liveryGeo.roof, mk('roof'));
  roof.position.set(0, 1.935, 0);
  const right = new THREE.Mesh(liveryGeo.side, mk('sideR'));
  right.position.set((S.x0 + S.x1) / 2, (S.y0 + S.y1) / 2, 0.607);
  const left = new THREE.Mesh(liveryGeo.side, mk('sideL'));
  left.position.set((S.x0 + S.x1) / 2, (S.y0 + S.y1) / 2, -0.607);
  left.rotation.y = Math.PI;
  for (const m of [hood, roof, right, left]) { m.castShadow = false; m.receiveShadow = true; g.add(m); }
}

export function makeForkliftGroup() {
  const tx = textures();
  const steel = new GeoBuilder(), paint = new GeoBuilder();
  const wheels = [];
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 16);
  World.prototype.addForklift.call({}, steel, paint, wheels, wheelGeo, { x: 0, z: 0, yaw: 0 });
  const g = new THREE.Group();
  for (const [gb, mat] of [[steel, new THREE.MeshLambertMaterial({ map: tx.metal, vertexColors: true })], [paint, new THREE.MeshLambertMaterial({ vertexColors: true })]]) {
    if (gb.empty) continue;
    const mesh = new THREE.Mesh(gb.geometry(), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  if (wheels.length) {
    const mesh = new THREE.Mesh(mergeInto(wheels), new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.castShadow = true;
    g.add(mesh);
  }
  wheelGeo.dispose();
  return g;
}
