#!/usr/bin/env python3
"""
Reachability through a building with more than one floor.

    python3 tools/check_levels.py manor 1

The ground checker (check_map.py) walks a single height per cell, so a
house with floors stacked over one another is opaque to it. This one
keeps every standable surface in every cell (a floor slab, a stair
tread, a table top) and walks between them: from a surface you may move
to a neighbouring cell's surface that is no more than a step higher and
has headroom, and drop to any lower one. It then reports whether a set
of places on the upper floors can be reached from the front door.
"""

import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'server'))
import mapgen  # noqa: E402

CELL = 0.2       # finer than a stair tread, so no tread is skipped between cells
STEP = 0.45
HEAD = 1.9        # a standing player, with a little to spare
PAD = 0.22         # the player's radius, near enough


def box_at(b, x, z, pad):
    cx, cy, cz, hx, hy, hz, yaw, mat, tint = b
    c, s = math.cos(yaw), math.sin(yaw)
    dx, dz = x - cx, z - cz
    lx = c * dx - s * dz
    lz = s * dx + c * dz
    return abs(lx) <= hx + pad and abs(lz) <= hz + pad


def surfaces(m, x0, x1, z0, z1):
    """For every cell in the window: the list of (top, ceiling) surfaces a player can stand on."""
    nx, nz = int((x1 - x0) / CELL) + 1, int((z1 - z0) / CELL) + 1
    cover = [[[] for _ in range(nz)] for _ in range(nx)]
    for b in m['boxes']:
        cx, cy, cz, hx, hy, hz, yaw, mat, tint = b
        if mat == 'inv' and hy > 5:
            pass
        rr = math.hypot(hx, hz) + CELL
        if cx + rr < x0 or cx - rr > x1 or cz + rr < z0 or cz - rr > z1:
            continue
        i0, i1 = max(0, int((cx - rr - x0) / CELL)), min(nx - 1, int((cx + rr - x0) / CELL))
        j0, j1 = max(0, int((cz - rr - z0) / CELL)), min(nz - 1, int((cz + rr - z0) / CELL))
        for i in range(i0, i1 + 1):
            for j in range(j0, j1 + 1):
                if box_at(b, x0 + i * CELL, z0 + j * CELL, PAD):
                    cover[i][j].append((cy - hy, cy + hy))
    surf = [[[] for _ in range(nz)] for _ in range(nx)]
    for i in range(nx):
        for j in range(nz):
            spans = sorted(cover[i][j])
            tops = [0.0] + [t for (b, t) in spans]
            for top in tops:
                # headroom: nothing solid between top and top + HEAD
                blocked = any(b < top + HEAD and t > top + 0.01 for (b, t) in spans)
                if not blocked:
                    surf[i][j].append(top)
    return surf, nx, nz


def reach(m, start, targets, window):
    x0, x1, z0, z1 = window
    surf, nx, nz = surfaces(m, x0, x1, z0, z1)

    def cell(p):
        return (max(0, min(nx - 1, int((p[0] - x0) / CELL + 0.5))), max(0, min(nz - 1, int((p[1] - z0) / CELL + 0.5))))

    def nearest(i, j, y):
        best = None
        for t in surf[i][j]:
            if best is None or abs(t - y) < abs(best - y):
                best = t
        return best

    si, sj = cell(start)
    sy = nearest(si, sj, start[2])
    if sy is None:
        return [(name, False) for (name, p) in targets], 0
    seen = {(si, sj, sy)}
    stack = [(si, sj, sy)]
    while stack:
        i, j, y = stack.pop()
        for (di, dj) in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            a, b = i + di, j + dj
            if not (0 <= a < nx and 0 <= b < nz):
                continue
            for t in surf[a][b]:
                if t - y <= STEP and (a, b, t) not in seen:
                    seen.add((a, b, t))
                    stack.append((a, b, t))
    out = []
    for name, p in targets:
        ci, cj = cell(p)
        hit = any((ci + di, cj + dj, t) in seen for di in range(-2, 3) for dj in range(-2, 3) for t in surf[max(0, min(nx - 1, ci + di))][max(0, min(nz - 1, cj + dj))] if abs(t - p[2]) < 0.6)
        out.append((name, hit))
    return out, len(seen)


def check_manor(seed):
    import map_manor
    HZ = map_manor.HOUSE_Z
    F = map_manor.FLOOR
    m = mapgen.generate(seed, 'manor').to_json()
    start = (0.0, HZ + map_manor.HD + 2.0, 0.0)                  # under the portico
    targets = [
        ('ground floor ballroom', (-15.0, HZ + 5.0, 0.0)),
        ('ground floor kitchen', (11.0, HZ - 4.0, 0.0)),
        ('ground floor corridor west end', (-20.0, HZ - 11.1, 0.0)),
        ('first floor grand stair landing', (0.0, HZ - 7.5, F)),
        ('first floor west gallery', (-5.5, HZ + 5.5, F)),
        ('first floor master bedroom', (-12.0, HZ + 8.0, F)),
        ('first floor corridor', (0.0, HZ - 11.1, F)),
        ('first floor balcony', (0.0, HZ + map_manor.HD + 0.8, F)),
        ('first floor west stair hall landing', (-22.0, HZ - 7.8, F)),
        ('second floor west landing', (-14.8, HZ - 3.7, 2 * F)),
        ('second floor east landing', (14.8, HZ - 3.7, 2 * F)),
        ('the main roof must NOT be reachable', (0.0, HZ - 8.0, 3 * F + 0.25)),
        ('second floor gallery', (5.5, HZ + 5.5, 2 * F)),
        ('second floor corridor', (0.0, HZ - 11.1, 2 * F)),
        ('second floor west bedroom', (-16.0, HZ + 4.0, 2 * F)),
        ('second floor east bedroom', (16.0, HZ + 4.0, 2 * F)),
    ]
    window = (-map_manor.HW - 4, map_manor.HW + 4, HZ - map_manor.HD - 2, HZ + map_manor.HD + 8)
    res, n = reach(m, start, targets, window)
    bad = [name for (name, hit) in res if (not hit) != name.startswith('the main roof')]
    print('manor seed %d: %d standing spots reached; %s' % (seed, n, 'every floor reachable' if not bad else 'UNREACHABLE: ' + ', '.join(bad)))
    return not bad


if __name__ == '__main__':
    seeds = [int(a) for a in sys.argv[2:]] or [1]
    ok = all([check_manor(s) for s in seeds])
    sys.exit(0 if ok else 1)
