#!/usr/bin/env python3
"""
Souk Siege game server.

One process does everything: it serves the game's web page and files over
HTTP, and runs the multiplayer rooms over a WebSocket at /ws. It uses only
the Python standard library, so it runs anywhere Python 3.9+ does — a
laptop, or a cloud host such as Render.

    python3 server/server.py            # port from $PORT, else 8080

Rooms hold up to 8 players. The server owns the match: phases, timers,
scores, health, spawns, the bomb and the hill. Clients own their own
movement and aim, report what their shots hit, and the server decides the
damage.
"""

import asyncio
import base64
import gzip
import hashlib
import json
import math
import mimetypes
import os
import random
import struct
import sys
import threading
import time
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mapgen  # noqa: E402
import catalog  # noqa: E402
import accounts  # noqa: E402

VERSION = '2.9.0'
# accounts need a disk that survives restarts; switch them off where there isn't one
ACCOUNTS = os.environ.get('ACCOUNTS', '1') != '0'
PUBLIC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public')
TICK = 1 / 20
MAX_PLAYERS = 20
TEAM_MAX = 10
# the maps, played in turn; SOUK_MAP=dock pins every room to one of them (for testing)
MAP_KINDS = list(mapgen.MAP_KINDS)
FORCE_MAP = os.environ.get('SOUK_MAP') if os.environ.get('SOUK_MAP') in mapgen.MAP_KINDS else None
GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

MODES = {
    'ffa':  {'name': 'Free for All',     'time': 600, 'limit': 25,  'respawn': 3.0},
    'tdm':  {'name': 'Team Deathmatch',  'time': 600, 'limit': 50,  'respawn': 3.0},
    'koth': {'name': 'King of the Hill', 'time': 720, 'limit': 150, 'respawn': 5.0},
    'bomb': {'name': 'Bomb Defusal',     'time': 115, 'limit': 7,   'respawn': 0.0},
}
TEAM_MODES = ('tdm', 'koth', 'bomb')

# damage model — keep in step with public/js/weapons.js
WEAPONS = {
    'smg':     {'dmg': 24, 'head': 1.8, 'near': 15, 'far': 40, 'min': 0.6,  'rpm': 800, 'pellets': 1, 'range': 120},
    'lmg':     {'dmg': 30, 'head': 1.8, 'near': 25, 'far': 60, 'min': 0.7,  'rpm': 640, 'pellets': 1, 'range': 160},
    'shotgun': {'dmg': 16, 'head': 1.5, 'near': 8,  'far': 30, 'min': 0.2,  'rpm': 70,  'pellets': 9, 'range': 60},
    'sniper':  {'dmg': 95, 'head': 2.5, 'near': 999, 'far': 999, 'min': 1.0, 'rpm': 45, 'pellets': 1, 'range': 300},
    'pistol':  {'dmg': 34, 'head': 2.0, 'near': 20, 'far': 50, 'min': 0.7,  'rpm': 380, 'pellets': 1, 'range': 120},
    'knife':   {'dmg': 55, 'head': 1.0, 'near': 999, 'far': 999, 'min': 1.0, 'rpm': 110, 'pellets': 1, 'range': 2.6},
    # the Marksman's .50: one hit anywhere; the revolver; the flamethrower's ticks (three targets a tick)
    'heavy':   {'dmg': 130, 'head': 1.0, 'near': 999, 'far': 999, 'min': 1.0, 'rpm': 30, 'pellets': 1, 'range': 400},
    'revolver': {'dmg': 40, 'head': 1.5, 'near': 30, 'far': 80, 'min': 0.75, 'rpm': 150, 'pellets': 1, 'range': 160},
    'flamer':  {'dmg': 3, 'head': 1.0, 'near': 999, 'far': 999, 'min': 1.0, 'rpm': 400, 'pellets': 3, 'range': 4},
}
# the guns a loadout may carry: the first is the default
PRIMARY_OPTIONS = [('smg',), ('lmg',), ('shotgun', 'flamer'), ('sniper', 'heavy')]
SECONDARY_OPTIONS = ('pistol', 'revolver')
BURN_TIME = 10.0        # seconds on fire after the last touch of flame
BURN_DPS = 5.0
FIRE_LIFE = 15.0        # a molotov's fire
FIRE_R = 1.6            # roughly three metres across
# the shotgun firing slugs is a different gun as far as damage goes
SLUG = {'dmg': 85, 'head': 1.5, 'near': 30, 'far': 90, 'min': 0.55, 'rpm': 70, 'pellets': 1, 'range': 200}
LOADOUTS = ['smg', 'lmg', 'shotgun', 'sniper']
# each loadout's perk and how many uses it has per life
PERKS = ['ammo', 'med', 'ladder', 'beacon']
# the perks a loadout may pick from (first is the default), and the grenades
PERK_OPTIONS = [('ammo',), ('med', 'wall'), ('ladder',), ('beacon', 'drone')]
NADE_OPTIONS = [('frag', 'molotov'), ('frag', 'smoke'), ('frag', 'flash', 'molotov'), ('frag',)]
PERK_USES = {'ammo': 2, 'med': 2, 'ladder': 1, 'beacon': 1, 'wall': 2, 'drone': 1}
WALL_HP = 900
WALL_LIFE = 90.0
DRONE_HP = 40
DRONE_KILLS = 75        # sniper kills before the drone can be chosen
DRONE_SPEED = 14.0      # keep in step with DRONE_SPEED in public/js/game.js
DRONE_EXTRA = 4.0       # battery beyond the there-and-back trip, in seconds
MED_HEAL = 50
ASSIST_DAMAGE = 50       # hurt someone this much and someone else finishes them: that's an assist
LADDER_LIFE = 60.0
BEACON_LIFE = 30.0
BEACON_RANGE = 35.0
BEACON_EVERY = 2.5
CRATE_LIFE = 45.0
CRATE_REACH = 2.4
CRATE_AGAIN = 15.0      # stand on the same crate again this much later and it works again
NADES = [3, 2, 2, 2]   # grenades per life, by loadout (Assault carries three)
NADE_MAX = 3
NADE_RADIUS = 7.0
NADE_DMG = 125

BOMB_PLANT = 3.2
BOMB_DEFUSE = 7.0
BOMB_FUSE = 40.0
BOMB_FREEZE = 6.0
BOMB_POST = 5.0
BOMB_HALF = 6
SITE_R = 4.8
HILL_R = 6.0
HILL_MOVE = 75.0
COUNTDOWN = 10.0
POSTMATCH = 12.0
PROTECT = 1.5
# players who neither move nor act for this long are taken out of their match
IDLE_KICK = float(os.environ.get('SOUK_IDLE') or 300.0)

rooms = {}
lobby = set()
LIVE_LOCKERS = {}   # account id -> locker, shared by every tab signed in to that account
next_ids = {'p': 1, 'r': 1}


def now():
    return time.monotonic()


def clean_name(n):
    n = ''.join(ch for ch in str(n or '') if ch.isprintable()).strip()
    return (n[:16] or 'Player')


def clean_cos(c):
    """Cosmetics a client says it is wearing: an outfit id and a finish per weapon."""
    ok = lambda v: isinstance(v, str) and 0 < len(v) <= 24 and v.replace('_', '').isalnum()
    out = {'o': 'standard', 'g': {}}
    if not isinstance(c, dict):
        return out
    if ok(c.get('o')):
        out['o'] = c['o']
    g = c.get('g')
    if isinstance(g, dict):
        for w in ('smg', 'lmg', 'shotgun', 'sniper', 'pistol', 'knife'):
            if ok(g.get(w)):
                out['g'][w] = g[w]
    return out


# dinars paid out for playing
EARN = {'assist': 10, 'supply': 10, 'shotdown': 10, 'kill': 50, 'headshot': 10, 'plant': 20, 'defuse': 25, 'round': 15, 'match': 25, 'win': 50, 'hill': 5}


def owned_cos(p, cos):
    """For signed-in players, only show cosmetics they actually own."""
    lk = p.locker
    if lk is None:
        return cos
    out = {'o': cos['o'] if cos['o'] in lk['outfits'] else 'standard', 'g': {}}
    for w, f in cos['g'].items():
        if '%s:%s' % (w, f) in lk['guns']:
            out['g'][w] = f
    return out


def dist3(a, b):
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)


def dist2(a, b):
    return math.hypot(a[0] - b[0], a[2] - b[2])


def num(v, lo=-1e4, hi=1e4, default=0.0):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return default
    if v != v:
        return default
    return max(lo, min(hi, v))


def vec3(v, default=(0.0, 0.0, 0.0)):
    if not isinstance(v, (list, tuple)) or len(v) < 3:
        return list(default)
    return [num(v[0]), num(v[1]), num(v[2])]


# --------------------------------------------------------------------------
# players and rooms
# --------------------------------------------------------------------------

