#!/usr/bin/env python3
"""
Attack and Defend against a running server: the Long Souk's fixed layout and
spawns, Rush (arm, disarm, the fuse, both bombs taking the sector, the
attackers' lives running out) and Breakthrough (taking a point by numbers,
losing it back, taking both to advance).

    SOUK_AD=0.1 SOUK_AD_TICKETS=2 ACCOUNTS=0 python3 server/server.py 8787 &   # then:
    python3 tools/test_ad.py
"""

import asyncio
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import test_server  # noqa: E402
from test_server import P, wait, phase  # noqa: E402

test_server.URL = os.environ.get('SOUK_URL', 'ws://localhost:8787/ws')
SCALE = float(os.environ.get('SOUK_AD') or 0.1)
ARM, FUSE, CAP = 4.0 * SCALE, 40.0 * SCALE, 25.0 * SCALE


def ad(p):
    return p.g.get('ad') or {}


async def setup(mode):
    a, b = P('Att'), P('Def')
    await a.start(mode)
    await b.start(mode)
    await wait(lambda: a.map and b.map, 10, 'the map')
    assert a.map['kind'] == 'front' and a.map.get('fixed') and a.map['bounds'][0] == 152.0, a.map['bounds']
    await phase(a, 'live', 25)
    await wait(lambda: ad(a).get('pts'), 5, 'the sector state')
    att, dfn = (a, b) if a.g['att'] == a.team else (b, a)
    await asyncio.sleep(0.4)
    return a, att, dfn


async def test_rush():
    a, att, dfn = await setup('rush')
    A = a.map['ad']
    assert ad(a)['sec'] == 0 and ad(a)['n'] == 4 and ad(a)['tk'] == int(os.environ.get('SOUK_AD_TICKETS') or 2)
    extra = A['rush_extra']['pts']
    assert len(extra) == 1 and extra[0]['x'] > 110 and extra[0]['z'] < -20, 'the fourth sector: one bomb in the back corner, on the left: %r' % (extra,)
    assert all('face' in p for s in A['sectors'] for p in s['pts'])
    assert att.pos[0] < -110 and -45 < dfn.pos[0] < 45, 'attackers start at the west end, defenders at the second sector: %r %r' % (att.pos, dfn.pos)
    print('  ok   the Long Souk: fixed, twice as long, attackers west and defenders a sector ahead')
    pts = A['sectors'][0]['pts']
    att.move([pts[0]['x'], pts[0]['y'], pts[0]['z']])
    await asyncio.sleep(0.3)
    att.ws.send({'t': 'plant', 'on': True})
    await wait(lambda: ad(a)['pts'][0].get('pl') == att.id, 2, 'arming under way')
    await wait(lambda: att.saw('adarmed'), ARM + 2, 'bomb A armed')
    att.ws.send({'t': 'plant', 'on': False})
    assert ad(a)['pts'][0]['s'] == 'armed' and ad(a)['pts'][0].get('ex', 0) > 0
    print('  ok   an attacker holding E for four seconds arms the bomb')
    dfn.move([pts[0]['x'], pts[0]['y'], pts[0]['z']])
    await asyncio.sleep(0.3)
    dfn.ws.send({'t': 'plant', 'on': True})
    await wait(lambda: dfn.saw('addisarmed'), ARM + 2, 'bomb A disarmed')
    dfn.ws.send({'t': 'plant', 'on': False})
    assert ad(a)['pts'][0]['s'] == 'idle'
    print('  ok   a defender holding E for four seconds disarms it')
    dfn.move([pts[0]['x'] + 30, 0, pts[0]['z']])
    for j in (0, 1):
        att.move([pts[j]['x'], pts[j]['y'], pts[j]['z']])
        await asyncio.sleep(0.3)
        att.ws.send({'t': 'plant', 'on': True})
        await wait(lambda: len(att.saw('adarmed')) == j + 2, ARM + 2, 'bomb %d armed' % j)
        att.ws.send({'t': 'plant', 'on': False})
    await wait(lambda: len(att.saw('adboom')) == 2, FUSE + 3, 'both bombs going off')
    await wait(lambda: att.saw('adsector') and ad(a)['sec'] == 1, 3, 'the second sector')
    assert ad(a)['pts'][0]['s'] == 'idle' and ad(a)['tk'] == int(os.environ.get('SOUK_AD_TICKETS') or 2)
    print('  ok   both bombs blown: on to sector two, with a fresh set of lives')
    # the attackers' lives: each death takes one; at none left, no respawn, and the defenders hold
    await wait(lambda: att.alive and dfn.alive, 10, 'both up')
    att.ws.send({'t': 'leave'})
    await asyncio.sleep(0.3)
    a.ws.w.close(); att.ws.w.close() if att is not a else None; dfn.ws.w.close()


