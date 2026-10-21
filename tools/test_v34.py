#!/usr/bin/env python3
"""
3.4.0: scorestreaks. Against a running server, two players in Free for All:
five kills earn the scan (and its pings carry the enemy), ten the helicopter
(the gunner is carried round outside the town and shoots from the door),
fifteen the airstrike (the bombs land ten seconds on). The strike's damage
rules (dead in the middle, 50 at the edge, 50 under a roof, never your own
side) are checked in-process on a room of fake players.

    SOUK_STREAK=0.2 ACCOUNTS=0 python3 server/server.py 8782 &   # then:
    python3 tools/test_v34.py
"""

import asyncio
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(os.path.dirname(HERE), 'server'))
import test_server  # noqa: E402
from test_server import P, wait, phase  # noqa: E402

test_server.URL = os.environ.get('SOUK_URL', 'ws://localhost:8782/ws')
SCALE = float(os.environ.get('SOUK_STREAK') or 0.2)


def msgs(p, t):
    return [m for m in p.msgs if m['t'] == t]


async def kill_once(a, b):
    """A kills B once B is up, moved (so the fresh-life guard is off) and unprotected."""
    await wait(lambda: b.alive, 8, 'B alive')
    await asyncio.sleep(1.7)
    b.move([a.pos[0] + 3, 0, a.pos[2]])
    await asyncio.sleep(0.2)
    b.move([a.pos[0] + 3.5, 0, a.pos[2]])
    await asyncio.sleep(0.2)
    before = len(a.saw('kill'))
    for _ in range(5):
        a.shoot(b)
        await asyncio.sleep(0.1)
    await wait(lambda: len(a.saw('kill')) > before, 4, 'kill %d' % (before + 1))
    return a.saw('kill')[-1]


