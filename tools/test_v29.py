#!/usr/bin/env python3
"""
The 2.9 guns and fire against a running server: the .50 one-shots, the
revolver three-shots, the flamethrower kills in four seconds and leaves a
burn, a molotov leaves a burning patch, a forklift runs someone over, and
a bug report is written down.

    DATA_DIR=/tmp/souk-test python3 server/server.py 8765 &   # then:
    DATA_DIR=/tmp/souk-test python3 tools/test_v29.py
"""

import asyncio
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from test_server import P, phase, wait  # noqa: E402
from test_v22 import settle  # noqa: E402


def got(p, t, **match):
    return [m for m in p.msgs if m.get('t') == t and all(m.get(k) == v for k, v in match.items())]


async def pair(name_a, name_b, ld=0, **picks):
    a, b = P(name_a), P(name_b)
    await a.start('tdm', ld=ld, **picks)
    await b.start('tdm')
    await phase(a, 'live', 15)
    await settle(a, a, b)
    b.move([a.pos[0] + 6, 0, a.pos[2]])
    await asyncio.sleep(0.3)
    return a, b


def shot(p, target, w, part='b'):
    p.ws.send({'t': 'shot', 'w': w, 'o': [p.pos[0], 1.5, p.pos[2]], 'e': [target.pos], 'h': [[target.id, part]]})


async def test_heavy():
    a, b = await pair('Kabir', 'Mark', ld=3, pw='heavy')
    shot(a, b, 'sniper')
    await asyncio.sleep(0.4)
    assert not got(b, 'hurt'), 'the Saqr is not in hand when the .50 is chosen'
    shot(a, b, 'heavy', 'b')
    await wait(lambda: a.saw('kill'), 3, 'a one-shot body kill with the .50')
    print('heavy ok: one body shot killed')
    a.ws.w.close(); b.ws.w.close(); await asyncio.sleep(0.4)


async def test_revolver():
    a, b = await pair('Asad', 'Mark2', ld=0, sw='revolver')
    shot(a, b, 'pistol')
    await asyncio.sleep(0.4)
    assert not got(b, 'hurt'), 'the pistol is not carried when the revolver is chosen'
    for i in range(2):
        shot(a, b, 'revolver', 'b')
        await asyncio.sleep(0.45)
    assert not a.saw('kill'), 'two body shots should not kill'
    shot(a, b, 'revolver', 'b')
    await wait(lambda: a.saw('kill'), 3, 'the third body shot killing')
    a.ws.w.close(); b.ws.w.close(); await asyncio.sleep(0.4)
    c, d = await pair('Asad2', 'Mark3', ld=0, sw='revolver')
    for i in range(2):
        shot(c, d, 'revolver', 'h')
        await asyncio.sleep(0.45)
    await wait(lambda: c.saw('kill'), 3, 'two headshots killing')
    print('revolver ok: three to the body, two to the head')
    c.ws.w.close(); d.ws.w.close(); await asyncio.sleep(0.4)


async def test_flamer():
    a, b = await pair('Nar', 'Mark4', ld=2, pw='flamer')
    b.move([a.pos[0] + 2.5, 0, a.pos[2]])
    await asyncio.sleep(0.3)
    t0 = asyncio.get_event_loop().time()
    # hold the trigger: a tick every 0.15 s at 3 damage a tick, plus the burn
    while not a.saw('kill') and asyncio.get_event_loop().time() - t0 < 6.0:
        shot(a, b, 'flamer')
        await asyncio.sleep(0.15)
    took = asyncio.get_event_loop().time() - t0
    assert a.saw('kill'), 'the flame should have killed within six seconds'
    assert 1.5 <= took <= 2.8, 'dies in about two seconds of flame: took %.1f' % took
    assert all(m.get('fire') for m in got(b, 'hurt')), 'flame hurt is marked as fire'
    print('flamer ok: killed in %.1f s of contact, hurt marked as fire' % took)
    a.ws.w.close(); b.ws.w.close(); await asyncio.sleep(0.4)
    # a touch of flame keeps burning after the flame stops: five a second for ten seconds
    c, d = await pair('Nar2', 'Mark5', ld=2, pw='flamer')
    d.move([c.pos[0] + 2.5, 0, c.pos[2]])
    await asyncio.sleep(0.3)
    shot(c, d, 'flamer')
    await asyncio.sleep(3.0)
    burn = [m for m in got(d, 'hurt') if m.get('fire')]
    total = sum(m['d'] for m in burn)
    assert 12 <= total <= 26, 'about three seconds of burning after one touch: %d damage in %d ticks' % (total, len(burn))
    print('burn ok: %d damage over three seconds after a single touch' % total)
    c.ws.w.close(); d.ws.w.close(); await asyncio.sleep(0.4)


