// Touch controls for phones: a stick to walk, the rest of the screen to look,
// and a button for every action. They feed the same input the keyboard and
// mouse do, so the game itself does not know the difference. Every control can
// be dragged to wherever the player likes it, from Settings.

import { input } from './input.js';
import { settings, saveSettings } from './settings.js';

// id, the action it presses (from the player's bindings), what it says, where
// it sits (fractions of the screen) and how big it is (pixels at scale 1)
export const CONTROLS = [
  { id: 'stick', label: '', x: 0.13, y: 0.7, r: 72 },
  { id: 'fire', action: 'fire', label: 'FIRE', x: 0.88, y: 0.74, r: 46 },
  { id: 'aim', action: 'aim', label: 'AIM', x: 0.75, y: 0.86, r: 34 },
  { id: 'reload', action: 'reload', label: 'RELOAD', x: 0.65, y: 0.72, r: 30 },
  { id: 'jump', action: 'jump', label: 'JUMP', x: 0.93, y: 0.48, r: 34 },
  { id: 'crouch', action: 'crouch', label: 'CROUCH', x: 0.82, y: 0.57, r: 28 },
  { id: 'prone', action: 'prone', label: 'PRONE', x: 0.72, y: 0.54, r: 24 },
  { id: 'sprint', action: 'sprint', label: 'RUN', x: 0.3, y: 0.57, r: 28 },
  { id: 'swap', action: 'swap', label: 'SWAP', x: 0.58, y: 0.86, r: 28 },
  { id: 'melee', action: 'melee', label: 'KNIFE', x: 0.51, y: 0.72, r: 26 },
  { id: 'grenade', action: 'grenade', label: 'NADE', x: 0.61, y: 0.55, r: 26 },
  { id: 'perk', action: 'perk', label: 'PERK', x: 0.3, y: 0.4, r: 26 },
  { id: 'interact', action: 'interact', label: 'USE', x: 0.41, y: 0.86, r: 30 },
  { id: 'shield', action: 'shield', label: 'VEST', x: 0.41, y: 0.58, r: 24 },
  { id: 'map', action: 'map', label: 'MAP', x: 0.08, y: 0.45, r: 22 },
  { id: 'scores', action: 'scores', label: 'SCORES', x: 0.88, y: 0.22, r: 22 },
  { id: 'pause', label: 'II', x: 0.965, y: 0.08, r: 20 },
];
const DEAD = 0.22;         // the stick's dead zone
const RUN_AT = 0.9;        // push the stick this far and you run

export function touchCapable() {
  return (navigator.maxTouchPoints > 0 || 'ontouchstart' in window) && window.matchMedia('(pointer: coarse)').matches;
}

export function touchWanted() {
  const m = settings.touchMode || 'auto';
  return m === 'on' || (m === 'auto' && touchCapable());
}

class Touch {
  constructor() {
    this.el = null;
    this.els = new Map();
    this.pointers = new Map();     // pointer id -> {kind: 'stick'|'look'|'button'|'drag', ...}
    this.editing = false;
    this.active = false;
    this.stickHeld = new Set();
    this.onPause = null;
    this.onEditDone = null;
  }

