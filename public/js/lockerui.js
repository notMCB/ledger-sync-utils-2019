// The Locker screen: crates, the opening reel, loadouts and outfits, and a 3D preview.

import * as THREE from 'three';
import { locker, CRATES, roll } from './locker.js';
import { FINISHES, FINISH, OUTFITS, OUTFIT, RARITY, swatch, tickSkins } from './skins.js';
import { WEAPONS, LOADOUTS, PERKS, NADE_INFO, SECONDARIES, nadesFor } from './weapons.js';
import { buildPreviewGun } from './viewmodel.js';
import { Avatar } from './avatars.js';
import { settings, saveSettings, keyName } from './settings.js';
import { ATTACHMENTS, slotsFor, slotList, nextUnlock } from './attachments.js';
import { beep, uiBlip, unlockAudio } from './audio.js';
import { esc } from './hud.js';

const $ = (id) => document.getElementById(id);

let onClose = null;
let onLoadout = null;
let tab = 'loadouts';
let ldSel = 0;              // the loadout being edited
let selected = null;        // what the preview shows: {kind:'gun', weapon, finish} | {kind:'outfit', outfit}
let preview = null;
let spinning = false;

// -- 3D preview -------------------------------------------------------------------

function setupPreview() {
  if (preview) return preview;
  const canvas = $('locker-preview');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#f3ece0', '#6a5238', 2.2));
  const key = new THREE.DirectionalLight('#fff2dc', 2.4);
  key.position.set(1.5, 2, 2);
  scene.add(key);
  const rim = new THREE.DirectionalLight('#9fc3ff', 1.2);
  rim.position.set(-2, 1, -2);
  scene.add(rim);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
  const holder = new THREE.Group();
  scene.add(holder);
  preview = { renderer, scene, camera, holder, model: null, avatar: null, t: 0, running: false, key: '' };
  return preview;
}

function showModel(sel) {
  const p = setupPreview();
  const key = sel ? JSON.stringify(sel) + (settings.lastLoadout || 0) + (sel.kind === 'gun' ? JSON.stringify(locker.attachFor(sel.weapon)) : '') : '';
  if (key === p.key) return;
  p.key = key;
  if (p.model) {
    p.holder.remove(p.model);
    p.model = null;
  }
  if (!sel) return;
  if (sel.kind === 'gun') {
    const g = buildPreviewGun(sel.weapon, sel.finish, locker.attachFor(sel.weapon));
    const box = new THREE.Box3().setFromObject(g.group);
    g.group.position.sub(box.getCenter(new THREE.Vector3()));
    const wrap = new THREE.Group();
    wrap.add(g.group);
    wrap.scale.setScalar(1.6 / box.getSize(new THREE.Vector3()).length());
    wrap.rotation.set(0.15, Math.PI / 2, 0);
    p.model = wrap;
    p.camera.position.set(0, 0.25, 3.2);
    p.camera.lookAt(0, 0, 0);
  } else {
    if (!p.avatar) {
      p.avatar = new Avatar(0, p.scene);
      p.scene.remove(p.avatar.group);
      p.avatar.setIdentity('', -1);
      p.avatar.setGun('smg');
      p.avatar.tag.visible = false;
    }
    p.avatar.setOutfit(sel.outfit);
    p.avatar.setGear(settings.lastLoadout || 0);
    p.avatar.group.visible = true;
    p.avatar.group.position.set(0, -0.95, 0);
    p.model = p.avatar.group;
    p.camera.position.set(0, 0.35, 5.2);
    p.camera.lookAt(0, 0.05, 0);
  }
  p.holder.add(p.model);
}

// for checking a build on this machine: show an outfit in the preview, turned to
// face the camera, and post the picture to the local server
export function previewOutfit(id, turn = Math.PI) {
  showModel({ kind: 'outfit', outfit: id });
  const p = preview;
  p.t = turn / 0.6;
}
export function previewShot(name) {
  const p = preview;
  if (!p) return;
  p.holder.rotation.y = p.t * 0.6;
  p.renderer.render(p.scene, p.camera);
  fetch('/__shot?n=' + encodeURIComponent(name), { method: 'POST', body: p.renderer.domElement.toDataURL('image/jpeg', 0.8) });
}

