#!/usr/bin/env python3
"""
Checks the 2.0 server features: accounts, crates and equipping, chat,
perks (ammo, medkit, ladder, beacon), flash grenades and dinar payouts.

Starts its own server on port 8766 with a throwaway database, so it never
touches real data:

    python3 tools/test_v2.py
"""

import asyncio
import os
import random
import shutil
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bot import WS  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8766
URL = 'ws://localhost:%d/ws' % PORT
DATA = '/tmp/souk-test-data-%d' % os.getpid()
failures = []


def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond:
        failures.append(what)


class C:
    """A scripted client."""

    def __init__(self, name='T'):
        self.name = name
        self.msgs = []
        self.id = 0
        self.sc = 0
        self.pos = [0, 0, 0]
        self.team = -1
        self.hp = 100
        self.alive = False
        self.g = {}
        self.map = None

    async def connect(self):
        self.ws = await WS.connect(URL)
        self.ws.send({'t': 'hello', 'name': self.name, 'v': '2.0.0'})
        asyncio.ensure_future(self.read())
        await self.wait(lambda: self.id, 'welcome')
        return self

    async def read(self):
        while True:
            try:
                m = await self.ws.recv()
            except Exception:
                return
            if not m:
                continue
            self.msgs.append(m)
            t = m['t']
            if t == 'welcome':
                self.id = m['id']
            elif t == 'spawn':
                self.sc, self.pos, self.alive, self.team, self.hp = m['sc'], m['p'], True, m['tm'], 100
            elif t == 'dead':
                self.alive = False
            elif t in ('hurt', 'heal'):
                self.hp = m['hp']
            elif t == 'snap':
                self.g = m['g']
            elif t == 'map':
                self.map = m['map']
            elif t == 'team':
                self.team = m['team']

    def send(self, m):
        self.ws.send(m)

    def last(self, t, pred=lambda m: True):
        for m in reversed(self.msgs):
            if m['t'] == t and pred(m):
                return m
        return None

    async def wait(self, cond, what, timeout=6):
        end = time.time() + timeout
        while time.time() < end:
            v = cond()
            if v:
                return v
            await asyncio.sleep(0.05)
        return None

    async def reply(self, t, what, timeout=6, pred=lambda m: True):
        n = len(self.msgs)
        end = time.time() + timeout
        while time.time() < end:
            for m in self.msgs[n:]:
                if m['t'] == t and pred(m):
                    return m
            await asyncio.sleep(0.05)
        return None

    def move(self, p):
        self.pos = p
        self.send({'t': 'st', 'p': p, 'y': 0, 'pi': 0, 'f': 0, 'sl': 0, 'sc': self.sc})

    def close(self):
        self.ws.w.close()


async def auth(c, t, **kw):
    c.send(dict(t=t, **kw))
    end = time.time() + 8
    n = len(c.msgs)
    while time.time() < end:
        for m in c.msgs[n:]:
            if m['t'] in ('auth', 'autherr'):
                return m
        await asyncio.sleep(0.05)
    return None


