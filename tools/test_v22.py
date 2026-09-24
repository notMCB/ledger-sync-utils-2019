#!/usr/bin/env python3
"""
Checks the 2.2 combat changes against a running server:
knife damage (two hits up close), shotgun slugs, and the bigger rooms.

    python3 server/server.py 8765 &   # then:
    python3 tools/test_v22.py
"""

import asyncio
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from test_server import P, phase, wait  # noqa: E402

# read the room sizes out of the server source: importing it would start its
# background threads and the test would never exit
SRC = open(os.path.join(os.path.dirname(HERE), 'server', 'server.py')).read()


def const(name):
    return int(re.search(r'^%s = (\d+)' % name, SRC, re.M).group(1))


async def hp_of(watcher, pid):
    for p in watcher.snap_players:
        if p[0] == pid:
            return p
    return None


def unshielded(watcher, pid):
    """True once the snapshot shows this player alive and past spawn protection."""
    for p in watcher.snap_players:
        if p[0] == pid:
            return (p[6] & 1) and not (p[6] & 128)
    return False


async def settle(watcher, *targets):
    """Wait for everyone to spawn and their spawn protection to lapse."""
    for t in targets:
        await wait(lambda: unshielded(watcher, t.id), 12, '%s to spawn unshielded' % t.name)


async def test_knife():
    a, b = P('Knifer'), P('Victim')
    await a.start('tdm')
    await b.start('tdm')
    await phase(a, 'live', 15)
    await asyncio.sleep(1.8)
    assert a.team != b.team
    b.move([a.pos[0] + 1.2, 0, a.pos[2]])
    await asyncio.sleep(0.3)
    # one stab to the body, from the side, must not be enough (the head, or from behind, kills outright)
    def stab():
        a.ws.send({'t': 'shot', 'w': 'knife', 'o': [a.pos[0], a.pos[1] + 1.5, a.pos[2]], 'e': [b.pos], 'h': [[b.id, 'b']]})
    stab()
    await asyncio.sleep(0.8)
    assert not a.saw('kill'), 'one knife hit should not kill'
    stab()
    await wait(lambda: a.saw('kill'), 3, 'knife kill on the second hit')
    print('knife ok: two body hits killed, one did not')
    a.ws.w.close()
    b.ws.w.close()


async def test_slug():
    a, b = P('Slugger'), P('Target')
    await a.start('tdm')
    await b.start('tdm')
    a.ws.send({'t': 'ld', 'ld': 2})        # the Breacher, so the shotgun is his gun
    await phase(a, 'live', 15)
    a.ws.send({'t': 'ld', 'ld': 2})
    await asyncio.sleep(1.8)
    # 45 m away: buckshot can't reach, a slug can
    b.move([a.pos[0] + 45, 0, a.pos[2]])
    await asyncio.sleep(0.3)
    a.shoot(b, 1, 'shotgun')
    await asyncio.sleep(0.7)
    assert not a.saw('kill'), 'buckshot should not kill across the map'
    a.ws.send({'t': 'atch', 'a': {'slug': True}})
    await asyncio.sleep(0.2)
    for _ in range(2):
        a.shoot(b, 1, 'shotgun')
        await asyncio.sleep(0.9)
    await wait(lambda: a.saw('kill'), 4, 'slug kill at 45 m')
    print('slug ok: buckshot fell short, slugs killed at 45 m')
    a.ws.w.close()
    b.ws.w.close()


async def test_assist():
    a, b, c = P('Helper'), P('Mark'), P('Finisher')
    await a.start('tdm')
    await b.start('tdm')
    await c.start('tdm')
    await phase(a, 'live', 15)
    await settle(a, a, b, c)
    assert a.team == c.team != b.team, 'teams should alternate a/b/c'
    b.move([a.pos[0] + 3, 0, a.pos[2]])
    c.move([a.pos[0] + 6, 0, a.pos[2]])
    await asyncio.sleep(0.3)
    # three SMG body hits at 3 m: 72 damage, well over the 50 an assist needs
    for _ in range(3):
        a.ws.send({'t': 'shot', 'w': 'smg', 'o': [a.pos[0], 1.5, a.pos[2]], 'e': [b.pos], 'h': [[b.id, 'b']]})
        await asyncio.sleep(0.12)
    await asyncio.sleep(0.4)
    assert not a.saw('kill'), 'three body hits should not kill'
    c.shoot(b, 1, 'smg')
    await wait(lambda: c.saw('kill'), 3, 'the finisher\'s kill')
    await wait(lambda: a.saw('assist'), 3, 'an assist for the helper')
    ev = c.saw('kill')[0]
    assert 'Helper' in ev.get('as', []), 'the kill event should name the helper: %r' % ev
    earned = [e for e in a.saw('earn') if e.get('why') == 'assist']
    assert earned and earned[0]['n'] == 10, 'assist should pay 10 dinars: %r' % earned
    print('assist ok: 72 damage then a teammate kill paid 10 dinars')
    for p in (a, b, c):
        p.ws.w.close()


async def test_burst():
    """Shots that arrive bunched together (a slow network) must still count."""
    a, b = P('Burster'), P('Wall')
    await a.start('tdm')
    await b.start('tdm')
    await phase(a, 'live', 15)
    await settle(a, a, b)
    b.move([a.pos[0] + 3, 0, a.pos[2]])
    await asyncio.sleep(0.3)
    # five SMG hits sent in the same instant: 120 damage, a kill
    a.shoot(b, 5, 'smg')
    await wait(lambda: a.saw('kill'), 3, 'a kill from a bunched burst')
    print('burst ok: five bunched hits all counted')
    a.ws.w.close()
    b.ws.w.close()


async def main():
    mx, tm = const('MAX_PLAYERS'), const('TEAM_MAX')
    assert mx == 20 and tm == 10, 'rooms should hold 20, %d a side' % tm
    print('rooms ok: %d players, %d a side' % (mx, tm))
    await test_knife()
    await test_slug()
    await test_assist()
    await test_burst()
    print('all passed')


if __name__ == '__main__':
    asyncio.get_event_loop().run_until_complete(main())