function previewLoop() {
  const p = preview;
  if (!p || !p.running) return;
  requestAnimationFrame(previewLoop);
  const canvas = p.renderer.domElement;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (w && h && (canvas.width !== Math.floor(w * devicePixelRatio) || canvas.height !== Math.floor(h * devicePixelRatio))) {
    p.renderer.setPixelRatio(devicePixelRatio);
    p.renderer.setSize(w, h, false);
    p.camera.aspect = w / h;
    p.camera.updateProjectionMatrix();
  }
  p.t += 1 / 60;
  p.holder.rotation.y = p.t * 0.6;
  tickSkins(performance.now() / 1000);
  p.renderer.render(p.scene, p.camera);
}

// -- tiles --------------------------------------------------------------------------

function itemInfo(sel) {
  if (sel.kind === 'gun') {
    const f = FINISH[sel.finish];
    return { name: f.name, sub: WEAPONS[sel.weapon].short, rarity: RARITY[f.rarity], bg: swatch(f) };
  }
  const o = OUTFIT[sel.outfit];
  return { name: o.name, sub: 'Outfit', rarity: RARITY[o.rarity], bg: swatch(o) };
}

function tileHTML(sel, extra = '') {
  const i = itemInfo(sel);
  return `<div class="sk-swatch" style="background:${i.bg}"></div>` +
    `<div class="sk-name">${esc(i.name)}</div><div class="sk-sub">${esc(i.sub)}</div>` +
    `<div class="sk-rarity" style="color:${i.rarity.color}">${i.rarity.name}</div>${extra}` +
    `<i class="sk-bar" style="background:${i.rarity.color}"></i>`;
}

const FACTORY_BG = 'linear-gradient(135deg,#5a5f66 0 55%,#3c3f44 55% 75%,#5b5c55 75%)';
const order = FINISHES.map((f) => f.id);

// a row of finishes you own for one gun, with Factory first
function finishRow(weapon, current, onPick) {
  const wrap = document.createElement('div');
  wrap.className = 'lk-row';
  const owned = locker.gunSkins(weapon).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const mk = (finish) => {
    const b = document.createElement('button');
    const on = (finish || null) === (current || null);
    b.className = 'sk small' + (on ? ' equipped' : '');
    b.innerHTML = finish ? tileHTML({ kind: 'gun', weapon, finish }, on ? '<div class="sk-eq">On</div>' : '')
      : `<div class="sk-swatch" style="background:${FACTORY_BG}"></div><div class="sk-name">Factory</div><div class="sk-sub">${WEAPONS[weapon].short}</div><div class="sk-rarity">Default</div>${on ? '<div class="sk-eq">On</div>' : ''}`;
    b.addEventListener('click', () => {
      onPick(finish);
      selected = { kind: 'gun', weapon, finish };
      showModel(selected);
      uiBlip();
      render();
    });
    b.addEventListener('mouseenter', () => hoverPreview({ kind: 'gun', weapon, finish }));
    return b;
  };
  wrap.appendChild(mk(null));
  for (const f of owned) wrap.appendChild(mk(f));
  if (!owned.length) {
    const hint = document.createElement('div');
    hint.className = 'lk-hint';
    hint.textContent = weapon === 'knife' ? 'Open Blade Crates to find knife finishes.'
      : weapon === 'pistol' ? 'Open Armory Crates or the Bazaar Case to find pistol finishes.'
        : `Open crates to find ${WEAPONS[weapon].short} finishes.`;
    wrap.appendChild(hint);
  }
  return wrap;
}

function section(title, sub) {
  const s = document.createElement('div');
  s.className = 'lk-section';
  s.innerHTML = `<div class="lk-sec-head"><span>${esc(title)}</span><small>${esc(sub || '')}</small></div>`;
  return s;
}

// -- the two tabs -------------------------------------------------------------------

