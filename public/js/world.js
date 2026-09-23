// Builds the town the server sent: merged meshes per material, props,
// sky and sun. Collision lives in physics.js.

import * as THREE from 'three';
import * as T from './textures.js';
import { Physics } from './physics.js';

const WALL_TINTS = ['#f3e9d6', '#ecd3a6', '#dcb68a', '#e9cdbd', '#d4c7ad', '#e0ab7e'];
const CAR_TINTS = ['#8e3b2a', '#4e6f8f', '#d9d4c7', '#5d7a4a', '#c9a13b', '#3b3430'];
const CLOTH = ['#b3352b', '#2f7f7a', '#d49a2a', '#6b3f7a', '#2d5f9a', '#c46a2e'];
const BARREL = ['#35577a', '#8a4a26', '#5a6b3a'];

let texCache = null;
function textures() {
  if (texCache) return texCache;
  texCache = {
    plaster: T.plaster(), stone: T.stone(), ground: T.ground(), tiles: T.tiles(), wood: T.wood(),
    crate: T.crate(), metal: T.metal(), leaf: T.palmLeaf(),
    cloth: CLOTH.map((c) => T.cloth(c)),
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

  // oriented box with world-scaled UVs (scale = metres per texture repeat)
  box(cx, cy, cz, hx, hy, hz, yaw, color, scale, opts = {}) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const W = (lx, ly, lz) => [cx + c * lx + s * lz, cy + ly, cz - s * lx + c * lz];
    const Nv = (lx, ly, lz) => [c * lx + s * lz, ly, -s * lx + c * lz];
    // a stable frame for UVs so neighbouring wall pieces line up
    const ox = c * cx - s * cz;
    const oz = s * cx + c * cz;
    const u = (v) => v / scale;
    const unit = opts.unitUV;
    const x0 = -hx, x1 = hx, y0 = -hy, y1 = hy, z0 = -hz, z1 = hz;
    const yb = cy - hy, yt = cy + hy;
    const skipBottom = opts.skipBottom;
    const f = (a, b, cc, d, n, uv) => this.quad(W(...a), W(...b), W(...cc), W(...d), Nv(...n), uv, color);
    const UV = (u0, v0, u1, v1) => unit ? [[0, 0], [1, 0], [1, 1], [0, 1]] : [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    // +x
    f([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], UV(u(-(oz + z1)), u(yb), u(-(oz + z0)), u(yt)));
    // -x
    f([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], UV(u(oz + z0), u(yb), u(oz + z1), u(yt)));
    // +z
    f([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], UV(u(ox + x0), u(yb), u(ox + x1), u(yt)));
    // -z
    f([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], UV(u(-(ox + x1)), u(yb), u(-(ox + x0)), u(yt)));
    // top
    f([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], UV(u(ox + x0), u(-(oz + z1)), u(ox + x1), u(-(oz + z0))));
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
    this.physics = new Physics(map.boxes, map.bounds, map.tunnels);
    const tx = textures();
    const root = new THREE.Group();
    this.root = root;

    const mats = {
      wall: new THREE.MeshLambertMaterial({ map: tx.plaster, vertexColors: true }),
      tile: new THREE.MeshLambertMaterial({ map: tx.tiles, vertexColors: true }),
      stone: new THREE.MeshLambertMaterial({ map: tx.stone, vertexColors: true }),
      wood: new THREE.MeshLambertMaterial({ map: tx.wood, vertexColors: true }),
      crate: new THREE.MeshLambertMaterial({ map: tx.crate, vertexColors: true }),
      car: new THREE.MeshLambertMaterial({ map: tx.metal, vertexColors: true }),
    };
    const builders = {};
    const B = (k) => builders[k] || (builders[k] = new GeoBuilder());

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
        B('car').box(cx, cy, cz, hx, hy, hz, yaw, colorOf(CAR_TINTS[tint % CAR_TINTS.length]), 2);
      } else if (mat === 'hay') {
        B('wood').box(cx, cy, cz, hx, hy, hz, yaw, colorOf('#e8c96a', 1.25), 1.2);
      }
    }
    for (const k in builders) {
      if (builders[k].empty) continue;
      const mesh = new THREE.Mesh(builders[k].geometry(), mats[k]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
    }

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
      gg = new THREE.PlaneGeometry(W, D);
      gg.rotateX(-Math.PI / 2);
      const guv = gg.attributes.uv;
      for (let i = 0; i < guv.count; i++) guv.setXY(i, guv.getX(i) * W / 9, guv.getY(i) * D / 9);
    }
    const ground = new THREE.Mesh(gg, new THREE.MeshLambertMaterial({ map: tx.ground }));
    ground.receiveShadow = true;
    root.add(ground);

    this.buildDeco(map, root, tx);
    this.setIndoor(!!map.indoor, root, map);
    this.scene.add(root);
    this.renderer.shadowMap.needsUpdate = true;
  }

  buildDeco(map, root, tx) {
    const barrels = [], trunks = [], leaves = [], domes = [], cloth = CLOTH.map(() => []), poles = [], goods = [];
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
        barrels.push({ geo: cyl, matrix: mtx(d.x, 0.5, d.z), color: colorOf(BARREL[d.c % 3]) });
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
        mesh.position.set(d.x, 0.03, d.z);
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
    add(trunks, new THREE.MeshLambertMaterial({ vertexColors: true }));
    add(leaves, new THREE.MeshLambertMaterial({ map: tx.leaf, vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.5 }));
    add(domes, new THREE.MeshLambertMaterial({ map: tx.plaster, vertexColors: true }));
    add(poles, new THREE.MeshLambertMaterial({ vertexColors: true }));
    add(goods, new THREE.MeshLambertMaterial({ vertexColors: true }));
    cloth.forEach((list, i) => add(list, new THREE.MeshLambertMaterial({ map: tx.cloth[i], side: THREE.DoubleSide, vertexColors: true })));
    cyl.dispose(); trunkSeg.dispose(); leafGeo.dispose();
  }

  // a dirt road: one strip following the points, a little above the sand
  addRoad(root, d) {
    const pos = [], uv = [], idx = [];
    const pts = d.pts;
    let along = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x, z] = pts[i];
      const p = pts[Math.max(0, i - 1)], n = pts[Math.min(pts.length - 1, i + 1)];
      let tx = n[0] - p[0], tz = n[1] - p[1];
      const L = Math.hypot(tx, tz) || 1;
      tx /= L; tz /= L;
      const nx = -tz * d.w / 2, nz = tx * d.w / 2;
      if (i) along += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]);
      pos.push(x + nx, 0.02, z + nz, x - nx, 0.02, z - nz);
      uv.push(0, along / 5, 1, along / 5);
      if (i) {
        const a = (i - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    if (!this._roadTex) this._roadTex = T.road();
    const mat = new THREE.MeshLambertMaterial({ map: this._roadTex, polygonOffset: true, polygonOffsetFactor: -1, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    root.add(mesh);
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
    m.position.set(d.x, d.k === 'rug' ? 0.035 : 0.025, d.z);
    m.receiveShadow = true;
    root.add(m);
  }

  // footprints of every building, for the minimap
  footprints() {
    const out = [];
    if (!this.map) return out;
    for (const [cx, cy, cz, hx, hy, hz, yaw, mat] of this.map.boxes) {
      if (mat === 'roof') out.push({ x: cx, z: cz, hx, hz, yaw, h: cy });
    }
    return out;
  }

  props() {
    const out = [];
    if (!this.map) return out;
    for (const [cx, cy, cz, hx, hy, hz, yaw, mat] of this.map.boxes) {
      if (mat === 'crate' || mat === 'car' || mat === 'stone' || mat === 'inv') {
        if (cy - hy > 0.2) continue;
        if (mat === 'stone' && hx > 30) continue;
        out.push({ x: cx, z: cz, hx, hz, yaw, mat });
      }
    }
    return out;
  }
}