class Player:
    def __init__(self, conn, name):
        self.id = next_ids['p']
        next_ids['p'] += 1
        self.conn = conn
        self.name = name
        self.room = None
        self.team = -1
        self.loadout = 0
        self.pos = [0.0, 0.0, 0.0]
        self.yaw = 0.0
        self.pitch = 0.0
        self.flags = 0
        self.byaw = 0.0          # which way the body lies when prone
        self.slot = 0
        self.hp = 100
        self.alive = False
        self.respawn_at = 0.0
        self.sc = 0              # spawn counter: stale movement from before a spawn is ignored
        self.kills = 0
        self.deaths = 0
        self.score = 0
        self.perk = 'ammo'       # the perk this loadout uses (some loadouts choose)
        self.primary = 'smg'     # the guns this loadout carries
        self.secondary = 'pistol'
        self.vehicle = None      # the forklift being driven, if any
        self.burn_until = 0.0    # on fire until then
        self.burn_by = None
        self.burn_acc = 0.0
        self.roadkill_at = {}    # victim id -> last roadkill time
        self.last_bug = 0.0
        self.nade_kind = 'frag'
        self.last_fire = {}      # weapon -> the virtual clock its rate limit runs on
        self.rejects = {}        # why shots were dropped, counted (for the log)
        self.reject_log_at = 0.0
        self.slug = False        # shotgun loaded with slugs (an attachment)
        self.hurt_by = {}        # attacker id -> damage done to me this life (for assists)
        self.assists = 0
        self.protect_until = 0.0
        self.nades = NADE_MAX
        self.nade_ids = {}
        self.ping = 0
        self.joined = now()
        self.in_round = False    # bomb mode: took part in the current round
        self.cos = {'o': 'standard', 'g': {}}
        self.hill_t = 0.0
        self.account = None       # {'id', 'username'} once signed in
        self.perk_left = 0
        self.last_chat = 0.0
        self.last_active = now()   # the last time they moved or did anything
        self.auth_times = []

    def send(self, obj):
        self.conn.send(obj)

    def pick(self, m):
        """Loadout, perk and grenade choices from a join, ld or picks message."""
        if 'ld' in m:
            self.loadout = int(num(m.get('ld'), 0, 3))
        opts = PERK_OPTIONS[self.loadout]
        self.perk = m.get('pk') if m.get('pk') in opts else opts[0]
        lk = self.locker
        if self.perk == 'drone' and lk is not None and lk['kills'].get('sniper', 0) < DRONE_KILLS:
            self.perk = opts[0]
        kinds = NADE_OPTIONS[self.loadout]
        self.nade_kind = m.get('nk') if m.get('nk') in kinds else kinds[0]
        guns = PRIMARY_OPTIONS[self.loadout]
        self.primary = m.get('pw') if m.get('pw') in guns else guns[0]
        self.secondary = m.get('sw') if m.get('sw') in SECONDARY_OPTIONS else SECONDARY_OPTIONS[0]

    def nades_for(self):
        return 2 if self.nade_kind == 'molotov' else NADES[self.loadout]

    def reset_stats(self):
        self.kills = self.deaths = self.score = self.assists = 0

    @property
    def locker(self):
        return LIVE_LOCKERS.get(self.account['id']) if self.account else None