function renderLoadouts(host) {
  const list = document.createElement('div');
  list.className = 'lk-loadouts';
  const inUse = settings.lastLoadout || 0;
  LOADOUTS.forEach((L, i) => {
    const b = document.createElement('button');
    b.className = 'lk-ld' + (i === ldSel ? ' on' : '');
    b.innerHTML = `<span class="ld-title">${L.title}</span><span class="ld-gun">${WEAPONS[locker.primaryFor(i)].name}</span>` +
      `<span class="ld-perk">${PERKS[locker.perkFor(i)].name}</span>${i === inUse ? '<span class="lk-inuse">In use</span>' : ''}`;
    b.addEventListener('click', () => {
      ldSel = i;
      const w = locker.primaryFor(i);
      selected = { kind: 'gun', weapon: w, finish: locker.equippedGun(w) };
      showModel(selected);
      render();
    });
    list.appendChild(b);
  });
  host.appendChild(list);

  const L = LOADOUTS[ldSel];
  const detail = document.createElement('div');
  detail.className = 'lk-detail';
  const head = document.createElement('div');
  head.className = 'lk-detail-head';
  head.innerHTML = `<div><h3>${L.title}</h3><p>${esc(L.blurb)}</p></div>`;
  const use = document.createElement('button');
  use.className = 'btn' + (ldSel === inUse ? ' ghost' : '');
  use.textContent = ldSel === inUse ? 'In use' : 'Use this loadout';
  use.disabled = ldSel === inUse;
  use.addEventListener('click', () => {
    settings.lastLoadout = ldSel;
    saveSettings();
    if (onLoadout) onLoadout(ldSel);
    uiBlip();
    render();
  });
  head.appendChild(use);
  detail.appendChild(head);

  // a choice of guns for some loadouts: buttons like the perk choice
  const gunChooser = (host, ids, cur, onPick) => {
    if (ids.length < 2) return;
    const row = document.createElement('div');
    row.className = 'lk-nades';
    for (const id of ids) {
      const b = document.createElement('button');
      b.className = 'lk-nade' + (id === cur ? ' on' : '');
      b.innerHTML = `<b>${esc(WEAPONS[id].name)}</b><small>${esc(GUN_BLURB[id] || '')}</small>`;
      b.addEventListener('click', () => { onPick(id); uiBlip(); render(); });
      row.appendChild(b);
    }
    host.appendChild(row);
  };
  const primary = locker.primaryFor(L.id);
  const prim = section(`Primary · ${WEAPONS[primary].name}`, L.weapons.length > 1 ? 'Pick a gun, then its skin' : 'Gun skin');
  gunChooser(prim, L.weapons, primary, (id) => {
    locker.setPrimary(L.id, id);
    selected = { kind: 'gun', weapon: id, finish: locker.equippedGun(id) };
    showModel(selected);
  });
  prim.appendChild(finishRow(primary, locker.equippedGun(primary), (f) => locker.equipGun(primary, f)));
  detail.appendChild(prim);
  if (slotsFor(primary).length) attachSection(detail, primary);

  const secondary = locker.secondaryFor(L.id);
  const sec = section(`Secondary · ${WEAPONS[secondary].name}`, 'Pick a sidearm, then its skin for this loadout');
  gunChooser(sec, SECONDARIES, secondary, (id) => locker.setSecondary(L.id, id));
  if (secondary === 'revolver') sec.appendChild(finishRow('revolver', locker.equippedGun('revolver'), (f) => locker.equipGun('revolver', f)));
  else sec.appendChild(finishRow('pistol', locker.equippedPistol(ldSel), (f) => locker.equipPistol(ldSel, f)));
  detail.appendChild(sec);
  // the sidearm is the same gun for every class, so its attachments follow you
  attachSection(detail, secondary, 'The same sidearm for every class — these follow you.');

  const kn = section(`Melee · ${WEAPONS.knife.name}`, `Two hits up close · draw it with ${keyName(settings.binds.melee)}`);
  kn.appendChild(finishRow('knife', locker.equippedGun('knife'), (f) => locker.equipGun('knife', f)));
  detail.appendChild(kn);

  const perkId = locker.perkFor(L.id);
  const perk = PERKS[perkId];
  const pk = section(`Perk · ${perk.name}`, `${perk.uses} per life · use with ${keyName(settings.binds.perk)}`);
  if (L.perks.length > 1) {
    // a choice of perk: pick one
    const prow = document.createElement('div');
    prow.className = 'lk-nades';
    for (const id of L.perks) {
      const b = document.createElement('button');
      const u = PERKS[id].unlock;
      const locked = !locker.perkUnlocked(id);
      b.className = 'lk-nade' + (id === perkId ? ' on' : '') + (locked ? ' locked' : '');
      const small = locked ? `${u.kills} ${WEAPONS[u.weapon].short.toLowerCase()} kills to unlock · you have ${locker.killsWith(u.weapon)}` : `${PERKS[id].uses} per life`;
      b.innerHTML = `<b>${esc(PERKS[id].name)}</b><small>${esc(small)}</small>`;
      if (locked) b.disabled = true;
      else b.addEventListener('click', () => {
        locker.setPerk(L.id, id);
        uiBlip();
        render();
      });
      prow.appendChild(b);
    }
    pk.appendChild(prow);
  }
  const pd = document.createElement('p');
  pd.className = 'lk-perk';
  pd.textContent = perk.blurb;
  pk.appendChild(pd);
  detail.appendChild(pk);

  const kinds = L.nadeKinds || ['frag'];
  const cur = locker.nadeFor(L.id);
  const count = nadesFor(L.id, cur);
  const nd = section('Grenades', `${['', 'One', 'Two', 'Three', 'Four'][count] || count} per life`);
  const row = document.createElement('div');
  row.className = 'lk-nades';
  for (const k of kinds) {
    const b = document.createElement('button');
    b.className = 'lk-nade' + (k === cur ? ' on' : '');
    b.innerHTML = `<b>${esc(NADE_INFO[k].name)}</b><small>${esc(NADE_INFO[k].blurb)}</small>`;
    if (kinds.length > 1) {
      b.addEventListener('click', () => {
        locker.setNade(L.id, k);
        uiBlip();
        render();
      });
    } else b.disabled = true;
    row.appendChild(b);
  }
  if (kinds.length === 1) {
    const note = document.createElement('div');
    note.className = 'lk-hint';
    note.textContent = 'The Medic can carry smoke and the Breacher can carry flash.';
    row.appendChild(note);
  }
  nd.appendChild(row);
  detail.appendChild(nd);
  host.appendChild(detail);
}

