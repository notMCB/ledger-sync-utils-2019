#!/usr/bin/env python3
"""
3.2.1 against a running server: one Souk Royale at a time, three spare vests,
the gold chests, the results table, the server bringing a stalled fall down,
and a fresh life that can't be hurt until it moves.

    SOUK_GAS=0.2 DATA_DIR=/tmp/souk-321 ACCOUNTS=0 python3 server/server.py 8770 &   # then:
    DATA_DIR=/tmp/souk-321 python3 tools/test_v321.py
"""

import asyncio
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import test_server  # noqa: E402
from test_server import P, phase, wait  # noqa: E402
from test_v29 import got  # noqa: E402
from test_v3 import inv, row, close, loot_until  # noqa: E402

test_server.URL = 'ws://localhost:8770/ws'
FALLING = 65536


async def test_afk_guard():
    a, b = P('Fresh'), P('Camper')
    await a.start('ffa')
    await b.start('ffa')
    await phase(a, 'live', 40)
    await wait(lambda: a.alive and b.alive, 8, 'both alive')
    sp = [x for x in a.msgs if x.get('t') == 'spawn'][-1]
    assert sp.get('guard') == 1, 'a fresh life is told it is guarded: %r' % sp
    await asyncio.sleep(2.2)      # well past the old 1.5 s of spawn protection
    # the camper steps once (so its own guard ends) and shoots the one who has not moved
    b.move([a.pos[0] + 1.0, a.pos[1], a.pos[2]])
    await asyncio.sleep(0.3)
    b.shoot(a, times=6)
    await asyncio.sleep(0.8)
    assert a.alive and not got(a, 'hurt'), 'nothing hurts a player who has not moved: hurt %r' % got(a, 'hurt')
    assert any(h.get('sh') for h in got(b, 'hitok')), 'the shooter sees the shots bounce: %r' % got(b, 'hitok')[-3:]
    r = row(b, a.id)
    assert r and (r[6] & 128), 'and the shield shows in the snapshot: %r' % r
    # one step and the shield is gone; the next shots land
    a.move([a.pos[0] + 1.0, a.pos[1], a.pos[2]])
    await asyncio.sleep(0.4)
    r = row(b, a.id)
    assert r and not (r[6] & 128), 'a step ends the guard: %r' % r
    b.shoot(a, times=2)
    await asyncio.sleep(0.5)
    assert got(a, 'hurt'), 'after moving, shots hurt'
    print('afk guard ok: unhurt and shielded until the first input, hurt after one step')
    await close(a, b)