class Room:
    def __init__(self, mode, persistent=False):
        self.id = next_ids['r']
        next_ids['r'] += 1
        self.mode = mode
        self.cfg = MODES[mode]
        count = sum(1 for r in rooms.values() if r.mode == mode) + 1
        self.name = '%s #%d' % (self.cfg['name'], count)
        self.persistent = persistent
        self.players = {}
        self.empty_since = now()
        self.roster_dirty = True
        self.new_map()
        self.phase = 'waiting'
        self.phase_end = 0.0
        self.match_end = 0.0
        self.scores = [0, 0]
        self.hold = [0.0, 0.0]
        self.winner = None
        self.round = 0
        self.attackers = 0
        self.bomb = None
        self.hill_i = 0
        self.hill_next = 0.0
        self.hill_owner = -1
        self.hill_contested = False
        self.round_msg = None
        self.feed_seq = 0
        self.ladders = {}
        self.beacons = {}
        self.crates = {}
        self.crate_seq = 0
        self.walls = {}
        self.wall_seq = 0
        self.drones = {}
        self.fires = {}
        self.fire_seq = 0

    # -- map --

    def next_kind(self):
        """The map after the current one, round the rotation."""
        if FORCE_MAP:
            return FORCE_MAP
        cur = getattr(self, 'map_kind', None)
        if cur not in MAP_KINDS:
            return MAP_KINDS[0]
        return MAP_KINDS[(MAP_KINDS.index(cur) + 1) % len(MAP_KINDS)]

    def prepare_map(self):
        """Build the next map on a worker thread, so matches elsewhere don't stall."""
        self.next_town = None
        seed = random.randrange(1, 2 ** 31)
        kind = self.next_kind()

        def work():
            self.next_town = (seed, kind, mapgen.generate(seed, kind))
        threading.Thread(target=work, daemon=True).start()

    def new_map(self, kind=None):
        ready = getattr(self, 'next_town', None)
        self.next_town = None
        if ready and (kind is None or ready[1] == kind):
            self.seed, self.map_kind, town = ready
        else:
            self.seed = random.randrange(1, 2 ** 31)
            self.map_kind = kind or (FORCE_MAP or getattr(self, 'map_kind', None) or MAP_KINDS[0])
            town = mapgen.generate(self.seed, self.map_kind)
        self.map = town.to_json()
        self.solid = mapgen.Solid(self.map['boxes'])
        # forklifts: driveable, so the server keeps their pose and who is at the wheel
        self.forklifts = {}
        for d in self.map['deco']:
            if d.get('k') == 'forklift' and 'id' in d:
                self.forklifts[int(d['id'])] = {'p': [d['x'], d.get('y', 0.0), d['z']], 'y': d.get('yaw', 0.0), 'driver': None}
        self.map_msg = json.dumps({'t': 'map', 'map': self.map}, separators=(',', ':'))
        self.ladders = {}
        self.beacons = {}
        self.crates = {}
        self.crate_seq = 0
        self.walls = {}
        self.drones = {}
        self.fires = {}

    # -- membership --

    def count(self):
        return len(self.players)

    def team_counts(self):
        c = [0, 0]
        for p in self.players.values():
            if p.team in (0, 1):
                c[p.team] += 1
        return c

    def add(self, p):
        self.players[p.id] = p
        p.room = self
        p.reset_stats()
        p.alive = False
        p.in_round = False
        if self.mode in TEAM_MODES:
            c = self.team_counts()
            p.team = 0 if c[0] <= c[1] else 1
        else:
            p.team = -1
        p.send({'t': 'joined', 'room': {'id': self.id, 'mode': self.mode, 'name': self.name},
                'you': p.id, 'team': p.team})
        p.conn.send_raw(self.map_msg)
        for oid, L in self.ladders.items():
            p.send({'t': 'ladder', 'id': oid, 'p': L['p'], 'y': L['y'], 'h': L['h']})
        for oid, B in self.beacons.items():
            p.send({'t': 'beacon', 'id': oid, 'p': B['p'], 'tm': B['team'], 'age': round(now() - B['born'], 2)})
        for cid, C in self.crates.items():
            p.send({'t': 'supply', 'id': cid, 'k': C['k'], 'p': C['p'], 'tm': C['team'], 'owner': C['owner']})
        for wid, W in self.walls.items():
            p.send({'t': 'wall', 'id': wid, 'p': W['p'], 'y': W['y'], 'hp': int(W['hp']), 'tm': W['team'], 'owner': W['owner']})
        for oid, D in self.drones.items():
            p.send({'t': 'drone', 'id': oid, 'p': D['p'], 'tm': D['team'], 'life': round(D['until'] - now(), 1), 'hp': D['hp']})
        for fid in self.forklifts:
            p.send(self.fk_msg(fid))
        for fid, F in self.fires.items():
            p.send({'t': 'fire', 'id': fid, 'p': F['p'], 'life': round(F['until'] - now(), 1)})
        self.roster_dirty = True
        self.event({'e': 'join', 'id': p.id, 'n': p.name})
        if self.phase in ('waiting', 'countdown'):
            self.spawn(p)
        elif self.mode != 'bomb':
            p.respawn_at = now() + 1.0
        # bomb mode: joins as a spectator until the next round

    def remove(self, p):
        self.leave_vehicle(p)
        if p.id not in self.players:
            return
        del self.players[p.id]
        if self.bomb and self.bomb.get('carrier') == p.id:
            self.drop_bomb(p)
        if self.bomb and self.bomb.get('planter') == p.id:
            self.bomb['planter'] = None
        if self.bomb and self.bomb.get('defuser') == p.id:
            self.bomb['defuser'] = None
        p.room = None
        if self.ladders.pop(p.id, None):
            self.broadcast({'t': 'ladder', 'id': p.id, 'off': 1})
        if self.beacons.pop(p.id, None):
            self.broadcast({'t': 'beacon', 'id': p.id, 'off': 1})
        self.roster_dirty = True
        self.event({'e': 'leave', 'id': p.id, 'n': p.name})
        if not self.players:
            self.empty_since = now()

    def rebalance(self):
        if self.mode not in TEAM_MODES:
            return
        c = self.team_counts()
        while abs(c[0] - c[1]) > 1:
            big = 0 if c[0] > c[1] else 1
            cand = sorted((p for p in self.players.values() if p.team == big), key=lambda p: -p.joined)
            if not cand:
                break
            mv = cand[0]
            mv.team = 1 - big
            mv.send({'t': 'team', 'team': mv.team})
            self.event({'e': 'swap', 'id': mv.id, 'n': mv.name, 'tm': mv.team})
            c = self.team_counts()
        self.roster_dirty = True

    # -- dinars --

    def earn(self, p, why, n=None):
        if self.phase in ('waiting', 'countdown'):
            return
        n = n if n is not None else EARN[why]
        msg = {'t': 'earn', 'n': n, 'why': why}
        lk = p.locker
        if lk is not None:
            lk['dinars'] += n
            accounts.save_locker(p.account['id'], lk)
            msg['bal'] = lk['dinars']
        p.send(msg)

    # -- messaging --

    def broadcast(self, obj, skip=None):
        raw = json.dumps(obj, separators=(',', ':'))
        for p in self.players.values():
            if p is not skip:
                p.conn.send_raw(raw)

    def event(self, ev, skip=None):
        self.broadcast({'t': 'ev', **ev}, skip)

    # -- spawning --

    def spawn_side(self, p):
        """Which end of town a player spawns at: 0 = west, 1 = east."""
        if self.mode == 'bomb':
            return 0 if p.team == self.attackers else 1
        return p.team

    def spawn(self, p):
        m = self.map
        others = [q for q in self.players.values() if q is not p and q.alive]
        warmup = self.phase in ('waiting', 'countdown')
        if self.mode == 'bomb' and not warmup and p.team in (0, 1):
            # bomb rounds start from each side's end of town
            pts = list(m['teamSpawns'][self.spawn_side(p)])
            random.shuffle(pts)
            best = next((pt for pt in pts if all(math.hypot(pt[0] - q.pos[0], pt[1] - q.pos[2]) > 1.2
                                                 for q in others)), pts[0])
        else:
            best = self.random_spawn(p, others, warmup)
        x, z = best[0], best[1]
        y = float(best[2]) if len(best) > 2 else 0.0
        yaw = random.uniform(-math.pi, math.pi)
        p.pos = [x, y, z]
        p.yaw = yaw
        p.hp = 100
        p.alive = True
        p.hurt_by = {}
        p.burn_until = 0.0
        p.nades = p.nades_for()
        p.perk_left = PERK_USES[p.perk]
        p.sc += 1
        p.protect_until = now() + PROTECT
        p.last_active = now()      # a fresh life starts the idle clock again
        p.in_round = True
        p.send({'t': 'spawn', 'p': [x, y, z], 'y': yaw, 'sc': p.sc, 'ld': p.loadout, 'tm': p.team})
        self.roster_dirty = True

    def random_spawn(self, p, others, warmup):
        """Anywhere in town, away from enemies and out of their sight where possible."""
        pts = list(self.map['ffaSpawns'])
        random.shuffle(pts)
        enemies = [q for q in others if warmup or p.team < 0 or q.team != p.team]
        if not enemies:
            return pts[0]
        def near(pt):
            return min(math.hypot(pt[0] - q.pos[0], pt[1] - q.pos[2]) for q in enemies)
        safe = [pt for pt in pts if near(pt) > 22]
        if len(safe) < 3:
            safe = sorted(pts, key=near, reverse=True)[:6]
        for pt in safe[:10]:
            eye = [pt[0], (pt[2] if len(pt) > 2 else 0.0) + 1.6, pt[1]]
            seen = any(dist3(eye, q.pos) < 45 and not self.solid.blocked(eye, [q.pos[0], q.pos[1] + 1.5, q.pos[2]])
                       for q in enemies)
            if not seen:
                return pt
        return safe[0]

    # -- match flow --

    def set_phase(self, ph, dur=0.0):
        self.phase = ph
        self.phase_end = now() + dur

    def start_match(self):
        self.scores = [0, 0]
        self.hold = [0.0, 0.0]
        self.winner = None
        self.round = 0
        self.attackers = random.randrange(2)
        for p in self.players.values():
            p.reset_stats()
        self.rebalance()
        self.event({'e': 'matchstart'})
        if self.mode == 'bomb':
            self.start_round()
            return
        self.set_phase('live')
        self.match_end = now() + self.cfg['time']
        if self.mode == 'koth':
            self.hill_i = random.randrange(len(self.map['hills']))
            self.hill_next = now() + HILL_MOVE
            self.hill_owner = -1
        for p in self.players.values():
            self.spawn(p)
        self.roster_dirty = True

    def start_round(self):
        self.round += 1
        if self.round == BOMB_HALF + 1:
            self.attackers = 1 - self.attackers
            self.event({'e': 'half'})
        self.rebalance()
        self.bomb = {'state': 'carried', 'carrier': None, 'pos': None, 'site': None,
                     'planter': None, 'plant_t': 0.0, 'plant_pos': None,
                     'defuser': None, 'defuse_t': 0.0, 'explode': 0.0}
        self.set_phase('freeze', BOMB_FREEZE)
        for p in self.players.values():
            p.in_round = False
            self.spawn(p)
        atk = [p for p in self.players.values() if p.team == self.attackers]
        if atk:
            c = random.choice(atk)
            self.bomb['carrier'] = c.id
            c.send({'t': 'ev', 'e': 'gotbomb'})
        self.event({'e': 'round', 'n': self.round, 'att': self.attackers})

    def end_round(self, winner, why):
        if self.phase == 'post':
            return
        self.scores[winner] += 1
        for p in self.players.values():
            if p.team == winner:
                self.earn(p, 'round')
        self.set_phase('post', BOMB_POST)
        self.event({'e': 'roundend', 'w': winner, 'why': why, 'sc': self.scores})
        self.roster_dirty = True
        if self.scores[winner] >= self.cfg['limit']:
            self.winner = winner

    def end_match(self, winner):
        self.prepare_map()
        for p in self.players.values():
            won = (p.id == winner) if self.mode == 'ffa' else (p.team == winner)
            self.earn(p, 'win' if won else 'match', EARN['match'] + (EARN['win'] if won else 0))
        self.winner = winner
        self.set_phase('ended', POSTMATCH)
        self.bomb = None
        self.event({'e': 'matchend', 'w': winner, 'sc': self.scores})
        self.roster_dirty = True

    def to_waiting(self, why):
        self.set_phase('waiting')
        self.bomb = None
        self.event({'e': 'waiting', 'why': why})
        for p in self.players.values():
            if not p.alive:
                self.spawn(p)

    # -- the bomb --

    def drop_bomb(self, p):
        b = self.bomb
        if not b or b['state'] != 'carried':
            return
        b['state'] = 'dropped'
        b['carrier'] = None
        b['planter'] = None
        b['pos'] = [p.pos[0], max(0.0, p.pos[1]), p.pos[2]]
        self.event({'e': 'bombdrop'})

    def handle_plant(self, p, on):
        b = self.bomb
        if self.mode != 'bomb' or not b or self.phase != 'live':
            return
        if not on:
            if b['planter'] == p.id:
                b['planter'] = None
            if b['defuser'] == p.id:
                b['defuser'] = None
            return
        if not p.alive:
            return
        if p.team == self.attackers:
            if b['state'] != 'carried' or b['carrier'] != p.id or b['planter']:
                return
            site = self.site_at(p.pos)
            if site:
                b['planter'] = p.id
                b['plant_t'] = now()
                b['plant_pos'] = list(p.pos)
        else:
            if b['state'] != 'planted' or b['defuser']:
                return
            if dist3(p.pos, b['pos']) < 2.2:
                b['defuser'] = p.id
                b['defuse_t'] = now()

    def site_at(self, pos):
        for k, site in self.map['sites'].items():
            x, z = site[0], site[1]
            sy = site[2] if len(site) > 2 else 0.0
            if math.hypot(pos[0] - x, pos[2] - z) < SITE_R and pos[1] < sy + 2.0:
                return k
        return None

    def update_bomb(self, t):
        b = self.bomb
        if not b:
            return
        if b['state'] == 'carried' and b['planter']:
            p = self.players.get(b['planter'])
            if not p or not p.alive or dist2(p.pos, b['plant_pos']) > 1.0:
                b['planter'] = None
            elif t - b['plant_t'] >= BOMB_PLANT:
                b['state'] = 'planted'
                b['pos'] = [p.pos[0], max(0.0, p.pos[1]), p.pos[2]]
                b['site'] = self.site_at(p.pos)
                b['carrier'] = None
                b['planter'] = None
                b['explode'] = t + BOMB_FUSE
                p.score += 50
                self.earn(p, 'plant')
                self.roster_dirty = True
                self.event({'e': 'planted', 'id': p.id, 'site': b['site'], 'p': b['pos']})
        elif b['state'] == 'dropped':
            for p in self.players.values():
                if p.alive and p.team == self.attackers and dist3(p.pos, b['pos']) < 1.6:
                    b['state'] = 'carried'
                    b['carrier'] = p.id
                    b['pos'] = None
                    self.event({'e': 'bombpick', 'id': p.id})
                    p.send({'t': 'ev', 'e': 'gotbomb'})
                    break
        elif b['state'] == 'planted':
            if b['defuser']:
                p = self.players.get(b['defuser'])
                if not p or not p.alive or dist3(p.pos, b['pos']) > 2.6:
                    b['defuser'] = None
                elif t - b['defuse_t'] >= BOMB_DEFUSE:
                    b['state'] = 'defused'
                    b['defuser'] = None
                    p.score += 50
                    self.earn(p, 'defuse')
                    self.event({'e': 'defused', 'id': p.id})
                    self.end_round(1 - self.attackers, 'defused')
                    return
            if t >= b['explode']:
                b['state'] = 'exploded'
                self.event({'e': 'bombboom', 'p': b['pos']})
                for q in self.players.values():
                    if q.alive:
                        d = dist3(q.pos, b['pos'])
                        if d < 18:
                            dmg = int(250 * (1 - d / 18))
                            if dmg > 0:
                                self.damage(q, None, dmg, 'bomb', False)
                self.end_round(self.attackers, 'exploded')

    # -- combat --

    def enemies(self, a, b):
        if a is b:
            return False
        if self.mode in TEAM_MODES and self.phase not in ('waiting', 'countdown'):
            return a.team != b.team
        return True

    def handle_shot(self, p, m):
        if not p.alive or self.phase in ('freeze', 'post', 'ended'):
            return
        w = m.get('w')
        if w not in WEAPONS or w not in (p.primary, p.secondary, 'knife'):
            return
        spec = SLUG if (w == 'shotgun' and p.slug) else WEAPONS[w]
        t = now()
        gap = 60.0 / spec['rpm']
        # Rate limit that forgives the network bunching a burst of shots
        # together: a virtual clock that may lag real time by a few shots'
        # worth, so long-run fire rate is still capped at the gun's rpm.
        vt = max(p.last_fire.get(w, 0.0), t - gap * 4)
        ok = vt <= t + 1e-6
        if ok:
            p.last_fire[w] = vt + gap
        o = vec3(m.get('o'))
        ends = m.get('e') if isinstance(m.get('e'), list) else []
        ends = [vec3(e) for e in ends[:spec['pellets']]]
        try:
            flash = min(1.0, max(0.0, float(m.get('f', 1))))
        except (TypeError, ValueError):
            flash = 1.0
        self.broadcast({'t': 'shot', 'id': p.id, 'w': w, 'q': 1 if m.get('q') else 0, 'f': round(flash, 2), 'o': [round(v, 2) for v in o],
                        'e': [[round(v, 2) for v in e] for e in ends]}, skip=p)
        if not ok:
            self.reject_shot(p, 'rate')
            return
        if dist3(o, [p.pos[0], p.pos[1] + 1.5, p.pos[2]]) > 6.0:
            self.reject_shot(p, 'origin')
            return
        hits = m.get('h') if isinstance(m.get('h'), list) else []
        per_target = {}
        shielded = False
        for h in hits[:spec['pellets']]:
            if not isinstance(h, list) or len(h) < 2:
                continue
            tid = int(num(h[0]))
            head = h[1] == 'h'
            q = self.players.get(tid)
            if not q or not q.alive or not self.enemies(p, q):
                continue
            if t < q.protect_until:
                shielded = True
                continue
            d = dist3(p.pos, q.pos)
            if d > spec['range'] + 5:
                self.reject_shot(p, 'range')
                continue
            if d <= spec['near']:
                f = 1.0
            elif d >= spec['far']:
                f = spec['min']
            else:
                f = 1.0 - (1.0 - spec['min']) * (d - spec['near']) / (spec['far'] - spec['near'])
            dmg = spec['dmg'] * f * (spec['head'] if head else 1.0)
            cur = per_target.setdefault(tid, [0.0, False])
            cur[0] += dmg
            cur[1] = cur[1] or head
        for tid, (dmg, head) in per_target.items():
            q = self.players.get(tid)
            if q and q.alive:
                self.damage(q, p, int(round(dmg)), w, head)
        # cover walls hit: [wall id, pellets]
        props = m.get('pr') if isinstance(m.get('pr'), list) else []
        for pr in props[:4]:
            if not isinstance(pr, list) or len(pr) < 2:
                continue
            wid = str(pr[0])[:24]
            n = int(num(pr[1], 0, spec['pellets']))
            W = self.walls.get(wid)
            if not W or n <= 0 or dist3(p.pos, W['p']) > spec['range'] + 5:
                continue
            self.hurt_wall(wid, int(round(spec['dmg'] * n)))
        # drones hit: one owner id per pellet
        for oid in (m.get('dh') if isinstance(m.get('dh'), list) else [])[:spec['pellets']]:
            oid = int(num(oid))
            D = self.drones.get(oid)
            owner = self.players.get(oid)
            if not D or not owner or oid == p.id or not self.enemies(p, owner):
                continue
            d = dist3(p.pos, D['p'])
            if d > spec['range'] + 5:
                continue
            if d <= spec['near']:
                f = 1.0
            elif d >= spec['far']:
                f = spec['min']
            else:
                f = 1.0 - (1.0 - spec['min']) * (d - spec['near']) / (spec['far'] - spec['near'])
            D['hp'] -= spec['dmg'] * f
            if D['hp'] <= 0:
                self.drone_off(oid, 'shot', by=p)
                p.score += 25
                self.earn(p, 'shotdown')
        if shielded and not per_target:
            # tell the shooter their bullets bounced off spawn protection
            p.send({'t': 'hitok', 'd': 0, 'k': False, 'hs': False, 'sh': 1})

    def reject_shot(self, p, why):
        """A shot's damage was thrown away; say so in the log now and then."""
        p.rejects[why] = p.rejects.get(why, 0) + 1
        t = now()
        if t - p.reject_log_at > 10:
            p.reject_log_at = t
            print('room %s: dropped %s shot from %s (%s)' % (self.name, why, p.name, ', '.join('%s=%d' % kv for kv in sorted(p.rejects.items()))), flush=True)

    def damage(self, q, attacker, dmg, w, head):
        if not q.alive or dmg <= 0:
            return
        if w in ('flamer', 'molotov'):
            q.burn_until = now() + BURN_TIME
            q.burn_by = attacker
        q.hp -= dmg
        if attacker and attacker is not q:
            q.hurt_by[attacker.id] = q.hurt_by.get(attacker.id, 0) + dmg
        src = attacker.pos if attacker else None
        q.send({'t': 'hurt', 'd': dmg, 'hp': max(0, q.hp), 'from': src, 'fire': 1 if w in ('flamer', 'molotov', 'fire') else 0})
        if attacker and attacker is not q:
            attacker.send({'t': 'hitok', 'd': dmg, 'k': q.hp <= 0, 'hs': head})
        if q.hp <= 0:
            self.kill(q, attacker, w, head)

    def kill(self, q, attacker, w, head):
        q.alive = False
        q.hp = 0
        q.deaths += 1
        if q.id in self.drones:
            self.drone_off(q.id, 'pilot')
        self.leave_vehicle(q)
        if self.bomb:
            if self.bomb.get('carrier') == q.id:
                self.drop_bomb(q)
            if self.bomb.get('planter') == q.id:
                self.bomb['planter'] = None
            if self.bomb.get('defuser') == q.id:
                self.bomb['defuser'] = None
        counting = self.phase in ('live', 'freeze')
        # anyone who did ASSIST_DAMAGE or more, and didn't land the kill, assisted
        assisted = []
        for pid, dealt in q.hurt_by.items():
            if dealt < ASSIST_DAMAGE or (attacker and pid == attacker.id):
                continue
            helper = self.players.get(pid)
            if not helper:
                continue
            helper.assists += 1
            helper.score += 30
            assisted.append(helper.name)
            helper.send({'t': 'assist', 'v': q.name})
            if counting:
                self.earn(helper, 'assist')
        q.hurt_by = {}
        if attacker and attacker is not q:
            attacker.kills += 1
            attacker.score += 100
            if counting:
                self.earn(attacker, 'kill', EARN['kill'] + (EARN['headshot'] if head else 0))
            if counting and self.mode == 'tdm':
                self.scores[attacker.team] += 1
        elif counting and self.mode == 'ffa':
            q.score = max(0, q.score - 50)
        if self.mode != 'bomb' or self.phase in ('waiting', 'countdown'):
            delay = 1.5 if self.phase in ('waiting', 'countdown') else self.cfg['respawn']
            q.respawn_at = now() + delay
        self.event({'e': 'kill', 'k': attacker.id if attacker else 0, 'v': q.id, 'w': w, 'hs': head,
                    'kn': attacker.name if attacker else '', 'vn': q.name, 'as': assisted,
                    'p': [round(v, 2) for v in q.pos]})
        q.send({'t': 'dead', 'by': attacker.id if attacker else 0, 'byn': attacker.name if attacker else '',
                'w': w, 'rs': max(0.0, q.respawn_at - now()) if self.mode != 'bomb' or self.phase in ('waiting', 'countdown') else -1})
        self.roster_dirty = True

    def handle_nade(self, p, m):
        if not p.alive or p.nades <= 0 or self.phase in ('freeze', 'post', 'ended'):
            return
        p.nades -= 1
        nid = int(num(m.get('n')))
        kind = m.get('k') if m.get('k') in NADE_OPTIONS[p.loadout] else 'frag'
        p.nade_ids[nid] = (now(), kind)
        self.broadcast({'t': 'nade', 'id': p.id, 'n': nid, 'k': kind, 'o': vec3(m.get('o')), 'v': vec3(m.get('v'))}, skip=p)

    def handle_boom(self, p, m):
        nid = int(num(m.get('n')))
        rec = p.nade_ids.pop(nid, None)
        if rec is None or now() - rec[0] > 6.0:
            return
        kind = rec[1]
        pos = vec3(m.get('p'))
        if dist3(pos, p.pos) > 60:
            return
        self.broadcast({'t': 'boom', 'id': p.id, 'n': nid, 'p': pos, 'k': kind}, skip=p)
        if kind in ('flash', 'smoke'):
            return  # blinding and smoke are worked out on each screen; no damage
        if kind == 'molotov':
            self.explode(p, pos, 0.5, 'molotov')
            self.fire_seq += 1
            fid = self.fire_seq
            self.fires[fid] = {'p': pos, 'until': now() + FIRE_LIFE, 'owner': p.id}
            self.broadcast({'t': 'fire', 'id': fid, 'p': pos, 'life': FIRE_LIFE})
            return
        self.explode(p, pos)

    def update_fires(self, t):
        for fid, F in list(self.fires.items()):
            if t >= F['until']:
                del self.fires[fid]
                self.broadcast({'t': 'fire', 'id': fid, 'off': 1})
                continue
            owner = self.players.get(F['owner'])
            for q in self.players.values():
                if not q.alive or (owner and q is not owner and not self.enemies(owner, q)):
                    continue
                if dist2(q.pos, F['p']) < FIRE_R and abs(q.pos[1] - F['p'][1]) < 1.6:
                    q.burn_until = t + BURN_TIME
                    q.burn_by = owner
        # burning players lose five a second, credited to whoever lit them
        for q in self.players.values():
            if not q.alive or t >= q.burn_until:
                q.burn_acc = 0.0
                continue
            q.burn_acc += BURN_DPS * TICK
            if q.burn_acc >= 1.0:
                n = int(q.burn_acc)
                q.burn_acc -= n
                by = q.burn_by if q.burn_by in self.players.values() else None
                self.damage(q, by, n, 'fire', False)

    def explode(self, p, pos, mul=1.0, w='nade'):
        """A frag-sized blast at pos, credited to p: players in reach and any cover walls."""
        if self.phase in ('post', 'ended'):
            return
        for wid, W in list(self.walls.items()):
            d = dist3(pos, [W['p'][0], W['p'][1] + 0.6, W['p'][2]])
            if d < NADE_RADIUS:
                self.hurt_wall(wid, int(NADE_DMG * (1 - d / NADE_RADIUS) ** 1.2))
        for q in list(self.players.values()):
            if not q.alive:
                continue
            if q is not p and not self.enemies(p, q):
                continue
            chest = [q.pos[0], q.pos[1] + 1.0, q.pos[2]]
            d = dist3(pos, chest)
            if d >= NADE_RADIUS:
                continue
            src = [pos[0], pos[1] + 0.2, pos[2]]
            if self.solid.blocked(src, chest) and self.solid.blocked(src, [q.pos[0], q.pos[1] + 1.6, q.pos[2]]):
                continue
            dmg = NADE_DMG * mul * (1 - d / NADE_RADIUS) ** 1.2
            if q is p:
                dmg *= 0.6
            if t_protected(q):
                continue
            self.damage(q, p, int(dmg), w, False)

    # -- perks --

    def handle_perk(self, p, m):
        k = m.get('k')
        if not p.alive or k != p.perk or p.perk_left <= 0 or self.phase == 'ended':
            return
        t = now()
        if k in ('med', 'ammo'):
            # drop a crate your whole team can use, once each
            pos = vec3(m.get('p'))
            if dist3(pos, p.pos) > 4.0:
                return
            self.crate_seq += 1
            cid = '%d-%d' % (p.id, self.crate_seq)
            C = {'k': k, 'p': [round(v, 3) for v in pos], 'team': p.team, 'owner': p.id, 'until': t + CRATE_LIFE,
                 'used': {}, 'paid': set()}
            self.crates[cid] = C
            self.broadcast({'t': 'supply', 'id': cid, 'k': k, 'p': C['p'], 'tm': p.team, 'owner': p.id})
        elif k == 'ladder':
            pos = vec3(m.get('p'))
            if dist2(pos, p.pos) > 4.0 or abs(pos[1] - p.pos[1]) > 1.5:
                return
            L = {'p': [round(v, 3) for v in pos], 'y': round(num(m.get('y')), 4), 'h': round(num(m.get('h'), 2.0, 5.6, 5.4), 2),
                 'until': t + LADDER_LIFE}
            self.ladders[p.id] = L
            self.broadcast({'t': 'ladder', 'id': p.id, 'p': L['p'], 'y': L['y'], 'h': L['h']})
        elif k == 'beacon':
            pos = vec3(m.get('p'))
            if dist3(pos, p.pos) > 4.0:
                return
            B = {'p': [round(v, 3) for v in pos], 'team': p.team, 'until': t + BEACON_LIFE, 'next': t + 0.3, 'born': t}
            self.beacons[p.id] = B
            self.broadcast({'t': 'beacon', 'id': p.id, 'p': B['p'], 'tm': p.team, 'age': 0})
        elif k == 'wall':
            # a steel barricade standing just in front of you, facing the way you face
            pos = vec3(m.get('p'))
            if dist2(pos, p.pos) > 4.0 or abs(pos[1] - p.pos[1]) > 1.5:
                return
            self.wall_seq += 1
            wid = '%d-%d' % (p.id, self.wall_seq)
            W = {'p': [round(v, 3) for v in pos], 'y': round(num(m.get('y')), 4), 'hp': WALL_HP,
                 'team': p.team, 'owner': p.id, 'until': t + WALL_LIFE}
            self.walls[wid] = W
            self.broadcast({'t': 'wall', 'id': wid, 'p': W['p'], 'y': W['y'], 'hp': WALL_HP, 'tm': p.team, 'owner': p.id})
        elif k == 'drone':
            if p.id in self.drones:
                return
            pos = [p.pos[0], p.pos[1] + 1.8, p.pos[2]]
            bx, bz = self.map['bounds']
            # enough battery to cross the town lengthways and come back, plus a little
            life = (4.0 * max(bx, bz)) / DRONE_SPEED + DRONE_EXTRA
            D = {'p': [round(v, 3) for v in pos], 'y': round(p.yaw, 4), 'team': p.team, 'born': t, 'until': t + life, 'hp': DRONE_HP}
            self.drones[p.id] = D
            self.broadcast({'t': 'drone', 'id': p.id, 'p': D['p'], 'tm': p.team, 'life': round(life, 1), 'hp': DRONE_HP})
        p.perk_left -= 1
        p.send({'t': 'perkleft', 'k': k, 'n': p.perk_left})

    def hurt_wall(self, wid, dmg):
        W = self.walls.get(wid)
        if not W or dmg <= 0:
            return
        W['hp'] -= dmg
        if W['hp'] <= 0:
            del self.walls[wid]
            self.broadcast({'t': 'wall', 'id': wid, 'off': 1, 'p': W['p'], 'y': W['y']})
        else:
            self.broadcast({'t': 'wall', 'id': wid, 'hp': int(W['hp'])})

    def handle_drone(self, p, m):
        """The pilot moving their drone."""
        D = self.drones.get(p.id)
        if not D or not p.alive:
            return
        pos = vec3(m.get('p'))
        bx, bz = self.map['bounds']
        pos[0] = max(-bx, min(bx, pos[0]))
        pos[2] = max(-bz, min(bz, pos[2]))
        pos[1] = max(-8.0, min(45.0, pos[1]))
        # no teleporting: at most a short hop per message
        step = dist3(pos, D['p'])
        if step > 4.0:
            k = 4.0 / step
            pos = [D['p'][i] + (pos[i] - D['p'][i]) * k for i in range(3)]
        D['p'] = [round(v, 3) for v in pos]
        D['y'] = round(num(m.get('y')), 4)

    def handle_drone_boom(self, p, m):
        D = self.drones.pop(p.id, None)
        if not D:
            return
        self.broadcast({'t': 'drone', 'id': p.id, 'boom': 1, 'p': D['p']})
        self.explode(p, D['p'])

    # -- forklifts --

    def fk_msg(self, fid):
        F = self.forklifts[fid]
        return {'t': 'fk', 'id': fid, 'p': [round(v, 3) for v in F['p']], 'y': round(F['y'], 4), 'driver': F['driver'] or 0}

    def handle_forklift(self, p, m):
        t = m.get('t')
        fid = int(num(m.get('id'), 0, 1000))
        F = self.forklifts.get(fid)
        if not F:
            return
        if t == 'fkin':
            if not p.alive or F['driver'] or p.id in self.drones or p.vehicle is not None:
                return
            if dist3(p.pos, F['p']) > 4.0:
                return
            F['driver'] = p.id
            p.vehicle = fid
            self.broadcast(self.fk_msg(fid))
        elif t == 'fkout':
            if F['driver'] != p.id:
                return
            F['driver'] = None
            p.vehicle = None
            self.broadcast(self.fk_msg(fid))
        elif t == 'fk':
            if F['driver'] != p.id or not p.alive:
                return
            pos = vec3(m.get('p'))
            bx, bz = self.map['bounds']
            pos[0] = max(-bx, min(bx, pos[0]))
            pos[2] = max(-bz, min(bz, pos[2]))
            pos[1] = max(-8.0, min(30.0, pos[1]))
            if dist3(pos, F['p']) > 5.0:
                return    # no teleporting the truck about
            F['p'] = pos
            F['y'] = num(m.get('y'))

    def handle_roadkill(self, p, m):
        """The driver's client saw someone under the forklift."""
        if p.vehicle is None or not p.alive:
            return
        F = self.forklifts.get(p.vehicle)
        q = self.players.get(int(num(m.get('id'))))
        if not F or F['driver'] != p.id or not q or not q.alive or not self.enemies(p, q):
            return
        if dist3(F['p'], q.pos) > 2.6 or t_protected(q):
            return
        t = now()
        if t - p.roadkill_at.get(q.id, -9) < 1.0:
            return
        p.roadkill_at[q.id] = t
        self.damage(q, p, 999, 'forklift', False)

    def leave_vehicle(self, p):
        """A driver who died or left: the forklift stays where it is."""
        if p.vehicle is None:
            return
        F = self.forklifts.get(p.vehicle)
        if F and F['driver'] == p.id:
            F['driver'] = None
            self.broadcast(self.fk_msg(p.vehicle))
        p.vehicle = None

    def handle_drone_stop(self, p, m):
        self.drone_off(p.id, 'left')

    def drone_off(self, oid, why, by=None):
        D = self.drones.pop(oid, None)
        if not D:
            return
        msg = {'t': 'drone', 'id': oid, 'off': 1, 'p': D['p'], 'why': why}
        if by:
            msg['by'] = by.id
            msg['byn'] = by.name
        self.broadcast(msg)

    def friendly(self, a, b):
        """On the same side (in free-for-all only you are on your side)."""
        if a is b:
            return True
        return self.mode in TEAM_MODES and self.phase not in ('waiting', 'countdown') and a.team == b.team

    def update_crates(self, t):
        for cid, C in list(self.crates.items()):
            owner = self.players.get(C['owner'])
            if t >= C['until'] or not owner:
                del self.crates[cid]
                self.broadcast({'t': 'supply', 'id': cid, 'off': 1})
                continue
            for q in self.players.values():
                if not q.alive or not self.friendly(owner, q):
                    continue
                # each player can use a crate again every CRATE_AGAIN seconds
                if t - C['used'].get(q.id, -1e9) < CRATE_AGAIN:
                    continue
                if dist3(q.pos, C['p']) > CRATE_REACH:
                    continue
                if C['k'] == 'med':
                    if q.hp >= 100:
                        continue   # save it for when they're hurt
                    q.hp = 100
                    q.send({'t': 'heal', 'hp': 100, 'by': owner.name if owner is not q else ''})
                else:
                    q.send({'t': 'perkok', 'k': 'ammo', 'by': owner.name if owner is not q else ''})
                C['used'][q.id] = t
                # the owner is paid once per teammate per crate, not every 15 seconds
                if owner is not q and q.id not in C['paid']:
                    C['paid'].add(q.id)
                    self.earn(owner, 'supply')

    def update_devices(self, t):
        self.update_crates(t)
        for wid, W in list(self.walls.items()):
            if t >= W['until']:
                del self.walls[wid]
                self.broadcast({'t': 'wall', 'id': wid, 'off': 1, 'p': W['p'], 'y': W['y']})
        for oid, D in list(self.drones.items()):
            owner = self.players.get(oid)
            if not owner or not owner.alive:
                self.drone_off(oid, 'pilot')
            elif t >= D['until']:
                self.drone_off(oid, 'battery')
        for oid, L in list(self.ladders.items()):
            if t >= L['until']:
                del self.ladders[oid]
                self.broadcast({'t': 'ladder', 'id': oid, 'off': 1})
        for oid, B in list(self.beacons.items()):
            owner = self.players.get(oid)
            if t >= B['until'] or not owner:
                del self.beacons[oid]
                self.broadcast({'t': 'beacon', 'id': oid, 'off': 1})
                continue
            if t < B['next']:
                continue
            B['next'] = t + BEACON_EVERY
            pts = []
            for q in self.players.values():
                if q.cos.get('o') in catalog.CAMO_OUTFITS:
                    continue      # camouflage: the beacon doesn't pick them up
                if q.alive and self.enemies(owner, q) and dist3(q.pos, B['p']) < BEACON_RANGE:
                    pts.append([q.id, round(q.pos[0], 2), round(q.pos[1], 2), round(q.pos[2], 2)])
            msg = {'t': 'ping', 'id': oid, 'p': B['p'], 'pts': pts}
            team_mode = self.mode in TEAM_MODES and self.phase not in ('waiting', 'countdown')
            for q in self.players.values():
                if q is owner or (team_mode and q.team == owner.team):
                    q.send(msg)

    # -- chat --

    def handle_chat(self, p, m):
        t = now()
        if t - p.last_chat < 0.7:
            return
        text = ''.join(ch for ch in str(m.get('m') or '') if ch.isprintable()).strip()[:120]
        if not text:
            return
        p.last_chat = t
        team_only = bool(m.get('team')) and self.mode in TEAM_MODES and p.team in (0, 1)
        msg = {'t': 'chat', 'id': p.id, 'n': p.name, 'tm': p.team, 'm': text, 'team': team_only}
        for q in self.players.values():
            if not team_only or q.team == p.team:
                q.send(msg)

    # -- per tick --

    def update(self, t):
        n = self.count()
        self.update_devices(t)
        self.update_fires(t)
        # idlers go back to the menu so they don't hold a slot or a team place
        for p in list(self.players.values()):
            if t - p.last_active > IDLE_KICK:
                p.send({'t': 'kicked', 'why': 'idle'})
                p.last_active = t
                conn = p.conn
                self.remove(p)
                lobby.add(conn)
        if n == 0:
            if self.phase != 'waiting':
                self.set_phase('waiting')
                self.bomb = None
            return
        # respawns
        for p in self.players.values():
            if not p.alive and p.respawn_at and t >= p.respawn_at:
                if self.mode != 'bomb' or self.phase in ('waiting', 'countdown'):
                    p.respawn_at = 0
                    self.spawn(p)

        ph = self.phase
        if ph == 'waiting':
            if n >= 2:
                self.set_phase('countdown', COUNTDOWN)
                self.event({'e': 'countdown', 's': COUNTDOWN})
        elif ph == 'countdown':
            if n < 2:
                self.to_waiting('Need at least 2 players')
            elif t >= self.phase_end:
                self.start_match()
        elif ph == 'ended':
            if t >= self.phase_end:
                for oid in list(self.ladders):
                    self.broadcast({'t': 'ladder', 'id': oid, 'off': 1})
                for oid in list(self.beacons):
                    self.broadcast({'t': 'beacon', 'id': oid, 'off': 1})
                for cid in list(self.crates):
                    self.broadcast({'t': 'supply', 'id': cid, 'off': 1})
                self.new_map()
                self.broadcast({'t': 'map', 'map': self.map})
                for p in self.players.values():
                    p.reset_stats()
                    p.alive = False
                self.set_phase('waiting')
                for p in self.players.values():
                    self.spawn(p)
                self.roster_dirty = True
        else:
            if n < 2:
                self.to_waiting('Not enough players — match paused')
                return
            if self.mode == 'bomb':
                self.update_bomb_mode(t)
            else:
                self.update_timed_mode(t)

    def update_timed_mode(self, t):
        if self.mode == 'koth':
            self.update_hill(t)
        if self.mode == 'ffa':
            top = max(self.players.values(), key=lambda p: p.kills)
            if top.kills >= self.cfg['limit']:
                return self.end_match(top.id)
        elif self.mode == 'tdm':
            for i in (0, 1):
                if self.scores[i] >= self.cfg['limit']:
                    return self.end_match(i)
        elif self.mode == 'koth':
            for i in (0, 1):
                if self.scores[i] >= self.cfg['limit']:
                    return self.end_match(i)
        if t >= self.match_end:
            if self.mode == 'ffa':
                top = max(self.players.values(), key=lambda p: (p.kills, -p.deaths))
                self.end_match(top.id)
            else:
                w = 0 if self.scores[0] > self.scores[1] else 1 if self.scores[1] > self.scores[0] else -1
                self.end_match(w)

    def update_hill(self, t):
        hills = self.map['hills']
        if t >= self.hill_next:
            choices = [i for i in range(len(hills)) if i != self.hill_i]
            self.hill_i = random.choice(choices)
            self.hill_next = t + HILL_MOVE
            self.event({'e': 'hillmove', 'i': self.hill_i})
        hx, hz = hills[self.hill_i][0], hills[self.hill_i][1]
        present = [0, 0]
        for p in self.players.values():
            if p.alive and p.team in (0, 1) and math.hypot(p.pos[0] - hx, p.pos[2] - hz) < HILL_R and p.pos[1] < 2.5:
                present[p.team] += 1
        self.hill_contested = present[0] > 0 and present[1] > 0
        if present[0] and not present[1]:
            owner = 0
        elif present[1] and not present[0]:
            owner = 1
        else:
            owner = -1
        self.hill_owner = owner
        if owner >= 0:
            before = int(self.hold[owner])
            self.hold[owner] += TICK
            if int(self.hold[owner]) != before:
                self.scores[owner] = int(self.hold[owner])
                for p in self.players.values():
                    if p.alive and p.team == owner and math.hypot(p.pos[0] - hx, p.pos[2] - hz) < HILL_R:
                        p.score += 2
                        p.hill_t += 1
                        if p.hill_t % 10 == 0:
                            self.earn(p, 'hill')
                self.roster_dirty = True

    def update_bomb_mode(self, t):
        ph = self.phase
        if ph == 'freeze':
            if t >= self.phase_end:
                self.set_phase('live', self.cfg['time'])
                self.event({'e': 'go'})
            return
        if ph == 'post':
            if t >= self.phase_end:
                if self.winner is not None:
                    return self.end_match(self.winner)
                if self.round >= BOMB_HALF * 2:
                    w = 0 if self.scores[0] > self.scores[1] else 1 if self.scores[1] > self.scores[0] else -1
                    return self.end_match(w)
                self.start_round()
            return
        # live round
        self.update_bomb(t)
        if self.phase != 'live':
            return
        b = self.bomb
        att = [p for p in self.players.values() if p.team == self.attackers and p.alive]
        dfn = [p for p in self.players.values() if p.team != self.attackers and p.alive]
        planted = b and b['state'] == 'planted'
        att_total = sum(1 for p in self.players.values() if p.team == self.attackers)
        dfn_total = sum(1 for p in self.players.values() if p.team != self.attackers)
        if not dfn and dfn_total:
            return self.end_round(self.attackers, 'eliminated')
        if not att and att_total and not planted:
            return self.end_round(1 - self.attackers, 'eliminated')
        if not planted and t >= self.phase_end:
            return self.end_round(1 - self.attackers, 'time')

    # -- snapshot --

    def game_state(self, t):
        g = {'ph': self.phase, 'mode': self.mode, 'n': self.count()}
        if self.phase in ('countdown', 'freeze', 'post', 'ended'):
            g['tl'] = round(max(0.0, self.phase_end - t), 1)
        elif self.phase == 'live':
            if self.mode == 'bomb':
                g['tl'] = round(max(0.0, self.phase_end - t), 1)
            else:
                g['tl'] = round(max(0.0, self.match_end - t), 1)
        if self.mode in TEAM_MODES:
            g['sc'] = self.scores
        if self.mode == 'bomb':
            g['rd'] = self.round
            g['att'] = self.attackers
            b = self.bomb
            if b:
                bb = {'s': b['state'], 'c': b['carrier'] or 0}
                if b['pos']:
                    bb['p'] = [round(v, 2) for v in b['pos']]
                if b['planter']:
                    bb['pt'] = round(min(1.0, (t - b['plant_t']) / BOMB_PLANT), 2)
                    bb['pl'] = b['planter']
                if b['defuser']:
                    bb['dt'] = round(min(1.0, (t - b['defuse_t']) / BOMB_DEFUSE), 2)
                    bb['df'] = b['defuser']
                if b['state'] == 'planted':
                    bb['ex'] = round(max(0.0, b['explode'] - t), 1)
                    bb['site'] = b['site']
                g['b'] = bb
        if self.mode == 'koth' and self.phase == 'live':
            g['h'] = {'i': self.hill_i, 'o': self.hill_owner, 'c': self.hill_contested,
                      'nx': round(max(0.0, self.hill_next - t), 1)}
        if self.winner is not None and self.phase == 'ended':
            g['w'] = self.winner
        return g

    def snapshot(self, t):
        pl = []
        for p in self.players.values():
            f = p.flags & ~(1 | 128 | 2048)
            if p.alive:
                f |= 1
            if t < p.protect_until:
                f |= 128
            if p.id in self.drones:
                f |= 2048   # flying a drone: the body stands still, head down over the controller
            if p.alive and t < p.burn_until:
                f |= 32768  # on fire
            pl.append([p.id, round(p.pos[0], 2), round(p.pos[1], 2), round(p.pos[2], 2),
                       round(p.yaw, 3), round(p.pitch, 3), f, p.loadout, p.slot, max(0, p.hp), round(p.byaw, 3)])
        snap = {'t': 'snap', 'g': self.game_state(t), 'p': pl}
        if self.drones:
            snap['dr'] = [[oid, round(D['p'][0], 2), round(D['p'][1], 2), round(D['p'][2], 2), round(D['y'], 3), int(D['hp'])]
                          for oid, D in self.drones.items()]
        moving = [(fid, F) for fid, F in self.forklifts.items() if F['driver']]
        if moving:
            snap['fk'] = [[fid, round(F['p'][0], 2), round(F['p'][1], 2), round(F['p'][2], 2), round(F['y'], 3), F['driver']] for fid, F in moving]
        return snap

    def roster(self):
        return {'t': 'roster', 'pl': [{'id': p.id, 'n': p.name, 'tm': p.team, 'k': p.kills, 'd': p.deaths, 'a': p.assists,
                                       's': p.score, 'ping': p.ping, 'ld': p.loadout, 'cs': p.cos, 'pw': p.primary, 'sw': p.secondary}
                                      for p in self.players.values()]}

    def summary(self):
        return {'id': self.id, 'mode': self.mode, 'name': self.name, 'n': self.count(),
                'max': MAX_PLAYERS, 'ph': self.phase, 'map': self.map.get('name', '')}


