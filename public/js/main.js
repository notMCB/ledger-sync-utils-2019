// Menus, settings, patch notes, and wiring the game to the server.

import { Game } from './game.js';
import { Net } from './net.js';
import { input } from './input.js';
import { settings, saveSettings, resetBinds, ACTIONS, keyName } from './settings.js';
import { VERSION, PATCH_NOTES } from './version.js';
import { LOADOUTS, WEAPONS } from './weapons.js';
import { MODE_INFO, esc } from './hud.js';
import { unlockAudio, uiBlip } from './audio.js';
import { locker } from './locker.js';
import { openLocker, lockerOpen } from './lockerui.js';
import { Chat } from './chat.js';
import { auth } from './auth.js';

const $ = (id) => document.getElementById(id);
const canvas = $('view');
input.attach(canvas);

// ?autotest=<mode> joins straight away and drives the controls, for checking a build
const params = new URLSearchParams(location.search);
const AUTOTEST = params.get('autotest');
const MODE_ORDER = ['tdm', 'ffa', 'koth', 'bomb'];
const PHASE_TEXT = { waiting: 'Waiting for players', countdown: 'Starting', live: 'In progress', freeze: 'In progress', post: 'In progress', ended: 'Between matches' };
let rooms = [];
let status = 'connecting';
let deathTimer = null;

const ui = {
  onJoined(room) {
    $('menu').hidden = true;
    hideAll();
    toast(`Joined ${room.name}`);
  },
  onSpawn() {
    $('death').hidden = true;
    clearInterval(deathTimer);
  },
  onPhase() {},
  onRoster() {},
  showDeath(byHtml, respawnAt) {
    $('death-by').innerHTML = byHtml;
    renderLoadouts($('death-loadouts'), true);
    $('death-hint').textContent = input.locked ? 'Press 1–4 to pick a loadout, or Esc to use the mouse' : 'Click a loadout';
    $('death').hidden = false;
    clearInterval(deathTimer);
    const tick = () => {
      if (respawnAt < 0) {
        $('death-timer').textContent = 'You are out for the rest of this round';
        return;
      }
      const s = Math.max(0, respawnAt - performance.now() / 1000);
      $('death-timer').textContent = s > 0.05 ? `Back in ${s.toFixed(1)}s` : 'Respawning…';
    };
    tick();
    deathTimer = setInterval(tick, 100);
    // in bomb mode the dead watch teammates, so get out of the way after a moment
    if (respawnAt < 0) setTimeout(() => { if (!game.me.alive) $('death').hidden = true; }, 4000);
  },
  openLoadout() {
    openLoadout();
  },
};

const game = new Game(canvas, ui);
const net = new Net(onMessage, onStatus);
game.net = net;
const chat = new Chat(net);
chat.canTeam = () => game.isTeamMode() && !game.warmup();
game.chat = chat;
setInterval(() => chat.update(), 500);
auth.init(net);

