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

VERSION = '3.2.0'
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
    # the niche modes: everyone for themselves with a fixed kit
    'snipers':   {'name': 'Snipers',            'time': 600, 'limit': 20, 'respawn': 3.0},
    'knives':    {'name': 'Knife Fight',        'time': 600, 'limit': 25, 'respawn': 3.0},
    'firefight': {'name': 'Firefight',          'time': 600, 'limit': 25, 'respawn': 3.0},
    'oitc':      {'name': 'One in the Chamber', 'time': 300, 'limit': 0,  'respawn': 3.0},
    # the battle royale: up to 64, one life, the last one standing wins
    'royale':    {'name': 'Souk Royale',        'time': 900, 'limit': 0,  'respawn': 0.0, 'max': 64, 'countdown': 20.0},
}
NICHE_MODES = ('snipers', 'knives', 'firefight', 'oitc')
FFA_MODES = ('ffa',) + NICHE_MODES + ('royale',)
# what a niche mode hands you: (primary, secondary, grenade kinds); None is nothing in that slot
NICHE_ARMS = {
    'snipers':   ('heavy', None, ()),
    'knives':    (None, None, ()),
    'firefight': ('flamer', None, ('molotov',)),
    'oitc':      (None, 'pistol', ()),
}
OITC_LIVES = 3
TEAM_MODES = ('tdm', 'koth', 'bomb')

# -- the battle royale --------------------------------------------------------
PLANE_ALT = 160.0          # how high the plane flies
PLANE_SPEED = 24.0         # metres a second
PLANE_MARGIN = 70.0        # it starts and ends this far outside the map
# the gas: (radius it closes from, radius it closes to, seconds before it moves, seconds it takes, health a second outside it)
GAS_STAGES = [(250.0, 120.0, 60.0, 45.0, 5), (120.0, 70.0, 35.0, 35.0, 5), (70.0, 40.0, 30.0, 30.0, 10),
              (40.0, 20.0, 25.0, 25.0, 10), (20.0, 8.0, 20.0, 20.0, 10), (8.0, 0.0, 15.0, 30.0, 10)]
# SOUK_GAS=0.1 makes the gas ten times quicker, for the tests
_gas_scale = float(os.environ.get('SOUK_GAS') or 1.0)
GAS_STAGES = [(a, b, w * _gas_scale, c * _gas_scale, d) for (a, b, w, c, d) in GAS_STAGES]
AMMO_CAP = {'light': 250, 'medium': 200, 'shells': 50, 'heavy': 50, 'pistol': 50}
AMMO_OF = {'smg': 'light', 'pdw': 'light', 'carbine': 'medium', 'lmg': 'medium', 'shotgun': 'shells', 'sniper': 'heavy', 'pistol': 'pistol', 'revolver': 'pistol'}
AMMO_BOX = {'light': 60, 'medium': 60, 'shells': 12, 'heavy': 10, 'pistol': 24}
BR_PRIMARIES = ('smg', 'pdw', 'carbine', 'lmg', 'shotgun', 'sniper', 'flamer')    # no .50 to start with
BR_SECONDARIES = ('pistol', 'revolver')
BR_RARITIES = ('default', 'common', 'uncommon', 'rare', 'epic', 'legendary')
BR_RARITY_W = (30, 28, 20, 13, 7, 2)
BR_PERKS = ('ammo', 'med', 'ladder', 'beacon', 'wall', 'drone', 'knives')
BR_CHARGES = {'knives': 3}      # uses before a perk has to recharge; everything else is one
PERK_CD = 30.0                  # seconds for a used perk to come back
SHIELD_MAX = 200                # two vests' worth
VEST_MAX = 2                    # spare vests carried
VEST_TIME = 2.5                 # seconds to put one on
MEDKIT_HEAL = 50
MEDKIT_RATE = 10.0              # health a second, so five seconds for the lot
NADE_CAP = 3
PICK_REACH = 3.2
CHEST_REACH = 2.8
WIN_OUTFIT = 'royale1'          # the winner's skin, season one

# damage model — keep in step with public/js/weapons.js
WEAPONS = {
    'smg':     {'dmg': 24, 'head': 1.8, 'near': 15, 'far': 40, 'min': 0.6,  'rpm': 800, 'pellets': 1, 'range': 120},
    'lmg':     {'dmg': 30, 'head': 1.8, 'near': 25, 'far': 60, 'min': 0.7,  'rpm': 640, 'pellets': 1, 'range': 160},
    'shotgun': {'dmg': 16, 'head': 1.5, 'near': 8,  'far': 30, 'min': 0.2,  'rpm': 70,  'pellets': 9, 'range': 60},
    'sniper':  {'dmg': 95, 'head': 2.5, 'near': 999, 'far': 999, 'min': 1.0, 'rpm': 45, 'pellets': 1, 'range': 300},
    'pistol':  {'dmg': 34, 'head': 2.0, 'near': 20, 'far': 50, 'min': 0.7,  'rpm': 380, 'pellets': 1, 'range': 120},
    'knife':   {'dmg': 55, 'head': 1.0, 'near': 999, 'far': 999, 'min': 1.0, 'rpm': 110, 'pellets': 1, 'range': 2.6},
    # a thrown knife: it kills wherever it lands, and it only flies fifteen metres or so
    'tknife':  {'dmg': 999, 'head': 1.0, 'near': 999, 'far': 999, 'min': 1.0, 'rpm': 300, 'pellets': 1, 'range': 20},
    # the Marksman's .50: one hit anywhere; the revolver; the flamethrower's ticks (three targets a tick)
    'heavy':   {'dmg': 130, 'head': 1.0, 'near': 999, 'far': 999, 'min': 1.0, 'rpm': 30, 'pellets': 1, 'range': 400},
    'revolver': {'dmg': 40, 'head': 1.5, 'near': 30, 'far': 80, 'min': 0.75, 'rpm': 150, 'pellets': 1, 'range': 160},
    'flamer':  {'dmg': 7, 'head': 1.0, 'near': 999, 'far': 999, 'min': 1.0, 'rpm': 400, 'pellets': 3, 'range': 6},
    'pdw':     {'dmg': 30, 'head': 1.6, 'near': 7,  'far': 20, 'min': 0.3,  'rpm': 1050, 'pellets': 1, 'range': 60},
    'carbine': {'dmg': 27, 'head': 1.8, 'near': 22, 'far': 55, 'min': 0.65, 'rpm': 720, 'pellets': 1, 'range': 150},
}
# the guns a loadout may carry: the first is the default
PRIMARY_OPTIONS = [('smg', 'pdw', 'carbine'), ('lmg', 'carbine'), ('shotgun', 'flamer'), ('sniper', 'heavy')]
SECONDARY_OPTIONS = ('pistol', 'revolver')
BURN_TIME = 10.0        # seconds on fire after the last touch of flame
BURN_DPS = 5.0
FIRE_LIFE = 15.0        # a molotov's fire
FIRE_R = 2.25           # about four and a half metres across: twice the area it had
# the shotgun firing slugs is a different gun as far as damage goes
SLUG = {'dmg': 85, 'head': 1.5, 'near': 30, 'far': 90, 'min': 0.55, 'rpm': 70, 'pellets': 1, 'range': 200}
LOADOUTS = ['smg', 'lmg', 'shotgun', 'sniper']
# each loadout's perk and how many uses it has per life
PERKS = ['ammo', 'med', 'ladder', 'beacon']
# the perks a loadout may pick from (first is the default), and the grenades
PERK_OPTIONS = [('ammo',), ('med', 'wall'), ('ladder',), ('beacon', 'drone', 'knives')]
NADE_OPTIONS = [('frag', 'molotov'), ('frag', 'smoke'), ('frag', 'flash', 'molotov'), ('frag',)]
PERK_USES = {'ammo': 2, 'med': 2, 'ladder': 1, 'beacon': 1, 'wall': 2, 'drone': 1, 'knives': 3}
KNIFE_AIR = 3.5         # a thrown knife may land this long after it leaves the hand
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

