#!/usr/bin/env python3
"""
The new maps against a running server: the first player into an empty room
can ask for a map, everyone gets that map, spawns land on it and a kill
works there.

    python3 server/server.py 8765 &   # then:
    python3 tools/test_maps.py
"""

import asyncio
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from test_server import P, phase, wait  # noqa: E402
from test_v22 import settle  # noqa: E402


async def play_on(kind, mode):
    a, b = P('Ma'), P('Mb')
    a.ws = await __import__('test_server').WS.connect(__import__('test_server').URL)
    a.ws.send({'t': 'hello', 'name': a.name, 'v': '2.0.0'})
    a.ws.send({'t': 'join', 'mode': mode, 'ld': 0, 'map': kind})
    asyncio.ensure_future(a.read())
    await wait(lambda: a.map, 10, 'the map')
    assert a.map['kind'] == kind, 'asked for %s, got %s' % (kind, a.map['kind'])
    await b.start(mode)
    await wait(lambda: b.map, 10, "the second player's map")
    assert b.map['kind'] == kind and b.map['seed'] == a.map['seed'], 'both players should share the map'
    await phase(a, 'live', 15)
    await settle(a, a, b)
    bx, bz = a.map['bounds']
    for p in (a, b):
        assert abs(p.pos[0]) <= bx and abs(p.pos[2]) <= bz, 'spawned outside the map: %r' % (p.pos,)
    # walk next to them and shoot: the map's boxes are just geometry to the server
    b.move([a.pos[0] + 2, 0, a.pos[2]])
    await asyncio.sleep(0.3)
    a.shoot(b, 3, 'smg')
    await wait(lambda: a.saw('kill'), 4, 'a kill on ' + kind)
    print('%s ok: %s "%s", %d boxes, %d areas, kill landed' % (kind, mode, a.map['name'], len(a.map['boxes']), len(a.map['areas'])))
    a.ws.w.close()
    b.ws.w.close()
    await asyncio.sleep(0.5)


async def main():
    await play_on('dock', 'tdm')
    await play_on('alpine', 'ffa')
    await play_on('town', 'koth')
    print('all passed')


if __name__ == '__main__':
    asyncio.get_event_loop().run_until_complete(main())
