// The match: local player, weapons, network glue, and the render loop.

import * as THREE from 'three';
import { World } from './world.js';
import { ViewModel } from './viewmodel.js';
import { Effects } from './effects.js';
import { Avatars, TEAM_COLORS, TEAM_NAMES, playerColor } from './avatars.js';
import { Hud, MODE_INFO } from './hud.js';
import { input } from './input.js';
import { settings, keyName } from './settings.js';
import { WEAPONS, LOADOUTS, PERKS, NADE_INFO, NADES_PER_LIFE, NADE_FUSE, FLASH_RANGE, makeWeaponState, nadesFor } from './weapons.js';
import { serverFlags } from './attachments.js';
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
// prone: flat on your front, head where your position is and the body trailing behind
const PRONE_H = 0.65;
const EYE_PRONE = 0.45;
const PRONE_SPEED = 1.5;
const PRONE_LEN = 1.45;
const PRONE_R = 0.27;
const wrapAngle = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const SEND_HZ = 20;
// the Medic's cover wall (half sizes) and the Marksman's bomb drone
const WALL_W = 0.8, WALL_H = 1.25, WALL_T = 0.08;
const DRONE_SPEED = 14;      // keep in step with DRONE_SPEED in server/server.py
const DRONE_R = 0.5;         // how big a target it is
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
    this.mapOpen = false;
    this.previewT = 0;
    this.hasMap = false;

    this.me = {
      team: -1, alive: false, pos: V(), vel: V(), yaw: 0, pitch: 0, crouch: false, crouchK: 0, grounded: true, landed: 0,
      sc: 0, hp: 100, loadout: 0, weapons: null, slot: 'primary', nades: NADES_PER_LIFE, adsK: 0, aimToggled: false,
      sprinting: false, sprintToggled: false, crouchToggled: false, prone: false, proneK: 0, bodyYaw: 0, onBack: false,
      recoilDebt: 0, punch: 0, lastFire: -9, nadeBusy: 0,
      nextNade: 1, interacting: false, deathPos: V(), killerId: 0, spawnT: 0, reloadEnd: 0, shellNext: 0,
      boltPending: 0, pumpPending: 0,
      slide: null, slideReady: 0, vault: null, climbing: false, perkLeft: 0, nadeKind: 'frag',
    };
    this.ladders = new Map();   // player id -> ladder
    this.beacons = new Map();   // player id -> beacon
    this.crates = new Map();    // crate id -> ammo / medic crate
    this.walls = new Map();     // wall id -> cover wall (mesh + collision box)
    this.drones = new Map();    // player id -> their drone in the air
    this.drone = null;          // my own drone while I'm flying it
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
    if (m.k === 'med' || m.k === 'ammo') {
      this.onCrate({ id: 'local' + me.perkLeft, k: m.k, p: m.p, tm: -1, owner: -1 });
      if (m.k === 'med') this.onMessage({ t: 'heal', hp: (me.hp = 100) });
      else this.refillAmmo();
    } else if (m.k === 'ladder') this.onLadder({ id: -1, p: m.p, y: m.y, h: m.h });
    else if (m.k === 'beacon') this.onBeacon({ id: -1, p: m.p });
    else if (m.k === 'wall') this.onWall({ id: 'local' + me.perkLeft, p: m.p, y: m.y, hp: 300, tm: -1, owner: -1 });
    else if (m.k === 'drone') this.onDrone({ id: this.myId, p: [m.p[0], m.p[1] + 1.8, m.p[2]], hp: 40, tm: -1, life: 40 });
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
        this.hud.center('Healed', m.by ? `From ${m.by}’s medic crate` : `${m.hp} health`, '', 1.6, 1);
        return;
      case 'perkok':
        if (m.k === 'ammo') this.refillAmmo(m.by);
        return;
      case 'supply': return this.onCrate(m);
      case 'wall': return this.onWall(m);
      case 'drone': return this.onDrone(m);
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
    this.addHatchLadders(map);
    this.hasMap = true;
  }

  // a fixed ladder in every hatch, so you can climb back out of the tunnels
  addHatchLadders(map) {
    const t = map.tunnels;
    if (!t || !t.hatches) return;
    const r = t.r || 0.8;
    t.hatches.forEach(([x, z], i) => {
      // bolted to the -x wall of the shaft, facing across it
      this.ladders.set(`hatch${i}`, { x: x - r + 0.08, y: t.floor, z, nx: 1, nz: 0, top: -0.2, mesh: null, fixed: true });
    });
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
    if (this.inRoom && this.net) {
      this.send({ t: 'cos', cos: locker.cosmetics(ld) });
      this.send({ t: 'picks', ...locker.picks(ld) });
    }
  }

  applyLoadout(ld) {
    const me = this.me;
    me.loadout = ld;
    me.nadeKind = locker.nadeFor(ld);
    me.perkLeft = PERKS[locker.perkFor(ld)].uses;
    me.nades = Math.min(me.nades, nadesFor(ld, me.nadeKind));
    const primary = LOADOUTS[ld].weapon;
    const fitted = locker.attachFor(primary);
    const pistolFit = locker.attachFor('pistol');
    me.weapons = {
      primary: makeWeaponState(primary, fitted),
      pistol: makeWeaponState('pistol', pistolFit),
      knife: makeWeaponState('knife'),
    };
    this.vm.setAttachments(primary, fitted);
    this.vm.setAttachments('pistol', pistolFit);
    me.slot = 'primary';
    this.vm.setSkins(locker.cosmetics(ld).g);
    this.vm.setWeapon(primary);
    if (this.inRoom && this.net) {
      this.send({ t: 'cos', cos: locker.cosmetics(ld) });
      // the server needs to know about anything that changes damage
      this.send({ t: 'atch', a: serverFlags(primary, fitted) });
    }
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
    me.nades = nadesFor(m.ld, locker.nadeFor(m.ld));
    me.crouch = false;
    me.crouchK = 0;
    me.prone = false;
    me.proneK = 0;
    me.onBack = false;
    me.adsK = 0;
    me.aimToggled = false;
    me.recoilDebt = 0;
    me.punch = 0;
    me.slide = null;
    me.vault = null;
    me.climbing = false;
    me.perkLeft = PERKS[locker.perkFor(m.ld)].uses;
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
    this.endDrone('');
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
    if (m.dr) this.syncDrones(m.dr);
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
        if (m.k === this.myId && m.v !== this.myId && WEAPONS[m.w]) locker.addKill(m.w);
        m.kc = this.colorOf(m.k);
        m.vc = this.colorOf(m.v);
        this.hud.feedKill(m, this.myId);
        if (m.k === this.myId && m.v !== this.myId) this.hud.center(`Killed ${m.vn}`, m.hs ? 'Headshot' : '', '', 1.6, 1);
        break;
      }
      case 'assist': this.hud.center('Assist', `Helped kill ${m.v}`, '', 1.4, 1); break;
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
    const quiet = !!m.q;
    // a flash hider or brake makes their flash smaller too
    const flashMul = typeof m.f === 'number' ? m.f : 1;
    this.fx.muzzleFlash(from, (quiet ? 0.18 : m.w === 'shotgun' || m.w === 'lmg' ? 0.8 : 0.55) * (quiet ? 1 : flashMul), quiet || flashMul < 0.6);
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
    if (kind === 'smoke') {
      this.fx.smoke(p);
      sfx.smokePop(p);
      return;
    }
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
    const perk = locker.perkFor(me.loadout);
    if (me.perkLeft <= 0) {
      this.hud.center(`No ${PERKS[perk].name} left`, 'You get more when you respawn', '', 1.6, 1);
      return;
    }
    if (perk === 'med' || perk === 'ammo') {
      // set the crate down just in front of you
      const p = this.dropSpot(0.9);
      this.perkSend({ t: 'perk', k: perk, p: [p.x, p.y, p.z].map((v) => +v.toFixed(3)) });
    } else if (perk === 'ladder') {
      const spot = this.ladderSpot();
      if (!spot) return this.hud.center('Face a wall to stand the ladder against', 'Get close to it first', '', 1.8, 1);
      this.perkSend({ t: 'perk', k: 'ladder', p: [spot.x, spot.y, spot.z].map((v) => +v.toFixed(3)), y: +spot.yaw.toFixed(4), h: +spot.h.toFixed(2) });
    } else if (perk === 'beacon') {
      const p = this.dropSpot(0.6);
      this.perkSend({ t: 'perk', k: 'beacon', p: [p.x, p.y, p.z].map((v) => +v.toFixed(3)) });
    } else if (perk === 'wall') {
      const spot = this.wallSpot();
      if (!spot) return this.hud.center('No room for the wall here', 'Face open ground, standing still', '', 1.8, 1);
      this.perkSend({ t: 'perk', k: 'wall', p: [spot.x, spot.y, spot.z].map((v) => +v.toFixed(3)), y: +me.yaw.toFixed(4) });
    } else if (perk === 'drone') {
      if (this.drone || this.drones.has(this.myId)) return;
      if (!me.grounded) return this.hud.center('Land first', '', '', 1.2, 1);
      this.perkSend({ t: 'perk', k: 'drone', p: [me.pos.x, me.pos.y, me.pos.z].map((v) => +v.toFixed(3)) });
    }
  }

  // where a cover wall would stand: a little in front of you, on your floor,
  // with nothing in the way across its whole width
  wallSpot() {
    const me = this.me;
    if (!me.grounded) return null;
    const phys = this.world.physics;
    const fwd = new THREE.Vector3(-Math.sin(me.yaw), 0, -Math.cos(me.yaw));
    const right = new THREE.Vector3(Math.cos(me.yaw), 0, -Math.sin(me.yaw));
    const base = new THREE.Vector3(me.pos.x, me.pos.y, me.pos.z);
    for (const h of [0.3, 0.9]) {
      const from = base.clone().add(new THREE.Vector3(0, h, 0));
      const hit = phys.raycast(from, fwd, 1.3 + WALL_T + 0.1);
      if (hit && !hit.ground) return null;
    }
    const centre = base.clone().addScaledVector(fwd, 1.3);
    for (const side of [1, -1]) {
      const from = centre.clone().add(new THREE.Vector3(0, 0.6, 0));
      const hit = phys.raycast(from, right.clone().multiplyScalar(side), WALL_W + 0.1);
      if (hit && !hit.ground) return null;
    }
    // the same floor as you: don't hang it off a ledge
    const floorHere = phys.floorAt(centre.x, centre.z, me.pos.y + 0.5);
    if (Math.abs(floorHere - me.pos.y) > 0.6) return null;
    centre.y = me.pos.y;
    return centre;
  }

  // -- cover walls --

  onWall(m) {
    const phys = this.world.physics;
    let W = this.walls.get(m.id);
    if (m.off) {
      if (!W) return;
      const p = W.mesh.position.clone();
      this.scene.remove(W.mesh);
      phys.remove(W.box);
      this.walls.delete(m.id);
      for (let i = 0; i < 4; i++) this.fx.impact(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.4, 0.3 + Math.random() * 0.9, 0)), new THREE.Vector3(0, 1, 0), 'car');
      sfx.knifeHit(p);
      return;
    }
    if (!W) {
      if (!m.p) return;
      const mesh = makeWallMesh();
      mesh.position.set(m.p[0], m.p[1], m.p[2]);
      mesh.rotation.y = m.y || 0;
      this.scene.add(mesh);
      const box = phys.add([m.p[0], m.p[1] + WALL_H / 2, m.p[2], WALL_W, WALL_H / 2, WALL_T, m.y || 0, 'car']);
      box.prop = m.id;
      W = { mesh, box, hp: m.hp || 300, max: m.hp || 300, tm: m.tm, owner: m.owner, x: m.p[0], z: m.p[2], hitT: 0 };
      this.walls.set(m.id, W);
      sfx.footstep(new THREE.Vector3(m.p[0], m.p[1], m.p[2]), 1.8);
    }
    if (typeof m.hp === 'number') {
      if (m.hp < W.hp) W.hitT = 0.12;
      W.hp = m.hp;
      const k = Math.max(0, W.hp / W.max);
      // it scorches and dents as it takes damage
      W.mesh.userData.plate.color.copy(W.mesh.userData.base).lerp(new THREE.Color('#3a2a22'), 1 - k);
      W.mesh.userData.plate.emissive.setScalar(0);
    }
  }

  // -- the Marksman's bomb drone --

  onDrone(m) {
    if (m.boom || m.off) {
      const D = this.drones.get(m.id);
      const p = new THREE.Vector3(...(m.p || (D ? D.pos.toArray() : [0, 0, 0])));
      if (D) {
        this.scene.remove(D.mesh);
        this.drones.delete(m.id);
      }
      if (m.boom) this.detonate(p, 'frag');
      else {
        for (let i = 0; i < 3; i++) this.fx.impact(p, new THREE.Vector3(0, 1, 0), 'car');
        sfx.beep(520, 0.3, 0.3, p);
      }
      if (m.id === this.myId) {
        this.endDrone(m.boom ? '' : m.why === 'shot' ? `Drone shot down${m.byn ? ' by ' + m.byn : ''}` : m.why === 'battery' ? 'Drone battery dead' : m.why === 'left' ? 'Drone abandoned' : '');
      } else if (m.off && m.by === this.myId) this.hud.center('Drone shot down', '', '', 1.4, 1);
      return;
    }
    if (!m.p) return;
    let D = this.drones.get(m.id);
    if (!D) {
      const mesh = makeDroneMesh();
      D = { mesh, pos: new THREE.Vector3(...m.p), target: new THREE.Vector3(...m.p), yaw: 0, hp: m.hp || 40, tm: m.tm, owner: m.id, t: 0 };
      mesh.position.copy(D.pos);
      this.scene.add(mesh);
      this.drones.set(m.id, D);
      sfx.beep(1500, 0.12, 0.2, D.pos);
    }
    if (m.id === this.myId) this.startDrone(D, m.life || 30);
  }

  syncDrones(list) {
    for (const [oid, x, y, z, yaw, hp] of list) {
      let D = this.drones.get(oid);
      if (!D) {
        this.onDrone({ id: oid, p: [x, y, z], hp, tm: -1, life: 30 });
        D = this.drones.get(oid);
        if (!D) continue;
      }
      D.target.set(x, y, z);
      D.yaw = yaw;
      D.hp = hp;
    }
  }

  startDrone(D, life) {
    const me = this.me;
    this.drone = { pos: D.pos.clone(), yaw: me.yaw, pitch: -0.15, vel: new THREE.Vector3(), life, max: life, sendT: 0 };
    D.mesh.visible = false;
    me.adsK = 0;
    me.aimToggled = false;
    this.hud.center('Drone launched', 'Your body is away while you fly', '', 2.5, 2);
    this.hud.droneOverlay(true, 1, this.droneControls());
  }

  endDrone(why) {
    if (!this.drone) return;
    const D = this.drones.get(this.myId);
    if (D) D.mesh.visible = true;
    this.drone = null;
    this.hud.droneOverlay(false);
    if (why) this.hud.center(why, '', '', 1.8, 1);
  }

  updateDrone(dt) {
    const dr = this.drone;
    const me = this.me;
    const phys = this.world.physics;
    me.adsK = Math.max(0, me.adsK - dt * 8);
    // fly: move keys along the way you look, jump up, crouch down
    const f = (input.down('forward') ? 1 : 0) - (input.down('back') ? 1 : 0);
    const r = (input.down('right') ? 1 : 0) - (input.down('left') ? 1 : 0);
    const u = (input.down('jump') ? 1 : 0) - (input.down('crouch') ? 1 : 0);
    const want = new THREE.Vector3(-Math.sin(dr.yaw) * f + Math.cos(dr.yaw) * r, u, -Math.cos(dr.yaw) * f - Math.sin(dr.yaw) * r);
    if (want.lengthSq() > 0) want.normalize().multiplyScalar(DRONE_SPEED);
    dr.vel.lerp(want, Math.min(1, dt * 6));
    const step = dr.vel.clone().multiplyScalar(dt);
    const len = step.length();
    if (len > 1e-5) {
      const dir = step.clone().divideScalar(len);
      const hit = phys.raycast(dr.pos, dir, len + 0.45);
      if (hit && !hit.ground) {
        dr.vel.multiplyScalar(-0.2);   // bump off a wall
      } else dr.pos.add(step);
    }
    // stay in the town, above the ground and under the sky
    const [bx, bz] = this.map.bounds;
    dr.pos.x = Math.max(-bx, Math.min(bx, dr.pos.x));
    dr.pos.z = Math.max(-bz, Math.min(bz, dr.pos.z));
    const floor = phys.floorAt(dr.pos.x, dr.pos.z, dr.pos.y);
    dr.pos.y = Math.max(floor + 0.45, Math.min(42, dr.pos.y));
    dr.life = Math.max(0, dr.life - dt);
    // keep my own drone's marker where I actually am
    const D = this.drones.get(this.myId);
    if (D) { D.pos.copy(dr.pos); D.target.copy(dr.pos); D.yaw = dr.yaw; }
    dr.sendT -= dt;
    if (dr.sendT <= 0) {
      dr.sendT = 1 / SEND_HZ;
      if (!this.offline) this.send({ t: 'dr', p: [+dr.pos.x.toFixed(3), +dr.pos.y.toFixed(3), +dr.pos.z.toFixed(3)], y: +dr.yaw.toFixed(4) });
    }
    this.hud.droneOverlay(true, dr.life / dr.max, this.droneControls());
    if (input.pressed('fire')) {
      if (this.offline) this.onDrone({ id: this.myId, boom: 1, p: dr.pos.toArray() });
      else this.send({ t: 'drboom' });
    } else if (input.pressed('perk')) {
      if (this.offline) this.onDrone({ id: this.myId, off: 1, why: 'left', p: dr.pos.toArray() });
      else this.send({ t: 'drstop' });
    } else if (dr.life <= 0 && this.offline) {
      this.onDrone({ id: this.myId, off: 1, why: 'battery', p: dr.pos.toArray() });
    }
  }

  droneControls() {
    const b = settings.binds;
    const k = (id) => keyName(b[id]);
    return [
      `${k('forward')} ${k('left')} ${k('back')} ${k('right')}  fly`,
      `${k('jump')}  climb`,
      `${k('crouch')}  dive`,
      'Mouse  look',
      'Click  detonate',
      `${k('perk')}  abandon the drone`,
    ];
  }

  // a bullet against a drone: the closest one it passes through
  droneRaycast(o, d, maxT) {
    const teamMode = this.isTeamMode() && !this.warmup();
    let best = null;
    for (const D of this.drones.values()) {
      if (D.owner === this.myId || (teamMode && D.tm === this.me.team)) continue;
      const ox = o.x - D.pos.x, oy = o.y - D.pos.y, oz = o.z - D.pos.z;
      const b = ox * d.x + oy * d.y + oz * d.z;
      const cc = ox * ox + oy * oy + oz * oz - DRONE_R * DRONE_R;
      const disc = b * b - cc;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t >= 0 && t < maxT && (!best || t < best.t)) best = { id: D.owner, t };
    }
    return best;
  }

  // a spot on the floor just in front of you (or at your feet if a wall is in the way)
  dropSpot(d) {
    const me = this.me;
    const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw);
    if (this.world.physics.raycast(new THREE.Vector3(me.pos.x, me.pos.y + 0.3, me.pos.z), new THREE.Vector3(fx, 0, fz), d + 0.4)) {
      return new THREE.Vector3(me.pos.x, me.pos.y + 0.02, me.pos.z);
    }
    return new THREE.Vector3(me.pos.x + fx * d, me.pos.y + 0.02, me.pos.z + fz * d);
  }

  onCrate(m) {
    const old = this.crates.get(m.id);
    if (old) this.scene.remove(old.mesh);
    this.crates.delete(m.id);
    if (m.off) return;
    const mesh = makeSupplyCrate(m.k);
    mesh.position.set(...m.p);
    mesh.rotation.y = Math.random() * Math.PI;
    this.scene.add(mesh);
    this.crates.set(m.id, { mesh, k: m.k, tm: m.tm, owner: m.owner, p: m.p });
    sfx.footstep(new THREE.Vector3(...m.p), 1.3);
  }

  perkSend(m) {
    if (this.offline) this.localPerk(m);
    else this.send(m);
  }

  refillAmmo(by) {
    const me = this.me;
    if (!me.weapons) return;
    for (const w of Object.values(me.weapons)) w.reserve = w.def.reserve;
    this.hud.lastAmmo = '';
    sfx.reloadSound('smg', 0.8, false, null);
    this.hud.center('Restocked', by ? `From ${by}’s ammo crate` : 'Spare ammo full', '', 1.6, 1);
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
    this.beacons.set(m.id, { mesh, t: m.age || 0, pulse: 0, tm: m.tm, owner: m.id, x: m.p[0], z: m.p[2] });
  }

  onPing(m) {
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
    // beacons pulse every 2.5 s — anyone nearby can see the ring sweep out
    for (const B of this.beacons.values()) {
      B.t += dt;
      B.mesh.userData.lamp.visible = B.t % 0.8 < 0.4;
      const k = (B.t % 2.5) / 2.5;
      const s = 1 + k * 34;
      B.mesh.userData.ring.scale.set(s, s, 1);
      B.mesh.userData.ring.material.opacity = (1 - k) * 0.65;
      B.sweep = k;
    }
    for (const C of this.crates.values()) C.mesh.userData.icon.rotation.y += dt * 1.2;
    for (const W of this.walls.values()) {
      if (W.hitT > 0) {
        W.hitT -= dt;
        W.mesh.userData.plate.emissive.setScalar(W.hitT > 0 ? 0.25 : 0);
      }
    }
    for (const D of this.drones.values()) {
      D.t += dt;
      if (!(this.drone && D.owner === this.myId)) D.pos.lerp(D.target, Math.min(1, dt * 10));
      D.mesh.position.copy(D.pos);
      D.mesh.rotation.y = D.yaw;
      // a little tilt into its motion, spinning rotors, a blinking light
      D.mesh.rotation.z = Math.sin(D.t * 3) * 0.03;
      for (const r of D.mesh.userData.rotors) r.rotation.y += dt * 45;
      D.mesh.userData.led.visible = D.t % 0.6 < 0.3;
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
    for (const L of this.ladders.values()) if (L.mesh) this.scene.remove(L.mesh);
    for (const B of this.beacons.values()) this.scene.remove(B.mesh);
    for (const C of this.crates.values()) this.scene.remove(C.mesh);
    for (const W of this.walls.values()) { this.scene.remove(W.mesh); this.world.physics.remove(W.box); }
    for (const D of this.drones.values()) this.scene.remove(D.mesh);
    this.ladders.clear();
    this.beacons.clear();
    this.crates.clear();
    this.walls.clear();
    this.drones.clear();
    this.endDrone('');
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
    if (m.sh) {
      this.hud.hit(false, false, true);
      return;
    }
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
    if (me.prone && me.grounded) s *= 0.55;      // flat on the ground: steadiest of all
    else if (me.crouch && me.grounded) s *= 0.8;
    return s;
  }

  update(dt) {
    const me = this.me;
    const act = this.canAct();
    const [mx, my] = input.mouse();
    const ws = this.weapon();

    // look
    if (input.locked && !this.paused) {
      const zoom = ws && !this.drone ? ws.def.zoom : 1;
      const adsMul = 1 + (settings.adsSens / Math.max(1, zoom * 0.9) - 1) * me.adsK;
      // aim help: slow the turn a little while the crosshair is over an enemy
      const help = settings.aimAssist && this.aimCached && !this.drone ? 0.62 : 1;
      const k = 0.0022 * settings.sens * adsMul * help;
      const who = this.drone || me;   // flying the drone turns the drone, not you
      who.yaw -= mx * k;
      who.pitch -= my * k * (settings.invertY ? -1 : 1);
      who.pitch = Math.max(-1.52, Math.min(1.52, who.pitch));
    }
    this.lookDelta = [mx, my];

    this.aimWant = act && !this.drone && this.readAim();
    if (act && this.drone) {
      this.updateDrone(dt);
    } else if (act) {
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
      me.nades = nadesFor(me.loadout, me.nadeKind);
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
      if (me.prone) f |= 512;
      if (me.onBack) f |= 1024;
      if (Math.hypot(me.vel.x, me.vel.z) > 0.5) f |= 4;
      if (me.adsK > 0.5) f |= 8;
      if (ws && ws.reloading) f |= 16;
      if (me.sprinting) f |= 32;
      // a scoped optic catches the sun: other players get a chance to spot it
      if (this.vm.scoped || (ws && ws.def.sight === 'scope' && me.adsK > 0.6)) f |= 64;
      this.send({ t: 'st', p: [+me.pos.x.toFixed(3), +me.pos.y.toFixed(3), +me.pos.z.toFixed(3)], y: +me.yaw.toFixed(4),
        pi: +me.pitch.toFixed(4), f, sl: me.slot === 'knife' ? 2 : me.slot === 'pistol' ? 1 : 0, sc: me.sc,
        by: +(me.prone ? me.bodyYaw : me.yaw).toFixed(4) });
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

    // prone: lie flat, or get up; the crouch key from prone brings you up to a crouch
    if (!frozen && input.pressed('prone') && !me.slide && !me.climbing && me.grounded) {
      if (me.prone) this.getUp();
      else this.lieDown();
    } else if (me.prone && input.pressed('crouch')) {
      this.getUp();
    }
    if (me.prone && (!me.grounded || me.slide || me.climbing)) me.prone = false;
    if (me.prone) me.crouch = false;
    me.proneK += ((me.prone ? 1 : 0) - me.proneK) * Math.min(1, dt * 7);

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
    me.sprinting = !me.slide && !me.climbing && !me.prone && !this.aimWant &&
      (wantRun && f > 0 && !me.crouch && me.adsK < 0.3 && !firing && me.grounded || (me.sprinting && !me.grounded && wantRun));
    if (this.aimWant) me.sprintToggled = false;

    const ws = this.weapon();
    let speed = me.prone ? PRONE_SPEED : me.crouch ? CROUCH_SPEED : me.sprinting ? RUN : WALK;
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
        me.crouchToggled = false;
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
        if (me.prone) {
          this.getUp();   // jumping from prone just gets you up
        } else {
          // at a window, crate or low wall a jump vaults it instead
          if (this.tryVault(false)) return;
          me.vel.y = JUMP_V;
          me.grounded = false;
          // a jump always ends a crouch, toggled or held
          me.crouchToggled = false;
          if (me.crouch && phys.fits(me.pos, RADIUS, STAND_H)) me.crouch = false;
        }
      } else if (!frozen && !me.grounded && f > 0 && me.vel.y < 3.5) {
        // catching a ledge in mid-air (jumping at a window)
        if (this.tryVault(false)) return;
      }
    }

    // physics in small steps
    const px0 = me.pos.x, pz0 = me.pos.z;
    const body = { pos: me.pos, vel: me.vel, grounded: me.grounded, radius: RADIUS, height: me.prone ? PRONE_H : me.crouch ? CROUCH_H : STAND_H, landed: 0 };
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
    if (me.prone) this.proneBody(dt, wx, wz, wl, px0, pz0);
    this.clampToTown();

    // footsteps
    const hs = Math.hypot(me.vel.x, me.vel.z);
    this.stepT = (this.stepT || 0) - dt * hs;
    if (me.grounded && hs > 1.5 && this.stepT <= 0 && !me.slide) {
      this.stepT = 2.1;
      if (!me.crouch && !me.prone) sfx.footstep(null, me.sprinting ? 0.9 : 0.5);
    }
    if (me.climbing && Math.abs(me.vel.y) > 0.5) {
      this.climbT = (this.climbT || 0) - dt;
      if (this.climbT <= 0) { this.climbT = 0.32; sfx.footstep(null, 0.6); }
    }
    if (me.landed) sfx.footstep(null, 1.2);
  }

  // -- prone --

  // is there room for a body lying this way, head at pos and legs trailing behind?
  proneFits(pos, yaw) {
    const phys = this.world.physics;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    for (const back of [0.5, 0.95, PRONE_LEN]) {
      if (!phys.clearCircle(pos.x - fx * back, pos.z - fz * back, PRONE_R, pos.y + 0.08, pos.y + 0.55)) return false;
    }
    return true;
  }

  lieDown() {
    const me = this.me;
    // lie the way you face if there's room, else turned a little, so a corridor still works
    for (const off of [0, 0.6, -0.6, 1.2, -1.2, Math.PI]) {
      const y = me.yaw + off;
      if (!this.proneFits(me.pos, y)) continue;
      me.prone = true;
      me.bodyYaw = y;
      me.onBack = false;
      me.crouch = false;
      me.crouchToggled = false;
      me.sprinting = false;
      me.sprintToggled = false;
      return;
    }
    this.hud.center('No room to lie down', '', '', 1.2, 1);
  }

  getUp() {
    const me = this.me;
    me.prone = false;
    me.onBack = false;
    if (!this.world.physics.fits(me.pos, RADIUS, STAND_H)) {
      me.crouch = true;
      if (settings.crouchToggle) me.crouchToggled = true;
    }
  }

  // after a prone move: the legs can't pass through walls either, the body
  // turns toward the way you crawl, and looking far behind you rolls you over
  proneBody(dt, wx, wz, wl, px0, pz0) {
    const me = this.me;
    if (wl > 0) {
      // crawl head-first, or back away keeping the body as it lies
      let dy = wrapAngle(Math.atan2(-wx, -wz) - me.bodyYaw);
      if (Math.abs(dy) > Math.PI / 2) dy = wrapAngle(dy + Math.PI);
      const turn = Math.max(-dt * 3, Math.min(dt * 3, dy));
      const ny = me.bodyYaw + turn;
      if (turn !== 0 && this.proneFits(me.pos, ny)) me.bodyYaw = ny;
    }
    if (!this.proneFits(me.pos, me.bodyYaw)) {
      // slide along whatever the legs caught on, else stay put
      const nx = me.pos.x, nz = me.pos.z;
      me.pos.x = px0;
      if (!this.proneFits(me.pos, me.bodyYaw)) {
        me.pos.x = nx;
        me.pos.z = pz0;
        if (!this.proneFits(me.pos, me.bodyYaw)) {
          me.pos.x = px0;
          me.pos.z = pz0;
        }
      }
      me.vel.x = 0;
      me.vel.z = 0;
    }
    me.onBack = Math.abs(wrapAngle(me.yaw - me.bodyYaw)) > 1.75;
  }

  clampToTown() {
    const me = this.me;
    const [bx, bz] = this.map.bounds;
    me.pos.x = Math.max(-bx + 0.4, Math.min(bx - 0.4, me.pos.x));
    me.pos.z = Math.max(-bz + 0.4, Math.min(bz - 0.4, me.pos.z));
    if (me.pos.y < -12) me.pos.y = 0;
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
    if (input.pressed('melee')) want = 'knife';
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

    // the whole map
    if (input.pressed('map')) this.mapOpen = !this.mapOpen;

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
    if (d.melee) {
      if ((input.down('fire') || this.aimWant) && now >= ws.nextFire && !vm.busySwitching && me.nadeBusy <= 0 && !this.frozen()) {
        ws.nextFire = now + 60 / d.rpm;
        me.sprinting = false;
        this.swing(ws);
      }
      return;
    }
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
    const kind = me.nadeKind || 'frag';
    this.fx.throwNade(this.myId, nid, origin, vel, true, (p) => {
      this.send({ t: 'boom', n: nid, p: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)] });
      this.detonate(p, kind);
    }, kind);
    this.send({ t: 'nade', n: nid, k: kind, o: [origin.x, origin.y, origin.z].map((v) => +v.toFixed(3)), v: [vel.x, vel.y, vel.z].map((v) => +v.toFixed(3)) });
  }

  // a knife swing: one short reach in front of you, no bullet and no noise
  swing(ws) {
    const me = this.me;
    const d = ws.def;
    const cam = this.camera;
    cam.updateMatrixWorld();
    me.lastFire = this.clock;
    this.vm.swing();
    sfx.knifeSwing();
    const origin = cam.position.clone();
    const fwd = V().set(0, 0, -1).applyQuaternion(cam.quaternion);
    const teamMode = this.isTeamMode() && !this.warmup();
    const skip = (a) => teamMode && a.team === me.team;
    const wall = this.world.physics.raycast(origin, fwd, d.range);
    const reach = wall ? wall.t : d.range;
    const hits = [];
    // a little forgiveness sideways, so a swing past someone's shoulder lands
    for (const off of [0, -0.12, 0.12, 0.06]) {
      const dir = fwd.clone();
      if (off) dir.addScaledVector(V().set(1, 0, 0).applyQuaternion(cam.quaternion), off).normalize();
      const ph = this.avatars.raycast(origin, dir, reach, skip);
      if (ph && !hits.some((h) => h[0] === ph.id)) {
        hits.push([ph.id, 'b']);
        const end = origin.clone().addScaledVector(dir, ph.t);
        this.fx.blood(end, dir);
        ph.avatar.showName = 1.5;
        this.hud.hit(false, false);
        sfx.knifeHit(end);
        break;
      }
    }
    if (!hits.length && this.range) {
      const rh = this.range.raycast(origin, fwd, reach);
      if (rh) this.range.hit(rh, rh.t);
    }
    const pr = wall && wall.box && wall.box.prop ? [[wall.box.prop, 1]] : null;
    if ((hits.length || pr) && this.inRoom) {
      const msg = { t: 'shot', w: 'knife', q: 1, f: 0, o: [origin.x, origin.y, origin.z].map((v) => +v.toFixed(2)), e: [], h: hits };
      if (pr) msg.pr = pr;
      this.send(msg);
    }
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
    const props = {}, droneHits = [];   // cover walls hit (id -> pellets) and drones hit
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
      let ph = this.avatars.raycast(origin, dir, wt, skip);
      const dh = this.droneRaycast(origin, dir, ph ? ph.t : wt);
      if (dh) ph = null;
      const rh = this.range && this.range.raycast(origin, dir, wt);
      let end;
      if (dh) {
        end = origin.clone().addScaledVector(dir, dh.t);
        droneHits.push(dh.id);
        this.fx.impact(end, dir.clone().negate(), 'car');
      } else if (rh) {
        end = origin.clone().addScaledVector(dir, rh.t);
        if (!rangeHit) this.range.hit(rh, rh.t);
        rangeHit = true;
        this.hud.hit(false, rh.part === 'h');
        this.fx.impact(end, dir.clone().negate(), 'car');
      } else if (ph) {
        end = origin.clone().addScaledVector(dir, ph.t);
        hits.push([ph.id, ph.part]);
        // a freshly spawned player is shielded for a moment: sparks, not blood
        if (ph.avatar.flags & 128) this.fx.impact(end, dir.clone().negate(), 'car');
        else this.fx.blood(end, dir);
        ph.avatar.showName = 1.5;
      } else if (wh) {
        end = wh.point.clone();
        this.fx.impact(wh.point, wh.normal, wh.box && wh.box.mat);
        if (wh.box && wh.box.prop) props[wh.box.prop] = (props[wh.box.prop] || 0) + 1;
      } else {
        end = origin.clone().addScaledVector(dir, d.range);
      }
      ends.push(end);
      if (d.pellets === 1 || i < 6) this.fx.tracer(muzzle, end, d.tracer, d.id === 'sniper' ? 1.6 : 1);
    }
    const quiet = !!d.quiet;
    const flashMul = d.flash !== undefined ? d.flash : quiet ? 0.25 : 1;
    // muzzle flash lights the street around you
    if (!quiet && flashMul > 0.5) this.fx.light(muzzle, d.id === 'shotgun' ? 8 : 5);
    this.vm.fire(d.kick * (me.adsK > 0.5 ? 0.6 : 1), flashMul < 0.6);
    sfx.gunshot(d.id, null, true, quiet);
    // recoil climbs; spread blooms
    const recoilMul = (1 - 0.25 * me.adsK) * (me.prone ? 0.7 : me.crouch ? 0.85 : 1);
    const upK = d.recoilUp * recoilMul * (0.85 + Math.random() * 0.3);
    me.pitch = Math.min(1.52, me.pitch + upK);
    me.recoilDebt += upK;
    me.yaw += d.recoilSide * recoilMul * (Math.random() * 2 - 1);
    me.punch += upK * 0.5;
    ws.bloom = Math.min(d.bloomMax, ws.bloom + d.bloomShot * (me.prone ? 0.7 : 1));
    if (this.range && !rangeHit) this.range.miss();
    const msg = {
      t: 'shot', w: d.id, q: quiet ? 1 : 0, f: flashMul, o: [origin.x, origin.y, origin.z].map((v) => +v.toFixed(2)),
      e: ends.map((e) => [+e.x.toFixed(2), +e.y.toFixed(2), +e.z.toFixed(2)]), h: hits,
    };
    const pr = Object.entries(props);
    if (pr.length) msg.pr = pr;
    if (droneHits.length) msg.dh = droneHits;
    this.send(msg);
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
    if (this.inRoom && me.alive && this.drone) {
      const dr = this.drone;
      cam.position.copy(dr.pos);
      cam.rotation.set(dr.pitch, dr.yaw, Math.sin(this.clock * 9) * 0.004, 'YXZ');
    } else if (this.inRoom && me.alive) {
      let eye = EYE_STAND + (EYE_CROUCH - EYE_STAND) * me.crouchK;
      eye += (EYE_PRONE - eye) * me.proneK;
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
    // your team's recon beacons: the area they cover, sweeping on the map
    const teamMode = this.isTeamMode() && !this.warmup();
    for (const B of this.beacons.values()) {
      const ours = B.owner === this.myId || (teamMode && B.tm === this.me.team);
      if (!ours) continue;
      mmObj.push({ x: B.x, z: B.z, r: 35, color: 'rgba(255, 110, 90, 0.9)', fill: 'rgba(255, 90, 70, 0.1)', sweep: B.sweep });
    }
    // drones: yours and your team's in blue, enemy ones in red so they can be hunted
    for (const D of this.drones.values()) {
      const ours = D.owner === this.myId || (teamMode && D.tm === this.me.team);
      mmObj.push({ x: D.pos.x, z: D.pos.z, dot: true, color: ours ? '#7fc8ff' : '#ff4a33' });
    }
    // crates your side can use
    for (const C of this.crates.values()) {
      const ours = C.owner === this.myId || (teamMode && C.tm === this.me.team) || C.owner === -1;
      if (ours) mmObj.push({ x: C.p[0], z: C.p[2], dot: true, color: C.k === 'med' ? '#ffffff' : '#c9d86a' });
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
    const perk = PERKS[locker.perkFor(me.loadout)];
    hud.setPerk(perk.name, me.perkLeft, keyName(settings.binds.perk), (NADE_INFO[me.nadeKind] || NADE_INFO.frag).name);
    hud.setHP(me.alive ? me.hp : 0);
    if (this.range) hud.rangeTop(this.range.stats);
    else hud.top(g, me.team, this.myId, this.roster, this.clock);
    // crosshair: its gap is the real spread cone at this field of view
    if (ws && me.alive) {
      const spread = THREE.MathUtils.degToRad(ws.def.pelletSpread ? ws.def.pelletSpread * (1 + (0.72 - 1) * me.adsK) + ws.bloom * 0.3 : this.spreadDeg(ws));
      const px = (Math.tan(spread) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) * (window.innerHeight / 2);
      const onEnemy = this.aimTarget();
      hud.crosshair(px, me.adsK < 0.5 && !this.vm.scoped && !this.drone, onEnemy);
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
    const view = this.drone ? { x: this.drone.pos.x, z: this.drone.pos.z, yaw: this.drone.yaw }
      : me.alive ? { x: me.pos.x, z: me.pos.z, yaw: me.yaw } : { x: this.camera.position.x, z: this.camera.position.z, yaw: this.camera.rotation.y };
    hud.minimap(view, others, objs);
    hud.fullmap(this.mapOpen, view, others, objs, keyName(settings.binds.map));
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
        this.vm.visible = !this.drone;
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

// the Medic's cover wall: a steel plate two players wide and chest high,
// with a folded top edge, side posts and two braces holding it up from behind
function makeWallMesh() {
  const g = new THREE.Group();
  const base = new THREE.Color('#5a6a5c');
  const plate = new THREE.MeshLambertMaterial({ color: base.clone() });
  const dark = new THREE.MeshLambertMaterial({ color: '#2e3431' });
  const add = (w, h, d, mat, x, y, z, rx = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  add(WALL_W * 2, WALL_H, WALL_T * 2, plate, 0, WALL_H / 2, 0);
  add(WALL_W * 2 + 0.04, 0.06, 0.22, dark, 0, WALL_H - 0.03, 0.03);      // folded top lip
  for (const x of [-WALL_W + 0.03, WALL_W - 0.03]) {
    add(0.06, WALL_H, 0.2, dark, x, WALL_H / 2, 0.02);                    // side posts
    add(0.05, 0.05, 0.9, dark, x, 0.55, 0.42, 0.95);                       // angled brace
    add(0.12, 0.04, 0.5, dark, x, 0.02, 0.3);                              // foot
  }
  // rivet rows across the plate
  for (let i = 0; i < 5; i++) add(0.03, 0.03, 0.02, dark, -WALL_W + 0.25 + i * 0.28, 0.2, -WALL_T - 0.005);
  for (let i = 0; i < 5; i++) add(0.03, 0.03, 0.02, dark, -WALL_W + 0.25 + i * 0.28, WALL_H - 0.15, -WALL_T - 0.005);
  g.userData.plate = plate;
  g.userData.base = base;
  return g;
}

// a quadcopter about a metre across, carrying a grenade underneath
function makeDroneMesh() {
  const g = new THREE.Group();
  const dark = new THREE.MeshLambertMaterial({ color: '#2b2f33' });
  const grey = new THREE.MeshLambertMaterial({ color: '#8a9096' });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.3), dark);
  g.add(body);
  const cam = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.06), grey);
  cam.position.set(0, -0.06, -0.16);
  g.add(cam);
  const rotors = [];
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.03, 0.04), grey);
    arm.position.set(x * 0.18, 0.02, z * 0.18);
    arm.rotation.y = Math.atan2(-z, x);
    g.add(arm);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 8), dark);
    hub.position.set(x * 0.36, 0.05, z * 0.36);
    g.add(hub);
    const rotor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.006, 0.03), new THREE.MeshBasicMaterial({ color: '#111315', transparent: true, opacity: 0.55 }));
    rotor.position.set(x * 0.36, 0.085, z * 0.36);
    g.add(rotor);
    rotors.push(rotor);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.17, 20), new THREE.MeshBasicMaterial({ color: '#8a9096', transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(x * 0.36, 0.085, z * 0.36);
    g.add(disc);
  }
  const nade = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), new THREE.MeshLambertMaterial({ color: '#4a5236' }));
  nade.position.y = -0.13;
  g.add(nade);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff3b2f' }));
  led.position.set(0, 0.07, 0.12);
  g.add(led);
  g.userData.rotors = rotors;
  g.userData.led = led;
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