async def test_molotov():
    a, b = await pair('Molly', 'Mark6', ld=0, nk='molotov')
    b.move([a.pos[0] + 12, 0, a.pos[2]])
    await asyncio.sleep(0.3)
    a.ws.send({'t': 'nade', 'n': 1, 'k': 'molotov', 'o': [a.pos[0], 1.5, a.pos[2]], 'v': [8, 3, 0]})
    a.ws.send({'t': 'boom', 'n': 1, 'p': [a.pos[0] + 12, 0, a.pos[2]]})
    await wait(lambda: got(b, 'fire') and got(b, 'fire')[0].get('p'), 3, 'a burning patch')
    await asyncio.sleep(2.5)
    burn = [m for m in got(b, 'hurt') if m.get('fire')]
    assert burn and sum(m['d'] for m in burn) >= 8, 'standing in the fire burns: %r' % burn
    blast = [m for m in got(b, 'hurt') if not m.get('fire')]
    assert not blast or blast[0]['d'] <= 70, 'the blast is half a frag: %r' % blast
    # a third molotov is refused: two a life
    for n in (2, 3):
        a.ws.send({'t': 'nade', 'n': n, 'k': 'molotov', 'o': [a.pos[0], 1.5, a.pos[2]], 'v': [1, 2, 0]})
        await asyncio.sleep(0.1)
    await asyncio.sleep(0.4)
    assert len(got(b, 'nade', id=a.id)) == 2, 'two molotovs a life'
    print('molotov ok: patch burns whoever stands in it, two a life')
    a.ws.w.close(); b.ws.w.close(); await asyncio.sleep(0.4)


async def test_roadkill():
    a, b = P('Driver'), P('Walker')
    a.ws = await __import__('test_server').WS.connect(__import__('test_server').URL)
    a.ws.send({'t': 'hello', 'name': a.name, 'v': '2.0.0'})
    a.ws.send({'t': 'join', 'mode': 'tdm', 'ld': 0, 'map': 'dock'})
    asyncio.ensure_future(a.read())
    await wait(lambda: a.map, 10, 'the map')
    await b.start('tdm')
    await phase(a, 'live', 15)
    await settle(a, a, b)
    f = [d for d in a.map['deco'] if d['k'] == 'forklift'][0]
    a.move([f['x'] + 1.5, 0, f['z']])
    await asyncio.sleep(0.3)
    a.ws.send({'t': 'fkin', 'id': f['id']})
    await wait(lambda: got(a, 'fk', driver=a.id), 3, 'seated')
    # not driving into anyone yet: refused
    a.ws.send({'t': 'roadkill', 'id': b.id})
    await asyncio.sleep(0.4)
    assert not a.saw('kill'), 'no roadkill from across the yard'
    b.move([f['x'] + 1.0, 0, f['z'] + 0.5])
    await asyncio.sleep(0.3)
    a.ws.send({'t': 'roadkill', 'id': b.id})
    await wait(lambda: a.saw('kill'), 3, 'the roadkill')
    assert a.saw('kill')[0]['w'] == 'forklift', a.saw('kill')[0]
    print('roadkill ok: refused at range, a kill under the truck')
    a.ws.w.close(); b.ws.w.close(); await asyncio.sleep(0.4)


async def test_bug():
    a = P('Reporter')
    a.ws = await __import__('test_server').WS.connect(__import__('test_server').URL)
    a.ws.send({'t': 'hello', 'name': a.name, 'v': '2.0.0'})
    asyncio.ensure_future(a.read())
    await asyncio.sleep(0.3)
    a.ws.send({'t': 'bug', 'name': 'Tess', 'text': 'x'})
    await wait(lambda: got(a, 'bugok'), 3, 'a reply')
    assert got(a, 'bugok')[0]['ok'] is False, 'too short is refused'
    a.ws.send({'t': 'bug', 'name': 'Tess', 'text': 'The forklift drove through the fuel tank on the Dockyard, seed whatever.'})
    await wait(lambda: len(got(a, 'bugok')) >= 2, 3, 'the report accepted')
    assert got(a, 'bugok')[1]['ok'] is True
    path = os.path.join(os.environ.get('DATA_DIR', ''), 'bugs.jsonl')
    lines = [json.loads(l) for l in open(path)] if os.path.exists(path) else []
    assert lines and lines[-1]['name'] == 'Tess' and 'forklift' in lines[-1]['text'], 'the report is on file: %r' % lines[-1:]
    print('bug ok: too-short refused, a real one written to %s' % path)
    a.ws.w.close()


