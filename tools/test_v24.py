#!/usr/bin/env python3
"""
Checks the 2.4 features against a running server: cover walls, the bomb
drone, smoke grenades and crates that work again after 15 seconds.

    python3 server/server.py 8765 &   # then:
    python3 tools/test_v24.py
"""

import asyncio
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from test_server import P, phase, wait  # noqa: E402
from test_v22 import settle  # noqa: E402


def got(p, t, **match):
    return [m for m in p.msgs if m.get('t') == t and all(m.get(k) == v for k, v in match.items())]


def snap_hp(watcher, pid):
    for row in watcher.snap_players:
        if row[0] == pid:
            return row[9]
    return None


async def pistol(p, target, times, pause=0.2):
    for _ in range(times):
        p.shoot(target, 1, 'pistol')
        await asyncio.sleep(pause)


async def test_wall():
    a, b = P('Builder'), P('Breaker')
    await a.start('tdm', ld=1, pk='wall')
    await b.start('tdm')
    await phase(a, 'live', 15)
    await settle(a, a, b)
    a.ws.send({'t': 'perk', 'k': 'wall', 'p': [a.pos[0] + 1.3, 0, a.pos[2]], 'y': 0})
    await wait(lambda: got(a, 'wall', hp=900), 3, 'a wall standing')
    wid = got(a, 'wall', hp=900)[0]['id']
    assert got(b, 'wall', id=wid), 'everyone should see the wall'
    b.move([a.pos[0] + 6, 0, a.pos[2]])
    await asyncio.sleep(0.3)
    # 27 pistol rounds at 34 each: 918, just over the wall's 900
    for i in range(27):
        b.ws.send({'t': 'shot', 'w': 'pistol', 'o': [b.pos[0], 1.5, b.pos[2]], 'e': [[a.pos[0] + 1.3, 0.6, a.pos[2]]],
                   'h': [], 'pr': [[wid, 1]]})
        await asyncio.sleep(0.2)
        if i == 20:
            assert not got(b, 'wall', id=wid, off=1), '21 rounds should not drop the wall'
    await wait(lambda: got(a, 'wall', id=wid, off=1), 3, 'the wall falling after 900 damage')
    print('wall ok: stood at 900 hp, fell after 918 damage')
    a.ws.w.close()
    b.ws.w.close()


async def test_drone():
    a, b, c = P('Pilot'), P('Mark'), P('Hunter')
    await a.start('tdm', ld=3, pk='drone')
    await b.start('tdm')
    await c.start('tdm')          # same team as the pilot
    await phase(a, 'live', 15)
    await settle(a, a, b, c)
    assert a.team == c.team != b.team
    b.move([a.pos[0] + 12, 0, a.pos[2]])
    await asyncio.sleep(0.3)
    a.ws.send({'t': 'perk', 'k': 'drone', 'p': a.pos})
    await wait(lambda: got(a, 'drone', id=a.id), 3, 'a drone launched')
    d = got(a, 'drone', id=a.id)[0]
    assert d['life'] > 10 and 'p' in d, d
    assert got(b, 'drone', id=a.id), 'the enemy should see the drone'
    # fly it over the mark in short hops (the server allows 4 m a message)
    x, z = d['p'][0], d['p'][2]
    for _ in range(5):
        x += (b.pos[0] - x) * 0.6
        z += (b.pos[2] - z) * 0.6
        a.ws.send({'t': 'dr', 'p': [x, 1.0, z], 'y': 0})
        await asyncio.sleep(0.12)
    a.ws.send({'t': 'dr', 'p': [b.pos[0], 0.8, b.pos[2]], 'y': 0})
    await asyncio.sleep(0.3)
    a.ws.send({'t': 'drboom'})
    await wait(lambda: got(b, 'drone', id=a.id, boom=1), 3, 'the drone going off')
    await wait(lambda: a.saw('kill'), 3, 'the blast killing the mark')
    print('drone ok: launched, flown over the mark and detonated for a kill')
    # a second drone can't come until respawn (one per life)
    a.ws.send({'t': 'perk', 'k': 'drone', 'p': a.pos})
    await asyncio.sleep(0.5)
    assert len(got(a, 'drone', id=a.id, tm=a.team)) == 1, 'only one drone per life'
    for p in (a, b, c):
        p.ws.w.close()


