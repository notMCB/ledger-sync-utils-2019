// The Locker screen: crates, the opening reel, your collection and a 3D preview.

import * as THREE from 'three';
import { locker, CRATE_COST, rollGun, rollOutfit } from './locker.js';
import { FINISHES, FINISH, OUTFITS, OUTFIT, RARITY, GUN_IDS, swatch, tickSkins } from './skins.js';
import { WEAPONS } from './weapons.js';
import { buildPreviewGun } from './viewmodel.js';
import { Avatar } from './avatars.js';
import { beep, uiBlip, unlockAudio } from './audio.js';
import { esc } from './hud.js';

const $ = (id) => document.getElementById(id);

let onClose = null;
let tab = 'guns';
let weapon = 'smg';
let selected = null;       // what the preview shows: {kind, weapon, finish} or {kind:'outfit', outfit}
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
  preview = { renderer, scene, camera, holder, model: null, avatar: null, t: 0, running: false };
  return preview;
}

function showModel(sel) {
  const p = setupPreview();
  if (p.model) {
    p.holder.remove(p.model);
    p.model = null;
  }
  if (!sel) return;
  if (sel.kind === 'gun') {
    const g = buildPreviewGun(sel.weapon, sel.finish);
    const box = new THREE.Box3().setFromObject(g.group);
    const c = box.getCenter(new THREE.Vector3());
    g.group.position.sub(c);
    const wrap = new THREE.Group();
    wrap.add(g.group);
    const size = box.getSize(new THREE.Vector3()).length();
    wrap.scale.setScalar(1.6 / size);
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
    p.avatar.group.visible = true;
    p.avatar.group.position.set(0, -0.95, 0);
    p.model = p.avatar.group;
    p.camera.position.set(0, 0.35, 5.2);
    p.camera.lookAt(0, 0.05, 0);
  }
  p.holder.add(p.model);
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

// -- the collection -----------------------------------------------------------------

function render() {
  $('locker-dinars').textContent = locker.dinars;
  for (const b of document.querySelectorAll('.crate-open')) b.disabled = locker.dinars < CRATE_COST || spinning;
  document.querySelectorAll('.lk-tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === tab));
  $('lk-weapons').hidden = tab !== 'guns';
  const grid = $('lk-grid');
  grid.innerHTML = '';
  if (tab === 'guns') {
    $('lk-weapons').innerHTML = GUN_IDS.map((w) => `<button class="lk-chip${w === weapon ? ' on' : ''}" data-w="${w}">${WEAPONS[w].short}</button>`).join('');
    $('lk-weapons').querySelectorAll('.lk-chip').forEach((b) => b.addEventListener('click', () => {
      weapon = b.dataset.w;
      selected = { kind: 'gun', weapon, finish: locker.equippedGun(weapon) };
      showModel(selected);
      render();
    }));
    const owned = locker.gunSkins(weapon);
    const eq = locker.equippedGun(weapon);
    // factory finish first
    const factory = document.createElement('button');
    factory.className = 'sk' + (!eq ? ' equipped' : '');
    factory.innerHTML = `<div class="sk-swatch" style="background:linear-gradient(135deg,#5a5f66 0 55%,#3c3f44 55% 75%,#5b5c55 75%)"></div>` +
      `<div class="sk-name">Factory</div><div class="sk-sub">${WEAPONS[weapon].short}</div><div class="sk-rarity">Default</div>${!eq ? '<div class="sk-eq">Equipped</div>' : ''}`;
    factory.addEventListener('click', () => equipGun(null));
    factory.addEventListener('mouseenter', () => showModel({ kind: 'gun', weapon, finish: null }));
    grid.appendChild(factory);
    const order = FINISHES.map((f) => f.id);
    owned.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    for (const f of owned) {
      const b = document.createElement('button');
      b.className = 'sk' + (f === eq ? ' equipped' : '');
      b.innerHTML = tileHTML({ kind: 'gun', weapon, finish: f }, f === eq ? '<div class="sk-eq">Equipped</div>' : '');
      b.addEventListener('click', () => equipGun(f));
      b.addEventListener('mouseenter', () => showModel({ kind: 'gun', weapon, finish: f }));
      grid.appendChild(b);
    }
    const all = GUN_IDS.reduce((a, w) => a + locker.gunSkins(w).length, 0);
    $('lk-count').textContent = `${owned.length} of ${FINISHES.length} ${WEAPONS[weapon].short} finishes · ${all} of ${locker.totalGunSkins()} gun skins collected`;
  } else {
    const owned = locker.outfits();
    const eq = locker.equippedOutfit();
    const order = OUTFITS.map((o) => o.id);
    owned.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    for (const o of owned) {
      const b = document.createElement('button');
      b.className = 'sk' + (o === eq ? ' equipped' : '');
      b.innerHTML = tileHTML({ kind: 'outfit', outfit: o }, o === eq ? '<div class="sk-eq">Equipped</div>' : '');
      b.addEventListener('click', () => equipOutfit(o));
      b.addEventListener('mouseenter', () => showModel({ kind: 'outfit', outfit: o }));
      grid.appendChild(b);
    }
    $('lk-count').textContent = `${owned.length} of ${OUTFITS.length} outfits collected`;
  }
}

function equipGun(f) {
  locker.equipGun(weapon, f);
  selected = { kind: 'gun', weapon, finish: f };
  showModel(selected);
  uiBlip();
  render();
}

function equipOutfit(o) {
  locker.equipOutfit(o);
  selected = { kind: 'outfit', outfit: o };
  showModel(selected);
  uiBlip();
  render();
}

// -- opening a crate ----------------------------------------------------------------

const TILE_W = 150;
const GAP = 8;
const WIN_AT = 44;

function openCrate(kind) {
  if (spinning) return;
  unlockAudio();
  const prize = locker.open(kind);
  if (!prize) return;
  spinning = true;
  render();
  const reel = $('crate-reel');
  const strip = $('crate-strip');
  $('crate-title').textContent = kind === 'gun' ? 'Armory Crate' : 'Wardrobe Crate';
  $('crate-result').hidden = true;
  $('crate').hidden = false;
  const items = [];
  for (let i = 0; i < WIN_AT + 6; i++) {
    const r = kind === 'gun' ? rollGun() : rollOutfit();
    items.push(i === WIN_AT ? prize : r);
  }
  strip.style.transition = 'none';
  strip.style.transform = 'translateX(0)';
  strip.innerHTML = items.map((it) => `<div class="sk reel-tile">${tileHTML(it)}</div>`).join('');
  // land somewhere inside the prize tile, not always dead centre
  const jitter = (Math.random() - 0.5) * (TILE_W * 0.7);
  const target = -(WIN_AT * (TILE_W + GAP) + TILE_W / 2 - reel.clientWidth / 2 + jitter);
  void strip.offsetWidth;
  strip.style.transition = 'transform 5.6s cubic-bezier(0.08, 0.62, 0.12, 1)';
  strip.style.transform = `translateX(${target}px)`;
  // a click for every tile that passes the marker
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
  const done = () => {
    strip.removeEventListener('transitionend', done);
    spinning = false;
    reveal(prize);
    render();
  };
  strip.addEventListener('transitionend', done);
}

function reveal(prize) {
  const i = itemInfo(prize);
  const r = $('crate-result');
  r.hidden = false;
  r.style.setProperty('--rar', i.rarity.color);
  const legendary = prize.rarity === 'legendary' || prize.rarity === 'epic';
  beep(legendary ? 880 : 660, 0.25, 0.3);
  setTimeout(() => beep(legendary ? 1320 : 990, 0.3, 0.3), 140);
  $('crate-prize').innerHTML = `<div class="sk big">${tileHTML(prize)}</div>`;
  $('crate-note').textContent = prize.dup ? `You already had this one — ${prize.refund} dinars back.` : 'New! Added to your locker.';
  const eq = $('crate-equip');
  eq.hidden = prize.dup && false;
  eq.onclick = () => {
    if (prize.kind === 'gun') {
      weapon = prize.weapon;
      tab = 'guns';
      equipGun(prize.finish);
    } else {
      tab = 'outfits';
      equipOutfit(prize.outfit);
    }
    $('crate').hidden = true;
  };
  $('crate-again').disabled = locker.dinars < CRATE_COST;
  $('crate-again').textContent = `Open another · ${CRATE_COST}`;
  $('crate-again').onclick = () => openCrate(prize.kind === 'gun' ? 'gun' : 'outfit');
  if (prize.kind === 'gun') { weapon = prize.weapon; tab = 'guns'; } else tab = 'outfits';
  showModel(prize.kind === 'gun' ? { kind: 'gun', weapon: prize.weapon, finish: prize.finish } : { kind: 'outfit', outfit: prize.outfit });
}

// -- open / close ---------------------------------------------------------------------

let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  document.querySelectorAll('.lk-tab').forEach((t) => t.addEventListener('click', () => {
    tab = t.dataset.tab;
    selected = tab === 'guns' ? { kind: 'gun', weapon, finish: locker.equippedGun(weapon) } : { kind: 'outfit', outfit: locker.equippedOutfit() };
    showModel(selected);
    render();
  }));
  $('crate-gun').addEventListener('click', () => openCrate('gun'));
  $('crate-outfit').addEventListener('click', () => openCrate('outfit'));
  $('crate-back').addEventListener('click', () => { if (!spinning) $('crate').hidden = true; });
  $('locker-close').addEventListener('click', closeLocker);
  $('lk-grid').addEventListener('mouseleave', () => showModel(selected));
  document.querySelectorAll('.crate-price').forEach((el) => { el.textContent = CRATE_COST; });
  locker.onChange(() => { if (!$('locker').hidden) $('locker-dinars').textContent = locker.dinars; });
}

export function openLocker(closeCb) {
  wire();
  onClose = closeCb;
  $('locker').hidden = false;
  selected = tab === 'guns' ? { kind: 'gun', weapon, finish: locker.equippedGun(weapon) } : { kind: 'outfit', outfit: locker.equippedOutfit() };
  setupPreview();
  showModel(selected);
  preview.running = true;
  previewLoop();
  render();
}

function closeLocker() {
  if (spinning) return;
  $('locker').hidden = true;
  $('crate').hidden = true;
  if (preview) preview.running = false;
  if (onClose) onClose();
}