# -- bans -----------------------------------------------------------------
# A ban is a record: the name it was made under, and everything learnt about
# whoever used it since: account ids, network addresses and the id the game
# keeps in their browser. Any of those matching keeps them out, whatever name
# they turn up with next. The file lives on the data disk; SOUK_BANS seeds names.
BAN_FILE = os.path.join(accounts.DATA_DIR, 'bans.json')
bans = []


def load_bans():
    global bans
    try:
        with open(BAN_FILE) as f:
            bans = [b for b in json.load(f) if isinstance(b, dict) and b.get('name')]
    except (OSError, ValueError):
        bans = []
    for n in (os.environ.get('SOUK_BANS') or '').split(','):
        n = n.strip().lower()
        if n and not any(b['name'] == n for b in bans):
            bans.append({'name': n, 'accounts': [], 'ips': [], 'devs': [], 'when': time.strftime('%Y-%m-%d %H:%M:%S')})
    save_bans()


def save_bans():
    try:
        os.makedirs(accounts.DATA_DIR, exist_ok=True)
        with open(BAN_FILE, 'w') as f:
            json.dump(bans, f)
    except OSError as e:
        print('ban file error: %r' % (e,), flush=True)


def ban_match(name, account_id, ip, dev):
    n = (name or '').strip().lower()
    for b in bans:
        if n and b['name'] == n:
            return b
        if account_id and account_id in b['accounts']:
            return b
        if ip and ip in b['ips']:
            return b
        if dev and dev in b['devs']:
            return b
    return None


def public_ip(ip):
    """An address worth banning: not this machine's own, not a private network's."""
    if not ip or ip.startswith(('127.', '10.', '192.168.', '172.16.', '172.17.', '172.18.', '172.19.', '172.2', '172.30.', '172.31.', 'fd', 'fe80', '::1')):
        return None
    return ip