async def test_shootdown():
    a, b = P('Pilot2'), P('Hunter2')
    await a.start('tdm', ld=3, pk='drone')
    await b.start('tdm')
    await phase(a, 'live', 15)
    await settle(a, a, b)
    a.ws.send({'t': 'perk', 'k': 'drone', 'p': a.pos})
    await wait(lambda: got(b, 'drone', id=a.id), 3, 'a drone to hunt')
    b.move([a.pos[0] + 8, 0, a.pos[2]])
    await asyncio.sleep(0.3)
    # two pistol rounds at 34 beat the drone's 40 hp
    for _ in range(2):
        b.ws.send({'t': 'shot', 'w': 'pistol', 'o': [b.pos[0], 1.5, b.pos[2]], 'e': [a.pos], 'h': [], 'dh': [a.id]})
        await asyncio.sleep(0.25)
    await wait(lambda: got(a, 'drone', id=a.id, off=1, why='shot'), 3, 'the drone shot down')
    earned = [m for m in b.msgs if m.get('t') == 'earn' and m.get('why') == 'shotdown']
    assert earned and earned[0]['n'] == 10, 'shooting a drone down pays 10: %r' % earned
    print('shootdown ok: two rounds dropped the drone and paid 10 dinars')
    a.ws.w.close()
    b.ws.w.close()


async def test_smoke():
    a, b = P('Smoker'), P('Bystander')
    await a.start('tdm', ld=1, nk='smoke')
    await b.start('tdm')
    await phase(a, 'live', 15)
    await settle(a, a, b)
    b.move([a.pos[0] + 2, 0, a.pos[2]])
    await asyncio.sleep(0.3)
    # two smokes a life, like frags: both go, the third doesn't
    for n in range(3):
        a.ws.send({'t': 'nade', 'n': n, 'k': 'smoke', 'o': [a.pos[0], 1.5, a.pos[2]], 'v': [1, 2, 0]})
        await asyncio.sleep(0.15)
    await asyncio.sleep(0.5)
    seen = got(b, 'nade', id=a.id)
    assert len(seen) == 2 and all(m['k'] == 'smoke' for m in seen), 'two smoke throws expected: %r' % [(m['n'], m['k']) for m in seen]
    a.ws.send({'t': 'boom', 'n': 0, 'p': [b.pos[0], 0, b.pos[2]]})
    await asyncio.sleep(0.6)
    assert not got(b, 'hurt'), 'smoke must not hurt'
    assert got(b, 'boom', id=a.id, k='smoke'), 'the smoke popping should be relayed'
    print('smoke ok: two a life, relayed, no damage')
    a.ws.w.close()
    b.ws.w.close()


async def test_crate_again():
    a, c, b = P('Medic'), P('Foe'), P('Patient')
    await a.start('tdm', ld=1, pk='med')
    await c.start('tdm')
    await b.start('tdm')          # third in: back on the Medic's team
    await phase(a, 'live', 15)
    await settle(a, a, b, c)
    assert a.team == b.team != c.team
    b.move([a.pos[0] + 1.0, 0, a.pos[2]])
    c.move([a.pos[0] + 8, 0, a.pos[2]])
    await asyncio.sleep(0.3)
    a.ws.send({'t': 'perk', 'k': 'med', 'p': [a.pos[0] + 1.0, 0, a.pos[2]]})
    await wait(lambda: got(b, 'supply', k='med'), 3, 'a medic crate')
    await pistol(c, b, 1)
    await wait(lambda: got(b, 'heal'), 3, 'the first heal')
    assert len(got(b, 'heal')) == 1
    await pistol(c, b, 1)
    await asyncio.sleep(1.5)
    assert len(got(b, 'heal')) == 1, 'no second heal straight away'
    await wait(lambda: len(got(b, 'heal')) >= 2, 17, 'a second heal after 15 seconds')
    print('crate ok: healed, waited, healed again')
    for p in (a, b, c):
        p.ws.w.close()


async def main():
    await test_wall()
    await test_drone()
    await test_shootdown()
    await test_smoke()
    await test_crate_again()
    print('all passed')


if __name__ == '__main__':
    asyncio.get_event_loop().run_until_complete(main())
