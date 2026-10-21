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
let acctKind = 'username';     // the account panel: what is being changed
let acctStep = 'form';         // 'form' (the new value) or 'code' (the emailed code)
let acctBusy = false;

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

function setAcctKind(k) {
  acctKind = k;
  document.querySelectorAll('[data-acct]').forEach((b) => b.classList.toggle('on', b.dataset.acct === k));
  $('af-user').hidden = k !== 'username';
  $('af-new').hidden = k !== 'password';
  $('af-new2').hidden = k !== 'password';
  $('acct-err').textContent = '';
}

function setAcctStep(step) {
  acctStep = step;
  $('acct-form').hidden = step !== 'form';
  $('acct-code-form').hidden = step !== 'code';
  $('acct-tabs').hidden = step !== 'form';
  $('acct-err').textContent = '';
  $('acct-code-err').textContent = '';
  setAcctBusy(false);
}

function setAcctBusy(b) {
  acctBusy = b;
  for (const id of ['acct-submit', 'acct-confirm']) {
    $(id).disabled = b;
    $(id).classList.toggle('busy', b);
  }
}

export const auth = {
  get user() {
    return user;
  },
  // the saved session, for things bought outside the socket (the shop)
  token() {
    return readToken();
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
        if (username.toLowerCase() === 'player') return this.error('Pick a name of your own: "Player" is nobody.');
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
    // the account panel: change your username or password, with a code by email
    document.querySelectorAll('[data-acct]').forEach((b) => b.addEventListener('click', () => setAcctKind(b.dataset.acct)));
    $('acct-close').addEventListener('click', () => this.closeAccount());
    $('acct-back').addEventListener('click', () => setAcctStep('form'));
    $('acct-form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (acctBusy || !user) return;
      const password = $('acct-pass').value;
      if (!password) return this.accountError('Type your current password.');
      let value;
      if (acctKind === 'username') {
        value = $('acct-user').value.trim();
        if (!/^[A-Za-z0-9_]{3,16}$/.test(value)) return this.accountError('Usernames are 3–16 letters, numbers or underscores.');
        if (value.toLowerCase() === 'player') return this.accountError('Pick a name of your own: "Player" is nobody.');
        if (value === user.username) return this.accountError('That is your username already.');
      } else {
        value = $('acct-new').value;
        if (value.length < 8) return this.accountError('New passwords need at least 8 characters.');
        if (value !== $('acct-new2').value) return this.accountError('The two new passwords don’t match.');
      }
      setAcctBusy(true);
      net.send({ t: 'change', kind: acctKind, value, password });
    });
    $('acct-code-form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (acctBusy) return;
      const code = $('acct-code').value.trim();
      if (!/^\d{6}$/.test(code)) return this.accountError('The code is six digits.');
      setAcctBusy(true);
      net.send({ t: 'confirm', code, token: readToken() });
    });
  },

  openAccount() {
    if (!user) return this.open('login');
    $('acct-sub').textContent = `${user.username} · ${user.email || ''}`;
    for (const id of ['acct-user', 'acct-pass', 'acct-new', 'acct-new2', 'acct-code']) $(id).value = '';
    setAcctKind('username');
    setAcctStep('form');
    $('account').hidden = false;
    setTimeout(() => $('acct-user').focus(), 30);
  },

  closeAccount() {
    $('account').hidden = true;
    for (const id of ['acct-pass', 'acct-new', 'acct-new2', 'acct-code']) $(id).value = '';
    setAcctBusy(false);
  },

  accountError(msg) {
    setAcctBusy(false);
    $(acctStep === 'code' ? 'acct-code-err' : 'acct-err').textContent = msg;
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
      if (!$('account').hidden) this.accountError(m.m);
      else this.error(m.m);
      return true;
    }
    if (m.t === 'change') {
      // the code is on its way
      setAcctStep('code');
      $('acct-sent').textContent = `We emailed a six-digit code to ${m.to}. It works for 15 minutes.`;
      setTimeout(() => $('acct-code').focus(), 30);
      return true;
    }
    if (m.t === 'changed') {
      this.closeAccount();
      if (m.user && user) {
        user = { ...user, ...m.user };
        for (const fn of listeners) fn(user);
      }
      if (m.kind === 'password') {
        try { window.dispatchEvent(new CustomEvent('souk-toast', { detail: 'Password changed. Every other device has been signed out.' })); } catch (e) { /* no toast */ }
      }
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
      if (m.bought) locker.updateAccount(m.locker);     // the shop put something on the account
      else if (locker.equipEcho(m.seq)) locker.updateAccount(m.locker);
      return true;
    }
    return false;
  },
};
