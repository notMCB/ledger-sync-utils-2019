#!/usr/bin/env python3
"""Checks the server's item list (server/catalog.py) matches the game's (public/js/skins.js)."""

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'server'))
import catalog  # noqa: E402

src = open(os.path.join(ROOT, 'public', 'js', 'skins.js')).read()


def block(name):
    start = src.index('export const %s = [' % name)
    return src[start:src.index('];', start)]


def items(name, default_crate):
    out = {}
    for line in block(name).splitlines():
        m = re.search(r"\{ id: '(\w+)', name: '([^']+)', rarity: '(\w+)'(?:, crate: '(\w+)')?", line)
        if m:
            crate = m.group(4) or ('starter' if 'starter: true' in line else default_crate)
            out[m.group(1)] = (m.group(3), crate)
    return out


ok = True
for label, js, py in (('finishes', items('FINISHES', 'armory'), {f[0]: (f[1], f[2]) for f in catalog.FINISHES}),
                      ('outfits', items('OUTFITS', 'wardrobe'), {o[0]: (o[1], o[2]) for o in catalog.OUTFITS})):
    if js != py:
        ok = False
        print('MISMATCH in', label)
        for k in sorted(set(js) | set(py)):
            if js.get(k) != py.get(k):
                print('  %-14s game=%s server=%s' % (k, js.get(k), py.get(k)))
    else:
        print('ok  %d %s match' % (len(js), label))
# every crate must be able to give something of every rarity it can roll
for kind in ('gun', 'outfit', 'bazaar', 'blade', 'camo', 'party'):
    for _ in range(3000):
        catalog.roll(kind)
print('ok  crates roll without errors')
sys.exit(0 if ok else 1)