def t_protected(q):
    return now() < q.protect_until


def room_list():
    return {'t': 'rooms', 'v': VERSION, 'list': [r.summary() for r in sorted(rooms.values(), key=lambda r: r.id)]}


def ensure_rooms():
    for mode in MODES:
        mine = [r for r in rooms.values() if r.mode == mode]
        if not mine:
            r = Room(mode, persistent=True)
            rooms[r.id] = r
    # drop extra empty rooms after a while
    t = now()
    for r in list(rooms.values()):
        if not r.persistent and not r.players and t - r.empty_since > 60:
            del rooms[r.id]


def quick_room(mode):
    best = None
    for r in rooms.values():
        if r.mode == mode and r.count() < MAX_PLAYERS:
            if best is None or r.count() > best.count():
                best = r
    if best is None:
        best = Room(mode)
        rooms[best.id] = best
    return best


# --------------------------------------------------------------------------
# connection handling
# --------------------------------------------------------------------------

class Conn:
    def __init__(self, reader, writer):
        self.reader = reader
        self.writer = writer
        self.closed = False
        self.player = None
        self.last_rooms = 0.0

    def send(self, obj):
        self.send_raw(json.dumps(obj, separators=(',', ':')))

    def send_raw(self, text):
        if self.closed:
            return
        data = text.encode('utf-8')
        n = len(data)
        if n < 126:
            head = struct.pack('!BB', 0x81, n)
        elif n < 65536:
            head = struct.pack('!BBH', 0x81, 126, n)
        else:
            head = struct.pack('!BBQ', 0x81, 127, n)
        try:
            tr = self.writer.transport
            if tr.get_write_buffer_size() > 4 * 1024 * 1024:
                self.close()
                return
            self.writer.write(head + data)
        except Exception:
            self.close()

    def close(self):
        if self.closed:
            return
        self.closed = True
        try:
            self.writer.close()
        except Exception:
            pass

    async def recv(self):
        """Return the next text message, or None when the socket is done."""
        buf = b''
        while True:
            h = await self.reader.readexactly(2)
            fin = h[0] & 0x80
            op = h[0] & 0x0F
            masked = h[1] & 0x80
            ln = h[1] & 0x7F
            if ln == 126:
                ln = struct.unpack('!H', await self.reader.readexactly(2))[0]
            elif ln == 127:
                ln = struct.unpack('!Q', await self.reader.readexactly(8))[0]
            if ln > 256 * 1024:
                return None
            mask = await self.reader.readexactly(4) if masked else None
            data = await self.reader.readexactly(ln) if ln else b''
            if mask:
                k = (mask * (ln // 4 + 1))[:ln]
                data = (int.from_bytes(data, 'big') ^ int.from_bytes(k, 'big')).to_bytes(ln, 'big') if ln else b''
            if op == 8:
                return None
            if op == 9:
                try:
                    self.writer.write(struct.pack('!BB', 0x8A, len(data[:125])) + data[:125])
                except Exception:
                    return None
                continue
            if op == 10:
                continue
            if op in (0, 1, 2):
                buf += data
                if len(buf) > 256 * 1024:
                    return None
                if fin:
                    if op == 2:
                        buf = b''
                        continue
                    return buf.decode('utf-8', 'replace')

    async def run(self):
        try:
            while not self.closed:
                msg = await self.recv()
                if msg is None:
                    break
                try:
                    m = json.loads(msg)
                except ValueError:
                    continue
                if isinstance(m, dict):
                    self.handle(m)
        except (asyncio.IncompleteReadError, ConnectionError, OSError):
            pass
        finally:
            self.leave()
            lobby.discard(self)
            self.close()

    async def auth(self, m):
        p = self.player
        t = now()
        p.auth_times = [x for x in p.auth_times if t - x < 60]
        if m.get('t') != 'resume' and len(p.auth_times) >= 8:
            return self.send({'t': 'autherr', 'm': 'Too many tries. Wait a minute and try again.'})
        p.auth_times.append(t)
        loop = asyncio.get_event_loop()
        try:
            if m['t'] == 'signup':
                user, token = await loop.run_in_executor(None, accounts.signup, str(m.get('username') or ''),
                                                         str(m.get('email') or ''), str(m.get('password') or ''),
                                                         m.get('guest'))
            elif m['t'] == 'login':
                user, token = await loop.run_in_executor(None, accounts.login, str(m.get('id') or ''),
                                                         str(m.get('password') or ''))
            else:
                token = m.get('token')
                user = await loop.run_in_executor(None, accounts.resume, token)
                if not user:
                    return self.send({'t': 'auth', 'user': None, 'expired': True})
        except accounts.AuthError as e:
            return self.send({'t': 'autherr', 'm': str(e)})
        except Exception as e:  # never leave the page hanging
            print('auth error: %r' % (e,), flush=True)
            return self.send({'t': 'autherr', 'm': 'Something went wrong on the server. Try again.'})
        if self.closed:
            return
        # one live locker per account, shared by all of that player's tabs
        lk = LIVE_LOCKERS.setdefault(user['id'], user['locker'])
        if str(user.get('username', '')).lower() == 'mcb':
            # the owner's account: every gun fully unlocked and a full purse
            for w in catalog.SHOOTERS:
                lk['kills'][w] = max(lk['kills'].get(w, 0), 150)
            lk['dinars'] = max(lk.get('dinars', 0), 500000)
            for w in catalog.GUNS:
                for f in catalog.FINISHES:
                    key = '%s:%s' % (w, f[0])
                    if key not in lk['guns']:
                        lk['guns'].append(key)
            for o in catalog.OUTFITS:
                if o[0] not in lk['outfits']:
                    lk['outfits'].append(o[0])
            accounts.save_locker(user['id'], lk)
        p.account = {'id': user['id'], 'username': user['username']}
        p.name = user['username']
        self.send({'t': 'auth', 'user': {'username': user['username'], 'email': user['email']},
                   'token': token, 'locker': lk})
        if p.room:
            p.room.roster_dirty = True

    def leave(self):
        p = self.player
        if p and p.room:
            p.room.remove(p)

    def handle(self, m):
        t = m.get('t')
        p = self.player
        if t == 'hello':
            name = clean_name(m.get('name'))
            if p is None:
                self.player = Player(self, name)
            else:
                p.name = name
            if 'cos' in m:
                self.player.cos = owned_cos(self.player, clean_cos(m.get('cos')))
            self.send({'t': 'welcome', 'id': self.player.id, 'v': VERSION, 'acc': ACCOUNTS})
            if m.get('v') and m.get('v') != VERSION:
                self.send({'t': 'reload', 'v': VERSION})
            lobby.add(self)
            self.send(room_list())
            return
        if p is None:
            return
        if t == 'preview':
            # a town for the menu backdrop
            r = next(iter(rooms.values()), None)
            if r and not p.room:
                self.send_raw(json.dumps({'t': 'map', 'map': r.map, 'preview': True}, separators=(',', ':')))
            return
        if t == 'ping':
            p.ping = int(num(m.get('rtt'), 0, 9999))
            self.send({'t': 'pong', 'c': m.get('c')})
        elif t == 'rooms':
            self.send(room_list())
        elif t == 'join':
            self.leave()
            if m.get('room'):
                r = rooms.get(int(num(m.get('room'))))
                if not r:
                    return self.send({'t': 'err', 'm': 'That room has closed.'})
                if r.count() >= MAX_PLAYERS:
                    return self.send({'t': 'err', 'm': 'That room is full (8/8).'})
            else:
                mode = m.get('mode')
                if mode not in MODES:
                    return
                r = quick_room(mode)
            p.pick(m)
            p.last_active = now()
            if 'cos' in m:
                p.cos = owned_cos(p, clean_cos(m.get('cos')))
            # an empty room takes the map its first player asks for
            if m.get('map') in MAP_KINDS and r.count() == 0 and r.map_kind != m['map']:
                r.new_map(m['map'])
                r.prepare_map()
            lobby.discard(self)
            r.add(p)
        elif t == 'leave':
            self.leave()
            lobby.add(self)
            self.send(room_list())
        elif t in ('signup', 'login', 'resume'):
            if not ACCOUNTS:
                return self.send({'t': 'auth', 'user': None, 'off': True})
            asyncio.ensure_future(self.auth(m))
        elif t == 'logout':
            accounts.logout(m.get('token'))
            p.account = None
            p.cos = clean_cos(None)
            self.send({'t': 'auth', 'user': None})
            if p.room:
                p.room.roster_dirty = True
        elif t == 'crate':
            lk = p.locker
            if lk is None:
                return self.send({'t': 'err', 'm': 'Sign in to open crates on your account.'})
            prize = catalog.open_crate(lk, m.get('kind'))
            if prize is None:
                return self.send({'t': 'crate', 'prize': None, 'locker': lk})
            accounts.save_locker(p.account['id'], lk)
            self.send({'t': 'crate', 'prize': prize, 'locker': lk})
        elif t == 'equip':
            lk = p.locker
            if lk is None:
                return
            lk['equip'] = catalog.clean_equip(m.get('equip'), lk)
            accounts.save_locker(p.account['id'], lk)
            self.send({'t': 'locker', 'locker': lk})
        elif t == 'bug':
            # a bug report from the menu: name and text, kept for the owner to read
            tnow = now()
            if tnow - p.last_bug < 30:
                return self.send({'t': 'bugok', 'ok': False, 'm': 'One report every 30 seconds, please.'})
            who = ''.join(ch for ch in str(m.get('name') or '') if ch.isprintable()).strip()[:40]
            text = ''.join(ch for ch in str(m.get('text') or '') if ch.isprintable() or ch == '\n').strip()[:2000]
            if not who or len(text) < 5:
                return self.send({'t': 'bugok', 'ok': False, 'm': 'Give your name and describe the bug.'})
            p.last_bug = tnow
            try:
                os.makedirs(accounts.DATA_DIR, exist_ok=True)
                with open(os.path.join(accounts.DATA_DIR, 'bugs.jsonl'), 'a') as f:
                    f.write(json.dumps({'when': time.strftime('%Y-%m-%d %H:%M:%S'), 'name': who, 'player': p.name,
                                        'account': p.account['username'] if p.account else None, 'version': VERSION,
                                        'room': p.room.name if p.room else None, 'map': p.room.map.get('name') if p.room else None,
                                        'text': text}) + '\n')
            except OSError as e:
                print('bug report error: %r' % (e,), flush=True)
                return self.send({'t': 'bugok', 'ok': False, 'm': 'Could not save that. Try again.'})
            print('BUG REPORT from %s (%s): %s' % (who, p.name, text[:200]), flush=True)
            self.send({'t': 'bugok', 'ok': True})
        elif p.room is None:
            return
        elif t == 'st':
            if not p.alive or int(num(m.get('sc'))) != p.sc:
                return
            r = p.room
            old_pos = list(p.pos)
            if r.mode == 'bomb' and r.phase == 'freeze':
                pos = vec3(m.get('p'))
                if dist2(pos, p.pos) < 0.5:
                    p.pos = pos
            else:
                p.pos = vec3(m.get('p'))
            bx, bz = r.map['bounds']
            p.pos[0] = max(-bx, min(bx, p.pos[0]))
            p.pos[2] = max(-bz, min(bz, p.pos[2]))
            p.pos[1] = max(-8.0, min(30.0, p.pos[1]))   # the tunnels run below the town
            if dist3(p.pos, old_pos) > 0.3 or abs(num(m.get('y')) - p.yaw) > 0.05:
                p.last_active = now()
            p.yaw = num(m.get('y'))
            p.pitch = num(m.get('pi'), -1.6, 1.6)
            p.flags = int(num(m.get('f'), 0, 65535))
            p.slot = int(num(m.get('sl'), 0, 3))
            p.byaw = num(m.get('by'), default=p.yaw) if 'by' in m else p.yaw
        elif t == 'shot':
            p.last_active = now()
            p.room.handle_shot(p, m)
        elif t == 'nade':
            p.last_active = now()
            p.room.handle_nade(p, m)
        elif t == 'boom':
            p.room.handle_boom(p, m)
        elif t == 'ld':
            p.pick(m)
            r = p.room
            p.room.roster_dirty = True
            # swap straight away when it is safe to
            if p.alive and (r.phase in ('waiting', 'countdown', 'freeze') or now() - (p.protect_until - PROTECT) < 8):
                # the new loadout's perk, but never more uses than you had left
                p.perk_left = min(p.perk_left, PERK_USES[p.perk])
                p.nades = min(p.nades, p.nades_for())
                p.send({'t': 'ldnow', 'ld': p.loadout})
                p.send({'t': 'perkleft', 'k': p.perk, 'n': p.perk_left})
        elif t == 'picks':
            # a perk or grenade chosen in the Locker mid-match: counts from the next spawn
            p.pick({'pk': m.get('pk'), 'nk': m.get('nk'), 'pw': m.get('pw'), 'sw': m.get('sw')})
        elif t == 'dr':
            p.room.handle_drone(p, m)
        elif t == 'drboom':
            p.room.handle_drone_boom(p, m)
        elif t == 'drstop':
            p.room.handle_drone_stop(p, m)
        elif t in ('fkin', 'fkout', 'fk'):
            p.room.handle_forklift(p, m)
        elif t == 'roadkill':
            p.room.handle_roadkill(p, m)
        elif t == 'cos':
            p.cos = owned_cos(p, clean_cos(m.get('cos')))
            p.room.roster_dirty = True
        elif t == 'atch':
            # only the attachments that change what a shot does reach the server
            a = m.get('a') if isinstance(m.get('a'), dict) else {}
            p.slug = bool(a.get('slug'))
        elif t == 'chat':
            p.room.handle_chat(p, m)
        elif t == 'perk':
            p.room.handle_perk(p, m)
        elif t == 'plant':
            p.room.handle_plant(p, bool(m.get('on')))
        elif t == 'reload':
            # decorative: let others hear it
            p.room.broadcast({'t': 'rl', 'id': p.id}, skip=p)


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------

_cache = {}
TEXT_TYPES = ('text/', 'application/javascript', 'application/json', 'image/svg+xml')


def load_file(path):
    st = os.stat(path)
    key = (path, st.st_mtime, st.st_size)
    hit = _cache.get(path)
    if hit and hit[0] == key:
        return hit[1]
    with open(path, 'rb') as f:
        raw = f.read()
    ctype = mimetypes.guess_type(path)[0] or 'application/octet-stream'
    if path.endswith('.js'):
        ctype = 'application/javascript'
    gz = gzip.compress(raw, 6) if ctype.startswith(TEXT_TYPES) else None
    etag = '"%x-%x"' % (int(st.st_mtime), st.st_size)
    entry = {'raw': raw, 'gz': gz, 'type': ctype, 'etag': etag}
    _cache[path] = (key, entry)
    return entry


async def serve_http(method, target, headers, writer):
    path = urllib.parse.unquote(urllib.parse.urlsplit(target).path)
    if path == '/__log':
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(target).query).get('m', [''])[0]
        print('client error: %s' % q[:900], flush=True)
        return respond(writer, 200, 'text/plain', b'ok', method)
    if path in ('/healthz', '/health'):
        body = json.dumps({'ok': True, 'v': VERSION, 'rooms': len(rooms),
                           'players': sum(r.count() for r in rooms.values())}).encode()
        return respond(writer, 200, 'application/json', body, method)
    if path.endswith('/'):
        path += 'index.html'
    full = os.path.normpath(os.path.join(PUBLIC, path.lstrip('/')))
    if not full.startswith(PUBLIC) or not os.path.isfile(full):
        return respond(writer, 404, 'text/plain', b'Not found', method)
    f = load_file(full)
    if headers.get('if-none-match') == f['etag']:
        return respond(writer, 304, f['type'], b'', method, extra={'ETag': f['etag']})
    body = f['raw']
    extra = {'ETag': f['etag'], 'Cache-Control': 'no-cache'}
    if f['gz'] and 'gzip' in headers.get('accept-encoding', ''):
        body = f['gz']
        extra['Content-Encoding'] = 'gzip'
        extra['Vary'] = 'Accept-Encoding'
    respond(writer, 200, f['type'], body, method, extra)


def respond(writer, code, ctype, body, method='GET', extra=None):
    reason = {200: 'OK', 304: 'Not Modified', 404: 'Not Found', 400: 'Bad Request', 405: 'Method Not Allowed'}.get(code, 'OK')
    lines = ['HTTP/1.1 %d %s' % (code, reason), 'Content-Type: ' + ctype,
             'Content-Length: %d' % (len(body) if code != 304 else 0), 'Connection: keep-alive']
    for k, v in (extra or {}).items():
        lines.append('%s: %s' % (k, v))
    writer.write(('\r\n'.join(lines) + '\r\n\r\n').encode('latin-1'))
    if method != 'HEAD' and code != 304:
        writer.write(body)


async def handle_client(reader, writer):
    try:
        while True:
            try:
                head = await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'), 30)
            except (asyncio.TimeoutError, asyncio.IncompleteReadError, asyncio.LimitOverrunError):
                break
            lines = head.decode('latin-1').split('\r\n')
            parts = lines[0].split(' ')
            if len(parts) < 3:
                break
            method, target = parts[0], parts[1]
            headers = {}
            for ln in lines[1:]:
                if ':' in ln:
                    k, v = ln.split(':', 1)
                    headers[k.strip().lower()] = v.strip()
            if 'content-length' in headers:
                try:
                    await reader.readexactly(int(headers['content-length']))
                except Exception:
                    break
            path = urllib.parse.urlsplit(target).path
            if path == '/ws' and 'websocket' in headers.get('upgrade', '').lower():
                key = headers.get('sec-websocket-key', '')
                accept = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
                writer.write(('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n'
                              'Connection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n' % accept).encode())
                conn = Conn(reader, writer)
                await conn.run()
                return
            if method not in ('GET', 'HEAD'):
                respond(writer, 405, 'text/plain', b'Method not allowed', method)
            else:
                await serve_http(method, target, headers, writer)
            await writer.drain()
            if headers.get('connection', '').lower() == 'close':
                break
    except (ConnectionError, OSError):
        pass
    finally:
        try:
            writer.close()
        except Exception:
            pass


async def ticker():
    last_list = 0.0
    nxt = now()
    while True:
        nxt += TICK
        t = now()
        ensure_rooms()
        for r in list(rooms.values()):
            try:
                r.update(t)
                if r.players:
                    snap = json.dumps(r.snapshot(t), separators=(',', ':'))
                    for p in list(r.players.values()):
                        p.conn.send_raw(snap)
                    if r.roster_dirty:
                        r.roster_dirty = False
                        r.broadcast(r.roster())
            except Exception as e:  # a bug in one room must not stop the others
                print('room %s error: %r' % (r.id, e), flush=True)
                import traceback
                traceback.print_exc()
        if t - last_list > 2.0 and lobby:
            last_list = t
            raw = json.dumps(room_list(), separators=(',', ':'))
            for c in list(lobby):
                c.send_raw(raw)
        await asyncio.sleep(max(0.0, nxt - now()))
        if now() - nxt > 1.0:
            nxt = now()


async def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get('PORT', '8080'))
    ensure_rooms()
    server = await asyncio.start_server(handle_client, '0.0.0.0', port, limit=64 * 1024)
    print('Souk Siege %s — http://localhost:%d' % (VERSION, port), flush=True)
    asyncio.ensure_future(ticker())
    async with server:
        await server.serve_forever()


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
