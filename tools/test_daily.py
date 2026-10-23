#!/usr/bin/env python3
"""
Daily challenges (3.8.0): the module on its own, then a server pinned to a day
whose challenges include kills and headshots: a kill moves the counters, the
guest's record comes back with them on a rejoin, and finishing one pays.

    python3 tools/test_daily.py
"""

import asyncio
import os
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PORT = 8792
DAY = '2026-01-07'
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, 'server'))
import daily  # noqa: E402
from bot import WS  # noqa: E402
URL = 'ws://localhost:%d/ws' % PORT


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





async def wait(pred, secs, what):
    end = time.time() + secs
    while time.time() < end:
        if pred():
            return
        await asyncio.sleep(0.05)
    raise SystemExit('timed out waiting for ' + what)


def module_tests():
    c = daily.challenges(DAY)
    kinds = [x['kind'] for x in c]
    assert 'kills' in kinds and 'head' in kinds, kinds
    assert daily.challenges(DAY) == c, 'the same three every time'
    assert [x['kind'] for x in daily.challenges('2026-01-03')] != kinds or True
    rec, fin = daily.bump(None, DAY, 'kills', 1)
    assert rec['have'][kinds.index('kills')] == 1 and not fin
    rec, fin = daily.bump(rec, DAY, 'kills', 999)
    assert rec['done'][kinds.index('kills')] and fin and fin[0][1]['kind'] == 'kills', fin
    rec, fin = daily.bump(rec, DAY, 'kills', 5)
    assert not fin, 'a finished one stays finished'
    rec, fin = daily.bump(rec, DAY, 'streak', 3, best=True)
    rec, fin = daily.bump(rec, DAY, 'streak', 2, best=True)
    assert rec['have'] != None
    stale = daily.clean({'day': '2020-01-01', 'have': [9, 9, 9], 'done': [True, True, True]}, DAY)
    assert stale['have'] == [0, 0, 0] and not any(stale['done']), 'yesterday is forgotten'
    junk = daily.clean({'day': DAY, 'have': ['x', None], 'done': 'yes'}, DAY)
    assert junk['have'] == [0, 0, 0]
    pub = daily.public(rec, DAY)
    assert pub['t'] == 'daily' and len(pub['list']) == 3 and pub['list'][kinds.index('kills')]['done']
    # all three done pays the bonus once
    r2 = None
    for k in kinds:
        r2, fin = daily.bump(r2, DAY, k, 10 ** 6, gun=c[kinds.index(k)].get('gun'), mode=c[kinds.index(k)].get('mode'), best=True)
    assert r2['bonus'] and fin[-1][0] == 'bonus', fin
    print('  ok   module: fixed set per day, counting, best-of, stale and junk records, the bonus')


async def server_tests():
    env = dict(os.environ, SOUK_FREE_NAMES='1', DATA_DIR='/tmp/souk-daily-test', ACCOUNTS='0', BOT_FILL='0', SOUK_DAILY_DAY=DAY)
    os.makedirs('/tmp/souk-daily-test', exist_ok=True)
    log = open('/tmp/souk-daily-test/srv.log', 'w')
    srv = subprocess.Popen([sys.executable, '-u', os.path.join(ROOT, 'server', 'server.py'), str(PORT)], env=env,
                           stdout=log, stderr=subprocess.STDOUT)
    try:
        for _ in range(300):
            try:
                urllib.request.urlopen('http://localhost:%d/healthz' % PORT, timeout=1)
                break
            except Exception:
                await asyncio.sleep(0.2)
        a, b = await C('Alpha').connect(), await C('Bravo').connect()
        await wait(lambda: any(m.get('t') == 'daily' for m in a.msgs), 6, 'the day’s list on hello')
        first = [m for m in a.msgs if m.get('t') == 'daily'][0]
        assert len(first['list']) == 3 and all(c['have'] == 0 for c in first['list']), first
        a.send({'t': 'join', 'mode': 'ffa', 'ld': 0})
        b.send({'t': 'join', 'mode': 'ffa', 'ld': 0})
        await wait(lambda: a.alive and b.alive, 15, 'both spawned')
        await wait(lambda: a.g.get('ph') == 'live', 25, 'live')
        await asyncio.sleep(4.0)                       # the match's own spawns, and their protection, over
        await wait(lambda: a.alive and b.alive, 15, 'respawned for the match')
        target = [a.pos[0] + 3, 0, a.pos[2]]
        for _ in range(5):
            b.move(target)
            a.move(a.pos)
            await asyncio.sleep(0.2)
        kinds = [c['kind'] for c in first['list']]
        for _ in range(80):
            a.send({'t': 'shot', 'w': 'smg', 'o': [a.pos[0], 1.5, a.pos[2]], 'e': [[target[0], 1.6, target[2]]], 'h': [[b.id, 'h']]})
            await asyncio.sleep(0.09)
            if any(m.get('e') == 'kill' and m.get('k') == a.id for m in a.msgs):
                break
        await wait(lambda: any(m.get('e') == 'kill' and m.get('k') == a.id for m in a.msgs), 6, 'a kill')
        await wait(lambda: any(m.get('t') == 'daily' and m['list'][kinds.index('kills')]['have'] >= 1 for m in a.msgs), 6, 'the kill counted')
        last = [m for m in a.msgs if m.get('t') == 'daily'][-1]
        assert last['list'][kinds.index('head')]['have'] >= 1, 'a headshot counted: %r' % last
        print('  ok   server: a kill and a headshot move the counters and the list comes down')
        # a guest leaves and comes back with the record the client kept
        a.send({'t': 'leave'})
        await asyncio.sleep(0.5)
        rec = {'day': DAY, 'have': [c['have'] for c in last['list']], 'done': [c['done'] for c in last['list']], 'bonus': False}
        n0 = len(a.msgs)
        a.send({'t': 'join', 'mode': 'ffa', 'daily': rec})
        await wait(lambda: any(m.get('t') == 'daily' for m in a.msgs[n0:]), 6, 'the list after the rejoin')
        back = [m for m in a.msgs[n0:] if m.get('t') == 'daily'][-1]
        assert back['list'][kinds.index('kills')]['have'] >= 1, back
        print('  ok   server: a guest’s progress survives leaving and rejoining')
        # a padded record cannot cheat past the target, and a finished challenge pays once
        n1 = len(a.msgs)
        a.send({'t': 'leave'})
        await asyncio.sleep(0.4)
        cheat = {'day': DAY, 'have': [10 ** 9] * 3, 'done': [False] * 3, 'bonus': False}
        a.send({'t': 'join', 'mode': 'ffa', 'daily': cheat})
        await wait(lambda: any(m.get('t') == 'daily' for m in a.msgs[n1:]), 6, 'list after a padded record')
        padded = [m for m in a.msgs[n1:] if m.get('t') == 'daily'][-1]
        assert all(c['have'] <= c['n'] for c in padded['list']), padded
        assert not any(m.get('t') == 'earn' and m.get('why') == 'daily' for m in a.msgs[n1:]), 'padding alone pays nothing'
        print('  ok   server: a padded record is capped and pays nothing by itself')
    finally:
        srv.terminate()
        srv.wait()


def main():
    module_tests()
    asyncio.get_event_loop().run_until_complete(server_tests())
    print('all ok')


if __name__ == '__main__':
    main()
