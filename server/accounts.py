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


def save_locker(user_id, locker):
    with _lock:
        db().execute('UPDATE users SET locker = ? WHERE id = ?', (json.dumps(locker), user_id))
        db().commit()


def user_count():
    with _lock:
        return db().execute('SELECT COUNT(*) FROM users').fetchone()[0]