  init() {
    const el = document.getElementById('touch');
    this.el = el;
    for (const c of CONTROLS) {
      const d = document.createElement('div');
      d.className = 'tc' + (c.id === 'stick' ? ' tc-stick' : '');
      d.dataset.id = c.id;
      d.innerHTML = c.id === 'stick' ? '<div class="tc-knob"></div>' : `<span>${c.label}</span>`;
      el.appendChild(d);
      this.els.set(c.id, d);
    }
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => this.up(e));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('resize', () => this.layout());
    this.layout();
  }

  // where a control sits: the saved place, or its default
  place(c) {
    const saved = settings.touch && settings.touch[c.id];
    const x = saved && typeof saved.x === 'number' ? saved.x : c.x;
    const y = saved && typeof saved.y === 'number' ? saved.y : c.y;
    return { x: Math.max(0.04, Math.min(0.96, x)), y: Math.max(0.06, Math.min(0.94, y)) };
  }

  layout() {
    if (!this.el) return;
    const W = window.innerWidth, H = window.innerHeight;
    const scale = settings.touchScale || 1;
    for (const c of CONTROLS) {
      const d = this.els.get(c.id);
      const p = this.place(c);
      const r = c.r * scale;
      d.style.left = `${p.x * W - r}px`;
      d.style.top = `${p.y * H - r}px`;
      d.style.width = d.style.height = `${r * 2}px`;
      d.style.fontSize = `${Math.max(9, r * 0.32)}px`;
      // a control the current match has no use for stays out of the way
      d.classList.toggle('tc-off', !this.editing && c.id === 'shield' && !this.royale);
    }
  }

  // shown over a match on a touch screen, or over the menu while editing
  setActive(on, royale = false) {
    this.royale = royale;
    this.wanted = on;
    this.show();
  }

  show() {
    const want = !!this.wanted || this.editing;
    if (want !== this.active) {
      this.active = want;
      this.el.hidden = !want;
      if (!want) this.releaseAll();
    }
    if (want) this.layout();
  }

  controlAt(e) {
    const t = e.target.closest ? e.target.closest('.tc') : null;
    return t ? CONTROLS.find((c) => c.id === t.dataset.id) : null;
  }

  codes(action) {
    return [settings.binds[action], settings.alt[action]].filter(Boolean);
  }

  down(e) {
    if (!this.active) return;
    e.preventDefault();
    const c = this.controlAt(e);
    this.el.setPointerCapture && this.el.setPointerCapture(e.pointerId);
    if (this.editing) {
      if (c) {
        const d = this.els.get(c.id);
        d.classList.add('tc-drag');
        this.pointers.set(e.pointerId, { kind: 'drag', c, ox: e.clientX - parseFloat(d.style.left), oy: e.clientY - parseFloat(d.style.top) });
      }
      return;
    }
    if (c && c.id === 'stick') {
      const d = this.els.get('stick');
      const rect = d.getBoundingClientRect();
      this.pointers.set(e.pointerId, { kind: 'stick', cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2, r: rect.width / 2 });
      d.classList.add('tc-on');
      this.stick(e.pointerId, e.clientX, e.clientY);
    } else if (c && c.id === 'pause') {
      this.pointers.set(e.pointerId, { kind: 'button', c });
      if (this.onPause) this.onPause();
    } else if (c) {
      this.pointers.set(e.pointerId, { kind: 'button', c });
      this.els.get(c.id).classList.add('tc-on');
      for (const code of this.codes(c.action)) {
        input.tap(code);
        input.hold(code, true);
      }
    } else {
      // anywhere else: a finger on the world looks around
      this.pointers.set(e.pointerId, { kind: 'look', x: e.clientX, y: e.clientY });
    }
  }

  move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    if (p.kind === 'look') {
      const k = 2.2 * (settings.touchSens || 1);
      input.look((e.clientX - p.x) * k, (e.clientY - p.y) * k);
      p.x = e.clientX;
      p.y = e.clientY;
    } else if (p.kind === 'stick') {
      this.stick(e.pointerId, e.clientX, e.clientY);
    } else if (p.kind === 'drag') {
      const d = this.els.get(p.c.id);
      const W = window.innerWidth, H = window.innerHeight;
      const r = d.offsetWidth / 2;
      const x = Math.max(0.04, Math.min(0.96, (e.clientX - p.ox + r) / W));
      const y = Math.max(0.06, Math.min(0.94, (e.clientY - p.oy + r) / H));
      settings.touch = settings.touch || {};
      settings.touch[p.c.id] = { x: +x.toFixed(3), y: +y.toFixed(3) };
      this.layout();
    }
  }

  up(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    if (p.kind === 'stick') {
      this.stickRelease();
    } else if (p.kind === 'button') {
      const d = this.els.get(p.c.id);
      d.classList.remove('tc-on');
      if (p.c.action) for (const code of this.codes(p.c.action)) input.hold(code, false);
    } else if (p.kind === 'drag') {
      this.els.get(p.c.id).classList.remove('tc-drag');
      saveSettings();
    }
  }

  // the stick: eight ways, pressing the movement keys; all the way out runs
  stick(id, x, y) {
    const p = this.pointers.get(id);
    if (!p) return;
    let dx = (x - p.cx) / p.r, dy = (y - p.cy) / p.r;
    const L = Math.hypot(dx, dy);
    if (L > 1) { dx /= L; dy /= L; }
    const knob = this.els.get('stick').firstChild;
    knob.style.transform = `translate(${dx * p.r * 0.55}px, ${dy * p.r * 0.55}px)`;
    const want = new Set();
    if (L > DEAD) {
      if (dy < -0.38) want.add('forward');
      if (dy > 0.38) want.add('back');
      if (dx < -0.38) want.add('left');
      if (dx > 0.38) want.add('right');
      if (L > RUN_AT && dy < -0.3) want.add('sprint');
    }
    for (const a of this.stickHeld) if (!want.has(a)) for (const code of this.codes(a)) input.hold(code, false);
    for (const a of want) {
      if (!this.stickHeld.has(a)) for (const code of this.codes(a)) { input.tap(code); input.hold(code, true); }
    }
    this.stickHeld = want;
  }

  stickRelease() {
    for (const a of this.stickHeld) for (const code of this.codes(a)) input.hold(code, false);
    this.stickHeld = new Set();
    const d = this.els.get('stick');
    d.classList.remove('tc-on');
    d.firstChild.style.transform = '';
  }

  releaseAll() {
    for (const [id, p] of this.pointers) {
      if (p.kind === 'button' && p.c.action) for (const code of this.codes(p.c.action)) input.hold(code, false);
      if (p.kind === 'button') this.els.get(p.c.id).classList.remove('tc-on');
    }
    this.pointers.clear();
    this.stickRelease();
  }

  // -- the layout editor --

  edit(on) {
    this.editing = on;
    this.el.classList.toggle('tc-editing', on);
    this.releaseAll();
    this.show();
  }

  resetLayout() {
    settings.touch = {};
    saveSettings();
    this.layout();
  }
}

export const touch = new Touch();
