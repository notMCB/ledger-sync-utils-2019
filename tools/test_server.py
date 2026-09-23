#!/usr/bin/env python3
"""
Drives a local Souk Siege server through each mode with scripted players and
checks the match logic: kills and team scores, the bomb (plant, explode,
defuse), and the hill.

    python3 server/server.py 8765 &   # then:
    python3 tools/test_server.py
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bot import WS  # noqa: E402

URL = 'ws://localhost:8765/ws'


class P:
    def __init__(self, name):
        self.name = name
        self.events = []
        self.g = {}
        self.map = None
        self.team = -1
        self.id = 0
        self.sc = 0
        self.pos = [0, 0, 0]
        self.alive = False
        self.snap_players = []
        self.msgs = []        # every message, for tests that look at more than events

    async def start(self, mode, ld=0, **picks):
        self.ws = await WS.connect(URL)
        self.ws.send({'t': 'hello', 'name': self.name, 'v': '2.0.0'})
        # tests play the town unless they ask for another map
        self.ws.send({'t': 'join', 'mode': mode, 'ld': ld, 'map': 'town', **picks})
        asyncio.ensure_future(self.read())

    async def read(self):
        while True:
            try:
                m = await self.ws.recv()
            except (asyncio.IncompleteReadError, ConnectionError, OSError):
                return
            if not m:
                continue
            t = m['t']
            if t != 'snap':
                self.msgs.append(m)
            if t == 'welcome':
                self.id = m['id']
            elif t == 'joined':
                self.id = m['you']
                self.team = m['team']
            elif t == 'map':
                self.map = m['map']
            elif t == 'spawn':
                self.sc = m['sc']
                self.pos = m['p']
                self.alive = True
                self.team = m['tm']
            elif t == 'dead':
                self.alive = False
            elif t == 'team':
                self.team = m['team']
            elif t == 'snap':
                self.g = m['g']
                self.snap_players = m['p']
            elif t == 'ev':
                self.events.append(m)
            elif t in ('assist', 'earn'):
                self.events.append({'e': t, **m})

    def move(self, p):
        self.pos = p
        self.ws.send({'t': 'st', 'p': p, 'y': 0, 'pi': 0, 'f': 0, 'sl': 0, 'sc': self.sc})

    def shoot(self, target, times=1, w='smg'):
        for _ in range(times):
            self.ws.send({'t': 'shot', 'w': w, 'o': [self.pos[0], self.pos[1] + 1.5, self.pos[2]],
                          'e': [target.pos], 'h': [[target.id, 'h']]})

    def saw(self, e):
        return [x for x in self.events if x.get('e') == e]


async def wait(cond, timeout, what):
    for _ in range(int(timeout * 20)):
        if cond():
            return True
        await asyncio.sleep(0.05)
    raise AssertionError('timed out waiting for ' + what)


async def phase(p, ph, timeout=20):
    await wait(lambda: p.g.get('ph') == ph, timeout, 'phase ' + ph)


async def test_tdm():
    a, b = P('A'), P('B')
    await a.start('tdm')
    await b.start('tdm')
    await phase(a, 'live', 15)
    await asyncio.sleep(1.8)  # spawn protection
    assert a.team != b.team, 'players should be on opposite teams'
    b.move([a.pos[0] + 3, 0, a.pos[2]])
    await asyncio.sleep(0.2)
    for _ in range(4):
        a.shoot(b)
        await asyncio.sleep(0.12)
    await wait(lambda: a.saw('kill'), 3, 'kill event')
    await wait(lambda: a.g.get('sc', [0, 0])[a.team] == 1, 2, 'team score')
    await wait(lambda: b.alive, 6, 'respawn')
    print('tdm ok: kill counted for team', a.team, 'score', a.g['sc'])
    a.ws.w.close(); b.ws.w.close()


async def test_bomb(defuse):
    a, b = P('Att'), P('Def')
    await a.start('bomb')
    await b.start('bomb')
    await phase(a, 'freeze', 15)
    await phase(a, 'live', 10)
    att = a.g['att']
    atk, dfn = (a, b) if a.team == att else (b, a)
    bomb = a.g.get('b', {})
    assert bomb.get('c') == atk.id, 'attacker should carry the bomb: %s' % bomb
    sx, sz = atk.map['sites']['A']
    # walk there over a few updates (the server ignores nothing, but be gentle)
    atk.move([sx, 0, sz])
    await asyncio.sleep(0.2)
    atk.ws.send({'t': 'plant', 'on': True})
    await wait(lambda: atk.saw('planted'), 6, 'plant')
    print('bomb planted at', atk.saw('planted')[0]['site'])
    if defuse:
        await wait(lambda: 'p' in atk.g.get('b', {}), 2, 'bomb position')
        bp = atk.g['b']['p']
        dfn.move([bp[0] + 0.5, 0, bp[2]])
        await asyncio.sleep(0.2)
        dfn.ws.send({'t': 'plant', 'on': True})
        await wait(lambda: dfn.saw('defused'), 10, 'defuse')
        await wait(lambda: dfn.saw('roundend'), 3, 'round end')
        ev = dfn.saw('roundend')[0]
        assert ev['w'] == 1 - att and ev['why'] == 'defused', ev
        print('bomb defused: round to defenders', ev['sc'])
    else:
        await wait(lambda: atk.saw('roundend'), 45, 'explosion round end')
        ev = atk.saw('roundend')[0]
        assert ev['w'] == att and ev['why'] == 'exploded', ev
        print('bomb exploded: round to attackers', ev['sc'])
    await wait(lambda: a.saw('round') and len(a.saw('round')) >= 2, 10, 'next round')
    print('next round started')
    a.ws.w.close(); b.ws.w.close()


async def test_koth():
    a, b = P('K1'), P('K2')
    await a.start('koth')
    await b.start('koth')
    await phase(a, 'live', 15)
    await wait(lambda: 'h' in a.g, 3, 'hill state')
    hx, hz = a.map['hills'][a.g['h']['i']]
    a.move([hx, 0, hz])
    await asyncio.sleep(3.2)
    sc = a.g['sc'][a.team]
    assert sc >= 2, 'holding the hill should score: %s' % a.g
    b.move([hx + 1, 0, hz])
    await asyncio.sleep(0.6)
    assert a.g['h']['c'], 'hill should be contested'
    s1 = a.g['sc'][a.team]
    await asyncio.sleep(1.5)
    assert a.g['sc'][a.team] == s1, 'no score while contested'
    print('koth ok: scored', s1, 'then contested')
    a.ws.w.close(); b.ws.w.close()


async def main():
    which = sys.argv[1:] or ['tdm', 'koth', 'bomb', 'defuse']
    for w in which:
        if w == 'tdm':
            await test_tdm()
        elif w == 'koth':
            await test_koth()
        elif w == 'bomb':
            await test_bomb(False)
        elif w == 'defuse':
            await test_bomb(True)
        await asyncio.sleep(1.5)
    print('all passed')


if __name__ == '__main__':
    asyncio.run(main())
