#!/usr/bin/env python3
"""
Accounts against a running server started with accounts on:

    ACCOUNTS=1 DATA_DIR=/tmp/souk-test python3 server/server.py 8765 &
    python3 tools/test_accounts.py

Signs up with a username, email and password, signs out and back in, and
checks the locker comes back; and that the owner's account gets its grant.
"""

import asyncio
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from test_server import P, wait  # noqa: E402


def last(p, t):
    ms = [m for m in p.msgs if m.get('t') == t]
    return ms[-1] if ms else None


async def fresh(name):
    p = P(name)
    p.ws = await __import__('test_server').WS.connect(__import__('test_server').URL)
    p.ws.send({'t': 'hello', 'name': name, 'v': '2.0.0'})
    asyncio.ensure_future(p.read())
    await wait(lambda: last(p, 'welcome'), 5, 'welcome')
    assert last(p, 'welcome').get('acc') is not False, 'server should offer accounts'
    return p


async def main():
    tag = random.randrange(10 ** 6)
    user, email, pw = 'tester%d' % tag, 'tester%d@example.com' % tag, 'longenough1'
    a = await fresh('Guest')
    # a bad sign-up is refused with a message
    a.ws.send({'t': 'signup', 'username': user, 'email': 'nope', 'password': pw})
    await wait(lambda: last(a, 'autherr'), 5, 'a refusal for a bad email')
    a.ws.send({'t': 'signup', 'username': user, 'email': email, 'password': pw})
    await wait(lambda: last(a, 'auth') and last(a, 'auth').get('user'), 5, 'sign-up')
    m = last(a, 'auth')
    assert m['user']['username'] == user and m['user']['email'] == email and m.get('token'), m
    lk = m['locker']
    # buy nothing, but change an equip so there's progress to keep
    a.ws.send({'t': 'equip', 'equip': {'outfit': 'standard', 'nade': {'1': 'smoke'}, 'perk': {'1': 'wall'}}})
    await wait(lambda: last(a, 'locker'), 5, 'the saved locker')
    assert last(a, 'locker')['locker']['equip']['nade']['1'] == 'smoke'
    a.ws.w.close()
    print('signup ok: username, email and password; bad email refused')

    b = await fresh('Guest2')
    b.ws.send({'t': 'login', 'id': email, 'password': 'wrongwrong'})
    await wait(lambda: last(b, 'autherr'), 5, 'a refusal for a wrong password')
    b.ws.send({'t': 'login', 'id': email, 'password': pw})
    await wait(lambda: last(b, 'auth') and last(b, 'auth').get('user'), 5, 'sign-in by email')
    lk2 = last(b, 'auth')['locker']
    assert lk2['equip']['nade'].get('1') == 'smoke' and lk2['equip']['perk'].get('1') == 'wall', lk2['equip']
    assert lk2['dinars'] == lk['dinars']
    b.ws.w.close()
    print('login ok: progress came back on another connection')

    c = await fresh('Guest3')
    c.ws.send({'t': 'signup', 'username': 'MCB', 'email': 'mcb%d@example.com' % tag, 'password': 'ownerpass1'})
    await wait(lambda: last(c, 'auth') or last(c, 'autherr'), 5, 'the owner signing up')
    if not (last(c, 'auth') and last(c, 'auth').get('user')):
        # already made on an earlier run: sign in instead
        c.ws.send({'t': 'login', 'id': 'MCB', 'password': 'ownerpass1'})
        await wait(lambda: last(c, 'auth') and last(c, 'auth').get('user'), 5, 'the owner signing in')
    lk3 = last(c, 'auth')['locker']
    assert lk3['dinars'] >= 10000, lk3['dinars']
    for w in ('smg', 'lmg', 'shotgun', 'sniper', 'pistol'):
        assert lk3['kills'].get(w, 0) >= 150, (w, lk3['kills'])
    c.ws.w.close()
    print('owner ok: MCB has 10000 dinars and 150 kills on every gun')
    print('all passed')


if __name__ == '__main__':
    asyncio.get_event_loop().run_until_complete(main())