async def test_accounts():
    print('accounts')
    u = 'tester%d' % random.randrange(10 ** 6)
    c = await C().connect()
    r = await auth(c, 'signup', username='no', email='x@y.com', password='longenough')
    check(r and r['t'] == 'autherr' and 'Usernames' in r['m'], 'short username is refused')
    r = await auth(c, 'signup', username=u, email='bad-email', password='longenough')
    check(r and r['t'] == 'autherr' and 'email' in r['m'], 'bad email is refused')
    r = await auth(c, 'signup', username=u, email=u + '@example.com', password='short')
    check(r and r['t'] == 'autherr' and '8 characters' in r['m'], 'short password is refused')
    guest = {'dinars': 999999, 'guns': ['smg:gilded', 'smg:notreal'], 'outfits': ['sultan', 'fake']}
    r = await auth(c, 'signup', username=u, email=u + '@example.com', password='correct horse', guest=guest)
    check(r and r['t'] == 'auth' and r['user']['username'] == u and r.get('token'), 'sign up works and returns a session')
    lk = r['locker']
    check(lk['dinars'] == 5000, 'guest dinars carried over, capped at 5000 (got %s)' % lk['dinars'])
    check(lk['guns'] == ['smg:gilded'] and 'sultan' in lk['outfits'] and 'fake' not in lk['outfits'], 'guest items carried over, invalid ones dropped')
    token = r['token']
    c2 = await C().connect()
    r = await auth(c2, 'signup', username=u.upper(), email='other@example.com', password='correct horse')
    check(r and r['t'] == 'autherr' and 'taken' in r['m'], 'usernames are unique regardless of case')
    r = await auth(c2, 'signup', username=u + 'x', email=u.upper() + '@EXAMPLE.com', password='correct horse')
    check(r and r['t'] == 'autherr' and 'email' in r['m'], 'emails are unique regardless of case')
    r = await auth(c2, 'login', id=u, password='wrong password')
    check(r and r['t'] == 'autherr', 'wrong password is refused')
    r = await auth(c2, 'login', id=u + '@example.com', password='correct horse')
    check(r and r['t'] == 'auth' and r['user']['username'] == u, 'sign in with email works')
    r = await auth(c2, 'resume', token=token)
    check(r and r['t'] == 'auth' and r['user']['username'] == u, 'a saved session signs you back in')
    r = await auth(c2, 'resume', token='x' * 43)
    check(r and r['t'] == 'auth' and r['user'] is None, 'a made-up session is rejected')

    # crates on the account
    c.send({'t': 'crate', 'kind': 'bazaar'})
    m = await c.reply('crate', 'bazaar')
    check(m and m['prize'] and m['locker']['dinars'] <= 4500 + 150, 'the Bazaar Case costs 500 (%s left)' % (m and m['locker']['dinars']))
    p = m['prize']
    check(p['rarity'] != 'common', 'the Bazaar Case never gives commons')
    opened = 0
    while True:
        c.send({'t': 'crate', 'kind': 'gun'})
        m = await c.reply('crate', 'gun')
        if not m['prize']:
            break
        opened += 1
        if opened > 200:
            break
    check(m['locker']['dinars'] < 100, 'crates stop when you run out of dinars (opened %d more)' % opened)
    # equip: owned works, unowned is dropped
    owned = [k for k in m['locker']['guns'] if k.startswith('smg:')]
    f = owned[0].split(':')[1]
    c.send({'t': 'equip', 'equip': {'outfit': 'stargazer', 'guns': {'smg': f, 'lmg': 'gilded'}, 'pistol': {'2': 'notreal'}, 'nade': {'2': 'flash'}}})
    m = await c.reply('locker', 'equip')
    eq = m['locker']['equip']
    check(eq['guns'].get('smg') == f, 'equipping an owned finish works')
    check('lmg' not in eq['guns'] or ('lmg:gilded' in m['locker']['guns']), 'equipping an unowned finish is ignored')
    check(eq['nade'].get('2') == 'flash', 'the Breacher grenade choice is saved')
    # the locker survives a fresh sign-in
    c3 = await C().connect()
    r = await auth(c3, 'login', id=u, password='correct horse')
    check(r and r['locker']['dinars'] == m['locker']['dinars'] and r['locker']['equip']['guns'].get('smg') == f, 'the locker is saved to the account')
    c.send({'t': 'logout', 'token': token})
    await c.reply('auth', 'logout')
    r = await auth(c2, 'resume', token=token)
    check(r and r['user'] is None, 'signing out ends that session')
    for x in (c, c2, c3):
        x.close()
    return u


async def join_pair(mode, ld_a=0, ld_b=0):
    a, b = await C('A').connect(), await C('B').connect()
    a.send({'t': 'join', 'mode': mode, 'ld': ld_a})
    b.send({'t': 'join', 'mode': mode, 'ld': ld_b})
    await a.wait(lambda: a.alive and b.alive, 'spawn')
    return a, b


async def test_chat():
    print('chat')
    a, b = await join_pair('tdm')
    a.send({'t': 'chat', 'm': 'hello there\x07'})
    m = await b.reply('chat', 'chat')
    check(m and m['m'] == 'hello there' and m['n'] == 'A', 'chat reaches other players, control characters removed')
    a.send({'t': 'chat', 'm': 'spam'})
    await asyncio.sleep(0.3)
    check(not b.last('chat', lambda x: x['m'] == 'spam'), 'chat is rate limited')
    # wait for the match so teams apply, then team chat stays on the team
    await a.wait(lambda: a.g.get('ph') == 'live', 'live', 15)
    await asyncio.sleep(0.8)
    a.send({'t': 'chat', 'm': 'team only', 'team': True})
    m = await a.reply('chat', 'own team chat')
    await asyncio.sleep(0.4)
    check(m and m['team'], 'team chat comes back to your own team')
    check(not b.last('chat', lambda x: x['m'] == 'team only'), 'team chat does not reach the other team')
    a.close(); b.close()


