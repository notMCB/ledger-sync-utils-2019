// Menus, settings, patch notes, and wiring the game to the server.

import { Game } from './game.js';
import { Net } from './net.js';
import { input } from './input.js';
import { settings, saveSettings, resetBinds, ACTIONS, keyName } from './settings.js';
import { VERSION, PATCH_NOTES } from './version.js';
import { LOADOUTS, WEAPONS } from './weapons.js';
import { MODE_INFO, NICHE_MODES, AD_MODES, esc } from './hud.js';
import { unlockAudio, uiBlip, musicOn } from './audio.js';
import * as sfxModule from './audio.js';
import { nextUnlock } from './attachments.js';
import { locker } from './locker.js';
import { openLocker, lockerOpen, previewOutfit, previewGun, previewShot } from './lockerui.js';
import { Chat } from './chat.js';
import { auth } from './auth.js';
import { touch, touchWanted } from './touch.js';
import { PASS_TIERS, PASS_NAME, KILLS_PER_TIER } from './pass.js';
import { FINISH, OUTFIT, swatch } from './skins.js';
import { openGunStats } from './gunstats.js';
import { startFacts, startParty } from './party.js';

const $ = (id) => document.getElementById(id);
const canvas = $('view');
const THREE_V = () => new (game.camera.position.constructor)();
input.attach(canvas);

// ?autotest=<mode> joins straight away and drives the controls, for checking a build
const params = new URLSearchParams(location.search);
const LOCAL = location.hostname === 'localhost';
// the Render copy of the game (the address that works at school): its players are pointed at the real site
const MIRROR = /onrender\.com$/i.test(location.hostname);
const AUTOTEST = LOCAL ? params.get('autotest') : null;
const MODE_ORDER = ['tdm', 'ffa', 'koth', 'bomb'];
const ROYALE = 'royale';
const PHASE_TEXT = { waiting: 'Waiting for players', countdown: 'Starting', live: 'In progress', freeze: 'In progress', post: 'In progress', ended: 'Between matches' };
let rooms = [];
let modeButtons = null;   // built once, see renderModes
let ogCount = 0;          // playing O.G., which has its own rooms
let roomsKey = '';        // what the server list last showed
let shownUser = null;     // who the menu last showed as signed in
let status = 'connecting';
let deathTimer = null;

const ui = {
  onJoined(room) {
    $('menu').hidden = true;
    hideAll();
    toast(`Joined ${room.name}`);
    if (MIRROR) chat.system('During off school hours, play Souk Siege on Souksiege.com');
  },
  onSpawn() {
    $('death').hidden = true;
    $('results').hidden = true;
    clearInterval(deathTimer);
  },
  onPhase() {},
  onRoster() {},
  showDeath(byHtml, respawnAt, late = false) {
    $('death-by').innerHTML = byHtml;
    const royale = !!game.br;
    // the Derby has no loadouts to pick from either: it is a cart and three frags
    const noKit = royale || game.isDerby();
    $('death').classList.toggle('royale', royale);
    $('death').classList.remove('won');
    $('death-loadouts').hidden = noKit;
    $('death-ld-title').hidden = noKit;
    $('death-stats').hidden = true;
    const ad = game.isAD();
    $('death-side').hidden = !ad;
    if (ad) game.showSide();
    if (!royale) renderLoadouts($('death-loadouts'), true);
    $('death-hint').textContent = royale ? `${keyName(settings.binds.fire)} to watch the next player · Esc for the menu` : noKit ? 'Back on the track in a second' : input.locked ? 'Press 1–4 to pick a loadout, or Esc to use the mouse' : 'Click a loadout';
    $('death').hidden = false;
    clearInterval(deathTimer);
    const tick = () => {
      if (respawnAt < 0) {
        $('death-timer').textContent = royale ? (late ? 'You drop with everyone when the next match starts' : 'You are out. Watch the rest of the drop') : 'You are out for the rest of this round';
        return;
      }
      const s = Math.max(0, respawnAt - performance.now() / 1000);
      $('death-timer').textContent = s > 0.05 ? `Back in ${s.toFixed(1)}s` : 'Respawning…';
    };
    tick();
    deathTimer = setInterval(tick, 100);
    // in bomb mode the dead watch teammates, so get out of the way after a moment
    if (respawnAt < 0 && !royale) setTimeout(() => { if (!game.me.alive) $('death').hidden = true; }, 4000);
    if (respawnAt < 0 && royale) setTimeout(() => { if (!game.me.alive && $('death-stats').hidden) $('death').hidden = true; }, 6000);
  },
  // Souk Royale: how you did, on the death screen or the winner's card
  showStats(m) {
    const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    const el = $('death-stats');
    el.hidden = false;
    el.innerHTML = `<div class="bs-place">${m.won ? 'Winner' : '#' + m.place}<small>of ${m.of}</small></div>` +
      `<div class="bs-grid"><div><b>${m.k}</b><span>kills</span></div><div><b>${m.dmg}</b><span>damage</span></div>` +
      `<div><b>${fmt(m.sv)}</b><span>survived</span></div><div><b>${m.ch}</b><span>chests</span></div></div>` +
      (m.won ? '<div class="bs-prize">Season 1 champion’s outfit unlocked · it is in your Locker</div>' : '');
    if (m.won) {
      $('death-by').innerHTML = '<span class="gold">Souk Royale</span>';
      $('death-timer').textContent = 'Last one standing';
      $('death-hint').textContent = 'Click to carry on';
      $('death-loadouts').hidden = true;
      $('death-ld-title').hidden = true;
      $('death').classList.add('royale', 'won');
      $('death').hidden = false;
      clearInterval(deathTimer);
      setTimeout(() => { $('death').hidden = true; }, 11000);
    } else {
      $('death').hidden = false;
      setTimeout(() => { if (!game.me.alive) $('death').hidden = true; }, 9000);
    }
  },
  // Souk Royale: everyone's numbers for the match that just ended, a few seconds after
  // the personal card, for as long as they want to look
  showResults(m, myId) {
    const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    clearTimeout(resultsTimer);
    resultsTimer = setTimeout(() => {
      if (!game.inRoom || !game.br) return;
      const most = m.rows.slice().sort((a, b) => b.d - a.d)[0];
      const far = m.rows.slice().sort((a, b) => (b.lg || 0) - (a.lg || 0))[0];
      const cards = [];
      if (most && most.d > 0) cards.push(`Most damage: ${esc(most.n)} (${most.d})`);
      if (far && far.lg > 0) cards.push(`Longest kill: ${esc(far.n)} (${far.lg} m)`);
      $('results-sub').innerHTML = esc(m.w ? `${m.w} won · ${m.of} dropped` : `${m.of} dropped`) + (cards.length ? ' · ' + cards.join(' · ') : '');
      $('results-table').innerHTML = '<table><tr><th>#</th><th class="l">Player</th><th>Kills</th><th>Damage</th><th>Survived</th><th>Chests</th></tr>' +
        m.rows.map((r) => `<tr class="${r.id === myId ? 'me' : ''}${r.pl === 1 ? ' won' : ''}"><td>${r.pl || '–'}</td><td class="l">${esc(r.n)}</td><td>${r.k}</td><td>${r.d}</td><td>${fmt(r.sv)}</td><td>${r.ch}</td></tr>`).join('') + '</table>';
      $('death').hidden = true;
      $('results').hidden = false;
      input.unlock();
    }, 5000);
  },
  openLoadout() {
    openLoadout();
  },
};
let resultsTimer = 0;
$('results-close').addEventListener('click', () => { $('results').hidden = true; });

const game = new Game(canvas, ui);
touch.init();
touch.onPause = () => input.unlock();
input.setTouch(touchWanted());
// the controls show over a match on a touch screen; a phone held upright is asked to turn
setInterval(() => {
  // the menu and the warm-up have music; a live match has none
  musicOn(!game.inRoom || game.warmup());
  input.setTouch(touchWanted());
  touch.setActive(input.touch && game.inRoom && input.locked, !!game.br);
  const portrait = input.touch && game.inRoom && window.innerHeight > window.innerWidth * 1.1;
  if ($('turn').hidden === portrait) $('turn').hidden = !portrait;
}, 120);
const net = new Net(onMessage, onStatus);
game.net = net;
const chat = new Chat(net);
chat.local = (text) => game.adminLocal(text);
chat.canTeam = () => game.isTeamMode() && !game.warmup();
game.chat = chat;
setInterval(() => chat.update(), 500);
auth.init(net);

function onMessage(m) {
  if (m.t === 'stats') { locker.setStats(m.stats); return; }
  if (auth.onMessage(m)) return;
  if (m.t === 'welcome') {
    game.myId = m.id;
    // sign-in is only offered where the server can keep accounts
    const acc = m.acc !== false;
    document.getElementById('account-strip').classList.toggle('no-accounts', !acc);
    if (acc && !auth.user) auth.resume();
    if (!game.inRoom) net.send({ t: 'preview' });
    if (AUTOTEST && !game.inRoom) {
      $('notes').hidden = true;
      net.send({ t: 'join', mode: AUTOTEST, ld: Number(params.get('ld') || 0), map: params.get('map') || undefined });
      input.simulate(true);
    }
    return;
  }
  if (m.t === 'reload') {
    // the server has been updated; reload once to pick up the new version (and its patch notes)
    let tried = null;
    try { tried = sessionStorage.getItem('souk-reload'); } catch (e) { /* ignore */ }
    if (tried !== m.v) {
      try { sessionStorage.setItem('souk-reload', m.v); } catch (e) { /* ignore */ }
      location.reload();
    }
    return;
  }
  if (m.t === 'rooms') {
    rooms = m.list;
    ogCount = m.og || 0;
    renderRooms();
    return;
  }
  if (m.t === 'err') {
    toast(m.m);
    return;
  }
  if (m.t === 'bugok') {
    onBugOk(m);
    return;
  }
  if (m.t === 'banned') {
    net.stop();
    if (game.inRoom) game.leave();
    hideAll();
    $('menu').hidden = true;
    $('hud').hidden = true;
    $('banned').hidden = false;
    return;
  }
  if (m.t === 'banbanner') {
    // someone has been banned: everyone sees it, menu or match
    const el = $('banbanner');
    el.innerHTML = `<span class="bb-name">${esc(m.n)}</span><span class="bb-sub">is banned</span>`;
    el.style.setProperty('--len', Math.max(6, String(m.n).length));     // a long name is set smaller, to stay on one line
    el.hidden = false;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.hidden = true; }, 6000);
    return;
  }
  if (m.t === 'kicked') {
    if (game.inRoom) {
      game.leave();
      showMenu();
    }
    toast(m.why === 'idle' ? 'You were removed from the match after 5 minutes without moving' : 'You were removed from the match');
    return;
  }
  if (m.t === 'map' && m.preview && game.inRoom) return;
  game.onMessage(m);
}

function onStatus(s) {
  status = s;
  const el = $('status');
  el.className = 'status ' + s;
  const n = rooms.reduce((a, r) => a + r.n, 0);
  el.querySelector('span').textContent = {
    connecting: 'Connecting…', online: `Online · ${n} playing`, offline: 'Server offline — retrying', lost: 'Connection lost — reconnecting',
  }[s];
  if (s === 'online') sayHello();
  if (s === 'lost' && game.inRoom) {
    game.leave();
    showMenu();
    toast('Lost connection to the server');
  }
  renderModes();
}

// an id this browser keeps, so a ban follows the device and not just the name
function deviceId() {
  try {
    let id = localStorage.getItem('souk-device');
    if (!id || !/^[a-z0-9]{24}$/.test(id)) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join('');
      localStorage.setItem('souk-device', id);
    }
    return id;
  } catch (e) {
    return '';
  }
}

function sayHello() {
  net.setHello({ t: 'hello', name: currentName(), v: VERSION, cos: locker.cosmetics(settings.lastLoadout || 0), dev: deviceId() });
}

function currentName() {
  return ($('name').value || '').trim() || settings.name || (AUTOTEST ? 'Tester' : 'Player');
}

// -- menu -----------------------------------------------------------------

