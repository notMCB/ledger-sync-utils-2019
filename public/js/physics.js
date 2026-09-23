// Collision against the town: oriented boxes in a uniform grid.
// Used for player movement, bullets, grenades and line of sight.

import * as THREE from 'three';

const CELL = 4;

export class Physics {
  constructor(boxes, bounds, tunnels) {
    this.boxes = [];
    this.cells = new Map();
    this.stamp = 1;
    this.bx = bounds[0] + 4;
    this.bz = bounds[1] + 4;
    // the tunnels below the town. Only a hatch shaft actually opens the ground;
    // the corridors are sealed under it, so the street above stays solid.
    this.pits = (tunnels && tunnels.pits) || [];
    this.shafts = (tunnels && tunnels.shafts) || [];
    this.pitFloor = (tunnels && tunnels.floor) || 0;
    for (const b of boxes) this.add(b);
  }

  static inRects(rects, x, z, m = 0) {
    for (const p of rects) {
      if (x > p[0] - m && x < p[2] + m && z > p[1] - m && z < p[3] + m) return true;
    }
    return false;
  }

  // the level the ground sits at here: 0 everywhere except down an open hatch
  floorAt(x, z, y = 1) {
    if (this.shafts.length && Physics.inRects(this.shafts, x, z)) return this.pitFloor;
    // already below the street: you're in the tunnels, so the tunnel floor
    // holds you wherever you are down there (the walls keep you in the
    // corridors; asking the rects would pop you up to the street at a corner)
    if (y < -0.6) return this.pitFloor;
    return 0;
  }

  inPit(x, z, m = 0) {
    return Physics.inRects(this.shafts.length ? this.shafts : this.pits, x, z, m);
  }