async def test_new_primaries():
    """The PDW and the carbine are carried when chosen, and only by the right classes."""
    a, b = await pair('Pdw', 'Mark7', ld=0, pw='pdw')
    shot(a, b, 'smg')
    await asyncio.sleep(0.4)
    assert not got(b, 'hurt'), 'the SMG is not in hand when the PDW is chosen'
    for i in range(4):
        shot(a, b, 'pdw', 'b')
        await asyncio.sleep(0.1)
    await wait(lambda: a.saw('kill'), 3, 'a PDW kill up close')
    a.ws.w.close(); b.ws.w.close(); await asyncio.sleep(0.4)
    c, d = await pair('Medic', 'Mark8', ld=1, pw='carbine')
    for i in range(4):
        shot(c, d, 'carbine', 'b')
        await asyncio.sleep(0.1)
    await wait(lambda: c.saw('kill'), 3, 'a carbine kill by the medic')
    c.ws.w.close(); d.ws.w.close(); await asyncio.sleep(0.4)
    e, f = await pair('Breach', 'Mark9', ld=2, pw='carbine')
    shot(e, f, 'carbine', 'b')
    await asyncio.sleep(0.4)
    assert not got(f, 'hurt'), 'the breacher may not carry the carbine'
    print('new primaries ok: PDW and carbine fire for those who may carry them')
    e.ws.w.close(); f.ws.w.close(); await asyncio.sleep(0.4)


async def test_knives():
    """Throwing knives: three a life, everyone sees the throw, a landing kills; the knife kills from behind or to the head."""
    a, b = await pair('Thrower', 'Mark10', ld=3, pk='knives')
    o = [a.pos[0], a.pos[1] + 1.5, a.pos[2]]
    a.ws.send({'t': 'perk', 'k': 'knives', 'p': o, 'v': [24, 0, 0]})
    await wait(lambda: got(a, 'perkleft'), 3, 'a knife counted')
    assert got(a, 'perkleft')[-1]['n'] == 2, got(a, 'perkleft')
    await wait(lambda: got(b, 'throw', id=a.id), 3, 'the other player seeing the knife fly')
    # a landing kills wherever it hits
    a.ws.send({'t': 'shot', 'w': 'tknife', 'o': o, 'e': [], 'h': [[b.id, 'b']]})
    await wait(lambda: a.saw('kill'), 3, 'a thrown knife kill')
    assert a.saw('kill')[0]['w'] == 'tknife'
    # no knife in the air: a landing is refused
    await asyncio.sleep(0.3)
    a.ws.send({'t': 'shot', 'w': 'tknife', 'o': o, 'e': [], 'h': [[b.id, 'b']]})
    await asyncio.sleep(0.4)
    assert len(a.saw('kill')) == 1, 'a knife that was never thrown cannot land'
    print('knives ok: counted, seen, a kill where it lands, and no phantom knives')
    a.ws.w.close(); b.ws.w.close(); await asyncio.sleep(0.4)
    # the knife in hand: everyone faces -z; standing at +z of the victim is behind them
    c, d = await pair('Stabber', 'Mark11', ld=0)
    c.move([d.pos[0], 0, d.pos[2] - 1.2])          # in front of the victim
    await asyncio.sleep(0.3)
    shot(c, d, 'knife', 'b')
    await asyncio.sleep(0.5)
    assert not c.saw('kill'), 'one stab from the front should not kill'
    c.move([d.pos[0], 0, d.pos[2] + 1.2])          # now behind
    await asyncio.sleep(0.3)
    shot(c, d, 'knife', 'b')
    await wait(lambda: c.saw('kill'), 3, 'a backstab kill')
    c.ws.w.close(); d.ws.w.close(); await asyncio.sleep(0.4)
    e, f = await pair('Stabber2', 'Mark12', ld=0)
    e.move([f.pos[0], 0, f.pos[2] - 1.2])
    await asyncio.sleep(0.3)
    shot(e, f, 'knife', 'h')
    await wait(lambda: e.saw('kill'), 3, 'a knife to the head')
    print('knife ok: two from the front, one from behind, one to the head')
    e.ws.w.close(); f.ws.w.close(); await asyncio.sleep(0.4)


async def main():
    await test_knives()
    await test_new_primaries()
    await test_heavy()
    await test_revolver()
    await test_flamer()
    await test_molotov()
    await test_roadkill()
    await test_bug()
    print('all passed')


if __name__ == '__main__':
    asyncio.get_event_loop().run_until_complete(main())