async def test_perks():
    print('perks and grenades')
    # A: assault (ammo), B: support (med)
    a, b = await join_pair('ffa', 0, 1)
    await a.wait(lambda: a.g.get('ph') == 'live', 'live', 15)
    await a.wait(lambda: a.alive and b.alive, 'respawn')
    await asyncio.sleep(1.7)
    b.move([a.pos[0] + 3, 0, a.pos[2]])
    a.move(a.pos)
    await asyncio.sleep(0.2)
    a.send({'t': 'shot', 'w': 'smg', 'o': [a.pos[0], 1.5, a.pos[2]], 'e': [b.pos], 'h': [[b.id, 'b']]})
    await b.wait(lambda: b.hp < 100, 'hurt')
    hp = b.hp
    earn = await a.reply('earn', 'no earn', timeout=0.5)
    b.send({'t': 'perk', 'k': 'med', 'p': [b.pos[0], 0, b.pos[2]]})
    m = await b.reply('heal', 'heal')
    check(m and m['hp'] == 100, 'standing at your medic crate heals you to full (%s -> %s)' % (hp, m and m['hp']))
    b.send({'t': 'perk', 'k': 'ammo', 'p': [b.pos[0], 0, b.pos[2]]})
    await asyncio.sleep(0.3)
    check(not b.last('perkok'), 'you can only use your own loadout’s perk')
    a.send({'t': 'perk', 'k': 'ammo', 'p': [a.pos[0], 0, a.pos[2]]})
    m = await a.reply('perkok', 'ammo')
    check(m and m['k'] == 'ammo', 'standing at your ammo crate restocks you')
    await asyncio.sleep(0.5)
    check(len([x for x in a.msgs if x['t'] == 'perkok']) == 1, 'each crate restocks you only once')
    far = [a.pos[0] + 30, 0, a.pos[2]]
    a.send({'t': 'perk', 'k': 'ammo', 'p': far})
    await asyncio.sleep(0.3)
    m = await a.reply('supply', 'crate 2', timeout=0.4, pred=lambda x: not x.get('off'))
    check(m is None, 'a crate must be dropped near you')
    a.send({'t': 'perk', 'k': 'ammo', 'p': [a.pos[0] + 1, 0, a.pos[2]]})
    await a.reply('perkleft', 'ammo 2')
    a.send({'t': 'perk', 'k': 'ammo', 'p': [a.pos[0] + 1, 0, a.pos[2]]})
    m = await a.reply('supply', 'ammo 3', timeout=0.6, pred=lambda x: not x.get('off'))
    check(m is None, 'two crates per life')
    # kill pays 50 dinars
    for _ in range(6):
        a.send({'t': 'shot', 'w': 'smg', 'o': [a.pos[0], 1.5, a.pos[2]], 'e': [b.pos], 'h': [[b.id, 'h']]})
        await asyncio.sleep(0.1)
    m = await a.wait(lambda: a.last('earn', lambda x: x['why'] == 'kill'), 'earn')
    check(m and m['n'] == 60, 'a headshot kill pays 50 + 10 dinars (got %s)' % (m and m['n']))
    a.close(); b.close()

    # breacher ladder + flash, marksman beacon
    a, b = await join_pair('ffa', 2, 3)
    await a.wait(lambda: a.g.get('ph') == 'live', 'live', 15)
    await a.wait(lambda: a.alive and b.alive, 'respawn')
    a.send({'t': 'perk', 'k': 'ladder', 'p': [a.pos[0] + 1, a.pos[1], a.pos[2]], 'y': 0.5})
    m = await b.reply('ladder', 'ladder')
    check(m and m['id'] == a.id and not m.get('off'), 'a placed ladder is shared with everyone')
    b.move([a.pos[0] + 6, 0, a.pos[2]])
    await asyncio.sleep(0.2)
    b.send({'t': 'perk', 'k': 'beacon', 'p': [b.pos[0], 0, b.pos[2]]})
    m = await b.reply('ping', 'ping', timeout=4)
    check(m and any(pt[0] == a.id for pt in m['pts']), 'the beacon locates nearby enemies')
    # flash grenade: no damage
    hp = b.hp
    a.send({'t': 'nade', 'n': 1, 'k': 'flash', 'o': [a.pos[0], 1.5, a.pos[2]], 'v': [0, 0, 0]})
    m = await b.reply('nade', 'nade')
    check(m and m['k'] == 'flash', 'breacher can throw a flash')
    a.send({'t': 'boom', 'n': 1, 'p': [b.pos[0], 0.2, b.pos[2]]})
    m = await b.reply('boom', 'boom')
    await asyncio.sleep(0.3)
    check(m and m['k'] == 'flash' and b.hp == hp, 'a flash does no damage (hp %s -> %s)' % (hp, b.hp))
    # a frag from the marksman at the same spot hurts
    b.send({'t': 'nade', 'n': 2, 'k': 'flash', 'o': [b.pos[0], 1.5, b.pos[2]], 'v': [0, 0, 0]})
    m = await a.reply('nade', 'nade2')
    check(m and m['k'] == 'frag', 'other loadouts can only throw frags')
    a.close(); b.close()


