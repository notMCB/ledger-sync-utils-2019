// The match: local player, weapons, network glue, and the render loop.

import * as THREE from 'three';
import { World } from './world.js';
import { ViewModel } from './viewmodel.js';
import { Effects } from './effects.js';
import { Avatars, TEAM_COLORS, TEAM_NAMES, playerColor } from './avatars.js';
import { Hud, MODE_INFO } from './hud.js';
import { input } from './input.js';
import { settings, keyName } from './settings.js';
import { WEAPONS, LOADOUTS, NADES_PER_LIFE, NADE_FUSE, makeWeaponState } from './weapons.js';
import * as sfx from './audio.js';
import { locker } from './locker.js';
import { tickSkins, OUTFIT } from './skins.js';

const GRAVITY = 18;
const JUMP_V = 6.1;
const RADIUS = 0.34;
const STAND_H = 1.8;
const CROUCH_H = 1.2;
const EYE_STAND = 1.62;
const EYE_CROUCH = 1.08;
const WALK = 4.8;
const RUN = 7.0;
const CROUCH_SPEED = 2.5;
const SEND_HZ = 20;
const SITE_R = 4.8;
const HILL_R = 6.0;

const V = () => new THREE.Vector3();
const tmpA = V(), tmpB = V(), tmpC = V(), tmpD = V();

export class Game {
  constructor(canvas, ui) {
    this.ui = ui;
    this.canvas = canvas;
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = settings.shadows;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.shadowMap.autoUpdate = false;
    r.autoClear = false;
    this.renderer = r;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.05, 1200);
    this.camera.rotation.order = 'YXZ';
    this.world = new World(r, this.scene);
    this.world.sun.castShadow = settings.shadows;
    this.vm = new ViewModel();
    this.fx = new Effects(this.scene);
    this.avatars = new Avatars(this.scene);
    this.hud = new Hud();
    this.net = null;

    this.inRoom = false;
    this.room = null;
    this.myId = 0;
    this.map = null;
    this.g = null;          // last game state from the server
    this.roster = new Map();
    this.paused = false;
    this.showScores = false;
    this.previewT = 0;
    this.hasMap = false;