// the mode buttons are built once; after that only their numbers change,
// so the button under your cursor is never swapped out from under it
function renderModes() {
  const host = $('modes');
  if (!modeButtons) {
    modeButtons = {};
    host.innerHTML = '';
    // Souk Royale, across the top: one map, so straight in
    {
      const info = MODE_INFO[ROYALE];
      const b = document.createElement('button');
      b.className = 'mode royale';
      b.innerHTML = `<span class="m-name">${info.name}</span><span class="m-desc">${info.desc}</span>` +
        `<span class="m-meta"><span><span class="m-count">0</span> playing · up to 64</span><span class="m-play">Drop in →</span></span>`;
      b.addEventListener('click', () => join({ mode: ROYALE }));
      host.appendChild(b);
      modeButtons[ROYALE] = b;
    }
    for (const id of MODE_ORDER) {
      const info = MODE_INFO[id];
      const b = document.createElement('button');
      b.className = 'mode';
      b.innerHTML = `<span class="m-name">${info.name}</span><span class="m-desc">${info.desc}</span>` +
        `<span class="m-meta"><span><span class="m-count">0</span> playing</span><span class="m-play">Play →</span></span>`;
      b.addEventListener('click', () => pickMap(id));
      host.appendChild(b);
      modeButtons[id] = b;
    }
    // the Derby: one track, so straight in
    {
      const info = MODE_INFO.derby;
      const b = document.createElement('button');
      b.className = 'mode derby';
      b.innerHTML = `<span class="m-name">${info.name}</span><span class="m-desc">${info.desc}</span>` +
        `<span class="m-meta"><span><span class="m-count">0</span> playing · up to 12</span><span class="m-play">Race →</span></span>`;
      b.addEventListener('click', () => join({ mode: 'derby' }));
      host.appendChild(b);
      modeButtons.derby = b;
    }
    // the niche modes live in a folder of their own
    const folder = document.createElement('button');
    folder.className = 'mode';
    folder.innerHTML = `<span class="m-name">${MODE_INFO.niche.name}</span><span class="m-desc">${MODE_INFO.niche.desc}</span>` +
      `<span class="m-meta"><span><span class="m-count">0</span> playing</span><span class="m-play">Open →</span></span>`;
    folder.addEventListener('click', () => { uiBlip(); $('modes').hidden = true; $('niche').hidden = false; });
    host.appendChild(folder);
    modeButtons.niche = folder;
    const nh = $('niche-modes');
    nh.innerHTML = '';
    for (const id of NICHE_MODES) {
      const info = MODE_INFO[id];
      const b = document.createElement('button');
      b.className = 'mode';
      b.innerHTML = `<span class="m-name">${info.name}</span><span class="m-desc">${info.desc}</span>` +
        `<span class="m-meta"><span><span class="m-count">0</span> playing</span><span class="m-play">Play →</span></span>`;
      b.addEventListener('click', () => pickMap(id));
      nh.appendChild(b);
      modeButtons[id] = b;
    }
    // Attack and Defend: a folder too, one map, straight in
    const adf = document.createElement('button');
    adf.className = 'mode';
    adf.innerHTML = `<span class="m-name">${MODE_INFO.ad.name}</span><span class="m-desc">${MODE_INFO.ad.desc}</span>` +
      `<span class="m-meta"><span><span class="m-count">0</span> playing</span><span class="m-play">Open →</span></span>`;
    adf.addEventListener('click', () => { uiBlip(); $('modes').hidden = true; $('ad').hidden = false; });
    host.appendChild(adf);
    modeButtons.ad = adf;
    const ah = $('ad-modes');
    ah.innerHTML = '';
    for (const id of AD_MODES) {
      const info = MODE_INFO[id];
      const b = document.createElement('button');
      b.className = 'mode';
      b.innerHTML = `<span class="m-name">${info.name}</span><span class="m-desc">${info.desc}</span>` +
        `<span class="m-meta"><span><span class="m-count">0</span> playing · up to 20</span><span class="m-play">Play →</span></span>`;
      b.addEventListener('click', () => join({ mode: id }));
      ah.appendChild(b);
      modeButtons[id] = b;
    }
    // O.G.: the launch-day game, a page of its own
    {
      const info = MODE_INFO.og;
      const b = document.createElement('button');
      b.className = 'mode og';
      b.innerHTML = `<span class="m-name">${info.name}</span><span class="m-desc">${info.desc}</span>` +
        `<span class="m-meta"><span><span class="m-count">0</span> playing</span><span class="m-play">Play →</span></span>`;
      b.addEventListener('click', () => {
        const name = currentName();
        if (!name || name.toLowerCase() === 'player') { toast('Type a name first'); $('name').focus(); return; }
        uiBlip();
        location.href = '/og/?name=' + encodeURIComponent(name);
      });
      host.appendChild(b);
      modeButtons.og = b;
    }
    // solo aim training: no server needed
    const info = MODE_INFO.range;
    const r = document.createElement('button');
    r.className = 'mode range';
    r.innerHTML = `<span class="m-name">${info.name}</span><span class="m-desc">${info.desc}</span>` +
      `<span class="m-meta"><span>Solo</span><span class="m-play">Train →</span></span>`;
    r.addEventListener('click', () => {
      unlockAudio();
      uiBlip();
      $('menu').hidden = true;
      hideAll();
      game.startRange();
      input.lock();
    });
    host.appendChild(r);
  }
  for (const id of [ROYALE, ...MODE_ORDER, 'derby', ...NICHE_MODES, 'niche', ...AD_MODES, 'ad']) {
    const b = modeButtons[id];
    const n = rooms.filter((r) => (id === 'niche' ? NICHE_MODES.includes(r.mode) : id === 'ad' ? AD_MODES.includes(r.mode) : r.mode === id)).reduce((a, r) => a + r.n, 0);
    const c = b.querySelector('.m-count');
    if (c.textContent !== String(n)) c.textContent = n;
    const off = status !== 'online';
    if (b.disabled !== off) b.disabled = off;
  }
  const oc = modeButtons.og.querySelector('.m-count');
  if (oc.textContent !== String(ogCount)) oc.textContent = ogCount;
}

// the server list only rebuilds when something in it actually changed
function renderRooms() {
  const host = $('rooms');
  const sorted = [...rooms].sort((a, b) => b.n - a.n || MODE_ORDER.indexOf(a.mode) - MODE_ORDER.indexOf(b.mode));
  const key = JSON.stringify(sorted.map((r) => [r.id, r.name, r.n, r.max, r.ph, r.map]));
  if (key !== roomsKey) {
    roomsKey = key;
    host.innerHTML = '';
    for (const r of sorted) {
      const b = document.createElement('button');
      const full = r.n >= r.max;
      b.className = 'room' + (full ? ' full' : '');
      b.innerHTML = `<span class="r-name">${esc(r.name)}</span><span class="r-count">${r.n}/${r.max}</span>` +
        `<span class="r-phase${r.ph === 'live' ? ' r-live' : ''}">${PHASE_TEXT[r.ph] || r.ph}${r.map ? ' · ' + esc(r.map) : ''}</span>`;
      if (!full) b.addEventListener('click', () => join({ room: r.id }));
      host.appendChild(b);
    }
    if (!sorted.length) host.innerHTML = '<p class="browser-note">No servers yet.</p>';
  }
  onStatusCount();
  renderModes();
}

function onStatusCount() {
  if (status !== 'online') return;
  const n = rooms.reduce((a, r) => a + r.n, 0);
  $('status').querySelector('span').textContent = `Online · ${n} playing`;
}

// the maps a match can be played on, in rotation order
const MAPS = [
  { id: 'town', name: 'Old Town', desc: 'Sun-baked streets, rooftops and tunnels', swatch: 'linear-gradient(90deg,#c9a877,#e9d6b4)' },
  { id: 'dock', name: 'The Dockyard', desc: 'Containers, cranes and warehouses', swatch: 'linear-gradient(90deg,#8f949a,#b8412f,#2e6fa3)' },
  { id: 'alpine', name: 'Ridgeline', desc: 'A snowbound ridge, bunkers and pines', swatch: 'linear-gradient(90deg,#e9edf1,#6f8fb0)' },
  { id: 'manor', name: 'The Manor', desc: 'A great house in its gardens', swatch: 'linear-gradient(90deg,#6f9a3c,#f4f2ec,#b9ae98)' },
];

// after a mode is chosen: pick the map, unless a match in that mode is already
// under way, in which case you join it on whatever map it is playing
function pickMap(mode) {
  const busy = rooms.filter((r) => r.mode === mode && r.n > 0 && r.n < r.max).sort((a, b) => b.n - a.n)[0];
  if (busy) {
    toast(`Joining ${busy.name}${busy.map ? ' on ' + busy.map : ''}`);
    join({ mode });
    return;
  }
  $('modes').hidden = true;
  $('niche').hidden = true;
  $('ad').hidden = true;
  const box = $('maps');
  box.hidden = false;
  $('maps-title').textContent = `${MODE_INFO[mode].name} · pick a map`;
  const host = $('map-cards');
  host.innerHTML = '';
  for (const m of MAPS) {
    const b = document.createElement('button');
    b.className = 'mapcard';
    b.innerHTML = `<span class="mc-swatch" style="background:${m.swatch}"></span><span class="mc-name">${m.name}</span><span class="mc-desc">${m.desc}</span>`;
    b.addEventListener('click', () => {
      closeMaps();
      join({ mode, map: m.id });
    });
    host.appendChild(b);
  }
  $('maps-note').textContent = 'Nobody is in this mode yet, so you choose where it starts. Maps take turns after each match.';
}

function closeMaps() {
  $('maps').hidden = true;
  $('niche').hidden = true;
  $('ad').hidden = true;
  $('modes').hidden = false;
}

$('niche-back').addEventListener('click', () => { uiBlip(); $('niche').hidden = true; $('modes').hidden = false; });
$('ad-back').addEventListener('click', () => { uiBlip(); $('ad').hidden = true; $('modes').hidden = false; });
// Attack and Defend: which point to come back at
$('side-a').addEventListener('click', () => { uiBlip(); game.pickSide(0); });
$('side-b').addEventListener('click', () => { uiBlip(); game.pickSide(1); });

$('maps-back').addEventListener('click', () => { uiBlip(); closeMaps(); });

function join(target) {
  unlockAudio();
  uiBlip();
  const name = currentName();
  // nobody plays as "Player": give a name, or sign in
  if (!auth.user && (!name || name.toLowerCase() === 'player')) {
    toast('Enter your name first, or sign in');
    const f = $('name-field');
    f.classList.remove('nudge');
    void f.offsetWidth;
    f.classList.add('nudge');
    $('name').focus();
    return;
  }
  settings.name = name;
  saveSettings();
  sayHello();
  const mapPick = params.get('map') ? { map: params.get('map') } : {};
  net.send({ t: 'join', ld: settings.lastLoadout || 0, cos: locker.cosmetics(settings.lastLoadout || 0), ...locker.picks(settings.lastLoadout || 0), ...mapPick, ...target });
  input.lock();
}

function showMenu() {
  hideAll();
  $('menu').hidden = false;
  $('hud').hidden = true;
  net.send({ t: 'preview' });
}

function hideAll() {
  for (const id of ['pause', 'settings', 'loadout', 'notes', 'pass', 'results', 'stats', 'gunstats', 'shop']) $(id).hidden = true;
}

// -- the battle pass ---------------------------------------------------------------

const KIND_NAMES = { finish: 'Gun skin', melee: 'Melee', muzzle: 'Suppressor', outfit: 'Outfit' };

function renderPass() {
  const kills = locker.passKills();
  const tier = locker.passTier();
  $('pass-season').textContent = PASS_NAME;
  $('pass-bar').style.width = `${Math.min(100, (kills / (KILLS_PER_TIER * PASS_TIERS.length)) * 100)}%`;
  $('pass-count').textContent = tier >= PASS_TIERS.length ? `${kills} kills · complete` : `${kills} kills · ${KILLS_PER_TIER * (tier + 1) - kills} to tier ${tier + 1}`;
  const host = $('pass-tiers');
  host.innerHTML = '';
  for (const t of PASS_TIERS) {
    const got = tier >= t.n;
    const d = document.createElement('div');
    d.className = 'pt ' + (got ? 'got' : 'locked');
    let art = 'linear-gradient(135deg,#5a5f66,#3c3f44)';
    if (t.kind === 'finish' || t.kind === 'melee') art = swatch(FINISH[t.id]);
    else if (t.kind === 'outfit') art = swatch(OUTFIT[t.id]);
    else if (t.kind === 'muzzle') art = 'linear-gradient(90deg,#8a5a36 0 70%,#c9a06a 70% 78%,#3a2416 78%)';
    d.innerHTML = `<div class="pt-n">Tier ${t.n} · ${t.n * KILLS_PER_TIER} kills</div><div class="pt-art" style="background:${art}"></div>` +
      `<div class="pt-name">${esc(t.name)}</div><div class="pt-kind">${KIND_NAMES[t.kind]}</div><div class="pt-blurb">${esc(t.blurb)}</div>` +
      `<div class="pt-state">${got ? 'Unlocked' : `${Math.max(0, t.n * KILLS_PER_TIER - kills)} kills to go`}</div>`;
    if (got && t.kind === 'muzzle') {
      const on = locker.muzzleStyle() === t.id;
      const b = document.createElement('button');
      b.className = 'btn small' + (on ? '' : ' ghost');
      b.textContent = on ? 'On your suppressors' : 'Use it';
      b.addEventListener('click', () => { locker.setMuzzleStyle(on ? '' : t.id); uiBlip(); renderPass(); game.refreshCosmetics(); });
      d.appendChild(b);
    }
    host.appendChild(d);
  }
}

function openPass() {
  renderPass();
  $('pause').hidden = true;
  $('pass').hidden = false;
  input.unlock();
}
$('btn-pass').addEventListener('click', () => { uiBlip(); openPass(); });

// -- the stats page ------------------------------------------------------------------
function renderStats() {
  const st = locker.stats();
  const fav = locker.favouriteGun();
  const hours = (s) => (s >= 3600 ? `${(s / 3600).toFixed(1)} h` : `${Math.floor(s / 60)} min`);
  const kd = st.deaths ? (st.kills / st.deaths).toFixed(2) : st.kills ? st.kills.toFixed(2) : '–';
  const winRate = st.matches ? `${Math.round((st.wins / st.matches) * 100)}%` : '–';
  const tiles = [
    ['Matches', st.matches], ['Wins', st.wins], ['Win rate', winRate],
    ['Souk Royales', st.royales], ['Best placing', st.best ? `#${st.best}` : '–'],
    ['Kills', st.kills], ['Deaths', st.deaths], ['K/D', kd],
    ['Headshots', st.hs], ['Assists', st.assists], ['Damage dealt', st.dmg.toLocaleString()],
    ['Longest kill', st.long ? `${st.long} m` : '–'], ['Time played', hours(st.time)],
    ['Favourite gun', fav ? `${WEAPONS[fav.weapon] ? WEAPONS[fav.weapon].name : fav.weapon}` : '–'],
  ];
  $('stats-grid').innerHTML = tiles.map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');
  $('stats-sub').textContent = locker.signedIn ? `${$('si-name').textContent}'s record, kept on the account` : 'Kept on this device. Sign in and your record follows you everywhere.';
  const byGun = Object.entries(locker.gunKills()).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  $('stats-guns').innerHTML = byGun.length ? byGun.map(([w, n]) => `<div class="stat-gun"><span>${WEAPONS[w] ? WEAPONS[w].name : w}</span><i style="width:${Math.round((n / byGun[0][1]) * 100)}%"></i><b>${n}</b></div>`).join('') : '<p class="panel-sub">No kills yet. Get out there.</p>';
}
function openStats() {
  renderStats();
  $('pause').hidden = true;
  $('stats').hidden = false;
  input.unlock();
}
$('btn-stats').addEventListener('click', () => { uiBlip(); openStats(); });