async def test_flow():
    a, b = P('Ace'), P('Bob')
    await a.start('ffa')
    await b.start('ffa')
    await phase(a, 'live', 20)
    await asyncio.sleep(0.5)
    a.move([a.pos[0], 0, a.pos[2] + 0.5])
    # two kills: the scan
    for i in range(2):
        ev = await kill_once(a, b)
        assert ev['ks'] == i + 1, 'the kill event carries the streak: %r' % ev
    await wait(lambda: any(m.get('k') == 'scan' for m in msgs(a, 'streak')), 3, 'the scan earned')
    have = [m for m in msgs(a, 'streak') if m.get('k') == 'scan'][0]['have']
    assert have == ['scan'], have
    assert not any(m.get('k') for m in msgs(b, 'streak')), 'the victim earns nothing'
    print('  ok   two kills earn the scan, and the kill events count the streak')
    await wait(lambda: b.alive, 8, 'B alive')
    a.ws.send({'t': 'streak', 'k': 'scan'})
    await wait(lambda: any(m.get('scan') and m.get('pts') for m in msgs(a, 'ping')), 3, 'a scan ping')
    ping = [m for m in msgs(a, 'ping') if m.get('scan') and m.get('pts')][0]
    assert any(pt[0] == b.id for pt in ping['pts']), 'the scan marks the enemy: %r' % ping
    assert not any(m.get('scan') for m in msgs(b, 'ping')), 'the enemy is not told where anyone is'
    await wait(lambda: any(m.get('used') == 'scan' for m in msgs(a, 'streak')), 2, 'the scan used up')
    assert a.saw('streak') and a.saw('streak')[-1]['k'] == 'scan', 'everyone hears it was called in'
    a.ws.send({'t': 'streak', 'k': 'scan'})
    await asyncio.sleep(0.3)
    assert len([m for m in msgs(a, 'streak') if m.get('used')]) == 1, 'a reward is used once'
    print('  ok   the scan pings the enemy to its owner only, and is spent')
    # five kills: the airstrike
    for i in range(3):
        await kill_once(a, b)
    await wait(lambda: any(m.get('k') == 'strike' for m in msgs(a, 'streak')), 3, 'the airstrike earned')
    await wait(lambda: b.alive, 8, 'B alive')
    await asyncio.sleep(1.7)
    b.move([b.pos[0] + 0.5, 0, b.pos[2]])
    await asyncio.sleep(0.3)
    a.ws.send({'t': 'streak', 'k': 'strike', 'p': [b.pos[0], 0, b.pos[2]]})
    await wait(lambda: msgs(b, 'strike'), 3, 'the strike announced to everyone')
    sm = msgs(b, 'strike')[0]
    assert abs(sm['in'] - 5 * SCALE) < 0.05 and sm['by'] == a.id, sm
    kills_before = len(a.saw('kill'))
    await asyncio.sleep(5 * SCALE - 0.5)
    assert len(a.saw('kill')) == kills_before, 'nothing lands before its time'
    await wait(lambda: len(a.saw('kill')) > kills_before, 3, 'the bombs landing')
    ev = a.saw('kill')[-1]
    assert ev['w'] == 'strike' and ev['v'] == b.id and ev['k'] == a.id, ev
    print('  ok   the airstrike lands five seconds after the call, on the spot picked')
    # eight kills: the helicopter
    for i in range(3):
        await kill_once(a, b)
    await wait(lambda: any(m.get('k') == 'heli' for m in msgs(a, 'streak')), 3, 'the helicopter earned')
    ground = list(a.pos)
    bx, bz = a.map['bounds']
    a.ws.send({'t': 'streak', 'k': 'heli'})
    await wait(lambda: any(not m.get('off') for m in msgs(b, 'heli')), 3, 'the helicopter seen by the other player')
    hm = [m for m in msgs(b, 'heli') if not m.get('off')][0]
    assert hm['id'] == a.id and hm['life'] == 45 * SCALE, hm

    def seat():
        row = [r for r in b.snap_players if r[0] == a.id]
        return row[0] if row else None
    await wait(lambda: seat() and seat()[2] > 20, 3, 'the gunner up in the air')
    s = seat()
    assert (abs(s[1]) > bx or abs(s[3]) > bz) and abs(s[2] - 29.0) < 0.6, 'outside the walls at a hundred feet: %r' % (s,)
    assert s[6] & 2097152, 'the helicopter flag is set: %r' % (s,)
    s2 = None
    await asyncio.sleep(1.0)
    s2 = seat()
    moved = math.hypot(s2[1] - s[1], s2[3] - s[3])
    assert 12 < moved < 32, 'it moves at about 22 m/s: %.1f m in a second' % moved
    # the gunner shoots from the door with the Gatling
    await wait(lambda: b.alive, 8, 'B alive')
    await asyncio.sleep(1.7)
    b.move([b.pos[0] + 0.5, 0, b.pos[2]])
    await asyncio.sleep(0.2)
    s = seat()
    a.pos = [s[1], s[2], s[3]]
    hp0 = 100
    hurt_before = len(msgs(b, 'hurt'))
    for _ in range(6):
        a.shoot(b, w='minigun')
        await asyncio.sleep(0.05)
    await wait(lambda: len(msgs(b, 'hurt')) > hurt_before, 3, 'the door gun hurts')
    print('  ok   the helicopter carries the gunner round outside the walls, and the door gun works')
    # the ride ends and the gunner is put back down
    await wait(lambda: any(m.get('off') for m in msgs(a, 'heli')), 45 * SCALE + 4, 'the helicopter leaving')
    off = [m for m in msgs(a, 'heli') if m.get('off')][0]
    assert off['why'] == 'time' and math.hypot(off['back'][0] - ground[0], off['back'][2] - ground[2]) < 0.1, off
    await asyncio.sleep(0.3)
    s = seat()
    assert math.hypot(s[1] - ground[0], s[3] - ground[2]) < 0.1 and s[2] < 5, 'back where they were: %r' % (s,)
    a.pos = list(off['back'])
    print('  ok   after its time the gunner is back where they were picked up')
    a.ws.w.close(); b.ws.w.close()


