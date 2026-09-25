#!/usr/bin/env python3
"""
The Battle Pass on a server with accounts: a signed-in player's kills count on
the server and come back as pass progress with the locker; the owner has the lot.

    ACCOUNTS=1 DATA_DIR=/tmp/souk-pass python3 server/server.py 8769 &   # then:
    python3 tools/test_pass.py
"""

import asyncio
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import test_server  # noqa: E402
test_server.URL = 'ws://localhost:8769/ws'
from bot import WS  # noqa: E402
from test_server import P, phase, wait  # noqa: E402


async def signed(name, username):
    p = P(name)
    p.ws = await WS.connect(test_server.URL)
    p.ws.send({'t': 'hello', 'name': name, 'v': '3.2.0', 'dev': 'dev' + username + '0000000000000'})
    p.ws.send({'t': 'signup', 'username': username, 'email': username + '@example.com', 'password': 'a long enough password'})
    asyncio.ensure_future(p.read())
    await wait(lambda: any(m.get('t') == 'auth' and m.get('user') for m in p.msgs), 8, name + ' signed in')
    return p


async def main():
    a = await signed('Killer', 'passtester')
    b = P('Victim')
    a.ws.send({'t': 'join', 'mode': 'tdm', 'ld': 0, 'map': 'town'})
    await b.start('tdm')
    await phase(a, 'live', 20)
    await asyncio.sleep(1.8)
    b.move([a.pos[0] + 3, 0, a.pos[2]])
    await asyncio.sleep(0.3)
    for _ in range(4):
        a.shoot(b)
        await asyncio.sleep(0.12)
    await wait(lambda: a.saw('kill'), 3, 'a kill')
    await wait(lambda: any(m.get('t') == 'pass' for m in a.msgs), 3, 'pass progress')
    pm = [m for m in a.msgs if m.get('t') == 'pass'][-1]
    assert pm['k'] == 1 and pm['new'] == [] and pm['locker']['pass'] == 1 and pm['locker']['kills'].get('smg') == 1, pm
    print('pass ok: the kill counted on the server, for the gun and the pass')
    # the owner: everything, straight away
    o = await signed('Boss', 'mcb')
    auth = [m for m in o.msgs if m.get('t') == 'auth' and m.get('user')][-1]
    lk = auth['locker']
    assert lk['pass'] >= 350 and 'knife:bat' in lk['guns'] and 'knife:cane' in lk['guns'] and 'sahur' in lk['muzzles']
    assert all(x in lk['outfits'] for x in ('sahur', 'ballerina', 'tunggod')) and 'carbine:porcelain' in lk['guns'], lk['outfits']
    print('owner ok: the whole pass on sign-in')
    print('all passed')
    a.ws.w.close(); b.ws.w.close(); o.ws.w.close()


if __name__ == '__main__':
    asyncio.get_event_loop().run_until_complete(main())