// -- the shop: skins and such for real money, paid on Stripe's page ------------------------
let shopData = null;
async function loadShop() {
  try {
    shopData = await (await fetch('/shop', { cache: 'no-store' })).json();
  } catch (e) {
    shopData = null;
  }
  // the button shows once there is something to sell (the owner always sees it, to manage it)
  $('btn-shop').hidden = !(shopData && (shopData.items.length || game.admin));
}
function shopKindName(k) {
  return { outfit: 'Outfit', gun: 'Gun finish', cart: 'Golf cart skin', dinars: 'Dinars' }[k] || k;
}
function shopItemSwatch(it) {
  try {
    if (it.kind === 'outfit' && OUTFIT[it.id]) return swatch(OUTFIT[it.id]);
    if (it.kind === 'gun') { const f = it.id.split(':')[1]; if (FINISH[f]) return swatch(FINISH[f]); }
    if (it.kind === 'cart' && CART[it.id]) return swatch(CART[it.id]);
  } catch (e) { /* no swatch */ }
  return it.kind === 'dinars' ? 'linear-gradient(135deg, #e6a23c, #8a5a1a)' : '#6b5d4a';
}
function renderShop() {
  const grid = $('shop-grid');
  const d = shopData;
  const owned = (it) => {
    if (it.kind === 'outfit') return locker.outfits().includes(it.id);
    if (it.kind === 'gun') { const [w, f] = it.id.split(':'); return locker.ownsGun(w, f); }
    if (it.kind === 'cart') return locker.carts().includes(it.id);
    return false;
  };
  if (!d || !d.items.length) {
    grid.innerHTML = '';
    $('shop-note').textContent = 'Nothing for sale yet.';
  } else {
    grid.innerHTML = d.items.map((it) => `<div class="shop-card${owned(it) ? ' owned' : ''}" data-sku="${esc(it.sku)}"><div class="sw" style="background:${shopItemSwatch(it)}"></div><b>${esc(it.name)}</b><small>${esc(shopKindName(it.kind))}${it.blurb ? ' · ' + esc(it.blurb) : ''}</small><span class="price">${esc(priceText(it.price, d.currency))}</span><button class="btn small" ${owned(it) ? 'disabled' : ''}>${owned(it) ? 'Owned' : 'Buy'}</button></div>`).join('');
    $('shop-note').textContent = !auth.user ? 'Sign in to buy: what you buy goes on your account and stays there.' : !d.on ? 'The trader is not taking payments yet.' : 'Paying takes you to a secure Stripe page and brings you straight back. Prices in Australian dollars.';
    grid.querySelectorAll('.shop-card .btn').forEach((b) => b.addEventListener('click', () => buyItem(b.closest('.shop-card').dataset.sku)));
  }
  $('shop-sub').textContent = auth.user ? `Buying as ${auth.user.username}` : 'Not signed in';
}
function priceText(cents, cur) {
  return `${cur === 'aud' ? 'A$' : ''}${(cents / 100).toFixed(2)}`;
}
async function buyItem(sku) {
  uiBlip();
  if (!auth.user) { toast('Sign in first: what you buy goes on your account'); return; }
  try {
    const r = await fetch('/shop/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sku, token: auth.token() }) });
    const m = await r.json();
    if (m.url) { location.href = m.url; return; }
    toast(m.error || 'That could not be bought just now.');
  } catch (e) {
    toast('The shop could not be reached.');
  }
}
function openShop() {
  renderShop();
  loadShop().then(renderShop);
  $('pause').hidden = true;
  $('shop').hidden = false;
  input.unlock();
}
$('btn-shop').addEventListener('click', () => { uiBlip(); openShop(); });
$('shop-close').addEventListener('click', () => { uiBlip(); $('shop').hidden = true; if (game.inRoom) resume(); });
if (params.get('paid')) {
  // back from paying: the server's webhook has put it in the locker, which the sign-in brings down
  setTimeout(() => { toast('Thank you. Your purchase is in your Locker.'); history.replaceState(null, '', location.pathname); }, 1200);
}
if (params.get('shop')) setTimeout(() => { openShop(); history.replaceState(null, '', location.pathname); }, 800);
loadShop();
auth.onChange(() => loadShop());
startFacts($('tagline'));
startParty(() => { unlockAudio(); });
// the gun stats page: from the menu or the pause menu, with the gun in hand picked
function openGuns() {
  $('pause').hidden = true;
  input.unlock();
  const ws = game.inRoom && game.me && game.me.weapons && game.me.weapons[game.me.slot];
  openGunStats(ws ? ws.id : locker.primaryFor(settings.lastLoadout || 0), {
    // like the Locker: what you fit here is on your guns from your next life
    changed: () => {},
    closed: () => { game.refreshCosmetics(); if (game.inRoom) resume(); },
  });
}
$('btn-gunstats').addEventListener('click', () => { uiBlip(); openGuns(); });
// for checking a build on this machine: ?open=gunstats or ?open=carts opens that page
if (LOCAL && params.get('open') === 'gunstats') setTimeout(() => { $('notes').hidden = true; openGuns(); }, 800);
if (LOCAL && params.get('open') === 'banner') {
  setTimeout(() => {
    $('notes').hidden = true;
    onMessage({ t: 'banbanner', n: params.get('name') || 'Cheater' });
    // ?still=1 holds it on screen, unanimated, for a picture
    if (params.get('still')) { const el = $('banbanner'); el.classList.remove('show'); clearTimeout(el._t); }
  }, 800);
  setTimeout(() => {
    const el = $('banbanner'), r = document.createRange();
    r.selectNodeContents(el);
    const b = r.getBoundingClientRect(), z = el.getBoundingClientRect();
    fetch('/__log?m=' + encodeURIComponent(`[banner] text ${Math.round(b.left)}..${Math.round(b.right)} x ${Math.round(b.top)}..${Math.round(b.bottom)}, box ${Math.round(z.width)} wide, window ${innerWidth}, opacity ${getComputedStyle(el).opacity}`));
  }, 3000);
}
if (LOCAL && params.get('open') === 'carts') setTimeout(() => { $('notes').hidden = true; locker.grant(0, 0, true); openLocker(() => {}, () => {}); document.querySelector('.lk-tab[data-tab="carts"]').click(); }, 800);
$('btn-pause-gunstats').addEventListener('click', () => { uiBlip(); openGuns(); });
$('btn-pause-stats').addEventListener('click', () => { uiBlip(); openStats(); });
$('stats-close').addEventListener('click', () => { $('stats').hidden = true; if (game.inRoom) resume(); });
$('pass-close').addEventListener('click', () => {
  $('pass').hidden = true;
  if (game.inRoom) resume();
});
locker.onChange(() => { if (!$('pass').hidden) renderPass(); });

// -- loadouts ---------------------------------------------------------------

function renderLoadouts(host, compact) {
  host.innerHTML = '';
  const cur = settings.lastLoadout || 0;
  LOADOUTS.forEach((l, i) => {
    const b = document.createElement('button');
    b.className = 'ld' + (i === cur ? ' on' : '');
    const w = WEAPONS[l.weapon];
    b.innerHTML = `<span class="ld-key">${i + 1}</span><span class="ld-title">${l.title}</span><span class="ld-gun">${w.name}</span>` +
      (compact ? '' : '') + `<span class="ld-blurb">${l.blurb}</span>`;
    b.addEventListener('click', () => pickLoadout(i));
    host.appendChild(b);
  });
}

function pickLoadout(i) {
  settings.lastLoadout = i;
  saveSettings();
  if (game.offline) game.applyLoadout(i);
  else if (game.inRoom) net.send({ t: 'ld', ld: i, ...locker.picks(i) });
  renderLoadouts($('death-loadouts'), true);
  renderLoadouts($('menu-loadouts'), false);
  uiBlip();
  if (game.inRoom && game.me.alive) toast(`${LOADOUTS[i].title} — ${WEAPONS[LOADOUTS[i].weapon].name}`);
}

function openLoadout() {
  renderLoadouts($('menu-loadouts'), false);
  $('loadout').hidden = false;
  input.unlock();
}

$('loadout-close').addEventListener('click', () => {
  $('loadout').hidden = true;
  if (game.inRoom) resume();
});

// -- pause ----------------------------------------------------------------

input.onUnlock = () => {
  chat.close();
  if (!game.inRoom) return;
  if (!$('loadout').hidden || !$('settings').hidden || !$('notes').hidden || !$('locker').hidden || !$('auth').hidden || !$('pass').hidden) return;
  if (!$('death').hidden) return; // the death screen stays usable with the mouse
  $('pause').hidden = false;
  $('pause-title').textContent = game.room ? game.room.name : 'Paused';
};

function resume() {
  hideAll();
  input.lock();
}

$('btn-resume').addEventListener('click', resume);
$('btn-leave').addEventListener('click', () => {
  game.leave();
  showMenu();
});
$('btn-pause-loadout').addEventListener('click', () => {
  $('pause').hidden = true;
  openLoadout();
});
$('btn-pause-settings').addEventListener('click', () => openSettings());
$('btn-pause-notes').addEventListener('click', () => openNotes());
canvas.addEventListener('click', () => {
  if (game.inRoom && !input.locked && $('pause').hidden && $('settings').hidden && $('loadout').hidden && $('results').hidden && $('stats').hidden && $('gunstats').hidden && $('shop').hidden) input.lock();
});
$('death').addEventListener('click', (e) => {
  if (e.target.closest('.ld')) return;
  if (game.inRoom && !input.locked) input.lock();
});

// number keys choose a loadout on the death screen
input.onKeyCode = (e) => {
  if (!$('death').hidden && !game.me.alive && !game.br && /^Digit[1-4]$/.test(e.code)) {
    pickLoadout(Number(e.code.slice(5)) - 1);
    return true;
  }
  if (e.code === 'Escape' && !$('settings').hidden) {
    closeSettings();
    return true;
  }
  if (e.code === 'Escape' && !$('auth').hidden) {
    auth.close();
    return true;
  }
  return false;
};

// -- settings -------------------------------------------------------------

function renderBinds() {
  const host = $('binds');
  host.innerHTML = '';
  const counts = {};
  for (const a of ACTIONS) {
    for (const c of [settings.binds[a.id], settings.alt[a.id]]) if (c) counts[c] = (counts[c] || 0) + 1;
  }
  let group = '';
  for (const a of ACTIONS) {
    if (a.group !== group) {
      group = a.group;
      const h = document.createElement('div');
      h.className = 'bind-group';
      h.innerHTML = `<span>${group}</span><span>Key</span><span>Also</span>`;
      host.appendChild(h);
    }
    const row = document.createElement('div');
    row.className = 'bind';
    row.innerHTML = `<span>${a.label}</span>`;
    for (const slot of ['binds', 'alt']) {
      const code = settings[slot][a.id];
      const btn = document.createElement('button');
      btn.id = `bind-${slot}-${a.id}`;
      const clash = code && counts[code] > 1;
      if (clash) {
        btn.className = 'clash';
        btn.title = 'Also used by another action';
      }
      btn.textContent = keyName(code);
      btn.addEventListener('click', () => {
        btn.classList.add('listening');
        btn.textContent = 'Press a key…';
        // wait a tick so this click is not captured as the binding
        setTimeout(() => {
          input.captureNext((c) => {
            if (c !== null) settings[slot][a.id] = c;
            saveSettings();
            renderBinds();
          });
        }, 60);
      });
      row.appendChild(btn);
    }
    host.appendChild(row);
  }
}

const SLIDERS = [
  ['s-touchscale', 'o-touchscale', 'touchScale', (v) => `${Math.round(v * 100)}%`],
  ['s-touchsens', 'o-touchsens', 'touchSens', (v) => v.toFixed(2)],
  ['s-sens', 'o-sens', 'sens', (v) => v.toFixed(2)],
  ['s-ads', 'o-ads', 'adsSens', (v) => v.toFixed(2)],
  ['s-fov', 'o-fov', 'fov', (v) => `${v}°`],
  ['s-scale', 'o-scale', 'renderScale', (v) => `${Math.round(v * 100)}%`],
  ['s-vol', 'o-vol', 'volume', (v) => `${Math.round(v * 100)}%`],
  ['s-vguns', 'o-vguns', 'volGuns', (v) => `${Math.round(v * 100)}%`],
  ['s-vsteps', 'o-vsteps', 'volSteps', (v) => `${Math.round(v * 100)}%`],
  ['s-vworld', 'o-vworld', 'volWorld', (v) => `${Math.round(v * 100)}%`],
  ['s-vmusic', 'o-vmusic', 'volMusic', (v) => `${Math.round(v * 100)}%`],
  ['s-vvoice', 'o-vvoice', 'volVoice', (v) => `${Math.round(v * 100)}%`],
  ['s-vchat', 'o-vchat', 'volChat', (v) => `${Math.round(v * 100)}%`],
];
const CHECKS = [
  ['s-invert', 'invertY'], ['s-aimtoggle', 'aimToggle'], ['s-crouchtoggle', 'crouchToggle'], ['s-sprinttoggle', 'sprintToggle'],
  ['s-shadows', 'shadows'], ['s-fps', 'showFps'], ['s-assist', 'aimAssist'],
];

for (const [sid, oid, key, fmt] of SLIDERS) {
  const s = $(sid);
  s.addEventListener('input', () => {
    settings[key] = Number(s.value);
    $(oid).textContent = fmt(settings[key]);
    saveSettings();
    game.applySettings();
  });
}
$('s-voicemode').addEventListener('change', () => {
  settings.voiceMode = $('s-voicemode').value;
  saveSettings();
  game.applySettings();
});
for (const [cid, key] of CHECKS) {
  $(cid).addEventListener('change', () => {
    settings[key] = $(cid).checked;
    saveSettings();
    game.applySettings();
  });
}

function openSettings() {
  for (const [sid, oid, key, fmt] of SLIDERS) {
    $(sid).value = settings[key];
    $(oid).textContent = fmt(Number(settings[key]));
  }
  $('s-touchmode').value = settings.touchMode || 'auto';
  $('s-voicemode').value = settings.voiceMode || 'push';
  for (const [cid, key] of CHECKS) $(cid).checked = !!settings[key];
  renderBinds();
  $('pause').hidden = true;
  $('settings').hidden = false;
  input.unlock();
}

function closeSettings() {
  input.cancelCapture();
  $('settings').hidden = true;
  if (game.inRoom) resume();
}

document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === t));
  document.querySelectorAll('.tab-body').forEach((b) => { b.hidden = b.dataset.body !== t.dataset.tab; });
}));
$('btn-settings').addEventListener('click', openSettings);
// the touch controls: how they show, and moving them about
$('s-touchmode').addEventListener('change', () => {
  settings.touchMode = $('s-touchmode').value;
  saveSettings();
  input.setTouch(touchWanted());
});
$('btn-touch-reset').addEventListener('click', () => { touch.resetLayout(); uiBlip(); });
$('btn-touch-edit').addEventListener('click', () => {
  uiBlip();
  $('settings').hidden = true;
  touch.edit(true);
});
const endTouchEdit = () => {
  touch.edit(false);
  uiBlip();
  $('settings').hidden = false;
};
$('tc-done').addEventListener('click', endTouchEdit);
$('tc-reset').addEventListener('click', () => { touch.resetLayout(); uiBlip(); });
$('s-touchscale').addEventListener('input', () => touch.layout());
$('btn-settings-close').addEventListener('click', closeSettings);
$('btn-reset-binds').addEventListener('click', () => {
  resetBinds();
  renderBinds();
});

// -- patch notes -----------------------------------------------------------------

function renderNotes() {
  $('notes-body').innerHTML = PATCH_NOTES.map((r, i) => `
    <section class="note-release${i ? ' older' : ''}">
      <div class="note-head"><span class="note-ver">v${r.version}</span><span class="note-date">${r.date}</span></div>
      <div class="note-title">${esc(r.title)}</div>
      <ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
    </section>`).join('');
}

function openNotes() {
  renderNotes();
  $('pause').hidden = true;
  $('notes').hidden = false;
  input.unlock();
}