def test_rules():
    """The bombs' rules, on a room of fake players."""
    import server
    r = server.Room('ffa')
    r.map_kind = 'town'
    r.new_map('town')
    r.phase = 'live'
    mk = lambda n: server.Player(server.BotConn(), n)
    owner, open_mid, open_edge, under, far, mate = (mk(n) for n in ('O', 'mid', 'edge', 'under', 'far', 'mate'))
    for p in (owner, open_mid, open_edge, under, far, mate):
        r.players[p.id] = p
        p.room = r
        p.alive = True
        p.hp = 100
        p.team = -1
    # a roof: a box the town calls 'roof', standing on the ground floor under its middle
    roofs = [b for b in r.map['boxes'] if b[7] == 'roof' and b[1] + b[4] > 4]
    assert roofs, 'the town has roofs'
    rb = max(roofs, key=lambda b: b[3] * b[5])
    rx, rz = rb[0], rb[2]
    # the strike lands in the open: find a street spot with nothing over it
    spot = None
    for pt in r.map['ffaSpawns']:
        x, z = pt[0], pt[1]
        y = float(pt[2]) if len(pt) > 2 else 0.0
        if not r.solid.blocked([x, y + 1.0, z], [x, y + 41.0, z]):
            spot = (x, y, z)
            break
    assert spot, 'an open spawn'
    sx, sy, sz = spot
    open_mid.pos = [sx + 2.0, sy, sz]
    open_edge.pos = [sx + 6.5, sy, sz]
    far.pos = [sx + 9.0, sy, sz]
    owner.pos = [sx + 1.0, sy, sz]
    under.pos = [rx, 0.0, rz]
    assert r.solid.blocked([rx, 1.0, rz], [rx, 41.0, rz]), 'the roof is over them'
    S = {'id': 1, 'owner': owner.id, 'tm': -1, 'p': [sx, sy, sz], 'at': 0, 'h': 0}
    r.strike_land(S)
    assert not open_mid.alive, 'in the open, in the middle: dead'
    assert open_edge.alive and open_edge.hp == 50, 'in the open at the edge: 50 off (%d)' % open_edge.hp
    assert far.alive and far.hp == 100, 'outside the circle: untouched'
    assert owner.alive and owner.hp == 100, 'the owner is never hurt by their own strike'
    print('  ok   the bombs: dead in the middle, 50 at the edge, nothing outside, the caller spared')
    # under the roof, right at the middle of a strike on that roof: 50, not dead
    S2 = {'id': 2, 'owner': owner.id, 'tm': -1, 'p': [rx, rb[1] + rb[4], rz], 'at': 0, 'h': 0}
    r.strike_land(S2)
    assert under.alive and under.hp == 50, 'under a roof in the middle: 50 off (%d, alive %s)' % (under.hp, under.alive)
    print('  ok   under a roof the bombs do 50 wherever they land')
    # a team mode never hurts your own side
    r2 = server.Room('tdm')
    r2.map_kind = 'town'
    r2.new_map('town')
    r2.phase = 'live'
    o2, m2, e2 = mk('o2'), mk('m2'), mk('e2')
    for p, tm in ((o2, 0), (m2, 0), (e2, 1)):
        r2.players[p.id] = p
        p.room = r2
        p.alive = True
        p.team = tm
        p.pos = [sx + 1.0, sy, sz]
    r2.strike_land({'id': 3, 'owner': o2.id, 'tm': 0, 'p': [sx, sy, sz], 'at': 0, 'h': 0})
    assert m2.alive and m2.hp == 100 and not e2.alive, 'teammates spared, the enemy not'
    print('  ok   in a team mode your own side is never hurt')