def ban_learn(b, account_id, ip, dev):
    """Everything a banned player connects with joins their record."""
    changed = False
    ip = public_ip(ip)
    for key, v in (('accounts', account_id), ('ips', ip), ('devs', dev)):
        if v and v not in b[key]:
            b[key].append(v)
            changed = True
    if changed:
        save_bans()


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
    out = {'o': 'standard', 'g': {}, 'ms': ''}
    if not isinstance(c, dict):
        return out
    if ok(c.get('o')):
        out['o'] = c['o']
    if c.get('ms') in catalog.MUZZLE_STYLES:
        out['ms'] = c['ms']
    g = c.get('g')
    if isinstance(g, dict):
        for w in catalog.GUNS:
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
    out = {'o': cos['o'] if cos['o'] in lk['outfits'] else 'standard', 'g': {}, 'ms': cos.get('ms', '') if cos.get('ms', '') in lk.get('muzzles', []) else ''}
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
        self.knives_air = []     # when each thrown knife left the hand, until it lands
        self.lives = OITC_LIVES  # one in the chamber: lives left this match
        self.rounds = 1          # one in the chamber: rounds in the pistol
        self.last_chat = 0.0
        self.last_active = now()   # the last time they moved or did anything
        self.auth_times = []
        # the battle royale: what you found, and how you did
        self.inv = {'pw': None, 'sw': None}
        self.ammo = {a: 0 for a in AMMO_CAP}
        self.vests = 0
        self.shield = 0
        self.perk_ready = 0.0    # when a spent perk comes back
        self.heal_left = 0.0     # a medkit still working
        self.heal_acc = 0.0
        self.gas_acc = 0.0
        self.aboard = False      # still in the plane
        self.place = 0           # where they finished, 1 = won
        self.dmg = 0.0           # damage dealt this match
        self.chests = 0
        self.alive_since = 0.0
        self.fuel = 100.0        # the flamethrower in hand, from the client
        self.vest_at = 0.0
        self.late = False        # joined a match already under way: watches until the next

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
        self.lives = OITC_LIVES
        self.rounds = 1
        self.place = 0
        self.dmg = 0.0
        self.chests = 0
        self.late = False

    def reset_kit(self):
        """A battle royale life starts with nothing but the knife."""
        self.inv = {'pw': None, 'sw': None}
        self.ammo = {a: 0 for a in AMMO_CAP}
        self.vests = 0
        self.shield = 0
        self.perk = None
        self.perk_left = 0
        self.perk_ready = 0.0
        self.heal_left = 0.0
        self.heal_acc = 0.0
        self.gas_acc = 0.0
        self.nades = 0
        self.nade_kind = 'frag'
        self.aboard = False
        self.fuel = 100.0

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
        # the battle royale
        self.plane = None
        self.gas = None
        self.items = {}
        self.item_seq = 0
        self.br_total = 0
        self.br_alive = 0

    @property
    def max(self):
        return self.cfg.get('max', MAX_PLAYERS)

    # -- map --

    def next_kind(self):
        """The map after the current one, round the rotation."""
        if self.mode == 'royale':
            return 'royale'
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
            self.map_kind = 'royale' if self.mode == 'royale' else (kind or (FORCE_MAP or getattr(self, 'map_kind', None) or MAP_KINDS[0]))
            town = mapgen.generate(self.seed, self.map_kind)
        self.map = town.to_json()
        self.solid = mapgen.Solid(self.map['boxes'])
        # forklifts: driveable, so the server keeps their pose and who is at the wheel
        self.forklifts = {}
        for d in self.map['deco']:
            if d.get('k') in ('forklift', 'golfcart') and 'id' in d:
                self.forklifts[int(d['id'])] = {'p': [d['x'], d.get('y', 0.0), d['z']], 'y': d.get('yaw', 0.0), 'driver': None}
        self.map_msg = json.dumps({'t': 'map', 'map': self.map}, separators=(',', ':'))
        self.ladders = {}
        self.beacons = {}
        self.crates = {}
        self.crate_seq = 0
        self.walls = {}
        self.drones = {}
        self.fires = {}
        # loot chests, closed, where the map put them
        self.chests = {i + 1: {'p': [c[0], c[1], c[2]], 'open': False} for i, c in enumerate(self.map.get('chests', []))}
        self.items = {}
        self.plane = None
        self.gas = None

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
        if self.mode == 'royale':
            p.reset_kit()
            for cid, C in self.chests.items():
                if C['open']:
                    p.send({'t': 'chest', 'id': cid, 'open': 1})
            if self.items:
                p.send({'t': 'items', 'add': list(self.items.values())})
            if self.plane:
                p.send(self.plane_msg())
        self.roster_dirty = True
        self.event({'e': 'join', 'id': p.id, 'n': p.name})
        if self.phase in ('waiting', 'countdown'):
            self.spawn(p)
        elif self.mode == 'royale':
            # a match under way: watch it, and drop with everyone in the next one
            p.late = True
            p.send({'t': 'dead', 'by': 0, 'byn': '', 'w': '', 'rs': -1, 'lv': -1, 'late': 1})
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

    def arms(self, p):
        """(primary, secondary) a player carries here: the niche modes override the locker,
        and in the battle royale you carry what you have found."""
        if self.mode in NICHE_ARMS:
            a = NICHE_ARMS[self.mode]
            return a[0], a[1]
        if self.mode == 'royale':
            pw, sw = p.inv['pw'], p.inv['sw']
            return (pw['w'] if pw else None), (sw['w'] if sw else None)
        return p.primary, p.secondary

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
        if self.mode in NICHE_ARMS:
            kinds = NICHE_ARMS[self.mode][2]
            p.nades = 2 if kinds else 0
            p.perk_left = 0
        elif self.mode == 'royale':
            p.reset_kit()
        else:
            p.nades = p.nades_for()
            p.perk_left = PERK_USES[p.perk]
        p.rounds = 1
        p.sc += 1
        p.protect_until = now() + PROTECT
        p.last_active = now()      # a fresh life starts the idle clock again
        p.in_round = True
        p.send({'t': 'spawn', 'p': [x, y, z], 'y': yaw, 'sc': p.sc, 'ld': p.loadout, 'tm': p.team, 'lv': p.lives})
        if self.mode == 'royale':
            p.send(self.inv_msg(p))
        self.roster_dirty = True

    def random_spawn(self, p, others, warmup):
        """Anywhere in town, away from enemies and out of their sight where possible."""
        pts = list(self.map['ffaSpawns'])
        random.shuffle(pts)
        if self.mode == 'royale':
            return pts[0]        # the lobby at the crossroads: no hiding from anyone there
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
        if self.mode == 'royale':
            self.start_royale()
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
            won = (p.id == winner) if self.mode in FFA_MODES else (p.team == winner)
            self.earn(p, 'win' if won else 'match', EARN['match'] + (EARN['win'] if won else 0))
        if self.mode == 'royale':
            self.finish_royale(winner)
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
        if not p.alive or self.phase in ('freeze', 'post', 'ended') or p.aboard:
            return
        w = m.get('w')
        if w not in WEAPONS:
            return
        if w == 'tknife':
            # a thrown knife landing: only as many as have been thrown and are still in the air
            t0 = now()
            p.knives_air = [x for x in p.knives_air if t0 - x < KNIFE_AIR]
            if p.perk != 'knives' or not p.knives_air:
                return
            p.knives_air.pop(0)
        elif w not in self.arms(p) + ('knife',):
            return
        if self.mode == 'oitc' and w == 'pistol':
            # one round in the chamber: nothing to fire until a kill puts another in
            if p.rounds <= 0:
                self.reject_shot(p, 'empty')
                return
            p.rounds -= 1
            p.send({'t': 'oitc', 'r': p.rounds})
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
            # the knife kills outright to the head, or from behind
            if w == 'knife' and (head or self.behind(p, q)):
                dmg = 999
            # one in the chamber: the one round kills wherever it lands
            if self.mode == 'oitc' and w == 'pistol':
                dmg = 999
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
        if not q.alive or dmg <= 0 or q.aboard:
            return
        if w in ('flamer', 'molotov'):
            q.burn_until = now() + BURN_TIME
            q.burn_by = attacker
        # a vest takes the hit before your health does; fire and gas get through it
        absorbed = 0
        if q.shield > 0 and w not in ('fire', 'gas'):
            absorbed = min(q.shield, dmg)
            q.shield -= absorbed
        q.hp -= dmg - absorbed
        if attacker and attacker is not q:
            q.hurt_by[attacker.id] = q.hurt_by.get(attacker.id, 0) + dmg
            attacker.dmg += dmg
        src = attacker.pos if attacker else None
        hurt = {'t': 'hurt', 'd': dmg, 'hp': max(0, q.hp), 'from': src, 'fire': 1 if w in ('flamer', 'molotov', 'fire') else 0}
        if self.mode == 'royale':
            hurt['sh'] = q.shield
        q.send(hurt)
        if attacker and attacker is not q:
            # 'ar': the shot went into armour and no further
            attacker.send({'t': 'hitok', 'd': dmg, 'k': q.hp <= 0, 'hs': head, 'ar': 1 if absorbed and absorbed >= dmg else 0})
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
                self.pass_kill(attacker, w)
            if counting and self.mode == 'tdm':
                self.scores[attacker.team] += 1
            if self.mode == 'oitc' and attacker.rounds < 1:
                attacker.rounds = 1
                attacker.send({'t': 'oitc', 'r': 1})
        elif counting and self.mode in FFA_MODES:
            q.score = max(0, q.score - 50)
        out = False
        if self.mode == 'oitc' and self.phase == 'live':
            q.lives -= 1
            out = q.lives <= 0
        royale_live = self.mode == 'royale' and self.phase == 'live'
        if royale_live:
            out = True
            q.place = 1 + sum(1 for x in self.players.values() if x.alive and not x.late)
            self.drop_kit(q)
        if out:
            q.respawn_at = 0
        elif self.mode != 'bomb' or self.phase in ('waiting', 'countdown'):
            delay = 1.5 if self.phase in ('waiting', 'countdown') else self.cfg['respawn']
            q.respawn_at = now() + delay
        self.event({'e': 'kill', 'k': attacker.id if attacker else 0, 'v': q.id, 'w': w, 'hs': head,
                    'kn': attacker.name if attacker else '', 'vn': q.name, 'as': assisted,
                    'p': [round(v, 2) for v in q.pos]})
        q.send({'t': 'dead', 'by': attacker.id if attacker else 0, 'byn': attacker.name if attacker else '',
                'w': w, 'rs': max(0.0, q.respawn_at - now()) if q.respawn_at and (self.mode != 'bomb' or self.phase in ('waiting', 'countdown')) else -1,
                'lv': q.lives if self.mode == 'oitc' else -1})
        if royale_live:
            q.send(self.stats_msg(q, False))
        self.roster_dirty = True

    def pass_kill(self, p, w):
        """A kill on a signed-in player's account: the gun's count and the Battle Pass."""
        lk = p.locker
        if lk is None:
            return
        if w in catalog.GUNS:
            lk['kills'][w] = lk['kills'].get(w, 0) + 1
        lk['pass'] = lk.get('pass', 0) + 1
        new = catalog.grant_pass(lk, catalog.tier_of(lk['pass']))
        accounts.save_locker(p.account['id'], lk)
        p.send({'t': 'pass', 'k': lk['pass'], 'new': new, 'locker': lk})

    def handle_nade(self, p, m):
        if not p.alive or p.nades <= 0 or self.phase in ('freeze', 'post', 'ended'):
            return
        if p.aboard:
            return
        p.nades -= 1
        nid = int(num(m.get('n')))
        kind = m.get('k') if m.get('k') in NADE_OPTIONS[p.loadout] else 'frag'
        if self.mode == 'royale':
            kind = p.nade_kind
        if self.mode in NICHE_ARMS:
            kinds = NICHE_ARMS[self.mode][2]
            if not kinds:
                return
            kind = kinds[0]
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

    def behind(self, p, q):
        """Is p standing behind q, in the half of the world q has its back to?"""
        fx, fz = -math.sin(q.yaw), -math.cos(q.yaw)
        dx, dz = p.pos[0] - q.pos[0], p.pos[2] - q.pos[2]
        d = math.hypot(dx, dz)
        return d > 0.05 and (fx * dx + fz * dz) / d < -0.25

    def handle_perk(self, p, m):
        k = m.get('k')
        if not p.alive or k != p.perk or p.perk_left <= 0 or self.phase == 'ended' or self.mode in NICHE_ARMS or p.aboard:
            return
        t = now()
        if k == 'medkit':
            # fifty health, ten a second, and you may walk away while it works
            if p.heal_left > 0 or p.hp >= 100:
                return
            p.heal_left = float(MEDKIT_HEAL)
            p.perk = None
            p.perk_left = 0
            p.send({'t': 'perkleft', 'k': None, 'n': 0, 'cd': 0})
            p.send({'t': 'ev', 'e': 'healing'})
            return
        if k == 'knives':
            # a knife leaves the hand: everyone sees it fly; the hit, if any, comes as a shot
            pos = vec3(m.get('p'))
            vel = vec3(m.get('v'))
            if dist3(pos, [p.pos[0], p.pos[1] + 1.5, p.pos[2]]) > 4.0:
                return
            speed = math.sqrt(sum(v * v for v in vel)) or 1.0
            if speed > 30.0:
                vel = [v * 30.0 / speed for v in vel]
            p.knives_air = [x for x in p.knives_air if t - x < KNIFE_AIR] + [t]
            self.broadcast({'t': 'throw', 'id': p.id, 'o': [round(v, 3) for v in pos], 'v': [round(v, 3) for v in vel]}, skip=p)
        elif k in ('med', 'ammo'):
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
        if self.mode == 'royale' and p.perk_left <= 0:
            p.perk_ready = t + PERK_CD
            p.send({'t': 'perkleft', 'k': k, 'n': 0, 'cd': PERK_CD})
        else:
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
                    if self.mode == 'royale':
                        # the pools of the guns you hold, filled
                        for slot in ('pw', 'sw'):
                            it = q.inv[slot]
                            a = AMMO_OF.get(it['w']) if it else None
                            if a:
                                q.ammo[a] = AMMO_CAP[a]
                        q.send(self.inv_msg(q))
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

    # -- the battle royale ----------------------------------------------------

    def start_royale(self):
        """Everyone into the plane: a fresh line across the map, the gas set, the loot closed."""
        t = now()
        self.set_phase('live')
        self.match_end = t + self.cfg['time']
        bx, bz = self.map['bounds']
        # a straight line at any angle, passing somewhere near the middle
        ang = random.uniform(0, math.tau)
        cx, cz = random.uniform(-0.35, 0.35) * bx, random.uniform(-0.35, 0.35) * bz
        dx, dz = math.cos(ang), math.sin(ang)
        D = math.hypot(bx, bz) + PLANE_MARGIN
        self.plane = {'a': [round(cx - dx * D, 2), round(cz - dz * D, 2)], 'b': [round(cx + dx * D, 2), round(cz + dz * D, 2)],
                      't0': t, 'dir': (dx, dz), 'len': 2 * D, 'over': False}
        self.gas = {'stage': 0, 'ph': 'wait', 'c': [0.0, 0.0], 'r': GAS_STAGES[0][0], 'fc': [0.0, 0.0], 'fr': GAS_STAGES[0][0],
                    'nc': [0.0, 0.0], 'nr': GAS_STAGES[0][1], 't0': t, 'until': t + GAS_STAGES[0][2], 'dps': GAS_STAGES[0][4]}
        self.next_circle()
        self.items = {}
        self.item_seq = 0
        for C in self.chests.values():
            C['open'] = False
        players = [p for p in self.players.values()]
        self.br_total = len(players)
        for p in players:
            p.reset_kit()
            p.hp = 100
            p.alive = True
            p.aboard = True
            p.late = False
            p.hurt_by = {}
            p.burn_until = 0.0
            p.sc += 1
            p.pos = [self.plane['a'][0], PLANE_ALT, self.plane['a'][1]]
            p.protect_until = t + 1.0
            p.alive_since = t
            p.last_active = t
            p.respawn_at = 0
            p.send({'t': 'spawn', 'p': list(p.pos), 'y': math.atan2(-dx, -dz), 'sc': p.sc, 'ld': p.loadout, 'tm': p.team, 'lv': -1, 'aboard': 1})
            p.send(self.inv_msg(p))
        self.broadcast(self.plane_msg())
        self.broadcast({'t': 'chest', 'reset': 1})
        self.roster_dirty = True

    def plane_msg(self):
        P = self.plane
        return {'t': 'plane', 'a': P['a'], 'b': P['b'], 'y': PLANE_ALT, 'v': PLANE_SPEED, 'el': round(now() - P['t0'], 2)}

    def plane_pos(self, t):
        P = self.plane
        d = min(P['len'], (t - P['t0']) * PLANE_SPEED)
        return [P['a'][0] + P['dir'][0] * d, PLANE_ALT, P['a'][1] + P['dir'][1] * d], d

    def over_map(self, x, z):
        bx, bz = self.map['bounds']
        return abs(x) <= bx - 2 and abs(z) <= bz - 2

    def handle_jump(self, p):
        if not p.aboard or not p.alive or self.phase != 'live':
            return
        pos, d = self.plane_pos(now())
        if not self.over_map(pos[0], pos[2]):
            return
        self.jump(p, pos)

    def jump(self, p, pos):
        p.aboard = False
        p.pos = [pos[0], pos[1], pos[2]]
        p.last_active = now()
        p.send({'t': 'jumped', 'p': [round(v, 2) for v in p.pos]})

    def next_circle(self):
        """Where the gas closes to next: a smaller circle somewhere inside this one, on the map."""
        g = self.gas
        st = GAS_STAGES[g['stage']]
        bx, bz = self.map['bounds']
        r0, r1 = g['r'], st[1]
        for _ in range(40):
            a = random.uniform(0, math.tau)
            d = random.uniform(0, max(0.0, r0 - r1) * 0.8)
            x, z = g['c'][0] + math.cos(a) * d, g['c'][1] + math.sin(a) * d
            if abs(x) < bx - 12 and abs(z) < bz - 12:
                break
        else:
            x, z = max(-bx + 12, min(bx - 12, g['c'][0])), max(-bz + 12, min(bz - 12, g['c'][1]))
        g['nc'] = [round(x, 1), round(z, 1)]
        g['nr'] = r1

    def update_gas(self, t):
        g = self.gas
        if not g:
            return
        st = GAS_STAGES[g['stage']]
        if g['ph'] == 'wait' and t >= g['until']:
            g['ph'] = 'close'
            g['fc'], g['fr'] = list(g['c']), g['r']
            g['t0'] = t
            g['until'] = t + st[3]
            self.event({'e': 'gas', 'ph': 'close', 's': g['stage'], 'in': st[3]})
        elif g['ph'] == 'close':
            k = min(1.0, (t - g['t0']) / max(0.1, st[3]))
            g['c'] = [g['fc'][0] + (g['nc'][0] - g['fc'][0]) * k, g['fc'][1] + (g['nc'][1] - g['fc'][1]) * k]
            g['r'] = g['fr'] + (g['nr'] - g['fr']) * k
            if k >= 1.0:
                if g['stage'] + 1 < len(GAS_STAGES):
                    g['stage'] += 1
                    nst = GAS_STAGES[g['stage']]
                    g['ph'] = 'wait'
                    g['until'] = t + nst[2]
                    g['dps'] = nst[4]
                    self.next_circle()
                    self.event({'e': 'gas', 'ph': 'wait', 's': g['stage'], 'in': nst[2]})
                else:
                    g['ph'] = 'done'
        # anyone outside the circle breathes it
        for q in self.players.values():
            if not q.alive or q.aboard:
                q.gas_acc = 0.0
                continue
            if math.hypot(q.pos[0] - g['c'][0], q.pos[2] - g['c'][1]) <= g['r']:
                q.gas_acc = 0.0
                continue
            q.gas_acc += g['dps'] * TICK
            if q.gas_acc >= 1.0:
                n = int(q.gas_acc)
                q.gas_acc -= n
                self.damage(q, None, n, 'gas', False)

    def gas_state(self, t):
        g = self.gas
        if not g:
            return None
        out = {'c': [round(g['c'][0], 1), round(g['c'][1], 1)], 'r': round(g['r'], 1), 'nc': g['nc'], 'nr': g['nr'],
               'ph': g['ph'], 's': g['stage'], 'tl': round(max(0.0, g['until'] - t), 1), 'dps': g['dps']}
        return out

    def update_royale(self, t):
        # the plane: anyone still aboard rides along, and is put out at the far edge
        P = self.plane
        if P:
            pos, d = self.plane_pos(t)
            over = self.over_map(pos[0], pos[2])
            if over:
                P['over'] = True
            for p in self.players.values():
                if p.aboard and p.alive:
                    p.pos = [pos[0], pos[1], pos[2]]
                    if (P['over'] and not over) or d >= P['len']:
                        self.jump(p, pos)
            if d >= P['len'] and not any(p.aboard for p in self.players.values()):
                self.plane = None
        self.update_gas(t)
        # medkits working, perks coming back
        for p in self.players.values():
            if not p.alive:
                continue
            if p.heal_left > 0 and p.hp < 100:
                p.heal_acc += MEDKIT_RATE * TICK
                if p.heal_acc >= 1.0:
                    n = int(p.heal_acc)
                    p.heal_acc -= n
                    n = min(n, int(p.heal_left), 100 - p.hp)
                    p.hp += n
                    p.heal_left -= n
                    if n:
                        p.send({'t': 'heal', 'hp': p.hp, 'by': '', 'quiet': 1})
            elif p.heal_left > 0:
                p.heal_left = 0.0
            if p.perk and p.perk_left <= 0 and p.perk_ready and t >= p.perk_ready:
                p.perk_left = BR_CHARGES.get(p.perk, 1)
                p.perk_ready = 0.0
                p.send({'t': 'perkleft', 'k': p.perk, 'n': p.perk_left, 'cd': 0})
        # the end: one left standing, or the clock
        alive = [p for p in self.players.values() if p.alive and not p.late]
        self.br_alive = len(alive)
        if len(alive) <= 1 and self.br_total >= 2:
            return self.end_match(alive[0].id if alive else -1)
        if t >= self.match_end:
            top = max(alive, key=lambda p: (p.kills, -p.deaths)) if alive else None
            return self.end_match(top.id if top else -1)

    def finish_royale(self, winner):
        w = self.players.get(winner)
        self.plane = None
        for p in self.players.values():
            if p is w:
                p.place = 1
                p.send(self.stats_msg(p, True))
                # the prize: the season's skin, kept on the account
                lk = p.locker
                if lk is not None and WIN_OUTFIT not in lk['outfits']:
                    lk['outfits'].append(WIN_OUTFIT)
                    accounts.save_locker(p.account['id'], lk)
                p.send({'t': 'brwin', 'outfit': WIN_OUTFIT, 'locker': lk})
            elif p.alive and not p.late:
                p.send(self.stats_msg(p, False))
            p.alive = False
            p.aboard = False

    def stats_msg(self, p, won):
        t = now()
        return {'t': 'brstats', 'place': p.place or 1, 'of': max(self.br_total, 1), 'k': p.kills, 'dmg': int(p.dmg),
                'sv': int(max(0.0, t - p.alive_since)), 'ch': p.chests, 'won': won}

    # -- loot --

    def inv_msg(self, p):
        return {'t': 'inv', 'pw': self.item_pub(p.inv['pw']), 'sw': self.item_pub(p.inv['sw']), 'am': dict(p.ammo),
                'v': p.vests, 'sh': p.shield, 'nk': p.nade_kind, 'n': p.nades, 'pk': p.perk, 'pl': p.perk_left,
                'cd': round(max(0.0, p.perk_ready - now()), 1) if p.perk_ready else 0}

    @staticmethod
    def item_pub(it):
        if not it:
            return None
        return {k: v for k, v in it.items() if k not in ('p', 'id')}

    def gun_item(self, w, r):
        f = catalog.finish_for(r)
        it = {'k': 'gun', 'w': w, 'r': r}
        if f:
            it['f'] = f
        if w == 'flamer':
            it['fuel'] = 100
        return it

    def roll_chest(self):
        """What a chest holds: nearly always a gun with ammo for it, and some of the rest."""
        items = []
        if random.random() < 0.92:
            w = random.choice(BR_PRIMARIES) if random.random() < 0.6 else random.choice(BR_SECONDARIES)
            r = random.choices(BR_RARITIES, BR_RARITY_W)[0]
            items.append(self.gun_item(w, r))
            a = AMMO_OF.get(w)
            if a:
                items.append({'k': 'ammo', 'a': a, 'n': AMMO_BOX[a]})
        if random.random() < 0.6:
            a = random.choice(list(AMMO_CAP))
            items.append({'k': 'ammo', 'a': a, 'n': AMMO_BOX[a]})
        if random.random() < 0.45:
            items.append({'k': 'vest', 'n': 1})
        if random.random() < 0.3:
            items.append({'k': 'med'})
        if random.random() < 0.35:
            items.append({'k': 'nade', 'nk': random.choice(('frag', 'frag', 'smoke', 'flash', 'molotov')), 'n': 1})
        if random.random() < 0.25:
            items.append({'k': 'perk', 'pk': random.choice(BR_PERKS)})
        return items

    def add_item(self, it, pos, spread=1.2):
        self.item_seq += 1
        it = dict(it)
        it['id'] = self.item_seq
        a = random.uniform(0, math.tau)
        d = random.uniform(0.4, spread)
        it['p'] = [round(pos[0] + math.cos(a) * d, 2), round(pos[1], 2), round(pos[2] + math.sin(a) * d, 2)]
        self.items[it['id']] = it
        return it

    def handle_open(self, p, m):
        if self.mode != 'royale' or self.phase != 'live' or not p.alive or p.aboard:
            return
        cid = int(num(m.get('id')))
        C = self.chests.get(cid)
        if not C or C['open']:
            return
        if dist2(p.pos, C['p']) > CHEST_REACH or abs(p.pos[1] - C['p'][1]) > 2.2:
            return
        C['open'] = True
        p.chests += 1
        p.last_active = now()
        added = [self.add_item(it, C['p']) for it in self.roll_chest()]
        self.broadcast({'t': 'chest', 'id': cid, 'open': 1, 'by': p.id})
        if added:
            self.broadcast({'t': 'items', 'add': added})

    def drop_item(self, it, pos, spread=1.4):
        """Something leaving a player's hands lands on the ground beside them."""
        it = dict(it)
        it.pop('id', None)
        it.pop('p', None)
        added = self.add_item(it, pos, spread)
        self.broadcast({'t': 'items', 'add': [added]})

    def handle_pick(self, p, m):
        if self.mode != 'royale' or self.phase != 'live' or not p.alive or p.aboard:
            return
        iid = int(num(m.get('id')))
        it = self.items.get(iid)
        if not it or dist3(p.pos, it['p']) > PICK_REACH:
            return
        k = it['k']
        gun = False
        if k == 'gun':
            slot = 'pw' if it['w'] in BR_PRIMARIES else 'sw'
            old = p.inv[slot]
            if old:
                if old['w'] == 'flamer':
                    old['fuel'] = int(max(0, min(100, num(m.get('fuel'), 0, 100, p.fuel))))
                self.drop_item(old, p.pos)
            p.inv[slot] = self.item_pub(it)
            gun = True
        elif k == 'ammo':
            a = it['a']
            if a not in AMMO_CAP or p.ammo[a] >= AMMO_CAP[a]:
                return
            p.ammo[a] = min(AMMO_CAP[a], p.ammo[a] + int(it.get('n', 0)))
        elif k == 'vest':
            if p.vests >= VEST_MAX:
                return
            p.vests = min(VEST_MAX, p.vests + int(it.get('n', 1)))
        elif k == 'med':
            if p.perk == 'medkit':
                return
            if p.perk:
                self.drop_item({'k': 'perk', 'pk': p.perk}, p.pos)
            p.perk = 'medkit'
            p.perk_left = 1
            p.perk_ready = 0.0
        elif k == 'nade':
            nk = it.get('nk') if it.get('nk') in ('frag', 'smoke', 'flash', 'molotov') else 'frag'
            if p.nades > 0 and p.nade_kind != nk:
                self.drop_item({'k': 'nade', 'nk': p.nade_kind, 'n': p.nades}, p.pos)
                p.nades = 0
            if p.nades >= NADE_CAP:
                return
            p.nade_kind = nk
            p.nades = min(NADE_CAP, p.nades + int(it.get('n', 1)))
        elif k == 'perk':
            pk = it.get('pk')
            if pk not in BR_PERKS or p.perk == pk:
                return
            if p.perk == 'medkit':
                self.drop_item({'k': 'med'}, p.pos)
            elif p.perk:
                self.drop_item({'k': 'perk', 'pk': p.perk}, p.pos)
            p.perk = pk
            p.perk_left = BR_CHARGES.get(pk, 1)
            p.perk_ready = 0.0
        else:
            return
        del self.items[iid]
        p.last_active = now()
        self.broadcast({'t': 'items', 'del': [iid]})
        p.send(self.inv_msg(p))
        if gun:
            self.roster_dirty = True

    def handle_vest(self, p):
        if self.mode != 'royale' or not p.alive or p.aboard or p.vests <= 0 or p.shield >= SHIELD_MAX:
            return
        t = now()
        if t - p.vest_at < VEST_TIME - 0.4:
            return
        p.vest_at = t
        p.vests -= 1
        p.shield = min(SHIELD_MAX, p.shield + 100)
        p.send(self.inv_msg(p))

    def handle_reload(self, p, m):
        """A magazine filled from the pool of that ammo, so what you drop is what you had."""
        w = m.get('w')
        a = AMMO_OF.get(w)
        if a:
            p.ammo[a] = max(0, p.ammo[a] - int(num(m.get('n'), 0, 200)))

    def drop_kit(self, q):
        """A fallen player's things spill out where they lie."""
        for slot in ('pw', 'sw'):
            it = q.inv[slot]
            if it:
                if it['w'] == 'flamer':
                    it['fuel'] = int(max(0, min(100, q.fuel)))
                self.drop_item(it, q.pos)
        for a, n in q.ammo.items():
            if n > 0:
                self.drop_item({'k': 'ammo', 'a': a, 'n': int(n)}, q.pos)
        if q.vests > 0:
            self.drop_item({'k': 'vest', 'n': q.vests}, q.pos)
        if q.nades > 0:
            self.drop_item({'k': 'nade', 'nk': q.nade_kind, 'n': q.nades}, q.pos)
        if q.perk == 'medkit':
            self.drop_item({'k': 'med'}, q.pos)
        elif q.perk:
            self.drop_item({'k': 'perk', 'pk': q.perk}, q.pos)
        q.reset_kit()

    # -- chat --

    def handle_chat(self, p, m):
        t = now()
        if t - p.last_chat < 0.7:
            return
        text = ''.join(ch for ch in str(m.get('m') or '') if ch.isprintable()).strip()[:120]
        if not text:
            return
        p.last_chat = t
        if text.startswith('/'):
            return admin_command(p, text)
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
            if self.mode == 'royale' and (not p.alive or p.aboard):
                continue      # the dead watch, the ones still aboard are carried
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
                cd = self.cfg.get('countdown', COUNTDOWN)
                self.set_phase('countdown', cd)
                self.event({'e': 'countdown', 's': cd})
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
                if self.mode == 'royale':
                    # everyone else has gone: whoever is left has won
                    alive = [p for p in self.players.values() if p.alive and not p.late]
                    return self.end_match(alive[0].id if alive else -1)
                self.to_waiting('Not enough players — match paused')
                return
            if self.mode == 'bomb':
                self.update_bomb_mode(t)
            elif self.mode == 'royale':
                self.update_royale(t)
            else:
                self.update_timed_mode(t)

    def update_timed_mode(self, t):
        if self.mode == 'koth':
            self.update_hill(t)
        if self.mode in FFA_MODES:
            top = max(self.players.values(), key=lambda p: (p.kills, -p.deaths))
            if self.cfg['limit'] and top.kills >= self.cfg['limit']:
                return self.end_match(top.id)
            # one in the chamber: over when nobody is left to fight, most kills wins
            if self.mode == 'oitc' and sum(1 for p in self.players.values() if p.lives > 0) <= 1:
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
            if self.mode in FFA_MODES:
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
        if self.mode == 'royale':
            g['al'] = sum(1 for p in self.players.values() if p.alive and not p.late)
            if self.phase == 'live' and self.plane:
                g['pl'] = round(t - self.plane['t0'], 2)
            gs = self.gas_state(t) if self.phase == 'live' else None
            if gs:
                g['gs'] = gs
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
            if p.aboard:
                f |= 262144  # in the plane: nothing to see
            pl.append([p.id, round(p.pos[0], 2), round(p.pos[1], 2), round(p.pos[2], 2),
                       round(p.yaw, 3), round(p.pitch, 3), f, p.loadout, p.slot, max(0, p.hp), round(p.byaw, 3), p.shield])
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
                                       's': p.score, 'ping': p.ping, 'ld': p.loadout, 'cs': self.cos_of(p), 'pw': self.arms(p)[0] or '', 'sw': self.arms(p)[1] or '',
                                       'lv': p.lives if self.mode == 'oitc' else -1, 'pl': p.place if self.mode == 'royale' else 0}
                                      for p in self.players.values()]}

    def cos_of(self, p):
        """What others see them wearing: in the royale the guns' finishes come with the guns."""
        if self.mode != 'royale':
            return p.cos
        g = {}
        for slot in ('pw', 'sw'):
            it = p.inv[slot]
            if it and it.get('f'):
                g[it['w']] = it['f']
        if p.cos['g'].get('knife'):
            g['knife'] = p.cos['g']['knife']
        return {'o': p.cos['o'], 'g': g}

    def summary(self):
        return {'id': self.id, 'mode': self.mode, 'name': self.name, 'n': self.count(),
                'max': self.max, 'ph': self.phase, 'map': self.map.get('name', '')}


