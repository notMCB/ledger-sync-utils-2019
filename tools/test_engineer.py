#!/usr/bin/env python3
"""
The Engineer: a server on 8794, one Engineer with the RPG and anti-tank grenades,
one victim. A rocket's direct hit kills; a mine laid on the ground kills the one who
steps on it; a mine under a driven vehicle wrecks it and kills the driver. Prints
RESULT lines; the last is 'all ok'.
"""

import asyncio
import os
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PORT = 8794
sys.path.insert(0, HERE)
from bot import WS  # noqa: E402

URL = 'ws://localhost:%d/ws' % PORT


class C:
    def __init__(self, name):
        self.name, self.msgs, self.id, self.sc, self.pos, self.alive, self.g, self.map = name, [], 0, 0, [0, 0, 0], False, {}, None
        self.perk_left = None

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
            elif t == 'map':
                self.map = m['map']
            elif t == 'perkleft':
                self.perk_left = m['n']

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

    def kill_by(self, w):
        return next((m for m in self.msgs if m.get('e') == 'kill' and m.get('w') == w), None)


async def wait(cond, timeout, what):
    end = time.time() + timeout
    while time.time() < end:
        v = cond()
        if v:
            return v
        await asyncio.sleep(0.05)
    print('RESULT timeout waiting for', what)
    return None


async def settle(*ps):
    """Past spawn protection and the afk guard, standing where they are."""
    await wait(lambda: all(p.alive for p in ps), 12, 'spawns')
    await asyncio.sleep(4.5)
    for p in ps:
        p.stand(p.pos[0], p.pos[2], p.pos[1])
    await asyncio.sleep(0.3)


async def main():
    env = dict(os.environ, SOUK_FREE_NAMES='1', DATA_DIR='/tmp/souk-eng-data', ACCOUNTS='0', BOT_FILL='0', SOUK_DUMMIES='0', SOUK_NIGHT='0', SOUK_IDLE='999')
    srv = subprocess.Popen([sys.executable, '-u', os.path.join(ROOT, 'server', 'server.py'), str(PORT)], env=env,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    ok = True
    try:
        for _ in range(60):
            try:
                urllib.request.urlopen('http://localhost:%d/healthz' % PORT, timeout=1)
                break
            except Exception:
                await asyncio.sleep(1)
        a, b, c = await C('Engineer').connect(), await C('Victim').connect(), await C('Sapper').connect()
        a.send({'t': 'join', 'mode': 'ffa', 'ld': 4, 'pk': 'rpg', 'nk': 'atnade', 'map': 'dock'})
        b.send({'t': 'join', 'mode': 'ffa', 'ld': 0})
        c.send({'t': 'join', 'mode': 'ffa', 'ld': 4, 'pk': 'mines'})
        await wait(lambda: a.g.get('ph') == 'live', 25, 'live')
        await settle(a, b, c)
        print('RESULT map', a.map and a.map.get('kind'), 'engineer loadout accepted', 'ok' if a.last('spawn') and a.last('spawn').get('ld') == 4 else 'FAIL')
        ok = ok and a.last('spawn').get('ld') == 4
        # the rocket: a direct hit on the victim, reported like the client would
        ax, az = a.pos[0], a.pos[2]
        b.stand(ax + 6, az)
        await asyncio.sleep(0.3)
        a.send({'t': 'nade', 'n': 1, 'k': 'rocket', 'r': 1, 'o': [ax, 1.5, az], 'v': [75, 0, 0]})
        got = await wait(lambda: a.perk_left == 2, 3, 'a rocket used')
        print('RESULT rocket counted against the perk', 'ok' if got else 'FAIL', a.perk_left)
        ok = ok and bool(got)
        a.send({'t': 'boom', 'n': 1, 'p': [ax + 6, 1.0, az], 'h': b.id})
        dead = await wait(lambda: not b.alive, 3, 'the victim dying to the rocket')
        k = a.kill_by('rpg')
        print('RESULT direct hit kills', 'ok' if dead and k else 'FAIL', k and (k['kn'], k['vn'], k['w']))
        ok = ok and bool(dead and k)
        # a mine: laid at the sapper's feet, the victim walks onto it once back
        await settle(a, b, c)
        ax, az = c.pos[0], c.pos[2]
        c.send({'t': 'perk', 'k': 'mines', 'p': [ax + 1.5, c.pos[1], az]})
        mine = await wait(lambda: b.last('mine', lambda m: not m.get('off')), 3, 'a mine')
        print('RESULT mine laid', 'ok' if mine else 'FAIL', mine and mine['p'])
        ok = ok and bool(mine)
        b.stand(ax + 12, az)
        await asyncio.sleep(2.0)
        for _ in range(8):
            b.stand(mine['p'][0], mine['p'][2], mine['p'][1])
            await asyncio.sleep(0.2)
        dead = await wait(lambda: not b.alive, 4, 'the victim dying to the mine')
        k = c.kill_by('mine')
        gone = b.last('mine', lambda m: m.get('off'))
        print('RESULT mine kills the one who steps on it', 'ok' if dead and k and gone else 'FAIL')
        ok = ok and bool(dead and k and gone)
        # a vehicle: the victim drives a forklift over a mine
        await settle(a, b, c)
        fk = next((d for d in a.map['deco'] if d['k'] in ('forklift', 'golfcart') and 'id' in d), None)
        print('RESULT a vehicle to wreck', 'ok' if fk else 'FAIL', fk and fk['k'])
        ok = ok and bool(fk)
        if fk:
            for _ in range(5):
                b.stand(fk['x'] + 1.5, fk['z'], fk.get('y', 0))
                c.stand(fk['x'] - 1.5, fk['z'], fk.get('y', 0))
                await asyncio.sleep(0.2)
            b.send({'t': 'fkin', 'id': fk['id']})
            drv = await wait(lambda: b.last('fk', lambda m: m.get('id') == fk['id'] and m.get('driver') == b.id), 3, 'the victim at the wheel')
            print('RESULT victim driving', 'ok' if drv else 'FAIL')
            c.send({'t': 'perk', 'k': 'mines', 'p': [fk['x'], fk.get('y', 0), fk['z']]})
            wreck = await wait(lambda: c.last('fk', lambda m: m.get('id') == fk['id'] and m.get('dead') == 1), 5, 'the wreck')
            dead = await wait(lambda: not b.alive, 3, 'the driver dying')
            print('RESULT mine wrecks a driven vehicle and kills the driver', 'ok' if wreck and dead else 'FAIL')
            ok = ok and bool(wreck and dead)
            # and the wreck cannot be driven
            await settle(a, b, c)
            b.stand(fk['x'] + 1.5, fk['z'], fk.get('y', 0))
            await asyncio.sleep(0.3)
            n0 = len([m for m in b.msgs if m['t'] == 'fk' and m.get('driver') == b.id])
            b.send({'t': 'fkin', 'id': fk['id']})
            await asyncio.sleep(1.0)
            n1 = len([m for m in b.msgs if m['t'] == 'fk' and m.get('driver') == b.id])
            print('RESULT a wreck refuses a driver', 'ok' if n1 == n0 else 'FAIL')
            ok = ok and n1 == n0
        print('RESULT', 'all ok' if ok else 'FAILED')
    finally:
        srv.terminate()


if __name__ == '__main__':
    asyncio.run(main())
