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
import time
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mapgen  # noqa: E402

VERSION = '1.1.0'
PUBLIC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public')
TICK = 1 / 20
MAX_PLAYERS = 8
TEAM_MAX = 4
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
}
LOADOUTS = ['smg', 'lmg', 'shotgun', 'sniper']
NADE_MAX = 2
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

rooms = {}
lobby = set()
next_ids = {'p': 1, 'r': 1}


def now():
    return time.monotonic()


def clean_name(n):
    n = ''.join(ch for ch in str(n or '') if ch.isprintable()).strip()
    return (n[:16] or 'Player')


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
        self.slot = 0
        self.hp = 100
        self.alive = False
        self.respawn_at = 0.0
        self.sc = 0              # spawn counter: stale movement from before a spawn is ignored
        self.kills = 0
        self.deaths = 0
        self.score = 0
        self.last_fire = {}
        self.protect_until = 0.0
        self.nades = NADE_MAX
        self.nade_ids = {}
        self.ping = 0
        self.joined = now()
        self.in_round = False    # bomb mode: took part in the current round

    def send(self, obj):
        self.conn.send(obj)

    def reset_stats(self):
        self.kills = self.deaths = self.score = 0


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

    # -- map --

    def new_map(self):
        self.seed = random.randrange(1, 2 ** 31)
        town = mapgen.generate(self.seed)
        self.map = town.to_json()
        self.solid = mapgen.Solid(self.map['boxes'])
        self.map_msg = json.dumps({'t': 'map', 'map': self.map}, separators=(',', ':'))

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
        self.roster_dirty = True
        self.event({'e': 'join', 'id': p.id, 'n': p.name})
        if self.phase in ('waiting', 'countdown'):
            self.spawn(p)
        elif self.mode != 'bomb':
            p.respawn_at = now() + 1.0
        # bomb mode: joins as a spectator until the next round

    def remove(self, p):
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
        if self.mode in TEAM_MODES and not warmup and p.team in (0, 1):
            pts = list(m['teamSpawns'][self.spawn_side(p)])
            random.shuffle(pts)
            best = next((pt for pt in pts if all(math.hypot(pt[0] - q.pos[0], pt[1] - q.pos[2]) > 1.2
                                                 for q in others)), pts[0])
        else:
            pts = m['ffaSpawns']
            enemies = [q for q in others if warmup or p.team < 0 or q.team != p.team]
            if enemies:
                scored = sorted(pts, key=lambda pt: -min(math.hypot(pt[0] - q.pos[0], pt[1] - q.pos[2])
                                                         for q in enemies))
                best = random.choice(scored[:4])
            else:
                best = random.choice(pts)
        x, z = best
        yaw = math.atan2(x, z)  # face the middle of town
        p.pos = [x, 0.0, z]
        p.yaw = yaw
        p.hp = 100
        p.alive = True
        p.nades = NADE_MAX
        p.sc += 1
        p.protect_until = now() + PROTECT
        p.in_round = True
        p.send({'t': 'spawn', 'p': [x, 0.0, z], 'y': yaw, 'sc': p.sc, 'ld': p.loadout, 'tm': p.team})
        self.roster_dirty = True

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
        self.set_phase('post', BOMB_POST)
        self.event({'e': 'roundend', 'w': winner, 'why': why, 'sc': self.scores})
        self.roster_dirty = True
        if self.scores[winner] >= self.cfg['limit']:
            self.winner = winner

    def end_match(self, winner):
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
        for k, (x, z) in self.map['sites'].items():
            if math.hypot(pos[0] - x, pos[2] - z) < SITE_R and pos[1] < 2.0:
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
        if w not in WEAPONS or w not in (LOADOUTS[p.loadout], 'pistol'):
            return
        spec = WEAPONS[w]
        t = now()
        gap = 60.0 / spec['rpm']
        ok = t - p.last_fire.get(w, 0) >= gap * 0.6
        p.last_fire[w] = t
        o = vec3(m.get('o'))
        ends = m.get('e') if isinstance(m.get('e'), list) else []
        ends = [vec3(e) for e in ends[:spec['pellets']]]
        self.broadcast({'t': 'shot', 'id': p.id, 'w': w, 'o': [round(v, 2) for v in o],
                        'e': [[round(v, 2) for v in e] for e in ends]}, skip=p)
        if not ok or dist3(o, [p.pos[0], p.pos[1] + 1.5, p.pos[2]]) > 4.0:
            return
        hits = m.get('h') if isinstance(m.get('h'), list) else []
        per_target = {}
        for h in hits[:spec['pellets']]:
            if not isinstance(h, list) or len(h) < 2:
                continue
            tid = int(num(h[0]))
            head = h[1] == 'h'
            q = self.players.get(tid)
            if not q or not q.alive or not self.enemies(p, q):
                continue
            if t < q.protect_until:
                continue
            d = dist3(p.pos, q.pos)
            if d > spec['range'] + 5:
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

    def damage(self, q, attacker, dmg, w, head):
        if not q.alive or dmg <= 0:
            return
        q.hp -= dmg
        src = attacker.pos if attacker else None
        q.send({'t': 'hurt', 'd': dmg, 'hp': max(0, q.hp), 'from': src})
        if attacker and attacker is not q:
            attacker.send({'t': 'hitok', 'd': dmg, 'k': q.hp <= 0, 'hs': head})
        if q.hp <= 0:
            self.kill(q, attacker, w, head)

    def kill(self, q, attacker, w, head):
        q.alive = False
        q.hp = 0
        q.deaths += 1
        if self.bomb:
            if self.bomb.get('carrier') == q.id:
                self.drop_bomb(q)
            if self.bomb.get('planter') == q.id:
                self.bomb['planter'] = None
            if self.bomb.get('defuser') == q.id:
                self.bomb['defuser'] = None
        counting = self.phase in ('live', 'freeze')
        if attacker and attacker is not q:
            attacker.kills += 1
            attacker.score += 100
            if counting and self.mode == 'tdm':
                self.scores[attacker.team] += 1
        elif counting and self.mode == 'ffa':
            q.score = max(0, q.score - 50)
        if self.mode != 'bomb' or self.phase in ('waiting', 'countdown'):
            delay = 1.5 if self.phase in ('waiting', 'countdown') else self.cfg['respawn']
            q.respawn_at = now() + delay
        self.event({'e': 'kill', 'k': attacker.id if attacker else 0, 'v': q.id, 'w': w, 'hs': head,
                    'kn': attacker.name if attacker else '', 'vn': q.name, 'p': [round(v, 2) for v in q.pos]})
        q.send({'t': 'dead', 'by': attacker.id if attacker else 0, 'byn': attacker.name if attacker else '',
                'w': w, 'rs': max(0.0, q.respawn_at - now()) if self.mode != 'bomb' or self.phase in ('waiting', 'countdown') else -1})
        self.roster_dirty = True

    def handle_nade(self, p, m):
        if not p.alive or p.nades <= 0 or self.phase in ('freeze', 'post', 'ended'):
            return
        p.nades -= 1
        nid = int(num(m.get('n')))
        p.nade_ids[nid] = now()
        self.broadcast({'t': 'nade', 'id': p.id, 'n': nid, 'o': vec3(m.get('o')), 'v': vec3(m.get('v'))}, skip=p)

    def handle_boom(self, p, m):
        nid = int(num(m.get('n')))
        born = p.nade_ids.pop(nid, None)
        if born is None or now() - born > 6.0:
            return
        pos = vec3(m.get('p'))
        if dist3(pos, p.pos) > 60:
            return
        self.broadcast({'t': 'boom', 'id': p.id, 'n': nid, 'p': pos}, skip=p)
        if self.phase in ('post', 'ended'):
            return
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
            dmg = NADE_DMG * (1 - d / NADE_RADIUS) ** 1.2
            if q is p:
                dmg *= 0.6
            if t_protected(q):
                continue
            self.damage(q, p, int(dmg), 'nade', False)

    # -- per tick --

    def update(self, t):
        n = self.count()
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
        hx, hz = hills[self.hill_i]
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
            f = p.flags & ~1
            if p.alive:
                f |= 1
            if t < p.protect_until:
                f |= 64
            pl.append([p.id, round(p.pos[0], 2), round(p.pos[1], 2), round(p.pos[2], 2),
                       round(p.yaw, 3), round(p.pitch, 3), f, p.loadout, p.slot, max(0, p.hp)])
        return {'t': 'snap', 'g': self.game_state(t), 'p': pl}

    def roster(self):
        return {'t': 'roster', 'pl': [{'id': p.id, 'n': p.name, 'tm': p.team, 'k': p.kills, 'd': p.deaths,
                                       's': p.score, 'ping': p.ping, 'ld': p.loadout}
                                      for p in self.players.values()]}

    def summary(self):
        return {'id': self.id, 'mode': self.mode, 'name': self.name, 'n': self.count(),
                'max': MAX_PLAYERS, 'ph': self.phase}


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
            self.send({'t': 'welcome', 'id': self.player.id, 'v': VERSION})
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
            p.loadout = int(num(m.get('ld'), 0, 3))
            lobby.discard(self)
            r.add(p)
        elif t == 'leave':
            self.leave()
            lobby.add(self)
            self.send(room_list())
        elif p.room is None:
            return
        elif t == 'st':
            if not p.alive or int(num(m.get('sc'))) != p.sc:
                return
            r = p.room
            if r.mode == 'bomb' and r.phase == 'freeze':
                pos = vec3(m.get('p'))
                if dist2(pos, p.pos) < 0.5:
                    p.pos = pos
            else:
                p.pos = vec3(m.get('p'))
            bx, bz = r.map['bounds']
            p.pos[0] = max(-bx, min(bx, p.pos[0]))
            p.pos[2] = max(-bz, min(bz, p.pos[2]))
            p.pos[1] = max(-1.0, min(30.0, p.pos[1]))
            p.yaw = num(m.get('y'))
            p.pitch = num(m.get('pi'), -1.6, 1.6)
            p.flags = int(num(m.get('f'), 0, 1023))
            p.slot = int(num(m.get('sl'), 0, 3))
        elif t == 'shot':
            p.room.handle_shot(p, m)
        elif t == 'nade':
            p.room.handle_nade(p, m)
        elif t == 'boom':
            p.room.handle_boom(p, m)
        elif t == 'ld':
            p.loadout = int(num(m.get('ld'), 0, 3))
            r = p.room
            p.room.roster_dirty = True
            # swap straight away when it is safe to
            if p.alive and (r.phase in ('waiting', 'countdown', 'freeze') or now() - (p.protect_until - PROTECT) < 8):
                p.send({'t': 'ldnow', 'ld': p.loadout})
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
