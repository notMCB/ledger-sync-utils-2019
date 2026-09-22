// The match: local player, weapons, network glue, and the render loop.

import * as THREE from 'three';
import { World } from './world.js';
import { ViewModel } from './viewmodel.js';
import { Effects } from './effects.js';
import { Avatars, TEAM_COLORS, TEAM_NAMES, playerColor } from './avatars.js';
import { Hud, MODE_INFO } from './hud.js';
import { input } from './input.js';
import { settings, keyName } from './settings.js';
import { WEAPONS, LOADOUTS, PERKS, NADES_PER_LIFE, NADE_FUSE, FLASH_RANGE, makeWeaponState, nadesFor, isSuppressed } from './weapons.js';
import * as sfx from './audio.js';
import { locker } from './locker.js';
import { tickSkins, OUTFIT } from './skins.js';
import { buildRangeMap, Range } from './range.js';

const GRAVITY = 18;
const JUMP_V = 6.6;
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

const VAULT_H = 1.0;
const LADDER_H = 5.4;
const DOWN = new THREE.Vector3(0, -1, 0);
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
      slide: null, slideReady: 0, vault: null, climbing: false, perkLeft: 0, nadeKind: 'frag',
    };
    this.ladders = new Map();   // player id -> ladder
    this.beacons = new Map();   // player id -> beacon
    this.flashT = 0;
    this.flashMax = 1;
    this.chat = null;
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

  // nothing goes to the server while training offline
  send(m) {
    if (!this.offline && this.net) this.net.send(m);
  }

  // -- aim training ------------------------------------------------------------------

  startRange() {
    if (this.inRoom) this.leave();
    this.offline = true;
    this.inRoom = true;
    this.room = { id: 0, mode: 'range', name: 'Aim Training' };
    this.myId = -1;
    this.g = { ph: 'live', mode: 'range', n: 1 };
    this.roster = new Map();
    this.avatars.clear();
    this.loadMap(buildRangeMap());
    this.range = new Range(this.scene);
    this.hud.show(true);
    document.getElementById('minimap').hidden = true;
    this.onSpawn({ p: [0, 0, 3], y: 0, sc: 0, ld: settings.lastLoadout || 0, tm: -1 });
    this.hud.center('Aim Training', `Shoot the targets · ${keyName(settings.binds.interact)} resets your score`, '', 4, 2);
  }

  // perks work locally on the range
  localPerk(m) {
    const me = this.me;
    if (m.k === 'med') {
      me.hp = Math.min(100, me.hp + 50);
      this.onMessage({ t: 'heal', hp: me.hp });
    } else if (m.k === 'ammo') this.refillAmmo();
    else if (m.k === 'ladder') this.onLadder({ id: -1, p: m.p, y: m.y, h: m.h });
    else if (m.k === 'beacon') this.onBeacon({ id: -1, p: m.p });
    me.perkLeft = Math.max(0, me.perkLeft - 1);
  }

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
      case 'heal':
        this.me.hp = m.hp;
        this.hud.setHP(m.hp);
        sfx.heal();
        this.hud.center('Patched up', `${m.hp} health`, '', 1.4, 1);
        return;
      case 'perkok':
        if (m.k === 'ammo') this.refillAmmo();
        return;
      case 'perkleft':
        this.me.perkLeft = m.n;
        return;
      case 'ladder': return this.onLadder(m);
      case 'beacon': return this.onBeacon(m);
      case 'ping': return this.onPing(m);
      case 'chat':
        if (this.chat) this.chat.add(m, this.myId);
        return;
      case 'earn':
        locker.earn(m.n, m.bal);
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
    this.clearDevices();
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
    if (this.inRoom && this.net) this.send({ t: 'leave' });
    if (this.range) {
      this.range.dispose();
      this.range = null;
      document.getElementById('minimap').hidden = false;
    }
    this.offline = false;
    this.inRoom = false;
    this.room = null;
    this.me.alive = false;
    this.avatars.clear();
    this.fx.clear();
    this.clearDevices();
    if (this.chat) this.chat.close();
    this.hud.show(false);
    this.bombMesh.visible = false;
    this.hill.visible = false;
    this.vm.scoped = false;
    this.hud.scope(false);
    document.getElementById('death').hidden = true;
  }

  isTeamMode() {
    return !!this.room && ['tdm', 'koth', 'bomb'].includes(this.room.mode);
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
    const ld = this.me.loadout;
    this.vm.setSkins(locker.cosmetics(ld).g);
    this.me.nadeKind = locker.nadeFor(ld);
    this.updateTeamLook();
    if (this.inRoom && this.net) this.send({ t: 'cos', cos: locker.cosmetics(ld) });
  }

  applyLoadout(ld) {
    const me = this.me;
    me.loadout = ld;
    me.nadeKind = locker.nadeFor(ld);
    me.perkLeft = PERKS[LOADOUTS[ld].perk].uses;
    me.nades = Math.min(me.nades, nadesFor(ld));
    const primary = LOADOUTS[ld].weapon;
    me.weapons = { primary: makeWeaponState(primary), pistol: makeWeaponState('pistol') };
    me.slot = 'primary';
    this.vm.setSkins(locker.cosmetics(ld).g);
    this.vm.setPistolSuppressor(isSuppressed('pistol', ld));
    this.vm.setWeapon(primary);
    if (this.inRoom && this.net) this.send({ t: 'cos', cos: locker.cosmetics(ld) });
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
    me.nades = nadesFor(m.ld);
    me.crouch = false;
    me.crouchK = 0;
    me.adsK = 0;
    me.aimToggled = false;
    me.recoilDebt = 0;
    me.punch = 0;
    me.slide = null;
    me.vault = null;
    me.climbing = false;
    me.perkLeft = PERKS[LOADOUTS[m.ld].perk].uses;
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
    me.slide = null;
    me.vault = null;
    me.climbing = false;
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
    const quiet = isSuppressed(m.w, a ? a.loadout : -1);
    this.fx.muzzleFlash(from, quiet ? 0.18 : m.w === 'shotgun' || m.w === 'lmg' ? 0.8 : 0.55, quiet);
    sfx.gunshot(m.w, from, false, quiet);
    // loud guns show up on the minimap; suppressed ones don't
    if (a && !quiet) a.revealT = 2;
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
    this.fx.throwNade(m.id, m.n, new THREE.Vector3(...m.o), new THREE.Vector3(...m.v), false, null, m.k || 'frag');
  }

  onRemoteBoom(m) {
    this.fx.removeNade(m.id, m.n);
    this.detonate(new THREE.Vector3(...m.p), m.k || 'frag');
  }

  detonate(p, kind) {
    if (kind === 'flash') {
      this.fx.flashPop(p);
      sfx.flashPop(p);
      this.flashbang(p);
      return;
    }
    this.fx.explosion(p);
    sfx.explosion(p);
    this.shakeFrom(p, 16);
    if (this.range) this.range.blast(p, 6);
  }

  // how blinded you are by a flash depends on distance, line of sight and whether you were looking at it
  flashbang(p) {
    if (!this.inRoom || !this.me.alive) return;
    const cam = this.camera;
    const eye = cam.position;
    const d = eye.distanceTo(p);
    if (d > FLASH_RANGE) return;
    const src = p.clone().add(new THREE.Vector3(0, 0.25, 0));
    if (!this.world.physics.lineClear(src, eye)) return;
    const to = src.clone().sub(eye).normalize();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const facing = fwd.dot(to);
    const look = facing > 0.35 ? 1 : facing > -0.2 ? 0.55 : 0.25;
    const strength = Math.min(1, (1 - d / FLASH_RANGE) * 1.25) * look;
    if (strength < 0.05) return;
    const dur = 0.6 + 3.4 * strength;
    if (dur > this.flashT) {
      this.flashT = dur;
      this.flashMax = dur;
    }
    sfx.flashRing(strength);
  }

  // -- perks --

  usePerk() {
    const me = this.me;
    const perk = LOADOUTS[me.loadout].perk;
    if (me.perkLeft <= 0) {
      this.hud.center(`No ${PERKS[perk].name} left`, 'You get more when you respawn', '', 1.6, 1);
      return;
    }
    if (perk === 'med') {
      if (me.hp >= 100) return this.hud.center('Already at full health', '', '', 1.2, 1);
      this.perkSend({ t: 'perk', k: 'med' });
    } else if (perk === 'ammo') {
      const full = Object.values(me.weapons).every((w) => w.reserve >= w.def.reserve);
      if (full) return this.hud.center('Ammo is already full', '', '', 1.2, 1);
      this.perkSend({ t: 'perk', k: 'ammo' });
    } else if (perk === 'ladder') {
      const spot = this.ladderSpot();
      if (!spot) return this.hud.center('Face a wall to stand the ladder against', 'Get close to it first', '', 1.8, 1);
      this.perkSend({ t: 'perk', k: 'ladder', p: [spot.x, spot.y, spot.z].map((v) => +v.toFixed(3)), y: +spot.yaw.toFixed(4), h: +spot.h.toFixed(2) });
    } else if (perk === 'beacon') {
      const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw);
      let p = new THREE.Vector3(me.pos.x + fx * 0.6, me.pos.y + 0.05, me.pos.z + fz * 0.6);
      if (this.world.physics.raycast(new THREE.Vector3(me.pos.x, me.pos.y + 0.3, me.pos.z), new THREE.Vector3(fx, 0, fz), 0.8)) p = new THREE.Vector3(me.pos.x, me.pos.y + 0.05, me.pos.z);
      this.perkSend({ t: 'perk', k: 'beacon', p: [p.x, p.y, p.z].map((v) => +v.toFixed(3)) });
    }
  }

  perkSend(m) {
    if (this.offline) this.localPerk(m);
    else this.send(m);
  }

  refillAmmo() {
    const me = this.me;
    for (const w of Object.values(me.weapons)) w.reserve = w.def.reserve;
    this.hud.lastAmmo = '';
    sfx.reloadSound('smg', 0.8, false, null);
    this.hud.center('Ammo refilled', '', '', 1.2, 1);
  }

  // where a ladder would stand: against the wall you're facing, on the floor below you
  ladderSpot() {
    const me = this.me;
    const phys = this.world.physics;
    const dir = new THREE.Vector3(-Math.sin(me.yaw), 0, -Math.cos(me.yaw));
    // it has to lean on solid wall: check at knee height and above head height,
    // so a doorway or a window at chest height doesn't count
    const hit = phys.raycast(new THREE.Vector3(me.pos.x, me.pos.y + 0.6, me.pos.z), dir, 2.2);
    if (!hit || hit.ground || Math.abs(hit.normal.y) > 0.3) return null;
    const high = phys.raycast(new THREE.Vector3(me.pos.x, me.pos.y + 2.5, me.pos.z), dir, 2.6);
    if (!high || Math.abs(high.t - hit.t) > 0.35) return null;
    const n = new THREE.Vector3(hit.normal.x, 0, hit.normal.z).normalize();
    const base = hit.point.clone().addScaledVector(n, 0.26);
    base.y = me.pos.y;
    // how tall the wall is right there: a one-storey roof, or high enough for the upstairs
    const inside = hit.point.clone().addScaledVector(n, -0.1);
    const top = phys.raycast(new THREE.Vector3(inside.x, base.y + 12, inside.z), DOWN, 12);
    const wallTop = top ? top.point.y - base.y : 12;
    const h = Math.max(2, Math.min(LADDER_H, wallTop + 0.8));
    return { x: base.x, y: base.y, z: base.z, yaw: Math.atan2(n.x, n.z), h };
  }

  onLadder(m) {
    const old = this.ladders.get(m.id);
    if (old) this.scene.remove(old.mesh);
    this.ladders.delete(m.id);
    if (m.off) return;
    const [x, y, z] = m.p;
    const nx = Math.sin(m.y), nz = Math.cos(m.y);
    const h = m.h || LADDER_H;
    const mesh = makeLadderMesh(h);
    mesh.position.set(x, y, z);
    mesh.rotation.y = m.y;
    this.scene.add(mesh);
    this.ladders.set(m.id, { x, y, z, nx, nz, top: y + h - 0.9, mesh });
    sfx.footstep(new THREE.Vector3(x, y, z), 1.4);
  }

  onBeacon(m) {
    const old = this.beacons.get(m.id);
    if (old) this.scene.remove(old.mesh);
    this.beacons.delete(m.id);
    if (m.off) return;
    const mesh = makeBeaconMesh();
    mesh.position.set(...m.p);
    this.scene.add(mesh);
    this.beacons.set(m.id, { mesh, t: 0, pulse: 0 });
  }

  onPing(m) {
    const b = this.beacons.get(m.id);
    if (b) b.pulse = 1;
    sfx.beep(1100, 0.12, 0.25, new THREE.Vector3(...m.p));
    for (const [id, x, y, z] of m.pts) {
      const a = this.avatars.get(id);
      if (a) {
        a.revealT = 3.2;
        a.pingT = 2.6;
      }
    }
  }

  updateDevices(dt) {
    for (const B of this.beacons.values()) {
      B.t += dt;
      B.mesh.userData.lamp.visible = B.t % 0.8 < 0.4;
      if (B.pulse > 0) {
        B.pulse = Math.max(0, B.pulse - dt * 0.8);
        const s = 1 + (1 - B.pulse) * 29;
        B.mesh.userData.ring.scale.set(s, s, 1);
        B.mesh.userData.ring.material.opacity = B.pulse * 0.7;
      }
    }
    // flashbang whiteout
    const el = document.getElementById('flash');
    if (this.flashT > 0) {
      this.flashT = Math.max(0, this.flashT - dt);
      const k = this.flashT / this.flashMax;
      // hold solid white for the first part, then fade
      const a = this.flashT > this.flashMax * 0.55 ? 1 : Math.min(1, (this.flashT / (this.flashMax * 0.55)));
      el.style.opacity = (this.me.alive ? a : 0).toFixed(3);
      if (k <= 0) el.style.opacity = '0';
    } else if (el.style.opacity !== '0') el.style.opacity = '0';
  }

  clearDevices() {
    for (const L of this.ladders.values()) this.scene.remove(L.mesh);
    for (const B of this.beacons.values()) this.scene.remove(B.mesh);
    this.ladders.clear();
    this.beacons.clear();
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
    if (this.range) {
      if (input.pressed('interact')) {
        this.range.reset();
        this.hud.center('Score reset', '', '', 1.2, 1);
      }
      for (const w of Object.values(me.weapons || {})) w.reserve = w.def.reserve;
      me.nades = nadesFor(me.loadout);
    }
    if (this.inRoom && this.chat && !this.offline) {
      if (input.pressed('chat')) this.chat.open(false);
      else if (input.pressed('teamchat')) this.chat.open(this.isTeamMode());
    }
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
      this.send({ t: 'st', p: [+me.pos.x.toFixed(3), +me.pos.y.toFixed(3), +me.pos.z.toFixed(3)], y: +me.yaw.toFixed(4),
        pi: +me.pitch.toFixed(4), f, sl: me.slot === 'pistol' ? 1 : 0, sc: me.sc });
    }
  }

  updateMovement(dt) {
    const me = this.me;
    const phys = this.world.physics;
    if (!phys) return;
    const frozen = this.frozen();
    const now = this.clock;

    // a vault carries you over the ledge on its own
    if (me.vault) {
      this.stepVault(dt);
      return;
    }

    const f = (input.down('forward') ? 1 : 0) - (input.down('back') ? 1 : 0);
    const s = (input.down('right') ? 1 : 0) - (input.down('left') ? 1 : 0);
    const hs0 = Math.hypot(me.vel.x, me.vel.z);

    // slide: crouch while running
    if (!frozen && !me.slide && input.pressed('crouch') && me.sprinting && me.grounded && hs0 > 5.2 && now >= me.slideReady) {
      me.slide = { t: 0, dx: me.vel.x / hs0, dz: me.vel.z / hs0, v: Math.max(hs0 + 1.6, 8.6) };
      me.sprinting = false;
      me.crouch = true;
      if (settings.crouchToggle) me.crouchToggled = true;
      sfx.slide();
    }

    // crouch
    let wantCrouch;
    if (settings.crouchToggle) {
      if (input.pressed('crouch') && !me.slide) me.crouchToggled = !me.crouchToggled;
      wantCrouch = me.crouchToggled;
    } else wantCrouch = input.down('crouch');
    if (wantCrouch || me.slide) me.crouch = true;
    else if (me.crouch && phys.fits(me.pos, RADIUS, STAND_H)) me.crouch = false;
    me.crouchK += ((me.crouch ? 1 : 0) - me.crouchK) * Math.min(1, dt * 14);

    // wish direction
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
    me.sprinting = !me.slide && !me.climbing && !this.aimWant &&
      (wantRun && f > 0 && !me.crouch && me.adsK < 0.3 && !firing && me.grounded || (me.sprinting && !me.grounded && wantRun));
    if (this.aimWant) me.sprintToggled = false;

    const ws = this.weapon();
    let speed = me.crouch ? CROUCH_SPEED : me.sprinting ? RUN : WALK;
    speed *= ws ? ws.def.moveMul : 1;
    speed *= 1 - 0.4 * me.adsK;
    if (frozen) speed = 0;

    // ladders: walk into one and keep pushing forward to climb
    const lad = frozen ? null : this.ladderAt(me.pos);
    if (lad && (f !== 0 || me.climbing) && !me.slide) {
      if (!me.climbing) { me.climbing = true; me.vel.set(0, 0, 0); }
    } else me.climbing = false;
    let gravity = GRAVITY;
    if (me.climbing) {
      gravity = 0;
      me.vel.y = f * 2.9;
      if (me.pos.y >= lad.top && f > 0) me.vel.y = 0;
      me.vel.x = (wx * 1.2 - lad.nx * (f > 0 ? 0.6 : 0));
      me.vel.z = (wz * 1.2 - lad.nz * (f > 0 ? 0.6 : 0));
      if (input.pressed('jump')) {
        // kick off the ladder
        me.climbing = false;
        me.vel.set(lad.nx * 3.5, 3.5, lad.nz * 3.5);
        gravity = GRAVITY;
      } else if (f > 0 && this.tryVault(true, lad.y + 2.5)) {
        return;
      }
    } else if (me.slide) {
      const S = me.slide;
      S.t += dt;
      S.v = Math.max(0, S.v - 6.5 * dt);
      // a little steering towards where you look
      const lx = -sy, lz = -cy;
      S.dx += (lx - S.dx) * Math.min(1, dt * 1.2);
      S.dz += (lz - S.dz) * Math.min(1, dt * 1.2);
      const L = Math.hypot(S.dx, S.dz) || 1;
      me.vel.x = (S.dx / L) * S.v;
      me.vel.z = (S.dz / L) * S.v;
      if (!frozen && me.grounded && input.pressed('jump')) {
        // slide-jump keeps your speed
        me.vel.y = JUMP_V;
        me.grounded = false;
        me.slide = null;
        me.slideReady = now + 0.5;
      } else if (S.t > 0.95 || S.v < CROUCH_SPEED + 0.3 || (!me.grounded && S.t > 0.2) || frozen) {
        me.slide = null;
        me.slideReady = now + 0.5;
      }
    } else {
      const tx = wx * speed, tz = wz * speed;
      const accel = me.grounded ? 14 : 2.2;
      const k = Math.min(1, accel * dt);
      me.vel.x += (tx - me.vel.x) * k;
      me.vel.z += (tz - me.vel.z) * k;
      if (!frozen && me.grounded && input.pressed('jump')) {
        // at a window, crate or low wall a jump vaults it instead
        if (this.tryVault(false)) return;
        me.vel.y = JUMP_V;
        me.grounded = false;
        if (me.crouch && phys.fits(me.pos, RADIUS, STAND_H)) me.crouch = false;
      } else if (!frozen && !me.grounded && f > 0 && me.vel.y < 3.5) {
        // catching a ledge in mid-air (jumping at a window)
        if (this.tryVault(false)) return;
      }
    }

    // physics in small steps
    const body = { pos: me.pos, vel: me.vel, grounded: me.grounded, radius: RADIUS, height: me.crouch ? CROUCH_H : STAND_H, landed: 0 };
    let rem = dt;
    let landed = 0;
    while (rem > 1e-5) {
      const h = Math.min(rem, 1 / 90);
      phys.move(body, h, gravity);
      landed = Math.max(landed, body.landed || 0);
      rem -= h;
    }
    me.grounded = body.grounded || me.climbing;
    me.landed = landed > 3 ? landed / 10 : 0;
    if (me.climbing && lad && me.pos.y > lad.top) me.pos.y = lad.top;
    this.clampToTown();

    // footsteps
    const hs = Math.hypot(me.vel.x, me.vel.z);
    this.stepT = (this.stepT || 0) - dt * hs;
    if (me.grounded && hs > 1.5 && this.stepT <= 0 && !me.slide) {
      this.stepT = 2.1;
      if (!me.crouch) sfx.footstep(null, me.sprinting ? 0.9 : 0.5);
    }
    if (me.climbing && Math.abs(me.vel.y) > 0.5) {
      this.climbT = (this.climbT || 0) - dt;
      if (this.climbT <= 0) { this.climbT = 0.32; sfx.footstep(null, 0.6); }
    }
    if (me.landed) sfx.footstep(null, 1.2);
  }

  clampToTown() {
    const me = this.me;
    const [bx, bz] = this.map.bounds;
    me.pos.x = Math.max(-bx + 0.4, Math.min(bx - 0.4, me.pos.x));
    me.pos.z = Math.max(-bz + 0.4, Math.min(bz - 0.4, me.pos.z));
    if (me.pos.y < -5) me.pos.y = 0;
  }

  // -- vaulting: over windowsills, crates and low walls --

  tryVault(climbing, minLedge = -Infinity) {
    const me = this.me;
    const phys = this.world.physics;
    const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw);
    const feet = me.pos.y;
    const dir = new THREE.Vector3(fx, 0, fz);
    for (const d of [0.5, 0.7, 0.9]) {
      const px = me.pos.x + fx * d, pz = me.pos.z + fz * d;
      const hit = phys.raycast(new THREE.Vector3(px, feet + 1.7, pz), DOWN, 2.4);
      if (!hit || hit.ground) continue;
      const ledge = hit.point.y;
      const rise = ledge - feet;
      if (rise < (climbing ? -0.6 : 0.5) || rise > 1.55) continue;
      // a ladder reaches one storey — never the top of the town wall or a two-storey roof —
      // and you only step off it at the top, not into a window you're climbing past
      if (climbing && (ledge > 4.9 || ledge < minLedge)) continue;
      const top = new THREE.Vector3(px, ledge + 0.02, pz);
      // room to get over it crouched
      if (!phys.fits(top, 0.3, VAULT_H)) continue;
      // nothing between you and the ledge at that height
      if (phys.raycast(new THREE.Vector3(me.pos.x, ledge + 0.55, me.pos.z), dir, d)) continue;
      // drop down the far side if there is room, otherwise stay on top
      const beyond = new THREE.Vector3(px + fx * 0.55, ledge + 0.02, pz + fz * 0.55);
      const clear = phys.fits(beyond, 0.3, VAULT_H) && !phys.raycast(new THREE.Vector3(px, ledge + 0.5, pz), dir, 0.6);
      me.vault = { t: 0, dur: 0.3 + Math.max(0, rise) * 0.14, from: me.pos.clone(), top, to: clear ? beyond : top.clone(), dx: fx, dz: fz };
      me.crouch = true;
      me.climbing = false;
      me.slide = null;
      me.vel.set(0, 0, 0);
      sfx.vault();
      return true;
    }
    return false;
  }

  stepVault(dt) {
    const me = this.me;
    const v = me.vault;
    v.t += dt;
    const k = Math.min(1, v.t / v.dur);
    me.crouchK += (1 - me.crouchK) * Math.min(1, dt * 14);
    if (k < 0.6) {
      const a = k / 0.6;
      me.pos.x = v.from.x + (v.top.x - v.from.x) * a;
      me.pos.z = v.from.z + (v.top.z - v.from.z) * a;
      me.pos.y = v.from.y + (v.top.y - v.from.y) * Math.sin((a * Math.PI) / 2);
    } else {
      const b = (k - 0.6) / 0.4;
      me.pos.lerpVectors(v.top, v.to, b);
    }
    if (k >= 1) {
      me.vault = null;
      me.vel.set(v.dx * 2.2, 0, v.dz * 2.2);
      me.grounded = false;
    }
  }

  // -- ladders --

  ladderAt(pos) {
    for (const L of this.ladders.values()) {
      const rx = pos.x - L.x, rz = pos.z - L.z;
      const out = rx * L.nx + rz * L.nz;          // distance out from the wall side of the ladder
      const side = rx * L.nz - rz * L.nx;         // along the wall
      if (Math.abs(side) < 0.55 && out > -0.35 && out < 0.8 && pos.y > L.y - 0.3 && pos.y < L.top + 0.2) return L;
    }
    return null;
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

    // perk
    if (input.pressed('perk') && !this.frozen()) this.usePerk();

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
    this.send({ t: 'reload' });
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
    const kind = me.loadout === 2 ? me.nadeKind : 'frag';
    this.fx.throwNade(this.myId, nid, origin, vel, true, (p) => {
      this.send({ t: 'boom', n: nid, p: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)] });
      this.detonate(p, kind);
    }, kind);
    this.send({ t: 'nade', n: nid, k: kind, o: [origin.x, origin.y, origin.z].map((v) => +v.toFixed(3)), v: [vel.x, vel.y, vel.z].map((v) => +v.toFixed(3)) });
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
    let rangeHit = false;
    if (this.range) this.range.stats.shots++;
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
      const rh = this.range && this.range.raycast(origin, dir, wt);
      let end;
      if (rh) {
        end = origin.clone().addScaledVector(dir, rh.t);
        if (!rangeHit) this.range.hit(rh, rh.t);
        rangeHit = true;
        this.hud.hit(false, rh.part === 'h');
        this.fx.impact(end, dir.clone().negate(), 'car');
      } else if (ph) {
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
    if (!isSuppressed(d.id, me.loadout)) this.fx.light(muzzle, d.id === 'shotgun' ? 8 : 5);
    const quiet = isSuppressed(d.id, me.loadout);
    this.vm.fire(d.kick * (me.adsK > 0.5 ? 0.6 : 1), quiet);
    sfx.gunshot(d.id, null, true, quiet);
    // recoil climbs; spread blooms
    const recoilMul = (1 - 0.25 * me.adsK) * (me.crouch ? 0.85 : 1);
    const upK = d.recoilUp * recoilMul * (0.85 + Math.random() * 0.3);
    me.pitch = Math.min(1.52, me.pitch + upK);
    me.recoilDebt += upK;
    me.yaw += d.recoilSide * recoilMul * (Math.random() * 2 - 1);
    me.punch += upK * 0.5;
    ws.bloom = Math.min(d.bloomMax, ws.bloom + d.bloomShot);
    if (this.range && !rangeHit) this.range.miss();
    this.send({
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
        this.send({ t: 'plant', on: true });
      }
    } else if (this.me.interacting) this.stopInteract();
  }

  stopInteract() {
    this.me.interacting = false;
    this.send({ t: 'plant', on: false });
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
      this.slideRoll = (this.slideRoll || 0) + ((me.slide ? 0.06 : 0) - (this.slideRoll || 0)) * Math.min(1, dt * 10);
      cam.rotation.set(me.pitch + me.punch + (Math.random() - 0.5) * sh * 0.03, me.yaw + (Math.random() - 0.5) * sh * 0.03, this.slideRoll, 'YXZ');
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
    // enemies a recon beacon has found
    for (const a of this.avatars.map.values()) {
      if (!a.alive || !(a.pingT > 0)) continue;
      const [sx, sy] = project(a.pos.x, a.pos.y + 2.3, a.pos.z);
      markers.push({ key: 'ping' + a.id, x: sx, y: sy, cls: 'ping', label: '◆', dist: dist(a.pos.x, a.pos.z) });
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
    if (ws) hud.setAmmo(ws, me.nades, nadesFor(me.loadout), keyName(settings.binds.reload));
    const perk = PERKS[LOADOUTS[me.loadout].perk];
    hud.setPerk(perk.name, me.perkLeft, keyName(settings.binds.perk), me.loadout === 2 && me.nadeKind === 'flash' ? 'Flash' : 'Frag');
    hud.setHP(me.alive ? me.hp : 0);
    if (this.range) hud.rangeTop(this.range.stats);
    else hud.top(g, me.team, this.myId, this.roster, this.clock);
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
    hud.area(view.x, view.z);
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
      this.updateDevices(dt);
      if (this.range) this.range.update(dt);
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

function makeLadderMesh(H = LADDER_H) {
  const g = new THREE.Group();
  const wood = new THREE.MeshLambertMaterial({ color: '#8a6a44' });
  const metal = new THREE.MeshLambertMaterial({ color: '#5c5f62' });
  for (const x of [-0.26, 0.26]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, H, 0.07), metal);
    rail.position.set(x, H / 2, 0);
    g.add(rail);
  }
  for (let y = 0.3; y < H - 0.1; y += 0.32) {
    const rung = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.045, 0.06), wood);
    rung.position.set(0, y, 0);
    g.add(rung);
  }
  return g;
}

function makeBeaconMesh() {
  const g = new THREE.Group();
  const dark = new THREE.MeshLambertMaterial({ color: '#2b2f33' });
  for (let i = 0; i < 3; i++) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.42, 5), dark);
    const a = (i / 3) * Math.PI * 2;
    leg.position.set(Math.cos(a) * 0.1, 0.19, Math.sin(a) * 0.1);
    leg.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
    g.add(leg);
  }
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.14, 10), dark);
  head.position.y = 0.44;
  g.add(head);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), new THREE.MeshBasicMaterial({ color: '#ff3b2f' }));
  lamp.position.y = 0.54;
  g.add(lamp);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 48), new THREE.MeshBasicMaterial({ color: '#ff5a44', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  g.add(ring);
  g.userData.lamp = lamp;
  g.userData.ring = ring;
  return g;
}
