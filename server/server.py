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
import zlib
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
try:
    from zoneinfo import ZoneInfo
    SYDNEY = ZoneInfo('Australia/Sydney')
except Exception:  # no tz database: the party runs on the server's own clock
    SYDNEY = None
import catalog  # noqa: E402
import accounts  # noqa: E402
import shop  # noqa: E402
import mailer  # noqa: E402
import daily  # noqa: E402
from og import game as og  # noqa: E402

VERSION = '3.8.0'
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
    # golf carts round a circuit on the Dockyard: crash into people, or grenade them
    'derby':     {'name': 'Derby',              'time': 480, 'limit': 20, 'respawn': 1.0, 'max': 12},
    # Attack and Defend, on the Long Souk: attackers push through three sectors of two points
    'rush':         {'name': 'Rush',         'time': 1800, 'limit': 0, 'respawn': 6.0, 'max': 20},
    'breakthrough': {'name': 'Breakthrough', 'time': 1800, 'limit': 0, 'respawn': 6.0, 'max': 20},
}
AD_MODES = ('rush', 'breakthrough')
AD_TICKETS = int(os.environ.get('SOUK_AD_TICKETS') or 40)   # the attackers' lives, per sector (anyone may use them; the team runs out together)
AD_ARM = 4.0             # seconds holding E to arm or disarm a Rush bomb
AD_FUSE = 40.0           # seconds an armed bomb takes to go off
AD_CAP = 25.0            # seconds attackers must outnumber defenders on a Breakthrough point to take it (and the same back)
AD_REACH = 2.8           # how close to the bomb you have to be
AD_BLAST = 9.0           # the bomb's blast reaches this far
_ad_scale = float(os.environ.get('SOUK_AD') or 1.0)    # SOUK_AD=0.1 makes arming, the fuse and capturing ten times quicker, for the tests
AD_ARM *= _ad_scale
AD_FUSE *= _ad_scale
AD_CAP *= _ad_scale
NICHE_MODES = ('snipers', 'knives', 'firefight', 'oitc')
FFA_MODES = ('ffa',) + NICHE_MODES + ('royale', 'derby')
# what a niche mode hands you: (primary, secondary, grenade kinds); None is nothing in that slot
NICHE_ARMS = {
    'snipers':   ('heavy', None, ()),
    'knives':    (None, None, ()),
    'firefight': ('flamer', None, ('molotov',)),
    'oitc':      (None, 'pistol', ()),
}
OITC_LIVES = 3
TEAM_MODES = ('tdm', 'koth', 'bomb') + AD_MODES
# the Derby: everyone in a golf cart, grenades only, and any grenade damage at all kills
DERBY_NADES = 3
DERBY_CRASH_SPEED = 3.5    # metres a second a cart must be doing to kill what it hits
DERBY_CRASH_REACH = 3.4    # how far from the cart's middle a hit can be

# -- the battle royale --------------------------------------------------------
PLANE_ALT = 160.0          # how high the plane flies
PLANE_SPEED = 24.0         # metres a second
NIGHT_CHANCE = float(os.environ.get('SOUK_NIGHT') or 0.4)   # how often a match is played after dark
BOT_FILL = int(os.environ.get('SOUK_BOTS') or 0)            # a quiet royale is filled up to this many with bots (none, since 3.6.1)
BOT_NAMES = ['Bot Ahmed', 'Bot Layla', 'Bot Omar', 'Bot Zara', 'Bot Idris', 'Bot Nadia', 'Bot Samir', 'Bot Rania',
             'Bot Tariq', 'Bot Yasmin', 'Bot Karim', 'Bot Hana', 'Bot Faris', 'Bot Dalia']
