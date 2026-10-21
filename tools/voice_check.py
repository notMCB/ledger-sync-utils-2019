#!/usr/bin/env python3
"""
Two headless Chromes with fake microphones, in the same Free for All room on a
local server, standing next to each other: do they connect peer to peer, and
does each hear the other? Headless Chrome refuses microphone prompts, so the
permission is granted over the DevTools protocol before the page opens.

    SOUK_STREAK_FREE=1 ACCOUNTS=0 SOUK_MAP=town python3 server/server.py 8782 &
    python3 tools/voice_check.py [--port 8782]
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import asyncio  # noqa: E402
from bot import WS  # noqa: E402

CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
FLAGS = ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,800',
         '--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--no-first-run',
         '--use-file-for-fake-audio-capture=/tmp/souk-34/tone.wav']


async def cdp(port, origin, url):
    """Grant the microphone for the game's origin, then open the page in a new tab."""
    for _ in range(100):
        try:
            info = json.load(urllib.request.urlopen('http://localhost:%d/json/version' % port, timeout=1))
            break
        except Exception:
            await asyncio.sleep(0.2)
    else:
        raise SystemExit('chrome did not answer on port %d' % port)
    ws = await WS.connect(info['webSocketDebuggerUrl'])
    ws.send({'id': 1, 'method': 'Browser.grantPermissions', 'params': {'origin': origin, 'permissions': ['audioCapture']}})
    while True:
        m = await ws.recv()
        if m and m.get('id') == 1:
            assert 'error' not in m, m
            break
    ws.send({'id': 2, 'method': 'Target.createTarget', 'params': {'url': url}})
    while True:
        m = await ws.recv()
        if m and m.get('id') == 2:
            assert 'error' not in m, m
            break
    # keep a DevTools session on the page: without one, new headless treats it as background
    ws.send({'id': 3, 'method': 'Target.attachToTarget', 'params': {'targetId': m['result']['targetId'], 'flatten': True}})
    while True:
        m = await ws.recv()
        if m and m.get('id') == 3:
            break
    return ws


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8782)
    ap.add_argument('--log', default='/tmp/souk-34/server.log')
    ap.add_argument('--mode', default='ffa', help='tdm needs the server started with SOUK_DUMMIES=1, which puts both players on one team')
    args = ap.parse_args()
    origin = 'http://localhost:%d' % args.port
    url = origin + '/?autotest=%s&script=voice&map=town' % args.mode
    n0 = sum(1 for _ in open(args.log)) if os.path.exists(args.log) else 0
    procs = []
    for i, dbg in enumerate((9331, 9332)):
        prof = '/tmp/souk-34/vc%d' % i
        shutil.rmtree(prof, ignore_errors=True)
        procs.append(subprocess.Popen([CHROME] + FLAGS + ['--user-data-dir=' + prof, '--remote-debugging-port=%d' % dbg, 'about:blank'],
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        procs.append(await cdp(dbg, origin, url))
        await asyncio.sleep(2)
    try:
        for _ in range(120):
            await asyncio.sleep(2)
            lines = open(args.log).read().splitlines()[n0:]
            if sum(1 for l in lines if 'voice done' in l) >= 2:
                break
        lines = [l.split('client error: ', 1)[-1] for l in open(args.log).read().splitlines()[n0:] if '[voice]' in l]
        for l in lines:
            if 'refused' in l or ' t1 ' in l or ' t6 ' in l or ' t11 ' in l:
                print(l)
        ok = [l for l in lines if ' t11 ' in l and 'mic on' in l and 'connected/connected' in l and 'level 0.00' not in l and 'level none' not in l]
        if args.mode == 'ffa':
            # the killer hears the dead at three times the volume; the victim is still talking
            ok = [l for l in ok if 'gain 3.00' in l or ('talking true' in l and 'gain 0.00' in l)]
            want = 'both hear each other, and the killer hears the dead'
        else:
            ok = [l for l in ok if 'gain 1.00' in l]      # teammates at full volume, forty metres apart
            want = 'teammates hear each other at full volume across the map'
        print('\nRESULT: %s' % (want if len(ok) >= 2 else 'FAILED'))
        return 0 if len(ok) >= 2 else 1
    finally:
        for p in procs:
            try:
                p.terminate()
            except AttributeError:
                p.w.close()


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