$('btn-notes').addEventListener('click', openNotes);
// -- bug reports: a name and a description, kept on the server for the owner to read --
$('btn-bug').addEventListener('click', () => {
  uiBlip();
  $('bug-name').value = $('bug-name').value || currentName();
  $('bug-hint').textContent = '';
  $('bug-send').disabled = false;
  $('bugpanel').hidden = false;
  $('bug-text').focus();
});
$('bug-close').addEventListener('click', () => { $('bugpanel').hidden = true; });
$('bug-send').addEventListener('click', () => {
  const name = $('bug-name').value.trim();
  const text = $('bug-text').value.trim();
  if (!name) { $('bug-hint').textContent = 'Put your name in first.'; return; }
  if (text.length < 5) { $('bug-hint').textContent = 'Describe the bug: what happened and where.'; return; }
  if (status !== 'online') { $('bug-hint').textContent = 'Not connected to the server right now. Try again in a moment.'; return; }
  sayHello();
  net.send({ t: 'bug', name, text });
  $('bug-send').disabled = true;
  $('bug-hint').textContent = 'Sending…';
});
function onBugOk(m) {
  if (m.ok) {
    $('bug-text').value = '';
    $('bugpanel').hidden = true;
    toast('Thanks. Your report is in: an agent will fix it for the next patch.');
  } else {
    $('bug-send').disabled = false;
    $('bug-hint').textContent = m.m || 'Could not send that.';
  }
}
$('btn-notes-close').addEventListener('click', () => {
  $('notes').hidden = true;
  unlockAudio();
  if (game.inRoom) resume();
  else $('name').focus();
});

$('btn-loadout').addEventListener('click', openLoadout);

// -- locker -------------------------------------------------------------------------

function showLocker() {
  $('pause').hidden = true;
  input.unlock();
  openLocker(() => {
    game.refreshCosmetics();
    if (game.inRoom) resume();
  }, (ld) => pickLoadout(ld));
}

// -- accounts ----------------------------------------------------------------------

function showAccount(user) {
  const name = user ? user.username : null;
  if (name === shownUser) return;
  const renamed = !!(name && shownUser);      // signed in already, so this is a new username
  shownUser = name;
  $('name-field').hidden = !!user;
  $('signed-in').hidden = !user;
  $('btn-signin').hidden = !!user;
  $('btn-signup').hidden = !!user;
  $('btn-signout').hidden = !user;
  $('btn-account').hidden = !user;
  if (user) {
    $('si-name').textContent = user.username;
    toast(renamed ? `Your username is now ${user.username}` : `Signed in as ${user.username}`);
  }
  sayHello();
}
auth.onChange(showAccount);
auth.onChange((user) => game.setAdmin(!!user && String(user.username || '').toLowerCase() === 'mcb'));
$('btn-signin').addEventListener('click', () => auth.open('login'));
$('btn-signup').addEventListener('click', () => auth.open('signup'));
$('btn-account').addEventListener('click', () => auth.openAccount());
window.addEventListener('souk-toast', (e) => toast(e.detail));
$('btn-signout').addEventListener('click', () => {
  auth.signOut();
  toast('Signed out — your guest locker is back');
});
// skins you change mid-match show on your gun straight away
locker.onChange(() => { if (game.inRoom && !lockerOpen()) game.refreshCosmetics(); });
$('btn-locker').addEventListener('click', showLocker);
$('btn-pause-locker').addEventListener('click', showLocker);
const dinarsEl = $('menu-dinars');
const showDinars = () => { dinarsEl.textContent = locker.dinars; };
locker.onChange(showDinars);
showDinars();
// testing on this Mac only: ?demo=signup fills in and sends the sign-up form
if (location.hostname === 'localhost' && params.get('demo') === 'signup') {
  const log = (s) => fetch('/__log?m=' + encodeURIComponent('[demo] ' + s));
  setTimeout(() => {
    $('notes').hidden = true;
    auth.open('signup');
    const u = 'demo' + Math.floor(Math.random() * 1e6);
    $('auth-user').value = u;
    $('auth-email').value = u + '@example.com';
    $('auth-pass').value = 'short';
    $('auth-form').requestSubmit();
    setTimeout(() => {
      log(`short password message: "${$('auth-err').textContent}"`);
      log('CAPTURE autherr');
      $('auth-pass').value = 'a long enough password';
      $('auth-form').requestSubmit();
      setTimeout(() => {
        log(`after sign-up: modal ${$('auth').hidden ? 'closed' : 'open'}, menu shows "${$('si-name').textContent}", locker says "${locker.signedIn ? 'account' : 'guest'}" with ${locker.dinars} dinars`);
        log('CAPTURE signedin');
        showLocker();
        setTimeout(() => {
          document.getElementById('crate-bazaar').click();
          setTimeout(() => { log(`bazaar opened, now ${locker.dinars} dinars`); log('CAPTURE bazaar'); }, 7000);
        }, 800);
      }, 2500);
    }, 800);
  }, 1500);
}
// testing on this Mac only: ?demo=stability signs in, opens the locker, scrolls, and counts redraws
if (location.hostname === 'localhost' && params.get('demo') === 'stability') {
  const log = (s) => fetch('/__log?m=' + encodeURIComponent('[stable] ' + s));
  setTimeout(() => {
    $('notes').hidden = true;
    const u = 'stab' + Math.floor(Math.random() * 1e6);
    net.send({ t: 'signup', username: u, email: u + '@example.com', password: 'a long enough password', guest: locker.guestData() });
    setTimeout(() => {
      const firstMode = document.querySelector('#modes .mode');
      let hellos = 0;
      const origSend = net.send.bind(net);
      net.send = (msg) => { if (msg.t === 'hello' || msg.t === 'resume') hellos++; origSend(msg); };
      showLocker();
      setTimeout(() => {
        const panel = document.querySelector('.locker-panel');
        panel.scrollTop = 400;
        const before = panel.scrollTop;
        let rebuilds = 0;
        new MutationObserver(() => rebuilds++).observe($('lk-content'), { childList: true });
        setTimeout(() => {
          log(`signed in: ${auth.user ? auth.user.username : 'no'}; hello/resume messages in 6 s: ${hellos}; locker redraws: ${rebuilds}; scroll ${before} -> ${panel.scrollTop}; same mode button: ${document.querySelector('#modes .mode') === firstMode}`);
          log('CAPTURE stable');
        }, 6000);
      }, 800);
    }, 2500);
  }, 1500);
}
// the owner's own locker, set up from a private link
if (params.get('unlock') === 'mcb-souk-7k2p9') {
  locker.grant(1000, 500000, true);
  history.replaceState(null, '', location.pathname);
}
// testing on this Mac only: ?dinars=500 tops up the locker
if (location.hostname === 'localhost' && params.get('dinars')) locker.earn(Number(params.get('dinars')) || 0);
// ?kills=120 and ?fit=optic:scope6,mag:large set up an SMG for a look
if (LOCAL && params.has('kills')) locker.setKills('smg', Number(params.get('kills')) || 0);
if (LOCAL && params.has('fit')) {
  for (const part of params.get('fit').split(',')) {
    const [slot, id] = part.split(':');
    if (slot && id) locker.setAttach('smg', slot.trim(), id.trim());
  }
}
// ?killtest feeds a kill event through, to check kills with a gun are counted
if (LOCAL && params.has('killtest')) {
  setTimeout(() => {
    const before = locker.killsWith('smg');
    game.onEvent({ e: 'kill', k: game.myId, v: game.myId + 1, w: 'smg', hs: 0, vn: 'Bot' });
    game.onEvent({ e: 'kill', k: game.myId, v: game.myId + 1, w: 'sniper', hs: 0, vn: 'Bot' });
    game.onEvent({ e: 'kill', k: game.myId + 1, v: game.myId, w: 'smg', hs: 0, vn: 'Me' });
    fetch('/__log?m=' + encodeURIComponent(`[killtest] smg kills ${before} -> ${locker.killsWith('smg')} (one SMG kill of mine, one sniper kill, one death)`));
  }, 3000);
}
// ?attachui clicks through the attachment tiles and reports what happened
if (LOCAL && params.has('attachui')) {
  const log = (s) => fetch('/__log?m=' + encodeURIComponent('[attachui] ' + s));
  $('notes').hidden = true;
  showLocker();
  setTimeout(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const pane = document.querySelector('.locker-panel');
    const tiles = () => [...document.querySelectorAll('.at')];
    log(`tiles ${tiles().length}, locked ${tiles().filter((b) => b.disabled).length}`);
    const target = tiles().find((b) => !b.disabled && !b.classList.contains('on'));
    pane.scrollTop = pane.scrollHeight;
    const before = pane.scrollTop;
    target.click();
    await sleep(250);
    log(`clicked ${target.querySelector('.at-name').textContent}: fitted now ${JSON.stringify(locker.attachFor('smg'))}, scroll ${before} -> ${pane.scrollTop}`);
    const locked = tiles().find((b) => b.disabled);
    if (locked) { locked.click(); await sleep(150); log(`locked tile click changed nothing: ${JSON.stringify(locker.attachFor('smg'))}`); }
    log('done');
  }, 700);
}
// ?touchmode=on|off|auto sets the on-screen controls for this visit (for checking a build)
if (LOCAL && params.get('touchmode')) { settings.touchMode = params.get('touchmode'); input.setTouch(touchWanted()); }
// ?peek=<outfit> shows an outfit in the locker's preview and posts pictures of it to the server
// ?peek=gun:<weapon>:<finish>[:sahur] shows a gun the same way, with the Sahur suppressor if asked
if (LOCAL && params.get('peek')) {
  const id = params.get('peek');
  $('notes').hidden = true;
  showLocker();
  if (id.startsWith('gun:')) {
    const [, w, f, ms] = id.split(':');
    const fitted = { ...locker.attachFor(w), muzzle: ms ? 'suppressor' : undefined, muzzleStyle: ms || '' };
    setTimeout(() => {
      previewGun(w, f || null, fitted, Math.PI * 0.5);
      setTimeout(() => { previewShot(`${w}-${f || 'plain'}${ms ? '-' + ms : ''}-a`); previewGun(w, f || null, fitted, Math.PI * 1.15); setTimeout(() => { previewShot(`${w}-${f || 'plain'}${ms ? '-' + ms : ''}-b`); fetch('/__log?m=' + encodeURIComponent('[peek] done')); }, 400); }, 1500);
    }, 900);
  } else {
    locker.grantOutfit(id);
    setTimeout(() => {
      previewOutfit(id, Math.PI);
      setTimeout(() => { previewShot(id + '-front'); previewOutfit(id, Math.PI * 0.6); setTimeout(() => { previewShot(id + '-side'); fetch('/__log?m=' + encodeURIComponent('[peek] done')); }, 400); }, 1500);
    }, 900);
  }
}
// ?locker opens the locker straight away (for checking a build); ?crate=gun|outfit also spins one
if (LOCAL && (params.has('locker') || params.has('crate'))) {
  $('notes').hidden = true;
  showLocker();
  if (params.get('crate')) setTimeout(() => document.getElementById(params.get('crate') === 'outfit' ? 'crate-outfit' : 'crate-gun').click(), 600);
}

// -- toast --------------------------------------------------------------------

let toastT = null;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { el.hidden = true; }, 2600);
}

// -- boot -----------------------------------------------------------------------

$('version').textContent = `v${VERSION}`;
$('pause-version').textContent = `Souk Siege v${VERSION}`;
if (MIRROR) {
  $('mirror-note').hidden = false;
  $('mirror-note-fly').hidden = false;     // the Render copy only: everyone is moving to Fly
}
$('name').value = settings.name || '';
$('name').addEventListener('change', () => {
  settings.name = currentName();
  saveSettings();
  sayHello();
});
$('name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('name').blur();
});
renderModes();
renderRooms();
game.applySettings();
// the patch notes open on every visit (not when a test link opens the locker)
if (!LOCAL || (!params.has('locker') && !params.has('crate') && !params.has('demo'))) openNotes();

