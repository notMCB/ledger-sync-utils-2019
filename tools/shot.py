#!/usr/bin/env python3
"""
A picture of a page in headless Chrome, plus anything the console complained
about, through the DevTools protocol:

    python3 tools/shot.py "http://localhost:8782/?rangetest=1" 8 /tmp/range.png
"""

import asyncio
import base64
import json
import os
import shutil
import subprocess
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from bot import WS  # noqa: E402

CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'


async def main(url, secs, out):
    prof = '/tmp/souk-34/shot-profile'
    shutil.rmtree(prof, ignore_errors=True)
    p = subprocess.Popen([CHROME, '--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,800',
                          '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--user-data-dir=' + prof,
                          '--remote-debugging-port=9345', 'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:
                info = json.load(urllib.request.urlopen('http://localhost:9345/json/version', timeout=1))
                break
            except Exception:
                await asyncio.sleep(0.2)
        ws = await WS.connect(info['webSocketDebuggerUrl'])
        seq = [0]
        logs = []

        async def call(method, params=None, sid=None):
            seq[0] += 1
            msg = {'id': seq[0], 'method': method, 'params': params or {}}
            if sid:
                msg['sessionId'] = sid
            ws.send(msg)
            while True:
                m = await ws.recv()
                if not m:
                    continue
                if m.get('method') in ('Runtime.exceptionThrown', 'Runtime.consoleAPICalled', 'Log.entryAdded'):
                    logs.append(m)
                if m.get('id') == seq[0]:
                    return m
        t = await call('Target.createTarget', {'url': 'about:blank'})
        sid = (await call('Target.attachToTarget', {'targetId': t['result']['targetId'], 'flatten': True}))['result']['sessionId']
        await call('Runtime.enable', {}, sid)
        await call('Log.enable', {}, sid)
        await call('Page.navigate', {'url': url}, sid)
        end = asyncio.get_event_loop().time() + secs
        while asyncio.get_event_loop().time() < end:
            try:
                m = await asyncio.wait_for(ws.recv(), 0.5)
                if m and m.get('method') in ('Runtime.exceptionThrown', 'Log.entryAdded'):
                    logs.append(m)
            except asyncio.TimeoutError:
                pass
        if len(sys.argv) > 4:
            # something to run in the page first, e.g. pressing a key
            r = await call('Runtime.evaluate', {'expression': sys.argv[4], 'awaitPromise': True}, sid)
            ex = r.get('result', {}).get('exceptionDetails') or {}
            print('eval:', (r.get('result', {}).get('result', {}).get('value')), ex.get('text', ''), (ex.get('exception') or {}).get('description', '')[:300])
            await asyncio.sleep(1.5)
        r = await call('Page.captureScreenshot', {'format': 'png'}, sid)
        if 'result' not in r:
            print('screenshot failed:', r)
            return
        with open(out, 'wb') as f:
            f.write(base64.b64decode(r['result']['data']))
        print('saved', out)
        for m in logs:
            pr = m['params']
            if m['method'] == 'Runtime.exceptionThrown':
                d = pr['exceptionDetails']
                print('EXCEPTION:', d.get('text'), (d.get('exception') or {}).get('description', '')[:300], d.get('url'), d.get('lineNumber'))
            elif m['method'] == 'Log.entryAdded' and pr['entry'].get('level') in ('error', 'warning'):
                print(pr['entry']['level'].upper() + ':', pr['entry'].get('text', '')[:300])
    finally:
        p.terminate()


if __name__ == '__main__':
    asyncio.run(main(sys.argv[1], float(sys.argv[2]) if len(sys.argv) > 2 else 6, sys.argv[3] if len(sys.argv) > 3 else '/tmp/souk-34/shot.png'))