async def test_royale():
    a, b = P('Drop1'), P('Drop2')
    await a.start('royale')
    await b.start('royale')
    await wait(lambda: a.map is not None and a.map.get('royale'), 10, 'the royale map')
    await wait(lambda: any(x.get('t') == 'joined' for x in b.msgs), 10, 'the second player in')
    # a match may be ending from an earlier run: wait for the fresh lobby, and take its map
    await wait(lambda: a.alive and b.alive and a.g.get('ph') in ('waiting', 'countdown'), 60, 'a fresh lobby')
    m = a.map
    gold = [(i + 1, c) for i, c in enumerate(m['chests']) if len(c) > 4 and c[4]]
    assert len(gold) == 3, 'three gold chests: %r' % gold
    assert all(c[1] > 90 for _, c in gold), 'up the tower: %r' % gold
    assert m.get('tower', 0) > 100, 'the Spire: %r' % m.get('tower')
    assert any(b2[7] == 'asphalt' for b2 in m['boxes']), 'solid roads'
    assert sum(1 for d in m['deco'] if d['k'] in ('forklift', 'golfcart')) >= 6, 'carts and forklifts'
    print('map ok: %d chests, 3 gold at %r, tower %sm, %d road slabs' % (
        len(m['chests']), [round(c[1], 1) for _, c in gold], m['tower'], sum(1 for b2 in m['boxes'] if b2[7] == 'asphalt')))
    ja = [x for x in a.msgs if x.get('t') == 'joined'][-1]['room']['id']
    jb = [x for x in b.msgs if x.get('t') == 'joined'][-1]['room']['id']
    assert ja == jb, 'the same royale room: %r %r' % (ja, jb)
    await phase(a, 'live', 40)
    # a third player now: the same room, watching, not a second match
    c = P('Late')
    await c.start('royale')
    await wait(lambda: any(x.get('t') == 'joined' for x in c.msgs), 5, 'the late one to join')
    jc = [x for x in c.msgs if x.get('t') == 'joined'][-1]['room']['id']
    assert jc == ja, 'one Souk Royale at a time: %r vs %r' % (jc, ja)
    await wait(lambda: got(c, 'dead') and got(c, 'dead')[0].get('late'), 5, 'the late one told to wait')
    print('one room ok: the third player joined the live match as a watcher')
    # the drop: a jumps and lands at the top of the Spire, opens a gold chest
    bx, bz = m['bounds']
    await wait(lambda: row(a, a.id) and abs(row(a, a.id)[1]) <= bx - 2 and abs(row(a, a.id)[3]) <= bz - 2, 30, 'the plane over the map')
    a.ws.send({'t': 'jump'})
    await wait(lambda: got(a, 'jumped'), 3, 'a jump acknowledged')
    a.sc = [x for x in a.msgs if x.get('t') == 'spawn'][-1]['sc']
    await wait(lambda: got(b, 'jumped'), 40, 'the last one put out at the edge')
    b.sc = [x for x in b.msgs if x.get('t') == 'spawn'][-1]['sc']
    b.move([3, 0.16, 0])
    opened = await loot_until(a, gold[:1], lambda i: i and (i['pw'] or i['sw']))
    ia = inv(a)
    gun = ia['pw'] or ia['sw']
    assert gun['r'] == 'legendary', 'a gold chest gives a legendary: %r' % gun
    items = [it for msg in got(a, 'items') for it in msg.get('add', [])]
    near = [it for it in items if math.hypot(it['p'][0] - gold[0][1][0], it['p'][2] - gold[0][1][2]) < 2.5 and abs(it['p'][1] - gold[0][1][1]) < 1]
    assert len(near) == 1 and near[0]['k'] == 'gun', 'and nothing else: %r' % near
    print('gold chest ok: one %s %s and nothing else' % (gun['r'], gun['w']))
    # three spare vests: the fourth is left on the ground
    a.move([0, 0.16, 0])
    chests = [(i + 1, cc) for i, cc in enumerate(m['chests']) if len(cc) == 4 and abs(cc[0]) < 60 and abs(cc[2]) < 60 and cc[1] < 1]
    try:
        await loot_until(a, chests[:40], lambda i: i and i['v'] >= 3)
        assert inv(a)['v'] == 3, 'three spare vests: %r' % inv(a)['v']
        print('vests ok: carrying 3 spare')
    except AssertionError as e:
        if 'no chest gave' in str(e):
            print('vests: chests did not turn up three vests in 40 tries; cap not exercised')
        else:
            raise
    # the fall watch: b claims to be falling but never comes down, and is brought down
    b.ws.send({'t': 'st', 'p': [20, 60, 20], 'y': 0, 'pi': 0, 'f': FALLING, 'sl': 0, 'sc': b.sc})
    for _ in range(12):
        await asyncio.sleep(0.25)
        b.ws.send({'t': 'st', 'p': [20, 60, 20], 'y': 0, 'pi': 0, 'f': FALLING, 'sl': 0, 'sc': b.sc})
    await wait(lambda: any(x.get('land') for x in got(b, 'fallto')), 10, 'the server to land the stalled fall')
    land = [x for x in got(b, 'fallto') if x.get('land')][0]
    assert land['p'][1] < 2.0 and abs(land['p'][0] - 20) < 0.1, 'brought down onto the ground: %r' % land
    ys = [x['p'][1] for x in got(b, 'fallto')]
    assert ys == sorted(ys, reverse=True) and len(ys) > 5, 'a fall, not a teleport: %r' % ys[:6]
    print('fall watch ok: %d steps from 60 m down to %.2f' % (len(ys), land['p'][1]))
    # the end: the results table reaches everyone, the late watcher included
    b.move([20, 0.16, 20])
    await asyncio.sleep(0.3)
    a.move([20, 0.16, 20])
    # the knife, at arm's length, until it lands: the gold gun could be anything, even the flamethrower
    for _ in range(80):
        if a.saw('kill'):
            break
        a.pos = [20, 0.16, 20]
        a.shoot(b, times=1, w='knife')
        await asyncio.sleep(0.15)
    await wait(lambda: a.saw('kill'), 5, 'the knife to land')
    await wait(lambda: got(a, 'brend') and got(c, 'brend'), 25, 'the results for everyone')
    res = got(a, 'brend')[0]
    assert res['w'] == 'Drop1' and [r['n'] for r in res['rows'][:2]] == ['Drop1', 'Drop2'], res
    assert all(k in res['rows'][0] for k in ('k', 'd', 'sv', 'ch', 'pl')), res['rows'][0]
    assert not any(r['n'] == 'Late' for r in res['rows']), 'the watcher is not in the table'
    print('results ok: %r' % [(r['n'], r['pl'], r['k']) for r in res['rows']])
    await close(a, b, c)


async def main():
    await test_afk_guard()
    await test_royale()
    print('all passed')


if __name__ == '__main__':
    asyncio.get_event_loop().run_until_complete(main())
