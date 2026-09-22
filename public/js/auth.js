// Sign in / create account. The server does the checking; this is the form
// and the saved session.

import { locker } from './locker.js';

const $ = (id) => document.getElementById(id);
const TOKEN_KEY = 'souk-siege-session';

let net = null;
let mode = 'login';
let user = null;
let busy = false;
const listeners = new Set();

function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch (e) {
    return null;
  }
}

function writeToken(t) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (e) {
    /* no storage: you'll need to sign in again next visit */
  }
}

function setMode(m) {
  mode = m;
  document.querySelectorAll('[data-auth]').forEach((b) => b.classList.toggle('on', b.dataset.auth === m));
  $('f-user').hidden = m !== 'signup';
  $('f-email').hidden = m !== 'signup';
  $('f-id').hidden = m !== 'login';
  $('auth-pass').autocomplete = m === 'signup' ? 'new-password' : 'current-password';
  $('auth-submit').textContent = m === 'signup' ? 'Create account' : 'Sign in';
  $('auth-hint').hidden = m !== 'signup';
  $('auth-err').textContent = '';
}

function setBusy(b) {
  busy = b;
  $('auth-submit').disabled = b;
  $('auth-submit').classList.toggle('busy', b);
}

export const auth = {
  get user() {
    return user;
  },

  onChange(fn) {
    listeners.add(fn);
  },

  init(n) {
    net = n;
    document.querySelectorAll('[data-auth]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.auth)));
    $('auth-close').addEventListener('click', () => this.close());
    $('auth-form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (busy) return;
      const pass = $('auth-pass').value;
      if (mode === 'signup') {
        const username = $('auth-user').value.trim();
        const email = $('auth-email').value.trim();
        if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) return this.error('Usernames are 3–16 letters, numbers or underscores.');
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) return this.error('That email address doesn’t look right.');
        if (pass.length < 8) return this.error('Passwords need at least 8 characters.');
        setBusy(true);
        net.send({ t: 'signup', username, email, password: pass, guest: locker.guestData() });
      } else {
        const id = $('auth-id').value.trim();
        if (!id || !pass) return this.error('Enter your username (or email) and password.');
        setBusy(true);
        net.send({ t: 'login', id, password: pass });
      }
    });
    setMode('login');
  },

  // after connecting: pick up a saved session
  resume() {
    const t = readToken();
    if (t) net.send({ t: 'resume', token: t });
  },

  open(m = 'login') {
    setMode(m);
    $('auth').hidden = false;
    setTimeout(() => (m === 'signup' ? $('auth-user') : $('auth-id')).focus(), 30);
  },

  close() {
    $('auth').hidden = true;
    $('auth-pass').value = '';
    setBusy(false);
  },

  error(msg) {
    setBusy(false);
    $('auth-err').textContent = msg;
  },

  signOut() {
    net.send({ t: 'logout', token: readToken() });
    writeToken(null);
  },

  // from the server
  onMessage(m) {
    if (m.t === 'autherr') {
      this.error(m.m);
      return true;
    }
    if (m.t === 'auth') {
      setBusy(false);
      if (m.user) {
        user = m.user;
        if (m.token) writeToken(m.token);
        locker.useAccount(m.locker, (msg) => net.send(msg));
        this.close();
      } else {
        if (m.expired) writeToken(null);
        const was = !!user;
        user = null;
        if (was || locker.signedIn) locker.signOut();
      }
      for (const fn of listeners) fn(user);
      return true;
    }
    if (m.t === 'crate') {
      locker.crateResult(m.prize, m.locker);
      return true;
    }
    if (m.t === 'locker') {
      locker.updateAccount(m.locker);
      return true;
    }
    return false;
  },
};
