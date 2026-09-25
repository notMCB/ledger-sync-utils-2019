// Keyboard and mouse, read through the player's bindings.

import { settings } from './settings.js';

const held = new Set();
const pressedNow = new Set();
let mdx = 0;
let mdy = 0;
let capture = null; // callback while rebinding a key
let canvas = null;
let wheelAcc = 0;
let wheelLast = 0;

export const input = {
  locked: false,
  touch: false,    // a touch screen: no pointer lock, the on-screen controls do the work
  onUnlock: null,
  onKeyCode: null, // raw key listener for menus (Escape etc.)

  setTouch(on) {
    this.touch = on;
  },

  attach(el) {
    canvas = el;
    window.addEventListener('keydown', (e) => {
      if (capture) {
        e.preventDefault();
        const cb = capture;
        capture = null;
        cb(e.code === 'Escape' ? null : e.code === 'Backspace' ? '' : e.code);
        return;
      }
      if (this.onKeyCode && this.onKeyCode(e)) return;
      if (!this.locked || this.typing) return;
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!e.repeat) pressedNow.add(e.code);
      held.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      held.delete(e.code);
    });
    window.addEventListener('mousedown', (e) => {
      const code = 'Mouse' + e.button;
      if (capture) {
        e.preventDefault();
        const cb = capture;
        capture = null;
        cb(code);
        return;
      }
      if (!this.locked) return;
      pressedNow.add(code);
      held.add(code);
    });
    window.addEventListener('mouseup', (e) => held.delete('Mouse' + e.button));
    window.addEventListener('wheel', (e) => {
      if (capture) {
        if (Math.abs(e.deltaY) < 4) return;
        const cb = capture;
        capture = null;
        cb(e.deltaY < 0 ? 'WheelUp' : 'WheelDown');
        return;
      }
      if (!this.locked) return;
      // a two-finger swipe sends dozens of small wheel events; count one
      // deliberate scroll as one press
      const now = performance.now();
      if (now - wheelLast > 350) wheelAcc = 0;
      wheelAcc += e.deltaY;
      if (Math.abs(wheelAcc) > 40 && now - wheelLast > 350) {
        pressedNow.add(wheelAcc < 0 ? 'WheelUp' : 'WheelDown');
        wheelLast = now;
        wheelAcc = 0;
      }
    }, { passive: true });
    window.addEventListener('contextmenu', (e) => {
      if (this.locked || capture) e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked || this.simulated) return;
      // some browsers report a huge jump on the first event after locking
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      mdx += e.movementX;
      mdy += e.movementY;
    });
    window.addEventListener('blur', () => { if (!this.simulated) held.clear(); });
    document.addEventListener('pointerlockchange', () => {
      if (this.simulated || this.touch) return;
      const was = this.locked;
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) held.clear();
      if (was && !this.locked && this.onUnlock) this.onUnlock();
    });
  },

  lock() {
    if (!canvas || this.locked) return;
    if (this.touch) {
      // nothing to lock: the screen is the controls
      this.locked = true;
      return;
    }
    try {
      const p = canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => canvas.requestPointerLock());
    } catch (e) {
      canvas.requestPointerLock();
    }
  },

  unlock() {
    if (this.touch) {
      if (!this.locked) return;
      this.locked = false;
      held.clear();
      if (this.onUnlock) this.onUnlock();
      return;
    }
    if (document.pointerLockElement) document.exitPointerLock();
  },

  down(action) {
    const a = settings.binds[action], b = settings.alt[action];
    return (!!a && held.has(a)) || (!!b && held.has(b));
  },

  pressed(action) {
    const a = settings.binds[action], b = settings.alt[action];
    return (!!a && pressedNow.has(a)) || (!!b && pressedNow.has(b));
  },

  // while typing in chat, the game ignores the keyboard
  setTyping(on) {
    this.typing = on;
    held.clear();
    pressedNow.clear();
  },

  heldCode(code) {
    return held.has(code);
  },

  pressedCode(code) {
    return pressedNow.has(code);
  },

  mouse() {
    const r = [mdx, mdy];
    mdx = 0;
    mdy = 0;
    return r;
  },

  endFrame() {
    pressedNow.clear();
    // wheel "keys" are never held
    held.delete('WheelUp');
    held.delete('WheelDown');
  },

  // drive the controls from a script (autotest): hold / press codes directly
  simulate(on) {
    this.locked = on;
    this.simulated = on;
  },
  hold(code, on) {
    if (on) held.add(code); else held.delete(code);
  },
  tap(code) {
    pressedNow.add(code);
  },
  look(dx, dy) {
    mdx += dx;
    mdy += dy;
  },

  captureNext(cb) {
    capture = cb;
  },

  cancelCapture() {
    capture = null;
  },
};
