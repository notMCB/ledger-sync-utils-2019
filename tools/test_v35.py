#!/usr/bin/env python3
"""
3.5.0: voice chat signalling. The server passes an 'rtc' message to the player
it names, in the same room, and nowhere else.

    ACCOUNTS=0 python3 server/server.py 8782 &   # then:
    python3 tools/test_v35.py
"""

import asyncio
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import test_server  # noqa: E402
from test_server import P, wait  # noqa: E402

test_server.URL = os.environ.get('SOUK_URL', 'ws://localhost:8782/ws')


async def main():
    a, b, c = P('Va'), P('Vb'), P('Vc')
    await a.start('ffa')
    await b.start('ffa')
    await c.start('tdm')
    await wait(lambda: a.id and b.id and c.id and a.map and b.map and c.map, 10, 'everyone in')
    a.ws.send({'t': 'rtc', 'to': b.id, 'd': {'sdp': {'type': 'offer', 'sdp': 'v=0 test'}}})
    await wait(lambda: [m for m in b.msgs if m['t'] == 'rtc'], 3, 'the offer relayed')
    m = [m for m in b.msgs if m['t'] == 'rtc'][0]
    assert m['from'] == a.id and m['d']['sdp']['sdp'] == 'v=0 test', m
    print('  ok   a signal reaches the player it is for, marked with who sent it')
    a.ws.send({'t': 'rtc', 'to': c.id, 'd': {'ice': {'candidate': 'x'}}})
    a.ws.send({'t': 'rtc', 'to': a.id, 'd': {'ice': {'candidate': 'me'}}})
    a.ws.send({'t': 'rtc', 'to': b.id, 'd': 'not a dict'})
    await asyncio.sleep(0.6)
    assert not [m for m in c.msgs if m['t'] == 'rtc'], 'another room gets nothing'
    assert not [m for m in a.msgs if m['t'] == 'rtc'], 'nothing comes back to yourself'
    assert len([m for m in b.msgs if m['t'] == 'rtc']) == 1, 'junk is dropped'
    print('  ok   signals never cross rooms, never echo, and junk is dropped')
    a.ws.w.close(); b.ws.w.close(); c.ws.w.close()
    print('all ok')


if __name__ == '__main__':
    asyncio.run(main())