  add([cx, cy, cz, hx, hy, hz, yaw, mat]) {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    // extent of the rotated rectangle along world x and z
    const ex = Math.abs(c) * hx + Math.abs(s) * hz;
    const ez = Math.abs(s) * hx + Math.abs(c) * hz;
    const b = { cx, cy, cz, hx, hy, hz, c, s, mat, minY: cy - hy, maxY: cy + hy, mark: 0,
      thin: mat === 'tile' && hy < 0.05 };
    this.boxes.push(b);
    const x0 = Math.floor((cx - ex) / CELL), x1 = Math.floor((cx + ex) / CELL);
    const z0 = Math.floor((cz - ez) / CELL), z1 = Math.floor((cz + ez) / CELL);
    b.cells = [];
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = ix * 4096 + iz;
        let arr = this.cells.get(k);
        if (!arr) this.cells.set(k, (arr = []));
        arr.push(b);
        b.cells.push(k);
      }
    }
    return b;
  }

  // take out a box that was added after the map was built (a cover wall)
  remove(b) {
    if (!b || !b.cells) return;
    for (const k of b.cells) {
      const arr = this.cells.get(k);
      if (!arr) continue;
      const i = arr.indexOf(b);
      if (i >= 0) arr.splice(i, 1);
    }
    const i = this.boxes.indexOf(b);
    if (i >= 0) this.boxes.splice(i, 1);
    b.cells = null;
  }

  query(minx, minz, maxx, maxz, out) {
    out.length = 0;
    const st = ++this.stamp;
    const x0 = Math.floor(minx / CELL), x1 = Math.floor(maxx / CELL);
    const z0 = Math.floor(minz / CELL), z1 = Math.floor(maxz / CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const arr = this.cells.get(ix * 4096 + iz);
        if (!arr) continue;
        for (const b of arr) {
          if (b.mark !== st) {
            b.mark = st;
            out.push(b);
          }
        }
      }
    }
    return out;
  }

  // -- rays ----------------------------------------------------------------

  // ray against one box; returns t or -1, writes local normal axis into n
  rayBox(b, ox, oy, oz, dx, dy, dz, maxT, n) {
    const rx = ox - b.cx, rz = oz - b.cz;
    const lx = b.c * rx - b.s * rz;
    const lz = b.s * rx + b.c * rz;
    const ly = oy - b.cy;
    const ldx = b.c * dx - b.s * dz;
    const ldz = b.s * dx + b.c * dz;
    const ldy = dy;
    let t0 = 0, t1 = maxT, axis = -1, sign = 0;
    // x
    if (Math.abs(ldx) < 1e-9) {
      if (lx < -b.hx || lx > b.hx) return -1;
    } else {
      let a = (-b.hx - lx) / ldx, c = (b.hx - lx) / ldx, sg = -1;
      if (a > c) { const t = a; a = c; c = t; sg = 1; }
      if (a > t0) { t0 = a; axis = 0; sign = sg; }
      if (c < t1) t1 = c;
      if (t0 > t1) return -1;
    }
    if (Math.abs(ldy) < 1e-9) {
      if (ly < -b.hy || ly > b.hy) return -1;
    } else {
      let a = (-b.hy - ly) / ldy, c = (b.hy - ly) / ldy, sg = -1;
      if (a > c) { const t = a; a = c; c = t; sg = 1; }
      if (a > t0) { t0 = a; axis = 1; sign = sg; }
      if (c < t1) t1 = c;
      if (t0 > t1) return -1;
    }
    if (Math.abs(ldz) < 1e-9) {
      if (lz < -b.hz || lz > b.hz) return -1;
    } else {
      let a = (-b.hz - lz) / ldz, c = (b.hz - lz) / ldz, sg = -1;
      if (a > c) { const t = a; a = c; c = t; sg = 1; }
      if (a > t0) { t0 = a; axis = 2; sign = sg; }
      if (c < t1) t1 = c;
      if (t0 > t1) return -1;
    }
    if (axis < 0) return -1; // started inside
    // local normal -> world
    let nx = 0, ny = 0, nz = 0;
    if (axis === 0) nx = sign; else if (axis === 1) ny = sign; else nz = sign;
    n.x = b.c * nx + b.s * nz;
    n.y = ny;
    n.z = -b.s * nx + b.c * nz;
    return t0;
  }

  // walks the grid along the ray; returns {t, point, normal, box} or null
  raycast(o, d, maxT = 400, res = null) {
    const n = new THREE.Vector3();
    const tg = d.y < -1e-6 ? -o.y / d.y : Infinity;
    let groundT = tg >= 0 && tg < maxT ? tg : Infinity;
    // a ray that crosses ground level inside a hatch keeps going down the shaft
    if (groundT < Infinity && this.pits.length && this.inPit(o.x + d.x * groundT, o.z + d.z * groundT)) groundT = Infinity;
    let best = Math.min(maxT, groundT), bestBox = null;
    const bn = new THREE.Vector3();
    const st = ++this.stamp;
    let ix = Math.floor(o.x / CELL), iz = Math.floor(o.z / CELL);
    const sx = d.x > 0 ? 1 : -1, sz = d.z > 0 ? 1 : -1;
    const tdx = Math.abs(d.x) > 1e-9 ? CELL / Math.abs(d.x) : Infinity;
    const tdz = Math.abs(d.z) > 1e-9 ? CELL / Math.abs(d.z) : Infinity;
    let tmx = Math.abs(d.x) > 1e-9 ? ((sx > 0 ? (ix + 1) * CELL - o.x : o.x - ix * CELL) / Math.abs(d.x)) : Infinity;
    let tmz = Math.abs(d.z) > 1e-9 ? ((sz > 0 ? (iz + 1) * CELL - o.z : o.z - iz * CELL) / Math.abs(d.z)) : Infinity;
    let tcell = 0;
    for (let guard = 0; guard < 400; guard++) {
      const arr = this.cells.get(ix * 4096 + iz);
      if (arr) {
        for (const b of arr) {
          if (b.mark === st) continue;
          b.mark = st;
          const t = this.rayBox(b, o.x, o.y, o.z, d.x, d.y, d.z, best, n);
          if (t >= 0 && t < best) {
            best = t;
            bestBox = b;
            bn.copy(n);
          }
        }
      }
      const tnext = Math.min(tmx, tmz);
      if (best <= tnext || tnext > best) break;
      tcell = tnext;
      if (tmx < tmz) { ix += sx; tmx += tdx; } else { iz += sz; tmz += tdz; }
      if (Math.abs(ix * CELL) > this.bx + CELL * 2 || Math.abs(iz * CELL) > this.bz + CELL * 2) break;
    }
    if (!bestBox && groundT < Infinity) {
      const r = res || {};
      bn.set(0, 1, 0);
      r.t = groundT; r.point = new THREE.Vector3().copy(o).addScaledVector(d, groundT); r.normal = bn; r.box = null; r.ground = true;
      return r;
    }
    if (!bestBox) return null;
    const r = res || {};
    r.t = best;
    r.point = new THREE.Vector3().copy(o).addScaledVector(d, best);
    r.normal = bn;
    r.box = bestBox;
    r.ground = false;
    return r;
  }

  lineClear(a, b) {
    const d = new THREE.Vector3().subVectors(b, a);
    const L = d.length();
    if (L < 1e-4) return true;
    d.multiplyScalar(1 / L);
    const h = this.raycast(a, d, L);
    return !h;
  }

  // -- characters ------------------------------------------------------------

  // circle (x,z,r) against box footprint; returns push vector in world or null
  static pushOut(b, x, z, r, out) {
    const dx = x - b.cx, dz = z - b.cz;
    const lx = b.c * dx - b.s * dz;
    const lz = b.s * dx + b.c * dz;
    const qx = Math.max(-b.hx, Math.min(b.hx, lx));
    const qz = Math.max(-b.hz, Math.min(b.hz, lz));
    let ex = lx - qx, ez = lz - qz;
    const d2 = ex * ex + ez * ez;
    if (d2 >= r * r) return false;
    let px, pz;
    if (d2 > 1e-10) {
      const d = Math.sqrt(d2);
      const push = r - d;
      px = (ex / d) * push;
      pz = (ez / d) * push;
    } else {
      const ox = b.hx - Math.abs(lx), oz = b.hz - Math.abs(lz);
      if (ox < oz) { px = (lx >= 0 ? 1 : -1) * (ox + r); pz = 0; } else { px = 0; pz = (lz >= 0 ? 1 : -1) * (oz + r); }
    }
    out.x = b.c * px + b.s * pz;
    out.z = -b.s * px + b.c * pz;
    return true;
  }

  static overlapsCircle(b, x, z, r) {
    const dx = x - b.cx, dz = z - b.cz;
    const lx = b.c * dx - b.s * dz;
    const lz = b.s * dx + b.c * dz;
    const qx = Math.max(-b.hx, Math.min(b.hx, lx));
    const qz = Math.max(-b.hz, Math.min(b.hz, lz));
    const ex = lx - qx, ez = lz - qz;
    return ex * ex + ez * ez < r * r;
  }

  // Move a standing cylinder (feet at pos) by vel*dt with stepping and gravity.
  // body: {pos, vel, grounded, radius, height}
  move(body, dt, gravity, step = 0.45) {
    const tmp = this._tmp || (this._tmp = []);
    const push = this._push || (this._push = { x: 0, z: 0 });
    const r = body.radius;
    const p = body.pos;
    const v = body.vel;
    // horizontal
    const nx = p.x + v.x * dt;
    const nz = p.z + v.z * dt;
    p.x = nx; p.z = nz;
    const stepH = body.grounded ? step : 0.2;
    this.query(p.x - r - 1, p.z - r - 1, p.x + r + 1, p.z + r + 1, tmp);
    for (let it = 0; it < 4; it++) {
      let moved = false;
      for (const b of tmp) {
        if (b.maxY <= p.y + stepH || b.minY >= p.y + body.height) continue;
        if (Physics.pushOut(b, p.x, p.z, r, push)) {
          p.x += push.x;
          p.z += push.z;
          // cancel velocity into the wall
          const L = Math.hypot(push.x, push.z);
          if (L > 1e-6) {
            const ux = push.x / L, uz = push.z / L;
            const vn = v.x * ux + v.z * uz;
            if (vn < 0) { v.x -= vn * ux; v.z -= vn * uz; }
          }
          moved = true;
        }
      }
      if (!moved) break;
    }
    // vertical
    v.y -= gravity * dt;
    let ny = p.y + v.y * dt;
    this.query(p.x - r, p.z - r, p.x + r, p.z + r, tmp);
    const fr = r * 0.8;
    // ground under us: highest top at or below feet + step
    let ground = this.pits.length ? this.floorAt(p.x, p.z, p.y) : 0;
    const reach = body.grounded ? step : Math.max(0.05, -v.y * dt + 0.05);
    for (const b of tmp) {
      if (b.maxY > p.y + reach || b.maxY <= ground) continue;
      if (Physics.overlapsCircle(b, p.x, p.z, fr)) ground = b.maxY;
    }
    if (v.y > 0) {
      // ceiling
      let ceil = Infinity;
      for (const b of tmp) {
        if (b.minY < p.y + body.height - 0.3 || b.minY >= ceil) continue;
        if (Physics.overlapsCircle(b, p.x, p.z, fr)) ceil = b.minY;
      }
      if (ny + body.height > ceil) {
        ny = ceil - body.height;
        v.y = 0;
      }
    }
    if (ny <= ground) {
      body.landed = !body.grounded ? -v.y : 0;
      p.y = ground;
      v.y = 0;
      body.grounded = true;
    } else if (body.grounded && v.y <= 0 && p.y - ground <= step + 0.02) {
      // stick to stairs and slopes going down
      p.y = ground;
      v.y = 0;
      body.landed = 0;
    } else {
      p.y = ny;
      body.grounded = false;
      body.landed = 0;
    }
  }

  // can a cylinder of this height stand here? (for standing up from a crouch)
  fits(pos, r, h) {
    const tmp = this._tmp2 || (this._tmp2 = []);
    this.query(pos.x - r, pos.z - r, pos.x + r, pos.z + r, tmp);
    for (const b of tmp) {
      if (b.maxY <= pos.y + 0.46 || b.minY >= pos.y + h) continue;
      if (Physics.overlapsCircle(b, pos.x, pos.z, r * 0.95)) return false;
    }
    return true;
  }

  // is there a roof overhead? (for indoor lighting of the gun)
  covered(pos) {
    const h = this.raycast(pos, UP, 20);
    return !!h;
  }
}

const UP = new THREE.Vector3(0, 1, 0);