// -- autotest ---------------------------------------------------------------------
// A scripted run through the controls, reporting to the server log. Only with ?autotest=<mode>.
if (AUTOTEST) {
  const log = (m) => fetch('/__log?m=' + encodeURIComponent('[autotest] ' + m));
  const faceNearest = () => {
    let best = null;
    for (const a of game.avatars.map.values()) {
      if (!a.alive) continue;
      const d = a.pos.distanceTo(game.me.pos);
      if (!best || d < best.d) best = { a, d };
    }
    if (best) {
      const dx = best.a.pos.x - game.me.pos.x, dz = best.a.pos.z - game.me.pos.z;
      game.me.yaw = Math.atan2(-dx, -dz);
      game.me.pitch = -0.02;
    }
  };
  const crateSteps = [
    [1.5, () => { game.me.pitch = -0.35; game.me.weapons.primary.reserve = 10; input.tap('KeyX'); }],
    [2.6, () => log(`ammo crate: crates ${game.crates.size}, spare ammo ${game.me.weapons.primary.reserve}/${game.me.weapons.primary.def.reserve}`)],
    [2.7, () => log('CAPTURE crate')],
  ];
  const beaconSteps = [
    [1.0, () => pickLoadout(3)],
    [2.2, () => { game.me.pitch = -0.3; input.tap('KeyX'); }],
    [5.0, () => log(`beacon: placed ${game.beacons.size}, enemies revealed ${[...game.avatars.map.values()].filter((a) => a.revealT > 0).length}`)],
    [5.1, () => log('CAPTURE beacon')],
    [5.6, () => { pickLoadout(0); }],
    [7.0, () => { input.tap('KeyX'); }],
    [7.9, () => log(`ammo crate: crates ${game.crates.size}`)],
    [8.0, () => log('CAPTURE crate')],
  ];
  const gearSteps = [
    [2.0, () => { me.pitch = -0.12; }],
    [3.0, () => log('CAPTURE gear')],
    [3.2, () => { me.yaw += Math.PI; }],
    [4.2, () => log('CAPTURE gearback')],
  ];
  const aimSteps = [
    [2.0, faceNearest],
    [2.6, () => input.tap('Mouse2')],
    [3.2, () => log('CAPTURE scoped')],
    [3.45, () => log('CAPTURE firing')],
    [3.4, () => { faceNearest(); input.hold('Mouse0', true); }],
    [3.6, () => input.hold('Mouse0', false)],
    [4.6, () => { faceNearest(); input.hold('Mouse0', true); }],
    [5.4, () => input.hold('Mouse0', false)],
    [6.0, () => input.tap('Mouse2')],
    [6.5, () => { faceNearest(); input.hold('Mouse0', true); }],
    [7.5, () => input.hold('Mouse0', false)],
  ];
  const sprintAimSteps = [
    [1.0, () => { input.hold('ShiftLeft', true); input.hold('KeyW', true); }],
    [1.8, () => log(`running ${game.me.sprinting}`)],
    [2.0, () => input.hold('KeyF', true)],
    [2.6, () => { log(`holding F: running ${game.me.sprinting} aim ${game.me.adsK.toFixed(2)} fov ${game.camera.fov.toFixed(1)} scoped ${game.vm.scoped}`); log('CAPTURE sixx'); }],
    [3.0, () => input.hold('KeyF', false)],
    [3.6, () => log(`let go of F: running ${game.me.sprinting} aim ${game.me.adsK.toFixed(2)}`)],
    [3.8, () => { input.hold('ShiftLeft', false); input.hold('KeyW', false); }],
  ];
  aimSteps.sort((a, b) => a[0] - b[0]);
  if (params.get('script') === 'sprintaim') aimSteps.splice(0, aimSteps.length, ...sprintAimSteps);
  if (params.get('script') === 'gear') aimSteps.splice(0, aimSteps.length, ...gearSteps);
  if (params.get('script') === 'beacon') aimSteps.splice(0, aimSteps.length, ...beaconSteps);
  if (params.get('script') === 'crate') aimSteps.splice(0, aimSteps.length, ...crateSteps);
  const steps = ['v2', 'attach', 'v22', 'views', 'derby', 'looks', 'turret', 'streaks', 'skywatch', 'launcher', 'voice', 'b2', 'jets'].includes(params.get('script')) ? [] : ['aim', 'sprintaim', 'gear', 'beacon', 'crate'].includes(params.get('script')) ? aimSteps : ([
    [0.5, () => input.hold('KeyW', true)],
    [2.5, () => { input.hold('KeyW', false); input.look(300, 0); }],
    [3.0, () => input.hold('Mouse0', true)],
    [4.2, () => { input.hold('Mouse0', false); log(`after spray: bloom ${game.weapon().bloom.toFixed(2)} mag ${game.weapon().mag}`); }],
    [4.6, () => input.tap('Mouse2')],
    [5.2, () => { log(`aim ${game.me.adsK.toFixed(2)} fov ${game.camera.fov.toFixed(1)}`); input.hold('Mouse0', true); }],
    [5.8, () => input.hold('Mouse0', false)],
    [6.0, () => input.tap('Mouse2')],
    [6.4, () => input.tap('KeyR')],
    [6.5, () => log(`reloading ${game.weapon().reloading}`)],
    [9.5, () => { log(`after reload mag ${game.weapon().mag}/${game.weapon().reserve}`); input.tap('Digit2'); }],
    [10.3, () => { input.tap('Mouse0'); log(`slot ${game.me.slot}`); }],
    [10.8, () => input.tap('Mouse0')],
    [11.2, () => input.tap('KeyG')],
    [12.0, () => input.hold('KeyC', true)],
    [12.8, () => { log(`crouch ${game.me.crouchK.toFixed(2)}`); input.hold('KeyC', false); input.tap('Space'); }],
    [13.0, () => log(`jump vy ${game.me.vel.y.toFixed(2)} y ${game.me.pos.y.toFixed(2)}`)],
    [14.0, () => { input.tap('Digit1'); input.hold('KeyD', true); }],
    [15.0, () => { input.hold('KeyD', false); input.tap('Mouse2'); }],
  ]);
  let t0 = null;
  let i = 0;
  const tick = () => {
    requestAnimationFrame(tick);
    if (!game.me.alive) return;
    if (t0 === null) { t0 = performance.now() / 1000; log(`spawned at ${game.me.pos.x.toFixed(1)},${game.me.pos.z.toFixed(1)} team ${game.me.team}`); }
    const t = performance.now() / 1000 - t0;
    while (i < steps.length && t >= steps[i][0]) steps[i++][1]();
  };
  tick();
  setInterval(() => {
    const g = game.g;
    log(`smgkills ${locker.killsWith('smg')} phase ${g && g.ph} n ${g && g.n} pos ${game.me.pos.x.toFixed(1)},${game.me.pos.y.toFixed(2)},${game.me.pos.z.toFixed(1)} hp ${game.me.hp} alive ${game.me.alive} others ${game.avatars.map.size} vm ${game.vm.curId} root ${game.vm.root.visible} vis ${game.vm.visible} scoped ${game.vm.scoped} gpos ${game.vm.cur && game.vm.cur.group.position.toArray().map((v) => v.toFixed(2))} pend ${game.vm.pending} sw ${game.vm.switchT.toFixed(2)} nade ${game.vm.nadeAnim.toFixed(2)}`);
  }, 4000);
  window.__souk = game;
  if (params.get('script') === 'v2') runV2();
  if (params.get('script') === 'royale') runRoyale();
  if (params.get('script') === 'views') {
    (async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const snap = (s) => {
        log(s);
        if (s.startsWith('CAPTURE ')) {
          try { fetch('/__shot?n=' + encodeURIComponent(s.slice(8)), { method: 'POST', body: canvas.toDataURL('image/jpeg', 0.72) }); } catch (e) { /* no picture */ }
        }
      };
      while (!game.me.alive || !game.map) await sleep(200);
      await sleep(1500);
      await takeViews(snap);
      log('views done');
    })();
  }
  if (params.get('script') === 'attach') runAttach();
  if (params.get('script') === 'derby') runDerby();
  if (params.get('script') === 'turret') runTurret();
  if (params.get('script') === 'streaks') runStreaks();
  if (params.get('script') === 'skywatch') runSkywatch();
  if (params.get('script') === 'launcher') runLauncher();
  if (params.get('script') === 'voice') runVoice();
  if (params.get('script') === 'b2') runB2();
  if (params.get('script') === 'jets') runJets();
  if (params.get('script') === 'looks') runLooks();
  if (params.get('script') === 'v22') runV22();
  if (params.get('equip')) {
    const [w, f] = params.get('equip').split(':');
    locker.equipGun(w, f);
  }
}

// ?views=x,y,z,yaw,pitch[,1];... stands at each spot in turn and takes a picture (1: with
// the map open). 'b:' views are relative to the first walk-through building found (its
// stair opening on the roof marks it); a y of 'r' means on its roof.
async function takeViews(log) {
  const views = params.get('views');
  if (!views) return;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const me = game.me;
  let i = 0;
  let B = null;
  const caps = game.map.boxes.filter((b) => b[7] === 'flatroof' && Math.abs(b[4] - 0.05) < 0.01 && b[1] < 40 && Math.abs(b[3] - 1.8) < 0.01 && Math.abs(b[0]) < 96 && Math.abs(b[2]) < 80);
  for (const b of caps) {
    const other = caps.find((o) => o !== b && Math.abs(o[0] - b[0]) < 0.01 && Math.abs(o[1] - b[1]) < 0.01 && Math.abs(o[2] - b[2]) > 1);
    if (other) { B = { x: b[0], z: (b[2] + other[2]) / 2, roof: b[1] + b[4] }; break; }
  }
  log(`building for views: ${JSON.stringify(B)}`);
  for (const v of views.split(';')) {
    const rel = v.startsWith('b:');
    const parts = (rel ? v.slice(2) : v).split(',');
    const [x, , z, yaw, pitch, key] = parts.map(Number);
    const y = parts[1] === 'r' ? (B ? B.roof + 0.2 : 2) : Number(parts[1]);
    if (rel && !B) continue;
    me.pos.set(rel ? B.x + x : x, y, rel ? B.z + z : z);
    me.vel.set(0, 0, 0);
    me.yaw = yaw;
    me.pitch = pitch;
    if (key) input.tap('KeyM');
    await sleep(900);
    log(`CAPTURE view${i}`);
    log(`view${i} at ${me.pos.toArray().map((q) => q.toFixed(1))} grounded ${me.grounded} lamps ${(game.world.lamps || []).length} lit ${(game.world.pool || []).filter((l) => l.visible).length}`);
    if (key) input.tap('KeyM');
    i++;
  }
}