async def test_lives():
    a, att, dfn = await setup('rush')
    tk0 = ad(a)['tk']
    for n in range(tk0):
        await wait(lambda: att.alive, 10, 'attacker up')
        await asyncio.sleep(1.7)
        att.move([att.pos[0] + 0.5, 0, att.pos[2]])
        await asyncio.sleep(0.2)
        dfn.move([att.pos[0] + 3, 0, att.pos[2]])
        await asyncio.sleep(0.2)
        for _ in range(6):
            dfn.shoot(att)
            await asyncio.sleep(0.1)
        await wait(lambda: len(dfn.saw('kill')) == n + 1, 4, 'kill %d' % (n + 1))
        await wait(lambda: ad(a)['tk'] == tk0 - n - 1 or a.g.get('ph') == 'ended', 2, 'a life gone')
    dead = [m for m in att.msgs if m['t'] == 'dead'][-1]
    assert dead['rs'] == -1, 'out of lives: no respawn: %r' % dead
    await wait(lambda: a.g.get('ph') == 'ended' and a.g.get('w') == dfn.team, 5, 'the defenders holding')
    print('  ok   every attacker death costs a life; at none left they stay down and the defenders win')
    a.ws.w.close(); dfn.ws.w.close()


async def test_breakthrough():
    a, att, dfn = await setup('breakthrough')
    A = a.map['ad']
    pts = A['sectors'][0]['pts']
    assert ad(a)['n'] == 3, 'Breakthrough plays three sectors'
    assert all(p['o'] == dfn.team for p in ad(a)['pts']), 'the defenders own both points to begin with'
    att.move([pts[0]['x'], pts[0]['y'], pts[0]['z']])
    await wait(lambda: ad(a)['pts'][0]['a'] == 1 and ad(a)['pts'][0]['c'] > 0, 3, 'the capture starting')
    await wait(lambda: att.saw('adcap'), CAP + 3, 'point A taken')
    assert ad(a)['pts'][0]['o'] == att.team
    print('  ok   an attacker alone on a point takes it after the capture time')
    # the defender arrives: more defenders than attackers, and it comes back
    dfn.move([pts[0]['x'], pts[0]['y'], pts[0]['z']])
    att.move([pts[0]['x'] + 40, 0, pts[0]['z']])
    await wait(lambda: len(att.saw('adcap')) == 2 and ad(a)['pts'][0]['o'] == dfn.team, CAP + 3, 'point A taken back')
    print('  ok   the defenders can take it back the same way')
    # equal numbers: nothing moves
    att.move([pts[0]['x'], pts[0]['y'], pts[0]['z']])
    await asyncio.sleep(0.6)
    c0 = ad(a)['pts'][0]['c']
    await asyncio.sleep(0.8)
    assert abs(ad(a)['pts'][0]['c'] - c0) < 0.02, 'equal numbers hold the point where it is'
    print('  ok   with equal numbers on it the point stays put')
    dfn.move([pts[0]['x'] + 60, 0, pts[0]['z']])
    await wait(lambda: ad(a)['pts'][0]['o'] == att.team, CAP + 3, 'point A again')
    att.move([pts[1]['x'], pts[1]['y'], pts[1]['z']])
    await wait(lambda: ad(a).get('sec') == 1, CAP + 4, 'both held: the next sector')
    print('  ok   holding both points at once takes the sector')
    a.ws.w.close(); dfn.ws.w.close()


async def main():
    print('rush')
    await test_rush()
    await test_lives()
    print('breakthrough')
    await test_breakthrough()
    print('all ok')


if __name__ == '__main__':
    asyncio.run(main())
