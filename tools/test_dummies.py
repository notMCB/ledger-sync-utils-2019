#!/usr/bin/env python3
"""
Practice dummies and the name rule, against a server started with dummies on:

    SOUK_DUMMIES=2 ACCOUNTS=0 python3 server/server.py 8784 &   # then:
    python3 tools/test_dummies.py

A named player joining Free for All finds two dummies standing in the room,
they can be killed and come back, /bots 3 makes a third, and a player
called "Player" (or nothing) is not let in.
"""

import asyncio
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import test_server  # noqa: E402
from test_server import P, wait, phase  # noqa: E402
from bot import WS  # noqa: E402

test_server.URL = os.environ.get('SOUK_URL', 'ws://localhost:8784/ws')


async def main():
    a = P('Ace')
    await a.start('ffa')
    await wait(lambda: [m for m in a.msgs if m['t'] == 'roster' and len(m['pl']) >= 3], 5, 'dummies in the roster')
    roster = [m for m in a.msgs if m['t'] == 'roster'][-1]['pl']
    dummies = [r for r in roster if r['n'].startswith('Dummy')]
    assert len(dummies) == 2, roster
    print('  ok   two dummies joined the room with the player')
    await phase(a, 'live', 20)
    await asyncio.sleep(1.8)
    d = dummies[0]
    row = lambda: next((r for r in a.snap_players if r[0] == d['id']), None)
    await wait(lambda: row() and (row()[6] & 1), 5, 'a dummy standing')
    r = row()
    a.move([r[1] + 2, r[2], r[3]])
    await asyncio.sleep(0.3)
    target = P('x')
    target.id, target.pos = d['id'], [r[1], r[2], r[3]]
    for _ in range(5):
        a.shoot(target)
        await asyncio.sleep(0.1)
    await wait(lambda: a.saw('kill') and a.saw('kill')[-1]['v'] == d['id'], 4, 'the dummy killed')
    print('  ok   a dummy can be shot straight away, and dies')
    await wait(lambda: row() and (row()[6] & 1), 8, 'the dummy back')
    print('  ok   it comes back')
    r2 = row()
    await asyncio.sleep(1.0)
    r3 = row()
    assert abs(r2[1] - r3[1]) < 0.01 and abs(r2[3] - r3[3]) < 0.01, 'dummies do not move'
    print('  ok   it stands still')
    a.ws.send({'t': 'chat', 'm': '/bots 3'})
    await wait(lambda: len([r for r in a.snap_players if r[0] not in (a.id,)]) == 3, 5, 'a third dummy')
    print('  ok   /bots 3 brings a third')
    # no name, no game
    ws = await WS.connect(test_server.URL)
    ws.send({'t': 'hello', 'name': 'Player', 'v': '2.0.0'})
    ws.send({'t': 'join', 'mode': 'ffa', 'ld': 0})
    got = []
    for _ in range(10):
        m = await ws.recv()
        if m:
            got.append(m)
        if any(x['t'] == 'err' for x in got):
            break
    err = [x for x in got if x['t'] == 'err']
    assert err and 'name' in err[0]['m'].lower(), got
    assert not any(x['t'] == 'joined' for x in got), 'not let in'
    print('  ok   "Player" is not let into a game')
    ws.w.close()
    a.ws.w.close()
    await asyncio.sleep(0.5)
    print('all ok')


if __name__ == '__main__':
    asyncio.run(main())