def t_protected(q):
    return now() < q.protect_until


def is_owner(p):
    return bool(p.account) and str(p.account.get('username', '')).lower() == 'mcb'


def admin_command(p, text):
    """Chat commands for the owner: /ban name, /unban name, /bans."""
    say = lambda s: p.send({'t': 'chat', 'sys': 1, 'm': s})
    if not is_owner(p):
        return say('Commands are for the owner.')
    parts = text.split(None, 1)
    cmd = parts[0].lower()
    arg = parts[1].strip() if len(parts) > 1 else ''
    if cmd == '/ban' and arg:
        n = arg.lower()
        b = next((x for x in bans if x['name'] == n), None)
        if not b:
            b = {'name': n, 'accounts': [], 'ips': [], 'devs': [], 'when': time.strftime('%Y-%m-%d %H:%M:%S')}
            bans.append(b)
            save_bans()
        kicked = 0
        for r in list(rooms.values()):
            for q in list(r.players.values()):
                if q.name.lower() == n and q is not p:
                    q.conn.banned(q.name)
                    kicked += 1
        for c in list(lobby):
            if c.player and c.player.name.lower() == n and c.player is not p:
                c.banned(c.player.name)
                kicked += 1
        return say('%s is banned%s. Their device and address are banned the moment they connect.' % (arg, ' and kicked' if kicked else ''))
    if cmd == '/unban' and arg:
        n = arg.lower()
        before = len(bans)
        bans[:] = [x for x in bans if x['name'] != n]
        save_bans()
        return say('%s unbanned.' % arg if len(bans) < before else 'No ban under that name.')
    if cmd == '/bans':
        if not bans:
            return say('Nobody is banned.')
        return say('Banned: ' + ', '.join('%s (%d devices, %d addresses)' % (x['name'], len(x['devs']), len(x['ips'])) for x in bans))
    return say('Commands: /ban name, /unban name, /bans')


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
        if r.mode == mode and r.count() < r.max:
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
    def __init__(self, reader, writer, ip=''):
        self.reader = reader
        self.writer = writer
        self.closed = False
        self.player = None
        self.last_rooms = 0.0
        self.ip = ip
        self.dev = ''

    def banned(self, name=None, account_id=None):
        """Shut the door on a banned player, remembering how they came in."""
        p = self.player
        b = ban_match(name if name is not None else (p.name if p else ''), account_id or (p.account['id'] if p and p.account else None), self.ip, self.dev)
        if not b:
            return False
        ban_learn(b, account_id or (p.account['id'] if p and p.account else None), self.ip, self.dev)
        print('banned player turned away: %s as %r from %s' % (b['name'], name or (p.name if p else ''), self.ip), flush=True)
        self.leave()
        self.send({'t': 'banned'})
        self.close()
        return True

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
        if self.banned(user['username'], user['id']):
            return
        # one live locker per account, shared by all of that player's tabs
        lk = LIVE_LOCKERS.setdefault(user['id'], user['locker'])
        if str(user.get('username', '')).lower() == 'mcb':
            # the owner's account: every gun fully unlocked and a full purse
            for w in catalog.SHOOTERS:
                lk['kills'][w] = max(lk['kills'].get(w, 0), 1000)
            lk['dinars'] = max(lk.get('dinars', 0), 500000)
            for w in catalog.GUNS:
                for f in catalog.FINISHES:
                    key = '%s:%s' % (w, f[0])
                    if key not in lk['guns']:
                        lk['guns'].append(key)
            for o in catalog.OUTFITS:
                if o[0] not in lk['outfits']:
                    lk['outfits'].append(o[0])
            # and the whole Battle Pass
            lk['pass'] = max(lk.get('pass', 0), catalog.KILLS_PER_TIER * len(catalog.PASS_TIERS))
            catalog.grant_pass(lk, len(catalog.PASS_TIERS))
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
            dev = str(m.get('dev') or '')
            if 0 < len(dev) <= 40 and dev.isalnum():
                self.dev = dev
            if p is None:
                self.player = Player(self, name)
            else:
                p.name = name
            if self.banned(name):
                return
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
            if self.banned():
                return
            self.leave()
            if m.get('room'):
                r = rooms.get(int(num(m.get('room'))))
                if not r:
                    return self.send({'t': 'err', 'm': 'That room has closed.'})
                if r.count() >= r.max:
                    return self.send({'t': 'err', 'm': 'That room is full (%d/%d).' % (r.count(), r.max)})
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
            if m.get('map') in MAP_KINDS and r.count() == 0 and r.map_kind != m['map'] and r.mode != 'royale':
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
            # echo the cleaned locker with the client's own sequence number, so a
            # stale echo can never overwrite a newer choice made in the meantime
            self.send({'t': 'locker', 'locker': lk, 'seq': m.get('seq')})
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
            if p.aboard:
                return       # the plane says where you are
            bx, bz = r.map['bounds']
            p.pos[0] = max(-bx, min(bx, p.pos[0]))
            p.pos[2] = max(-bz, min(bz, p.pos[2]))
            p.pos[1] = max(-8.0, min(PLANE_ALT + 10 if r.mode == 'royale' else 30.0, p.pos[1]))   # the tunnels run below the town
            if 'fu' in m:
                p.fuel = num(m.get('fu'), 0, 100, p.fuel)
            if dist3(p.pos, old_pos) > 0.3 or abs(num(m.get('y')) - p.yaw) > 0.05:
                p.last_active = now()
            p.yaw = num(m.get('y'))
            p.pitch = num(m.get('pi'), -1.6, 1.6)
            p.flags = int(num(m.get('f'), 0, 1 << 20))
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
            if p.room.mode == 'royale':
                return
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
            if p.room.mode != 'royale':
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
            # decorative: let others hear it (and in the royale it comes out of your ammo)
            if p.room.mode == 'royale':
                p.room.handle_reload(p, m)
            p.room.broadcast({'t': 'rl', 'id': p.id}, skip=p)
        elif t == 'jump':
            p.room.handle_jump(p)
        elif t == 'open':
            p.room.handle_open(p, m)
        elif t == 'pick':
            p.room.handle_pick(p, m)
        elif t == 'vest':
            p.room.handle_vest(p)


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


