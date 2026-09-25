#!/usr/bin/env python3
"""
Bans against a running server started with SOUK_BANS=berry and accounts on:
the seeded name is turned away, the ban follows the device to a new name,
the owner's chat commands ban, list and unban, and nobody else may use them.

    SOUK_BANS=berry ACCOUNTS=1 DATA_DIR=/tmp/souk-bans python3 server/server.py 8768 &   # then:
    python3 tools/test_bans.py
"""

import asyncio
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import test_server  # noqa: E402
test_server.URL = 'ws://localhost:8768/ws'
from bot import WS  # noqa: E402
from test_server import P, wait  # noqa: E402


async def hello(name, dev, join=False):
    """Connect, say hello (and join a room), and collect what comes back for a moment."""
    ws = await WS.connect(test_server.URL)
    ws.send({'t': 'hello', 'name': name, 'v': '3.0.2', 'dev': dev})
    if join:
        ws.send({'t': 'join', 'mode': 'ffa'})
    got = []
    async def read():
        try:
            while True:
                m = await ws.recv()
                if m is None:
                    return
                got.append(m)
        except Exception:
            return
    task = asyncio.ensure_future(read())
    await asyncio.sleep(1.0)
    return ws, got, task


def kinds(got):
    return [m.get('t') for m in got]


async def main():
    # the seeded name is shut out, and its device is learnt
    ws, got, _ = await hello('Berry', 'cheatdevice000000000001')
    assert 'banned' in kinds(got) and 'welcome' not in kinds(got), kinds(got)
    ws.w.close()
    # the same device with a new name is shut out too
    ws, got, _ = await hello('Innocent', 'cheatdevice000000000001')
    assert 'banned' in kinds(got), kinds(got)
    ws.w.close()
    # a different device and name is fine
    ws, got, _ = await hello('Someone', 'cleandevice00000000000a')
    assert 'welcome' in kinds(got) and 'banned' not in kinds(got), kinds(got)
    ws.w.close()
    print('seeded ban ok: the name, then the device under another name')

    # the owner, signed in, bans a player who is in a match
    owner = P('Owner')
    owner.ws = await WS.connect(test_server.URL)
    owner.ws.send({'t': 'hello', 'name': 'Owner', 'v': '3.0.2', 'dev': 'ownerdevice000000000001'})
    owner.ws.send({'t': 'signup', 'username': 'mcb', 'email': 'mcb@example.com', 'password': 'a long enough password'})
    asyncio.ensure_future(owner.read())
    await wait(lambda: any(m.get('t') == 'auth' and m.get('user') for m in owner.msgs), 8, 'the owner signed in')
    owner.ws.send({'t': 'join', 'mode': 'ffa'})
    bob_ws, bob_got, bob_task = await hello('Bob', 'bobdevice00000000000001', join=True)
    assert 'joined' in kinds(bob_got), kinds(bob_got)
    await asyncio.sleep(0.8)
    owner.ws.send({'t': 'chat', 'm': '/ban Bob'})
    await asyncio.sleep(1.2)
    assert 'banned' in kinds(bob_got), 'Bob thrown out: %r' % kinds(bob_got)
    sysm = [m['m'] for m in owner.msgs if m.get('t') == 'chat' and m.get('sys')]
    assert sysm and 'banned' in sysm[-1] and 'kicked' in sysm[-1], sysm
    # Bob's device is now banned under any name
    ws, got, _ = await hello('Robert', 'bobdevice00000000000001')
    assert 'banned' in kinds(got), kinds(got)
    ws.w.close()
    owner.ws.send({'t': 'chat', 'm': '/bans'})
    await asyncio.sleep(1.0)
    sysm = [m['m'] for m in owner.msgs if m.get('t') == 'chat' and m.get('sys')]
    assert 'berry' in sysm[-1] and 'bob' in sysm[-1], sysm[-1]
    owner.ws.send({'t': 'chat', 'm': '/unban Bob'})
    await asyncio.sleep(1.0)
    ws, got, _ = await hello('Bob', 'bobdevice00000000000001')
    assert 'welcome' in kinds(got), 'Bob back after the unban: %r' % kinds(got)
    ws.w.close()
    print('owner commands ok: /ban kicked and followed the device, /bans listed, /unban let him back')

    # not for anyone else
    other = P('Other')
    other.ws = await WS.connect(test_server.URL)
    other.ws.send({'t': 'hello', 'name': 'Other', 'v': '3.0.2', 'dev': 'otherdevice00000000000a'})
    other.ws.send({'t': 'join', 'mode': 'ffa'})
    asyncio.ensure_future(other.read())
    await asyncio.sleep(1.0)
    other.ws.send({'t': 'chat', 'm': '/ban Owner'})
    await asyncio.sleep(1.0)
    assert not any(m.get('t') == 'banned' for m in owner.msgs), 'the owner cannot be banned by a player'
    sysm = [m['m'] for m in other.msgs if m.get('t') == 'chat' and m.get('sys')]
    assert sysm and 'owner' in sysm[-1].lower(), sysm
    print('non-owner refused ok')
    # the ban file is on disk
    import json
    with open(os.path.join(os.environ.get('DATA_DIR', '/tmp/souk-bans'), 'bans.json')) as f:
        names = [b['name'] for b in json.load(f)]
    assert 'berry' in names and 'bob' not in names, names
    print('all passed')
    owner.ws.w.close(); other.ws.w.close()


if __name__ == '__main__':
    asyncio.get_event_loop().run_until_complete(main())