// -- the Derby run: seated on the grid, a lap's worth of driving, a grenade, pictures --
async function runDerby() {
  const log = (s) => {
    fetch('/__log?m=' + encodeURIComponent('[derby] ' + s));
    if (s.startsWith('CAPTURE ')) {
      try { fetch('/__shot?n=' + encodeURIComponent(s.slice(8)), { method: 'POST', body: canvas.toDataURL('image/jpeg', 0.72) }); } catch (e) { /* no picture */ }
    }
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const me = game.me;
  if (params.get('cart')) { locker.grant(0, 0, true); locker.equipCart(params.get('cart')); game.refreshCosmetics(); }
  while (!game.driving) await sleep(200);
  const F = () => game.forklifts.get(game.driving);
  log(`seated: cart ${game.driving} at ${F().pos.toArray().map((v) => v.toFixed(1))} yaw ${F().yaw.toFixed(2)} cam ${game.camera.position.toArray().map((v) => v.toFixed(1))} skin ${F().skin || 'factory'}`);
  await sleep(800);
  log('CAPTURE derby-grid');
  await sleep(Number(params.get('wait') || 0) * 1000);
  input.hold('KeyW', true);
  await sleep(2500);
  log(`after 2.5 s: speed ${F().speed.toFixed(1)} at ${F().pos.toArray().map((v) => v.toFixed(1))} lap ${JSON.stringify(game.lap && { u: game.lap.u, laps: game.lap.laps })}`);
  log('CAPTURE derby-straight');
  // steer round the track: aim at a point a little way along the centre line
  const T = game.map.track;
  const t0 = performance.now();
  let shots = 0;
  while (performance.now() - t0 < 40000) {
    const c = F();
    if (!c) break;
    let bi = 0, bd = Infinity;
    for (let i = 0; i < T.length; i++) { const d = (T[i][0] - c.pos.x) ** 2 + (T[i][1] - c.pos.z) ** 2; if (d < bd) { bd = d; bi = i; } }
    const tgt = T[(bi + 6) % T.length];
    const want = Math.atan2(-(tgt[1] - c.pos.z), tgt[0] - c.pos.x);
    let dy = want - c.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    input.hold('KeyA', dy > 0.06);
    input.hold('KeyD', dy < -0.06);
    const el = (performance.now() - t0) / 1000;
    if (shots === 0 && el > 6) { shots++; log('CAPTURE derby-corner'); }
    if (shots === 1 && el > 12) { shots++; input.tap('KeyG'); log(`grenade: ${me.nades} left`); }
    if (shots === 2 && el > 12.6) { shots++; log('CAPTURE derby-grenade'); }
    await sleep(30);
  }
  input.hold('KeyW', false); input.hold('KeyA', false); input.hold('KeyD', false);
  log(`after the drive: at ${F() && F().pos.toArray().map((v) => v.toFixed(1))} lap ${JSON.stringify(game.lap && { u: game.lap.u, laps: game.lap.laps, best: game.lap.best })} label ${game.derbyLabel()} alive ${me.alive}`);
  log('CAPTURE derby-end');
  log('derby done');
}

// -- the Interceptor's Gatling: signed in as the owner on a test server, man the turret and fire --
async function runTurret() {
  const log = (s) => {
    fetch('/__log?m=' + encodeURIComponent('[turret] ' + s));
    if (s.startsWith('CAPTURE ')) {
      try { fetch('/__shot?n=' + encodeURIComponent(s.slice(8)), { method: 'POST', body: canvas.toDataURL('image/jpeg', 0.72) }); } catch (e) { /* no picture */ }
    }
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const me = game.me;
  while (!game.driving) await sleep(200);
  net.send({ t: 'login', id: params.get('user'), password: params.get('pw') });
  while (!locker.signedIn) await sleep(200);
  locker.equipCart('interceptor');
  game.refreshCosmetics();
  const F = () => game.forklifts.get(game.driving);
  while (F().skin !== 'interceptor') await sleep(100);
  await sleep(800);
  log(`in the Interceptor: turret ${!!F().mesh.userData.turret} can ${game.canTurret()}`);
  log('CAPTURE turret-seat');
  input.tap('KeyI');
  await sleep(300);
  log(`after I: turret ${game.turret} cam ${game.camera.position.toArray().map((v) => v.toFixed(2))}`);
  input.tap('KeyU');
  await sleep(300);
  log(`after U: armour ${game.armour} walls shown ${F().mesh.userData.armour.visible}`);
  me.yaw += 2.4;
  me.pitch = 0.1;
  await sleep(500);
  log('CAPTURE turret-view');
  me.pitch = -1.2;
  await sleep(200);
  log(`aimed down: pitch clamped to ${me.pitch.toFixed(2)}`);
  me.pitch = 0.02;
  input.hold('Mouse0', true);
  await sleep(900);
  log('CAPTURE turret-firing');
  await sleep(300);
  input.hold('Mouse0', false);
  log(`fired: spin ${game.turretSpin.toFixed(2)}`);
  input.tap('KeyI');
  await sleep(300);
  log(`after I again: turret ${game.turret} overlay hidden ${document.getElementById('turretcam').hidden}`);
  me.yaw = F().yaw - Math.PI / 2;
  me.pitch = -0.05;
  await sleep(400);
  log('CAPTURE armour-seat');
  log('turret done');
}

// -- scorestreaks: on a server started with SOUK_STREAK_FREE=1, call each one in and look --
async function runStreaks() {
  const log = (s) => {
    fetch('/__log?m=' + encodeURIComponent('[streaks] ' + s));
    if (s.startsWith('CAPTURE ')) {
      try { fetch('/__shot?n=' + encodeURIComponent(s.slice(8)), { method: 'POST', body: canvas.toDataURL('image/jpeg', 0.72) }); } catch (e) { /* no picture */ }
    }
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const me = game.me;
  while (!game.me.alive || !game.map) await sleep(200);
  while (!game.g || game.g.ph !== 'live') await sleep(200);
  await sleep(1200);
  log(`have ${JSON.stringify(me.streaks)} streak ${me.streak} panel hidden ${document.getElementById('streaks').hidden}`);
  log('CAPTURE streaks-panel');
  input.tap('Digit4');
  await sleep(800);
  log(`scan: have ${JSON.stringify(me.streaks)}`);
  input.tap('Digit5');
  await sleep(1500);
  log(`heli: gunner ${!!game.gunner} helis ${game.helis.size} pos ${me.pos.toArray().map((v) => v.toFixed(1))} cam ${game.camera.position.toArray().map((v) => v.toFixed(1))} overlay hidden ${document.getElementById('turretcam').hidden}`);
  log('CAPTURE heli-seat');
  me.pitch = -0.55;
  await sleep(300);
  log('CAPTURE heli-look-down');
  input.hold('Mouse0', true);
  await sleep(1200);
  log('CAPTURE heli-firing');
  await sleep(6500);
  log(`heat ${game.gunner && game.gunner.heat.toFixed(2)} hot ${game.gunner && game.gunner.hot}`);
  log('CAPTURE heli-hot');
  input.hold('Mouse0', false);
  me.yaw += 1.2;
  await sleep(500);
  log(`swing clamped: yaw ${me.yaw.toFixed(2)}`);
  log('CAPTURE heli-swung');
  while (game.gunner) await sleep(200);
  await sleep(400);
  log(`down: pos ${me.pos.toArray().map((v) => v.toFixed(1))} alive ${me.alive} overlay hidden ${document.getElementById('turretcam').hidden}`);
  log('CAPTURE heli-back-down');
  input.tap('Digit6');
  await sleep(800);
  log(`strike pick ${!!game.strikePick} overlay hidden ${document.getElementById('strikecam').hidden} cam ${game.camera.position.toArray().map((v) => v.toFixed(1))}`);
  log('CAPTURE strike-cam');
  input.look(260, 120);
  await sleep(500);
  log(`reticle at ${game.strikePick && [game.strikePick.x.toFixed(1), game.strikePick.y.toFixed(1), game.strikePick.z.toFixed(1)]}`);
  log('CAPTURE strike-cam-moved');
  const target = game.strikePick && { x: game.strikePick.x, y: game.strikePick.y, z: game.strikePick.z };
  input.tap('Mouse0');
  await sleep(600);
  log(`called: pick ${!!game.strikePick} strikes ${game.strikes.size}`);
  // look at the smoke
  const lookAt = (x, y, z) => {
    const dx = x - me.pos.x, dy = y - (me.pos.y + 1.6), dz = z - me.pos.z;
    me.yaw = Math.atan2(-dx, -dz);
    me.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  };
  if (target) lookAt(target.x, target.y + 2, target.z);
  await sleep(1500);
  log('CAPTURE strike-smoke');
  // the bombers: look up at the lead as they come over
  const S = [...game.strikes.values()][0];
  for (let i = 0; i < 3; i++) {
    await sleep(1500);
    if (S) { const L = S.show.leadAt(game.clock - S.t0, THREE_V()); lookAt(L.x, L.y, L.z); await sleep(100); log(`jets at ${L.toArray().map((v) => v.toFixed(0))} visible ${S.show.planes[0].m.visible}`); log(`CAPTURE strike-bombers-${i}`); }
  }
  if (target) lookAt(target.x, target.y + 1, target.z);
  const until = S ? S.t0 + 10.3 : game.clock + 3;
  while (game.clock < until) await sleep(50);
  log('CAPTURE strike-boom');
  await sleep(700);
  log('CAPTURE strike-boom-2');
  log('streaks done');
}

// -- the grenade launcher: bring it up, aim it, fire it, and look at the round going off --
async function runLauncher() {
  const log = (s) => {
    fetch('/__log?m=' + encodeURIComponent('[launcher] ' + s));
    if (s.startsWith('CAPTURE ')) {
      try { fetch('/__shot?n=' + encodeURIComponent(s.slice(8)), { method: 'POST', body: canvas.toDataURL('image/jpeg', 0.72) }); } catch (e) { /* no picture */ }
    }
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const me = game.me;
  while (!game.me.alive || !game.map) await sleep(200);
  while (!game.g || game.g.ph !== 'live') await sleep(200);
  await sleep(1000);
  log(`loadout ${me.loadout} perk ${locker.perkFor(me.loadout)} launcher ${!!(me.weapons && me.weapons.launcher)} nades ${me.nades}`);
  while (game.vm.busySwitching) await sleep(100);
  input.tap('KeyX');
  for (let i = 0; i < 40 && game.vm.curId !== 'launcher'; i++) await sleep(100);
  while (game.vm.busySwitching) await sleep(100);
  log(`slot ${me.slot} vm ${game.vm.curId} mag ${game.weapon() && game.weapon().mag}`);
  me.pitch = -0.08;
  log('CAPTURE launcher-hip');
  input.tap('Mouse2');
  await sleep(700);
  log(`aim ${me.adsK.toFixed(2)}`);
  log('CAPTURE launcher-ads');
  input.tap('Mouse0');
  await sleep(250);
  log(`fired: nades ${me.nades} in flight ${game.fx.nades.length}`);
  log('CAPTURE launcher-shot');
  await sleep(1200);
  log(`after: nades ${me.nades} in flight ${game.fx.nades.length}`);
  log('CAPTURE launcher-boom');
  input.tap('Mouse2');
  input.tap('KeyX');
  await sleep(900);
  log(`put away: slot ${me.slot} vm ${game.vm.curId}`);
  log('launcher done');
}

// -- a look at the jet, parked in the sky close by ------------------------------------
async function runB2() {
  const log = (s) => {
    fetch('/__log?m=' + encodeURIComponent('[b2] ' + s));
    if (s.startsWith('CAPTURE ')) {
      try { fetch('/__shot?n=' + encodeURIComponent(s.slice(8)), { method: 'POST', body: canvas.toDataURL('image/jpeg', 0.72) }); } catch (e) { /* no picture */ }
    }
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  while (!game.me.alive || !game.map) await sleep(200);
  await sleep(800);
  const { makeJet, poseJet } = await import('./streaks.js');
  const me = game.me;
  for (const [i, [dx, dy, dz]] of [[0, 14, -26], [24, 10, -14], [-8, 30, 6]].entries()) {
    const b = makeJet();
    poseJet(b, 1.3);
    b.position.set(me.pos.x + dx, me.pos.y + dy, me.pos.z + dz);
    b.rotation.set(0, 0.8, 0);
    game.scene.add(b);
    const ox = b.position.x - me.pos.x, oy = b.position.y - (me.pos.y + 1.6), oz = b.position.z - me.pos.z;
    me.yaw = Math.atan2(-ox, -oz);
    me.pitch = Math.atan2(oy, Math.hypot(ox, oz));
    await sleep(500);
    log(`CAPTURE b2-${i}`);
    game.scene.remove(b);
  }
  log('b2 done');
}

// -- the airstrike from the ground: call it on a spot ahead and photograph the jets coming over --
async function runJets() {
  const log = (s) => {
    fetch('/__log?m=' + encodeURIComponent('[jets] ' + s));
    if (s.startsWith('CAPTURE ')) {
      try { fetch('/__shot?n=' + encodeURIComponent(s.slice(8)), { method: 'POST', body: canvas.toDataURL('image/jpeg', 0.72) }); } catch (e) { /* no picture */ }
    }
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const me = game.me;
  const lookAt = (x, y, z) => {
    const dx = x - me.pos.x, dy = y - (me.pos.y + 1.6), dz = z - me.pos.z;
    me.yaw = Math.atan2(-dx, -dz);
    me.pitch = Math.max(-1.5, Math.min(1.5, Math.atan2(dy, Math.hypot(dx, dz))));
  };
  while (!game.me.alive || !game.map || !game.g || game.g.ph !== 'live') await sleep(200);
  await sleep(1500);
  const tx = me.pos.x + 30, tz = me.pos.z;
  game.useStreak('strike', { p: [+tx.toFixed(2), +me.pos.y.toFixed(2), +tz.toFixed(2)] });
  log(`called strike at ${tx.toFixed(1)},${tz.toFixed(1)}`);
  const t0 = performance.now();
  let n = 0, S = null, boom = false;
  while (performance.now() - t0 < 14000) {
    await sleep(120);
    S = S || [...game.strikes.values()][0];
    if (!S) continue;
    const t = game.clock - S.t0;
    const L = S.show.lead;
    if (S.show.planes[0].m.visible && n < 8 && t > 1.2 + n * 0.8) {
      lookAt(L.x, L.y, L.z);
      await sleep(150);
      log(`t=${t.toFixed(2)} lead ${L.x.toFixed(0)},${L.y.toFixed(0)},${L.z.toFixed(0)} dist ${L.distanceTo(me.pos).toFixed(0)} yaw ${S.show.yaw.toFixed(2)} bank ${(S.show.bank * 180 / Math.PI).toFixed(0)} bombs ${S.show.bombs.filter((b) => b.mesh).length} shake ${(game.fx.shake || 0).toFixed(2)}`);
      log(`CAPTURE jets-${n}`);
      n++;
    }
    if (t > 5.2 && !boom) { boom = true; lookAt(tx, me.pos.y + 1, tz); await sleep(200); log('CAPTURE jets-boom'); }
  }
  log(`jets done ${S ? 'show done ' + S.show.done : 'no strike'}`);
}

// -- voice chat: two of these, with Chrome's fake microphone, stand next to each other and listen --
async function runVoice() {
  const log = (s) => fetch('/__log?m=' + encodeURIComponent('[voice] ' + s));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  settings.voiceMode = 'open';
  while (!game.me.alive || !game.map) await sleep(200);
  game.voice.applySettings();
  while (!game.g || game.g.ph !== 'live') await sleep(200);     // the match start respawns everyone: move after it
  await sleep(1000);
  // headless Chrome's fake microphone is silent: speak with a made-up voice instead
  while (game.voice.mic === 'asking') await sleep(100);
  const synth = sfxModule.synthVoice();
  if (synth) { game.voice.replaceMic(synth); log('speaking with a synthesised voice'); }
  await sleep(1500);
  log(`mic ${game.voice.mic} on ${game.voice.on} peers ${game.voice.peers.size}`);
  // the newer player walks over to stand next to the other, well inside earshot
  for (let i = 0; i < 100; i++) {
    const a = [...game.avatars.map.values()].find((x) => x.id !== game.myId);
    if (a && game.myId > a.id) { game.me.pos.set(a.pos.x + 2, a.pos.y, a.pos.z); log(`moved next to ${a.id}`); break; }
    if (a) break;
    await sleep(200);
  }
  let meter = null;
  for (let i = 0; i < 12; i++) {
    await sleep(1000);
    if (!meter && game.voice.stream) meter = sfxModule.streamMeter(game.voice.stream);
    const mine = meter ? meter.level().toFixed(2) : '?';
    const tr = game.voice.stream && game.voice.stream.getAudioTracks()[0];
    if (i === 2 || i === 8) log(`audio ${sfxModule.audioState()} track ${tr ? `${tr.label} enabled ${tr.enabled} muted ${tr.muted} ${tr.readyState}` : 'none'}`);
    // the newer player steps back: twenty metres at t5 (fainter), forty at t8 (gone)
    const other = [...game.avatars.map.values()].find((x) => x.id !== game.myId);
    if (other && game.myId > other.id && (i === 5 || i === 8)) { game.me.pos.set(other.pos.x + (i === 5 ? 20 : 40), other.pos.y, other.pos.z); log(`stepped back to ${i === 5 ? 20 : 40} m`); }
    // at t9, pretend the older player just killed the newer one: the victim keeps talking, only the killer hears, three times louder
    if (other && i === 9 && game.room && game.room.mode === 'ffa') {
      if (game.myId < other.id) { game.voice.killed(other.id); log('pretend: I killed them'); }
      else { game.me.alive = false; game.me.killerId = other.id; game.voice.died(other.id); log('pretend: they killed me'); }
    }
    const rows = [...game.voice.peers.values()].map((P) => { const a = game.avatars.get(P.id); return `${P.id}:${P.pc.connectionState}/${P.pc.iceConnectionState} dist ${a ? a.pos.distanceTo(game.me.pos).toFixed(1) : '?'} gain ${P.gain.toFixed(2)} level ${P.sink ? P.sink.level().toFixed(2) : 'none'}`; });
    log(`t${i} mic ${game.voice.mic} mine ${mine} talking ${game.voice.talking} peers [${rows.join(' | ')}]`);
  }
  log('voice done');
}

// -- from the ground: a second player who watches the sky and takes pictures of what goes over --
async function runSkywatch() {
  const log = (s) => {
    fetch('/__log?m=' + encodeURIComponent('[skywatch] ' + s));
    if (s.startsWith('CAPTURE ')) {
      try { fetch('/__shot?n=' + encodeURIComponent(s.slice(8)), { method: 'POST', body: canvas.toDataURL('image/jpeg', 0.72) }); } catch (e) { /* no picture */ }
    }
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const me = game.me;
  const lookAt = (x, y, z) => {
    const dx = x - me.pos.x, dy = y - (me.pos.y + 1.6), dz = z - me.pos.z;
    me.yaw = Math.atan2(-dx, -dz);
    me.pitch = Math.max(-1.5, Math.min(1.5, Math.atan2(dy, Math.hypot(dx, dz))));
  };
  while (!game.me.alive || !game.map) await sleep(200);
  let heliShots = 0, strikeShots = 0, boomShot = false;
  const t0 = performance.now();
  while (performance.now() - t0 < 150000) {
    await sleep(100);
    const H = [...game.helis.values()][0];
    if (H && heliShots < 3) {
      lookAt(H.mesh.position.x, H.mesh.position.y, H.mesh.position.z);
      await sleep(150);
      heliShots++;
      log(`heli seen at ${H.mesh.position.toArray().map((v) => v.toFixed(0))} dist ${H.mesh.position.distanceTo(me.pos).toFixed(0)}`);
      log(`CAPTURE ground-heli-${heliShots}`);
      await sleep(2500);
    }
    const S = [...game.strikes.values()][0];
    if (S) {
      const t = game.clock - S.t0;
      if (t > 1 && strikeShots === 0) { strikeShots++; lookAt(S.p.x, S.p.y + 1, S.p.z); await sleep(150); log('CAPTURE ground-strike-marker'); }
      if (t > 5.5 && t < 8 && strikeShots === 1) { strikeShots++; const L = S.show.leadAt(t, THREE_V()); lookAt(L.x, L.y, L.z); await sleep(150); log(`CAPTURE ground-bombers`); }
      if (t > 10.2 && !boomShot) { boomShot = true; lookAt(S.p.x, S.p.y + 1, S.p.z); await sleep(200); log('CAPTURE ground-boom'); }
    }
  }
  log('skywatch done');
}

// -- pictures of the new things: every cart skin, and an outfit ------------------------
async function runLooks() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = (s) => fetch('/__log?m=' + encodeURIComponent('[looks] ' + s));
  while (!game.map) await sleep(200);
  const { openLocker: open } = await import('./lockerui.js');
  open(() => {}, () => {});
  await sleep(500);
  const { CARTS } = await import('./skins.js');
  const ui = await import('./lockerui.js');
  for (const id of (params.get('carts') || CARTS.map((c) => c.id).join(',')).split(',')) {
    ui.previewCart(id, Number(params.get('turn') || 2.3), !!params.get('armour'));
    await sleep(350);
    ui.previewShot('cart-' + id);
    await sleep(150);
  }
  for (const id of (params.get('outfits') || 'guccimorty').split(',')) {
    previewOutfit(id, Math.PI);
    await sleep(500);
    previewShot('outfit-' + id);
    previewOutfit(id, Math.PI * 1.25);
    await sleep(400);
    previewShot('outfit-' + id + '-side');
    previewOutfit(id, Math.PI, true);
    await sleep(400);
    previewShot('outfit-' + id + '-face');
    previewOutfit(id, Math.PI * 1.3, true);
    await sleep(400);
    previewShot('outfit-' + id + '-face34');
  }
  log('looks done');
}

// -- the royale run: the plane, the drop, a chest, what fell out, a vest ------------
async function runRoyale() {
  const log = (s) => {
    fetch('/__log?m=' + encodeURIComponent('[royale] ' + s));
    if (s.startsWith('CAPTURE ')) {
      try { fetch('/__shot?n=' + encodeURIComponent(s.slice(8)), { method: 'POST', body: canvas.toDataURL('image/jpeg', 0.72) }); } catch (e) { /* no picture */ }
    }
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const me = game.me;
  while (!game.br || !game.map) await sleep(200);
  log(`in: chests ${game.chestMeshes.size} boxes ${game.map.boxes.length} bounds ${game.map.bounds}`);
  while (!me.aboard) await sleep(200);
  log(`aboard: plane ${JSON.stringify(game.br.plane && game.br.plane.a)} -> ${JSON.stringify(game.br.plane && game.br.plane.b)} cam ${game.camera.position.toArray().map((v) => v.toFixed(1))}`);
  await sleep(1500);
  {
    // forward, towards the flight deck, then back towards the ramp
    const d = game.br.plane.dir, L = Math.hypot(d[0], d[1]) || 1;
    me.yaw = Math.atan2(-d[0] / L, -d[1] / L);
    me.pitch = 0;
    await sleep(400);
    log('CAPTURE aboard');
    me.yaw += Math.PI;
    await sleep(400);
    log('CAPTURE aboard-back');
    me.pitch = -0.5;
    await sleep(400);
    log('CAPTURE aboard-deck');
  }
  const T = await import('three');
  const pp = new T.Vector3();
  while (me.aboard && !(game.planePos(pp) && game.overMap(pp.x, pp.z))) await sleep(100);
  await sleep(2500);
  log('CAPTURE aboard-over');
  input.tap('Space');
  await sleep(400);
  log(`jumped: aboard ${me.aboard} falling ${!!me.falling} pos ${me.pos.toArray().map((v) => v.toFixed(1))}`);
  me.pitch = -0.6;
  input.hold('KeyW', true);
  await sleep(1500);
  log('CAPTURE falling');
  input.hold('KeyW', false);
  me.pitch = -1.2;
  while (me.falling && !me.falling.chute) await sleep(100);
  log(`chute at y ${me.pos.y.toFixed(1)}`);
  me.pitch = 0;
  await sleep(300);
  log('CAPTURE chute');
  while (me.falling) await sleep(100);
  log(`landed at ${me.pos.toArray().map((v) => v.toFixed(1))} grounded ${me.grounded}`);
  await sleep(500);
  log('CAPTURE landed');
  await takeViews(log);
  // the nearest chests in turn: stand by one, open it, take what is worth taking, until a gun is in hand
  const chests = [...game.chestMeshes.entries()].map(([id, C]) => ({ id, C, d: Math.hypot(C.x - me.pos.x, C.z - me.pos.z) })).sort((a, b) => a.d - b.d);
  let shot = false;
  for (const best of chests.slice(0, 8)) {
    if (best.C.open) continue;
    me.pos.set(best.C.x + 1.2, best.C.y + 0.02, best.C.z);
    me.vel.set(0, 0, 0);
    me.yaw = Math.atan2(-(best.C.x - me.pos.x), -(best.C.z - me.pos.z));
    me.pitch = -0.35;
    await sleep(700);
    log(`by chest ${best.id}: prompt ${game.brPrompt && game.brPrompt.text}`);
    if (!shot) log('CAPTURE chest');
    input.tap('KeyE');
    await sleep(700);
    log(`opened: items ${game.itemMeshes.size} prompt ${game.brPrompt && game.brPrompt.text} inv ${JSON.stringify(game.br.items)} ammo ${JSON.stringify(game.br.ammo)} vests ${game.br.vests} nades ${me.nades} ${me.nadeKind} perk ${game.br.perk}`);
    if (!shot) log('CAPTURE opened');
    shot = true;
    for (let k = 0; k < 3 && game.brPrompt; k++) { input.tap('KeyE'); await sleep(500); }
    if (game.br.items.primary || game.br.items.pistol) break;
  }
  log(`took: slot ${me.slot} weapons ${Object.keys(me.weapons).filter((k) => me.weapons[k]).map((k) => me.weapons[k].id + ' ' + me.weapons[k].mag + '/' + me.weapons[k].reserve)} vm ${game.vm.curId} items left ${game.itemMeshes.size} skins ${JSON.stringify(game.brSkins())}`);
  me.pitch = 0;
  await sleep(600);
  log('CAPTURE gun');
  while (game.vm.busySwitching) await sleep(100);
  input.hold('Mouse0', true);
  await sleep(350);
  log('CAPTURE firing');
  input.hold('Mouse0', false);
  await sleep(300);
  log(`fired: ${game.weapon() && game.weapon().id} mag ${game.weapon() && game.weapon().mag}`);
  input.tap('KeyR');
  await sleep(3000);
  log(`reloaded: mag ${game.weapon() && game.weapon().mag} reserve ${game.weapon() && game.weapon().reserve} pool ${JSON.stringify(game.br.ammo)}`);
  if (game.br.vests > 0) { input.tap('KeyH'); await sleep(1200); log('CAPTURE vest'); await sleep(1800); log(`vest: shield ${game.br.shield} spare ${game.br.vests}`); }
  me.pitch = -0.3;
  input.tap('KeyM');
  await sleep(500);
  log('CAPTURE map');
  input.tap('KeyM');
  // the gas wall: look away from the middle of the circle
  const gs = game.br.gas;
  if (gs) { const dx = me.pos.x - gs.c[0], dz = me.pos.z - gs.c[1]; me.yaw = Math.atan2(-dx, -dz); me.pitch = 0.1; }
  await sleep(500);
  log('CAPTURE gas');
  log(`gas ${JSON.stringify(gs)} alive ${game.g && game.g.al} shield ${game.br.shield}`);
  log('royale done');
}

// -- the 2.2 run: tunnels, the knife, the map and every gun's attachments -----------
async function runV22() {
  const log = (s) => fetch('/__log?m=' + encodeURIComponent('[v22] ' + s));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const me = game.me;
  while (!me.alive || !game.map) await sleep(200);
  await sleep(900);
  const tun = game.map.tunnels;
  log(`tunnels: ${tun ? tun.hatches.length : 0} hatches, ${tun ? tun.pits.length : 0} pits, floor ${tun && tun.floor}`);

  // 1. drop through a hatch, walk the tunnel, climb back out
  if (tun && tun.hatches.length) {
    const [hx, hz] = tun.hatches[0];
    me.pos.set(hx, 0.2, hz);
    me.vel.set(0, 0, 0);
    me.yaw = 0;
    me.pitch = 0;
    await sleep(2400);
    log(`dropped in: y ${me.pos.y.toFixed(2)} grounded ${me.grounded} floorAt ${game.world.physics.floorAt(me.pos.x, me.pos.z)}`);
    log('CAPTURE tunnel-floor');
    await sleep(900);
    // walk along the longest corridor, well clear of the ladder
    const long = tun.pits.slice().sort((a, b) => ((b[2] - b[0]) * (b[3] - b[1])) - ((a[2] - a[0]) * (a[3] - a[1])))[0];
    const alongX = (long[2] - long[0]) > (long[3] - long[1]);
    const cx = alongX ? long[0] + 2 : (long[0] + long[2]) / 2;
    const cz = alongX ? (long[1] + long[3]) / 2 : long[1] + 2;
    me.pos.set(cx, tun.floor + 0.1, cz);
    me.vel.set(0, 0, 0);
    me.yaw = alongX ? -Math.PI / 2 : Math.PI;     // -z is forward at yaw 0
    await sleep(400);
    const before = { x: me.pos.x, z: me.pos.z };
    input.hold('KeyW', true);
    await sleep(1600);
    input.hold('KeyW', false);
    await sleep(200);
    log(`walked ${Math.hypot(me.pos.x - before.x, me.pos.z - before.z).toFixed(1)} m along the tunnel to ${me.pos.x.toFixed(1)},${me.pos.y.toFixed(2)},${me.pos.z.toFixed(1)} (still under: ${me.pos.y < -3})`);
    // and into the end wall: it should stop us, not push us up
    me.yaw += Math.PI;
    input.hold('KeyW', true);
    await sleep(2200);
    input.hold('KeyW', false);
    await sleep(200);
    log(`after walking into the far wall: y ${me.pos.y.toFixed(2)} at ${me.pos.x.toFixed(1)},${me.pos.z.toFixed(1)}`);
    log('CAPTURE tunnel-walk');
    // back to the ladder and up
    me.pos.set(hx - 0.55, tun.floor + 0.1, hz);
    me.vel.set(0, 0, 0);
    me.yaw = -Math.PI / 2;
    await sleep(300);
    input.hold('KeyW', true);
    await sleep(2600);
    input.hold('KeyW', false);
    log(`climbed out: y ${me.pos.y.toFixed(2)} climbing ${me.climbing}`);
    log('CAPTURE tunnel-climb');
  }

  // 2. the knife
  input.tap('Digit3');
  await sleep(700);
  if (game.weapon().id !== 'knife') { input.tap('KeyV'); await sleep(700); }
  log(`knife out: ${game.weapon().id}, mag ${game.weapon().mag}, vm ${game.vm.curId}, bind ${settings.binds.melee}/${settings.alt.melee}, slot ${game.me.slot}, have ${Object.keys(game.me.weapons)}`);
  log('CAPTURE knife');
  await sleep(1200);
  input.hold('Mouse0', true);
  await sleep(500);
  input.hold('Mouse0', false);
  log('CAPTURE knife-swing');
  input.tap('Digit1');
  await sleep(500);

  // 3. the whole map
  input.tap('KeyM');
  await sleep(600);
  {
    const fm = document.getElementById('fullmap');
    const cs = getComputedStyle(fm);
    const c = document.getElementById('fullmap-canvas');
    const r = c.getBoundingClientRect();
    const px = c.getContext('2d').getImageData(450, 450, 1, 1).data;
    const px2 = c.getContext('2d').getImageData(60, 60, 1, 1).data;
    log(`map open: hidden ${fm.hidden} display ${cs.display} rect ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} centrePx ${[...px]} cornerPx ${[...px2]} hudDisp ${getComputedStyle(document.getElementById('hud')).display}`);
  }
  log('CAPTURE fullmap');
  await sleep(1500);
  input.tap('KeyM');
  await sleep(300);

  // 4. every gun's attachments
  for (const w of ['lmg', 'shotgun', 'sniper', 'pistol']) locker.setKills(w, 500);
  const shots = [
    [1, 'lmg', { optic: 'acog', muzzle: 'longbrake', mag: 'large' }],
    [2, 'shotgun', { optic: 'holo', ammo: 'slug', mag: 'small', muzzle: 'suppressor' }],
    [3, 'sniper', { optic: 'acog', muzzle: 'suppressor', mag: 'ext' }],
  ];
  for (const [ld, w, fit] of shots) {
    for (const slot in fit) locker.setAttach(w, slot, fit[slot]);
    pickLoadout(ld);
    game.applyLoadout(ld);
    await sleep(700);
    const d = game.weapon().def;
    log(`${w}: sight ${d.sight} zoom ${d.zoom} mag ${d.mag} reload ${d.reload} quiet ${!!d.quiet} slug ${!!d.slug} pellets ${d.pellets} dmg ${d.dmg} move ${d.moveMul}`);
    input.hold('KeyF', true);
    await sleep(800);
    log(`CAPTURE ${w}-ads`);
    input.hold('KeyF', false);
    await sleep(300);
  }
  // the pistol, with the lot
  for (const [slot, id] of Object.entries({ optic: 'reddot', muzzle: 'suppressor', mag: 'drum', trigger: 'auto' })) locker.setAttach('pistol', slot, id);
  game.applyLoadout(0);
  await sleep(500);
  input.tap('Digit2');
  await sleep(700);
  const pd = game.weapon().def;
  log(`pistol: sight ${pd.sight} mag ${pd.mag} reload ${pd.reload} auto ${!!pd.auto} quiet ${!!pd.quiet} move ${pd.moveMul} spread ${pd.base}`);
  input.hold('KeyF', true);
  await sleep(800);
  log('CAPTURE pistol-ads');
  await sleep(900);
  input.hold('KeyF', false);
  log('v22 done');
}

// -- the SMG attachment run: every optic, muzzle and magazine ----------------------------
// Only with ?autotest=<mode>&script=attach.
async function runAttach() {
  const log = (s) => fetch('/__log?m=' + encodeURIComponent('[attach] ' + s));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const me = game.me;
  const fit = (slot, id) => { locker.setAttach('smg', slot, id); game.applyLoadout(0); };
  const def = () => me.weapons.primary.def;
  while (!me.alive) await sleep(200);
  await sleep(900);
  locker.setKills('smg', 500);
  log(`kills ${locker.killsWith('smg')}, next unlock ${JSON.stringify(nextUnlock('smg', locker.killsWith('smg')))}`);

  // optics: the sight picture at full aim
  for (const o of ['irons', 'reddot', 'holo', 'scope3', 'scope6']) {
    fit('optic', o);
    const d = def();
    input.hold('KeyF', true);
    await sleep(900);
    log(`optic ${o}: sight ${d.sight} zoom ${d.zoom} adsTime ${d.adsTime} aim ${me.adsK.toFixed(2)} fov ${game.camera.fov.toFixed(1)} scoped ${game.vm.scoped}`);
    log(`CAPTURE optic-${o}`);
    await sleep(700);
    input.hold('KeyF', false);
    await sleep(400);
  }
  fit('optic', 'irons');

  // muzzles: flash, sound and the spread/recoil numbers
  for (const mz of ['none', 'hider', 'brake', 'suppressor', 'longbrake']) {
    fit('muzzle', mz);
    const d = def();
    log(`muzzle ${mz}: flash ${d.flash === undefined ? 1 : d.flash} quiet ${!!d.quiet} base ${d.base} bloomMax ${d.bloomMax} recoilUp ${d.recoilUp} kick ${d.kick}`);
    me.weapons.primary.mag = d.mag;
    input.hold('Mouse0', true);
    await sleep(250);
    log(`CAPTURE muzzle-${mz}`);
    await sleep(120);
    input.hold('Mouse0', false);
    await sleep(600);
  }
  fit('muzzle', 'none');

  // magazines: capacity and how long a reload takes
  for (const mg of ['normal', 'fast', 'large']) {
    fit('mag', mg);
    const ws = me.weapons.primary;
    ws.mag = 1;
    ws.reserve = ws.def.reserve;
    const t0 = performance.now();
    input.tap('KeyR');
    await sleep(60);
    while (ws.reloading) await sleep(30);
    log(`mag ${mg}: capacity ${ws.def.mag} reload ${ws.def.reload}s measured ${((performance.now() - t0) / 1000).toFixed(2)}s -> ${ws.mag}/${ws.reserve}`);
    await sleep(300);
  }
  fit('mag', 'normal');
  log('done');
}

// -- the 2.0 feature run: slide, vault, ladder, perks, flash, chat, sights ----------------
// Only runs with ?autotest=<mode>&script=v2. Each check is logged to the server.
async function runV2() {
  const log = (s) => fetch('/__log?m=' + encodeURIComponent('[v2] ' + s));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const g = game;
  const me = g.me;
  const T = await import('three');
  while (!me.alive || !g.world.physics) await sleep(200);
  await sleep(800);
  const phys = g.world.physics;
  const boxes = g.map.boxes;
  const place = (x, y, z, yaw) => {
    me.pos.set(x, y, z);
    me.vel.set(0, 0, 0);
    me.yaw = yaw;
    me.pitch = 0;
    me.crouch = false;
    me.slide = null;
    me.vault = null;
    me.climbing = false;
    me.grounded = true;
  };
  // a windowsill: a wall piece from `base` up to base+1.0, a window above it
  const sills = (base) => boxes.filter((b) => b[7] === 'wall' && Math.abs(b[1] - b[4] - base) < 0.02 && Math.abs(b[1] + b[4] - base - 1.0) < 0.02 &&
    (Math.abs(b[3] - 0.15) < 0.01 || Math.abs(b[5] - 0.15) < 0.01) && Math.max(b[3], b[5]) >= 0.5);
  // stand `d` out from a sill on one side, facing it
  const facing = (b, side, d) => {
    const [cx, , cz, hx, , hz, yaw] = b;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const thinX = Math.abs(hx - 0.15) < 0.01;
    const n = thinX ? [c, -s] : [s, c];
    const px = cx + n[0] * side * d, pz = cz + n[1] * side * d;
    return { x: px, z: pz, yaw: Math.atan2(n[0] * side, n[1] * side), n: [n[0] * side, n[1] * side] };
  };
  const cross = (b, spot, p) => (p.x - b[0]) * spot.n[0] + (p.z - b[2]) * spot.n[1];

  // 1. slide — face somewhere with a clear run first
  let yaw = me.yaw;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const eye = new T.Vector3(me.pos.x, 0.5, me.pos.z);
    if (!phys.raycast(eye, new T.Vector3(-Math.sin(a), 0, -Math.cos(a)), 14)) { yaw = a; break; }
  }
  place(me.pos.x, 0, me.pos.z, yaw);
  input.hold('ShiftLeft', true); input.hold('KeyW', true);
  await sleep(900);
  const before = Math.hypot(me.vel.x, me.vel.z);
  input.tap('KeyC');
  await sleep(120);
  const during = Math.hypot(me.vel.x, me.vel.z);
  log(`slide: running ${before.toFixed(1)} m/s, sliding ${!!me.slide} at ${during.toFixed(1)} m/s, crouched ${me.crouch}`);
  log('CAPTURE slide');
  await sleep(1100);
  input.hold('ShiftLeft', false); input.hold('KeyW', false);
  log(`slide ended: ${!me.slide}, speed ${Math.hypot(me.vel.x, me.vel.z).toFixed(1)}`);

  // 2. vault through a ground-floor window (try a few until one has clear ground both sides)
  let vaulted = false;
  for (const b of sills(0).slice(0, 30)) {
    for (const side of [1, -1]) {
      const spot = facing(b, side, 0.75);
      const pos = new T.Vector3(spot.x, 0.03, spot.z);
      if (!phys.fits(pos, 0.34, 1.8)) continue;
      place(spot.x, 0.03, spot.z, spot.yaw);
      await sleep(250);
      input.tap('Space');
      await sleep(900);
      const after = cross(b, spot, me.pos);
      if (after < -0.2) {
        log(`vault: through a window — started ${cross(b, spot, pos).toFixed(2)} m out, ended ${after.toFixed(2)} m on the far side ✓`);
        vaulted = true;
      } else log(`vault attempt: ended ${after.toFixed(2)} (vault ${!!me.vault}) — trying another window`);
      break;
    }
    if (vaulted) break;
  }
  if (!vaulted) log('vault: FAILED on every window tried');
  log('CAPTURE vault');

  // 3. vault onto a crate
  const crate = boxes.find((b) => b[7] === 'crate' && Math.abs(b[1] - b[4]) < 0.01 && b[1] + b[4] > 0.9 && b[1] + b[4] < 1.3 && b[3] > 0.45 &&
    phys.fits(new T.Vector3(b[0], b[1] + b[4] + 0.02, b[2]), 0.3, 1.0));
  if (crate) {
    let spot = null;
    for (const side of [1, -1]) {
      for (const thin of [[0.15, crate[4], crate[5]], [crate[3], crate[4], 0.15]]) {
        const s = facing([crate[0], crate[1], crate[2], thin[0], thin[1], thin[2], crate[6]], side, (thin[0] === 0.15 ? crate[3] : crate[5]) + 0.6);
        if (!spot && phys.fits(new T.Vector3(s.x, 0, s.z), 0.34, 1.8)) spot = s;
      }
    }
    spot = spot || facing([crate[0], crate[1], crate[2], 0.15, crate[4], crate[5], crate[6]], 1, crate[3] + 0.6);
    place(spot.x, 0, spot.z, spot.yaw);
    await sleep(250);
    log(`crate debug: at ${me.pos.x.toFixed(2)},${me.pos.z.toFixed(2)} grounded ${me.grounded} crate ${crate.map((v) => (typeof v === 'number' ? v.toFixed(2) : v)).join(' ')}`);
    input.tap('Space');
    await sleep(80);
    log(`crate debug: after jump vault ${!!me.vault} vy ${me.vel.y.toFixed(2)} y ${me.pos.y.toFixed(2)}`);
    await sleep(820);
    log(`crate vault: feet at ${me.pos.y.toFixed(2)} (crate top ${(crate[1] + crate[4]).toFixed(2)}) ${me.pos.y > 0.8 ? '✓' : 'FAILED'}`);
  }

  // 4. breacher ladder up to an upstairs window
  locker.setNade(2, 'flash');
  net.send({ t: 'ld', ld: 2, ...locker.picks(2) });
  await sleep(600);
  let laddered = false;
  for (const b of sills(3.2).slice(0, 40)) {
    for (const side of [1, -1]) {
      const spot = facing(b, side, 0.7);
      const pos = new T.Vector3(spot.x, 0, spot.z);
      if (phys.covered(new T.Vector3(spot.x, 1.7, spot.z)) || !phys.fits(pos, 0.34, 1.8)) continue;
      place(spot.x, 0, spot.z, spot.yaw);
      await sleep(300);
      if (me.loadout !== 2) { log('ladder: loadout did not switch to Breacher'); break; }
      const want = g.ladderSpot();
      if (!want) { log('ladder: no wall found'); continue; }
      log(`ladder debug: spot ${want.x.toFixed(2)},${want.z.toFixed(2)} h ${want.h.toFixed(2)}; me ${me.pos.x.toFixed(2)},${me.pos.z.toFixed(2)}; sill ${b.slice(0, 7).map((v) => v.toFixed(2)).join(' ')}`);
      input.tap('KeyX');
      await sleep(500);
      const lad = g.ladders.get(g.myId);
      if (!lad) { log('ladder: not placed'); break; }
      log(`ladder mesh in scene: ${!!lad.mesh.parent}, at ${lad.mesh.position.toArray().map((v) => v.toFixed(1))}, me ${me.pos.toArray().map((v) => v.toFixed(1))}`);
      const back = [me.pos.x, me.pos.z];
      place(me.pos.x + spot.n[0] * 3.5, 0, me.pos.z + spot.n[1] * 3.5, spot.yaw);
      me.pitch = 0.35;
      await sleep(400);
      log('CAPTURE ladder');
      await sleep(200);
      place(back[0], 0, back[1], spot.yaw);
      await sleep(200);
      input.hold('KeyW', true);
      for (let k = 0; k < 8; k++) {
        await sleep(400);
        log(`ladder debug t=${k * 0.4}: pos ${me.pos.x.toFixed(2)},${me.pos.y.toFixed(2)},${me.pos.z.toFixed(2)} climbing ${me.climbing} vault ${!!me.vault} onLadder ${!!g.ladderAt(me.pos)}`);
      }
      input.hold('KeyW', false);
      await sleep(600);
      const inside = cross(b, spot, me.pos);
      log(`ladder: placed; after climbing feet at ${me.pos.y.toFixed(2)}, ${inside.toFixed(2)} m past the wall ${me.pos.y > 3.0 && inside < 0 ? '✓ in through the upstairs window' : 'FAILED'}`);
      laddered = true;
      log('CAPTURE upstairs');
      break;
    }
    if (laddered) break;
  }
  if (!laddered) log('ladder: no suitable upstairs window found');

  // 4b. ladder onto a single-storey roof (over the parapet)
  const parapets = boxes.filter((b) => b[7] === 'wall' && Math.abs(b[1] - b[4] - 3.2) < 0.02 && Math.abs(b[4] - 0.275) < 0.01 &&
    (Math.abs(b[3] - 0.15) < 0.01 || Math.abs(b[5] - 0.15) < 0.01) && Math.max(b[3], b[5]) > 2);
  let roofed = false;
  for (const b of parapets.slice(0, 30)) {
    for (const side of [1, -1]) {
      const spot = facing(b, side, 0.7);
      const pos = new T.Vector3(spot.x, 0, spot.z);
      if (phys.covered(new T.Vector3(spot.x, 1.7, spot.z)) || !phys.fits(pos, 0.34, 1.8)) continue;
      place(spot.x, 0, spot.z, spot.yaw);
      await sleep(300);
      me.perkLeft = 1;
      g.ladders.delete(g.myId);
      const want = g.ladderSpot();
      if (!want) continue;
      g.onLadder({ id: -7, p: [want.x, want.y, want.z], y: want.yaw, h: want.h });
      input.hold('KeyW', true);
      await sleep(3000);
      input.hold('KeyW', false);
      await sleep(500);
      log(`roof ladder: height ${want.h.toFixed(2)} m, feet now at ${me.pos.y.toFixed(2)} ${me.pos.y > 3.1 && me.pos.y < 3.4 ? '✓ on the roof' : 'FAILED'}`);
      log('CAPTURE roof');
      g.onLadder({ id: -7, off: 1 });
      roofed = true;
      break;
    }
    if (roofed) break;
  }
  if (!roofed) log('roof ladder: no single-storey wall found');

  // 5. flashbang at your feet, looking at it
  place(me.pos.x, me.pos.y, me.pos.z, me.yaw);
  me.pitch = -0.9;
  await sleep(200);
  input.tap('KeyG');
  await sleep(3000);
  log(`flash: blinded for ${g.flashMax.toFixed(1)} s (${g.flashMax > 0.5 ? '✓' : 'FAILED'}), health ${me.hp}`);

  // 6. chat
  const n0 = document.getElementById('chat-log').children.length;
  input.tap('Enter');
  await sleep(150);
  const field = document.getElementById('chat-input');
  field.value = 'gg from the autotest';
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sleep(700);
  const lines = document.getElementById('chat-log').children.length;
  log(`chat: box opened and sent, ${lines - n0} new line(s) ${lines > n0 ? '✓' : 'FAILED'}; typing mode off: ${!input.typing}`);
  log('CAPTURE chat');

  // 7. sights: SMG red dot, LMG 2x holo
  for (const [ld, name] of [[0, 'smg'], [1, 'lmg']]) {
    net.send({ t: 'ld', ld, ...locker.picks(ld) });
    await sleep(700);
    place(me.pos.x, me.pos.y, me.pos.z, me.yaw + 0.5);
    input.tap('KeyF');
    input.hold('KeyF', true);
    await sleep(600);
    log(`${name} sight: aim ${me.adsK.toFixed(2)}, fov ${g.camera.fov.toFixed(1)}`);
    log('CAPTURE ' + name);
    await sleep(300);
    input.hold('KeyF', false);
    await sleep(300);
  }
  log('done');
}

// ?range=1&autotest=range : the firing range, one shot at the nearest target
if (LOCAL && params.get('rangetest')) {
  const log = (s) => fetch('/__log?m=' + encodeURIComponent('[range] ' + s));
  setTimeout(async () => {
    $('notes').hidden = true;
    $('menu').hidden = true;
    input.simulate(true);
    game.startRange();
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    await sleep(1500);
    game.me.yaw = 0;
    game.me.pitch = Math.atan2(1.25 - 1.62, 13);
    await sleep(300);
    const cam = game.camera;
    const fwd = new (await import('three')).Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const direct = game.range.raycast(cam.position, fwd, 200);
    log(`straight ray from the eye: ${direct ? `${direct.part} at ${direct.t.toFixed(1)} m` : 'nothing'}`);
    input.hold('KeyF', true);
    await sleep(500);
    input.hold('Mouse0', true);
    await sleep(60);
    input.hold('Mouse0', false);
    await sleep(400);
    input.hold('KeyF', false);
    const s = game.range.stats;
    log(`shot at the 10 m target: shots ${s.shots}, hits ${s.hits} ${s.hits === 1 ? '✓' : 'FAILED'}`);
    log('CAPTURE range');
    input.tap('KeyF');
    input.hold('KeyF', true);
    game.me.pitch = Math.atan2(1.25 - 1.62, 88);
    game.me.yaw = 0;
    await sleep(900);
    log('CAPTURE range2');
    input.hold('KeyF', false);
    const fps = async () => { let n = 0; const t0 = performance.now(); await new Promise((r) => { const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(); }; requestAnimationFrame(f); }); return n / 2; };
    log(`fps with lamps: ${await fps()}`);
    const lamps = [];
    game.scene.traverse((o) => { if (o.isPointLight && o.intensity === 14) lamps.push(o); });
    lamps.forEach((l) => { l.visible = false; });
    await sleep(300);
    log(`fps without lamps (${lamps.length}): ${await fps()}`);
    lamps.forEach((l) => { l.visible = true; });
    game.leave();
    await sleep(1500);
    log(`fps back in the menu: ${await fps()}`);
  }, 1500);
}