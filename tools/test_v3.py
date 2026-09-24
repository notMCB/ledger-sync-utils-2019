#!/usr/bin/env python3
"""
Souk Royale against a running server: the plane, the drop, chests and loot,
vests, the gas, a kill with its stats, and the win.

    SOUK_GAS=0.2 DATA_DIR=/tmp/souk-test python3 server/server.py 8765 &   # then:
    python3 tools/test_v3.py
"""

import asyncio
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from test_server import P, phase, wait  # noqa: E402
from test_v29 import got  # noqa: E402

ABOARD = 262144


def inv(p):
    ms = got(p, 'inv')
    return ms[-1] if ms else None


def row(watcher, pid):
    for r in watcher.snap_players or []:
        if r[0] == pid:
            return r
    return None


async def close(*ps):
    for p in ps:
        p.ws.w.close()
    await asyncio.sleep(0.4)


async def loot_until(p, chests, need):
    """Open chests, standing at each, until `need(inv)` is true. Returns the chest ids opened."""
    opened = []
    for cid, c in chests:
        p.move([c[0], c[1], c[2]])
        await asyncio.sleep(0.15)
        p.ws.send({'t': 'open', 'id': cid})
        await wait(lambda: got(p, 'chest', id=cid), 3, 'chest %d to open' % cid)
        opened.append(cid)
        # take everything that fell out
        for m in got(p, 'items'):
            for it in m.get('add', []):
                if math.hypot(it['p'][0] - c[0], it['p'][2] - c[2]) < 2.5 and abs(it['p'][1] - c[1]) < 1:
                    p.ws.send({'t': 'pick', 'id': it['id']})
        await asyncio.sleep(0.4)
        if need(inv(p)):
            return opened
    raise AssertionError('no chest gave what was needed after %d chests' % len(opened))


