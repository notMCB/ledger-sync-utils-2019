#!/usr/bin/env python3
"""
Sanity checks for a generated map, of any kind:

    python3 tools/check_map.py dock 1 2 3      # kind, then seeds

Every spawn, bomb site and hill must stand on clear ground; every box must
lie inside the walls; and on foot you must be able to get from the west
spawn to the east spawn, both sites and every hill, walking on the ground
and up steps no taller than a player can climb.
"""

import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'server'))
import mapgen  # noqa: E402

CELL = 0.5
STEP = 0.5       # the highest step a player walks up
HEAD = 1.7       # the headroom they need


def box_at(b, x, z, pad=0.0):
    cx, cy, cz, hx, hy, hz, yaw, mat, tint = b
    c, s = math.cos(yaw), math.sin(yaw)
    dx, dz = x - cx, z - cz
    lx = c * dx - s * dz
    lz = s * dx + c * dz
    return abs(lx) <= hx + pad and abs(lz) <= hz + pad


def walk_grid(m):
    """Ground height per cell and whether a player can stand there.

    Anything rooted near the ground (terrain, terraces, walls, crates) sets
    the ground height, so a plateau counts as floor from above and as a
    wall from beside (the step limit between cells sorts out which). Things
    that float higher up are obstacles if they sit in the headroom above
    that ground, and low steps if they are within a stride of it."""
    bx, bz = m['bounds']
    nx, nz = int(bx * 2 / CELL) + 1, int(bz * 2 / CELL) + 1
    ground = [[0.0] * nz for _ in range(nx)]
    ok = [[True] * nz for _ in range(nx)]
    cover = [[[] for _ in range(nz)] for _ in range(nx)]
    for b in m['boxes']:
        cx, cy, cz, hx, hy, hz, yaw, mat, tint = b
        if cy + hy > 14:
            continue      # crane beams, tower tops: nothing walks up there
        rr = math.hypot(hx, hz) + CELL
        i0, i1 = max(0, int((cx - rr + bx) / CELL)), min(nx - 1, int((cx + rr + bx) / CELL))
        j0, j1 = max(0, int((cz - rr + bz) / CELL)), min(nz - 1, int((cz + rr + bz) / CELL))
        for i in range(i0, i1 + 1):
            for j in range(j0, j1 + 1):
                if box_at(b, -bx + i * CELL, -bz + j * CELL, 0.25):
                    cover[i][j].append(b)
    for i in range(nx):
        for j in range(nz):
            bs = cover[i][j]
            g = 0.0
            for b in bs:
                if b[1] - b[4] <= 0.6:
                    g = max(g, b[1] + b[4])
            for b in sorted(bs, key=lambda b: b[1] - b[4]):
                bot, top = b[1] - b[4], b[1] + b[4]
                if bot <= 0.6:
                    continue
                if bot <= g + STEP + 0.05 and top <= g + STEP + 0.05:
                    g = max(g, top)
                elif bot < g + HEAD and top > g + 0.3:
                    ok[i][j] = False
            ground[i][j] = g
    return ground, ok, nx, nz


def clear(grid, m, x, z):
    """Can a player stand here: the cell and its neighbours are open."""
    ground, ok, nx, nz = grid
    bx, bz = m['bounds']
    i, j = int((x + bx) / CELL + 0.5), int((z + bz) / CELL + 0.5)
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            a, b = i + di, j + dj
            if not (0 <= a < nx and 0 <= b < nz) or not ok[a][b]:
                return False
    return True


def reachable(m, grid, start, targets):
    bx, bz = m['bounds']
    floor, ok, nx, nz = grid

    def cell(p):
        return (max(0, min(nx - 1, int((p[0] + bx) / CELL + 0.5))), max(0, min(nz - 1, int((p[1] + bz) / CELL + 0.5))))
    seen = set()
    stack = [cell(start)]
    while stack:
        i, j = stack.pop()
        if (i, j) in seen or not ok[i][j]:
            continue
        seen.add((i, j))
        for (di, dj) in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            a, b = i + di, j + dj
            if 0 <= a < nx and 0 <= b < nz and (a, b) not in seen and ok[a][b] and floor[a][b] - floor[i][j] <= STEP:
                stack.append((a, b))
    out = []
    for name, p in targets:
        c = cell(p)
        # a target counts if any cell within 1.5 m of it was reached
        hit = any((c[0] + di, c[1] + dj) in seen for di in range(-3, 4) for dj in range(-3, 4))
        out.append((name, hit))
    return out, len(seen)


def check(kind, seed):
    m = mapgen.generate(seed, kind).to_json()
    bx, bz = m['bounds']
    bad = []
    for b in m['boxes']:
        if abs(b[0]) > bx + 1.5 or abs(b[2]) > bz + 1.5:
            bad.append('box outside walls: %r' % (b[:3],))
    grid = walk_grid(m)
    for i, (x, z) in enumerate(m['ffaSpawns']):
        if not clear(grid, m, x, z):
            bad.append('ffa spawn %d at %.1f,%.1f is inside something' % (i, x, z))
    for t, zone in enumerate(m['teamSpawns']):
        for (x, z) in zone:
            if not clear(grid, m, x, z):
                bad.append('team %d spawn at %.1f,%.1f is inside something' % (t, x, z))
    for k, (x, z) in m['sites'].items():
        if not clear(grid, m, x, z):
            bad.append('site %s at %.1f,%.1f is blocked' % (k, x, z))
    for (x, z) in m['hills']:
        if not clear(grid, m, x, z):
            bad.append('hill at %.1f,%.1f is blocked' % (x, z))
    start = m['teamSpawns'][0][0]
    targets = [('east spawn', m['teamSpawns'][1][0])] + [('site ' + k, p) for k, p in m['sites'].items()] + \
              [('hill %d' % i, p) for i, p in enumerate(m['hills'])]
    res, n = reachable(m, grid, start, targets)
    for name, hit in res:
        if not hit:
            bad.append('cannot walk from the west spawn to the ' + name)
    # roughly how much of the map is walkable open ground
    print('%s seed %d: %d boxes, %d deco, %d ffa spawns, %d cells reached%s' % (
        kind, seed, len(m['boxes']), len(m['deco']), len(m['ffaSpawns']), n, '' if not bad else ' — PROBLEMS:'))
    for b in bad:
        print('   ' + b)
    return not bad


if __name__ == '__main__':
    kind = sys.argv[1] if len(sys.argv) > 1 else 'town'
    seeds = [int(a) for a in sys.argv[2:]] or [1, 2, 3]
    good = all([check(kind, s) for s in seeds])
    print('all good' if good else 'problems found')
    sys.exit(0 if good else 1)
