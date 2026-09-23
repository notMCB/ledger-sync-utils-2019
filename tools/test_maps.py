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


async def test_forklift():
    """On the dockyard a player can climb onto a forklift, drive it, and everyone sees it move."""
    a, b = P('Driver'), P('Watcher')
    a.ws = await __import__('test_server').WS.connect(__import__('test_server').URL)
    a.ws.send({'t': 'hello', 'name': a.name, 'v': '2.0.0'})
    a.ws.send({'t': 'join', 'mode': 'tdm', 'ld': 0, 'map': 'dock'})
    asyncio.ensure_future(a.read())
    await wait(lambda: a.map, 10, 'the map')
    await b.start('tdm')
    await wait(lambda: b.map, 10, 'the second map')
    await phase(a, 'live', 15)
    await settle(a, a, b)
    fks = [d for d in a.map['deco'] if d['k'] == 'forklift']
    assert fks, 'the dockyard should have forklifts'
    f = fks[0]
    # too far away: refused
    a.ws.send({'t': 'fkin', 'id': f['id']})
    await asyncio.sleep(0.4)
    assert not [m for m in a.msgs if m.get('t') == 'fk' and m.get('driver') == a.id], 'cannot board from across the yard'
    a.move([f['x'] + 1.5, 0, f['z']])
    await asyncio.sleep(0.3)
    a.ws.send({'t': 'fkin', 'id': f['id']})
    await wait(lambda: [m for m in b.msgs if m.get('t') == 'fk' and m.get('driver') == a.id], 3, 'the driver seated')
    # drive a little way: the watcher sees the truck move in the snapshot
    for k in range(6):
        a.ws.send({'t': 'fk', 'id': f['id'], 'p': [f['x'] + 1.0 * (k + 1), 0, f['z']], 'y': 0.3})
        a.move([f['x'] + 1.0 * (k + 1), 0, f['z']])
        await asyncio.sleep(0.15)
    await asyncio.sleep(0.4)
    snap = getattr(b, 'last_snap', None)
    moved = [row for row in (b.snap_fk or []) if row[0] == f['id'] and row[1] > f['x'] + 4]
    assert moved, 'the forklift should have moved in the watcher\'s snapshot: %r' % (b.snap_fk,)
    a.ws.send({'t': 'fkout', 'id': f['id']})
    await wait(lambda: [m for m in b.msgs if m.get('t') == 'fk' and m.get('driver') == 0 and m['id'] == f['id'] and m['p'][0] > f['x'] + 4], 3, 'the truck left where it stopped')
    print('forklift ok: boarded when close, drove, seen by others, left in place')
    a.ws.w.close()
    b.ws.w.close()
    await asyncio.sleep(0.5)


async def main():
    await play_on('dock', 'tdm')
    await play_on('alpine', 'ffa')
    await play_on('town', 'koth')
    await test_forklift()
    print('all passed')


if __name__ == '__main__':
    asyncio.get_event_loop().run_until_complete(main())