// attachments for one gun, with everything you haven't unlocked yet greyed out
const GUN_BLURB = {
  smg: '30 rounds, fast and steady', pdw: '17 rounds gone in under a second. Brutal up close, hopeless at range', carbine: '30 rounds, the all-rounder',
  lmg: '100 rounds, heavy and slow to reload',
  shotgun: 'Pump action, nine pellets a shell', flamer: 'Six metres of fire, 100 fuel at five a second',
  sniper: 'Bolt action, 6× scope, one headshot', heavy: 'One round, one kill, slow and loud',
  pistol: '12 rounds, quick and light', revolver: 'Six rounds, long reach, three to kill',
  smg: '', lmg: '',
};

function attachSection(detail, weapon, note) {
  if (!ATTACHMENTS[weapon]) return;
  const kills = locker.killsWith(weapon);
  const next = nextUnlock(weapon, kills);
  const line = next ? `${kills} kills · ${next.left} more to unlock ${listOf(next.items.map((i) => i.name))}`
    : `${kills} kills · everything unlocked`;
  const at = section(`Attachments · ${WEAPONS[weapon].short}`, note ? `${line} · ${note}` : line);
  const fitted = locker.attachFor(weapon);
  for (const slot of slotsFor(weapon)) {
    const row = document.createElement('div');
    row.className = 'at-row';
    const label = document.createElement('div');
    label.className = 'at-slot';
    label.textContent = slot.name;
    row.appendChild(label);
    const items = document.createElement('div');
    items.className = 'at-items';
    row.appendChild(items);
    for (const a of slotList(weapon, slot.id)) {
      const locked = kills < a.unlock;
      const on = fitted[slot.id] === a.id;
      const b = document.createElement('button');
      b.className = 'at' + (on ? ' on' : '') + (locked ? ' locked' : '');
      b.innerHTML = `<div class="at-name">${esc(a.name)}</div><div class="at-sub">${esc(a.blurb)}</div>` +
        (locked ? `<div class="at-lock">${a.unlock} kills</div>` : on ? '<div class="at-on">Fitted</div>' : '');
      b.disabled = locked;
      if (!locked) {
        b.addEventListener('click', () => {
          locker.setAttach(weapon, slot.id, a.id);
          selected = { kind: 'gun', weapon, finish: locker.equippedGun(weapon) };
          preview.key = '';
          showModel(selected);
          uiBlip();
          render();
        });
      }
      items.appendChild(b);
    }
    at.appendChild(row);
  }
  detail.appendChild(at);
}

function renderOutfits(host) {
  const grid = document.createElement('div');
  grid.className = 'lk-grid';
  const owned = locker.outfits();
  const eq = locker.equippedOutfit();
  const ord = OUTFITS.map((o) => o.id);
  owned.sort((a, b) => ord.indexOf(a) - ord.indexOf(b));
  for (const o of owned) {
    const b = document.createElement('button');
    b.className = 'sk' + (o === eq ? ' equipped' : '');
    b.innerHTML = tileHTML({ kind: 'outfit', outfit: o }, o === eq ? '<div class="sk-eq">Equipped</div>' : '');
    b.addEventListener('click', () => {
      locker.equipOutfit(o);
      selected = { kind: 'outfit', outfit: o };
      showModel(selected);
      uiBlip();
      render();
    });
    b.addEventListener('mouseenter', () => hoverPreview({ kind: 'outfit', outfit: o }));
    grid.appendChild(b);
  }
  host.appendChild(grid);
  const c = document.createElement('div');
  c.className = 'lk-count';
  c.textContent = `${owned.length} of ${OUTFITS.length} outfits collected`;
  host.appendChild(c);
}

