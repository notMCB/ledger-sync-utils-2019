#!/usr/bin/env python3
"""
The niche modes against a running server: each hands out its kit and refuses
everything else; one in the chamber counts rounds and lives.

    DATA_DIR=/tmp/souk-test python3 server/server.py 8765 &   # then:
    DATA_DIR=/tmp/souk-test python3 tools/test_v212.py
"""

import asyncio
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from test_server import P, phase, wait  # noqa: E402
from test_v22 import settle  # noqa: E402
from test_v29 import got, shot  # noqa: E402


async def pair(mode, name_a, name_b, ld=0, **picks):
    a, b = P(name_a), P(name_b)
    await a.start(mode, ld=ld, **picks)
    await b.start(mode)
    await phase(a, 'live', 15)
    await settle(a, a, b)
    b.move([a.pos[0] + 4, 0, a.pos[2]])
    await asyncio.sleep(0.3)
    return a, b


async def close(*ps):
    for p in ps:
        p.ws.w.close()
    await asyncio.sleep(0.4)


async def test_snipers():
    a, b = await pair('snipers', 'Sn1', 'Sn2', ld=0, pw='smg')
    shot(a, b, 'smg')
    shot(a, b, 'pistol')
    await asyncio.sleep(0.4)
    assert not got(b, 'hurt'), 'only the .50 fires in Snipers'
    shot(a, b, 'heavy', 'b')
    await wait(lambda: a.saw('kill'), 3, 'a .50 kill')
    ro = [m for m in a.msgs if m.get('t') == 'roster'][-1]
    me = [p for p in ro['pl'] if p['id'] == a.id][0]
    assert me['pw'] == 'heavy' and me['sw'] == '', 'the roster shows the .50 and no sidearm: %r' % me
    print('snipers ok: the .50 only')
    await close(a, b)


async def test_knives():
    a, b = await pair('knives', 'Kn1', 'Kn2')
    shot(a, b, 'smg')
    shot(a, b, 'pistol')
    await asyncio.sleep(0.4)
    assert not got(b, 'hurt'), 'only the knife counts in Knife Fight'
    a.move([b.pos[0], 0, b.pos[2] + 1.2])          # behind the victim
    await asyncio.sleep(0.3)
    shot(a, b, 'knife', 'b')
    await wait(lambda: a.saw('kill'), 3, 'a backstab')
    a.ws.send({'t': 'nade', 'n': 1, 'k': 'frag', 'o': [a.pos[0], 1.5, a.pos[2]], 'v': [1, 2, 0]})
    await asyncio.sleep(0.4)
    assert not got(b, 'nade', id=a.id), 'no grenades in Knife Fight'
    print('knives ok: knives only, no grenades')
    await close(a, b)


async def test_firefight():
    a, b = await pair('firefight', 'Ff1', 'Ff2', ld=0)
    b.move([a.pos[0] + 3, 0, a.pos[2]])
    await asyncio.sleep(0.3)
    shot(a, b, 'smg')
    await asyncio.sleep(0.3)
    assert not got(b, 'hurt'), 'no guns in Firefight'
    shot(a, b, 'flamer')
    await wait(lambda: [m for m in got(b, 'hurt') if m.get('fire')], 3, 'flame damage')
    a.ws.send({'t': 'nade', 'n': 1, 'k': 'frag', 'o': [a.pos[0], 1.5, a.pos[2]], 'v': [1, 2, 0]})
    await wait(lambda: got(b, 'nade', id=a.id), 3, 'the grenade seen')
    assert got(b, 'nade', id=a.id)[0]['k'] == 'molotov', 'every grenade is a molotov here'
    print('firefight ok: flame and molotovs only')
    await close(a, b)


async def test_oitc():
    a, b = await pair('oitc', 'Oc1', 'Oc2', ld=2)
    assert [m for m in a.msgs if m.get('t') == 'spawn'][-1].get('lv') == 3, 'three lives to start'
    # a miss empties the chamber: the next pistol shot does nothing
    a.ws.send({'t': 'shot', 'w': 'pistol', 'o': [a.pos[0], 1.5, a.pos[2]], 'e': [[a.pos[0] + 5, 1.5, a.pos[2]]], 'h': []})
    await wait(lambda: got(a, 'oitc'), 3, 'the chamber emptied')
    assert got(a, 'oitc')[-1]['r'] == 0
    shot(a, b, 'pistol', 'b')
    await asyncio.sleep(0.4)
    assert not got(b, 'hurt'), 'an empty pistol cannot hurt anyone'
    # the knife still works, and a kill loads a round
    a.move([b.pos[0], 0, b.pos[2] + 1.2])
    await asyncio.sleep(0.3)
    shot(a, b, 'knife', 'b')
    await wait(lambda: a.saw('kill'), 3, 'a knife kill')
    await wait(lambda: got(a, 'oitc')[-1]['r'] == 1, 3, 'a round loaded by the kill')
    dead = [m for m in b.msgs if m.get('t') == 'dead'][-1]
    assert dead.get('lv') == 2, 'the victim has two lives left: %r' % dead
    # the one round kills wherever it lands
    await wait(lambda: any(row[0] == b.id and (row[6] & 1) for row in (a.snap_players or [])), 8, 'the victim back up')
    await asyncio.sleep(3.2)      # spawn protection
    shot(a, b, 'pistol', 'b')
    await wait(lambda: len(a.saw('kill')) >= 2, 3, 'a body hit with the round killing')
    # a third death and the victim is out, with no respawn
    await wait(lambda: any(row[0] == b.id and (row[6] & 1) for row in (a.snap_players or [])), 8, 'the victim back up again')
    await asyncio.sleep(3.2)
    shot(a, b, 'pistol', 'b')
    await wait(lambda: len(a.saw('kill')) >= 3, 3, 'the third kill')
    dead = [m for m in b.msgs if m.get('t') == 'dead'][-1]
    assert dead.get('lv') == 0 and dead.get('rs') == -1, 'out of lives, no respawn: %r' % dead
    # with nobody left to fight, the match ends on kills
    await wait(lambda: a.saw('matchend'), 6, 'the match ending')
    assert a.saw('matchend')[0]['w'] == a.id, 'most kills wins'
    print('oitc ok: rounds counted, knife fallback, three lives, most kills wins')
    await close(a, b)


async def main():
    await test_snipers()
    await test_knives()
    await test_firefight()
    await test_oitc()
    print('all passed')


if __name__ == '__main__':
    asyncio.get_event_loop().run_until_complete(main())
