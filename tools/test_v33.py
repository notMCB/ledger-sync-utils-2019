#!/usr/bin/env python3
"""
3.3.0 against a running server: the Derby (its track, the carts, crashes,
grenades that kill outright, the one-second wait), golf cart skins from the
new crate, and an outfit only the owner's account is given.

    ACCOUNTS=1 DATA_DIR=/tmp/souk-33 python3 server/server.py 8781 &   # then:
    python3 tools/test_v33.py
"""

import asyncio
import math
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(os.path.dirname(HERE), 'server'))
import test_server  # noqa: E402
from test_server import P, wait  # noqa: E402
from bot import WS  # noqa: E402
from test_v3 import close  # noqa: E402

test_server.URL = os.environ.get('SOUK_URL', 'ws://localhost:8781/ws')


def check_track():
    """The circuit: no bend tighter than a cart turns, its parts apart, inside the walls."""
    import mapgen
    import map_derby
    T = map_derby.centre_line()
    N = len(T)
    s = [0.0]
    for i in range(1, N + 1):
        a, b = T[i - 1], T[i % N]
        s.append(s[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    total = s[-1]
    minr = 1e9
    for i in range(N):
        a, b, c = T[i - 1], T[i], T[(i + 1) % N]
        ab, bc, ca = (math.hypot(q[0] - p[0], q[1] - p[1]) for p, q in ((a, b), (b, c), (c, a)))
        cross = abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
        if cross > 1e-9:
            minr = min(minr, ab * bc * ca / (2 * cross))
    assert minr > map_derby.TRACK_W / 2 + map_derby.BARRIER_T * 2 + 1, 'a bend folds its inside barrier over: %.1f m' % minr
    minc = 1e9
    for i in range(0, N, 2):
        for j in range(i + 1, N, 2):
            if min(abs(s[i] - s[j]), total - abs(s[i] - s[j])) < 40:
                continue
            minc = min(minc, math.hypot(T[i][0] - T[j][0], T[i][1] - T[j][1]))
    assert minc > map_derby.TRACK_W + 4, 'two parts of the track run into each other: %.1f m apart' % minc
    town = mapgen.generate(random.randrange(1, 10 ** 6), 'derby')
    j = town.to_json()
    edge = map_derby.TRACK_W / 2 + map_derby.BARRIER_T * 2
    for (x, z) in T:
        assert abs(x) + edge < town.bx and abs(z) + edge < town.bz, 'the track leaves the yard at %r' % ((x, z),)
    carts = [d for d in j['deco'] if d['k'] == 'golfcart']
    assert len(carts) == map_derby.CARTS, 'a cart for everyone: %d' % len(carts)
    for d in carts:
        assert town.track_dist(d['x'], d['z']) > map_derby.TRACK_W / 2 + 1.5, 'cart %d waits in the pits, off the track' % d['id']
    for (x, z, _) in town.grid:
        assert town.track_dist(x, z) < map_derby.TRACK_W / 2 - 1.0, 'a grid slot on the tarmac'
    for d in carts:
        for b in j['boxes']:
            if b[1] - b[4] < 1.8 and abs(b[0] - d['x']) < b[3] + b[5] + 1.3 and abs(b[2] - d['z']) < b[3] + b[5] + 0.7:
                assert mapgen.circle_rect_dist(d['x'], d['z'], (b[0], b[2], b[3], b[5], b[6])) > 1.2, 'cart %d parked in %r' % (d['id'], b)
    # nothing but the barriers stands on the tarmac (the cranes' legs are either side of it)
    for b in j['boxes']:
        if b[7] in ('barrier', 'concrete') or b[1] - b[4] > 2.5:
            continue
        assert town.track_dist(b[0], b[2]) > map_derby.TRACK_W / 2 - 0.2 or b[3] > 20, 'something on the track: %r' % (b,)
    print('track ok: %d m a lap, tightest bend %.1f m, parts %.0f m apart, %d carts in the pits, %d boxes' % (
        total, minr, minc, len(carts), len(j['boxes'])))


async def player(name):
    p = P(name)
    p.ws = await WS.connect(test_server.URL)
    p.ws.send({'t': 'hello', 'name': name, 'v': '3.3.0'})
    asyncio.ensure_future(p.read())
    p.ws.send({'t': 'join', 'mode': 'derby', 'ld': 0})
    return p


def cart_of(p):
    """The cart the server last said this player is driving."""
    fks = [m for m in p.msgs if m.get('t') == 'fk' and m.get('driver') == p.id]
    return fks[-1] if fks else None


async def drive(p, fid, frm, yaw, speed, secs, to=None):
    """Drive a cart in a straight line at `speed` for `secs`, telling the server as we go."""
    fx, fz = math.cos(yaw), -math.sin(yaw)
    pos = list(frm)
    steps = int(secs / 0.05)
    for k in range(steps):
        if to is not None and k == steps - 1:
            pos = list(to)
        else:
            pos = [pos[0] + fx * speed * 0.05, 0.0, pos[2] + fz * speed * 0.05]
        p.ws.send({'t': 'fk', 'id': fid, 'p': pos, 'y': yaw})
        p.move(pos)
        await asyncio.sleep(0.05)
    return pos


async def test_derby():
    a = await player('Racer')
    b = await player('Rival')
    await wait(lambda: a.map is not None and b.map is not None, 10, 'the map')
    assert a.map['kind'] == 'derby' and a.map.get('track'), 'the Derby plays the race track: %r' % a.map['kind']
    await wait(lambda: a.alive and b.alive and cart_of(a) and cart_of(b), 8, 'both in a cart')
    ca, cb = cart_of(a), cart_of(b)
    assert ca['id'] != cb['id'], 'a cart each'
    print('seated ok: Racer in cart %d at %r, Rival in cart %d at %r' % (ca['id'], ca['p'], cb['id'], cb['p']))
    # nobody gets out, and no guns
    a.ws.send({'t': 'fkout', 'id': ca['id']})
    a.shoot(b, times=3, w='knife')
    await asyncio.sleep(0.5)
    assert cart_of(a)['driver'] == a.id and not b.saw('kill'), 'no getting out, no shooting'
    # Rival sits still somewhere; Racer comes at it slowly, then fast
    for p in (a, b):
        p.move([p.pos[0] + 0.5, 0.0, p.pos[2]])     # an input, so spawn protection is over
    await asyncio.sleep(1.8)
    target = [cb['p'][0], 0.0, cb['p'][2]]
    yaw = 0.0
    start = [target[0] - 6.0, 0.0, target[2]]
    a.ws.send({'t': 'fk', 'id': ca['id'], 'p': [ca['p'][0], 0, ca['p'][2]], 'y': yaw})
    # get the cart over to the run-up a few metres at a time
    pos = [ca['p'][0], 0.0, ca['p'][2]]
    while math.hypot(pos[0] - start[0], pos[2] - start[2]) > 0.5:
        d = math.hypot(start[0] - pos[0], start[2] - pos[2])
        k = min(1.0, 3.0 / d)
        pos = [pos[0] + (start[0] - pos[0]) * k, 0.0, pos[2] + (start[2] - pos[2]) * k]
        a.ws.send({'t': 'fk', 'id': ca['id'], 'p': pos, 'y': yaw})
        a.move(pos)
        await asyncio.sleep(0.3)        # slowly: no speed built up
    a.ws.send({'t': 'roadkill', 'id': b.id})
    await asyncio.sleep(0.3)
    assert b.alive, 'a crawl into someone is not a crash'
    # from the side: Rival's cart beside Racer's, Racer's nose pointing away
    a.ws.send({'t': 'fk', 'id': ca['id'], 'p': [target[0] - 2.0, 0, target[2]], 'y': math.pi})
    await asyncio.sleep(0.1)
    a.ws.send({'t': 'roadkill', 'id': b.id})
    await asyncio.sleep(0.3)
    assert b.alive, 'backing into someone is not a crash'
    a.ws.send({'t': 'fk', 'id': ca['id'], 'p': start, 'y': yaw})
    await asyncio.sleep(0.4)
    end = await drive(a, ca['id'], start, yaw, 11.0, 0.45, to=[target[0] - 2.0, 0.0, target[2]])
    a.ws.send({'t': 'roadkill', 'id': b.id})
    await wait(lambda: not b.alive, 3, 'the crash to kill')
    ev = [e for e in a.saw('kill') if e['v'] == b.id][-1]
    assert ev['w'] == 'cart' and ev['k'] == a.id, ev
    t0 = asyncio.get_event_loop().time()
    dead = [m for m in b.msgs if m.get('t') == 'dead'][-1]
    assert 0.9 <= dead['rs'] <= 1.1, 'one second to wait: %r' % dead['rs']
    await wait(lambda: b.alive, 3, 'back on the track')
    waited = asyncio.get_event_loop().time() - t0
    cb2 = cart_of(b)
    assert cb2 and cb2['id'] == cb['id'], 'back in the same cart'
    tr = a.map['track']
    near = min(math.hypot(q[0] - cb2['p'][0], q[1] - cb2['p'][2]) for q in tr)
    assert near < 3.0, 'back on the tarmac: %.1f m off the line' % near
    print('crash ok: at 11 m/s from behind it kills (crawling and backing do not); back in cart %d %.1f s later, %.1f m off the line' % (cb2['id'], waited, near))

    # a grenade that only just reaches is still a kill, and so is your own
    b.move([b.pos[0] + 0.3, 0.0, b.pos[2]])
    await asyncio.sleep(1.8)
    before = len(a.saw('kill'))
    bp = [m for m in b.msgs if m.get('t') == 'spawn'][-1]['p']
    a.ws.send({'t': 'nade', 'n': 7, 'k': 'frag', 'o': [end[0], 1.5, end[2]], 'v': [0, 0, 0]})
    await asyncio.sleep(0.2)
    a.ws.send({'t': 'boom', 'n': 7, 'p': [bp[0] + 5.6, 0.3, bp[2]]})     # six metres out: a scratch anywhere else
    await wait(lambda: len(a.saw('kill')) > before, 3, 'the grenade to kill')
    ev = a.saw('kill')[-1]
    assert ev['v'] == b.id and ev['w'] == 'nade', ev
    await wait(lambda: a.alive, 2, 'still alive')
    before = len(a.saw('kill'))
    apos = cart_of(a)['p']
    a.ws.send({'t': 'nade', 'n': 8, 'k': 'frag', 'o': [apos[0], 1.5, apos[2]], 'v': [0, 0, 0]})
    await asyncio.sleep(0.2)
    a.ws.send({'t': 'boom', 'n': 8, 'p': [a.pos[0] + 5.6, 0.3, a.pos[2]]})
    await wait(lambda: not a.alive, 3, 'my own grenade to kill me')
    print('grenades ok: a frag six metres off kills outright, and so does your own')
    await close(a, b)


def check_catalog():
    import catalog
    lk = catalog.new_locker()
    lk['dinars'] = 10 ** 7
    seen = set()
    for _ in range(400):
        prize = catalog.open_crate(lk, 'kart')
        assert prize and prize['kind'] == 'cart' and prize['cart'] in catalog.CART_IDS, prize
        seen.add(prize['cart'])
    assert lk['carts'] and set(lk['carts']) == seen, 'what came out of the crate is in the locker'
    lk['equip']['cart'] = sorted(seen)[0]
    clean = catalog.clean_locker(lk)
    assert clean['equip']['cart'] == sorted(seen)[0] and set(clean['carts']) == seen, 'kept through a save'
    clean = catalog.clean_locker({'carts': ['nope'], 'equip': {'cart': 'nope'}})
    assert clean['carts'] == [] and clean['equip']['cart'] == '', 'only real cart skins'
    rolled = {catalog.roll(k).get('outfit') for k in catalog.CRATES for _ in range(3000)}
    assert not rolled & catalog.OWNER_ONLY, 'an outfit only given by hand came out of a crate'
    assert 'guccimorty' in catalog.OWNER_ONLY
    print('catalog ok: %d cart skins seen from %d crates, kept on the locker' % (len(seen), 400))


async def test_owner_outfit():
    """Gucci Morty: on the owner's account, and nobody else can wear it."""
    o = P('Owner')
    o.ws = await WS.connect(test_server.URL)
    o.ws.send({'t': 'hello', 'name': 'Owner', 'v': '3.3.0'})
    asyncio.ensure_future(o.read())
    o.ws.send({'t': 'signup', 'username': 'MCB', 'email': 'mcb-%d@example.com' % os.getpid(), 'password': 'passw0rd!', 'guest': None})
    o.ws.send({'t': 'login', 'id': 'MCB', 'password': 'passw0rd!'})
    await wait(lambda: any(m.get('t') == 'auth' and m.get('user') for m in o.msgs), 6, 'the owner signed in')
    lk = [m for m in o.msgs if m.get('t') == 'auth' and m.get('user')][-1]['locker']
    assert 'guccimorty' in lk['outfits'], 'the owner has Gucci Morty'
    g = P('Guest')
    g.ws = await WS.connect(test_server.URL)
    g.ws.send({'t': 'hello', 'name': 'Guest', 'v': '3.3.0', 'cos': {'o': 'guccimorty', 'g': {}, 'c': 'inferno'}})
    asyncio.ensure_future(g.read())
    for p in (o, g):
        p.ws.send({'t': 'join', 'mode': 'ffa', 'ld': 0, 'map': 'dock', 'cos': {'o': 'guccimorty', 'g': {}, 'c': 'inferno'}})
    await wait(lambda: any(m.get('t') == 'roster' and len(m['pl']) >= 2 for m in g.msgs), 8, 'the roster')
    ros = [m for m in g.msgs if m.get('t') == 'roster'][-1]['pl']
    wear = {r['n']: r['cs'] for r in ros}
    assert wear['MCB']['o'] == 'guccimorty', 'the owner wears it: %r' % wear['MCB']
    assert wear['Guest']['o'] == 'standard', 'a guest cannot: %r' % wear['Guest']
    assert wear['MCB']['c'] == 'inferno', 'the owner has every cart skin too: %r' % wear['MCB']
    assert wear['Guest']['c'] == 'inferno', 'a guest keeps their own cart skins: %r' % wear['Guest']
    print('owner outfit ok: MCB wears Gucci Morty, a guest asking for it gets the standard kit')
    await close(o, g)


async def test_midlife_swap():
    """A gun changed in the Locker mid-life waits for the next life; the one in hand still hits."""
    a, b = P('Swapper'), P('Target')
    for p in (a, b):
        p.ws = await WS.connect(test_server.URL)
        p.ws.send({'t': 'hello', 'name': p.name, 'v': '3.3.0'})
        asyncio.ensure_future(p.read())
        p.ws.send({'t': 'join', 'mode': 'ffa', 'ld': 0, 'map': 'dock'})
    await wait(lambda: a.alive and b.alive, 10, 'both spawned')
    b.move([b.pos[0] + 0.5, b.pos[1], b.pos[2]])
    a.move([b.pos[0] + 3.0, b.pos[1], b.pos[2]])
    await asyncio.sleep(1.8)
    # the Locker: the PDW for next life, then the Medic's loadout as well
    a.ws.send({'t': 'picks', 'pk': 'ammo', 'nk': 'frag', 'pw': 'pdw', 'sw': 'revolver'})
    await asyncio.sleep(0.3)
    hurt = lambda: [m for m in b.msgs if m.get('t') == 'hurt']
    n0 = len(hurt())
    a.shoot(b, times=1, w='smg')
    await wait(lambda: len(hurt()) > n0, 3, 'the SMG in hand to still do damage')
    n1 = len(hurt())
    a.shoot(b, times=1, w='pdw')
    await asyncio.sleep(0.6)
    assert len(hurt()) == n1, 'the PDW is for the next life, not this one'
    print('mid-life swap ok: the SMG in hand still hurts after picking the PDW; the PDW does not until the next life')
    await close(a, b)


async def test_owner_kill():
    """/kill: the owner only; a named player, everyone else, or yourself. It counts for nothing."""
    o = P('Owner')
    o.ws = await WS.connect(test_server.URL)
    o.ws.send({'t': 'hello', 'name': 'Owner', 'v': '3.3.0'})
    asyncio.ensure_future(o.read())
    o.ws.send({'t': 'login', 'id': 'MCB', 'password': 'passw0rd!'})
    await wait(lambda: any(m.get('t') == 'auth' and m.get('user') for m in o.msgs), 6, 'the owner signed in')
    a, b = P('Annoying'), P('Bystander')
    for p in (o, a, b):
        if p is not o:
            p.ws = await WS.connect(test_server.URL)
            p.ws.send({'t': 'hello', 'name': p.name, 'v': '3.3.0'})
            asyncio.ensure_future(p.read())
        p.ws.send({'t': 'join', 'mode': 'tdm', 'ld': 0, 'map': 'dock'})
    await wait(lambda: o.alive and a.alive and b.alive, 10, 'all three spawned')
    sys_msgs = lambda p: [m['m'] for m in p.msgs if m.get('t') == 'chat' and m.get('sys')]
    a.ws.send({'t': 'chat', 'm': '/kill Owner'})
    await wait(lambda: sys_msgs(a), 3, 'the refusal')
    assert o.alive and 'owner' in sys_msgs(a)[-1].lower(), 'only the owner may: %r' % sys_msgs(a)
    o.ws.send({'t': 'chat', 'm': '/kill annoying'})
    await wait(lambda: not a.alive, 3, 'the named player to die')
    ev = [e for e in o.saw('kill') if e['v'] == a.id][-1]
    assert ev['k'] == 0 and ev['w'] == 'struck down', ev
    await wait(lambda: a.alive, 6, 'them to respawn as usual')
    await asyncio.sleep(0.8)      # chat takes one message every 0.7 s
    o.ws.send({'t': 'chat', 'm': '/kill all'})
    await wait(lambda: not a.alive and not b.alive, 3, 'everyone else to die')
    assert o.alive, 'all means everyone but you'
    await asyncio.sleep(0.8)      # chat takes one message every 0.7 s
    o.ws.send({'t': 'chat', 'm': '/kill'})
    await wait(lambda: not o.alive, 3, 'the owner to die')
    await asyncio.sleep(0.6)
    ros = [m for m in o.msgs if m.get('t') == 'roster'][-1]['pl']
    assert all(r['d'] == 0 for r in ros), 'no deaths on anyone\'s record: %r' % [(r['n'], r['d']) for r in ros]
    print('owner kill ok: refused for others; /kill name, /kill all and /kill work and count for nothing')
    await close(o, a, b)


async def test_331():
    """3.3.1: a ban announced on every screen, Knife Fight with no carts, the owner's police cart."""
    o = P('Owner')
    o.ws = await WS.connect(test_server.URL)
    o.ws.send({'t': 'hello', 'name': 'Owner', 'v': '3.3.1'})
    asyncio.ensure_future(o.read())
    o.ws.send({'t': 'login', 'id': 'MCB', 'password': 'passw0rd!'})
    await wait(lambda: any(m.get('t') == 'auth' and m.get('user') for m in o.msgs), 6, 'the owner signed in')
    lk = [m for m in o.msgs if m.get('t') == 'auth' and m.get('user')][-1]['locker']
    assert 'interceptor' in lk['carts'], 'the owner has the Interceptor'
    bad, watcher, menu = P('Cheater%d' % (os.getpid() % 1000)), P('Watcher'), P('OnMenu')
    for p in (bad, watcher, menu):
        p.ws = await WS.connect(test_server.URL)
        p.ws.send({'t': 'hello', 'name': p.name, 'v': '3.3.1', 'cos': {'o': 'standard', 'g': {}, 'c': 'interceptor'}})
        asyncio.ensure_future(p.read())
    for p in (o, bad, watcher):
        p.ws.send({'t': 'join', 'mode': 'knives', 'ld': 0, 'map': 'manor', 'cos': {'o': 'standard', 'g': {}, 'c': 'interceptor'}})
    await wait(lambda: watcher.map is not None and any(m.get('t') == 'roster' and len(m['pl']) >= 3 for m in watcher.msgs), 10, 'the knife fight')
    assert watcher.map['kind'] == 'manor', watcher.map['kind']
    assert not [d for d in watcher.map['deco'] if d['k'] == 'golfcart'], 'no golf carts in Knife Fight'
    wear = {r['n']: r['cs'] for r in [m for m in watcher.msgs if m.get('t') == 'roster'][-1]['pl']}
    assert wear['MCB']['c'] == 'interceptor' and wear['Watcher']['c'] == '', 'only the owner drives the Interceptor: %r' % wear
    rolled = {catalog_roll() for _ in range(4000)}
    assert 'interceptor' not in rolled, 'the Interceptor never comes out of a crate'
    await asyncio.sleep(0.8)
    o.ws.send({'t': 'chat', 'm': '/ban ' + bad.name.lower()})
    for p in (watcher, menu):
        await wait(lambda: any(m.get('t') == 'banbanner' for m in p.msgs), 3, 'the banner on %s' % p.name)
        ban = [m for m in p.msgs if m.get('t') == 'banbanner'][-1]
        assert ban['n'] == bad.name, 'the name as they wrote it: %r' % ban
    print('3.3.1 ok: "%s IS BANNED" went to a player in a match and one on the menu; Knife Fight on the Manor has no carts; only MCB has the Interceptor' % bad.name)
    o.ws.send({'t': 'chat', 'm': '/unban ' + bad.name.lower()})
    await asyncio.sleep(0.3)
    await close(o, watcher, menu)


def catalog_roll():
    import catalog
    return catalog.roll('kart')['cart']


async def test_gatling():
    """The Interceptor's Gatling: only the owner, only at the wheel of that cart, and it hits."""
    async def joined(name, login=None, cart=''):
        p = P(name)
        p.ws = await WS.connect(test_server.URL)
        p.ws.send({'t': 'hello', 'name': name, 'v': '3.3.2'})
        asyncio.ensure_future(p.read())
        if login:
            p.ws.send({'t': 'login', 'id': login, 'password': 'passw0rd!'})
            await wait(lambda: any(m.get('t') == 'auth' and m.get('user') for m in p.msgs), 6, 'signed in')
        p.ws.send({'t': 'join', 'mode': 'tdm', 'ld': 0, 'map': 'manor', 'cos': {'o': 'standard', 'g': {}, 'c': cart}})
        return p
    o = await joined('Owner', 'MCB', 'interceptor')
    g = await joined('Guest', None, 'interceptor')
    v = await joined('Victim')
    await wait(lambda: o.alive and g.alive and v.alive and o.map, 10, 'all three spawned')
    carts = [d for d in o.map['deco'] if d['k'] == 'golfcart']
    hurt = lambda: len([m for m in v.msgs if m.get('t') == 'hurt'])
    v.move([v.pos[0] + 0.5, 0.0, v.pos[2]])

    async def board(p, c):
        p.move([c['x'] + 1.0, 0.0, c['z']])
        await asyncio.sleep(0.2)
        p.ws.send({'t': 'fkin', 'id': c['id']})
        await wait(lambda: any(m.get('t') == 'fk' and m.get('driver') == p.id for m in p.msgs), 3, '%s at the wheel' % p.name)
        p.move([c['x'], 0.0, c['z']])

    def gatling(p, n=10):
        for _ in range(n):
            p.ws.send({'t': 'shot', 'w': 'minigun', 'o': [p.pos[0], 2.9, p.pos[2]], 'e': [v.pos], 'h': [[v.id, 'b']]})
    await asyncio.sleep(1.8)
    # on foot, the owner can't fire it
    n0 = hurt()
    gatling(o)
    await asyncio.sleep(0.5)
    assert hurt() == n0, 'no Gatling on foot'
    # a guest at the wheel of a cart, asking for the Interceptor: refused
    await board(g, carts[1])
    gatling(g)
    await asyncio.sleep(0.5)
    assert hurt() == n0, 'only the owner fires it'
    # the owner at the wheel of the Interceptor: it hits, fast
    await board(o, carts[0])
    await asyncio.sleep(0.3)
    for _ in range(15):          # fifty rounds a second, as the turret fires them
        gatling(o, 1)
        await asyncio.sleep(0.02)
    await wait(lambda: hurt() > n0, 3, 'the Gatling to hit')
    await wait(lambda: not v.alive, 3, 'the Gatling to kill')
    ev = [e for e in o.saw('kill') if e['v'] == v.id][-1]
    assert ev['w'] == 'minigun', ev
    print('gatling ok: refused on foot and to a guest in a cart; from the owner\'s Interceptor it killed in %d hits' % (hurt() - n0))
    await close(o, g, v)


async def main():
    check_track()
    check_catalog()
    await test_derby()
    await test_owner_outfit()
    await test_midlife_swap()
    await test_owner_kill()
    await test_331()
    await test_gatling()
    print('all 3.3.0 checks passed')


if __name__ == '__main__':
    asyncio.run(main())
