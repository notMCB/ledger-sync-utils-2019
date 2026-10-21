#!/usr/bin/env python3
"""
Changing a username or password (3.7.1): the accounts module on its own, then
the whole thing through a running server, with the code read back from the
mailer's outbox (GET /__mail, localhost only).

    python3 tools/test_account.py
"""

import asyncio
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = '/tmp/souk-account-test'
PORT = 8789
sys.path.insert(0, HERE)
from bot import WS  # noqa: E402


def module_tests():
    sys.path.insert(0, os.path.join(ROOT, 'server'))
    import accounts
    user, token = accounts.signup('oldname', 'old@example.com', 'first-password')
    uid = user['id']
    other, _ = accounts.signup('taken', 'taken@example.com', 'first-password')
    for kind, value, pw, msg in (('username', 'newname', 'wrong', 'Wrong password.'),
                                 ('username', 'taken', 'first-password', 'taken'),
                                 ('username', 'TAKEN', 'first-password', 'taken'),
                                 ('username', 'player', 'first-password', 'nobody'),
                                 ('username', 'oldname', 'first-password', 'already'),
                                 ('username', 'x', 'first-password', '3–16'),
                                 ('password', 'short', 'first-password', 'at least 8'),
                                 ('password', 'first-password', 'first-password', 'already'),
                                 ('email', 'a@b.co', 'first-password', 'Nothing to change')):
        try:
            accounts.start_change(uid, kind, value, pw)
            raise SystemExit('accepted a bad change: %r' % ((kind, value, pw),))
        except accounts.AuthError as e:
            assert msg in str(e), (kind, value, str(e))
    print('  ok   bad changes refused: wrong password, taken (any case), "player", unchanged, too short')
    try:
        accounts.confirm_change(uid, '000000')
        raise SystemExit('confirmed with nothing pending')
    except accounts.AuthError as e:
        assert 'Nothing' in str(e)
    ch = accounts.start_change(uid, 'username', 'newname', 'first-password')
    assert ch['email'] == 'old@example.com' and ch['code'].isdigit() and len(ch['code']) == 6
    wrong = '%06d' % ((int(ch['code']) + 1) % 1000000)
    for i in range(accounts.CODE_TRIES):
        try:
            accounts.confirm_change(uid, wrong)
            raise SystemExit('a wrong code went through')
        except accounts.AuthError as e:
            assert 'Wrong code' in str(e) or 'run out' in str(e), str(e)
    try:
        accounts.confirm_change(uid, ch['code'])
        raise SystemExit('the right code worked after too many wrong ones')
    except accounts.AuthError as e:
        assert 'run out' in str(e), str(e)
    assert accounts.resume(token)['username'] == 'oldname'
    print('  ok   five wrong codes throw the change away, even for the right code after')
    ch = accounts.start_change(uid, 'username', 'newname', 'first-password')
    kind, u = accounts.confirm_change(uid, ch['code'])
    assert kind == 'username' and u['username'] == 'newname'
    assert accounts.resume(token)['username'] == 'newname', 'the session carries on'
    assert accounts.login('newname', 'first-password')[0]['id'] == uid
    try:
        accounts.login('oldname', 'first-password')
        raise SystemExit('the old name still signs in')
    except accounts.AuthError:
        pass
    assert accounts.signup('oldname', 'again@example.com', 'first-password')[0]['username'] == 'oldname', 'the old name is free again'
    print('  ok   the right code renames the account; the old name no longer signs in and is free')
    # a stale code
    ch = accounts.start_change(uid, 'username', 'thirdname', 'first-password')
    with accounts._lock:
        accounts.db().execute('UPDATE changes SET expires = ? WHERE user_id = ?', (time.time() - 1, uid))
        accounts.db().commit()
    try:
        accounts.confirm_change(uid, ch['code'])
        raise SystemExit('an expired code worked')
    except accounts.AuthError as e:
        assert 'run out' in str(e)
    print('  ok   a code older than %d minutes is refused' % accounts.CODE_MINUTES)
    # the password, keeping this session and dropping the others
    _, other_token = accounts.login('newname', 'first-password')
    ch = accounts.start_change(uid, 'password', 'second-password', 'first-password')
    kind, u = accounts.confirm_change(uid, ch['code'], keep_token=token)
    assert kind == 'password'
    assert accounts.resume(token) and not accounts.resume(other_token), 'this device stays signed in, the other is out'
    assert accounts.login('newname', 'second-password')[0]['id'] == uid
    try:
        accounts.login('newname', 'first-password')
        raise SystemExit('the old password still works')
    except accounts.AuthError:
        pass
    print('  ok   a new password: old one dead, this session kept, other sessions signed out')
    # starting again replaces what was pending
    a = accounts.start_change(uid, 'username', 'fourth', 'second-password')
    b = accounts.start_change(uid, 'username', 'fifth', 'second-password')
    try:
        accounts.confirm_change(uid, a['code'])
        assert a['code'] == b['code'], 'the first code should be dead'
    except accounts.AuthError:
        pass
    kind, u = accounts.confirm_change(uid, b['code'])
    assert u['username'] == 'fifth'
    print('  ok   starting again replaces the pending change')