// an ammo crate (olive, with rounds on it) or a medic crate (white, red cross)
function makeSupplyCrate(kind) {
  const g = new THREE.Group();
  const med = kind === 'med';
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.42, 0.5), new THREE.MeshLambertMaterial({ color: med ? '#e9e4d8' : '#56603a' }));
  body.position.y = 0.21;
  g.add(body);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.06, 0.53), new THREE.MeshLambertMaterial({ color: med ? '#c9c2b2' : '#3f4628' }));
  lid.position.y = 0.44;
  g.add(lid);
  const mark = new THREE.MeshBasicMaterial({ color: med ? '#c9261c' : '#d9a441' });
  const icon = new THREE.Group();
  if (med) {
    icon.add(new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.08), mark));
    icon.add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 0.08), mark));
  } else {
    for (let i = -1; i <= 1; i++) {
      const round = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 8), mark);
      round.position.x = i * 0.08;
      icon.add(round);
    }
  }
  icon.position.y = 0.78;
  g.add(icon);
  // a soft glow so teammates can find it
  const glow = new THREE.Mesh(new THREE.CircleGeometry(0.9, 24), new THREE.MeshBasicMaterial({ color: med ? '#ff5a4a' : '#d9c24a', transparent: true, opacity: 0.25, depthWrite: false }));
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.03;
  g.add(glow);
  g.userData.icon = icon;
  return g;
}