async def main():
    a, b = P('Drop1'), P('Drop2')
    await a.start('royale')
    await b.start('royale')
    await wait(lambda: a.map is not None and a.map.get('royale'), 10, 'the royale map')
    m = a.map
    assert m['kind'] == 'royale' and len(m['chests']) >= 150, 'the royale map with its chests: %s %d' % (m['kind'], len(m.get('chests', [])))
    assert m['bounds'][0] > 150 and m['bounds'][1] > 120, 'a big map: %r' % m['bounds']
    print('map ok: %d boxes, %d chests, bounds %r' % (len(m['boxes']), len(m['chests']), m['bounds']))
    # the lobby: on the ground with a knife, and the room takes up to 64
    await wait(lambda: a.alive, 5, 'a lobby spawn')
    ro = [x for x in a.msgs if x.get('t') == 'rooms']
    assert any(r['max'] == 64 for r in ro[-1]['list'] if r['mode'] == 'royale'), 'a 64-player room'
    i0 = inv(a)
    assert i0 and i0['pw'] is None and i0['sw'] is None and i0['v'] == 0, 'nothing but the knife to start: %r' % i0
    # the plane
    await phase(a, 'live', 40)
    await wait(lambda: got(a, 'plane') and got(b, 'plane'), 5, 'the plane announced')
    pl = got(a, 'plane')[-1]
    assert pl['y'] == 160 and pl['a'] != pl['b'], pl
    sp = [x for x in a.msgs if x.get('t') == 'spawn'][-1]
    assert sp.get('aboard') == 1, 'spawned aboard: %r' % sp
    await wait(lambda: row(a, a.id) and (row(a, a.id)[6] & ABOARD), 3, 'the aboard flag')
    p1 = row(a, a.id)[1:4]
    await asyncio.sleep(1.0)
    p2 = row(a, a.id)[1:4]
    assert math.hypot(p2[0] - p1[0], p2[2] - p1[2]) > 10 and abs(p2[1] - 160) < 1, 'carried along by the plane: %r -> %r' % (p1, p2)
    # jumping early does nothing; over the map it does
    a.ws.send({'t': 'jump'})
    bx, bz = m['bounds']
    await wait(lambda: abs(row(a, a.id)[1]) <= bx - 2 and abs(row(a, a.id)[3]) <= bz - 2, 30, 'the plane over the map')
    a.ws.send({'t': 'jump'})
    await wait(lambda: got(a, 'jumped'), 3, 'a jump acknowledged')
    jp = got(a, 'jumped')[0]['p']
    assert abs(jp[1] - 160) < 1, jp
    await asyncio.sleep(0.3)
    assert not (row(a, a.id)[6] & ABOARD), 'off the plane'
    # down at the crossroads, well inside the first circle (the gas runs fast in this test)
    a.sc = [x for x in a.msgs if x.get('t') == 'spawn'][-1]['sc']
    a.move([0, 0, 0])
    # the other one rides to the far edge and is put out
    try:
        await wait(lambda: got(b, 'jumped'), 40, 'the last one put out at the edge')
    except AssertionError:
        print('DEBUG b row', row(a, b.id), 'phase', a.g, 'b msgs', [x['t'] for x in b.msgs][-8:])
        raise
    print('plane ok: carried, jumped, the rest put out at the edge')
    b.sc = [x for x in b.msgs if x.get('t') == 'spawn'][-1]['sc']
    b.move([3, 0, 0])
    # loot: a gun, ammo and a vest from the chests
    chests = [(i + 1, c) for i, c in enumerate(m['chests'])]
    a.sc = [x for x in a.msgs if x.get('t') == 'spawn'][-1]['sc']
    opened = await loot_until(a, chests, lambda i: i and (i['pw'] or i['sw']) and i['v'] >= 1 and sum(i['am'].values()) > 0)
    ia = inv(a)
    gun = ia['pw'] or ia['sw']
    print('loot ok: %d chests opened; carrying %s (%s) with %r, %d vest(s)' % (len(opened), gun['w'], gun['r'], ia['am'], ia['v']))
    assert gun['r'] in ('default', 'common', 'uncommon', 'rare', 'epic', 'legendary')
    ch = [x for x in a.msgs if x.get('t') == 'chest' and x.get('id') == opened[0]][0]
    assert ch['by'] == a.id
    # a second open does nothing
    a.ws.send({'t': 'open', 'id': opened[0]})
    await asyncio.sleep(0.3)
    assert len([x for x in a.msgs if x.get('t') == 'chest' and x.get('id') == opened[0]]) == 1, 'a chest opens once'
    # the vest goes on: 100 shield, taken first when shot
    a.ws.send({'t': 'vest'})
    await wait(lambda: inv(a)['sh'] == 100, 3, 'a vest worn')
    assert inv(a)['v'] == ia['v'] - 1
    # b stands next to a with a gun of their own
    b.sc = [x for x in b.msgs if x.get('t') == 'spawn'][-1]['sc']
    await loot_until(b, chests[::-1], lambda i: i and (i['pw'] or i['sw']))
    ib = inv(b)
    bgun = ib['pw'] or ib['sw']
    b.move([a.pos[0] + 3, a.pos[1], a.pos[2]])
    await asyncio.sleep(0.3)
    # a gun you don't hold does nothing; the one you do hits the vest first
    other = 'smg' if bgun['w'] != 'smg' else 'lmg'
    big = lambda: [x for x in got(a, 'hurt') if x['d'] > 3]      # gas ticks are a point at a time
    n0 = len(big())
    b.ws.send({'t': 'shot', 'w': other, 'o': [b.pos[0], b.pos[1] + 1.5, b.pos[2]], 'e': [a.pos], 'h': [[a.id, 'b']]})
    await asyncio.sleep(0.4)
    assert len(big()) == n0, 'only the gun you carry fires'
    hp0 = row(a, a.id)[9]
    b.ws.send({'t': 'shot', 'w': bgun['w'], 'o': [b.pos[0], b.pos[1] + 1.5, b.pos[2]], 'e': [a.pos], 'h': [[a.id, 'b']]})
    await wait(lambda: len(big()) > n0, 3, 'a hit with the found gun')
    h = big()[-1]
    assert h['hp'] >= hp0 - 3 and h['sh'] == 100 - h['d'], 'the vest took it: %r (health was %d)' % (h, hp0)
    ok = got(b, 'hitok')[-1]
    assert ok.get('ar') == 1, 'a blue marker for armour: %r' % ok
    print('vest ok: %s hit the vest for %d, health untouched, armour marker' % (bgun['w'], h['d']))
    # a late joiner watches
    c = P('Late')
    await c.start('royale')
    await wait(lambda: got(c, 'dead') and got(c, 'dead')[0].get('late'), 5, 'the late joiner told to wait')
    await wait(lambda: a.g.get('al') == 2, 3, 'two alive, the late one not counted')
    # the gas: the first circle, then it closes and hurts anyone outside
    gs = a.g.get('gs')
    assert gs and 0 < gs['r'] <= 250 and gs['ph'] in ('wait', 'close') and gs['nr'] < gs['r'] + 1, gs
    b.move([bx - 4, 0, bz - 4])
    await wait(lambda: got(a, 'ev', e='gas'), 30, 'the gas closing announced')
    await wait(lambda: [x for x in got(b, 'hurt') if x.get('from') is None and x['d'] <= 10], 40, 'gas damage')
    print('gas ok: closed and hurt a player outside it')
    # the kill: b dies, drops their kit, is placed; a wins with stats and the prize
    b.move([a.pos[0] + 3, a.pos[1], a.pos[2]])
    await asyncio.sleep(0.3)
    n_items = sum(len(x.get('add', [])) for x in got(a, 'items'))
    for _ in range(40):
        a.ws.send({'t': 'shot', 'w': gun['w'], 'o': [a.pos[0], a.pos[1] + 1.5, a.pos[2]], 'e': [b.pos], 'h': [[b.id, 'h']]})
        await asyncio.sleep(0.15)
        if got(b, 'dead'):
            break
    await wait(lambda: got(b, 'dead'), 3, 'the victim dead')
    d = got(b, 'dead')[-1]
    assert d['rs'] == -1, 'no respawn in the royale: %r' % d
    await wait(lambda: got(b, 'brstats'), 3, 'the fallen player’s stats')
    st = got(b, 'brstats')[-1]
    assert st['place'] == 2 and st['of'] == 2 and st['won'] is False and st['ch'] >= 1, st
    await wait(lambda: sum(len(x.get('add', [])) for x in got(a, 'items')) > n_items, 3, 'the kit dropped')
    await wait(lambda: a.saw('matchend'), 5, 'the match over')
    assert a.saw('matchend')[0]['w'] == a.id
    await wait(lambda: got(a, 'brstats'), 3, 'the winner’s stats')
    ws = got(a, 'brstats')[-1]
    assert ws['won'] is True and ws['place'] == 1 and ws['k'] == 1, ws
    await wait(lambda: got(a, 'brwin'), 3, 'the prize')
    assert got(a, 'brwin')[0]['outfit'] == 'royale1'
    ro = [x for x in a.msgs if x.get('t') == 'roster'][-1]
    places = {p['id']: p['pl'] for p in ro['pl']}
    assert places[a.id] == 1 and places[b.id] == 2, places
    print('win ok: the victim placed 2nd with stats and dropped their kit; the winner got stats and the outfit')
    # then everyone is back in the lobby, alive, for the next one
    await wait(lambda: a.g.get('ph') in ('waiting', 'countdown'), 30, 'the next match forming')
    await wait(lambda: a.alive and b.alive and c.alive, 6, 'everyone back in the lobby')
    assert inv(a)['pw'] is None and inv(a)['sh'] == 0, 'a clean kit for the next drop: %r' % inv(a)
    print('all passed')
    await close(a, b, c)


if __name__ == '__main__':
    asyncio.get_event_loop().run_until_complete(main())