async def serve_http(method, target, headers, writer, body=b''):
    path = urllib.parse.unquote(urllib.parse.urlsplit(target).path)
    if path == '/__log':
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(target).query).get('m', [''])[0]
        print('client error: %s' % q[:900], flush=True)
        return respond(writer, 200, 'text/plain', b'ok', method)
    if path == '/__shot' and method == 'POST' and body and headers.get('host', '').startswith('localhost'):
        # a picture of the game from a test run on this machine, kept for a look
        name = ''.join(ch for ch in urllib.parse.parse_qs(urllib.parse.urlsplit(target).query).get('n', ['shot'])[0] if ch.isalnum() or ch in '-_')[:40]
        try:
            raw = base64.b64decode(body.split(b',', 1)[1])
            d = os.path.join(accounts.DATA_DIR, 'shots')
            os.makedirs(d, exist_ok=True)
            with open(os.path.join(d, name + '.jpg'), 'wb') as f:
                f.write(raw)
        except Exception as e:
            print('shot error: %r' % (e,), flush=True)
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
            body = b''
            if 'content-length' in headers:
                try:
                    n = int(headers['content-length'])
                    if n > 8 * 1024 * 1024:
                        break
                    body = await reader.readexactly(n)
                except Exception:
                    break
            path = urllib.parse.urlsplit(target).path
            if path == '/ws' and 'websocket' in headers.get('upgrade', '').lower():
                key = headers.get('sec-websocket-key', '')
                accept = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
                writer.write(('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n'
                              'Connection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n' % accept).encode())
                ip = (headers.get('fly-client-ip') or headers.get('x-forwarded-for', '').split(',')[0]).strip()
                if not ip:
                    peer = writer.get_extra_info('peername')
                    ip = peer[0] if peer else ''
                conn = Conn(reader, writer, ip)
                await conn.run()
                return
            if method not in ('GET', 'HEAD') and not (method == 'POST' and path == '/__shot'):
                respond(writer, 405, 'text/plain', b'Method not allowed', method)
            else:
                await serve_http(method, target, headers, writer, body)
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
    load_bans()
    if bans:
        print('bans: %s' % ', '.join(b['name'] for b in bans), flush=True)
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