    this.me = {
      team: -1, alive: false, pos: V(), vel: V(), yaw: 0, pitch: 0, crouch: false, crouchK: 0, grounded: true, landed: 0,
      sc: 0, hp: 100, loadout: 0, weapons: null, slot: 'primary', nades: NADES_PER_LIFE, adsK: 0, aimToggled: false,
      sprinting: false, sprintToggled: false, crouchToggled: false, recoilDebt: 0, punch: 0, lastFire: -9, nadeBusy: 0,
      nextNade: 1, interacting: false, deathPos: V(), killerId: 0, spawnT: 0, reloadEnd: 0, shellNext: 0,
      boltPending: 0, pumpPending: 0,
    };
    this.pendingLoadout = settings.lastLoadout !== undefined ? settings.lastLoadout : 0;
    this.me.loadout = this.pendingLoadout;
    this.sendT = 0;
    this.indoor = false;
    this.indoorT = 0;
    this.spectateIdx = 0;
    this.bombMesh = this.makeBombMesh();
    this.scene.add(this.bombMesh);
    this.hill = this.makeHill();
    this.scene.add(this.hill);
    this.lastBeep = 0;
    this.fpsT = 0;
    this.fpsN = 0;
    this.clock = performance.now() / 1000;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    requestAnimationFrame(() => this.frame());
  }

  // -- setup ------------------------------------------------------------------

  makeBombMesh() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.26), new THREE.MeshLambertMaterial({ color: '#4a4a3a' }));
    body.position.y = 0.07;
    g.add(body);
    for (let i = 0; i < 3; i++) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.4, 8), new THREE.MeshLambertMaterial({ color: '#8a6a3a' }));
      c.rotation.z = Math.PI / 2;
      c.position.set(0, 0.17, -0.07 + i * 0.07);
      g.add(c);
    }
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.1), new THREE.MeshBasicMaterial({ color: '#1a1a1a' }));
    panel.position.set(0.08, 0.15, 0.13);
    g.add(panel);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff2a1a' }));
    led.position.set(-0.12, 0.16, 0.1);
    g.add(led);
    g.userData.led = led;
    g.visible = false;
    return g;
  }

  makeHill() {
    const g = new THREE.Group();
    const wallMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(HILL_R, HILL_R, 2.2, 48, 1, true), wallMat);
    wall.position.y = 1.1;
    g.add(wall);
    const ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(HILL_R - 0.25, HILL_R, 64), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    g.add(ring);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(HILL_R - 0.25, 48), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.1, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.035;
    g.add(disc);
    g.userData.mats = [wallMat, ringMat, disc.material];
    g.visible = false;
    return g;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1) * settings.renderScale);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vm.camera.aspect = w / h;
    this.vm.camera.updateProjectionMatrix();
  }

  applySettings() {
    this.resize();
    if (this.renderer.shadowMap.enabled !== settings.shadows) this.world.setShadows(settings.shadows);
    sfx.setVolume(settings.volume);
    document.getElementById('fps').hidden = !settings.showFps;
  }

  // -- network ------------------------------------------------------------------

  onMessage(m) {
    switch (m.t) {
      case 'map': return this.loadMap(m.map);
      case 'joined': return this.onJoined(m);
      case 'spawn': return this.onSpawn(m);
      case 'snap': return this.onSnap(m);
      case 'roster': return this.onRoster(m);
      case 'ev': return this.onEvent(m);
      case 'shot': return this.onRemoteShot(m);
      case 'nade': return this.onRemoteNade(m);
      case 'boom': return this.onRemoteBoom(m);
      case 'hurt': return this.onHurt(m);
      case 'hitok': return this.onHitOk(m);
      case 'dead': return this.onDead(m);
      case 'team': this.me.team = m.team; return this.updateTeamLook();
      case 'ldnow': return this.applyLoadout(m.ld);
      case 'earn':
        locker.earn(m.n);
        this.hud.earn(m.n, m.why);
        return;
      case 'rl': {
        const a = this.avatars.get(m.id);
        if (a) sfx.reloadSound(a.gunId || 'smg', 2, false, a.pos);
        return;
      }
      default:
    }
  }

  loadMap(map) {
    this.map = map;
    this.world.build(map);
    this.hud.buildMinimap(this.world, map);
    this.fx.clear();
    this.hasMap = true;
  }

  onJoined(m) {
    this.inRoom = true;
    this.room = m.room;
    this.myId = m.you;
    this.me.team = m.team;
    this.me.alive = false;
    this.g = null;
    this.roster = new Map();
    this.avatars.clear();
    this.hud.show(true);
    this.updateTeamLook();
    this.ui.onJoined(m.room);
  }

  leave() {
    if (this.inRoom && this.net) this.net.send({ t: 'leave' });
    this.inRoom = false;
    this.room = null;
    this.me.alive = false;
    this.avatars.clear();
    this.fx.clear();
    this.hud.show(false);
    this.bombMesh.visible = false;
    this.hill.visible = false;
    this.vm.scoped = false;
    this.hud.scope(false);
    document.getElementById('death').hidden = true;
  }

  isTeamMode() {
    return this.room && this.room.mode !== 'ffa';
  }

  warmup() {
    return !this.g || this.g.ph === 'waiting' || this.g.ph === 'countdown';
  }

  // teams only matter once the match is live; warm-up is everyone against everyone
  isEnemy(team) {
    if (!this.isTeamMode() || this.warmup()) return true;
    return team !== this.me.team;
  }

  updateTeamLook() {
    const t = this.me.team;
    const col = playerColor(this.myId, t);
    const outfit = OUTFIT[locker.equippedOutfit()];
    const sleeve = outfit && outfit.shirt ? outfit.shirt : outfit && outfit.colors ? outfit.colors[1] : new THREE.Color(col).multiplyScalar(0.75).getStyle();
    this.vm.setTeamColor(sleeve);
    if (this.isTeamMode() && (t === 0 || t === 1)) {
      let label = `${TEAM_NAMES[t]} team`;
      if (this.room.mode === 'bomb' && this.g && this.g.att !== undefined) label += this.g.att === t ? ' · attacking' : ' · defending';
      this.hud.setTeamLabel(label, TEAM_COLORS[t]);
    } else {
      this.hud.setTeamLabel(this.room && this.room.mode === 'ffa' ? 'Free for all' : '', col);
    }
  }

  // after equipping something in the locker
  refreshCosmetics() {
    this.vm.setSkins(locker.cosmetics().g);
    this.updateTeamLook();
    if (this.inRoom && this.net) this.net.send({ t: 'cos', cos: locker.cosmetics() });
  }

  applyLoadout(ld) {
    const me = this.me;
    me.loadout = ld;
    const primary = LOADOUTS[ld].weapon;
    me.weapons = { primary: makeWeaponState(primary), pistol: makeWeaponState('pistol') };
    me.slot = 'primary';
    this.vm.setSkins(locker.cosmetics().g);
    this.vm.setWeapon(primary);
    this.hud.lastAmmo = '';
  }

  onSpawn(m) {
    const me = this.me;
    me.pos.set(m.p[0], m.p[1], m.p[2]);
    me.vel.set(0, 0, 0);
    me.yaw = m.y;
    me.pitch = 0;
    me.sc = m.sc;
    me.alive = true;
    me.hp = 100;
    me.team = m.tm;
    me.nades = NADES_PER_LIFE;
    me.crouch = false;
    me.crouchK = 0;
    me.adsK = 0;
    me.aimToggled = false;
    me.recoilDebt = 0;
    me.punch = 0;
    me.interacting = false;
    me.spawnT = this.clock;
    me.grounded = true;
    this.applyLoadout(m.ld);
    this.updateTeamLook();
    this.hud.setHP(100);
    document.getElementById('death').hidden = true;
    document.getElementById('spectate').hidden = true;
    this.ui.onSpawn();
  }

  onDead(m) {
    const me = this.me;
    me.alive = false;
    me.deathPos.copy(me.pos);
    me.killerId = m.by;
    me.respawnAt = m.rs >= 0 ? this.clock + m.rs : -1;
    me.interacting = false;
    this.vm.scoped = false;
    this.hud.scope(false);
    if (me.slot && me.weapons) me.weapons[me.slot].reloading = false;
    const by = m.by && m.by !== this.myId ? `Killed by <b>${escapeHtml(m.byn)}</b>` : m.w === 'bomb' ? 'Caught in the blast' : 'You died';
    this.ui.showDeath(by, me.respawnAt);
  }

  onSnap(m) {
    const t = this.clock;
    const prevPhase = this.g ? this.g.ph : null;
    this.g = m.g;
    for (const p of m.p) {
      if (p[0] === this.myId) {
        this.me.hp = p[9];
        const alive = !!(p[6] & 1);
        if (!alive && this.me.alive) this.me.alive = false;
      }
    }
    this.avatars.sync(m.p, this.myId, t);
    if (prevPhase !== this.g.ph) this.onPhase(prevPhase, this.g.ph);
  }

  onPhase(prev, ph) {
    const g = this.g;
    if (ph === 'waiting') this.hud.center('Warm-up', 'The match starts when a second player joins', '', 3, 1);
    if (ph === 'live' && g.mode !== 'bomb') {
      this.hud.center(MODE_INFO[g.mode].name, this.goalText(), '', 3.5, 2);
    }
    this.updateTeamLook();
    this.ui.onPhase(ph);
  }

  goalText() {
    const m = this.g.mode;
    if (m === 'tdm') return 'First team to 50 kills wins';
    if (m === 'ffa') return 'First to 25 kills wins';
    if (m === 'koth') return 'Hold the hill with nobody from the other team on it';
    return '';
  }

  onRoster(m) {
    this.roster = new Map(m.pl.map((p) => [p.id, p]));
    this.avatars.setRoster(m.pl);
    const me = this.roster.get(this.myId);
    if (me && me.tm !== this.me.team) {
      this.me.team = me.tm;
      this.updateTeamLook();
    }
    this.ui.onRoster();
  }

  nameOf(id) {
    const p = this.roster.get(id);
    return p ? p.n : 'Someone';
  }

  colorOf(id) {
    const p = this.roster.get(id);
    return playerColor(id, p ? p.tm : -1);
  }

  onEvent(m) {
    const g = this.g || {};
    const myTeam = this.me.team;
    switch (m.e) {
      case 'kill': {
        m.kc = this.colorOf(m.k);
        m.vc = this.colorOf(m.v);
        this.hud.feedKill(m, this.myId);
        if (m.k === this.myId && m.v !== this.myId) this.hud.center(`Killed ${m.vn}`, m.hs ? 'Headshot' : '', '', 1.6, 1);
        break;
      }
      case 'join': if (m.id !== this.myId) this.hud.feedText(`${m.n} joined`); break;
      case 'leave': this.hud.feedText(`${m.n} left`); break;
      case 'swap': if (m.id === this.myId) this.hud.center(`Moved to ${TEAM_NAMES[m.tm]}`, 'Teams were rebalanced', TEAM_NAMES[m.tm].toLowerCase(), 3, 3); break;
      case 'countdown': this.hud.center('Match starting', 'Get ready', '', 2.5, 2); break;
      case 'matchstart': sfx.beep(1200, 0.2, 0.3); break;
      case 'waiting': this.hud.center('Match paused', m.why, 'warn', 4, 3); break;
      case 'round': {
        const att = m.att === myTeam;
        this.hud.center(`Round ${m.n}`, att ? 'Attack — plant the bomb at A or B' : 'Defend — stop the plant or defuse it', att ? TEAM_NAMES[myTeam].toLowerCase() : TEAM_NAMES[myTeam].toLowerCase(), 4, 3);
        break;
      }
      case 'half': this.hud.feedText('Half time — teams switch sides'); break;
      case 'go': sfx.beep(1400, 0.15, 0.3); break;
      case 'gotbomb': this.hud.center('You have the bomb', `Hold ${keyName(settings.binds.interact)} inside site A or B to plant`, 'warn', 3, 2); break;
      case 'bombdrop': this.hud.feedText('The bomb was dropped'); break;
      case 'bombpick': this.hud.feedText(`${this.nameOf(m.id)} picked up the bomb`); break;
      case 'planted': {
        this.hud.center(`Bomb planted at ${m.site}`, g.att === myTeam ? 'Defend it for 40 seconds' : 'Defuse it before it goes off', 'warn', 3.5, 3);
        sfx.beep(2000, 0.3, 0.4);
        break;
      }
      case 'defused': this.hud.feedText(`${this.nameOf(m.id)} defused the bomb`); break;
      case 'bombboom': {
        const p = new THREE.Vector3(m.p[0], m.p[1], m.p[2]);
        this.fx.explosion(p);
        this.fx.explosion(p.clone().add(new THREE.Vector3(1, 0.5, 0)));
        sfx.explosion(p);
        this.shakeFrom(p, 40);
        break;
      }
      case 'roundend': {
        const mine = m.w === myTeam;
        const why = { defused: 'The bomb was defused', exploded: 'The bomb went off', eliminated: 'Enemy team eliminated', time: 'Time ran out' }[m.why] || '';
        this.hud.center(mine ? 'Round won' : 'Round lost', `${TEAM_NAMES[m.w]} takes the round · ${why}`, TEAM_NAMES[m.w].toLowerCase(), 4.5, 4);
        break;
      }
      case 'matchend': {
        let big, cls = '';
        if (g.mode === 'ffa') {
          big = m.w === this.myId ? 'You win' : `${this.nameOf(m.w)} wins`;
        } else if (m.w === -1) {
          big = 'Draw';
        } else {
          big = m.w === myTeam ? 'Victory' : 'Defeat';
          cls = TEAM_NAMES[m.w].toLowerCase();
        }
        this.hud.center(big, 'A new town is being built for the next match', cls, 12, 5);
        this.showScores = true;
        setTimeout(() => { this.showScores = false; }, 11000);
        break;
      }
      case 'hillmove': this.hud.center('The hill has moved', 'Follow the marker', '', 2.5, 2); break;
      default:
    }
  }

  shakeFrom(p, range) {
    const d = this.camera.position.distanceTo(p);
    if (d < range) this.fx.shake = Math.max(this.fx.shake, 1 - d / range);
  }

  onRemoteShot(m) {
    const a = this.avatars.get(m.id);
    const w = WEAPONS[m.w] || WEAPONS.smg;
    const from = a && a.alive ? a.muzzle(V()) : new THREE.Vector3(m.o[0], m.o[1] - 0.2, m.o[2]);
    this.fx.muzzleFlash(from, m.w === 'shotgun' || m.w === 'lmg' ? 0.8 : 0.55);
    sfx.gunshot(m.w, from, false);
    if (a) a.revealT = 2;
    const ends = m.e || [];
    ends.forEach((e, i) => {
      const to = new THREE.Vector3(e[0], e[1], e[2]);
      if (m.w !== 'shotgun' || i < 5) this.fx.tracer(from, to, w.tracer, m.w === 'sniper' ? 1.6 : 1);
      // a small puff where it landed, if it landed on something solid
      const d = tmpA.subVectors(to, from);
      const L = d.length();
      if (L > 0.1 && L < w.range - 0.5) {
        d.multiplyScalar(1 / L);
        const hit = this.world.physics && this.world.physics.raycast(from, d, L + 0.3);
        if (hit && Math.abs(hit.t - L) < 0.6) this.fx.impact(hit.point, hit.normal, hit.box && hit.box.mat);
      }
    });
  }

  onRemoteNade(m) {
    this.fx.throwNade(m.id, m.n, new THREE.Vector3(...m.o), new THREE.Vector3(...m.v), false);
  }

  onRemoteBoom(m) {
    this.fx.removeNade(m.id, m.n);
    const p = new THREE.Vector3(...m.p);
    this.fx.explosion(p);
    sfx.explosion(p);
    this.shakeFrom(p, 16);
  }

  onHurt(m) {
    this.me.hp = m.hp;
    this.hud.setHP(m.hp);
    let angle = null;
    if (m.from) {
      const dx = m.from[0] - this.me.pos.x, dz = m.from[2] - this.me.pos.z;
      const fx = -Math.sin(this.me.yaw), fz = -Math.cos(this.me.yaw);
      const rx = Math.cos(this.me.yaw), rz = -Math.sin(this.me.yaw);
      angle = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
    }
    this.hud.hurt(m.d, angle);
    sfx.hurt();
    this.me.punch += 0.01;
  }

  onHitOk(m) {
    this.hud.hit(m.k, m.hs);
    sfx.hitMarker(m.k, m.hs);
  }

  // -- local player ------------------------------------------------------------

  weapon() {
    return this.me.weapons ? this.me.weapons[this.me.slot] : null;
  }

  canAct() {
    return this.inRoom && this.me.alive && !this.paused && this.g && this.g.ph !== 'ended';
  }

  frozen() {
    const g = this.g;
    return !g || g.ph === 'freeze' || g.ph === 'ended' || this.me.interacting;
  }

  zoomOf(ws) {
    return ws ? ws.def.zoom : 1;
  }

  spreadDeg(ws) {
    const me = this.me, d = ws.def;
    const moveF = Math.min(1, Math.hypot(me.vel.x, me.vel.z) / WALK);
    let s = d.base + ws.bloom + moveF * d.move + (me.grounded ? 0 : d.air);
    s *= 1 + (d.adsMul - 1) * me.adsK;
    if (me.crouch && me.grounded) s *= 0.8;
    return s;
  }

  update(dt) {
    const me = this.me;
    const act = this.canAct();
    const [mx, my] = input.mouse();
    const ws = this.weapon();

    // look
    if (input.locked && !this.paused) {
      const zoom = ws ? ws.def.zoom : 1;
      const adsMul = 1 + (settings.adsSens / Math.max(1, zoom * 0.9) - 1) * me.adsK;
      // aim help: slow the turn a little while the crosshair is over an enemy
      const help = settings.aimAssist && this.aimCached ? 0.62 : 1;
      const k = 0.0022 * settings.sens * adsMul * help;
      me.yaw -= mx * k;
      me.pitch -= my * k * (settings.invertY ? -1 : 1);
      me.pitch = Math.max(-1.52, Math.min(1.52, me.pitch));
    }
    this.lookDelta = [mx, my];

    this.aimWant = act && this.readAim();
    if (act) {
      this.updateMovement(dt);
      this.updateWeapons(dt);
      this.updateInteract();
    } else {
      me.adsK = Math.max(0, me.adsK - dt * 8);
      if (me.interacting) this.stopInteract();
    }
    // switch to spectating a teammate by clicking while dead
    if (!me.alive && this.inRoom && input.pressed('fire')) this.spectateIdx++;

    if (this.inRoom && input.pressed('loadout')) this.ui.openLoadout();
    this.showScoresHeld = this.inRoom && input.down('scores');

    // network
    this.sendT -= dt;
    if (this.inRoom && me.alive && this.sendT <= 0) {
      this.sendT = 1 / SEND_HZ;
      let f = 0;
      if (me.crouch) f |= 2;
      if (Math.hypot(me.vel.x, me.vel.z) > 0.5) f |= 4;
      if (me.adsK > 0.5) f |= 8;
      if (ws && ws.reloading) f |= 16;
      if (me.sprinting) f |= 32;
      this.net.send({ t: 'st', p: [+me.pos.x.toFixed(3), +me.pos.y.toFixed(3), +me.pos.z.toFixed(3)], y: +me.yaw.toFixed(4),
        pi: +me.pitch.toFixed(4), f, sl: me.slot === 'pistol' ? 1 : 0, sc: me.sc });
    }
  }

  updateMovement(dt) {
    const me = this.me;
    const phys = this.world.physics;
    if (!phys) return;
    const frozen = this.frozen();
    // crouch
    let wantCrouch;
    if (settings.crouchToggle) {
      if (input.pressed('crouch')) me.crouchToggled = !me.crouchToggled;
      wantCrouch = me.crouchToggled;
    } else wantCrouch = input.down('crouch');
    if (wantCrouch) me.crouch = true;
    else if (me.crouch && phys.fits(me.pos, RADIUS, STAND_H)) me.crouch = false;
    me.crouchK += ((me.crouch ? 1 : 0) - me.crouchK) * Math.min(1, dt * 14);

    // wish direction
    const f = (input.down('forward') ? 1 : 0) - (input.down('back') ? 1 : 0);
    const s = (input.down('right') ? 1 : 0) - (input.down('left') ? 1 : 0);
    const sy = Math.sin(me.yaw), cy = Math.cos(me.yaw);
    let wx = -sy * f + cy * s;
    let wz = -cy * f - sy * s;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }

    // run
    let wantRun;
    if (settings.sprintToggle) {
      if (input.pressed('sprint')) me.sprintToggled = !me.sprintToggled;
      if (f <= 0) me.sprintToggled = false;
      wantRun = me.sprintToggled;
    } else wantRun = input.down('sprint');
    const firing = input.down('fire') && this.clock - me.lastFire < 0.25;
    // aiming beats running: holding aim stops a run straight away
    me.sprinting = !this.aimWant && (wantRun && f > 0 && !me.crouch && me.adsK < 0.3 && !firing && me.grounded || (me.sprinting && !me.grounded && wantRun));
    if (this.aimWant) me.sprintToggled = false;

    const ws = this.weapon();
    let speed = me.crouch ? CROUCH_SPEED : me.sprinting ? RUN : WALK;
    speed *= ws ? ws.def.moveMul : 1;
    speed *= 1 - 0.4 * me.adsK;
    if (frozen) speed = 0;

    const tx = wx * speed, tz = wz * speed;
    const accel = me.grounded ? 14 : 2.2;
    const k = Math.min(1, accel * dt);
    me.vel.x += (tx - me.vel.x) * k;
    me.vel.z += (tz - me.vel.z) * k;

    if (!frozen && me.grounded && input.pressed('jump')) {
      me.vel.y = JUMP_V;
      me.grounded = false;
      if (me.crouch && phys.fits(me.pos, RADIUS, STAND_H)) me.crouch = false;
    }

    // physics in small steps
    const body = { pos: me.pos, vel: me.vel, grounded: me.grounded, radius: RADIUS, height: me.crouch ? CROUCH_H : STAND_H, landed: 0 };
    let rem = dt;
    let landed = 0;
    while (rem > 1e-5) {
      const h = Math.min(rem, 1 / 90);
      phys.move(body, h, GRAVITY);
      landed = Math.max(landed, body.landed || 0);
      rem -= h;
    }
    me.grounded = body.grounded;
    me.landed = landed > 3 ? landed / 10 : 0;
    const [bx, bz] = this.map.bounds;
    me.pos.x = Math.max(-bx + 0.4, Math.min(bx - 0.4, me.pos.x));
    me.pos.z = Math.max(-bz + 0.4, Math.min(bz - 0.4, me.pos.z));
    if (me.pos.y < -5) me.pos.y = 0;

    // footsteps
    const hs = Math.hypot(me.vel.x, me.vel.z);
    this.stepT = (this.stepT || 0) - dt * hs;
    if (me.grounded && hs > 1.5 && this.stepT <= 0) {
      this.stepT = 2.1;
      if (!me.crouch) sfx.footstep(null, me.sprinting ? 0.9 : 0.5);
    }
    if (me.landed) sfx.footstep(null, 1.2);
  }

  updateWeapons(dt) {
    const me = this.me;
    const ws = this.weapon();
    if (!ws) return;
    const d = ws.def;
    const now = this.clock;
    const vm = this.vm;

    // switching
    let want = null;
    if (input.pressed('primary')) want = 'primary';
    if (input.pressed('secondary')) want = 'pistol';
    // the mouse wheel also switches, unless it has been bound to something else
    const bound = [...Object.values(settings.binds), ...Object.values(settings.alt)];
    const wheel = (input.pressedCode('WheelUp') && !bound.includes('WheelUp')) || (input.pressedCode('WheelDown') && !bound.includes('WheelDown'));
    if (input.pressed('swap') || wheel) want = me.slot === 'primary' ? 'pistol' : 'primary';
    if (want && want !== me.slot && me.nadeBusy <= 0) {
      ws.reloading = false;
      me.slot = want;
      vm.switchTo(me.weapons[want].id);
      me.adsK = Math.min(me.adsK, 0.3);
      return;
    }

    // aim
    const aim = this.aimWant;
    const canAim = aim && !me.sprinting && !ws.reloading && !vm.busySwitching && me.nadeBusy <= 0;
    if (!canAim && settings.aimToggle && ws.reloading) me.aimToggled = false;
    me.adsK = Math.max(0, Math.min(1, me.adsK + (canAim ? 1 : -1) * dt / d.adsTime));
    const scoped = d.sight === 'scope' && me.adsK > 0.92;
    vm.scoped = scoped;
    this.hud.scope(scoped);

    // bloom recovers once you let go
    if (now - ws.lastShot > (60 / d.rpm) * 1.4) ws.bloom = Math.max(0, ws.bloom - d.recover * dt);
    // recoil recovers part of the way when you stop shooting
    if (now - me.lastFire > 0.12 && me.recoilDebt > 0) {
      const r = Math.min(me.recoilDebt, dt * 0.35);
      me.pitch -= r * 0.55;
      me.recoilDebt -= r;
    }
    me.punch = Math.max(0, me.punch - dt * me.punch * 14 - dt * 0.002);

    // grenade
    me.nadeBusy -= dt;
    if (input.pressed('grenade') && me.nades > 0 && me.nadeBusy <= 0 && !vm.busySwitching && !this.frozen()) {
      me.nades--;
      me.nadeBusy = 0.6;
      ws.reloading = false;
      vm.cancelReload();
      vm.throwNade();
      setTimeout(() => this.releaseNade(), 280);
    }

    // pending shotgun pump / sniper bolt
    if (me.pumpPending && now >= me.pumpPending) { me.pumpPending = 0; vm.pump(); sfx.pumpSound(); }
    if (me.boltPending && now >= me.boltPending) { me.boltPending = 0; vm.bolt(); sfx.boltSound(); }

    // reloading
    if (ws.reloading) {
      if (d.perShell) {
        if (now >= me.shellNext) {
          if (ws.mag < d.mag && ws.reserve > 0) {
            ws.mag++;
            ws.reserve--;
          }
          if (ws.mag >= d.mag || ws.reserve <= 0) {
            ws.reloading = false;
            vm.endReload();
            vm.pump();
            sfx.pumpSound();
            ws.nextFire = Math.max(ws.nextFire, now + 0.4);
          } else {
            me.shellNext = now + d.reload;
            vm.shell(d.reload);
            sfx.shellSound();
          }
        }
        // fire interrupts a shotgun reload
        if (input.pressed('fire') && ws.mag > 0) {
          ws.reloading = false;
          vm.endReload();
          vm.pump();
          sfx.pumpSound();
          ws.nextFire = now + 0.35;
        }
      } else if (now >= me.reloadEnd) {
        const take = Math.min(d.mag - ws.mag, ws.reserve);
        ws.mag += take;
        ws.reserve -= take;
        ws.reloading = false;
      }
    } else if (input.pressed('reload') && ws.mag < d.mag && ws.reserve > 0 && me.nadeBusy <= 0) {
      this.startReload(ws);
    }

    // firing
    const trigger = d.auto ? input.down('fire') : input.pressed('fire');
    if (trigger && !ws.reloading && !vm.busySwitching && me.nadeBusy <= 0 && !this.frozen()) {
      if (me.sprinting) {
        me.sprinting = false;
        ws.nextFire = Math.max(ws.nextFire, now + 0.12);
      }
      if (ws.mag <= 0) {
        if (input.pressed('fire')) sfx.dryFire();
        if (ws.reserve > 0) this.startReload(ws);
      } else if (now >= ws.nextFire) {
        const interval = 60 / d.rpm;
        ws.nextFire = Math.max(now, ws.nextFire) + interval;
        if (ws.nextFire < now) ws.nextFire = now + interval;
        this.fire(ws);
        if (d.bolt && ws.mag > 0) me.boltPending = now + 0.18;
        if (d.perShell && ws.mag > 0) me.pumpPending = now + 0.14;
      }
    }
  }

  // Aim intent. A key (F by default) is always hold-to-aim; a mouse or
  // trackpad button toggles when "Aim is a toggle" is on, otherwise holds.
  readAim() {
    const me = this.me;
    let held = false;
    for (const code of [settings.binds.aim, settings.alt.aim]) {
      if (!code) continue;
      if (code.startsWith('Mouse') && settings.aimToggle) {
        if (input.pressedCode(code)) me.aimToggled = !me.aimToggled;
      } else if (input.heldCode(code)) {
        held = true;
      }
    }
    return held || me.aimToggled;
  }

  startReload(ws) {
    const me = this.me;
    const d = ws.def;
    ws.reloading = true;
    me.adsK = Math.min(me.adsK, 0.5);
    this.net.send({ t: 'reload' });
    if (d.perShell) {
      me.shellNext = this.clock + d.reload + 0.15;
      this.vm.shell(d.reload + 0.15);
      sfx.shellSound();
      return;
    }
    const empty = ws.mag === 0;
    const dur = d.reload + (empty ? 0.35 : 0);
    me.reloadEnd = this.clock + dur;
    this.vm.startReload(dur, empty);
    sfx.reloadSound(d.id, dur, empty, null);
  }

  releaseNade() {
    const me = this.me;
    if (!me.alive || !this.inRoom) return;
    const cam = this.camera;
    const fwd = tmpA.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const origin = cam.position.clone().addScaledVector(fwd, 0.45);
    origin.y -= 0.1;
    // don't start the grenade inside a wall
    const h = this.world.physics.raycast(cam.position, fwd, 0.6);
    if (h) origin.copy(cam.position).addScaledVector(fwd, Math.max(0, h.t - 0.15));
    const vel = fwd.clone().multiplyScalar(15).add(new THREE.Vector3(0, 3, 0)).addScaledVector(me.vel, 0.5);
    const nid = me.nextNade++;
    this.fx.throwNade(this.myId, nid, origin, vel, true, (p) => {
      this.net.send({ t: 'boom', n: nid, p: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)] });
      this.fx.explosion(p);
      sfx.explosion(p);
      this.shakeFrom(p, 16);
    });
    this.net.send({ t: 'nade', n: nid, o: [origin.x, origin.y, origin.z].map((v) => +v.toFixed(3)), v: [vel.x, vel.y, vel.z].map((v) => +v.toFixed(3)) });
  }

  fire(ws) {
    const me = this.me;
    const d = ws.def;
    const cam = this.camera;
    cam.updateMatrixWorld();
    ws.mag--;
    ws.lastShot = this.clock;
    me.lastFire = this.clock;
    const spread = this.spreadDeg(ws);
    const origin = cam.position.clone();
    const fwd = V().set(0, 0, -1).applyQuaternion(cam.quaternion);
    const right = V().set(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = V().set(0, 1, 0).applyQuaternion(cam.quaternion);
    const muzzle = this.vm.muzzleWorld(cam, V());
    const scoped = this.vm.scoped;
    if (scoped) muzzle.copy(origin).addScaledVector(up, -0.08).addScaledVector(fwd, 0.4);
    const hits = [], ends = [];
    const phys = this.world.physics;
    const teamMode = this.isTeamMode() && !this.warmup();
    const skip = (a) => teamMode && a.team === me.team;
    for (let i = 0; i < d.pellets; i++) {
      let cone = spread;
      if (d.pelletSpread) cone = d.pelletSpread * (1 + (0.72 - 1) * me.adsK) + ws.bloom * 0.3 + (spread - d.base * (1 + (d.adsMul - 1) * me.adsK)) * 0.5;
      const ang = THREE.MathUtils.degToRad(cone) * Math.sqrt(Math.random());
      const th = Math.random() * Math.PI * 2;
      const t = Math.tan(ang);
      const dir = fwd.clone().addScaledVector(right, Math.cos(th) * t).addScaledVector(up, Math.sin(th) * t).normalize();
      const wh = phys.raycast(origin, dir, d.range);
      const wt = wh ? wh.t : d.range;
      const ph = this.avatars.raycast(origin, dir, wt, skip);
      let end;
      if (ph) {
        end = origin.clone().addScaledVector(dir, ph.t);
        hits.push([ph.id, ph.part]);
        this.fx.blood(end, dir);
        ph.avatar.showName = 1.5;
      } else if (wh) {
        end = wh.point.clone();
        this.fx.impact(wh.point, wh.normal, wh.box && wh.box.mat);
      } else {
        end = origin.clone().addScaledVector(dir, d.range);
      }
      ends.push(end);
      if (d.pellets === 1 || i < 6) this.fx.tracer(muzzle, end, d.tracer, d.id === 'sniper' ? 1.6 : 1);
    }
    // muzzle flash lights the street around you
    this.fx.light(muzzle, d.id === 'shotgun' ? 8 : 5);
    this.vm.fire(d.kick * (me.adsK > 0.5 ? 0.6 : 1));
    sfx.gunshot(d.id, null, true);
    // recoil climbs; spread blooms
    const recoilMul = (1 - 0.25 * me.adsK) * (me.crouch ? 0.85 : 1);
    const upK = d.recoilUp * recoilMul * (0.85 + Math.random() * 0.3);
    me.pitch = Math.min(1.52, me.pitch + upK);
    me.recoilDebt += upK;
    me.yaw += d.recoilSide * recoilMul * (Math.random() * 2 - 1);
    me.punch += upK * 0.5;
    ws.bloom = Math.min(d.bloomMax, ws.bloom + d.bloomShot);
    this.net.send({
      t: 'shot', w: d.id, o: [origin.x, origin.y, origin.z].map((v) => +v.toFixed(2)),
      e: ends.map((e) => [+e.x.toFixed(2), +e.y.toFixed(2), +e.z.toFixed(2)]), h: hits,
    });
  }

  // plant or defuse while the key is held
  interactOption() {
    const g = this.g;
    const me = this.me;
    if (!g || g.mode !== 'bomb' || g.ph !== 'live' || !me.alive || !this.map) return null;
    const b = g.b;
    if (!b) return null;
    const attacking = g.att === me.team;
    if (attacking && b.s === 'carried' && b.c === this.myId) {
      for (const k of ['A', 'B']) {
        const [x, z] = this.map.sites[k];
        if (Math.hypot(me.pos.x - x, me.pos.z - z) < SITE_R && me.pos.y < 2) return { kind: 'plant', site: k };
      }
      return null;
    }
    if (!attacking && b.s === 'planted' && b.p) {
      if (Math.hypot(me.pos.x - b.p[0], me.pos.z - b.p[2]) < 2.0 && Math.abs(me.pos.y - b.p[1]) < 1.5) return { kind: 'defuse' };
    }
    return null;
  }

  updateInteract() {
    const opt = this.interactOption();
    const held = input.down('interact');
    if (opt && held) {
      if (!this.me.interacting) {
        this.me.interacting = true;
        this.net.send({ t: 'plant', on: true });
      }
    } else if (this.me.interacting) this.stopInteract();
  }

  stopInteract() {
    this.me.interacting = false;
    this.net.send({ t: 'plant', on: false });
  }

  // -- camera ------------------------------------------------------------------

  updateCamera(dt) {
    const cam = this.camera;
    const me = this.me;
    const ws = this.weapon();
    let fov = settings.fov;
    if (this.inRoom && me.alive) {
      const eye = EYE_STAND + (EYE_CROUCH - EYE_STAND) * me.crouchK;
      cam.position.set(me.pos.x, me.pos.y + eye, me.pos.z);
      const sh = this.fx.shake;
      cam.rotation.set(me.pitch + me.punch + (Math.random() - 0.5) * sh * 0.03, me.yaw + (Math.random() - 0.5) * sh * 0.03, 0, 'YXZ');
      if (ws) {
        const zoom = 1 + (ws.def.zoom - 1) * me.adsK;
        fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(settings.fov) / 2) / zoom));
      }
    } else if (this.inRoom) {
      this.spectateCamera(dt);
    } else {
      this.previewCamera(dt);
    }
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
    this.world.sky.position.copy(cam.position);
    sfx.setListener(cam.position.x, cam.position.y, cam.position.z, cam.rotation.y);
  }

  spectateCamera(dt) {
    const cam = this.camera;
    const me = this.me;
    const g = this.g;
    const bombRound = g && g.mode === 'bomb' && !this.warmup();
    // in bomb rounds, dead players watch a living teammate
    if (bombRound) {
      const mates = [...this.avatars.map.values()].filter((a) => a.alive && a.team === me.team);
      const list = mates.length ? mates : [...this.avatars.map.values()].filter((a) => a.alive);
      if (list.length) {
        const a = list[this.spectateIdx % list.length];
        const back = tmpA.set(Math.sin(a.yaw), 0, Math.cos(a.yaw)).multiplyScalar(3.2);
        const target = tmpB.set(a.pos.x, a.pos.y + 1.6, a.pos.z);
        const want = tmpC.copy(target).add(back).add(tmpD.set(0, 0.8, 0));
        // keep the camera out of walls
        const dir = tmpD.subVectors(want, target);
        const L = dir.length();
        dir.multiplyScalar(1 / L);
        const hit = this.world.physics && this.world.physics.raycast(target, dir, L);
        if (hit) want.copy(target).addScaledVector(dir, Math.max(0.3, hit.t - 0.3));
        cam.position.lerp(want, Math.min(1, dt * 8));
        cam.lookAt(target);
        const el = document.getElementById('spectate');
        el.hidden = false;
        el.textContent = `Watching ${a.name}${list.length > 1 ? ` · ${keyName(settings.binds.fire)} for next` : ''}`;
        return;
      }
    }
    document.getElementById('spectate').hidden = true;
    // otherwise hold at the spot you died, turning towards whoever got you
    const eye = tmpA.set(me.deathPos.x, me.deathPos.y + 2.2, me.deathPos.z);
    cam.position.lerp(eye, Math.min(1, dt * 3));
    const k = this.avatars.get(me.killerId);
    const look = k && k.alive ? tmpB.set(k.pos.x, k.pos.y + 1.4, k.pos.z) : tmpB.set(me.deathPos.x - Math.sin(me.yaw) * 5, me.deathPos.y, me.deathPos.z - Math.cos(me.yaw) * 5);
    const m = new THREE.Matrix4().lookAt(cam.position, look, new THREE.Vector3(0, 1, 0));
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    cam.quaternion.slerp(q, Math.min(1, dt * 3));
  }

  previewCamera(dt) {
    const cam = this.camera;
    this.previewT += dt * 0.035;
    const r = 58;
    const t = this.previewT;
    cam.position.set(Math.cos(t) * r, 24 + Math.sin(t * 0.7) * 4, Math.sin(t) * r * 0.75);
    cam.lookAt(Math.cos(t + 0.9) * 10, 2, Math.sin(t + 0.9) * 8);
  }

  // -- per-frame visuals ---------------------------------------------------------

  updateObjectives(dt) {
    const g = this.g;
    const markers = [];
    const mmObj = [];
    const cam = this.camera;
    const W = window.innerWidth, H = window.innerHeight;
    const project = (x, y, z) => {
      const v = tmpA.set(x, y, z).project(cam);
      const behind = v.z > 1;
      let sx = (v.x * 0.5 + 0.5) * W, sy = (-v.y * 0.5 + 0.5) * H;
      if (behind) { sx = W - sx; sy = H - 30; }
      sx = Math.max(24, Math.min(W - 24, sx));
      sy = Math.max(60, Math.min(H - 24, sy));
      return [sx, sy];
    };
    const dist = (x, z) => Math.hypot(x - this.me.pos.x, z - this.me.pos.z);
    this.bombMesh.visible = false;
    this.hill.visible = false;
    if (g && this.map && this.inRoom) {
      if (g.mode === 'bomb') {
        const b = g.b;
        for (const k of ['A', 'B']) {
          const [x, z] = this.map.sites[k];
          const hideIt = b && b.s === 'planted' && b.site === k;
          if (!hideIt) {
            const [sx, sy] = project(x, 2.5, z);
            markers.push({ key: 'site' + k, x: sx, y: sy, cls: 'site', label: k, dist: dist(x, z) });
          }
          mmObj.push({ x, z, r: SITE_R, color: '#ff8a75', fill: 'rgba(201,65,47,0.2)', label: k });
        }
        if (b && b.p && (b.s === 'planted' || b.s === 'dropped')) {
          this.bombMesh.visible = true;
          this.bombMesh.position.set(b.p[0], b.p[1], b.p[2]);
          const planted = b.s === 'planted';
          if (planted || g.att === this.me.team) {
            const [sx, sy] = project(b.p[0], b.p[1] + 1.2, b.p[2]);
            markers.push({ key: 'bomb', x: sx, y: sy, cls: 'bomb', label: '!', dist: dist(b.p[0], b.p[2]) });
            mmObj.push({ x: b.p[0], z: b.p[2], dot: true, color: '#ff4a33' });
          }
          if (planted) {
            // beeps speed up as the fuse runs down
            const ex = b.ex || 40;
            const gap = Math.max(0.12, Math.min(1.0, ex / 40));
            const t = this.clock;
            if (t - this.lastBeep > gap) {
              this.lastBeep = t;
              sfx.beep(2400, 0.06, 0.5, new THREE.Vector3(b.p[0], b.p[1], b.p[2]));
              this.bombMesh.userData.led.visible = true;
            } else if (t - this.lastBeep > 0.06) this.bombMesh.userData.led.visible = false;
          }
        }
        if (b && b.s === 'carried' && b.c && g.att === this.me.team && b.c !== this.myId) {
          const a = this.avatars.get(b.c);
          if (a) mmObj.push({ x: a.pos.x, z: a.pos.z, dot: true, color: '#ff4a33' });
        }
        document.getElementById('bombcarry').hidden = !(b && b.s === 'carried' && b.c === this.myId && this.me.alive);
      } else {
        document.getElementById('bombcarry').hidden = true;
      }
      if (g.mode === 'koth' && g.h) {
        const [x, z] = this.map.hills[g.h.i];
        this.hill.visible = true;
        this.hill.position.set(x, 0, z);
        const col = g.h.c ? '#ffffff' : g.h.o >= 0 ? TEAM_COLORS[g.h.o] : '#efe4cf';
        for (const m of this.hill.userData.mats) m.color.set(col);
        this.hill.userData.mats[0].opacity = 0.18 + (g.h.c ? Math.abs(Math.sin(this.clock * 6)) * 0.2 : 0);
        const [sx, sy] = project(x, 3, z);
        const inside = dist(x, z) < HILL_R;
        markers.push({ key: 'hill', x: sx, y: sy, cls: 'hill' + (g.h.o >= 0 ? ' own' + g.h.o : '') + (g.h.c ? ' contested' : ''), label: '▲', dist: inside ? 0 : dist(x, z) });
        mmObj.push({ x, z, r: HILL_R, color: col, fill: 'rgba(255,255,255,0.15)' });
      }
    }
    this.hud.markers(markers);
    return mmObj;
  }

  updateHud(dt) {
    const me = this.me;
    const g = this.g;
    const hud = this.hud;
    hud.update(dt);
    if (!this.inRoom) return;
    const ws = this.weapon();
    if (ws) hud.setAmmo(ws, me.nades, NADES_PER_LIFE, keyName(settings.binds.reload));
    hud.setHP(me.alive ? me.hp : 0);
    hud.top(g, me.team, this.myId, this.roster, this.clock);
    // crosshair: its gap is the real spread cone at this field of view
    if (ws && me.alive) {
      const spread = THREE.MathUtils.degToRad(ws.def.pelletSpread ? ws.def.pelletSpread * (1 + (0.72 - 1) * me.adsK) + ws.bloom * 0.3 : this.spreadDeg(ws));
      const px = (Math.tan(spread) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) * (window.innerHeight / 2);
      const onEnemy = this.aimTarget();
      hud.crosshair(px, me.adsK < 0.5 && !this.vm.scoped, onEnemy);
    } else hud.crosshair(0, false, false);
    // held messages
    if (g) {
      if (g.ph === 'waiting') hud.holdCenter('Waiting for players', `${g.n} of 2 needed to start · warm-up`, '');
      else if (g.ph === 'countdown') hud.holdCenter(`Match starts in ${Math.ceil(g.tl)}`, MODE_INFO[g.mode].name, '');
      else if (g.ph === 'freeze') hud.holdCenter(`${Math.ceil(g.tl)}`, g.att === me.team ? 'Attack — the round starts soon' : 'Defend — the round starts soon', '');
      else if (g.ph === 'ended') hud.holdCenter('Match over', `Next town in ${Math.ceil(g.tl)}`, '');
    }
    // interaction prompt
    const b = g && g.b;
    if (me.interacting && b) {
      const planting = b.pl === this.myId;
      const prog = planting ? b.pt : b.df === this.myId ? b.dt : 0;
      hud.prompt(planting ? 'Planting the bomb…' : 'Defusing…', prog || 0);
    } else {
      const opt = this.interactOption();
      if (opt) hud.prompt(opt.kind === 'plant' ? `Hold ${keyName(settings.binds.interact)} to plant at ${opt.site}` : `Hold ${keyName(settings.binds.interact)} to defuse`, undefined);
      else if (b && b.dt !== undefined && b.df !== this.myId && g.att !== me.team) hud.prompt(`${this.nameOf(b.df)} is defusing`, b.dt);
      else if (b && b.pt !== undefined && b.pl !== this.myId && g.att === me.team) hud.prompt(`${this.nameOf(b.pl)} is planting`, b.pt);
      else hud.prompt(null);
    }
    // minimap
    const others = [];
    const teamMode = this.isTeamMode() && !this.warmup();
    for (const a of this.avatars.map.values()) {
      if (!a.alive) continue;
      const friend = teamMode && a.team === me.team;
      if (friend) others.push({ x: a.pos.x, z: a.pos.z, color: TEAM_COLORS[a.team] });
      else if (a.revealT > 0) others.push({ x: a.pos.x, z: a.pos.z, color: '#ff4a33' });
    }
    const objs = this.updateObjectives(dt);
    const view = me.alive ? { x: me.pos.x, z: me.pos.z, yaw: me.yaw } : { x: this.camera.position.x, z: this.camera.position.z, yaw: this.camera.rotation.y };
    hud.minimap(view, others, objs);
    hud.scoreboard(this.showScoresHeld || this.showScores, this.roster, g, this.myId,
      (id) => (id === this.myId ? me.alive : !!(this.avatars.get(id) && this.avatars.get(id).alive)), this.room && this.room.name);
  }

  aimTarget() {
    this.aimT = (this.aimT || 0) + 1;
    if (this.aimT % 4) return this.aimCached || false;
    const cam = this.camera;
    const dir = tmpA.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const wh = this.world.physics && this.world.physics.raycast(cam.position, dir, 150);
    const ph = this.avatars.raycast(cam.position, dir, wh ? wh.t : 150, null);
    let enemy = false;
    if (ph) {
      ph.avatar.showName = 0.6;
      enemy = this.isEnemy(ph.avatar.team);
    }
    this.aimCached = enemy;
    return enemy;
  }

  frame() {
    requestAnimationFrame(() => this.frame());
    const nowS = performance.now() / 1000;
    const dt = Math.min(0.05, Math.max(0.0001, nowS - this.clock));
    this.clock = nowS;
    tickSkins(this.clock);
    if (this.hasMap) {
      this.update(dt);
      this.updateCamera(dt);
      this.avatars.update(dt, this.clock, this.camera, this.me.team, this.isTeamMode() && !this.warmup());
      // footsteps of other players
      for (const a of this.avatars.map.values()) {
        if (!a.alive || a.speed < 2.2 || (a.flags & 2)) continue;
        a.stepT = (a.stepT || 0) - dt * a.speed;
        if (a.stepT <= 0) {
          a.stepT = 2.2;
          sfx.footstep(a.pos, a.speed > 5.5 ? 1 : 0.6);
        }
      }
      this.fx.update(dt, this.world.physics, this.camera, NADE_FUSE);
      const me = this.me;
      if (this.inRoom && me.alive) {
        this.indoorT -= dt;
        if (this.indoorT <= 0) {
          this.indoorT = 0.25;
          this.indoor = this.world.physics.covered(this.camera.position);
        }
        this.vm.visible = true;
        this.vm.update(dt, {
          ads: me.adsK, speed: Math.hypot(me.vel.x, me.vel.z), grounded: me.grounded, sprint: me.sprinting,
          crouch: me.crouch, look: this.lookDelta || [0, 0], landed: me.landed, indoor: this.indoor,
        });
      } else this.vm.visible = false;
      this.updateHud(dt);
    }
    // count frames
    this.fpsN++;
    this.fpsT += dt;
    if (this.fpsT > 0.5) {
      if (settings.showFps) document.getElementById('fps').textContent = `${Math.round(this.fpsN / this.fpsT)} fps · ${this.net ? this.net.rtt : 0} ms`;
      this.fpsN = 0;
      this.fpsT = 0;
    }
    const r = this.renderer;
    r.clear();
    r.render(this.scene, this.camera);
    if (this.inRoom && this.me.alive && this.vm.visible && !this.vm.scoped) {
      r.clearDepth();
      r.render(this.vm.scene, this.vm.camera);
    }
    input.endFrame();
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
