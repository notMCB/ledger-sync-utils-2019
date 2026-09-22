#!/usr/bin/env python3
"""
A test player for Souk Siege: connects to a server, joins a mode, and walks
around so a match has two players. Optional --shoot makes it fire at the
nearest enemy now and then (hitting about a third of the time).

    python3 tools/bot.py --mode tdm [--url ws://localhost:8765/ws] [--count 3] [--shoot]
"""

import argparse
import asyncio
import base64
import json
import math
import os
import random
import struct
import urllib.parse


class WS:
    def __init__(self, reader, writer):
        self.r, self.w = reader, writer

    @classmethod
    async def connect(cls, url):
        u = urllib.parse.urlsplit(url)
        reader, writer = await asyncio.open_connection(u.hostname, u.port or 80)
        key = base64.b64encode(os.urandom(16)).decode()
        writer.write(('GET %s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                      'Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n' % (u.path or '/', u.netloc, key)).encode())
        await reader.readuntil(b'\r\n\r\n')
        return cls(reader, writer)

    def send(self, obj):
        data = json.dumps(obj).encode()
        mask = os.urandom(4)
        n = len(data)
        head = struct.pack('!B', 0x81)
        if n < 126:
            head += struct.pack('!B', 0x80 | n)
        elif n < 65536:
            head += struct.pack('!BH', 0x80 | 126, n)
        else:
            head += struct.pack('!BQ', 0x80 | 127, n)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
        self.w.write(head + mask + masked)

    async def recv(self):
        h = await self.r.readexactly(2)
        ln = h[1] & 0x7F
        if ln == 126:
            ln = struct.unpack('!H', await self.r.readexactly(2))[0]
        elif ln == 127:
            ln = struct.unpack('!Q', await self.r.readexactly(8))[0]
        data = await self.r.readexactly(ln)
        return json.loads(data) if (h[0] & 0x0F) == 1 else None


async def bot(n, args):
    ws = await WS.connect(args.url)
    ws.send({'t': 'hello', 'name': 'Bot %d' % (n + 1), 'v': args.version})
    outfits = ['sultan', 'crimson', 'midnight', 'zelligeguard', 'tigercamo', 'nomad', 'mirage']
    finishes = ['gilded', 'zellige', 'neon', 'tiger', 'damascus', 'mirage']
    ws.send({'t': 'join', 'mode': args.mode, 'ld': (args.ld if args.ld >= 0 else n % 4),
             'cos': {'o': outfits[n % len(outfits)], 'g': {'smg': finishes[n % len(finishes)]}}})
    st = {'pos': [0, 0, 0], 'sc': 0, 'alive': False, 'id': 0, 'team': -1, 'yaw': 0.0, 'others': {}, 'teams': {}, 'phase': ''}

    async def reader():
        while True:
            m = await ws.recv()
            if not m:
                continue
            t = m.get('t')
            if t == 'welcome':
                st['id'] = m['id']
            elif t == 'spawn':
                st['pos'] = m['p']
                st['sc'] = m['sc']
                st['alive'] = True
                st['yaw'] = m['y']
                st['team'] = m['tm']
                print('bot %d spawned at %s' % (n + 1, [round(v, 1) for v in m['p']]), flush=True)
            elif t == 'dead':
                st['alive'] = False
                print('bot %d died (by %s)' % (n + 1, m.get('byn')), flush=True)
            elif t == 'snap':
                st['phase'] = m['g']['ph']
                st['others'] = {p[0]: p for p in m['p'] if p[0] != st['id'] and p[6] & 1}
            elif t == 'roster':
                st['teams'] = {p['id']: p['tm'] for p in m['pl']}
                st['names'] = {p['id']: p['n'] for p in m['pl']}
            elif t == 'ev' and m.get('e') in ('kill', 'roundend', 'matchend', 'planted'):
                print('bot %d saw event %s' % (n + 1, m), flush=True)

    asyncio.ensure_future(reader())
    t = 0.0
    home = None
    while True:
        await asyncio.sleep(0.05)
        t += 0.05
        if not st['alive']:
            home = None
            continue
        if home is None:
            home = list(st['pos'])
        # wander in a small loop near the spawn
        r = 2.5
        a = t * 0.8 + n
        p = [home[0] + math.cos(a) * r, 0.0, home[2] + math.sin(a) * r]
        yaw = -a
        humans = [o for o in st['others'].values() if not st.get('names', {}).get(o[0], 'Bot').startswith('Bot')]
        if args.follow and humans:
            o = humans[0]
            fy = o[4]
            d = 6 + (n // 4) * 3
            side = (n % 4 - 1.5) * 1.6 if args.count > 1 else math.sin(t * 0.9) * 2.5
            p = [o[1] - math.sin(fy) * d + math.cos(fy) * side, o[2], o[3] - math.cos(fy) * d - math.sin(fy) * side]
            yaw = math.atan2(p[0] - o[1], p[2] - o[3]) + (math.pi if args.away else 0)
        st['pos'] = p
        ws.send({'t': 'st', 'p': p, 'y': yaw, 'pi': 0, 'f': 4, 'sl': 0, 'sc': st['sc']})
        if args.shoot and random.random() < 0.02 and st['others']:
            my_team = st['team']
            enemies = [o for o in st['others'].values() if my_team < 0 or st['teams'].get(o[0], -2) != my_team or st['phase'] in ('waiting', 'countdown')]
            if enemies:
                e = min(enemies, key=lambda o: math.hypot(o[1] - p[0], o[3] - p[2]))
                hit = random.random() < 0.35
                ws.send({'t': 'shot', 'w': 'pistol', 'o': [p[0], 1.5, p[2]], 'e': [[e[1], e[2] + 1.2, e[3]]],
                         'h': [[e[0], 'b']] if hit else []})


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='ws://localhost:8765/ws')
    ap.add_argument('--mode', default='tdm')
    ap.add_argument('--count', type=int, default=1)
    ap.add_argument('--shoot', action='store_true')
    ap.add_argument('--follow', action='store_true', help='stand in front of the nearest player (for screenshots)')
    ap.add_argument('--version', default='2.0.0')
    ap.add_argument('--away', action='store_true', help='with --follow, stand with your back to them')
    ap.add_argument('--ld', type=int, default=-1, help='loadout for every bot (default: one of each)')
    args = ap.parse_args()
    await asyncio.gather(*(bot(i, args) for i in range(args.count)))


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