function onMessage(m) {
  if (auth.onMessage(m)) return;
  if (m.t === 'welcome') {
    game.myId = m.id;
    auth.resume();
    if (!game.inRoom) net.send({ t: 'preview' });
    if (AUTOTEST && !game.inRoom) {
      $('notes').hidden = true;
      net.send({ t: 'join', mode: AUTOTEST, ld: Number(params.get('ld') || 0) });
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
    renderRooms();
    return;
  }
  if (m.t === 'err') {
    toast(m.m);
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

function sayHello() {
  net.setHello({ t: 'hello', name: currentName(), v: VERSION, cos: locker.cosmetics(settings.lastLoadout || 0) });
}

function currentName() {
  return ($('name').value || '').trim() || settings.name || 'Player';
}

// -- menu -----------------------------------------------------------------

function renderModes() {
  const host = $('modes');
  host.innerHTML = '';
  for (const id of MODE_ORDER) {
    const info = MODE_INFO[id];
    const n = rooms.filter((r) => r.mode === id).reduce((a, r) => a + r.n, 0);
    const b = document.createElement('button');
    b.className = 'mode';
    b.disabled = status !== 'online';
    b.innerHTML = `<span class="m-name">${info.name}</span><span class="m-desc">${info.desc}</span>` +
      `<span class="m-meta"><span><span class="m-count">${n}</span> playing</span><span class="m-play">Play →</span></span>`;
    b.addEventListener('click', () => join({ mode: id }));
    host.appendChild(b);
  }
}

function renderRooms() {
  const host = $('rooms');
  host.innerHTML = '';
  const sorted = [...rooms].sort((a, b) => b.n - a.n || MODE_ORDER.indexOf(a.mode) - MODE_ORDER.indexOf(b.mode));
  for (const r of sorted) {
    const b = document.createElement('button');
    const full = r.n >= r.max;
    b.className = 'room' + (full ? ' full' : '');
    b.innerHTML = `<span class="r-name">${esc(r.name)}</span><span class="r-count">${r.n}/${r.max}</span>` +
      `<span class="r-phase${r.ph === 'live' ? ' r-live' : ''}">${PHASE_TEXT[r.ph] || r.ph}</span>`;
    if (!full) b.addEventListener('click', () => join({ room: r.id }));
    host.appendChild(b);
  }
  if (!sorted.length) host.innerHTML = '<p class="browser-note">No servers yet.</p>';
  onStatusCount();
  renderModes();
}

function onStatusCount() {
  if (status !== 'online') return;
  const n = rooms.reduce((a, r) => a + r.n, 0);
  $('status').querySelector('span').textContent = `Online · ${n} playing`;
}

function join(target) {
  unlockAudio();
  uiBlip();
  const name = currentName();
  settings.name = name;
  saveSettings();
  sayHello();
  net.send({ t: 'join', ld: settings.lastLoadout || 0, cos: locker.cosmetics(settings.lastLoadout || 0), ...target });
  input.lock();
}

function showMenu() {
  hideAll();
  $('menu').hidden = false;
  $('hud').hidden = true;
  net.send({ t: 'preview' });
}

function hideAll() {
  for (const id of ['pause', 'settings', 'loadout', 'notes']) $(id).hidden = true;
}

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
  if (game.inRoom) net.send({ t: 'ld', ld: i });
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
  if (!$('loadout').hidden || !$('settings').hidden || !$('notes').hidden || !$('locker').hidden || !$('auth').hidden) return;
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
  if (game.inRoom && !input.locked && $('pause').hidden && $('settings').hidden && $('loadout').hidden) input.lock();
});
$('death').addEventListener('click', (e) => {
  if (e.target.closest('.ld')) return;
  if (game.inRoom && !input.locked) input.lock();
});

// number keys choose a loadout on the death screen
input.onKeyCode = (e) => {
  if (!$('death').hidden && !game.me.alive && /^Digit[1-4]$/.test(e.code)) {
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
  ['s-sens', 'o-sens', 'sens', (v) => v.toFixed(2)],
  ['s-ads', 'o-ads', 'adsSens', (v) => v.toFixed(2)],
  ['s-fov', 'o-fov', 'fov', (v) => `${v}°`],
  ['s-scale', 'o-scale', 'renderScale', (v) => `${Math.round(v * 100)}%`],
  ['s-vol', 'o-vol', 'volume', (v) => `${Math.round(v * 100)}%`],
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
  $('name-field').hidden = !!user;
  $('signed-in').hidden = !user;
  $('btn-signin').hidden = !!user;
  $('btn-signup').hidden = !!user;
  $('btn-signout').hidden = !user;
  if (user) {
    $('si-name').textContent = user.username;
    toast(`Signed in as ${user.username}`);
  }
  sayHello();
}
auth.onChange(showAccount);
$('btn-signin').addEventListener('click', () => auth.open('login'));
$('btn-signup').addEventListener('click', () => auth.open('signup'));
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
// testing on this Mac only: ?dinars=500 tops up the locker
if (location.hostname === 'localhost' && params.get('dinars')) locker.earn(Number(params.get('dinars')) || 0);
// ?locker opens the locker straight away (for checking a build); ?crate=gun|outfit also spins one
if (params.has('locker') || params.has('crate')) {
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
if (!params.has('locker') && !params.has('crate') && !params.has('demo')) openNotes();

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
  const steps = params.get('script') === 'v2' ? [] : ['aim', 'sprintaim'].includes(params.get('script')) ? aimSteps : ([
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
    log(`phase ${g && g.ph} n ${g && g.n} pos ${game.me.pos.x.toFixed(1)},${game.me.pos.y.toFixed(2)},${game.me.pos.z.toFixed(1)} hp ${game.me.hp} alive ${game.me.alive} others ${game.avatars.map.size} vm ${game.vm.curId} root ${game.vm.root.visible} vis ${game.vm.visible} scoped ${game.vm.scoped} gpos ${game.vm.cur && game.vm.cur.group.position.toArray().map((v) => v.toFixed(2))} pend ${game.vm.pending} sw ${game.vm.switchT.toFixed(2)} nade ${game.vm.nadeAnim.toFixed(2)}`);
  }, 4000);
  window.__souk = game;
  if (params.get('script') === 'v2') runV2();
  if (params.get('equip')) {
    const [w, f] = params.get('equip').split(':');
    locker.equipGun(w, f);
  }
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

  // 1. slide
  const open = sills(0)[0];
  place(me.pos.x, 0, me.pos.z, me.yaw);
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
  const crate = boxes.find((b) => b[7] === 'crate' && Math.abs(b[1] - b[4]) < 0.01 && b[1] + b[4] > 0.9 && b[1] + b[4] < 1.3 && b[3] > 0.45);
  if (crate) {
    const spot = facing([crate[0], crate[1], crate[2], 0.15, crate[4], crate[5], crate[6]], 1, crate[3] + 0.6);
    place(spot.x, 0, spot.z, spot.yaw);
    await sleep(250);
    input.tap('Space');
    await sleep(900);
    log(`crate vault: feet at ${me.pos.y.toFixed(2)} (crate top ${(crate[1] + crate[4]).toFixed(2)}) ${me.pos.y > 0.8 ? '✓' : 'FAILED'}`);
  }

  // 4. breacher ladder up to an upstairs window
  locker.setNade(2, 'flash');
  net.send({ t: 'ld', ld: 2 });
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
      await sleep(3200);
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
    net.send({ t: 'ld', ld });
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