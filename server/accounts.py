"""
Player accounts: a username, email and password, with the player's locker
(dinars, skins, what's equipped) saved against it.

Stored in SQLite in $DATA_DIR (default: data/ next to server/). Passwords
are never stored — only a salted PBKDF2-SHA256 hash. Sign-ins hand out a
random session token; the database keeps only a hash of it.

The data file must live on storage that survives restarts for accounts to
last. On a host with an ephemeral filesystem (Render's free plan) point
DATA_DIR at a persistent disk.
"""

import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import threading
import time

import catalog

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get('DATA_DIR') or os.path.join(os.path.dirname(HERE), 'data')
DB_PATH = os.path.join(DATA_DIR, 'souk.db')
PBKDF2_ROUNDS = 240_000
SESSION_DAYS = 90
CODE_MINUTES = 15          # how long an emailed code is good for
CODE_TRIES = 5             # wrong guesses before the code is thrown away

USERNAME_RE = re.compile(r'^[A-Za-z0-9_]{3,16}$')
EMAIL_RE = re.compile(r'^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,24}$')

_lock = threading.Lock()
_db = None


class AuthError(Exception):
    pass


def db():
    global _db
    if _db is None:
        os.makedirs(DATA_DIR, exist_ok=True)
        _db = sqlite3.connect(DB_PATH, check_same_thread=False)
        _db.execute('PRAGMA journal_mode=WAL')
        _db.execute("""CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE COLLATE NOCASE,
            email TEXT NOT NULL UNIQUE COLLATE NOCASE,
            pw_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            created REAL NOT NULL,
            locker TEXT NOT NULL)""")
        _db.execute("""CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            expires REAL NOT NULL)""")
        # a change of username or password waiting for its emailed code
        _db.execute("""CREATE TABLE IF NOT EXISTS changes (
            user_id INTEGER PRIMARY KEY,
            kind TEXT NOT NULL,
            payload TEXT NOT NULL,
            code_hash TEXT NOT NULL,
            expires REAL NOT NULL,
            tries INTEGER NOT NULL DEFAULT 0)""")
        _db.commit()
    return _db


def _hash_pw(password, salt_hex):
    return hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), bytes.fromhex(salt_hex), PBKDF2_ROUNDS).hex()


def _token_hash(token):
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def _new_session(user_id):
    token = secrets.token_urlsafe(32)
    db().execute('INSERT INTO sessions (token_hash, user_id, expires) VALUES (?, ?, ?)',
                 (_token_hash(token), user_id, time.time() + SESSION_DAYS * 86400))
    db().execute('DELETE FROM sessions WHERE expires < ?', (time.time(),))
    db().commit()
    return token


def _row_user(row):
    uid, username, email, locker = row
    try:
        lk = catalog.clean_locker(json.loads(locker))
    except ValueError:
        lk = catalog.new_locker()
    return {'id': uid, 'username': username, 'email': email, 'locker': lk}


def validate_signup(username, email, password):
    username = (username or '').strip()
    email = (email or '').strip()
    password = password or ''
    if not USERNAME_RE.match(username):
        raise AuthError('Usernames are 3–16 letters, numbers or underscores.')
    if username.lower() == 'player':
        raise AuthError('Pick a name of your own: "Player" is nobody.')
    if not EMAIL_RE.match(email) or len(email) > 254:
        raise AuthError('That email address doesn’t look right.')
    if len(password) < 8:
        raise AuthError('Passwords need at least 8 characters.')
    if len(password) > 200:
        raise AuthError('That password is too long.')
    return username, email, password


def signup(username, email, password, guest_locker=None):
    """Create an account. Returns (user, token). Raises AuthError."""
    username, email, password = validate_signup(username, email, password)
    salt = secrets.token_hex(16)
    pw_hash = _hash_pw(password, salt)
    # what the player had as a guest comes with them (capped: guests keep their own score)
    locker = catalog.clean_locker(guest_locker, dinar_cap=5000) if guest_locker else catalog.new_locker()
    with _lock:
        cur = db().execute('SELECT username, email FROM users WHERE username = ? OR email = ?', (username, email))
        for (u, e) in cur.fetchall():
            if u.lower() == username.lower():
                raise AuthError('That username is taken.')
            raise AuthError('An account already uses that email. Sign in instead.')
        cur = db().execute('INSERT INTO users (username, email, pw_hash, salt, created, locker) VALUES (?, ?, ?, ?, ?, ?)',
                           (username, email, pw_hash, salt, time.time(), json.dumps(locker)))
        db().commit()
        uid = cur.lastrowid
        token = _new_session(uid)
    return {'id': uid, 'username': username, 'email': email, 'locker': locker}, token


def login(ident, password):
    """Sign in with a username or email. Returns (user, token). Raises AuthError."""
    ident = (ident or '').strip()
    password = password or ''
    with _lock:
        row = db().execute('SELECT id, username, email, locker, pw_hash, salt FROM users WHERE username = ? OR email = ?',
                           (ident, ident)).fetchone()
    # hash even when there is no such user, so timing doesn't tell
    salt = row[5] if row else '00' * 16
    attempt = _hash_pw(password, salt)
    if not row or not hmac.compare_digest(attempt, row[4]):
        raise AuthError('Wrong username, email or password.')
    with _lock:
        token = _new_session(row[0])
    return _row_user(row[:4]), token


def resume(token):
    """The account a saved session token belongs to, or None."""
    if not isinstance(token, str) or not 20 <= len(token) <= 100:
        return None
    with _lock:
        row = db().execute('SELECT u.id, u.username, u.email, u.locker FROM sessions s JOIN users u ON u.id = s.user_id '
                           'WHERE s.token_hash = ? AND s.expires > ?', (_token_hash(token), time.time())).fetchone()
    return _row_user(row) if row else None