async def test_team_crates():
    print('team crates')
    a, b = await join_pair('tdm', 1, 0)
    await a.wait(lambda: a.g.get('ph') == 'live', 'live', 15)
    await a.wait(lambda: a.alive and b.alive, 'respawn')
    # c joins so a has a teammate
    c = await C('C').connect()
    c.send({'t': 'join', 'mode': 'tdm', 'ld': 0})
    await c.wait(lambda: c.alive, 'c spawn', 8)
    await asyncio.sleep(0.5)
    mate = c if c.team == a.team else b
    foe = b if mate is c else c
    await asyncio.sleep(1.7)
    # hurt the teammate (the foe shoots them), then the medic drops a crate beside them
    foe.move([mate.pos[0] + 3, 0, mate.pos[2]])
    await asyncio.sleep(0.2)
    foe.send({'t': 'shot', 'w': 'smg', 'o': [foe.pos[0], 1.5, foe.pos[2]], 'e': [mate.pos], 'h': [[mate.id, 'b']]})
    await mate.wait(lambda: mate.hp < 100, 'hurt')
    a.move([mate.pos[0] + 1, 0, mate.pos[2]])
    await asyncio.sleep(0.2)
    a.send({'t': 'perk', 'k': 'med', 'p': [mate.pos[0] + 0.5, 0, mate.pos[2]]})
    m = await mate.reply('heal', 'mate heal')
    check(m and m['hp'] == 100 and m.get('by') == 'A', 'a medic crate heals teammates (%s)' % (m,))
    e = await a.wait(lambda: a.last('earn', lambda x: x['why'] == 'assist'), 'assist')
    check(e and e['n'] == 10, 'the medic earns 10 dinars for it')
    foe.move([a.pos[0] + 0.3, 0, a.pos[2]])
    await asyncio.sleep(0.8)
    check(not foe.last('heal'), 'enemies can’t use your crate')
    a.close(); b.close(); c.close()


async def main():
    shutil.rmtree(DATA, ignore_errors=True)
    env = dict(os.environ, DATA_DIR=DATA)
    proc = subprocess.Popen([sys.executable, os.path.join(ROOT, 'server', 'server.py'), str(PORT)], env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        for _ in range(60):
            await asyncio.sleep(0.1)
            try:
                w = await WS.connect(URL)
                w.w.close()
                break
            except OSError:
                pass
        await test_accounts()
        await test_chat()
        await test_perks()
        await test_team_crates()
    finally:
        proc.terminate()
        out = proc.communicate(timeout=5)[0].decode()
        errs = [l for l in out.splitlines() if 'Traceback' in l or 'error' in l.lower()]
        check(not errs, 'server logged no errors' + ('' if not errs else ': ' + '; '.join(errs[:3])))
        shutil.rmtree(DATA, ignore_errors=True)
    print('\n%s' % ('ALL PASSED' if not failures else '%d FAILED' % len(failures)))
    sys.exit(1 if failures else 0)


asyncio.run(main())