BOT_SPEED = 4.6
FALL_SPEED = 26.0          # a player brought down by the server falls this fast
PLANE_MARGIN = 70.0        # it starts and ends this far outside the map
# the gas: (radius it closes from, radius it closes to, seconds before it moves, seconds it takes, health a second outside it)
GAS_STAGES = [(320.0, 140.0, 60.0, 45.0, 5), (140.0, 75.0, 35.0, 35.0, 5), (75.0, 40.0, 30.0, 30.0, 10),
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
VEST_MAX = 3                    # spare vests carried
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
    # the Gatling on the owner's Interceptor: only from its turret (see turret_ok)
    'minigun': {'dmg': 18, 'head': 1.5, 'near': 999, 'far': 999, 'min': 1.0, 'rpm': 3000, 'pellets': 1, 'range': 300},
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
PERKS = ['launcher', 'med', 'ladder', 'beacon']
# the perks a loadout may pick from (first is the default), and the grenades
# the Assault's grenade launcher took the ammo crate's place; the Breacher may carry one too
PERK_OPTIONS = [('launcher',), ('med', 'wall'), ('ladder', 'launcher'), ('beacon', 'drone', 'knives')]
NADE_OPTIONS = [('frag', 'molotov'), ('frag', 'smoke'), ('frag', 'flash', 'molotov'), ('frag',)]
PERK_USES = {'ammo': 2, 'med': 2, 'ladder': 1, 'beacon': 1, 'wall': 2, 'drone': 1, 'knives': 3, 'launcher': 0}
LAUNCH_REACH = 150.0    # a launched grenade may go off this far from the gun (a thrown one, 60)
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
NADE_KILLS = ('frag', 'molotov', 'launcher', 'nade', 'smoke', 'flash')     # what counts as a grenade kill for the dailies
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
ADMIN_KILL = 'struck down'
ARMOUR_FLAG = 1048576           # the Interceptor's bulletproof walls are up (a movement flag)      # the owner's /kill: what the kill feed calls it; it counts for nothing

# -- scorestreaks: kills in one life, in Free for All, Team Deathmatch and King of the Hill --
# Two kills: a scan that marks every enemy on the map. Five: an airstrike on a spot you
# pick from above. Eight: the door gun of a helicopter circling the town. Ten: a carpet
# bombing down a line across the map that nobody picks.
STREAK_MODES = ('ffa', 'tdm', 'koth')
STREAKS = ((2, 'scan'), (5, 'strike'), (8, 'heli'), (10, 'carpet'))
HELI_FLAG = 2097152         # in the helicopter's door (the server sets it, like the plane's flag)
SCAN_LIFE = 30.0            # the scan: every enemy marked, this long
SCAN_EVERY = 2.5
HELI_LIFE = 45.0            # seconds in the gunner's seat
HELI_ALT = 30.0             # about a hundred feet up
HELI_MARGIN = 12.0          # its circuit runs this far outside the town walls
HELI_CORNER = 22.0          # rounded corners of that circuit
HELI_SPEED = 22.0           # metres a second round it
HELI_SEAT = (1.05, -1.0, 0.2)   # the gunner's feet: left of the hub, below it, a little behind it
STRIKE_DELAY = 5.0          # seconds from the call to the bombs landing
STRIKE_R = 7.5              # the circle the bombs cover: fifteen metres across
STRIKE_KILL_R = 5.0         # the middle ten metres: anyone in the open dies
STRIKE_DMG = 50             # the rest of the circle, and anyone under a roof inside it
CARPET_WARN = 4.0           # seconds from the call to the first bomb landing at the map's edge
CARPET_SPEED = 32.0         # metres a second the bombs walk down the line (the jets fly at that too)
CARPET_W = 14.0             # half the width of the swath: twenty-eight metres, roof or no roof
CARPET_BACK = 5.0           # the blast lingers this far behind the front, and reaches this far ahead
CARPET_AHEAD = 2.0
CARPET_MARGIN = 12.0        # the line starts and ends this far outside the walls
# SOUK_STREAK=0.2 makes the scan, the helicopter and the strike's wait five times quicker, for the tests
_streak_scale = float(os.environ.get('SOUK_STREAK') or 1.0)
STREAK_FREE = os.environ.get('SOUK_STREAK_FREE') == '1'     # every life starts with all three, for looking at them
# -- practice dummies, for a test server only (SOUK_DUMMIES=3): stand-still bots that follow you
# into whatever room you join, so there is something to shoot at. /bots N in chat changes the number.
DUMMIES = int(os.environ.get('SOUK_DUMMIES') or 0)
DUMMY_NAMES = ['Dummy Adil', 'Dummy Basma', 'Dummy Cem', 'Dummy Dina', 'Dummy Emir', 'Dummy Farah', 'Dummy Ghali', 'Dummy Hind',
               'Dummy Ilyas', 'Dummy Jana', 'Dummy Kadir', 'Dummy Lina']
SCAN_LIFE *= _streak_scale
HELI_LIFE *= _streak_scale
STRIKE_DELAY *= _streak_scale
CARPET_WARN *= _streak_scale
POSTMATCH = 12.0
PROTECT = 1.5
# players who neither move nor act for this long are taken out of their match
IDLE_KICK = float(os.environ.get('SOUK_IDLE') or 300.0)

# -- the first month: 22 October 2026, Sydney time -----------------------------------------
# Everyone who signs in or plays that day is given the "1 Month" outfit. The day runs
# from 00:01 to 23:59.
PARTY_DATE = os.environ.get('SOUK_PARTY_DATE') or '2026-10-22'
PARTY_OUTFIT = 'month1'


def party_day():
    import datetime
    t = datetime.datetime.now(SYDNEY) if SYDNEY else datetime.datetime.now()
    if t.strftime('%Y-%m-%d') != PARTY_DATE:
        return False
    m = t.hour * 60 + t.minute
    return 1 <= m <= 23 * 60 + 59


def give_party_outfit(p):
    """The gift onto a signed-in player's locker, once; tells them if it is new."""
    lk = p.locker
    if lk is None or not party_day():
        return
    if PARTY_OUTFIT in lk.setdefault('outfits', []):
        return
    lk['outfits'].append(PARTY_OUTFIT)
    accounts.save_locker(p.account['id'], lk)
    p.send({'t': 'gift', 'outfit': PARTY_OUTFIT, 'locker': lk, 'why': 'month'})


# -- the menu's facts: what has been played most, all time -------------------------------
FACTS_FILE = os.path.join(accounts.DATA_DIR, 'facts.json')
facts = {'modes': {}, 'guns': {}, 'kills': 0, 'matches': 0}
facts_dirty = False
facts_saved_at = 0.0


def load_facts():
    global facts
    try:
        with open(FACTS_FILE) as f:
            d = json.load(f)
        for k in ('modes', 'guns'):
            if isinstance(d.get(k), dict):
                facts[k] = {str(a): int(b) for a, b in d[k].items()}
        facts['kills'] = int(d.get('kills', 0))
        facts['matches'] = int(d.get('matches', 0))
    except (OSError, ValueError):
        pass


def fact_bump(kind, key):
    global facts_dirty
    facts[kind][key] = facts[kind].get(key, 0) + 1
    facts['matches' if kind == 'modes' else 'kills'] += 1
    facts_dirty = True


def save_facts(force=False):
    global facts_dirty, facts_saved_at
    t = now()
    if not force and (not facts_dirty or t - facts_saved_at < 15):
        return
    facts_dirty = False
    facts_saved_at = t
    try:
        os.makedirs(accounts.DATA_DIR, exist_ok=True)
        with open(FACTS_FILE, 'w') as f:
            json.dump(facts, f)
    except OSError as e:
        print('facts file error: %r' % (e,), flush=True)


_gun_totals = {'at': 0.0, 'v': {}}


def facts_public():
    """The counters, plus every account's kills by gun (summed once a minute at most)."""
    t = now()
    if ACCOUNTS and t - _gun_totals['at'] > 60:
        _gun_totals['at'] = t
        try:
            _gun_totals['v'] = accounts.gun_totals()
        except Exception as e:
            print('gun totals error: %r' % (e,), flush=True)
    guns = dict(_gun_totals['v'])
    for w, n in facts['guns'].items():
        guns[w] = max(guns.get(w, 0), n)
    return {'modes': facts['modes'], 'guns': guns, 'kills': facts['kills'], 'matches': facts['matches'],
            'accounts': accounts.user_count() if ACCOUNTS else 0, 'party': party_day()}


load_facts()


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


# The owner can never be banned. Devices the owner has signed in from are
# remembered here, so a shared address (a school's, a household's) that ended
# up on some banned player's record can't shut the owner out before sign-in.
OWNER_NAME = 'mcb'
OWNER_FILE = os.path.join(accounts.DATA_DIR, 'owner.json')
owner_devs = set()


def load_owner():
    global owner_devs
    try:
        with open(OWNER_FILE) as f:
            owner_devs = set(x for x in json.load(f).get('devs', []) if isinstance(x, str))
    except (OSError, ValueError, AttributeError):
        owner_devs = set()


def save_owner():
    try:
        os.makedirs(accounts.DATA_DIR, exist_ok=True)
        with open(OWNER_FILE, 'w') as f:
            json.dump({'devs': sorted(owner_devs)}, f)
    except OSError as e:
        print('owner file error: %r' % (e,), flush=True)


def owner_heal(account_id, ip, dev):
    """Seen the owner: strip their account, address and device from every ban
    record, and remember the device so it is never caught again."""
    changed = False
    for b in bans:
        for key, v in (('accounts', account_id), ('ips', public_ip(ip)), ('devs', dev)):
            if v and v in b[key]:
                b[key].remove(v)
                changed = True
    if changed:
        save_bans()
    if dev and dev not in owner_devs:
        owner_devs.add(dev)
        save_owner()


def ban_match(name, account_id, ip, dev):
    n = (name or '').strip().lower()
    if dev and dev in owner_devs:
        return None
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
    if dev and dev in owner_devs:
        return
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


def _conns_of(uid):
    """Every connection signed in to an account."""
    out = []
    for r in rooms.values():
        for q in r.players.values():
            if q.account and q.account.get('id') == uid and not q.bot:
                out.append(q.conn)
    for c in lobby:
        if c.player and c.player.account and c.player.account.get('id') == uid:
            out.append(c)
    return out


# the shop grants into the live locker of anyone online, and tells their tabs
shop.live_lookup = lambda uid: LIVE_LOCKERS.get(uid)
shop.live_push = lambda uid: [c.send({'t': 'locker', 'locker': LIVE_LOCKERS[uid], 'seq': 0, 'bought': 1}) for c in _conns_of(uid) if uid in LIVE_LOCKERS]
next_ids = {'p': 1, 'r': 1}


def now():
    return time.monotonic()


def clean_name(n):
    n = ''.join(ch for ch in str(n or '') if ch.isprintable()).strip()
    return (n[:16] or 'Player')


def clean_cos(c):
    """Cosmetics a client says it is wearing: an outfit id and a finish per weapon."""
    ok = lambda v: isinstance(v, str) and 0 < len(v) <= 24 and v.replace('_', '').isalnum()
    out = {'o': 'standard', 'g': {}, 'ms': '', 'c': ''}
    if not isinstance(c, dict):
        return out
    if ok(c.get('o')):
        out['o'] = c['o']
    if c.get('c') in catalog.CART_IDS:
        out['c'] = c['c']
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
        # a guest's locker lives in their browser, so what they say goes, except for
        # the outfits that only ever go on an account by hand
        if cos['o'] in catalog.OWNER_ONLY:
            cos = dict(cos, o='standard')
        if cos.get('c') in catalog.OWNER_CARTS:
            cos = dict(cos, c='')
        return cos
    out = {'o': cos['o'] if cos['o'] in lk['outfits'] else 'standard', 'g': {}, 'ms': cos.get('ms', '') if cos.get('ms', '') in lk.get('muzzles', []) else '',
           'c': cos.get('c', '') if cos.get('c', '') in lk.get('carts', []) else ''}
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

def heli_path(bx, bz):
    """The helicopter's circuit: the town's walls pushed out by HELI_MARGIN, with rounded
    corners. Nine legs, flown in order; the same sums run on every screen (streaks.js)."""
    X, Z = bx + HELI_MARGIN, bz + HELI_MARGIN
    C = min(HELI_CORNER, X - 1.0, Z - 1.0)
    segs = []

    def line(a, b):
        segs.append(('line', a, b, math.hypot(b[0] - a[0], b[1] - a[1])))

    def arc(c, th0):
        segs.append(('arc', c, th0, math.pi / 2 * C))
    line((X, 0.0), (X, -Z + C))
    arc((X - C, -Z + C), 0.0)
    line((X - C, -Z), (-X + C, -Z))
    arc((-X + C, -Z + C), -math.pi / 2)
    line((-X, -Z + C), (-X, Z - C))
    arc((-X + C, Z - C), math.pi)
    line((-X + C, Z), (X - C, Z))
    arc((X - C, Z - C), math.pi / 2)
    line((X, Z - C), (X, 0.0))
    return {'segs': segs, 'len': sum(s[3] for s in segs), 'C': C}


def heli_at(path, s):
    """Where the helicopter is s metres round its circuit: x, z and its heading (a cart's
    yaw: it flies along +x at zero, and the gunner's door is on its left)."""
    s %= path['len']
    C = path['C']
    for kind, a, b, L in path['segs']:
        if s > L:
            s -= L
            continue
        if kind == 'line':
            k = s / L if L else 0.0
            dx, dz = b[0] - a[0], b[1] - a[1]
            return a[0] + dx * k, a[1] + dz * k, math.atan2(-dz, dx)
        th = b - s / C
        return a[0] + C * math.cos(th), a[1] + C * math.sin(th), math.pi / 2 - th
    return path['segs'][0][1][0], path['segs'][0][1][1], math.pi / 2


def heli_seat(path, s):
    """Where the gunner's feet are: in the left door, under the rotor."""
    x, z, a = heli_at(path, s)
    lx, lz = -math.sin(a), -math.cos(a)      # left of the heading
    bx_, bz_ = -math.cos(a), math.sin(a)     # behind it
    L, D, B = HELI_SEAT
    return [x + lx * L + bx_ * B, HELI_ALT + D, z + lz * L + bz_ * B]


class Player:
    def __init__(self, conn, name):
        self.id = next_ids['p']
        next_ids['p'] += 1
        self.conn = conn
        self.name = name
        self.bot = False
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
        # what this life was spawned with: choices made in the Locker mid-life (the
        # guns, the perk, the loadout) wait for the next one, as they do on screen
        self.carry = None        # (loadout, primary, secondary, perk)
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
        self.daily = None          # a guest's daily-challenge record for today (an account's lives on its locker)
        self.life_kills = 0
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
        self.afk_guard = False   # a fresh life outside the royale: unhurt until they make an input
        self.fall_y = None       # the royale drop: where their fall was last seen to go on
        self.fall_t = 0.0
        self.fall_force = False  # the server is bringing them down, because their client stopped
        self.fall_lock = 0.0     # stale positions from that client are ignored until then
        self.surv = 0            # seconds they lasted this match
        # scorestreaks: kills this life, the rewards earned and not yet used, the helicopter seat
        self.streak = 0
        self.streaks = []
        self.heli = None
        self.dummy = False       # a practice target on a test server: it stands there and takes it
        self.side = 0            # Attack and Defend: come back at the left (0) or right (1) point

    def send(self, obj):
        self.conn.send(obj)

    def acted(self):
        """Any input at all: the idle clock restarts, and a fresh life's protection ends."""
        self.last_active = now()
        self.afk_guard = False

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
        self.streak = 0
        self.streaks = []

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
        # scorestreaks in the air: scans running, helicopters up, strikes on their way
        self.scans = {}
        self.helis = {}
        self.strikes = []
        self.strike_seq = 0
        self.carpets = []
        self.dummy_want = DUMMIES
        self.ad = None           # Attack and Defend: the sector, the attackers' lives, the points' state
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
        if self.mode == 'derby':
            return 'derby'
        if self.mode in AD_MODES:
            return 'front'
        if FORCE_MAP:
            return FORCE_MAP
        # any of the four, never the same one twice running
        cur = getattr(self, 'map_kind', None)
        return random.choice([k for k in MAP_KINDS if k != cur] or list(MAP_KINDS))

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
            if self.mode in ('royale', 'derby'):
                self.map_kind = self.mode
            elif self.mode in AD_MODES:
                self.map_kind = 'front'
            else:
                self.map_kind = kind or (FORCE_MAP or getattr(self, 'map_kind', None) or MAP_KINDS[0])
            town = mapgen.generate(self.seed, self.map_kind)
        self.map = town.to_json()
        if self.mode == 'knives':
            # Knife Fight is on foot: no golf carts to drive about in
            self.map['deco'] = [d for d in self.map['deco'] if d.get('k') != 'golfcart']
        # night falls on four matches in ten, on every map but the royale's, the Manor and Ridgeline
        self.night = self.mode != 'royale' and self.map_kind not in ('manor', 'front', 'alpine') and random.random() < NIGHT_CHANCE
        self.map['night'] = self.night
        boxes = self.map['boxes']
        if self.mode == 'rush' and self.map.get('ad'):
            # the bombs stand solid: grenades and the strike's bombs don't reach through them
            boxes = boxes + [[P['x'], P['y'] + 1.15, P['z'], 0.65, 1.15, 0.55, P.get('face', 0.0), 'car', 0]
                             for S in self.ad_sectors() for P in S['pts']]
        self.solid = mapgen.Solid(boxes)
        # forklifts: driveable, so the server keeps their pose and who is at the wheel
        self.forklifts = {}
        for d in self.map['deco']:
            if d.get('k') in ('forklift', 'golfcart') and 'id' in d:
                self.forklifts[int(d['id'])] = {'p': [d['x'], d.get('y', 0.0), d['z']], 'y': d.get('yaw', 0.0), 'driver': None, 'k': d['k'],
                                                'v': 0.0, 'at': now(), 'home': (d['x'], d.get('y', 0.0), d['z'], d.get('yaw', 0.0))}
        self.track = self.map.get('track') or []
        self.circuit = heli_path(*self.map['bounds'])
        self.map_msg = json.dumps({'t': 'map', 'map': self.map}, separators=(',', ':'))
        self.map_frames = {False: frame(self.map_msg, False), True: frame(self.map_msg, True)}
        self.ladders = {}
        self.beacons = {}
        self.crates = {}
        self.crate_seq = 0
        self.walls = {}
        self.drones = {}
        self.fires = {}
        # the Manor's doors and windows: which doors stand open, which panes are gone
        self.door_open = set()
        self.panes_broken = set()
        self.door_index = {d['id']: d for d in self.map.get('doors', [])}
        self.pane_index = {d['id']: d for d in self.map.get('panes', [])}
        # loot chests, closed, where the map put them
        self.chests = {i + 1: {'p': [c[0], c[1], c[2]], 'open': False, 'gold': len(c) > 4 and bool(c[4])} for i, c in enumerate(self.map.get('chests', []))}
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
        if getattr(self, 'map_stale', False):
            self.map_stale = False
            self.new_map()
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
        p.conn.send_frame(self.map_frames[bool(p.conn.deflate)])
        for oid, L in self.ladders.items():
            p.send({'t': 'ladder', 'id': oid, 'p': L['p'], 'y': L['y'], 'h': L['h']})
        for oid, B in self.beacons.items():
            p.send({'t': 'beacon', 'id': oid, 'p': B['p'], 'tm': B['team'], 'age': round(now() - B['born'], 2)})
        for cid, C in self.crates.items():
            p.send({'t': 'supply', 'id': cid, 'k': C['k'], 'p': C['p'], 'tm': C['team'], 'owner': C['owner']})
        for wid, W in self.walls.items():
            p.send({'t': 'wall', 'id': wid, 'p': W['p'], 'y': W['y'], 'hp': int(W['hp']), 'tm': W['team'], 'owner': W['owner']})
        for did in getattr(self, 'door_open', ()):
            p.send({'t': 'door', 'id': did, 'open': 1})
        for pid in getattr(self, 'panes_broken', ()):
            p.send({'t': 'pane', 'id': pid, 'broken': 1})
        for oid, D in self.drones.items():
            p.send({'t': 'drone', 'id': oid, 'p': D['p'], 'tm': D['team'], 'life': round(D['until'] - now(), 1), 'hp': D['hp']})
        for fid in self.forklifts:
            p.send(self.fk_msg(fid))
        for fid, F in self.fires.items():
            p.send({'t': 'fire', 'id': fid, 'p': F['p'], 'life': round(F['until'] - now(), 1)})
        for oid in self.helis:
            p.send(self.heli_msg(oid, now()))
        for S in self.strikes:
            p.send({'t': 'strike', 'id': S['id'], 'p': S['p'], 'in': round(max(0.0, S['at'] - now()), 2), 'h': S['h'], 'by': S['owner'],
                    'byn': self.players[S['owner']].name if S['owner'] in self.players else '', 'tm': S['tm']})
        for C in self.carpets:
            p.send(self.carpet_msg(C, now()))
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
        if not p.bot:
            self.add_dummies()
            give_party_outfit(p)

    def add_dummies(self):
        """On a test server: the practice dummies come into any room a person is in."""
        if not self.dummy_want or self.mode == 'royale' or not any(not q.bot for q in self.players.values()):
            return
        have = [q for q in self.players.values() if q.dummy]
        want = min(self.dummy_want - len(have), self.max - self.count())
        for b in have[self.dummy_want:]:
            self.remove(b)
        names = [n for n in DUMMY_NAMES if n not in {q.name for q in self.players.values()}]
        for name in names[:max(0, want)]:
            b = Player(BotConn(), name)
            b.conn.player = b
            b.bot = True
            b.dummy = True
            b.pick({'ld': len(have) % 4})
            b.cos = owned_cos(b, clean_cos(None))
            have.append(b)
            self.add(b)

    def remove(self, p):
        self.leave_vehicle(p)
        for fid, F in self.forklifts.items():
            if F.get('owner') == p.id:
                F['owner'] = None
                if self.mode == 'derby':
                    # a Derby cart left on the track would be in everyone's way: back to the pits
                    F['p'] = list(F['home'][:3])
                    F['y'] = F['home'][3]
                    self.broadcast(self.fk_msg(fid))
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
        self.scans.pop(p.id, None)
        self.heli_off(p, 'left')
        self.roster_dirty = True
        self.event({'e': 'leave', 'id': p.id, 'n': p.name})
        if not p.bot and not any(not q.bot for q in self.players.values()):
            # the last person has gone: the dummies have nobody to stand there for
            for b in [q for q in self.players.values() if q.dummy]:
                self.remove(b)
        if not self.players:
            self.empty_since = now()

    def arms(self, p):
        """(primary, secondary) a player carries here: the niche modes override the locker,
        and in the battle royale you carry what you have found."""
        if self.mode in NICHE_ARMS:
            a = NICHE_ARMS[self.mode]
            return a[0], a[1]
        if self.mode == 'derby':
            return None, None
        if self.mode == 'royale':
            pw, sw = p.inv['pw'], p.inv['sw']
            return (pw['w'] if pw else None), (sw['w'] if sw else None)
        if p.carry:
            return p.carry[1], p.carry[2]
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

    # -- daily challenges --
    def daily_bump(self, p, kind, amount=1, gun=None, mode=None, best=False, force=False):
        if getattr(p, 'bot', False) or (not force and self.phase not in ('live', 'freeze')):
            return
        day = daily.today(SYDNEY)
        lk = p.locker
        rec = lk.get('daily') if lk is not None else p.daily
        rec, finished = daily.bump(rec, day, kind, amount, gun, mode, best)
        if lk is not None:
            lk['daily'] = rec
        else:
            p.daily = rec
        for i, c in finished:
            if i == 'bonus':
                self.earn(p, 'dailybonus', c, force=True)
            else:
                self.earn(p, 'daily', c['reward'], force=True)
                p.send({'t': 'dailydone', 'c': c})
        p.send(daily.public(rec, day))

    def earn(self, p, why, n=None, force=False):
        if self.phase in ('waiting', 'countdown') and not force:
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
        plain = zipped = None
        for p in self.players.values():
            if p is skip:
                continue
            c = p.conn
            if c.deflate:
                if zipped is None:
                    zipped = frame(raw, True)
                c.send_frame(zipped)
            else:
                if plain is None:
                    plain = frame(raw, False)
                c.send_frame(plain)

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
        elif self.mode == 'derby':
            best = None
        elif self.mode in AD_MODES and self.ad and not warmup:
            best = self.ad_spawn(p, others)
        else:
            best = self.random_spawn(p, others, warmup)
        if self.mode == 'derby':
            x, z, cart_yaw = self.derby_spot(p, others)
            y = 0.0
            yaw = cart_yaw - math.pi / 2      # a player's yaw faces -z at zero; a cart's faces +x
        else:
            x, z = best[0], best[1]
            y = float(best[2]) if len(best) > 2 else 0.0
            yaw = random.uniform(-math.pi, math.pi)
            if self.mode in AD_MODES and self.ad and not warmup:
                yaw = -math.pi / 2 if p.team == self.attackers else math.pi / 2     # facing along the town: attackers east, defenders west
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
        elif self.mode == 'derby':
            p.nades = DERBY_NADES
            p.nade_kind = 'frag'
            p.perk_left = 0
        elif self.mode == 'royale':
            p.reset_kit()
        else:
            p.nades = p.nades_for()
            p.perk_left = PERK_USES[p.perk]
        p.rounds = 1
        p.carry = (p.loadout, p.primary, p.secondary, p.perk)
        p.sc += 1
        p.protect_until = now() + PROTECT
        p.last_active = now()      # a fresh life starts the idle clock again
        # outside the royale nobody can be hurt until they have done something: a player
        # left standing in another tab is not a free kill
        p.afk_guard = self.mode != 'royale' and not p.bot
        p.fall_y = None
        p.fall_force = False
        p.surv = 0
        p.in_round = True
        p.streak = 0
        if STREAK_FREE and self.mode in STREAK_MODES:
            p.streaks = [k for _, k in STREAKS]
            p.send({'t': 'streak', 'have': list(p.streaks)})
        p.send({'t': 'spawn', 'p': [x, y, z], 'y': yaw, 'sc': p.sc, 'ld': p.loadout, 'tm': p.team, 'lv': p.lives, 'guard': 1 if p.afk_guard else 0})
        if self.mode == 'royale':
            p.send(self.inv_msg(p))
        if self.mode == 'derby':
            self.derby_seat(p, x, z, cart_yaw)
        self.roster_dirty = True

    # -- the Derby --

    def track_heading(self, i):
        T = self.track
        a, b = T[(i - 1) % len(T)], T[(i + 1) % len(T)]
        return math.atan2(-(b[1] - a[1]), b[0] - a[0])

    def track_nearest(self, x, z):
        T = self.track
        return min(range(len(T)), key=lambda i: (T[i][0] - x) ** 2 + (T[i][1] - z) ** 2)

    def derby_spot(self, p, others):
        """Where a cart starts: on the grid at the start of a match, otherwise back on
        the tarmac where its driver died, facing the way the race runs, with a free
        stretch of track around it."""
        T = self.track
        grid = self.map['ffaSpawns']
        dead_at = getattr(p, 'derby_at', None)
        if dead_at is None or not T:
            taken = [q.pos for q in others]
            for i, g in enumerate(grid):
                if all(math.hypot(g[0] - q[0], g[1] - q[2]) > 2.5 for q in taken):
                    return g[0], g[1], self.track_heading(self.track_nearest(g[0], g[1])) if T else 0.0
            g = grid[0]
            return g[0], g[1], self.track_heading(self.track_nearest(g[0], g[1])) if T else 0.0
        i0 = self.track_nearest(dead_at[0], dead_at[2])
        busy = [q.pos for q in others] + [F['p'] for F in self.forklifts.values()
                                           if F.get('owner') not in (None, p.id)]
        for step in (0, -3, 3, -6, 6, -9, 9, -12, 12):
            i = (i0 + step) % len(T)
            yaw = self.track_heading(i)
            lx, lz = math.sin(yaw), math.cos(yaw)     # across the track
            for side in (0.0, -2.6, 2.6):
                x, z = T[i][0] + lx * side, T[i][1] + lz * side
                if all(math.hypot(x - q[0], z - q[2]) > 3.0 for q in busy):
                    return x, z, yaw
        return T[i0][0], T[i0][1], self.track_heading(i0)

    def derby_seat(self, p, x, z, yaw):
        """Put a player's cart where they spawned and them at its wheel."""
        self.leave_vehicle(p)
        fid = getattr(p, 'derby_cart', None)
        if fid not in self.forklifts or self.forklifts[fid].get('owner') not in (None, p.id):
            fid = next((f for f in sorted(self.forklifts) if self.forklifts[f].get('owner') in (None, p.id)
                        and not self.forklifts[f]['driver']), None)
        if fid is None:
            return
        F = self.forklifts[fid]
        F['owner'] = p.id
        F['driver'] = p.id
        F['p'] = [x, 0.0, z]
        F['y'] = yaw
        F['v'] = 0.0
        F['at'] = now()
        p.derby_cart = fid
        p.vehicle = fid
        self.broadcast(self.fk_msg(fid))

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
        self.live_at = now()
        fact_bump('modes', self.mode)
        if self.mode == 'royale':
            self.add_bots()
        for p in self.players.values():
            p.reset_stats()
            p.longest = 0.0
            p.derby_at = None            # a new race starts on the grid
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
        if self.mode in AD_MODES:
            self.start_ad()
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
        t = now()
        humans = sum(1 for p in self.players.values() if not getattr(p, 'bot', False) and not p.late)
        for p in self.players.values():
            won = (p.id == winner) if self.mode in FFA_MODES else (p.team == winner)
            self.earn(p, 'win' if won else 'match', EARN['match'] + (EARN['win'] if won else 0))
            if not p.late and not getattr(p, 'bot', False):
                self.daily_bump(p, 'matches', force=True)
                self.daily_bump(p, 'modematches', mode=self.mode, force=True)
                if won and (self.mode != 'royale' or humans >= 2):
                    self.daily_bump(p, 'wins', force=True)
            if p.late or p.locker is None:
                continue
            self.stat(p, 'matches')
            if won and (self.mode != 'royale' or humans >= 2):
                self.stat(p, 'wins')      # a royale won against nobody but bots is not a win
            if self.mode == 'royale':
                self.stat(p, 'royales')
                if p.place:
                    self.stat(p, 'best', p.place, best=True)
            self.stat(p, 'dmg', int(p.dmg))
            self.stat(p, 'time', int(max(0.0, t - max(p.joined, getattr(self, 'live_at', t)))))
            accounts.save_locker(p.account['id'], p.locker)
            p.send({'t': 'stats', 'stats': p.locker['stats']})
        if self.mode == 'royale':
            self.finish_royale(winner)
            self.clear_bots()
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
        if self.mode in AD_MODES:
            return self.handle_arm(p, on)
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

    # -- Attack and Defend: Rush and Breakthrough -------------------------------------

    def start_ad(self):
        self.attackers = 0
        self.ad = {'sector': 0, 'tickets': AD_TICKETS, 'pts': self.ad_points(0)}

    def ad_sectors(self):
        """The sectors this mode plays: Rush has one more, a single bomb in the back corner."""
        A = self.map['ad']
        return A['sectors'] + ([A['rush_extra']] if self.mode == 'rush' and A.get('rush_extra') else [])

    def ad_points(self, i):
        out = []
        for _ in self.ad_sectors()[i]['pts']:
            if self.mode == 'rush':
                out.append({'s': 'idle', 'planter': None, 'plant_t': 0.0, 'defuser': None, 'defuse_t': 0.0, 'explode': 0.0})
            else:
                out.append({'owner': 1, 'cap': 0.0, 'a': 0, 'd': 0})
        return out

    def ad_point_pos(self, i, j):
        P = self.ad_sectors()[i]['pts'][j]
        return [P['x'], P['y'], P['z']]

    def ad_inside(self, pos, zone):
        if pos[1] < zone['y0'] or pos[1] > zone['y1']:
            return False
        if zone['k'] == 'circle':
            return math.hypot(pos[0] - zone['x'], pos[2] - zone['z']) <= zone['r']
        return mapgen.point_in_rect(pos[0], pos[2], (zone['x'], zone['z'], zone['hw'], zone['hd'], zone['yaw']), 0.0)

    def ad_spawn(self, p, others):
        """Attackers come back at the sector before this one (or the west end for the first);
        defenders at the sector after it (or the east end for the last). Left or right as they chose."""
        A = self.map['ad']
        i = self.ad['sector']
        side = 1 if p.side == 1 else 0
        if p.team == self.attackers:
            spots = A['start'][side] if i == 0 else A['sectors'][i - 1]['pts'][side]['spawns']
        else:
            spots = A['end'][side] if i == len(A['sectors']) - 1 else A['sectors'][i + 1]['pts'][side]['spawns']
        spots = spots or A['start'][0] or [[0.0, 0.0]]
        pts = list(spots)
        random.shuffle(pts)
        best = next((pt for pt in pts if all(math.hypot(pt[0] - q.pos[0], pt[1] - q.pos[2]) > 1.5 for q in others)), pts[0])
        return [best[0], best[1], 0.0]

    def handle_arm(self, p, on):
        """Rush: an attacker holding E at a bomb arms it, a defender holding E at an armed one disarms it."""
        if self.mode != 'rush' or self.phase != 'live' or not self.ad:
            return
        pts = self.ad['pts']
        if not on:
            for S in pts:
                if S['planter'] == p.id:
                    S['planter'] = None
                if S['defuser'] == p.id:
                    S['defuser'] = None
            return
        if not p.alive:
            return
        i = self.ad['sector']
        for j, S in enumerate(pts):
            if dist3(p.pos, self.ad_point_pos(i, j)) > AD_REACH:
                continue
            if p.team == self.attackers:
                if S['s'] == 'idle' and not S['planter']:
                    S['planter'] = p.id
                    S['plant_t'] = now()
            elif S['s'] == 'armed' and not S['defuser']:
                S['defuser'] = p.id
                S['defuse_t'] = now()
            return

    def update_ad(self, t):
        if self.phase != 'live' or not self.ad:
            return
        A = self.ad
        i = A['sector']
        secs = self.ad_sectors()
        if self.mode == 'rush':
            for j, S in enumerate(A['pts']):
                pos = self.ad_point_pos(i, j)
                if S['s'] == 'idle' and S['planter']:
                    p = self.players.get(S['planter'])
                    if not p or not p.alive or dist3(p.pos, pos) > AD_REACH + 0.6:
                        S['planter'] = None
                    elif t - S['plant_t'] >= AD_ARM:
                        S['s'] = 'armed'
                        S['planter'] = None
                        S['explode'] = t + AD_FUSE
                        p.score += 50
                        self.earn(p, 'plant')
                        self.roster_dirty = True
                        self.event({'e': 'adarmed', 'id': p.id, 'pt': j, 'p': pos})
                elif S['s'] == 'armed':
                    if S['defuser']:
                        p = self.players.get(S['defuser'])
                        if not p or not p.alive or dist3(p.pos, pos) > AD_REACH + 0.6:
                            S['defuser'] = None
                        elif t - S['defuse_t'] >= AD_ARM:
                            S['s'] = 'idle'
                            S['defuser'] = None
                            p.score += 50
                            self.earn(p, 'defuse')
                            self.roster_dirty = True
                            self.event({'e': 'addisarmed', 'id': p.id, 'pt': j})
                    if S['s'] == 'armed' and t >= S['explode']:
                        S['s'] = 'gone'
                        self.event({'e': 'adboom', 'pt': j, 'p': pos})
                        for q in list(self.players.values()):
                            d = dist3(q.pos, pos)
                            if q.alive and d < AD_BLAST:
                                self.damage(q, None, int(220 * (1 - d / AD_BLAST)), 'bomb', False)
            if all(S['s'] == 'gone' for S in A['pts']):
                return self.ad_advance(t)
        else:
            for j, S in enumerate(A['pts']):
                zone = secs[i]['pts'][j]['zone']
                a = d = 0
                for q in self.players.values():
                    if q.alive and self.ad_inside(q.pos, zone):
                        if q.team == self.attackers:
                            a += 1
                        else:
                            d += 1
                S['a'], S['d'] = a, d
                if a > d:
                    S['cap'] = min(1.0, S['cap'] + TICK / AD_CAP)
                elif d > a:
                    S['cap'] = max(0.0, S['cap'] - TICK / AD_CAP)
                if S['owner'] != self.attackers and S['cap'] >= 1.0:
                    S['owner'] = self.attackers
                    self.event({'e': 'adcap', 'pt': j, 'tm': self.attackers})
                elif S['owner'] == self.attackers and S['cap'] <= 0.0:
                    S['owner'] = 1 - self.attackers
                    self.event({'e': 'adcap', 'pt': j, 'tm': 1 - self.attackers})
            if all(S['owner'] == self.attackers for S in A['pts']):
                return self.ad_advance(t)
        # out of lives and nobody left standing: the defenders have held
        att = [q for q in self.players.values() if q.team == self.attackers]
        if A['tickets'] <= 0 and att and not any(q.alive for q in att):
            return self.end_match(1 - self.attackers)
        if t >= self.match_end:
            return self.end_match(1 - self.attackers)

    def ad_advance(self, t):
        """Both points taken: on to the next sector, with a fresh set of lives; the last one won is the match."""
        A = self.ad
        if A['sector'] >= len(self.ad_sectors()) - 1:
            return self.end_match(self.attackers)
        A['sector'] += 1
        A['tickets'] = AD_TICKETS
        A['pts'] = self.ad_points(A['sector'])
        self.event({'e': 'adsector', 'sec': A['sector']})
        for q in self.players.values():
            if not q.alive and q.team == self.attackers and not q.respawn_at:
                q.respawn_at = t + 1.0       # the ones who were out come back for the next sector
        self.roster_dirty = True

    # -- combat --

    def enemies(self, a, b):
        if a is b:
            return False
        if self.mode in TEAM_MODES and self.phase not in ('waiting', 'countdown'):
            return a.team != b.team
        return True

    def turret_ok(self, p):
        """Is this player at the wheel of a golf cart wearing the Interceptor, on the owner's account?"""
        F = self.forklifts.get(p.vehicle) if p.vehicle is not None else None
        return bool(F and F.get('k') == 'golfcart' and F['driver'] == p.id and p.cos.get('c') == 'interceptor' and is_owner(p))

    def armoured(self, q):
        """Behind the Interceptor's bulletproof walls: the owner, in that cart, with them up."""
        return bool(q.flags & ARMOUR_FLAG) and self.turret_ok(q)

    def handle_shot(self, p, m):
        w = m.get('w')
        if not p.alive or self.phase in ('freeze', 'post', 'ended') or p.aboard:
            return
        if self.mode == 'derby' and w != 'minigun':
            return
        if w not in WEAPONS:
            return
        if w == 'minigun':
            # the Gatling: from the Interceptor's turret, or the helicopter's door
            if not (self.turret_ok(p) or p.heli):
                return
        elif w == 'tknife':
            # a thrown knife landing: only as many as have been thrown and are still in the air
            t0 = now()
            p.knives_air = [x for x in p.knives_air if t0 - x < KNIFE_AIR]
            perk = p.carry[3] if p.carry and self.mode != 'royale' else p.perk
            if perk != 'knives' or not p.knives_air:
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
        # (the helicopter moves at twenty-odd metres a second: a lagging client's gun is further off)
        if dist3(o, [p.pos[0], p.pos[1] + 1.5, p.pos[2]]) > (14.0 if p.heli else 6.0):
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
            if t_protected(q) or self.armoured(q):
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
        if not q.alive or dmg <= 0 or q.aboard or q.afk_guard:
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
        if self.mode == 'derby':
            q.derby_at = list(q.pos)     # back on the track here, a second from now
        q.alive = False
        q.hp = 0
        q.streak = 0
        q.life_kills = 0
        if w != ADMIN_KILL:
            q.deaths += 1
        if q.id in self.drones:
            self.drone_off(q.id, 'pilot')
        self.leave_vehicle(q)
        self.heli_off(q, 'dead')
        if self.bomb:
            if self.bomb.get('carrier') == q.id:
                self.drop_bomb(q)
            if self.bomb.get('planter') == q.id:
                self.bomb['planter'] = None
            if self.bomb.get('defuser') == q.id:
                self.bomb['defuser'] = None
        counting = self.phase in ('live', 'freeze') and w != ADMIN_KILL
        if counting and self.mode in AD_MODES and self.ad and q.team == self.attackers:
            self.ad['tickets'] = max(0, self.ad['tickets'] - 1)      # one of the attackers' lives
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
            if counting:
                self.stat(helper, 'assists')
            assisted.append(helper.name)
            helper.send({'t': 'assist', 'v': q.name})
            if counting:
                self.earn(helper, 'assist')
                self.daily_bump(helper, 'assists')
        q.hurt_by = {}
        if attacker and attacker is not q:
            if self.mode == 'firefight' and attacker.burn_until > now():
                # Firefight: a kill puts out the fire on you (you can catch light again)
                attacker.burn_until = 0.0
                attacker.burn_acc = 0.0
                attacker.send({'t': 'doused'})
            attacker.kills += 1
            attacker.score += 100
            attacker.life_kills = getattr(attacker, 'life_kills', 0) + 1
            if counting and w in WEAPONS:
                fact_bump('guns', w)
            if counting:
                self.daily_bump(attacker, 'kills')
                if w in WEAPONS:
                    self.daily_bump(attacker, 'gunkills', gun=w)
                if head:
                    self.daily_bump(attacker, 'head')
                if w in NADE_KILLS:
                    self.daily_bump(attacker, 'nade')
                if w == 'knife':
                    self.daily_bump(attacker, 'knife')
                self.daily_bump(attacker, 'streak', attacker.life_kills, best=True)
                self.daily_bump(attacker, 'long', int(dist3(attacker.pos, q.pos)), best=True)
            if counting and self.mode in STREAK_MODES:
                # one more towards a scorestreak; at five, ten and fifteen it is theirs to call in
                attacker.streak += 1
                for n, k in STREAKS:
                    if attacker.streak == n:
                        attacker.streaks.append(k)
                        attacker.send({'t': 'streak', 'k': k, 'n': n, 'have': list(attacker.streaks)})
            if counting:
                self.earn(attacker, 'kill', EARN['kill'] + (EARN['headshot'] if head else 0))
                self.pass_kill(attacker, w)
                self.stat(attacker, 'kills')
                if head:
                    self.stat(attacker, 'hs')
                reach = dist3(attacker.pos, q.pos)
                attacker.longest = max(getattr(attacker, 'longest', 0.0), reach)
                lk = attacker.locker
                if lk is not None:
                    lk['stats']['long'] = max(lk['stats'].get('long', 0), int(reach))
        if counting:
            self.stat(q, 'deaths')
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
        if self.mode in AD_MODES and self.phase == 'live' and self.ad and q.team == self.attackers and self.ad['tickets'] <= 0:
            out = True      # the attackers' lives are spent: no coming back until the sector falls
        royale_live = self.mode == 'royale' and self.phase == 'live'
        if royale_live:
            out = True
            q.place = 1 + sum(1 for x in self.players.values() if x.alive and not x.late)
            q.surv = int(max(0.0, now() - q.alive_since))
            self.drop_kit(q)
        if out:
            q.respawn_at = 0
        elif self.mode != 'bomb' or self.phase in ('waiting', 'countdown'):
            delay = 1.5 if self.phase in ('waiting', 'countdown') and self.mode != 'derby' else self.cfg['respawn']
            q.respawn_at = now() + delay
        self.event({'e': 'kill', 'k': attacker.id if attacker else 0, 'v': q.id, 'w': w, 'hs': head,
                    'kn': attacker.name if attacker else '', 'vn': q.name, 'as': assisted, 'ks': attacker.streak if attacker else 0,
                    'p': [round(v, 2) for v in q.pos], 'd': int(dist3(attacker.pos, q.pos)) if attacker and attacker is not q else 0})
        q.send({'t': 'dead', 'by': attacker.id if attacker else 0, 'byn': attacker.name if attacker else '',
                'w': w, 'rs': max(0.0, q.respawn_at - now()) if q.respawn_at and (self.mode != 'bomb' or self.phase in ('waiting', 'countdown')) else -1,
                'lv': q.lives if self.mode == 'oitc' else -1})
        if royale_live:
            q.send(self.stats_msg(q, False))
        self.roster_dirty = True

    def stat(self, p, key, n=1, best=False):
        """A lifetime number on a signed-in player's account: added to, or (best) the lowest kept."""
        lk = p.locker
        if lk is None:
            return
        st = lk.setdefault('stats', catalog.blank_stats())
        if best:
            st[key] = n if not st.get(key) else min(st[key], n)
        else:
            st[key] = st.get(key, 0) + n

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
        ld = p.carry[0] if p.carry else p.loadout
        kind = m.get('k') if m.get('k') in NADE_OPTIONS[ld] else 'frag'
        if self.mode in ('royale', 'derby'):
            kind = p.nade_kind
        if self.mode in NICHE_ARMS:
            kinds = NICHE_ARMS[self.mode][2]
            if not kinds:
                return
            kind = kinds[0]
        # from the grenade launcher: it flies flat and fast, and goes off where it lands
        perk = p.carry[3] if p.carry and self.mode != 'royale' else p.perk
        launched = bool(m.get('l')) and perk == 'launcher' and self.mode not in ('royale', 'derby')
        p.nade_ids[nid] = (now(), kind, launched)
        out = {'t': 'nade', 'id': p.id, 'n': nid, 'k': kind, 'o': vec3(m.get('o')), 'v': vec3(m.get('v'))}
        if launched:
            out['l'] = 1
        self.broadcast(out, skip=p)

    def handle_boom(self, p, m):
        nid = int(num(m.get('n')))
        rec = p.nade_ids.pop(nid, None)
        if rec is None or now() - rec[0] > 6.0:
            return
        kind = rec[1]
        pos = vec3(m.get('p'))
        if dist3(pos, p.pos) > (LAUNCH_REACH if len(rec) > 2 and rec[2] else 60):
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
            if self.mode == 'derby' and int(dmg) > 0:
                dmg = 999      # the Derby: any grenade damage at all is a kill, your own included
            self.damage(q, p, int(dmg), w, False)

    # -- scorestreaks --

    def handle_streak(self, p, m):
        """Calling in a reward you have earned: the scan, the helicopter's gun, the airstrike."""
        k = m.get('k')
        owner = is_owner(p) and k in [x for _, x in STREAKS] and self.mode not in ('royale', 'derby') + AD_MODES and self.phase != 'ended'
        if not owner and (self.mode not in STREAK_MODES or self.phase != 'live' or not p.alive or k not in p.streaks):
            return
        if not p.alive:
            return
        t = now()
        if k == 'scan':
            self.scans[p.id] = {'until': t + SCAN_LIFE, 'next': t}
        elif k == 'heli':
            if p.heli or p.vehicle is not None or p.id in self.drones:
                return
            s0 = random.uniform(0.0, self.circuit['len'])
            H = {'t0': t, 'until': t + HELI_LIFE, 's0': s0, 'back': [round(v, 3) for v in p.pos]}
            p.heli = H
            self.helis[p.id] = H
            p.pos = heli_seat(self.circuit, s0)
            self.broadcast({'t': 'heli', 'id': p.id, 'tm': p.team, 's0': round(s0, 2), 'el': 0, 'life': HELI_LIFE})
        elif k == 'carpet':
            C = self.carpet_line(p, t)
            self.carpets.append(C)
            self.broadcast(self.carpet_msg(C, t))
        elif k == 'strike':
            if p.heli:
                return
            pos = vec3(m.get('p'))
            bx, bz = self.map['bounds']
            x = max(-bx + 1.0, min(bx - 1.0, pos[0]))
            z = max(-bz + 1.0, min(bz - 1.0, pos[2]))
            y = self.land_height(x, z, 60.0)       # the bombs land on whatever is highest there: a roof, or the street
            self.strike_seq += 1
            S = {'id': self.strike_seq, 'owner': p.id, 'tm': p.team, 'p': [round(x, 2), round(y, 2), round(z, 2)],
                 'at': t + STRIKE_DELAY, 'h': round(random.uniform(0.0, math.tau), 3)}
            self.strikes.append(S)
            self.broadcast({'t': 'strike', 'id': S['id'], 'p': S['p'], 'in': STRIKE_DELAY, 'h': S['h'], 'by': p.id, 'byn': p.name, 'tm': p.team})
        if k in p.streaks:
            p.streaks.remove(k)      # (the owner's never run out)
        p.send({'t': 'streak', 'used': k, 'have': list(p.streaks)})
        self.event({'e': 'streak', 'id': p.id, 'n': p.name, 'k': k, 'tm': p.team})

    def heli_msg(self, oid, t):
        H = self.helis[oid]
        owner = self.players.get(oid)
        return {'t': 'heli', 'id': oid, 'tm': owner.team if owner else -1, 's0': round(H['s0'], 2), 'el': round(t - H['t0'], 2), 'life': HELI_LIFE}

    def heli_off(self, p, why, oid=None):
        """The helicopter leaves: its gunner is put back where they were picked up from."""
        oid = p.id if p else oid
        H = self.helis.pop(oid, None)
        if not H:
            return
        if p:
            p.heli = None
            if p.alive:
                p.pos = list(H['back'])
                p.fall_lock = now() + 1.5      # positions still in flight from the seat are ignored
        self.broadcast({'t': 'heli', 'id': oid, 'off': 1, 'why': why, 'back': H['back']})

    def update_streaks(self, t):
        live = self.phase == 'live'
        for oid, S in list(self.scans.items()):
            owner = self.players.get(oid)
            if not owner or t >= S['until'] or not live:
                del self.scans[oid]
                if owner:
                    owner.send({'t': 'ping', 'id': oid, 'scan': 1, 'off': 1})
                continue
            if t < S['next']:
                continue
            S['next'] = t + SCAN_EVERY
            pts = []
            for q in self.players.values():
                if q.cos.get('o') in catalog.CAMO_OUTFITS:
                    continue      # camouflage: the scan doesn't pick them up either
                if q.alive and self.enemies(owner, q):
                    pts.append([q.id, round(q.pos[0], 2), round(q.pos[1], 2), round(q.pos[2], 2)])
            msg = {'t': 'ping', 'id': oid, 'p': [round(v, 2) for v in owner.pos], 'pts': pts, 'scan': 1, 'left': round(S['until'] - t, 1)}
            for q in self.players.values():
                if self.friendly(owner, q):
                    q.send(msg)
        for oid, H in list(self.helis.items()):
            owner = self.players.get(oid)
            if not owner or not owner.alive or t >= H['until'] or not live:
                self.heli_off(owner, 'time' if owner and t >= H['until'] else 'over', oid)
                continue
            owner.pos = heli_seat(self.circuit, H['s0'] + (t - H['t0']) * HELI_SPEED)
        for S in list(self.strikes):
            if t < S['at']:
                continue
            self.strikes.remove(S)
            if live:
                self.strike_land(S)
        for C in list(self.carpets):
            if t < C['t0']:
                continue
            if (t - C['t0']) * CARPET_SPEED > C['L'] + CARPET_BACK + 1.0:
                self.carpets.remove(C)
                continue
            if live:
                self.carpet_sweep(C, t)

    def carpet_line(self, p, t):
        """A line across the map for the carpet bombing: a random heading through a
        random point in the middle half of the town, run out to the margin either side.
        Nobody picks it, the caller included."""
        bx, bz = self.map['bounds']
        h = random.uniform(0.0, math.tau)
        dx, dz = math.cos(h), -math.sin(h)
        cx, cz = random.uniform(-bx * 0.5, bx * 0.5), random.uniform(-bz * 0.5, bz * 0.5)
        X, Z = bx + CARPET_MARGIN, bz + CARPET_MARGIN
        lo, hi = -1e9, 1e9
        for (c, d, lim) in ((cx, dx, X), (cz, dz, Z)):
            if abs(d) < 1e-6:
                continue
            a, b = (-lim - c) / d, (lim - c) / d
            lo, hi = max(lo, min(a, b)), min(hi, max(a, b))
        ax, az = cx + dx * lo, cz + dz * lo
        bx2, bz2 = cx + dx * hi, cz + dz * hi
        self.strike_seq += 1
        return {'id': self.strike_seq, 'owner': p.id, 'tm': p.team, 'a': [round(ax, 2), round(az, 2)], 'b': [round(bx2, 2), round(bz2, 2)],
                'd': (dx, dz), 'L': hi - lo, 't0': t + CARPET_WARN, 'h': round(h, 3)}

    def carpet_msg(self, C, t):
        owner = self.players.get(C['owner'])
        return {'t': 'carpet', 'id': C['id'], 'a': C['a'], 'b': C['b'], 'h': C['h'], 'v': CARPET_SPEED, 'in': round(C['t0'] - t, 2),
                'by': C['owner'], 'byn': owner.name if owner else '', 'tm': C['tm']}

    def carpet_sweep(self, C, t):
        """The bombs are walking down the line: anyone in the swath about the front dies,
        under a roof or not. Never the caller or their side."""
        s = (t - C['t0']) * CARPET_SPEED
        owner = self.players.get(C['owner'])
        team_mode = self.mode in TEAM_MODES
        ax, az = C['a']
        dx, dz = C['d']
        rx, rz = -dz, dx
        for wid, W in list(self.walls.items()):
            along = (W['p'][0] - ax) * dx + (W['p'][2] - az) * dz
            side = (W['p'][0] - ax) * rx + (W['p'][2] - az) * rz
            if s - CARPET_BACK <= along <= s + CARPET_AHEAD and abs(side) <= CARPET_W:
                self.hurt_wall(wid, WALL_HP)
        for q in list(self.players.values()):
            if not q.alive or q.id == C['owner'] or (team_mode and q.team == C['tm']) or t_protected(q) or q.heli:
                continue
            along = (q.pos[0] - ax) * dx + (q.pos[2] - az) * dz
            side = (q.pos[0] - ax) * rx + (q.pos[2] - az) * rz
            if s - CARPET_BACK <= along <= s + CARPET_AHEAD and abs(side) <= CARPET_W:
                self.damage(q, owner, 999, 'carpet', False)

    def strike_land(self, S):
        """The bombs land. In the open: dead in the middle ten metres, fifty off the rest of the
        circle. Under a roof anywhere in the circle, fifty. Never your own side."""
        owner = self.players.get(S['owner'])
        p = S['p']
        team_mode = self.mode in TEAM_MODES
        for wid, W in list(self.walls.items()):
            if dist2(W['p'], p) < STRIKE_R:
                self.hurt_wall(wid, WALL_HP)
        for q in list(self.players.values()):
            if not q.alive or q.id == S['owner'] or (team_mode and q.team == S['tm']) or t_protected(q):
                continue
            d = dist2(q.pos, p)
            if d > STRIKE_R:
                continue
            chest = [q.pos[0], q.pos[1] + 1.0, q.pos[2]]
            covered = q.pos[1] < p[1] - 2.5 or self.solid.blocked(chest, [chest[0], chest[1] + 40.0, chest[2]])
            dmg = STRIKE_DMG if (covered or d > STRIKE_KILL_R) else 999
            self.damage(q, owner, dmg, 'strike', False)

    # -- perks --

    def behind(self, p, q):
        """Is p standing behind q, in the half of the world q has its back to?"""
        fx, fz = -math.sin(q.yaw), -math.cos(q.yaw)
        dx, dz = p.pos[0] - q.pos[0], p.pos[2] - q.pos[2]
        d = math.hypot(dx, dz)
        return d > 0.05 and (fx * dx + fz * dz) / d < -0.25

    def handle_perk(self, p, m):
        k = m.get('k')
        if p.carry and self.mode != 'royale':
            p_perk = p.carry[3]
        else:
            p_perk = p.perk
        if not p.alive or k != p_perk or p.perk_left <= 0 or self.phase == 'ended' or self.mode in NICHE_ARMS or p.aboard or self.mode == 'derby':
            return
        if k == 'launcher':
            return      # the launcher fires grenades (see handle_nade): nothing to use up here
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

    def handle_door(self, p, m):
        """A door swung open or shut by someone next to it (or a bot)."""
        did = str(m.get('id', ''))
        D = self.door_index.get(did)
        if not D or not p.alive:
            return
        if dist2([D['x'], 0, D['z']], p.pos) > 3.5 + D['w'] / 2 or abs(D['y'] - p.pos[1]) > 2.5:
            return
        want = m.get('open')
        opening = (did not in self.door_open) if want is None else bool(want)
        if opening == (did in self.door_open):
            return
        if opening:
            self.door_open.add(did)
        else:
            self.door_open.discard(did)
        self.broadcast({'t': 'door', 'id': did, 'open': 1 if opening else 0, 'by': p.id})

    def handle_pane(self, p, m):
        """A window pane broken: by a bullet or by someone going through it."""
        pid = str(m.get('id', ''))
        if pid not in self.pane_index or pid in self.panes_broken:
            return
        self.panes_broken.add(pid)
        self.broadcast({'t': 'pane', 'id': pid, 'broken': 1, 'by': p.id})

    def bot_doors(self, b):
        """A bot opens any closed door it is about to walk into."""
        if not self.door_index:
            return
        for did, D in self.door_index.items():
            if did in self.door_open or abs(D['y'] - b.pos[1]) > 2.0:
                continue
            if dist2([D['x'], 0, D['z']], b.pos) < 1.6 + D['w'] / 2:
                self.door_open.add(did)
                self.broadcast({'t': 'door', 'id': did, 'open': 1, 'by': b.id})

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
        if t in ('fkin', 'fkout') and self.mode == 'derby':
            return       # the Derby seats everyone in their own cart, and nobody gets out
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
            # how fast it is going, smoothed over a few updates: the Derby's crashes need it
            tn = now()
            dt = max(0.02, tn - F.get('at', tn))
            F['v'] = F.get('v', 0.0) * 0.4 + 0.6 * min(30.0, dist2(pos, F['p']) / dt)
            F['at'] = tn
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
        if self.mode == 'derby':
            # a crash: the cart has to be moving, and the other cart in front of it
            if dist3(F['p'], q.pos) > DERBY_CRASH_REACH or t_protected(q) or F.get('v', 0.0) < DERBY_CRASH_SPEED:
                return
            dx, dz = q.pos[0] - F['p'][0], q.pos[2] - F['p'][2]
            d = math.hypot(dx, dz)
            if d > 0.2 and (math.cos(F['y']) * dx - math.sin(F['y']) * dz) / d < 0.25:
                return    # hit from the side or behind: it is the other one doing the hitting
            t = now()
            if t - p.roadkill_at.get(q.id, -9) < 1.0:
                return
            p.roadkill_at[q.id] = t
            self.damage(q, p, 999, 'cart', False)
            if not q.alive and p.alive and p.nades < DERBY_NADES:
                # a crash kill puts a grenade back in your hand, up to three
                p.nades += 1
                p.send({'t': 'nadeup', 'n': p.nades})
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
        self.watch_falls(t)
        self.update_bots(t)
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
        t = now()
        for p in self.players.values():
            if p.alive and not p.late:
                p.surv = int(max(0.0, t - p.alive_since))
                if p is not w and not p.place:
                    p.place = 2
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
        # the match's table, for everyone in the room to look over
        rows = [{'id': p.id, 'n': p.name, 'pl': p.place or 0, 'k': p.kills, 'd': int(p.dmg), 'sv': p.surv, 'ch': p.chests, 'lg': int(getattr(p, 'longest', 0.0))}
                for p in self.players.values() if not p.late]
        rows.sort(key=lambda r: (r['pl'] or 999, -r['k']))
        self.broadcast({'t': 'brend', 'rows': rows, 'w': w.name if w else '', 'of': max(self.br_total, 1)})

    # -- bots: they fill a quiet royale, drop, loot, wander, keep out of the gas and shoot back --

    def add_bots(self):
        humans = sum(1 for p in self.players.values() if not p.bot)
        want = min(BOT_FILL - humans, len(BOT_NAMES), self.max - self.count())
        if want <= 0 or humans == 0:
            return
        names = [n for n in BOT_NAMES if n not in {p.name for p in self.players.values()}]
        random.shuffle(names)
        low = [c for c in self.map.get('chests', []) if c[1] < 2.5] or [[0, 0, 0]]
        for name in names[:want]:
            b = Player(BotConn(), name)
            b.conn.player = b
            b.bot = True
            b.pick({'ld': random.randrange(4)})
            b.cos = owned_cos(b, clean_cos(None))
            c = random.choice(low)
            b.ai = {'target': [c[0], c[2]], 'state': 'drop', 'heading': random.uniform(0, math.tau), 'turn_at': 0.0,
                    'chest': None, 'fall': False, 'chute': False, 'fire_at': 0.0, 'looted': 0}
            self.add(b)

    def clear_bots(self):
        for b in [p for p in self.players.values() if p.bot]:
            self.remove(b)
        self.roster_dirty = True

    def walk_grid(self):
        """The ground a bot can walk on, in 2 m cells: the height of the floor there and
        whether something stands in the way. Built once a map, on first use."""
        if getattr(self, '_grid', None) is not None:
            return self._grid
        bx, bz = self.map['bounds']
        nx, nz = int(bx) + 1, int(bz) + 1
        ground = [[0.0] * nz for _ in range(nx)]
        block = [[False] * nz for _ in range(nx)]
        for (cx, cy, cz, hx, hy, hz, yaw, mat, tint) in self.map['boxes']:
            c, s = abs(math.cos(yaw)), abs(math.sin(yaw))
            ex, ez = c * hx + s * hz, s * hx + c * hz
            top, bot = cy + hy, cy - hy
            i0, i1 = max(0, int((cx - ex + bx) / 2)), min(nx - 1, int((cx + ex + bx) / 2))
            j0, j1 = max(0, int((cz - ez + bz) / 2)), min(nz - 1, int((cz + ez + bz) / 2))
            for i in range(i0, i1 + 1):
                for j in range(j0, j1 + 1):
                    if top <= 2.2:
                        if top > ground[i][j]:
                            ground[i][j] = top
                    elif bot < 1.8:
                        block[i][j] = True
        self._grid = (ground, block, bx, bz, nx, nz)
        return self._grid

    def walkable(self, x, z):
        ground, block, bx, bz, nx, nz = self.walk_grid()
        i, j = int((x + bx) / 2), int((z + bz) / 2)
        if i < 1 or j < 1 or i >= nx - 1 or j >= nz - 1:
            return None
        return None if block[i][j] else ground[i][j]

    def update_bots(self, t):
        if self.phase != 'live':
            return
        for b in self.players.values():
            if not b.bot or not b.alive or b.dummy:
                continue
            b.last_active = t
            ai = b.ai
            if b.aboard:
                P = self.plane
                if P:
                    pos, d = self.plane_pos(t)
                    passed = (pos[0] - ai['target'][0]) * P['dir'][0] + (pos[2] - ai['target'][1]) * P['dir'][1] if 'dir' in P else 0
                    if self.over_map(pos[0], pos[2]) and (dist2(pos, [ai['target'][0], 0, ai['target'][1]]) < 30 or passed > 0):
                        self.jump(b, pos)
                        ai['fall'] = True
                        ai['chute'] = False
                        b.flags = 65536
                continue
            if ai['fall']:
                # steering for the target, then the chute, then the ground
                tx, tz = ai['target']
                dx, dz = tx - b.pos[0], tz - b.pos[2]
                L = math.hypot(dx, dz)
                sp = (9.0 if not ai['chute'] else 3.5) * TICK
                if L > 0.5:
                    b.pos[0] += dx / L * min(L, sp)
                    b.pos[2] += dz / L * min(L, sp)
                    b.yaw = math.atan2(-dx, -dz)
                ground = self.land_height(b.pos[0], b.pos[2], b.pos[1])
                if not ai['chute'] and b.pos[1] - ground < 6.0:
                    ai['chute'] = True
                    b.flags = 65536 | 131072
                b.pos[1] = max(ground, b.pos[1] - (3.4 if ai['chute'] else FALL_SPEED) * TICK)
                if b.pos[1] <= ground + 0.01:
                    ai['fall'] = False
                    b.flags = 0
                    ai['state'] = 'loot'
                continue
            # on the ground: out of the gas first, then loot, then wander; shoot at anyone close
            self.bot_doors(b)
            g = self.gas
            goal = None
            if g and math.hypot(b.pos[0] - g['c'][0], b.pos[2] - g['c'][1]) > g['r'] - 6:
                goal = [g['c'][0], g['c'][1]]
                ai['chest'] = None
            elif ai['state'] == 'loot':
                if ai['chest'] is None or self.chests[ai['chest']]['open']:
                    near = [(dist2(b.pos, C['p']), cid) for cid, C in self.chests.items()
                            if not C['open'] and abs(C['p'][1] - b.pos[1]) < 1.5 and self.walkable(C['p'][0], C['p'][2]) is not None]
                    near = [n for n in near if n[0] < 70]
                    if near and ai['looted'] < 4:
                        ai['chest'] = min(near)[1]
                    else:
                        ai['state'] = 'wander'
                if ai['chest'] is not None:
                    C = self.chests[ai['chest']]
                    goal = [C['p'][0], C['p'][2]]
                    if dist2(b.pos, C['p']) < CHEST_REACH - 0.4:
                        self.handle_open(b, {'id': ai['chest']})
                        ai['looted'] += 1
                        ai['chest'] = None
                        ai['pick_until'] = t + 1.5
            if ai.get('pick_until', 0) > t:
                for it in list(self.items.values()):
                    if dist3(b.pos, it['p']) > PICK_REACH:
                        continue
                    k = it['k']
                    if (k == 'gun' and (not b.inv['pw'] or it.get('r') in ('epic', 'legendary'))) or k in ('ammo', 'vest', 'med', 'perk') or (k == 'nade' and b.nades < 3):
                        self.handle_pick(b, {'id': it['id']})
            # moving
            if goal is None:
                if t >= ai['turn_at']:
                    ai['heading'] = random.uniform(0, math.tau)
                    ai['turn_at'] = t + random.uniform(2.0, 6.0)
                    if ai['state'] == 'wander' and random.random() < 0.3:
                        ai['state'] = 'loot'
                hx, hz = math.sin(ai['heading']), math.cos(ai['heading'])
            else:
                dx, dz = goal[0] - b.pos[0], goal[1] - b.pos[2]
                L = math.hypot(dx, dz) or 1.0
                hx, hz = dx / L, dz / L
                if L < 1.0:
                    hx = hz = 0.0
            step = BOT_SPEED * TICK
            nxp, nzp = b.pos[0] + hx * step, b.pos[2] + hz * step
            h = self.walkable(nxp, nzp)
            if h is None or abs(h - b.pos[1]) > 0.9:
                ai['heading'] = (ai['heading'] + random.choice([1.2, -1.2, math.pi])) % math.tau
                ai['turn_at'] = t + 1.5
                if goal is not None:
                    hx, hz = math.sin(ai['heading']), math.cos(ai['heading'])
                    nxp, nzp = b.pos[0] + hx * step, b.pos[2] + hz * step
                    h = self.walkable(nxp, nzp)
                    if h is None or abs(h - b.pos[1]) > 0.9:
                        continue
                else:
                    continue
            moving = hx or hz
            if moving:
                b.pos[0], b.pos[2], b.pos[1] = nxp, nzp, h
                b.yaw = math.atan2(-hx, -hz)
            # a shot at the nearest enemy in sight
            w = b.inv['pw']['w'] if b.inv['pw'] else (b.inv['sw']['w'] if b.inv['sw'] else None)
            if w and w in WEAPONS and t >= ai['fire_at']:
                foe = None
                bd = 45.0
                for q in self.players.values():
                    if q is b or not q.alive or q.aboard or q.late or (q.flags & 65536):
                        continue
                    d = dist3(b.pos, q.pos)
                    if d < bd:
                        foe, bd = q, d
                if foe:
                    eye = [b.pos[0], b.pos[1] + 1.5, b.pos[2]]
                    aim = [foe.pos[0], foe.pos[1] + 1.2, foe.pos[2]]
                    if not self.solid.blocked(eye, aim):
                        b.yaw = math.atan2(-(aim[0] - eye[0]), -(aim[2] - eye[2]))
                        hit = random.random() < max(0.12, 0.38 - bd / 120)
                        self.handle_shot(b, {'w': w, 'o': eye, 'e': [aim], 'h': [[foe.id, 'b']] if hit else []})
                        ai['fire_at'] = t + max(0.12, 60.0 / WEAPONS[w]['rpm']) * random.uniform(1.0, 2.2)

    def land_height(self, x, z, y):
        """The highest thing under a point in the air, up to a little above it, or the ground."""
        best = 0.0
        H = self.map.get('height')
        if H:
            best = min(y + 0.5, mapgen.surface_at(H, x, z))     # smooth ground: the steps are not what is walked on
        for (cx, cy, cz, hx, hy, hz, yaw, mat, tint) in self.map['boxes']:
            if H and mat == 'terrain':
                continue
            top = cy + hy
            if top <= best or top > y + 0.5:
                continue
            if abs(cx - x) > hx + hz or abs(cz - z) > hx + hz:
                continue
            c, s = math.cos(yaw), math.sin(yaw)
            dx, dz = x - cx, z - cz
            lx = c * dx - s * dz
            lz = s * dx + c * dz
            if abs(lx) <= hx and abs(lz) <= hz:
                best = top
        return best

    def watch_falls(self, t):
        """Nobody hangs in the air. A player whose fall has stopped (the game paused, the
        tab put away) is brought down by the server onto whatever is under them."""
        for p in self.players.values():
            if not p.alive or p.aboard or not (p.flags & 65536):
                p.fall_y = None
                p.fall_force = False
                continue
            if p.fall_force:
                ground = self.land_height(p.pos[0], p.pos[2], p.pos[1])
                y = max(ground, p.pos[1] - FALL_SPEED * TICK)
                p.pos[1] = y
                landed = y <= ground + 0.01
                if landed:
                    p.fall_force = False
                    p.fall_y = None
                    p.fall_lock = t + 4.0
                    p.flags &= ~(65536 | 131072)
                p.send({'t': 'fallto', 'p': [round(v, 2) for v in p.pos], 'land': 1 if landed else 0})
            elif p.fall_y is None or p.pos[1] < p.fall_y - 0.5:
                p.fall_y, p.fall_t = p.pos[1], t
            elif t - p.fall_t > 2.0:
                p.fall_force = True

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

    def roll_chest(self, gold=False):
        """What a chest holds: nearly always a gun with ammo for it, and some of the rest.
        A gold chest holds one legendary gun and nothing else."""
        if gold:
            return [self.gun_item(random.choice(BR_PRIMARIES), 'legendary')]
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
        added = [self.add_item(it, C['p']) for it in self.roll_chest(C.get('gold', False))]
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
        if text.startswith('/bots') and DUMMIES:
            try:
                n = int(text.split()[1])
            except (IndexError, ValueError):
                n = DUMMIES
            self.dummy_want = max(0, min(len(DUMMY_NAMES), n))
            self.add_dummies()
            if not self.dummy_want:
                for b in [q for q in self.players.values() if q.dummy]:
                    self.remove(b)
            return p.send({'t': 'chat', 'sys': 1, 'm': '%d practice dummies' % self.dummy_want})
        if text.startswith('/'):
            return admin_command(p, text)
        team_only = bool(m.get('team')) and self.mode in TEAM_MODES and p.team in (0, 1)
        msg = {'t': 'chat', 'id': p.id, 'n': p.name, 'tm': p.team, 'm': text, 'team': team_only}
        for q in self.players.values():
            if not team_only or q.team == p.team:
                q.send(msg)

    # -- per tick --

    def update(self, t):
        if self.mode == 'royale' and self.phase not in ('waiting', 'countdown') and any(p.bot for p in self.players.values()) \
                and not any(not p.bot for p in self.players.values()):
            self.clear_bots()      # the last human has gone: the bots do not play on alone
        n = self.count()
        self.update_devices(t)
        self.update_streaks(t)
        self.update_fires(t)
        # idlers go back to the menu so they don't hold a slot or a team place
        for p in list(self.players.values()):
            if p.bot or (self.mode == 'royale' and (not p.alive or p.aboard)):
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
                if self.mode == 'royale':
                    # a match everyone walked out of: its looted map is not used again
                    self.map_stale = True
                    self.prepare_map()
            return
        # respawns
        for p in self.players.values():
            if not p.alive and p.respawn_at and t >= p.respawn_at:
                if self.mode != 'bomb' or self.phase in ('waiting', 'countdown'):
                    p.respawn_at = 0
                    self.spawn(p)

        ph = self.phase
        enough = 2 if (self.mode != 'royale' or BOT_FILL < 2) else 1
        if ph == 'waiting':
            if n >= enough:
                cd = self.cfg.get('countdown', COUNTDOWN)
                self.set_phase('countdown', cd)
                self.event({'e': 'countdown', 's': cd})
        elif ph == 'countdown':
            if n < enough:
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
            elif self.mode in AD_MODES:
                self.update_ad(t)
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
        if self.mode in AD_MODES and self.ad and self.phase in ('live', 'ended'):
            A = self.ad
            pts = []
            for S in A['pts']:
                if self.mode == 'rush':
                    d = {'s': S['s']}
                    if S['s'] == 'armed':
                        d['ex'] = round(max(0.0, S['explode'] - t), 1)
                    if S['planter']:
                        d['pl'] = S['planter']
                        d['pt'] = round(min(1.0, (t - S['plant_t']) / AD_ARM), 2)
                    if S['defuser']:
                        d['df'] = S['defuser']
                        d['dt'] = round(min(1.0, (t - S['defuse_t']) / AD_ARM), 2)
                else:
                    d = {'o': S['owner'], 'c': round(S['cap'], 3), 'a': S['a'], 'd': S['d']}
                pts.append(d)
            g['ad'] = {'sec': A['sector'], 'n': len(self.ad_sectors()), 'tk': A['tickets'], 'pts': pts}
            g['att'] = self.attackers
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
            if t_protected(p):
                f |= 128
            if p.id in self.drones:
                f |= 2048   # flying a drone: the body stands still, head down over the controller
            if p.alive and t < p.burn_until:
                f |= 32768  # on fire
            if p.aboard:
                f |= 262144  # in the plane: nothing to see
            if p.heli:
                f |= HELI_FLAG   # in the helicopter's door
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
        return {'t': 'roster', 'pl': [{'id': p.id, 'n': p.name, 'tm': p.team, 'k': p.kills, 'd': p.deaths, 'a': p.assists, 'bot': 1 if p.bot else 0,
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
        return {'o': p.cos['o'], 'g': g, 'c': p.cos.get('c', '')}

    def summary(self):
        return {'id': self.id, 'mode': self.mode, 'name': self.name, 'n': self.count(),
                'max': self.max, 'ph': self.phase, 'map': self.map.get('name', '')}


def t_protected(q):
    return now() < q.protect_until or q.afk_guard


def is_owner(p):
    return bool(p.account) and str(p.account.get('username', '')).lower() == 'mcb'


def admin_command(p, text):
    """Chat commands for the owner: /ban name, /unban name, /bans, /kill [name | all]."""
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
        shown = arg
        for r in list(rooms.values()):
            for q in list(r.players.values()):
                if q.name.lower() == n and q is not p:
                    shown = q.name
                    q.conn.banned(q.name)
                    kicked += 1
        for c in list(lobby):
            if c.player and c.player.name.lower() == n and c.player is not p:
                shown = c.player.name
                c.banned(c.player.name)
                kicked += 1
        # and everyone still here sees it, in big red letters
        msg = {'t': 'banbanner', 'n': shown[:16]}
        for r in list(rooms.values()):
            for q in list(r.players.values()):
                if not q.bot:
                    q.send(msg)
        for c in list(lobby):
            c.send(msg)
        return say('%s is banned%s. Their device and address are banned the moment they connect.' % (arg, ' and kicked' if kicked else ''))
    if cmd == '/unban' and arg:
        n = arg.lower()
        before = len(bans)
        bans[:] = [x for x in bans if x['name'] != n]
        save_bans()
        return say('%s unbanned.' % arg if len(bans) < before else 'No ban under that name.')
    if cmd == '/shop':
        # /shop list · /shop add <outfit|gun|cart|dinars> <id> <price> [name…] · /shop remove <sku>
        words = arg.split()
        sub = words[0].lower() if words else 'list'
        if sub == 'add' and len(words) >= 4:
            kind, item, price = words[1].lower(), words[2], words[3]
            name = ' '.join(words[4:]) or item
            try:
                cents = int(round(float(price.lstrip('$')) * 100))
                entry = shop.add(kind, item, cents, name)
            except ValueError as e:
                return say('Not added: %s. Kinds: outfit, gun (smg:tiger), cart, dinars (amount). Price in dollars, e.g. 4.99.' % e)
            return say('Listed %s as "%s" for %s (sku %s).%s' % (item, entry['name'], shop.price_text(cents), entry['sku'],
                                                            '' if shop.enabled() else ' Payments are not switched on yet: set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET on the server.'))
        if sub == 'remove' and len(words) >= 2:
            return say('Removed %s.' % words[1] if shop.remove(words[1]) else 'No listing with that sku.')
        if sub == 'list':
            if not shop.listings:
                return say('Nothing listed. /shop add outfit nomad 2.99 Nomad outfit')
            return say('Shop (%s): ' % ('payments on' if shop.enabled() else 'payments OFF') + '; '.join('%s = %s %s' % (x['sku'], x['name'], shop.price_text(x['price'])) for x in shop.listings))
        return say('/shop list · /shop add <outfit|gun|cart|dinars> <id> <price> [name] · /shop remove <sku>')
    if cmd == '/bans' and arg.lower() == 'clear':
        # keep the names, forget every device, address and account learned from them
        n = 0
        for x in bans:
            n += len(x['devs']) + len(x['ips']) + len(x['accounts'])
            x['devs'], x['ips'], x['accounts'] = [], [], []
        save_bans()
        return say('Forgot %d learned devices, addresses and accounts. The %d names stay banned.' % (n, len(bans)))
    if cmd == '/bans':
        if not bans:
            return say('Nobody is banned.')
        return say('Banned: ' + ', '.join('%s (%d devices, %d addresses)' % (x['name'], len(x['devs']), len(x['ips'])) for x in bans))
    if cmd == '/kill':
        # /kill on its own: yourself; /kill all: everyone else in your match; /kill name: them, wherever they are
        if not arg:
            targets = [p] if p.room and p.alive else []
        elif arg.lower() == 'all':
            targets = [q for q in p.room.players.values() if q is not p and q.alive] if p.room else []
        else:
            n = arg.lower()
            targets = [q for r in rooms.values() for q in r.players.values() if q.name.lower() == n and q.alive]
        for q in targets:
            q.hurt_by = {}            # nobody gets an assist for it either
            q.room.kill(q, None, ADMIN_KILL, False)
        if not targets:
            return say('Nobody alive by that name.' if arg and arg.lower() != 'all' else 'Nobody to kill.')
        return say('Killed %s.' % ', '.join(q.name for q in targets))
    return say('Commands: /ban name, /unban name, /bans, /bans clear, /kill [name | all], /shop. On your own screen: /fly, /wall, /panel. Scorestreaks 4 5 6 are always yours.')


def room_list():
    return {'t': 'rooms', 'v': VERSION, 'list': [r.summary() for r in sorted(rooms.values(), key=lambda r: r.id)],
            'og': og.player_count()}


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
    if mode == 'royale':
        # one Souk Royale at a time: everyone drops into the same match, or waits for the next
        mine = sorted((r for r in rooms.values() if r.mode == 'royale'), key=lambda r: (not r.persistent, r.id))
        if mine:
            return mine[0]
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

class BotConn:
    """The connection a bot has: nothing goes down it, nothing comes up it."""
    deflate = False
    ip = ''
    dev = ''

    def __init__(self):
        self.closed = False
        self.player = None

    def send(self, obj):
        pass

    def send_raw(self, text):
        pass

    def send_frame(self, data):
        pass

    def close(self):
        self.closed = True

    def banned(self, *a, **k):
        return False


def frame(text, deflate=False):
    """A text frame. With permessage-deflate agreed, the payload is compressed on its own
    (no context carried between messages) and the RSV1 bit says so."""
    data = text.encode('utf-8')
    first = 0x81
    if deflate and len(data) > 60:
        c = zlib.compressobj(6, zlib.DEFLATED, -15)
        z = c.compress(data) + c.flush(zlib.Z_SYNC_FLUSH)
        if z.endswith(b'\x00\x00\xff\xff'):
            z = z[:-4]
        data = z
        first = 0xC1
    n = len(data)
    if n < 126:
        head = struct.pack('!BB', first, n)
    elif n < 65536:
        head = struct.pack('!BBH', first, 126, n)
    else:
        head = struct.pack('!BBQ', first, 127, n)
    return head + data


class Conn:
    def __init__(self, reader, writer, ip='', deflate=False):
        self.reader = reader
        self.writer = writer
        self.deflate = deflate     # permessage-deflate agreed with this browser
        self.closed = False
        self.player = None
        self.last_rooms = 0.0
        self.ip = ip
        self.dev = ''

    def banned(self, name=None, account_id=None):
        """Shut the door on a banned player, remembering how they came in."""
        p = self.player
        acc = account_id or (p.account['id'] if p and p.account else None)
        b = ban_match(name if name is not None else (p.name if p else ''), acc, self.ip, self.dev)
        if not b:
            return False
        # the owner, signed in: whatever matched, it was a mistake; undo it
        if acc and str(name if name is not None else (p.name if p else '')).strip().lower() == OWNER_NAME:
            owner_heal(acc, self.ip, self.dev)
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
        self.send_frame(frame(text, self.deflate))

    def send_frame(self, data):
        """A ready-made frame: the same bytes can go to everyone on the same footing."""
        if self.closed:
            return
        try:
            tr = self.writer.transport
            if tr.get_write_buffer_size() > 4 * 1024 * 1024:
                self.close()
                return
            self.writer.write(data)
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
        rsv1 = False
        while True:
            h = await self.reader.readexactly(2)
            fin = h[0] & 0x80
            op = h[0] & 0x0F
            if op in (1, 2):
                rsv1 = bool(h[0] & 0x40)
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
                    if rsv1:
                        try:
                            buf = zlib.decompressobj(-15).decompress(buf + b'\x00\x00\xff\xff', 512 * 1024)
                        except zlib.error:
                            return None
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
        if party_day() and PARTY_OUTFIT not in lk.setdefault('outfits', []):
            lk['outfits'].append(PARTY_OUTFIT)      # the first month's gift, for signing in on the day
            lk['party_gift'] = True
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
            for c in catalog.CARTS:
                if c[0] not in lk.setdefault('carts', []):
                    lk['carts'].append(c[0])
            # and the whole Battle Pass
            lk['pass'] = max(lk.get('pass', 0), catalog.KILLS_PER_TIER * len(catalog.PASS_TIERS))
            catalog.grant_pass(lk, len(catalog.PASS_TIERS))
            accounts.save_locker(user['id'], lk)
        p.account = {'id': user['id'], 'username': user['username']}
        p.name = user['username']
        self.send(daily.public(lk.get('daily'), daily.today(SYDNEY)))
        self.send({'t': 'auth', 'user': {'username': user['username'], 'email': user['email']},
                   'token': token, 'locker': lk})
        if p.room:
            p.room.roster_dirty = True

    # changing a username or password: the current password and the new value
    # first, then a six-digit code to the account's email, then the change
    async def change(self, m):
        p = self.player
        if not p.account:
            return self.send({'t': 'autherr', 'm': 'Sign in first.'})
        t = now()
        p.auth_times = [x for x in p.auth_times if t - x < 60]
        if len(p.auth_times) >= 8:
            return self.send({'t': 'autherr', 'm': 'Too many tries. Wait a minute and try again.'})
        p.auth_times.append(t)
        loop = asyncio.get_event_loop()
        try:
            if m['t'] == 'change':
                if not mailer.configured() and self.ip not in ('127.0.0.1', '::1'):
                    return self.send({'t': 'autherr', 'm': 'Email confirmation isn’t switched on here yet, so this can’t be changed for now.'})
                kind = str(m.get('kind') or '')
                ch = await loop.run_in_executor(None, accounts.start_change, p.account['id'], kind,
                                                str(m.get('value') or ''), str(m.get('password') or ''))
                what = 'username' if kind == 'username' else 'password'
                text = ('Hi %s,\n\nYour code to change your %s on Souk Siege is:\n\n    %s\n\n'
                        'It works for %d minutes. If this wasn’t you, ignore this email and nothing changes.\n\n'
                        '— Souk Siege' % (ch['username'], what, ch['code'], accounts.CODE_MINUTES))
                await loop.run_in_executor(None, mailer.send, ch['email'], 'Your Souk Siege code: %s' % ch['code'], text)
                return self.send({'t': 'change', 'kind': kind, 'to': mailer.masked(ch['email'])})
            kind, user = await loop.run_in_executor(None, accounts.confirm_change, p.account['id'],
                                                    str(m.get('code') or ''), m.get('token'))
        except accounts.AuthError as e:
            return self.send({'t': 'autherr', 'm': str(e)})
        except Exception as e:  # the mailer, most likely
            print('change error: %r' % (e,), flush=True)
            return self.send({'t': 'autherr', 'm': 'Something went wrong on the server. Try again in a minute.'})
        if self.closed:
            return
        if kind == 'username':
            p.account['username'] = user['username']
            p.name = user['username']
            if p.room:
                p.room.roster_dirty = True
        self.send({'t': 'changed', 'kind': kind, 'user': {'username': user['username'], 'email': user['email']}})

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
            # a saved session comes with hello: if it is the owner's, no ban applies, whatever the address
            tok = m.get('token')
            if ACCOUNTS and isinstance(tok, str) and ban_match(name, None, self.ip, self.dev):
                u = accounts.resume(tok)
                if u and str(u.get('username', '')).lower() == OWNER_NAME:
                    owner_heal(u['id'], self.ip, self.dev)
            if self.banned(name):
                return
            if 'cos' in m:
                self.player.cos = owned_cos(self.player, clean_cos(m.get('cos')))
            self.send({'t': 'welcome', 'id': self.player.id, 'v': VERSION, 'acc': ACCOUNTS})
            self.send(daily.public(p.daily if p else None, daily.today(SYDNEY)))
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
        if p.room is not None and t in ('perk', 'jump', 'reload', 'plant', 'dr', 'fkin', 'open', 'pick', 'vest'):
            p.acted()
        if t == 'ping':
            p.ping = int(num(m.get('rtt'), 0, 9999))
            self.send({'t': 'pong', 'c': m.get('c')})
        elif t == 'rooms':
            self.send(room_list())
        elif t == 'join':
            if self.banned():
                return
            if not p.account and (p.name or '').strip().lower() in ('', 'player'):
                return self.send({'t': 'err', 'm': 'Enter a name before you join, or sign in.'})
            if not p.account and isinstance(m.get('daily'), dict):
                p.daily = daily.clean(m['daily'], daily.today(SYDNEY))     # a guest brings today's progress with them
                self.send(daily.public(p.daily, daily.today(SYDNEY)))
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
                if r.count() >= r.max:
                    return self.send({'t': 'err', 'm': '%s is full (%d/%d). Try again in a moment.' % (r.name, r.count(), r.max)})
            p.pick(m)
            p.last_active = now()
            if 'cos' in m:
                p.cos = owned_cos(p, clean_cos(m.get('cos')))
            # an empty room takes the map its first player asks for
            if m.get('map') in MAP_KINDS and r.count() == 0 and r.map_kind != m['map'] and r.mode not in ('royale', 'derby') + AD_MODES:
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
        elif t in ('change', 'confirm'):
            if not ACCOUNTS:
                return self.send({'t': 'autherr', 'm': 'There are no accounts on this server.'})
            asyncio.ensure_future(self.change(m))
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
            if p.fall_force or (now() < p.fall_lock and num(vec3(m.get('p'))[1]) > p.pos[1] + 1.0):
                return       # their client stopped mid-air: the server has them, and what it says goes
            if p.heli:
                # the helicopter says where you are; only where you look comes from you
                p.yaw = num(m.get('y'))
                p.pitch = num(m.get('pi'), -1.6, 1.6)
                p.flags = int(num(m.get('f'), 0, (1 << 22) - 1))
                p.acted()
                return
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
            p.pos[1] = max(-8.0, min(PLANE_ALT + 10 if r.mode == 'royale' else 90.0 if is_owner(p) else 30.0, p.pos[1]))   # the tunnels run below the town (the owner may fly)
            if 'fu' in m:
                p.fuel = num(m.get('fu'), 0, 100, p.fuel)
            if dist3(p.pos, old_pos) > 0.3 or abs(num(m.get('y')) - p.yaw) > 0.05:
                p.acted()
            p.yaw = num(m.get('y'))
            p.pitch = num(m.get('pi'), -1.6, 1.6)
            p.flags = int(num(m.get('f'), 0, (1 << 22) - 1))
            p.slot = int(num(m.get('sl'), 0, 3))
            p.byaw = num(m.get('by'), default=p.yaw) if 'by' in m else p.yaw
        elif t == 'shot':
            p.acted()
            p.room.handle_shot(p, m)
        elif t == 'nade':
            p.acted()
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
                p.carry = (p.loadout, p.primary, p.secondary, p.perk)
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
        elif t == 'rtc':
            # voice chat signalling: passed to the player it is for, if they are in this room
            to = p.room.players.get(int(num(m.get('to'))))
            d = m.get('d')
            if to and to is not p and not to.bot and isinstance(d, dict) and len(json.dumps(d)) < 20000:
                to.send({'t': 'rtc', 'from': p.id, 'd': d})
        elif t == 'perk':
            p.room.handle_perk(p, m)
        elif t == 'streak':
            p.acted()
            p.room.handle_streak(p, m)
        elif t == 'side':
            p.side = 1 if m.get('s') else 0
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
        elif t == 'door':
            p.room.handle_door(p, m)
        elif t == 'pane':
            p.room.handle_pane(p, m)
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
    if path == '/__mail' and headers.get('host', '').startswith('localhost'):
        # testing only: what the mailer was last asked to send
        return respond(writer, 200, 'application/json', json.dumps(list(mailer.OUTBOX)).encode(), method, {'Cache-Control': 'no-cache'})
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
    if path == '/facts' and method in ('GET', 'HEAD'):
        return respond(writer, 200, 'application/json', json.dumps(facts_public()).encode(), method, {'Cache-Control': 'no-cache'})
    if path == '/shop' and method in ('GET', 'HEAD'):
        return respond(writer, 200, 'application/json', json.dumps(shop.public()).encode(), method, {'Cache-Control': 'no-cache'})
    if path == '/shop/checkout' and method == 'POST':
        # a signed-in player buying one listing: back comes the Stripe page to pay on
        try:
            m = json.loads(body.decode() or '{}')
        except ValueError:
            m = {}
        listing = shop.find(str(m.get('sku') or ''))
        user = accounts.resume(m.get('token')) if ACCOUNTS else None
        err = None
        if not listing:
            err = 'That is not for sale.'
        elif not user:
            err = 'Sign in to buy things: what you buy goes on your account.'
        elif not shop.enabled():
            err = 'Payments are not switched on yet.'
        elif shop.owned(LIVE_LOCKERS.get(user['id']) or user['locker'], listing):
            err = 'You already have that.'
        if err:
            return respond(writer, 400, 'application/json', json.dumps({'error': err}).encode(), method)
        try:
            url = await asyncio.get_event_loop().run_in_executor(None, shop.checkout_session, listing, user)
        except Exception as e:
            print('stripe error: %r' % (e,), flush=True)
            return respond(writer, 502, 'application/json', json.dumps({'error': 'The payment page could not be opened. Try again in a moment.'}).encode(), method)
        return respond(writer, 200, 'application/json', json.dumps({'url': url}).encode(), method)
    if path == '/stripe/webhook' and method == 'POST':
        event = shop.verify_webhook(body, headers.get('stripe-signature', ''))
        if not event:
            return respond(writer, 400, 'text/plain', b'bad signature', method)
        await asyncio.get_event_loop().run_in_executor(None, shop.fulfil, event)
        return respond(writer, 200, 'text/plain', b'ok', method)
    if path in ('/healthz', '/health'):
        body = json.dumps({'ok': True, 'v': VERSION, 'rooms': len(rooms),
                           'players': sum(r.count() for r in rooms.values()), 'og': og.player_count()}).encode()
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
                # compression, if the browser offers it: it cuts the traffic three to four times
                deflate = 'permessage-deflate' in headers.get('sec-websocket-extensions', '')
                ext = 'Sec-WebSocket-Extensions: permessage-deflate; server_no_context_takeover; client_no_context_takeover\r\n' if deflate else ''
                writer.write(('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n'
                              'Connection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n%s\r\n' % (accept, ext)).encode())
                ip = (headers.get('fly-client-ip') or headers.get('x-forwarded-for', '').split(',')[0]).strip()
                if not ip:
                    peer = writer.get_extra_info('peername')
                    ip = peer[0] if peer else ''
                conn = Conn(reader, writer, ip, deflate)
                await conn.run()
                return
            if path == '/og/ws' and 'websocket' in headers.get('upgrade', '').lower():
                # O.G.: the 1.1.0 game, plain frames as it always had
                key = headers.get('sec-websocket-key', '')
                accept = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
                writer.write(('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n'
                              'Connection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n' % accept).encode())
                conn = og.Conn(reader, writer)
                await conn.run()
                return
            if method not in ('GET', 'HEAD') and not (method == 'POST' and path in ('/__shot', '/shop/checkout', '/stripe/webhook')):
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
        save_facts()
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
    load_owner()
    if bans:
        print('bans: %s' % ', '.join(b['name'] for b in bans), flush=True)
    ensure_rooms()
    server = await asyncio.start_server(handle_client, '0.0.0.0', port, limit=64 * 1024)
    print('Souk Siege %s — http://localhost:%d' % (VERSION, port), flush=True)
    asyncio.ensure_future(ticker())
    og.ensure_rooms()
    asyncio.ensure_future(og.ticker())
    async with server:
        await server.serve_forever()


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