def logout(token):
    if not isinstance(token, str):
        return
    with _lock:
        db().execute('DELETE FROM sessions WHERE token_hash = ?', (_token_hash(token),))
        db().commit()


def _code_hash(user_id, code):
    return hashlib.sha256(('%s:%s' % (user_id, code)).encode('utf-8')).hexdigest()


def start_change(user_id, kind, value, password):
    """Begin changing an account's username or password: check the current
    password and the new value, park the change, and return the code to email
    along with where to send it. Raises AuthError."""
    if kind not in ('username', 'password'):
        raise AuthError('Nothing to change.')
    value = (value or '').strip() if kind == 'username' else (value or '')
    password = password or ''
    with _lock:
        row = db().execute('SELECT username, email, pw_hash, salt FROM users WHERE id = ?', (user_id,)).fetchone()
    if not row:
        raise AuthError('Sign in first.')
    username, email, pw_hash, salt = row
    if not hmac.compare_digest(_hash_pw(password, salt), pw_hash):
        raise AuthError('Wrong password.')
    if kind == 'username':
        if not USERNAME_RE.match(value):
            raise AuthError('Usernames are 3–16 letters, numbers or underscores.')
        if value.lower() == 'player':
            raise AuthError('Pick a name of your own: "Player" is nobody.')
        if value == username:
            raise AuthError('That is your username already.')
        with _lock:
            taken = db().execute('SELECT id FROM users WHERE username = ? AND id != ?', (value, user_id)).fetchone()
        if taken:
            raise AuthError('That username is taken.')
        payload = value
    else:
        if len(value) < 8:
            raise AuthError('Passwords need at least 8 characters.')
        if len(value) > 200:
            raise AuthError('That password is too long.')
        if value == password:
            raise AuthError('That is your password already.')
        new_salt = secrets.token_hex(16)
        payload = json.dumps({'hash': _hash_pw(value, new_salt), 'salt': new_salt})
    code = '%06d' % secrets.randbelow(1000000)
    with _lock:
        db().execute('DELETE FROM changes WHERE user_id = ?', (user_id,))
        db().execute('INSERT INTO changes (user_id, kind, payload, code_hash, expires, tries) VALUES (?, ?, ?, ?, ?, 0)',
                     (user_id, kind, payload, _code_hash(user_id, code), time.time() + CODE_MINUTES * 60))
        db().commit()
    return {'code': code, 'email': email, 'username': username, 'kind': kind, 'value': value if kind == 'username' else None}


def confirm_change(user_id, code, keep_token=None):
    """Apply the parked change if the code is right. A new password signs every
    other device out (keep_token stays). Returns (kind, user). Raises AuthError."""
    code = (code or '').strip()
    with _lock:
        row = db().execute('SELECT kind, payload, code_hash, expires, tries FROM changes WHERE user_id = ?', (user_id,)).fetchone()
        if not row:
            raise AuthError('Nothing is waiting to be confirmed. Start again.')
        kind, payload, code_hash, expires, tries = row
        if time.time() > expires or tries >= CODE_TRIES:
            db().execute('DELETE FROM changes WHERE user_id = ?', (user_id,))
            db().commit()
            raise AuthError('That code has run out. Start again and we’ll email you a new one.')
        if not hmac.compare_digest(_code_hash(user_id, code), code_hash):
            db().execute('UPDATE changes SET tries = tries + 1 WHERE user_id = ?', (user_id,))
            db().commit()
            left = CODE_TRIES - tries - 1
            raise AuthError('Wrong code.' + (' %d more tr%s.' % (left, 'y' if left == 1 else 'ies') if left > 0 else ' Start again.'))
        if kind == 'username':
            try:
                db().execute('UPDATE users SET username = ? WHERE id = ?', (payload, user_id))
            except sqlite3.IntegrityError:
                db().execute('DELETE FROM changes WHERE user_id = ?', (user_id,))
                db().commit()
                raise AuthError('Someone took that username in the meantime.')
        else:
            new = json.loads(payload)
            db().execute('UPDATE users SET pw_hash = ?, salt = ? WHERE id = ?', (new['hash'], new['salt'], user_id))
            if isinstance(keep_token, str):
                db().execute('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', (user_id, _token_hash(keep_token)))
            else:
                db().execute('DELETE FROM sessions WHERE user_id = ?', (user_id,))
        db().execute('DELETE FROM changes WHERE user_id = ?', (user_id,))
        db().commit()
        urow = db().execute('SELECT id, username, email, locker FROM users WHERE id = ?', (user_id,)).fetchone()
    return kind, _row_user(urow)


def locker_of(user_id):
    """An account's saved locker, or None if there is no such account."""
    with _lock:
        row = db().execute('SELECT locker FROM users WHERE id = ?', (user_id,)).fetchone()
    if not row:
        return None
    try:
        return catalog.clean_locker(json.loads(row[0]))
    except ValueError:
        return catalog.new_locker()


def save_locker(user_id, locker):
    with _lock:
        db().execute('UPDATE users SET locker = ? WHERE id = ?', (json.dumps(locker), user_id))
        db().commit()


def gun_totals():
    """Kills by gun across every account, for the menu's facts."""
    out = {}
    with _lock:
        rows = db().execute('SELECT locker FROM users').fetchall()
    for (locker,) in rows:
        try:
            kills = json.loads(locker).get('kills') or {}
        except ValueError:
            continue
        for w, n in kills.items():
            if isinstance(n, int):
                out[w] = out.get(w, 0) + n
    return out


def user_count():
    with _lock:
        return db().execute('SELECT COUNT(*) FROM users').fetchone()[0]