async def server_tests():
    env = dict(os.environ, DATA_DIR=DATA, ACCOUNTS='1', BOT_FILL='0')
    env.pop('RESEND_API_KEY', None)
    env.pop('SMTP_HOST', None)
    srv = subprocess.Popen([sys.executable, '-u', os.path.join(ROOT, 'server', 'server.py'), str(PORT)], env=env,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(300):       # the server builds its maps first: a dozen seconds or more
            try:
                urllib.request.urlopen('http://localhost:%d/healthz' % PORT, timeout=1)
                break
            except Exception:
                await asyncio.sleep(0.2)
        ws = await WS.connect('ws://localhost:%d/ws' % PORT)

        async def expect(*types, timeout=8):
            end = time.time() + timeout
            while time.time() < end:
                m = await asyncio.wait_for(ws.recv(), end - time.time())
                if m and m.get('t') in types:
                    return m
            raise SystemExit('no %r' % (types,))
        ws.send({'t': 'hello', 'name': 'Tester', 'v': '0'})
        ws.send({'t': 'signup', 'username': 'socket_user', 'email': 'socket@example.com', 'password': 'first-password'})
        m = await expect('auth', 'autherr')
        assert m['t'] == 'auth' and m['user']['username'] == 'socket_user', m
        token = m['token']
        ws.send({'t': 'change', 'kind': 'username', 'value': 'socket_two', 'password': 'nope'})
        m = await expect('change', 'autherr')
        assert m['t'] == 'autherr' and 'Wrong password' in m['m'], m
        ws.send({'t': 'change', 'kind': 'username', 'value': 'socket_two', 'password': 'first-password'})
        m = await expect('change', 'autherr')
        assert m['t'] == 'change' and m['to'] == 's•••@example.com' and m['kind'] == 'username', m
        mail = json.load(urllib.request.urlopen('http://localhost:%d/__mail' % PORT))
        assert mail and mail[-1]['to'] == 'socket@example.com' and 'username' in mail[-1]['text'], mail
        code = mail[-1]['subject'].split(': ')[-1]
        assert code.isdigit() and len(code) == 6, mail[-1]
        print('  ok   over the socket: wrong password refused; a code goes to the masked address')
        ws.send({'t': 'confirm', 'code': '%06d' % ((int(code) + 1) % 1000000), 'token': token})
        m = await expect('changed', 'autherr')
        assert m['t'] == 'autherr' and 'Wrong code' in m['m'], m
        ws.send({'t': 'confirm', 'code': code, 'token': token})
        m = await expect('changed', 'autherr')
        assert m['t'] == 'changed' and m['kind'] == 'username' and m['user']['username'] == 'socket_two', m
        print('  ok   a wrong code is refused, the right one renames the account')
        # the new name is what the room sees
        ws.send({'t': 'join', 'mode': 'ffa'})
        m = await expect('roster', timeout=8)
        names = json.dumps(m['pl'])
        assert 'socket_two' in names and 'socket_user' not in names, names[:300]
        print('  ok   the room roster shows the new name')
        # a fresh connection: the old session token still resumes, with the new name
        ws2 = await WS.connect('ws://localhost:%d/ws' % PORT)
        ws2.send({'t': 'hello', 'name': 'Tester', 'v': '0'})
        ws2.send({'t': 'resume', 'token': token})
        end = time.time() + 6
        while time.time() < end:
            m = await asyncio.wait_for(ws2.recv(), 6)
            if m and m.get('t') == 'auth':
                break
        assert m['user']['username'] == 'socket_two', m
        # and the password, through the socket, signing ws2's session out
        ws.send({'t': 'change', 'kind': 'password', 'value': 'second-password', 'password': 'first-password'})
        m = await expect('change', 'autherr')
        assert m['t'] == 'change' and m['kind'] == 'password', m
        mail = json.load(urllib.request.urlopen('http://localhost:%d/__mail' % PORT))
        code = mail[-1]['subject'].split(': ')[-1]
        ws.send({'t': 'confirm', 'code': code, 'token': token})
        m = await expect('changed', 'autherr')
        assert m['t'] == 'changed' and m['kind'] == 'password', m
        ws3 = await WS.connect('ws://localhost:%d/ws' % PORT)
        ws3.send({'t': 'hello', 'name': 'Tester', 'v': '0'})
        ws3.send({'t': 'login', 'id': 'socket_two', 'password': 'second-password'})
        end = time.time() + 6
        while time.time() < end:
            m = await asyncio.wait_for(ws3.recv(), 6)
            if m and m.get('t') in ('auth', 'autherr'):
                break
        assert m['t'] == 'auth' and m['user']['username'] == 'socket_two', m
        print('  ok   the password changes over the socket and the new one signs in')
    finally:
        srv.terminate()
        srv.wait()


def main():
    shutil.rmtree(DATA, ignore_errors=True)
    os.makedirs(DATA)
    os.environ['DATA_DIR'] = DATA
    module_tests()
    shutil.rmtree(DATA, ignore_errors=True)
    os.makedirs(DATA)
    asyncio.get_event_loop().run_until_complete(server_tests())
    shutil.rmtree(DATA, ignore_errors=True)
    print('all ok')


if __name__ == '__main__':
    main()
