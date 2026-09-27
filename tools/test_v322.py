#!/usr/bin/env python3
"""
3.2.2 against a running server: bots filling a royale, the night flag and the
lights on the maps, lifetime stats on an account, and the kill event's reach.

    SOUK_GAS=0.2 SOUK_NIGHT=1 ACCOUNTS=1 DATA_DIR=/tmp/souk-322 python3 server/server.py 8772 &   # then:
    DATA_DIR=/tmp/souk-322 python3 tools/test_v322.py
"""

import asyncio
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import test_server  # noqa: E402
from test_server import P, phase, wait  # noqa: E402
from test_v29 import got  # noqa: E402
from test_v3 import row, close  # noqa: E402
from bot import WS  # noqa: E402

test_server.URL = 'ws://localhost:8772/ws'


async def signed_in(name):
    """A player on a fresh account."""
    p = P(name)
    p.ws = await WS.connect(test_server.URL)
    p.ws.send({'t': 'hello', 'name': name, 'v': '3.2.2'})
    asyncio.ensure_future(p.read())
    user = ('u%s%d' % (name.lower(), os.getpid() % 10000))[:14]
    p.user = user
    p.ws.send({'t': 'signup', 'username': user, 'email': user + '@example.com', 'password': 'passw0rd!', 'guest': None})
    await wait(lambda: any(m.get('t') == 'auth' and m.get('user') for m in p.msgs), 6, 'the account')
    return p


async def test_night_and_stats():
    a = await signed_in('Alpha')
    b = await signed_in('Bravo')
    a.ws.send({'t': 'join', 'mode': 'ffa', 'ld': 0, 'map': 'dock'})
    b.ws.send({'t': 'join', 'mode': 'ffa', 'ld': 0, 'map': 'dock'})
    await wait(lambda: a.map is not None, 8, 'the map')
    assert a.map.get('night') is True, 'SOUK_NIGHT=1 makes every match a night one: %r' % a.map.get('night')
    lights = [d for d in a.map['deco'] if d['k'] == 'light']
    kinds = {d['kind'] for d in lights}
    assert len(lights) >= 12 and 'flood' in kinds and 'bulb' in kinds, 'the port lit: %d lights %r' % (len(lights), kinds)
    print('night ok: %s at night with %d lights (%s)' % (a.map['name'], len(lights), ', '.join(sorted(kinds))))
    await phase(a, 'live', 40)
    await wait(lambda: a.alive and b.alive, 8, 'both up')
    for p in (a, b):
        p.move([p.pos[0] + 0.6, p.pos[1], p.pos[2]])
    await asyncio.sleep(0.6)
    a.move([b.pos[0] + 2.0, b.pos[1], b.pos[2]])
    await asyncio.sleep(0.3)
    for _ in range(40):
        if a.saw('kill'):
            break
        a.shoot(b, times=1)
        await asyncio.sleep(0.15)
    await wait(lambda: a.saw('kill'), 5, 'a kill')
    ev = a.saw('kill')[-1]
    assert ev.get('d', -1) >= 1 and ev['d'] <= 4, 'the kill event says how far: %r' % ev
    print('reach ok: the kill came from %d m' % ev['d'])
    # the kill and the death are on the accounts at once: log in again and read the locker
    for p, key in ((a, 'kills'), (b, 'deaths')):
        n0 = len([m for m in p.msgs if m.get('t') == 'auth' and m.get('user')])
        p.ws.send({'t': 'login', 'id': p.user, 'password': 'passw0rd!'})
        await wait(lambda: len([m for m in p.msgs if m.get('t') == 'auth' and m.get('user')]) > n0, 6, 'logged in again')
        lk = [m for m in p.msgs if m.get('t') == 'auth' and m.get('user')][-1]['locker']
        assert lk['stats'][key] >= 1, '%s on the account: %r' % (key, lk['stats'])
        assert set(lk['stats']) >= {'matches', 'wins', 'best', 'kills', 'deaths', 'hs', 'dmg', 'time', 'long'}, lk['stats']
    print('stats ok: the kill and the death are on the accounts, with every field the page shows')
    await close(a, b)


async def test_bots():
    a = P('Solo')
    await a.start('royale')
    await wait(lambda: a.map is not None and a.map.get('royale'), 10, 'the royale map')
    assert a.map.get('night') is not True, 'never night in the royale'
    # one player is enough: the countdown starts, and the bots come in with the plane
    await phase(a, 'countdown', 15)
    await phase(a, 'live', 40)
    await asyncio.sleep(1.0)
    ro = [m for m in a.msgs if m.get('t') == 'roster'][-1]
    bots = [p for p in ro['pl'] if p['n'].startswith('Bot ')]
    assert len(bots) == 7, 'seven bots fill the plane: %r' % [p['n'] for p in ro['pl']]
    print('bots ok: %s' % ', '.join(p['n'] for p in bots))
    # they drop and come down
    bx, bz = a.map['bounds']
    await wait(lambda: row(a, a.id) and abs(row(a, a.id)[1]) <= bx - 2 and abs(row(a, a.id)[3]) <= bz - 2, 30, 'the plane over the map')
    a.ws.send({'t': 'jump'})
    await wait(lambda: got(a, 'jumped'), 3, 'jumped')
    a.sc = [x for x in a.msgs if x.get('t') == 'spawn'][-1]['sc']
    a.move([0, 0.16, 0])
    ids = [p['id'] for p in bots]
    await wait(lambda: any(row(a, i) and row(a, i)[2] < 30 for i in ids), 60, 'a bot to come down')
    await asyncio.sleep(6.0)
    down = [i for i in ids if row(a, i) and row(a, i)[2] < 30]
    assert down, 'bots on the ground'
    p0 = {i: row(a, i)[1:4] for i in down}
    await asyncio.sleep(4.0)
    moved = [i for i in down if row(a, i) and (abs(row(a, i)[1] - p0[i][0]) > 0.5 or abs(row(a, i)[3] - p0[i][2]) > 0.5)]
    assert moved, 'the bots walk about once down: %r' % [(i, p0[i], row(a, i)[1:4]) for i in down]
    opened = [m for m in a.msgs if m.get('t') == 'chest' and m.get('by') in ids]
    print('bots play ok: %d down, %d walking, %d chests opened by bots so far' % (len(down), len(moved), len(opened)))
    # the last human leaves: the bots go too, and the room is empty
    a.ws.send({'t': 'leave'})
    await asyncio.sleep(1.0)
    a.ws.send({'t': 'rooms'})
    await wait(lambda: [m for m in a.msgs if m.get('t') == 'rooms'], 3, 'the room list')
    rl = [m for m in a.msgs if m.get('t') == 'rooms'][-1]['list']
    roy = [r for r in rl if r['mode'] == 'royale']
    assert roy and roy[0]['n'] == 0, 'the bots do not play on alone: %r' % roy
    print('bots leave ok: the room emptied when the human left')
    await close(a)


async def main():
    await test_bots()
    await test_night_and_stats()
    print('all passed')


if __name__ == '__main__':
    asyncio.get_event_loop().run_until_complete(main())