async def test_launcher():
    """A launched grenade: the server passes it on as launched, and lets it go off far away."""
    a, b = P('Lob', ), P('Bystander')
    await a.start('ffa', ld=0)
    await b.start('ffa')
    await phase(a, 'live', 20)
    await asyncio.sleep(1.8)
    a.move([a.pos[0], 0, a.pos[2] + 0.5])
    # B stands seventy-odd metres off, out in the open: a thrown grenade could never reach, a launched one may
    spawns = sorted(a.map['ffaSpawns'], key=lambda s: -math.hypot(s[0] - a.pos[0], s[1] - a.pos[2]))
    sp = next(s for s in spawns if 65 < math.hypot(s[0] - a.pos[0], s[1] - a.pos[2]) < 140)
    far = [sp[0], float(sp[2]) if len(sp) > 2 else 0.0, sp[1]]
    b.move([b.pos[0] + 0.5, 0, b.pos[2]])
    await asyncio.sleep(0.2)
    b.move(far)
    seen = lambda: next((r for r in a.snap_players if r[0] == b.id and abs(r[1] - far[0]) < 0.1 and abs(r[3] - far[2]) < 0.1), None)
    await wait(seen, 4, 'the server seeing B over there')
    await asyncio.sleep(0.3)
    a.ws.send({'t': 'nade', 'n': 1, 'k': 'frag', 'l': 1, 'o': [a.pos[0], 1.5, a.pos[2]], 'v': [34, 1.5, 0]})
    await wait(lambda: msgs(b, 'nade'), 3, 'the launched grenade seen by the other player')
    nm = msgs(b, 'nade')[0]
    assert nm.get('l') == 1 and nm['k'] == 'frag', nm
    await asyncio.sleep(0.3)
    a.ws.send({'t': 'boom', 'n': 1, 'p': [far[0], far[1] + 0.2, far[2]]})
    await wait(lambda: msgs(b, 'hurt') or any(e.get('v') == b.id for e in a.saw('kill')), 6, 'the blast reaching B')
    print('  ok   a launched grenade is announced as launched and may go off a hundred metres out')
    a.ws.w.close(); b.ws.w.close()


async def test_owner():
    """The owner's account: every scorestreak, with no kills at all."""
    url = os.environ.get('SOUK_OWNER_URL', 'ws://localhost:8785/ws')
    import random as rnd
    saved = test_server.URL
    test_server.URL = url
    try:
        a, b = P('mcb'), P('Other')
        await a.start('ffa')
        a.ws.send({'t': 'signup', 'username': 'mcb', 'email': 'mcb%d@example.com' % rnd.randrange(10 ** 6), 'password': 'secret123', 'guest': {}})
        await wait(lambda: any(m['t'] == 'auth' for m in a.msgs), 5, 'signed up as mcb')
        auth = [m for m in a.msgs if m['t'] == 'auth'][-1]
        assert auth.get('user') and auth['user']['username'].lower() == 'mcb', auth
        await b.start('ffa')
        await phase(a, 'live', 20)
        await asyncio.sleep(0.5)
        a.ws.send({'t': 'streak', 'k': 'heli'})
        await wait(lambda: any(not m.get('off') for m in msgs(b, 'heli')), 3, 'the owner\'s helicopter, without a kill')
        a.ws.send({'t': 'streak', 'k': 'scan'})
        await wait(lambda: any(m.get('scan') and m.get('pts') for m in msgs(a, 'ping')), 4, 'the owner\'s scan')
        b.ws.send({'t': 'streak', 'k': 'scan'})
        await asyncio.sleep(0.5)
        assert not any(m.get('scan') for m in msgs(b, 'ping')), 'nobody else gets them for free'
        print('  ok   the owner may call every scorestreak in without earning it; nobody else can')
        a.ws.w.close(); b.ws.w.close()
    finally:
        test_server.URL = saved


async def main():
    print('strike rules')
    test_rules()
    print('the flow, against the server at', test_server.URL)
    await test_flow()
    await test_launcher()
    print('the owner, against the accounts server')
    await test_owner()
    print('all ok')


if __name__ == '__main__':
    asyncio.run(main())
