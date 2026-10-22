#!/usr/bin/env python3
"""
The carpet bombing: a server on 8793 with every streak free and the warning shortened,
one player calls it in, one stands on the line and dies to it, one stands beside the
swath and lives. Prints RESULT lines; the last is 'all ok'.
"""

import asyncio
import math
import os
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PORT = 8793
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, 'server'))
from bot import WS  # noqa: E402

URL = 'ws://localhost:%d/ws' % PORT


class C:
    def __init__(self, name):
        self.name, self.msgs, self.id, self.sc, self.pos, self.alive, self.g = name, [], 0, 0, [0, 0, 0], False, {}

    async def connect(self):
        self.ws = await WS.connect(URL)
        self.ws.send({'t': 'hello', 'name': self.name, 'v': '2.0.0'})
        asyncio.ensure_future(self.read())
        await wait(lambda: self.id, 4, 'welcome')
        return self

    async def read(self):
        while True:
            try:
                m = await self.ws.recv()
            except Exception:
                return
            if not m:
                continue
            self.msgs.append(m)
            t = m['t']
            if t == 'welcome':
                self.id = m['id']
            elif t == 'spawn':
                self.sc, self.pos, self.alive = m['sc'], m['p'], True
            elif t == 'dead':
                self.alive = False
            elif t == 'snap':
                self.g = m['g']

    def send(self, m):
        self.ws.send(m)

    def stand(self, x, z, y=0.0):
        self.pos = [x, y, z]
        self.send({'t': 'st', 'p': [x, y, z], 'y': 0, 'pi': 0, 'f': 0, 'sl': 0, 'sc': self.sc})

    def last(self, t, pred=lambda m: True):
        for m in reversed(self.msgs):
            if m['t'] == t and pred(m):
                return m
        return None


async def wait(cond, timeout, what):
    end = time.time() + timeout
    while time.time() < end:
        v = cond()
        if v:
            return v
        await asyncio.sleep(0.05)
    print('RESULT timeout waiting for', what)
    return None


async def main():
    env = dict(os.environ, DATA_DIR='/tmp/souk-carpet-data', ACCOUNTS='0', BOT_FILL='0', SOUK_DUMMIES='0', SOUK_NIGHT='0',
               SOUK_STREAK_FREE='1', SOUK_STREAK='0.25', SOUK_IDLE='999')
    srv = subprocess.Popen([sys.executable, '-u', os.path.join(ROOT, 'server', 'server.py'), str(PORT)], env=env,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(60):
            try:
                urllib.request.urlopen('http://localhost:%d/healthz' % PORT, timeout=1)
                break
            except Exception:
                await asyncio.sleep(1)
        a, b, c = await C('Caller').connect(), await C('OnLine').connect(), await C('Beside').connect()
        for p in (a, b, c):
            p.send({'t': 'join', 'mode': 'ffa', 'ld': 0})
        await wait(lambda: a.g.get('ph') == 'live', 25, 'live')
        await wait(lambda: a.alive and b.alive and c.alive, 10, 'spawns')
        await asyncio.sleep(4.5)      # spawn protection and the afk guard
        for p in (a, b, c):
            p.stand(p.pos[0], p.pos[2], p.pos[1])
        await asyncio.sleep(0.5)
        a.send({'t': 'streak', 'k': 'carpet'})
        m = await wait(lambda: b.last('carpet'), 4, 'the carpet message')
        ok = bool(m)
        print('RESULT carpet message', 'ok' if m else 'MISSING', m and (m['a'], m['b'], m['in'], m['v']))
        ax, az = m['a']
        bx, bz = m['b']
        L = math.hypot(bx - ax, bz - az)
        dx, dz = (bx - ax) / L, (bz - az) / L
        mx, mz = ax + dx * L / 2, az + dz * L / 2
        # the victim on the line at its middle, the bystander twenty metres to its side, and the
        # caller well off it too (the line is random; the caller is spared anyway)
        for _ in range(6):
            b.stand(mx, mz)
            c.stand(mx - dz * 20, mz + dx * 20)
            a.stand(mx - dz * 30, mz + dx * 30)
            await asyncio.sleep(0.25)
        t_mid = m['in'] + (L / 2) / m['v']
        dead = await wait(lambda: not b.alive, t_mid + 3, 'the victim dying')
        print('RESULT on the line dies', 'ok' if dead else 'FAIL')
        ok = ok and bool(dead)
        ev = a.last('ev', lambda e: e.get('e') == 'kill' and e.get('w') == 'carpet') or a.last('ev', lambda e: e.get('e') == 'kill')
        feed = None
        for mm in a.msgs:
            if mm.get('e') == 'kill' and mm.get('w') == 'carpet':
                feed = mm
        print('RESULT kill feed says carpet', 'ok' if feed else 'FAIL', feed or ev)
        ok = ok and bool(feed)
        await asyncio.sleep(L / m['v'] + 1.5)
        print('RESULT beside the swath lives', 'ok' if c.alive else 'FAIL', 'caller lives', 'ok' if a.alive else 'FAIL')
        ok = ok and c.alive and a.alive
        print('RESULT', 'all ok' if ok else 'FAILED')
    finally:
        srv.terminate()


if __name__ == '__main__':
    asyncio.run(main())