// 'a', 'a and b', 'a, b and c'
function listOf(names) {
  if (names.length < 2) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// keep every scroll position when the locker redraws
function scrollState() {
  const panel = document.querySelector('.locker-panel');
  const detail = document.querySelector('.lk-detail');
  const grid = document.querySelector('#lk-content .lk-grid');
  const rows = [...document.querySelectorAll('.lk-row')].map((r) => r.scrollLeft);
  return { panel: panel && panel.scrollTop, detail: detail && detail.scrollTop, grid: grid && grid.scrollTop, rows };
}

function restoreScroll(s) {
  const panel = document.querySelector('.locker-panel');
  const detail = document.querySelector('.lk-detail');
  const grid = document.querySelector('#lk-content .lk-grid');
  if (panel && s.panel != null) panel.scrollTop = s.panel;
  if (detail && s.detail != null) detail.scrollTop = s.detail;
  if (grid && s.grid != null) grid.scrollTop = s.grid;
  document.querySelectorAll('.lk-row').forEach((r, i) => { if (s.rows[i] != null) r.scrollLeft = s.rows[i]; });
}

// hovering a tile previews it — but not while a trackpad scroll is sliding tiles under the cursor
let lastScroll = 0;
let hoverTimer = null;
function hoverPreview(sel) {
  clearTimeout(hoverTimer);
  if (performance.now() - lastScroll < 250) return;
  hoverTimer = setTimeout(() => showModel(sel), 90);
}

function render() {
  const keep = scrollState();
  $('locker-dinars').textContent = locker.dinars;
  for (const k of Object.keys(CRATES)) {
    const b = $('crate-' + k);
    if (b) b.disabled = locker.dinars < CRATES[k].price || spinning;
  }
  document.querySelectorAll('.lk-tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === tab));
  const host = $('lk-content');
  host.innerHTML = '';
  host.className = 'lk-content ' + tab;
  if (tab === 'loadouts') renderLoadouts(host);
  else renderOutfits(host);
  const all = ['smg', 'lmg', 'shotgun', 'sniper', 'pistol', 'knife'].reduce((a, w) => a + locker.gunSkins(w).length, 0);
  $('lk-total').textContent = `${all} of ${locker.totalGunSkins()} gun skins · ${locker.outfits().length} of ${OUTFITS.length} outfits`;
  const accountsOn = !$('account-strip').classList.contains('no-accounts');
  $('lk-account').textContent = locker.signedIn ? 'Saved to your account' : accountsOn ? 'Saved in this browser — sign in to keep it everywhere' : 'Saved in this browser';
  restoreScroll(keep);
}

// -- opening a crate ----------------------------------------------------------------

const TILE_W = 150;
const GAP = 8;
const WIN_AT = 44;

async function openCrate(kind) {
  if (spinning) return;
  unlockAudio();
  spinning = true;
  render();
  const prize = await locker.open(kind);
  if (!prize) {
    spinning = false;
    render();
    return;
  }
  const reel = $('crate-reel');
  const strip = $('crate-strip');
  $('crate-title').textContent = CRATES[kind].name;
  $('crate-result').hidden = true;
  $('crate').hidden = false;
  $('crate').className = 'overlay dim crate-' + kind;
  const items = [];
  for (let i = 0; i < WIN_AT + 6; i++) items.push(i === WIN_AT ? prize : roll(kind));
  strip.style.transition = 'none';
  strip.style.transform = 'translateX(0)';
  strip.innerHTML = items.map((it) => `<div class="sk reel-tile">${tileHTML(it)}</div>`).join('');
  // land somewhere inside the prize tile, not always dead centre
  const jitter = (Math.random() - 0.5) * (TILE_W * 0.7);
  const target = -(WIN_AT * (TILE_W + GAP) + TILE_W / 2 - reel.clientWidth / 2 + jitter);
  void strip.offsetWidth;
  strip.style.transition = 'transform 5.6s cubic-bezier(0.08, 0.62, 0.12, 1)';
  strip.style.transform = `translateX(${target}px)`;
  let last = 0;
  const tick = () => {
    if (!spinning) return;
    const m = new DOMMatrixReadOnly(getComputedStyle(strip).transform);
    const passed = Math.floor((-m.m41 + reel.clientWidth / 2) / (TILE_W + GAP));
    if (passed !== last) {
      last = passed;
      beep(1600, 0.02, 0.12);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    strip.removeEventListener('transitionend', done);
    spinning = false;
    reveal(prize, kind);
    render();
  };
  strip.addEventListener('transitionend', done);
  setTimeout(done, 6200); // in case the transition event never comes
}

function reveal(prize, kind) {
  const i = itemInfo(prize);
  const r = $('crate-result');
  r.hidden = false;
  r.style.setProperty('--rar', i.rarity.color);
  const big = prize.rarity === 'legendary' || prize.rarity === 'epic';
  beep(big ? 880 : 660, 0.25, 0.3);
  setTimeout(() => beep(big ? 1320 : 990, 0.3, 0.3), 140);
  $('crate-prize').innerHTML = `<div class="sk big">${tileHTML(prize)}</div>`;
  $('crate-note').textContent = prize.dup ? `You already had this one — ${prize.refund} dinars back.` : 'New! Added to your locker.';
  const eq = $('crate-equip');
  eq.textContent = prize.kind === 'gun' ? (prize.weapon === 'pistol' ? `Equip on ${LOADOUTS[ldSel].title}` : 'Equip') : 'Wear it';
  eq.onclick = () => {
    if (prize.kind === 'gun') {
      tab = 'loadouts';
      if (prize.weapon === 'pistol') locker.equipPistol(ldSel, prize.finish);
      else {
        locker.equipGun(prize.weapon, prize.finish);
        ldSel = LOADOUTS.findIndex((L) => L.weapon === prize.weapon);
      }
    } else {
      tab = 'outfits';
      locker.equipOutfit(prize.outfit);
    }
    $('crate').hidden = true;
    render();
  };
  const again = $('crate-again');
  again.disabled = locker.dinars < CRATES[kind].price;
  again.textContent = `Open another · ${CRATES[kind].price}`;
  again.onclick = () => openCrate(kind);
  showModel(prize.kind === 'gun' ? { kind: 'gun', weapon: prize.weapon, finish: prize.finish } : { kind: 'outfit', outfit: prize.outfit });
}

// -- open / close ---------------------------------------------------------------------

let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  document.querySelectorAll('.lk-tab').forEach((t) => t.addEventListener('click', () => {
    tab = t.dataset.tab;
    const L = LOADOUTS[ldSel];
    const w = locker.primaryFor(ldSel);
    selected = tab === 'loadouts' ? { kind: 'gun', weapon: w, finish: locker.equippedGun(w) } : { kind: 'outfit', outfit: locker.equippedOutfit() };
    showModel(selected);
    render();
  }));
  for (const k of Object.keys(CRATES)) {
    $('crate-' + k).addEventListener('click', () => openCrate(k));
    const price = $('price-' + k);
    if (price) price.textContent = CRATES[k].price;
  }
  $('crate-back').addEventListener('click', () => { if (!spinning) $('crate').hidden = true; });
  $('locker-close').addEventListener('click', closeLocker);
  $('lk-content').addEventListener('mouseleave', () => { clearTimeout(hoverTimer); showModel(selected); });
  $('locker').addEventListener('wheel', () => { lastScroll = performance.now(); clearTimeout(hoverTimer); }, { passive: true, capture: true });
  locker.onChange(() => { if (!$('locker').hidden && !spinning) render(); });
}

export function openLocker(closeCb, loadoutCb) {
  wire();
  onClose = closeCb;
  onLoadout = loadoutCb;
  ldSel = settings.lastLoadout || 0;
  $('locker').hidden = false;
  const L = LOADOUTS[ldSel];
  selected = tab === 'loadouts' ? { kind: 'gun', weapon: L.weapon, finish: locker.equippedGun(L.weapon) } : { kind: 'outfit', outfit: locker.equippedOutfit() };
  setupPreview();
  preview.key = '';
  showModel(selected);
  preview.running = true;
  previewLoop();
  render();
}

export function lockerOpen() {
  return !$('locker').hidden;
}

function closeLocker() {
  if (spinning) return;
  $('locker').hidden = true;
  $('crate').hidden = true;
  if (preview) preview.running = false;
  if (onClose) onClose();
}
