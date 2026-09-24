// Tracers, muzzle flashes, impacts, bullet holes, grenades and explosions.

import * as THREE from 'three';
import { flashTex, softDot, holeTex } from './textures.js';

const TRACER_SPEED = 320; // m/s — slow enough to see, fast enough to feel like a bullet

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);

    // tracers: a bright core and a softer glow, both stretched along the path
    this.tracerGeo = new THREE.BoxGeometry(1, 1, 1);
    this.tracerGeo.translate(0, 0, -0.5);
    this.tracers = [];

    // world muzzle flashes (for other players) and lights for all flashes
    this.flashMat = new THREE.SpriteMaterial({ map: flashTex(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.flashes = [];
    this.lights = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight('#ffb15a', 0, 9, 2);
      this.group.add(l);
      this.lights.push({ l, t: 0 });
    }
    this.lightI = 0;

    this.puffTex = softDot('rgba(235,215,180,0.9)', 'rgba(235,215,180,0)');
    this.sparkTex = softDot('rgba(255,230,160,1)', 'rgba(255,160,60,0)');
    this.bloodTex = softDot('rgba(150,20,15,0.95)', 'rgba(120,10,10,0)');
    this.smokeTex = softDot('rgba(90,80,70,0.8)', 'rgba(90,80,70,0)');
    this.fireTex = softDot('rgba(255,220,140,1)', 'rgba(255,90,20,0)');
    this.coreTex = softDot('rgba(255,255,235,1)', 'rgba(255,200,80,0)');
    this.particles = [];

    this.holeMat = new THREE.MeshBasicMaterial({ map: holeTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.holeGeo = new THREE.PlaneGeometry(0.13, 0.13);
    this.holes = [];

    this.nadeGeo = new THREE.SphereGeometry(0.06, 10, 8);
    this.nadeMat = new THREE.MeshStandardMaterial({ color: '#4a5236', roughness: 0.7, metalness: 0.2 });
    this.flashNadeMat = new THREE.MeshStandardMaterial({ color: '#c9ccd1', roughness: 0.4, metalness: 0.5 });
    this.smokeNadeMat = new THREE.MeshStandardMaterial({ color: '#6f7a6a', roughness: 0.8, metalness: 0.3 });
    this.bottleMat = new THREE.MeshStandardMaterial({ color: '#3f6b3a', roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 });
    this.ragMat = new THREE.MeshBasicMaterial({ color: '#ffb03a' });
    this.fires = [];       // burning patches: { pos, t, life }
    this.poolAdd = [];     // spare sprites, additive and normal blending
    this.poolNorm = [];
    this.nades = [];
    this.shake = 0;
  }

  clear() {
    for (const t of this.tracers) this.group.remove(t.mesh);
    for (const p of this.particles) this.recycle(p);
    for (const h of this.holes) this.group.remove(h);
    for (const n of this.nades) this.group.remove(n.mesh);
    for (const f of this.flashes) this.group.remove(f.s);
    this.tracers = []; this.particles = []; this.holes = []; this.nades = []; this.flashes = []; this.fires = [];
  }

  tracer(from, to, color = 0xffd27a, width = 1) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const dist = dir.length();
    if (dist < 0.5) return;
    dir.multiplyScalar(1 / dist);
    const mat = new THREE.MeshBasicMaterial({ color, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.95, depthWrite: false, fog: false });
    const mesh = new THREE.Mesh(this.tracerGeo, mat);
    mesh.position.copy(from);
    mesh.lookAt(to);
    const glowMat = new THREE.MeshBasicMaterial({ color, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.25, depthWrite: false, fog: false });
    const glow = new THREE.Mesh(this.tracerGeo, glowMat);
    mesh.add(glow);
    glow.scale.set(3, 3, 1);
    this.group.add(mesh);
    this.tracers.push({ mesh, from: from.clone(), dir, dist, t: 0, width: 0.018 * width });
  }

  light(pos, intensity = 6, color = 0xffb15a, dur = 0.06) {
    const L = this.lights[this.lightI++ % this.lights.length];
    L.l.position.copy(pos);
    L.l.color.set(color);
    L.l.intensity = intensity;
    L.max = intensity;
    L.t = dur;
    L.dur = dur;
  }

  muzzleFlash(pos, scale = 0.6, quiet = false) {
    const s = new THREE.Sprite(this.flashMat);
    s.position.copy(pos);
    s.scale.set(scale, scale, 1);
    this.group.add(s);
    this.flashes.push({ s, t: 0.05 });
    if (!quiet) this.light(pos, 5);
  }

  // Sprites and their materials are pooled: a flamethrower makes a hundred
  // particles a second, and building and throwing away a material for each
  // was the garbage collector's biggest customer. Two pools, one per blend.
  particle(tex, pos, vel, size, grow, life, gravity = 0, opacity = 1, additive = false, hold = 0) {
    const pool = additive ? this.poolAdd : this.poolNorm;
    let s = pool.pop();
    if (!s) {
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
      s = new THREE.Sprite(mat);
    } else if (s.material.map !== tex) {
      s.material.map = tex;
      s.material.needsUpdate = true;
    }
    s.material.opacity = opacity;
    s.position.copy(pos);
    s.scale.set(size, size, 1);
    s.material.rotation = Math.random() * Math.PI * 2;
    this.group.add(s);
    // hold: the fraction of its life a particle stays at full strength before fading
    this.particles.push({ s, vel: vel.clone(), size, grow, life, t: 0, gravity, opacity, hold, additive });
  }

  // a spent particle goes back to its pool for the next one
  recycle(p) {
    this.group.remove(p.s);
    const pool = p.additive ? this.poolAdd : this.poolNorm;
    if (pool.length < 600) pool.push(p.s);
    else p.s.material.dispose();
  }

  // a burning patch about four and a half metres across, fed with flame and smoke for `life` seconds
  fireZone(pos, life) {
    this.fires.push({ pos: pos.clone(), t: 0, life, next: 0 });
    this.light(pos.clone().add(new THREE.Vector3(0, 0.8, 0)), 40, 0xff8030, 0.5);
    for (let i = 0; i < 22; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6 + 0.2, Math.random() - 0.5).multiplyScalar(8);
      this.particle(this.fireTex, pos.clone().add(new THREE.Vector3(0, 0.2, 0)), v, 0.7, 2.5, 0.5 + Math.random() * 0.3, -1, 1, true);
    }
  }

  // The flamethrower's jet: fire born at the nozzle, white-hot and thin, that
  // swells, slows and droops as it leaves the gun. `n` particles a call; the
  // shooter's client calls this every frame the trigger is held, so the
  // stream reads as one unbroken tongue from the muzzle.
  flame(origin, dir, len, n = 2) {
    for (let i = 0; i < n; i++) {
      const along = Math.random();                       // where along the first stretch this one is born
      const spread = 0.03 + along * 0.3;
      const d = dir.clone().add(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread + 0.02, (Math.random() - 0.5) * spread)).normalize();
      const speed = len * 2.3 + Math.random() * 2.5;
      const start = origin.clone().addScaledVector(dir, along * 0.45);
      this.particle(this.fireTex, start, d.multiplyScalar(speed), 0.07 + along * 0.18, 5.5, 0.4, -4, 0.95, true);
    }
    // the hot core right at the nozzle
    this.particle(this.coreTex, origin.clone().addScaledVector(dir, 0.08), dir.clone().multiplyScalar(len * 2.0), 0.1, 3, 0.1, 0, 0.9, true);
    if (Math.random() < 0.25) {
      const v = dir.clone().multiplyScalar(len * 1.4).add(new THREE.Vector3(0, 1.2, 0));
      this.particle(this.smokeTex, origin.clone().addScaledVector(dir, 0.8), v, 0.4, 4, 1.4, -0.3, 0.45);
    }
  }

  // flames licking round someone who is on fire
  burning(pos) {
    for (let i = 0; i < 2; i++) {
      const start = pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.3 + Math.random() * 1.2, (Math.random() - 0.5) * 0.5));
      const v = new THREE.Vector3((Math.random() - 0.5) * 0.6, 1.5 + Math.random(), (Math.random() - 0.5) * 0.6);
      this.particle(this.fireTex, start, v, 0.3, 2, 0.35 + Math.random() * 0.2, -2, 1, true);
    }
  }

  // a smoke grenade: a thick cloud about fifteen metres across that hangs for 15 seconds
  smoke(pos) {
    for (let i = 0; i < 52; i++) {
      const start = pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3.2, 0.4 + Math.random() * 2.4, (Math.random() - 0.5) * 3.2));
      const v = new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.3) * 0.4, Math.random() - 0.5).multiplyScalar(4.4);
      const life = 12 + Math.random() * 4;
      this.particle(this.smokeTex, start, v, 4.8 + Math.random() * 3.2, 1.4, life, -0.02, 0.95, false, 0.7);
    }
    // a small burst of lighter puffs as it pops
    for (let i = 0; i < 8; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(5);
      this.particle(this.puffTex, pos.clone().add(new THREE.Vector3(0, 0.3, 0)), v, 0.6, 3, 1.2, -0.3, 0.6);
    }
  }

  impact(point, normal, mat) {
    const n = normal || new THREE.Vector3(0, 1, 0);
    const r = () => (Math.random() - 0.5);
    const dusty = mat !== 'car';
    for (let i = 0; i < (dusty ? 4 : 2); i++) {
      const v = n.clone().multiplyScalar(0.6 + Math.random() * 1.2).add(new THREE.Vector3(r(), r() * 0.5 + 0.3, r()));
      this.particle(this.puffTex, point.clone().addScaledVector(n, 0.05), v, 0.12, 1.4, 0.45 + Math.random() * 0.3, 1.5, 0.7);
    }
    for (let i = 0; i < 3; i++) {
      const v = n.clone().multiplyScalar(2 + Math.random() * 3).add(new THREE.Vector3(r() * 4, r() * 4, r() * 4));
      this.particle(this.sparkTex, point.clone().addScaledVector(n, 0.03), v, 0.05, -0.05, 0.15 + Math.random() * 0.1, 9, 1, true);
    }
    this.hole(point, n);
  }

  hole(point, normal) {
    const m = new THREE.Mesh(this.holeGeo, this.holeMat);
    m.position.copy(point).addScaledVector(normal, 0.004);
    m.lookAt(point.clone().add(normal));
    m.rotateZ(Math.random() * Math.PI);
    const s = 0.7 + Math.random() * 0.5;
    m.scale.set(s, s, 1);
    this.group.add(m);
    this.holes.push(m);
    if (this.holes.length > 180) this.group.remove(this.holes.shift());
  }

  blood(point, dir) {
    for (let i = 0; i < 5; i++) {
      const v = dir.clone().multiplyScalar(1 + Math.random() * 2).add(new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2));
      this.particle(this.bloodTex, point, v, 0.14, 1.2, 0.35 + Math.random() * 0.2, 6, 0.9);
    }
  }

  explosion(pos) {
    this.light(pos.clone().add(new THREE.Vector3(0, 0.6, 0)), 40, 0xffa050, 0.35);
    for (let i = 0; i < 14; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).multiplyScalar(9);
      this.particle(this.fireTex, pos.clone().add(new THREE.Vector3(0, 0.3, 0)), v, 0.9, 3.5, 0.35 + Math.random() * 0.25, -1, 1, true);
    }
    for (let i = 0; i < 16; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6 + 0.3, Math.random() - 0.5).multiplyScalar(4);
      this.particle(this.smokeTex, pos.clone().add(new THREE.Vector3(0, 0.5, 0)), v, 1.4, 3.2, 1.6 + Math.random() * 1.2, -0.4, 0.75);
    }
    for (let i = 0; i < 18; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).multiplyScalar(16);
      this.particle(this.sparkTex, pos.clone().add(new THREE.Vector3(0, 0.3, 0)), v, 0.08, 0, 0.5 + Math.random() * 0.4, 14, 1, true);
    }
  }

  // a flashbang going off: a white burst and a few sparks, no smoke or fire
  flashPop(pos) {
    this.light(pos.clone().add(new THREE.Vector3(0, 0.4, 0)), 60, 0xffffff, 0.25);
    this.particle(this.sparkTex, pos.clone().add(new THREE.Vector3(0, 0.3, 0)), new THREE.Vector3(), 2.5, 2, 0.18, 0, 1, true);
    for (let i = 0; i < 10; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(10);
      this.particle(this.sparkTex, pos.clone().add(new THREE.Vector3(0, 0.2, 0)), v, 0.06, 0, 0.4, 12, 1, true);
    }
    for (let i = 0; i < 5; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.4 + 0.2, Math.random() - 0.5).multiplyScalar(2);
      this.particle(this.puffTex, pos.clone().add(new THREE.Vector3(0, 0.3, 0)), v, 0.5, 2.5, 1.2, -0.2, 0.5);
    }
  }

  // grenades are simulated the same way on every screen from the thrower's
  // starting point and velocity; the thrower's copy decides where it goes off
  throwNade(owner, nid, origin, vel, local, onBoom, kind = 'frag') {
    let mesh;
    if (kind === 'molotov') {
      // a bottle with a burning rag
      mesh = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.16, 10), this.bottleMat);
      mesh.add(body);
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.02, 0.07, 8), this.bottleMat);
      neck.position.y = 0.11;
      mesh.add(neck);
      const rag = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.03), this.ragMat);
      rag.position.y = 0.16;
      mesh.add(rag);
      mesh.rotation.z = 0.8;
    } else {
      mesh = new THREE.Mesh(this.nadeGeo, kind === 'flash' ? this.flashNadeMat : kind === 'smoke' ? this.smokeNadeMat : this.nadeMat);
    }
    mesh.position.copy(origin);
    mesh.castShadow = false;
    this.group.add(mesh);
    this.nades.push({ owner, nid, mesh, pos: origin.clone(), vel: vel.clone(), t: 0, local, onBoom, rest: false });
  }

  removeNade(owner, nid) {
    const i = this.nades.findIndex((n) => n.owner === owner && n.nid === nid);
    if (i >= 0) {
      this.group.remove(this.nades[i].mesh);
      const p = this.nades[i].pos.clone();
      this.nades.splice(i, 1);
      return p;
    }
    return null;
  }

  update(dt, physics, camera, fuse) {
    // burning patches keep feeding flames
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.t += dt;
      if (f.t >= f.life) { this.fires.splice(i, 1); continue; }
      f.next -= dt;
      const dying = f.t > f.life - 3 ? (f.life - f.t) / 3 : 1;
      while (f.next <= 0) {
        f.next += 0.05;
        for (let k = 0; k < 4; k++) {
          const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 2.1 * dying;
          const start = f.pos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.05, Math.sin(a) * r));
          const v = new THREE.Vector3((Math.random() - 0.5) * 0.5, 1.6 + Math.random() * 1.6, (Math.random() - 0.5) * 0.5);
          this.particle(this.fireTex, start, v, 0.45 + Math.random() * 0.4, 1.8, 0.45 + Math.random() * 0.3, -2, dying, true);
        }
        if (Math.random() < 0.7) {
          const a = Math.random() * Math.PI * 2, r = Math.random() * 1.7;
          this.particle(this.smokeTex, f.pos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.8, Math.sin(a) * r)), new THREE.Vector3(0, 1.4, 0), 0.7, 3, 2.2, -0.2, 0.55 * dying);
        }
      }
    }
    // tracers
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.t += dt;
      const raw = tr.t * TRACER_SPEED;
      const head = Math.min(tr.dist, raw);
      const tail = Math.max(0, raw - 4.5);
      if (tail >= tr.dist) {
        this.group.remove(tr.mesh);
        tr.mesh.material.dispose();
        tr.mesh.children[0].material.dispose();
        this.tracers.splice(i, 1);
        continue;
      }
      tr.mesh.position.copy(tr.from).addScaledVector(tr.dir, head);
      // keep a tracer a pixel or two wide however far away it is
      const w = Math.max(tr.width, tr.mesh.position.distanceTo(camera.position) * 0.0016);
      tr.mesh.scale.set(w, w, Math.max(0.01, head - tail));
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.t -= dt;
      if (f.t <= 0) {
        this.group.remove(f.s);
        this.flashes.splice(i, 1);
      }
    }
    for (const L of this.lights) {
      if (L.t > 0) {
        L.t -= dt;
        L.l.intensity = Math.max(0, (L.t / L.dur) * L.max);
      } else L.l.intensity = 0;
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.t += dt;
      const k = p.t / p.life;
      if (k >= 1) {
        this.recycle(p);
        this.particles.splice(i, 1);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(1 - Math.min(1, dt * 1.5));
      p.s.position.addScaledVector(p.vel, dt);
      const s = Math.max(0.01, p.size * (1 + p.grow * k));
      p.s.scale.set(s, s, 1);
      p.s.material.opacity = p.opacity * (p.hold && k < p.hold ? 1 : (1 - k) / (1 - (p.hold || 0)));
    }
    // grenades
    const d = new THREE.Vector3();
    for (let i = this.nades.length - 1; i >= 0; i--) {
      const n = this.nades[i];
      n.t += dt;
      if (!n.rest) {
        const sub = 3;
        for (let s = 0; s < sub; s++) {
          const h = dt / sub;
          n.vel.y -= 16 * h;
          const step = n.vel.length() * h;
          if (step > 1e-5) {
            d.copy(n.vel).normalize();
            const hit = physics.raycast(n.pos, d, step + 0.06);
            if (hit) {
              n.pos.copy(hit.point).addScaledVector(hit.normal, 0.065);
              const vn = n.vel.dot(hit.normal);
              n.vel.addScaledVector(hit.normal, -vn * 1.45);
              n.vel.multiplyScalar(0.55);
              if (hit.normal.y > 0.6 && n.vel.length() < 1.0) {
                n.rest = true;
                n.vel.set(0, 0, 0);
              }
            } else {
              n.pos.addScaledVector(n.vel, h);
            }
          }
        }
        n.mesh.position.copy(n.pos);
        n.mesh.rotation.x += dt * 8;
      }
      if (n.local && n.t >= fuse) {
        this.group.remove(n.mesh);
        this.nades.splice(i, 1);
        if (n.onBoom) n.onBoom(n.pos.clone());
      } else if (!n.local && n.t > fuse + 1.5) {
        this.group.remove(n.mesh);
        this.nades.splice(i, 1);
      }
    }
    this.shake = Math.max(0, this.shake - dt * 2.5);
  }
}
