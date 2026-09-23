"""
Random town generator.

Every match gets a fresh seed. The server builds the whole town here — every
wall, floor, stair step and crate as an oriented box — and sends the list to
the clients, which render it and collide against it. The server keeps the
same list for grenade line-of-sight checks, so everyone agrees on what is
solid.

Box format: [cx, cy, cz, hx, hy, hz, yaw, mat, tint]
  centre, half-extents, rotation about the vertical axis (three.js
  rotation.y convention), a material name, and a colour variant.

Buildings are placed by rejection sampling with random position, size and
orientation, and are kept apart by a separating-axis test so the streets run
between them at odd angles instead of on a grid.
"""

import math
import random

STORY = 3.2          # floor-to-floor height
WT = 0.3             # wall thickness
BX, BZ = 76.0, 54.0  # half-size of the walled town
STEP_N = 12          # stair steps per storey
STEP_D = 0.38        # stair tread depth


def rot(x, z, yaw):
    c, s = math.cos(yaw), math.sin(yaw)
    return (c * x + s * z, -s * x + c * z)


def rect_axes(yaw):
    c, s = math.cos(yaw), math.sin(yaw)
    return (c, -s), (s, c)


def rects_overlap(a, b, margin):
    """SAT test between two rotated rectangles (cx, cz, hw, hd, yaw), each grown by margin/2."""
    ax, az, aw, ad, ay = a
    bx, bz, bw, bd, by = b
    aw += margin / 2; ad += margin / 2; bw += margin / 2; bd += margin / 2
    ua, va = rect_axes(ay)
    ub, vb = rect_axes(by)
    dx, dz = bx - ax, bz - az
    for axis in (ua, va, ub, vb):
        ra = aw * abs(ua[0] * axis[0] + ua[1] * axis[1]) + ad * abs(va[0] * axis[0] + va[1] * axis[1])
        rb = bw * abs(ub[0] * axis[0] + ub[1] * axis[1]) + bd * abs(vb[0] * axis[0] + vb[1] * axis[1])
        if abs(dx * axis[0] + dz * axis[1]) > ra + rb:
            return False
    return True


def point_in_rect(px, pz, r, margin):
    cx, cz, hw, hd, yaw = r
    dx, dz = px - cx, pz - cz
    c, s = math.cos(yaw), math.sin(yaw)
    lx = c * dx - s * dz
    lz = s * dx + c * dz
    return abs(lx) < hw + margin and abs(lz) < hd + margin


def circle_rect_dist(px, pz, r):
    """Distance from a point to a rotated rectangle (0 inside)."""
    cx, cz, hw, hd, yaw = r
    dx, dz = px - cx, pz - cz
    c, s = math.cos(yaw), math.sin(yaw)
    lx = abs(c * dx - s * dz) - hw
    lz = abs(s * dx + c * dz) - hd
    return math.hypot(max(lx, 0.0), max(lz, 0.0))


def seg_dist(px, pz, ax, az, bx, bz):
    dx, dz = bx - ax, bz - az
    L2 = dx * dx + dz * dz
    t = 0.0 if L2 < 1e-9 else max(0.0, min(1.0, ((px - ax) * dx + (pz - az) * dz) / L2))
    return math.hypot(px - (ax + dx * t), pz - (az + dz * t))


def catmull(p0, p1, p2, p3, t):
    t2, t3 = t * t, t * t * t
    return tuple(0.5 * ((2 * p1[i]) + (-p0[i] + p2[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 +
                        (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3) for i in (0, 1))


# underground: a network of tunnels below the town, reached by a ladder
# through the floor of a few buildings
TUN_FLOOR = -3.8        # the floor of a tunnel
TUN_CEIL = -1.5         # the underside of its ceiling
TUN_HALF = 1.3          # half the width of a corridor
HATCH_HALF = 0.8        # half the width of a hatch, and of its shaft
TUN_CELL = 0.65         # the grid the tunnel walls are built on

LANDMARKS = {
    # kind: (name, clear radius)
    'oasis': ('The Oasis', 11),
    'well': ('Old Well Square', 8),
    'clocktower': ('Clock Tower', 8),
    'watertower': ('Water Tower', 7),
    'ruins': ('The Ruins', 12),
    'wreck': ('Tank Wreck', 8),
    'bazaar': ('Grand Bazaar', 12),
    'camelyard': ('Camel Yard', 13),
}


class Town:
    kind = 'town'
    name = 'Old Town'
    theme = 'sand'       # ground, sky and light: 'sand', 'concrete' or 'snow'

    def __init__(self, seed):
        self.seed = seed
        self.rng = random.Random(seed)
        self.bx, self.bz = BX, BZ
        self.base_y = 0.0    # the ground level things are built on (terrain maps move it)
        self.boxes = []
        self.deco = []
        self.rects = []      # building footprints, for placement tests
        self.props = []      # (x, z, radius) of street props
        self.doors = []      # world positions just outside each door
        self.roads = []      # {'w', 'pts'}
        self.areas = []      # named places: {'n', 'x', 'z', 'r'}
        self.landmarks = []  # (kind, x, z, r)
        self.balconies = 0
        self.pits = []       # [x0, z0, x1, z1] the whole tunnel network, in plan
        self.shafts = []     # the hatch shafts: the only places the ground opens up
        self.hatches = []    # [x, z, yaw] a ladder down through a building floor

    # -- primitives -------------------------------------------------------

    def box(self, cx, cy, cz, hx, hy, hz, yaw=0.0, mat='wall', tint=0):
        if hx <= 0.005 or hy <= 0.005 or hz <= 0.005:
            return
        cy += self.base_y
        self.boxes.append([round(cx, 3), round(cy, 3), round(cz, 3),
                           round(hx, 3), round(hy, 3), round(hz, 3),
                           round(yaw, 4), mat, tint])

    # -- buildings --------------------------------------------------------

    def building(self, bx, bz, w, d, yaw, floors, tint, wall_mat='wall'):
        rng = self.rng
        hw, hd = w / 2, d / 2
        H = floors * STORY
        loc = []

        def lb(x0, x1, y0, y1, z0, z1, mat=None):
            mat = wall_mat if mat is None else mat
            if x1 - x0 > 0.01 and y1 - y0 > 0.01 and z1 - z0 > 0.01:
                loc.append(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2,
                            (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, mat))

        # stairs along the inside of the north wall, climbing towards +x
        stairs = None
        if floors == 2:
            sx0 = -hw + WT + 0.5
            sx1 = sx0 + STEP_N * STEP_D
            sz1 = hd - WT
            sz0 = sz1 - 1.3
            stairs = (sx0, sx1, sz0, sz1)

        # interior walls, each with a doorway: (axis, at, lo, hi, door, y0, y1)
        #   axis 'x': a wall at x = at running along z from lo to hi
        #   axis 'z': a wall at z = at running along x from lo to hi
        X0, X1, Z0, Z1 = -hw + WT, hw - WT, -hd + WT, hd - WT
        walls = []
        top0 = STORY - 0.25 if floors == 2 else H - 0.25
        part = None
        lo = (stairs[1] + 1.6) if stairs else (-hw + 3.0)
        hi = hw - 3.0
        if w - 2 * WT > 7.4 and hi > lo and rng.random() < 0.92:
            px = rng.uniform(lo, hi)
            dz = rng.uniform(Z0 + 1.1, Z1 - 1.1)
            part = (px, dz)
            walls.append(('x', px, Z0, Z1, dz, 0.0, top0))
        # a second wall across one side, making three rooms
        if d - 2 * WT > 6.8 and rng.random() < 0.8:
            zlo, zhi = Z0 + 2.4, Z1 - 2.4
            if stairs:
                zhi = min(zhi, stairs[2] - 1.3)
            for _ in range(10):
                if zhi <= zlo:
                    break
                pz = rng.uniform(zlo, zhi)
                if part and abs(pz - part[1]) < 1.3:
                    continue
                # west of the first wall, or the whole width if there isn't one
                xa, xb = X0, (part[0] - 0.1 if part else X1)
                if xb - xa < 2.6:
                    break
                walls.append(('z', pz, xa, xb, rng.uniform(xa + 0.9, xb - 0.9), 0.0, top0))
                break
        # upstairs gets a room of its own too
        if floors == 2 and rng.random() < 0.8:
            ulo, uhi = stairs[1] + 1.4, hw - 2.6
            if uhi > ulo:
                walls.append(('x', rng.uniform(ulo, uhi), Z0, Z1, rng.uniform(Z0 + 1.1, Z1 - 1.1), STORY, H - 0.25))

        # openings for each side and storey: (u, width, bottom, top)
        side_len = {'S': w, 'N': w, 'W': d - 2 * WT, 'E': d - 2 * WT}
        excl = {s: [] for s in 'SNWE'}
        for (axis, at, a0, a1, door, y0, y1) in walls:
            if axis == 'x':
                excl['S'].append((at - 0.4, at + 0.4))
                excl['N'].append((at - 0.4, at + 0.4))
            else:
                if a0 <= X0 + 0.01:
                    excl['W'].append((at - 0.4, at + 0.4))
                if a1 >= X1 - 0.01:
                    excl['E'].append((at - 0.4, at + 0.4))
        ground_excl_n = list(excl['N'])
        if stairs:
            ground_excl_n.append((stairs[0] - 0.4, stairs[1] + 0.4))

        def pick(side, n, wrange, bottom, top, exclude, existing):
            L = side_len[side]
            out = []
            for _ in range(40):
                if len(out) >= n:
                    break
                wid = rng.uniform(*wrange)
                margin = 1.2
                lo_u = -L / 2 + margin + wid / 2
                hi_u = L / 2 - margin - wid / 2
                if hi_u <= lo_u:
                    break
                u = rng.uniform(lo_u, hi_u)
                a, b = u - wid / 2 - 0.25, u + wid / 2 + 0.25
                if any(a < e1 and b > e0 for e0, e1 in exclude):
                    continue
                if any(abs(u - o[0]) < (wid + o[1]) / 2 + 0.7 for o in out + existing):
                    continue
                out.append((u, wid, bottom, top))
            return out

        openings = {(s, f): [] for s in 'SNWE' for f in range(floors)}
        # doors: at least one, usually two or three on different sides
        n_doors = rng.choice([1, 2, 2, 2, 3, 3])
        sides = ['S', 'N', 'W', 'E']
        rng.shuffle(sides)
        placed = 0
        for s in sides:
            if placed >= n_doors:
                break
            ex = ground_excl_n if s == 'N' else excl[s]
            got = pick(s, 1, (1.4, 1.7), 0.0, 2.4, ex, [])
            if got:
                openings[(s, 0)] += got
                placed += 1
        if placed == 0:  # always leave a way in
            openings[('S', 0)].append((0.0, 1.5, 0.0, 2.4))
        # a balcony off the upstairs, reached through a door
        balcony = None
        if floors == 2 and rng.random() < 0.7:
            sides_b = ['S', 'N', 'W', 'E']
            rng.shuffle(sides_b)
            for s in sides_b:
                ex = list(excl[s])
                if s == 'N' and stairs:
                    ex.append((stairs[0] - 0.4, stairs[1] + 0.4))
                got = pick(s, 1, (1.1, 1.3), STORY, STORY + 2.3, ex, openings[(s, 1)])
                if got:
                    openings[(s, 1)] += got
                    balcony = (s, got[0][0], got[0][1])
                    break

        # windows
        for s in 'SNWE':
            for f in range(floors):
                n = rng.choice([0, 1, 1, 2, 2]) if f == 0 else rng.choice([1, 1, 2, 2])
                ex = ground_excl_n if (s == 'N' and f == 0) else excl[s]
                base = f * STORY
                openings[(s, f)] += pick(s, n, (1.0, 1.5), base + 1.0, base + 2.2, ex, openings[(s, f)])

        def wall_run(side, ops, y0, y1):
            L = side_len[side]
            ops = sorted(ops)
            cur = -L / 2
            pieces = []
            for (u, wid, bot, top) in ops:
                pieces.append((cur, u - wid / 2, y0, y1))
                if bot > y0:
                    pieces.append((u - wid / 2, u + wid / 2, y0, bot))
                if top < y1:
                    pieces.append((u - wid / 2, u + wid / 2, top, y1))
                cur = u + wid / 2
            pieces.append((cur, L / 2, y0, y1))
            for (a, b, p0, p1) in pieces:
                if side == 'S':
                    lb(a, b, p0, p1, -hd, -hd + WT)
                elif side == 'N':
                    lb(a, b, p0, p1, hd - WT, hd)
                elif side == 'W':
                    lb(-hw, -hw + WT, p0, p1, a, b)
                else:
                    lb(hw - WT, hw, p0, p1, a, b)

        for s in 'SNWE':
            for f in range(floors):
                wall_run(s, openings[(s, f)], f * STORY, (f + 1) * STORY)
        if balcony:
            bs, u, wid = balcony
            bw = wid / 2 + 0.7   # half its width along the wall
            depth = 1.3

            def span(a0, a1, o0, o1, p0, p1, mat):
                # a = along the wall, o = out from its face
                if bs == 'S':
                    lb(a0, a1, p0, p1, -hd - o1, -hd - o0, mat)
                elif bs == 'N':
                    lb(a0, a1, p0, p1, hd + o0, hd + o1, mat)
                elif bs == 'W':
                    lb(-hw - o1, -hw - o0, p0, p1, a0, a1, mat)
                else:
                    lb(hw + o0, hw + o1, p0, p1, a0, a1, mat)

            y0, y1 = STORY - 0.2, STORY
            span(u - bw, u + bw, 0, depth, y0, y1, 'wall')                        # floor
            span(u - bw, u + bw, depth - 0.08, depth, y1, y1 + 1.0, 'wood')       # railings
            span(u - bw, u - bw + 0.08, 0, depth - 0.08, y1, y1 + 1.0, 'wood')
            span(u + bw - 0.08, u + bw, 0, depth - 0.08, y1, y1 + 1.0, 'wood')
            for a in (u - bw + 0.15, u + bw - 0.27):
                span(a, a + 0.12, 0, depth * 0.8, y0 - 0.4, y0, 'wood')          # brackets
            self.balconies += 1

        # parapet around the roof
        lb(-hw, hw, H, H + 0.55, -hd, -hd + WT)
        lb(-hw, hw, H, H + 0.55, hd - WT, hd)
        lb(-hw, -hw + WT, H, H + 0.55, -hd + WT, hd - WT)
        lb(hw - WT, hw, H, H + 0.55, -hd + WT, hd - WT)
        # roof
        lb(-hw, hw, H - 0.25, H, -hd, hd, 'roof')
        # interior floor tiles
        lb(X0, X1, 0.0, 0.03, Z0, Z1, 'tile')

        for (axis, at, a0, a1, door, y0, y1) in walls:
            if axis == 'x':
                lb(at - 0.1, at + 0.1, y0, y1, a0, door - 0.7)
                lb(at - 0.1, at + 0.1, y0, y1, door + 0.7, a1)
                lb(at - 0.1, at + 0.1, y0 + 2.3, y1, door - 0.7, door + 0.7)
            else:
                lb(a0, door - 0.7, y0, y1, at - 0.1, at + 0.1)
                lb(door + 0.7, a1, y0, y1, at - 0.1, at + 0.1)
                lb(door - 0.7, door + 0.7, y0 + 2.3, y1, at - 0.1, at + 0.1)

        if stairs:
            sx0, sx1, sz0, sz1 = stairs
            rise = STORY / STEP_N
            for i in range(STEP_N):
                lb(sx0 + i * STEP_D, sx0 + (i + 1) * STEP_D, 0, (i + 1) * rise, sz0, sz1, 'stair')
            # upper floor slab with a stairwell hole
            hx0, hx1, hz0, hz1 = sx0 + 0.9, sx1, sz0, sz1
            y0, y1 = STORY - 0.25, STORY
            lb(X0, hx0, y0, y1, Z0, Z1, 'tile')
            lb(hx1, X1, y0, y1, Z0, Z1, 'tile')
            lb(hx0, hx1, y0, y1, Z0, hz0, 'tile')
            # railings round the hole
            lb(hx0, hx1 - 0.2, STORY, STORY + 1.0, hz0 - 0.07, hz0, 'wood')
            lb(hx0 - 0.07, hx0, STORY, STORY + 1.0, hz0, hz1, 'wood')

        # a little cover indoors
        def free_inside(x, z, r):
            if stairs and stairs[0] - r - 0.9 < x < stairs[1] + r + 0.9 and z > stairs[2] - r - 0.9:
                return False
            for (axis, at, a0, a1, door, y0, y1) in walls:
                if y0 > 0.1:
                    continue
                if (abs(x - at) if axis == 'x' else abs(z - at)) < r + 0.9:
                    return False
            for (s, f), ops in openings.items():
                if f != 0:
                    continue
                for (u, wid, bot, top) in ops:
                    if bot > 0.1:
                        continue
                    if s == 'S':
                        dx, dz2 = x - u, z - (-hd)
                    elif s == 'N':
                        dx, dz2 = x - u, z - hd
                    elif s == 'W':
                        dx, dz2 = x - (-hw), z - u
                    else:
                        dx, dz2 = x - hw, z - u
                    if math.hypot(dx, dz2) < 2.6:
                        return False
            return True

        for _ in range(rng.choice([1, 2, 3])):
            for _t in range(12):
                sz = rng.uniform(0.8, 1.1)
                x = rng.uniform(X0 + sz / 2 + 0.05, X1 - sz / 2 - 0.05)
                z = rng.uniform(Z0 + sz / 2 + 0.05, Z1 - sz / 2 - 0.05)
                if free_inside(x, z, sz * 0.7):
                    lb(x - sz / 2, x + sz / 2, 0, sz, z - sz / 2, z + sz / 2, 'crate')
                    break
        if floors == 2:
            for _t in range(12):
                sz = rng.uniform(0.8, 1.0)
                x = rng.uniform(X0 + 0.6, X1 - 0.6)
                z = rng.uniform(Z0 + 0.6, Z1 - 0.6)
                if stairs and stairs[0] - 1.5 < x < stairs[1] + 1.6 and z > stairs[2] - 1.5:
                    continue
                if any(y0 > 0.1 and abs(x - at) < 1.3 for (axis, at, a0, a1, door, y0, y1) in walls):
                    continue
                lb(x - sz / 2, x + sz / 2, STORY, STORY + sz, z - sz / 2, z + sz / 2, 'crate')
                break

        # to world
        for (cx, cy, cz, hx, hy, hz, mat) in loc:
            wx, wz = rot(cx, cz, yaw)
            self.box(bx + wx, cy, bz + wz, hx, hy, hz, yaw, mat, tint)

        # awnings over some doors, and door approach points
        for (s, f), ops in openings.items():
            if f != 0:
                continue
            for (u, wid, bot, top) in ops:
                if bot > 0.1:
                    continue
                if s == 'S':
                    lx, lz, fy = u, -hd - 0.9, math.pi
                elif s == 'N':
                    lx, lz, fy = u, hd + 0.9, 0.0
                elif s == 'W':
                    lx, lz, fy = -hw - 0.9, u, -math.pi / 2
                else:
                    lx, lz, fy = hw + 0.9, u, math.pi / 2
                wx, wz = rot(lx, lz, yaw)
                self.doors.append((bx + wx, bz + wz))
                if rng.random() < 0.45:
                    self.deco.append({'k': 'awning', 'x': round(bx + wx, 2), 'y': round(2.75 + self.base_y, 2),
                                      'z': round(bz + wz, 2), 'w': round(wid + 1.0, 2),
                                      'yaw': round(yaw + fy, 4), 'c': rng.randrange(6)})
        return H

    # -- the town ----------------------------------------------------------

    def generate(self):
        rng = self.rng
        # zones kept open: spawns at each end, two bomb sites, three hills
        zc_w = rng.uniform(-18, 18)
        zc_e = rng.uniform(-18, 18)
        self.spawn_w = (-66.0, zc_w)
        self.spawn_e = (66.0, zc_e)
        self.site_a = (rng.uniform(22, 40), rng.uniform(-40, -24))
        self.site_b = (rng.uniform(22, 40), rng.uniform(24, 40))
        self.hills = [
            (rng.uniform(-8, 8), rng.uniform(-10, 10)),
            (rng.uniform(-40, -24), rng.uniform(-38, -20) if rng.random() < 0.5 else rng.uniform(20, 38)),
            (rng.uniform(4, 16), rng.uniform(30, 40) if rng.random() < 0.5 else rng.uniform(-40, -30)),
        ]
        reserved = [(self.spawn_w[0], self.spawn_w[1], 11), (self.spawn_e[0], self.spawn_e[1], 11),
                    (self.site_a[0], self.site_a[1], 8.5), (self.site_b[0], self.site_b[1], 8.5)]
        reserved += [(x, z, 8) for (x, z) in self.hills]
        self.make_roads()
        self.choose_landmarks(reserved)
        reserved += [(x, z, r) for (_, x, z, r) in self.landmarks]

        # buildings
        tints = 6
        for _ in range(14000):
            if len(self.rects) >= 60:
                break
            w = rng.uniform(6.8, 13.5)
            d = rng.uniform(6.8, 12.5)
            yaw = rng.choice([0.0, math.pi / 2]) + rng.uniform(-0.45, 0.45)
            x = rng.uniform(-self.bx + 6, self.bx - 6)
            z = rng.uniform(-self.bz + 6, self.bz - 6)
            r = (x, z, w / 2, d / 2, yaw)
            # inside the walls, with room for a street along them
            ok = True
            for (sx, sz) in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
                cxz = rot(sx * w / 2, sz * d / 2, yaw)
                if abs(x + cxz[0]) > self.bx - 3.2 or abs(z + cxz[1]) > self.bz - 3.2:
                    ok = False
            if not ok:
                continue
            if any(circle_rect_dist(rx, rz, r) < rr for (rx, rz, rr) in reserved):
                continue
            gap = rng.uniform(2.2, 3.6)
            if any(rects_overlap(r, o, gap) for o in self.rects):
                continue
            if self.rect_on_road(r):
                continue
            self.rects.append(r)

        # pick a few big single-storey buildings for domes, most others random height
        order = sorted(range(len(self.rects)), key=lambda i: -(self.rects[i][2] * self.rects[i][3]))
        dome_ids = set(order[:2])
        for i, (x, z, hw, hd, yaw) in enumerate(self.rects):
            w, d = hw * 2, hd * 2
            if i in dome_ids:
                floors = 1
            else:
                floors = 2 if (w >= 8.2 and d >= 7.8 and rng.random() < 0.62) else 1
            tint = rng.randrange(tints)
            H = self.building(x, z, w, d, yaw, floors, tint)
            if i in dome_ids:
                r = round(min(w, d) * 0.36, 2)
                self.deco.append({'k': 'dome', 'x': round(x, 2), 'y': round(H, 2), 'z': round(z, 2),
                                  'r': r, 't': tint})
                # solid: three boxes turned 60 degrees apart make a twelve-sided drum
                # up to where the dome curves in too far to stand against
                dh = (0.9 + r * 1.15 * 0.8) / 2
                for k in range(3):
                    self.box(x, H + dh, z, r * 0.97, dh, r * 0.5, k * math.pi / 3, 'inv')
                if i == order[0]:
                    mx, mz = rot(hw - 1.4, -hd + 1.4, yaw)
                    self.deco.append({'k': 'minaret', 'x': round(x + mx, 2), 'y': round(H, 2),
                                      'z': round(z + mz, 2), 'h': 13.0, 't': tint})
                    # the minaret's shaft, right up to its cap
                    th = (13.0 + 2.2) / 2
                    for k in range(2):
                        self.box(x + mx, H + th, z + mz, 0.98, th, 0.98, k * math.pi / 4, 'inv')
                    self.areas.append({'n': 'Grand Mosque', 'x': round(x, 1), 'z': round(z, 1), 'r': round(max(hw, hd) + 5, 1)})

        # the town wall
        wh = 6.0
        self.box(0, wh / 2, -self.bz - 0.5, self.bx + 1, wh / 2, 0.5, 0, 'stone')
        self.box(0, wh / 2, self.bz + 0.5, self.bx + 1, wh / 2, 0.5, 0, 'stone')
        self.box(-self.bx - 0.5, wh / 2, 0, 0.5, wh / 2, self.bz, 0, 'stone')
        self.box(self.bx + 0.5, wh / 2, 0, 0.5, wh / 2, self.bz, 0, 'stone')

        for (kind, x, z, r) in self.landmarks:
            getattr(self, 'lm_' + kind)(x, z)
            self.areas.append({'n': LANDMARKS[kind][0], 'x': round(x, 1), 'z': round(z, 1), 'r': r})
        for rd in self.roads:
            self.deco.append({'k': 'road', 'w': round(rd['w'], 2), 'pts': [[round(x, 2), round(z, 2)] for (x, z) in rd['pts']]})
        self.areas.append({'n': 'West End', 'x': self.spawn_w[0], 'z': round(self.spawn_w[1], 1), 'r': 12})
        self.areas.append({'n': 'East End', 'x': self.spawn_e[0], 'z': round(self.spawn_e[1], 1), 'r': 12})

        self.place_props()
        self.dig_tunnels()
        self.pick_spawns()

    # -- tunnels ---------------------------------------------------------------

    def clear_here(self, x, z, r, y0, y1):
        """Is this patch of floor free of walls, stairs and furniture?"""
        for (cx, cy, cz, hx, hy, hz, yaw, mat, tint) in self.boxes:
            if cy - hy > y1 or cy + hy < y0:
                continue
            if abs(cx - x) > hx + r + 1 or abs(cz - z) > hz + r + 1:
                continue
            if circle_rect_dist(x, z, (cx, cz, hx, hz, yaw)) < r:
                return False
        for (px, pz, pr) in self.props:
            if math.hypot(px - x, pz - z) < pr + r:
                return False
        return True

    def hatch_spot(self, x, z, hw, hd, yaw):
        """A clear square inside a building for a hatch, or None."""
        for (fx, fz) in ((0.45, 0.45), (-0.45, 0.45), (0.45, -0.45), (-0.45, -0.45),
                         (0.0, 0.5), (0.5, 0.0), (0.0, -0.5), (-0.5, 0.0), (0.0, 0.0)):
            ox, oz = rot(fx * hw, fz * hd, yaw)
            px, pz = x + ox, z + oz
            if self.clear_here(px, pz, HATCH_HALF + 0.45, 0.06, 1.7):
                return (px, pz)
        return None

    def punch_floor(self, x, z, half):
        """Cut a square hole in any floor slab over a hatch."""
        keep = []
        for b in self.boxes:
            (cx, cy, cz, hx, hy, hz, yaw, mat, tint) = b
            top = cy + hy
            if mat != 'tile' or top > 0.4 or top < -0.2 or abs(cx - x) > hx + hz + 2 or abs(cz - z) > hx + hz + 2:
                keep.append(b)
                continue
            c, s = math.cos(yaw), math.sin(yaw)
            dx, dz = x - cx, z - cz
            lx, lz = c * dx - s * dz, s * dx + c * dz          # the hatch, in the slab's own frame
            r = half * (abs(c) + abs(s)) + 0.02
            if abs(lx) > hx + r or abs(lz) > hz + r:
                keep.append(b)
                continue
            x0, x1 = max(-hx, lx - r), min(hx, lx + r)
            z0, z1 = max(-hz, lz - r), min(hz, lz + r)
            pieces = [(-hx, x0, -hz, hz), (x1, hx, -hz, hz), (x0, x1, -hz, z0), (x0, x1, z1, hz)]
            for (a0, a1, b0, b1) in pieces:
                if a1 - a0 < 0.02 or b1 - b0 < 0.02:
                    continue
                pcx, pcz = (a0 + a1) / 2, (b0 + b1) / 2
                wx, wz = rot(pcx, pcz, yaw)
                keep.append([round(cx + wx, 3), cy, round(cz + wz, 3),
                             round((a1 - a0) / 2, 3), hy, round((b1 - b0) / 2, 3), yaw, mat, tint])
        self.boxes = keep

    def dig_tunnels(self):
        rng = self.rng
        cands = [r for r in self.rects if min(r[2], r[3]) >= 3.4]
        rng.shuffle(cands)
        spots = []
        for (x, z, hw, hd, yaw) in cands:
            if len(spots) >= 5:
                break
            if any(math.hypot(x - sx, z - sz) < 26 for (sx, sz) in spots):
                continue
            s = self.hatch_spot(x, z, hw, hd, yaw)
            if s:
                spots.append(s)
        if len(spots) < 2:
            return
        spots.sort()
        rects = []

        def leg(x0, z0, x1, z1):
            if abs(x1 - x0) < 0.01 and abs(z1 - z0) < 0.01:
                return
            rects.append([min(x0, x1) - TUN_HALF, min(z0, z1) - TUN_HALF,
                          max(x0, x1) + TUN_HALF, max(z0, z1) + TUN_HALF])

        # a dog-leg between each pair, plus one more so the network loops back
        links = [(i, i + 1) for i in range(len(spots) - 1)]
        if len(spots) > 2:
            links.append((0, len(spots) - 1))
        for (a, b) in links:
            (ax, az), (bx, bz) = spots[a], spots[b]
            # bend at a point off to one side, so the tunnels weave rather than run straight
            mx = ax + (bx - ax) * rng.uniform(0.3, 0.7)
            leg(ax, az, mx, az)
            leg(mx, az, mx, bz)
            leg(mx, bz, bx, bz)
        shafts = [[x - HATCH_HALF, z - HATCH_HALF, x + HATCH_HALF, z + HATCH_HALF] for (x, z) in spots]

        def snap(r):
            return [math.floor(r[0] / TUN_CELL) * TUN_CELL, math.floor(r[1] / TUN_CELL) * TUN_CELL,
                    math.ceil(r[2] / TUN_CELL) * TUN_CELL, math.ceil(r[3] / TUN_CELL) * TUN_CELL]

        rects = [snap(r) for r in rects]
        shafts = [snap(r) for r in shafts]
        self.pits = [[round(v, 2) for v in r] for r in rects + shafts]
        self.shafts = [[round(v, 2) for v in r] for r in shafts]
        self.hatches = [[round(x, 2), round(z, 2), 0.0] for (x, z) in spots]

        # open the floor of each building above its hatch
        for (x, z) in spots:
            self.punch_floor(x, z, HATCH_HALF)

        # the floor runs under everything, shafts included
        for (x0, z0, x1, z1) in rects + shafts:
            self.box((x0 + x1) / 2, TUN_FLOOR - 0.15, (z0 + z1) / 2, (x1 - x0) / 2, 0.15, (z1 - z0) / 2, 0, 'tile')

        # walls and ceiling: rasterise the whole network, then wall off every open edge
        # the rects sit on the cell grid already, so round rather than ceil:
        # 8.45 / 0.65 comes out a hair over 13 and ceil would add a spare cell
        cells = set()
        deep = set()
        for (x0, z0, x1, z1) in rects + shafts:
            for ix in range(int(round(x0 / TUN_CELL)), int(round(x1 / TUN_CELL))):
                for iz in range(int(round(z0 / TUN_CELL)), int(round(z1 / TUN_CELL))):
                    cells.add((ix, iz))
        for (x0, z0, x1, z1) in shafts:
            for ix in range(int(round(x0 / TUN_CELL)), int(round(x1 / TUN_CELL))):
                for iz in range(int(round(z0 / TUN_CELL)), int(round(z1 / TUN_CELL))):
                    deep.add((ix, iz))
        # the ceiling, in strips, with the shafts left open to the room above
        rows = {}
        for (ix, iz) in cells:
            if (ix, iz) in deep:
                continue
            rows.setdefault(iz, []).append(ix)
        for (iz, xs) in rows.items():
            xs.sort()
            start = prev = xs[0]
            for x in xs[1:] + [None]:
                if x is not None and x == prev + 1:
                    prev = x
                    continue
                x0, x1 = start * TUN_CELL, (prev + 1) * TUN_CELL
                self.box((x0 + x1) / 2, TUN_CEIL + 0.18, (iz + 0.5) * TUN_CELL,
                         (x1 - x0) / 2, 0.18, TUN_CELL / 2, 0, 'stone')
                if x is not None:
                    start = prev = x

        # walls, in two layers: the tunnel itself from its floor to its ceiling,
        # then the shafts alone from that ceiling up to the street
        for (group, base, top) in ((cells, TUN_FLOOR, TUN_CEIL), (deep, TUN_CEIL, 0.0)):
            for (dx, dz) in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                runs = {}
                for (ix, iz) in group:
                    if (ix + dx, iz + dz) in group:
                        continue
                    key = ((ix if dx else iz), dx, dz, base, top)
                    runs.setdefault(key, []).append(iz if dx else ix)
                # merged runs, one box each
                for ((line, sdx, sdz, lo_y, hi_y), others) in runs.items():
                    others.sort()
                    start = prev = others[0]
                    for o in others[1:] + [None]:
                        if o is not None and o == prev + 1:
                            prev = o
                            continue
                        lo, hi = start * TUN_CELL, (prev + 1) * TUN_CELL
                        at = (line + (1 if sdx > 0 or sdz > 0 else 0)) * TUN_CELL
                        cy = (lo_y + hi_y) / 2
                        hy = (hi_y - lo_y) / 2
                        if sdx:
                            self.box(at + sdx * 0.12, cy, (lo + hi) / 2, 0.12, hy, (hi - lo) / 2, 0, 'stone')
                        else:
                            self.box((lo + hi) / 2, cy, at + sdz * 0.12, (hi - lo) / 2, hy, 0.12, 0, 'stone')
                        if o is not None:
                            start = prev = o

        # lamps along the corridors, and a rim and ladder at each hatch
        for (x0, z0, x1, z1) in rects:
            L = max(x1 - x0, z1 - z0)
            n = max(1, int(L / 9))
            for i in range(n):
                t = (i + 0.5) / n
                lx = x0 + (x1 - x0) * (t if x1 - x0 > z1 - z0 else 0.5)
                lz = z0 + (z1 - z0) * (0.5 if x1 - x0 > z1 - z0 else t)
                self.deco.append({'k': 'lamp', 'x': round(lx, 2), 'y': round(TUN_CEIL - 0.35, 2), 'z': round(lz, 2)})
        for (x, z) in spots:
            self.deco.append({'k': 'hatch', 'x': round(x, 2), 'z': round(z, 2), 'r': HATCH_HALF, 'd': TUN_FLOOR})
            self.areas.append({'n': 'Tunnels', 'x': round(x, 1), 'z': round(z, 1), 'r': 3})
        self.tunnel_cover(rects, spots)

    def tunnel_cover(self, rects, spots):
        """Barrels, crates, rubble and sandbags down the corridors, hugging one
        wall or the other, so a long straight stretch is not a shooting gallery."""
        rng = self.rng
        placed = []
        for (x0, z0, x1, z1) in rects:
            along_x = (x1 - x0) >= (z1 - z0)
            L = (x1 - x0) if along_x else (z1 - z0)
            if L < 7:
                continue
            n = max(1, int(L / 6.0))
            for i in range(n):
                t = (i + 0.5 + rng.uniform(-0.22, 0.22)) / n
                side = 1 if (i + int(x0 * 3)) % 2 == 0 else -1
                half = ((z1 - z0) if along_x else (x1 - x0)) / 2
                off = side * (half - 0.5)
                if along_x:
                    cx, cz = x0 + (x1 - x0) * t, (z0 + z1) / 2 + off
                else:
                    cx, cz = (x0 + x1) / 2 + off, z0 + (z1 - z0) * t
                if any(math.hypot(cx - hx, cz - hz) < 3.2 for (hx, hz) in spots):
                    continue
                if any(math.hypot(cx - px, cz - pz) < 2.5 for (px, pz) in placed):
                    continue
                placed.append((cx, cz))
                kind = rng.choice(('barrel', 'barrel', 'crate', 'rubble', 'bags'))
                yaw = 0.0 if along_x else math.pi / 2
                if kind == 'barrel':
                    self.box(cx, TUN_FLOOR + 0.5, cz, 0.32, 0.5, 0.32, 0, 'inv')
                    self.deco.append({'k': 'barrel', 'x': round(cx, 2), 'y': TUN_FLOOR, 'z': round(cz, 2), 'c': rng.randrange(3)})
                    # often a second one right beside it
                    if rng.random() < 0.5:
                        bx, bz = (cx + 0.7, cz) if along_x else (cx, cz + 0.7)
                        self.box(bx, TUN_FLOOR + 0.5, bz, 0.32, 0.5, 0.32, 0, 'inv')
                        self.deco.append({'k': 'barrel', 'x': round(bx, 2), 'y': TUN_FLOOR, 'z': round(bz, 2), 'c': rng.randrange(3)})
                elif kind == 'crate':
                    self.box(cx, TUN_FLOOR + 0.42, cz, 0.42, 0.42, 0.42, yaw + rng.uniform(-0.2, 0.2), 'crate')
                    if rng.random() < 0.6:
                        self.box(cx, TUN_FLOOR + 1.12, cz, 0.3, 0.28, 0.3, yaw + rng.uniform(-0.5, 0.5), 'crate')
                elif kind == 'rubble':
                    self.box(cx, TUN_FLOOR + 0.3, cz, 0.7, 0.3, 0.42, yaw, 'stone', 1)
                    self.box(cx, TUN_FLOOR + 0.72, cz, 0.4, 0.14, 0.3, yaw + 0.3, 'stone', 1)
                else:
                    # a low sandbag wall: waist high, kneel behind it
                    self.box(cx, TUN_FLOOR + 0.42, cz, 0.85, 0.42, 0.32, yaw, 'hay')

    # -- roads -----------------------------------------------------------------

    def make_roads(self):
        rng = self.rng

        def path(p0, p1, wiggle):
            dx, dz = p1[0] - p0[0], p1[1] - p0[1]
            L = math.hypot(dx, dz)
            nx, nz = -dz / L, dx / L
            ctrl = [p0]
            n = 6
            for i in range(1, n):
                t = i / n
                off = rng.uniform(-wiggle, wiggle)
                ctrl.append((p0[0] + dx * t + nx * off, p0[1] + dz * t + nz * off))
            ctrl.append(p1)
            out = []
            for i in range(len(ctrl) - 1):
                a, b = ctrl[max(0, i - 1)], ctrl[i]
                c, d = ctrl[i + 1], ctrl[min(len(ctrl) - 1, i + 2)]
                for k in range(8):
                    out.append(catmull(a, b, c, d, k / 8))
            out.append(ctrl[-1])
            return [(max(-self.bx, min(self.bx, x)), max(-self.bz, min(self.bz, z))) for (x, z) in out]

        # one runs the length of town between the two ends, one crosses it, sometimes a third
        self.roads.append({'w': rng.uniform(4.5, 6.0), 'pts': path((-self.bx, self.spawn_w[1]), (self.bx, self.spawn_e[1]), 14)})
        x0 = rng.uniform(-40, 0)
        self.roads.append({'w': rng.uniform(4.0, 5.5), 'pts': path((x0, -self.bz), (x0 + rng.uniform(-18, 18), self.bz), 10)})
        if rng.random() < 0.65:
            x0 = rng.uniform(8, 50)
            self.roads.append({'w': rng.uniform(3.6, 4.6), 'pts': path((x0, -self.bz), (x0 + rng.uniform(-25, 25), self.bz), 12)})

    def road_dist(self, x, z):
        best = 1e9
        for rd in self.roads:
            pts = rd['pts']
            for i in range(len(pts) - 1):
                d = seg_dist(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) - rd['w'] / 2
                if d < best:
                    best = d
        return best

    def rect_on_road(self, r, margin=1.2):
        for rd in self.roads:
            pts = rd['pts']
            for i in range(len(pts) - 1):
                (ax, az), (bx, bz) = pts[i], pts[i + 1]
                steps = max(1, int(math.hypot(bx - ax, bz - az) / 1.5))
                for k in range(steps + 1):
                    t = k / steps
                    if point_in_rect(ax + (bx - ax) * t, az + (bz - az) * t, r, rd['w'] / 2 + margin):
                        return True
        return False

    # -- landmarks -----------------------------------------------------------------

    def choose_landmarks(self, reserved):
        rng = self.rng
        kinds = list(LANDMARKS)
        rng.shuffle(kinds)
        for kind in kinds:
            if len(self.landmarks) >= 5:
                break
            r = LANDMARKS[kind][1]
            for _ in range(300):
                x = rng.uniform(-self.bx + r + 4, self.bx - r - 4)
                z = rng.uniform(-self.bz + r + 4, self.bz - r - 4)
                if any(math.hypot(x - a, z - b) < r + c + 3 for (a, b, c) in reserved):
                    continue
                if any(math.hypot(x - a, z - b) < r + c + 12 for (_, a, b, c) in self.landmarks):
                    continue
                # the bazaar sits on a road; things with solid middles keep off them
                rd = self.road_dist(x, z)
                if kind == 'bazaar' and rd > 4:
                    continue
                if kind in ('oasis', 'clocktower', 'watertower', 'well', 'wreck') and rd < 4:
                    continue
                self.landmarks.append((kind, x, z, r))
                break

    def solid(self, x, y, z, hx, hy, hz, yaw=0.0, mat='stone', tint=0, rad=None):
        self.box(x, y, z, hx, hy, hz, yaw, mat, tint)
        self.props.append((x, z, rad if rad is not None else math.hypot(hx, hz)))

    def lm_oasis(self, x, z):
        rng = self.rng
        self.deco.append({'k': 'pond', 'x': round(x, 2), 'z': round(z, 2), 'r': 5.2})
        self.props.append((x, z, 5.0))
        for i in range(9):
            a = i / 9 * math.tau + rng.uniform(-0.2, 0.2)
            rr = rng.uniform(6.3, 8.4)
            px, pz = x + math.cos(a) * rr, z + math.sin(a) * rr
            self.box(px, 1.5, pz, 0.2, 1.5, 0.2, 0, 'inv')
            self.deco.append({'k': 'palm', 'x': round(px, 2), 'z': round(pz, 2), 'h': round(rng.uniform(6, 9), 2), 's': rng.randrange(1000)})
            self.props.append((px, pz, 0.6))
        for i in range(6):
            a = rng.uniform(0, math.tau)
            rr = rng.uniform(5.3, 6.2)
            s = rng.uniform(0.35, 0.7)
            self.solid(x + math.cos(a) * rr, s * 0.6, z + math.sin(a) * rr, s, s * 0.6, s * 0.8, rng.uniform(0, 3), 'stone')

    def lm_well(self, x, z):
        rng = self.rng
        self.deco.append({'k': 'paving', 'x': round(x, 2), 'z': round(z, 2), 'r': 7.5})
        self.solid(x, 0.5, z, 1.0, 0.5, 1.0, 0.0, 'inv', rad=1.4)
        self.deco.append({'k': 'well', 'x': round(x, 2), 'z': round(z, 2)})
        for i in range(4):
            a = i / 4 * math.tau + 0.4
            bx, bz = x + math.cos(a) * 4.8, z + math.sin(a) * 4.8
            self.solid(bx, 0.22, bz, 0.9, 0.22, 0.25, -a + math.pi / 2, 'wood')
        for i in range(3):
            a = rng.uniform(0, math.tau)
            px, pz = x + math.cos(a) * 6.5, z + math.sin(a) * 6.5
            rad = self.crate_stack(px, pz, rng.uniform(0, 3))
            self.props.append((px, pz, rad))

    def lm_clocktower(self, x, z):
        yaw = self.rng.uniform(0, math.pi)
        h = 14.0
        self.solid(x, h / 2, z, 1.7, h / 2, 1.7, yaw, 'wall', 1, rad=2.5)
        self.solid(x, 0.4, z, 2.6, 0.4, 2.6, yaw, 'stone', rad=3.6)
        self.deco.append({'k': 'clock', 'x': round(x, 2), 'z': round(z, 2), 'y': h, 'yaw': round(yaw, 4)})
        self.deco.append({'k': 'paving', 'x': round(x, 2), 'z': round(z, 2), 'r': 7})

    def lm_watertower(self, x, z):
        h = 9.0
        for sx in (-1.6, 1.6):
            for sz in (-1.6, 1.6):
                self.solid(x + sx, h / 2, z + sz, 0.14, h / 2, 0.14, 0, 'inv', rad=0.4)
        self.deco.append({'k': 'watertower', 'x': round(x, 2), 'z': round(z, 2), 'h': h})
        rad = self.crate_stack(x + 4, z + 1, 0.3)
        self.props.append((x + 4, z + 1, rad))
        self.barrel(x - 3.5, z - 2.5)
        self.barrel(x - 3.0, z - 3.2)
        self.props.append((x - 3.3, z - 2.8, 1.0))

    def lm_ruins(self, x, z):
        rng = self.rng
        for i in range(7):
            a = rng.uniform(0, math.tau)
            rr = rng.uniform(2, 9)
            L = rng.uniform(2.0, 5.0)
            hgt = rng.uniform(0.8, 2.9)
            self.solid(x + math.cos(a) * rr, hgt / 2, z + math.sin(a) * rr, L / 2, hgt / 2, 0.3,
                       rng.uniform(0, math.pi), 'stone', rad=L / 2)
        for i in range(5):
            a = rng.uniform(0, math.tau)
            rr = rng.uniform(3, 10)
            px, pz = x + math.cos(a) * rr, z + math.sin(a) * rr
            ch = rng.uniform(1.5, 4.5)
            self.solid(px, ch / 2, pz, 0.32, ch / 2, 0.32, 0, 'inv', rad=0.5)
            self.deco.append({'k': 'column', 'x': round(px, 2), 'z': round(pz, 2), 'h': round(ch, 2)})
        for i in range(10):
            a = rng.uniform(0, math.tau)
            rr = rng.uniform(1, 11)
            s = rng.uniform(0.25, 0.6)
            self.solid(x + math.cos(a) * rr, s / 2, z + math.sin(a) * rr, s, s / 2, s * 0.8, rng.uniform(0, 3), 'stone')

    def lm_wreck(self, x, z):
        rng = self.rng
        yaw = rng.uniform(0, math.pi)
        self.solid(x, 0.75, z, 1.7, 0.75, 3.1, yaw, 'car', 5, rad=3.3)
        ox, oz = rot(0, -0.3, yaw)
        self.box(x + ox, 1.9, z + oz, 1.1, 0.4, 1.3, yaw + 0.25, 'car', 5)
        bx, bz = rot(0.2, -3.3, yaw + 0.25)
        self.box(x + bx, 1.95, z + bz, 0.12, 0.12, 1.8, yaw + 0.25, 'car', 5)
        self.deco.append({'k': 'wreck', 'x': round(x, 2), 'z': round(z, 2), 'yaw': round(yaw, 4)})
        self.deco.append({'k': 'scorch', 'x': round(x, 2), 'z': round(z, 2), 'r': 6})
        for i in range(2):
            a = rng.uniform(0, math.tau)
            self.car(x + math.cos(a) * 6, z + math.sin(a) * 6, rng.uniform(0, math.pi))
            self.props.append((x + math.cos(a) * 6, z + math.sin(a) * 6, 2.4))

    def lm_bazaar(self, x, z):
        rng = self.rng
        # line the stalls up along the nearest bit of road
        best = None
        for rd in self.roads:
            pts = rd['pts']
            for i in range(len(pts) - 1):
                d = seg_dist(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])
                if best is None or d < best[0]:
                    best = (d, pts[i], pts[i + 1], rd['w'])
        _, a, b, w = best
        ux, uz = b[0] - a[0], b[1] - a[1]
        L = math.hypot(ux, uz) or 1
        ux, uz = ux / L, uz / L
        yaw = math.atan2(ux, uz) + math.pi / 2
        for side in (-1, 1):
            for k in range(-2, 3):
                off = w / 2 + 1.8
                px = x + ux * k * 3.4 + (-uz) * off * side
                pz = z + uz * k * 3.4 + ux * off * side
                self.stall(px, pz, yaw)
                self.props.append((px, pz, 1.5))
        for k in range(5):
            self.deco.append({'k': 'rug', 'x': round(x + ux * (k - 2) * 3.4 + rng.uniform(-0.4, 0.4), 2),
                              'z': round(z + uz * (k - 2) * 3.4 + rng.uniform(-0.4, 0.4), 2),
                              'yaw': round(yaw + rng.uniform(-0.3, 0.3), 3), 'c': rng.randrange(6)})
        self.deco.append({'k': 'lanterns', 'a': [round(x - ux * 8, 2), round(z - uz * 8, 2)], 'b': [round(x + ux * 8, 2), round(z + uz * 8, 2)]})

    def lm_camelyard(self, x, z):
        rng = self.rng
        # a broken rail fence round an open yard, troughs and hay
        n = 16
        R = 10.5
        for i in range(n):
            if rng.random() < 0.3:
                continue
            a0, a1 = i / n * math.tau, (i + 1) / n * math.tau
            p0 = (x + math.cos(a0) * R, z + math.sin(a0) * R)
            p1 = (x + math.cos(a1) * R, z + math.sin(a1) * R)
            mx, mz = (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2
            L = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
            yaw = math.atan2(p1[0] - p0[0], p1[1] - p0[1]) - math.pi / 2
            self.solid(mx, 0.55, mz, L / 2, 0.06, 0.06, yaw, 'wood', rad=0.3)
            self.solid(mx, 0.95, mz, L / 2, 0.06, 0.06, yaw, 'wood', rad=0.3)
            self.solid(p0[0], 0.6, p0[1], 0.08, 0.6, 0.08, 0, 'wood', rad=0.2)
        for i in range(3):
            a = rng.uniform(0, math.tau)
            rr = rng.uniform(2, 6)
            self.solid(x + math.cos(a) * rr, 0.3, z + math.sin(a) * rr, 1.1, 0.3, 0.35, rng.uniform(0, 3), 'wood')
        for i in range(6):
            a = rng.uniform(0, math.tau)
            rr = rng.uniform(1.5, 8)
            self.solid(x + math.cos(a) * rr, 0.45, z + math.sin(a) * rr, 0.6, 0.45, 0.45, rng.uniform(0, 3), 'hay')
        self.deco.append({'k': 'paving', 'x': round(x, 2), 'z': round(z, 2), 'r': R, 'dirt': 1})

    def free(self, x, z, r, bmargin=1.6, pmargin=0.6, road=True):
        if abs(x) > self.bx - r - 0.8 or abs(z) > self.bz - r - 0.8:
            return False
        if road and self.road_dist(x, z) < r:
            return False
        for rc in self.rects:
            if point_in_rect(x, z, rc, r + bmargin):
                return False
        for (px, pz, pr) in self.props:
            if math.hypot(x - px, z - pz) < r + pr + pmargin:
                return False
        for (dx, dz) in self.doors:
            if math.hypot(x - dx, z - dz) < r + 1.4:
                return False
        return True

    def crate_stack(self, x, z, yaw):
        rng = self.rng
        s = rng.uniform(1.0, 1.25)
        self.box(x, s / 2, z, s / 2, s / 2, s / 2, yaw, 'crate')
        if rng.random() < 0.45:
            s2 = s * rng.uniform(0.75, 0.95)
            self.box(x, s + s2 / 2, z, s2 / 2, s2 / 2, s2 / 2, yaw + rng.uniform(-0.3, 0.3), 'crate')
        if rng.random() < 0.5:
            ox, oz = rot(s * 1.02, 0, yaw)
            s3 = s * rng.uniform(0.8, 1.0)
            self.box(x + ox, s3 / 2, z + oz, s3 / 2, s3 / 2, s3 / 2, yaw, 'crate')
            return s * 1.3
        return s * 0.8

    def portal(self, x, z, yaw, w=5.0, h=3.6):
        """A fake tunnel mouth in the boundary where a road ends: black inside.
        yaw is the direction the opening faces (the way you'd look into it)."""
        self.deco.append({'k': 'portal', 'x': round(x, 2), 'y': round(self.base_y, 2), 'z': round(z, 2),
                          'yaw': round(yaw, 4), 'w': w, 'h': h})

    def barrel(self, x, z):
        self.box(x, 0.5, z, 0.32, 0.5, 0.32, 0, 'inv')
        self.deco.append({'k': 'barrel', 'x': round(x, 2), 'y': round(self.base_y, 2), 'z': round(z, 2), 'c': self.rng.randrange(3)})

    def car(self, x, z, yaw):
        c = self.rng.randrange(5)
        self.box(x, 0.55, z, 2.1, 0.45, 0.9, yaw, 'car', c)
        ox, oz = rot(-0.2, 0, yaw)
        self.box(x + ox, 1.25, z + oz, 1.1, 0.3, 0.82, yaw, 'car', c)
        self.deco.append({'k': 'car', 'x': round(x, 2), 'y': round(self.base_y, 2), 'z': round(z, 2), 'yaw': round(yaw, 4), 'c': c})

    def stall(self, x, z, yaw):
        rng = self.rng
        self.box(x, 0.45, z, 1.3, 0.45, 0.55, yaw, 'wood')
        self.deco.append({'k': 'stall', 'x': round(x, 2), 'z': round(z, 2), 'yaw': round(yaw, 4),
                          'c': rng.randrange(6), 'g': rng.randrange(3)})

    def lowwall(self, x, z, yaw, L):
        self.box(x, 0.55, z, L / 2, 0.55, 0.3, yaw, 'stone')

    def place_props(self):
        rng = self.rng
        # bomb sites and hills get deliberate cover
        for label, (sx, sz) in (('A', self.site_a), ('B', self.site_b)):
            self.deco.append({'k': 'site', 'x': round(sx, 2), 'z': round(sz, 2), 'r': 4.5, 'l': label})
            for i in range(rng.choice([3, 4, 4, 5])):
                for _ in range(20):
                    a = rng.uniform(0, math.tau)
                    rr = rng.uniform(2.6, 6.0)
                    x, z = sx + math.cos(a) * rr, sz + math.sin(a) * rr
                    if self.free(x, z, 0.9, 0.8, 0.8):
                        kind = rng.random()
                        if kind < 0.6:
                            rad = self.crate_stack(x, z, rng.uniform(0, math.pi))
                            self.props.append((x, z, rad))
                        elif kind < 0.8:
                            self.lowwall(x, z, a + math.pi / 2, rng.uniform(2.5, 4))
                            self.props.append((x, z, 2.0))
                        else:
                            self.barrel(x, z)
                            self.props.append((x, z, 0.5))
                        break
        for (hx, hz) in self.hills:
            for i in range(4):
                for _ in range(20):
                    a = rng.uniform(0, math.tau)
                    rr = rng.uniform(3.0, 7.5)
                    x, z = hx + math.cos(a) * rr, hz + math.sin(a) * rr
                    if self.free(x, z, 1.4, 0.8, 0.8):
                        if i == 0:
                            self.stall(x, z, a + math.pi / 2)
                            self.props.append((x, z, 1.5))
                        elif i == 1 and rng.random() < 0.6:
                            self.car(x, z, rng.uniform(0, math.pi))
                            self.props.append((x, z, 2.4))
                        else:
                            rad = self.crate_stack(x, z, rng.uniform(0, math.pi))
                            self.props.append((x, z, rad))
                        break
        # the rest of the streets
        counts = [('crate', 26), ('barrel', 18), ('car', 7), ('stall', 9), ('wall', 12), ('palm', 16)]
        for kind, n in counts:
            for _ in range(n):
                for _t in range(30):
                    x = rng.uniform(-self.bx + 2, self.bx - 2)
                    z = rng.uniform(-self.bz + 2, self.bz - 2)
                    if any(math.hypot(x - a, z - b) < 7 for (a, b) in (self.spawn_w, self.spawn_e)):
                        continue
                    need = {'crate': 1.0, 'barrel': 0.5, 'car': 2.4, 'stall': 1.5, 'wall': 2.0, 'palm': 0.5}[kind]
                    if not self.free(x, z, need, 1.0 if kind != 'palm' else 0.4, 1.0):
                        continue
                    yaw = rng.uniform(0, math.pi)
                    if kind == 'crate':
                        need = self.crate_stack(x, z, yaw)
                    elif kind == 'barrel':
                        self.barrel(x, z)
                        if rng.random() < 0.5 and self.free(x + 0.75, z, 0.4, 0.6, 0.0):
                            self.barrel(x + 0.72, z + rng.uniform(-0.2, 0.2))
                            need = 1.1
                    elif kind == 'car':
                        self.car(x, z, yaw)
                    elif kind == 'stall':
                        self.stall(x, z, yaw)
                    elif kind == 'wall':
                        self.lowwall(x, z, yaw, rng.uniform(2.5, 5.0))
                    else:
                        self.box(x, 1.5, z, 0.2, 1.5, 0.2, 0, 'inv')
                        self.deco.append({'k': 'palm', 'x': round(x, 2), 'z': round(z, 2),
                                          'h': round(rng.uniform(5.5, 8.5), 2), 's': rng.randrange(1000)})
                    self.props.append((x, z, need))
                    break
        # cover near each spawn so nobody walks out into nothing
        for (sx, sz) in (self.spawn_w, self.spawn_e):
            for i in range(3):
                for _ in range(20):
                    x = sx + rng.uniform(-6, 6) * (0.5 if sx < 0 else 0.5) + (6 if sx < 0 else -6)
                    z = sz + rng.uniform(-9, 9)
                    if self.free(x, z, 1.0, 1.0, 1.0):
                        rad = self.crate_stack(x, z, rng.uniform(0, math.pi))
                        self.props.append((x, z, rad))
                        break

    def pick_spawns(self):
        rng = self.rng
        pts = []
        for _ in range(900):
            x = rng.uniform(-self.bx + 3, self.bx - 3)
            z = rng.uniform(-self.bz + 3, self.bz - 3)
            if self.free(x, z, 0.5, 0.9, 0.5):
                pts.append((x, z))
        chosen = []
        if pts:
            chosen.append(pts[rng.randrange(len(pts))])
            while len(chosen) < 64 and len(chosen) < len(pts):
                best, bd = None, -1
                for p in pts:
                    dd = min(math.hypot(p[0] - c[0], p[1] - c[1]) for c in chosen)
                    if dd > bd:
                        best, bd = p, dd
                chosen.append(best)
        self.ffa_spawns = [[round(x, 2), round(z, 2)] for (x, z) in chosen]

        # never spawn on a hatch: you'd drop straight into the tunnels
        self.ffa_spawns = [s for s in self.ffa_spawns
                           if all(abs(s[0] - hx) > HATCH_HALF + 0.8 or abs(s[1] - hz) > HATCH_HALF + 0.8
                                  for (hx, hz, _) in self.hatches)]

        def zone(cx, cz):
            out = []
            for _ in range(400):
                if len(out) >= 10:
                    break
                x = cx + rng.uniform(-5, 5)
                z = cz + rng.uniform(-7, 7)
                if self.free(x, z, 0.5, 0.9, 0.4) and all(math.hypot(x - a, z - b) > 1.6 for a, b in out):
                    out.append((x, z))
            out = [s for s in out
                   if all(abs(s[0] - hx) > HATCH_HALF + 0.8 or abs(s[1] - hz) > HATCH_HALF + 0.8
                          for (hx, hz, _) in self.hatches)]
            while len(out) < 8:
                out.append((cx + rng.uniform(-1, 1), cz + rng.uniform(-1, 1)))
            return [[round(x, 2), round(z, 2)] for (x, z) in out]

        self.team_spawns = [zone(*self.spawn_w), zone(*self.spawn_e)]

    def to_json(self):
        return {
            'seed': self.seed,
            'kind': self.kind,
            'name': self.name,
            'theme': self.theme,
            'bounds': [self.bx, self.bz],
            'boxes': self.boxes,
            'deco': self.deco,
            'sites': {'A': [round(self.site_a[0], 2), round(self.site_a[1], 2)],
                      'B': [round(self.site_b[0], 2), round(self.site_b[1], 2)]},
            'hills': [[round(x, 2), round(z, 2)] for (x, z) in self.hills],
            'teamSpawns': self.team_spawns,
            'ffaSpawns': self.ffa_spawns,
            'areas': self.areas,
            'tunnels': {'pits': self.pits, 'shafts': self.shafts, 'hatches': self.hatches,
                        'r': HATCH_HALF, 'floor': TUN_FLOOR, 'ceil': TUN_CEIL},
        }


MAP_KINDS = ('town', 'dock', 'alpine')


def generate(seed, kind='town'):
    """A finished map of the given kind: 'town', 'dock' or 'alpine'."""
    if kind == 'dock':
        import map_dock
        t = map_dock.Dockyard(seed)
    elif kind == 'alpine':
        import map_alpine
        t = map_alpine.Alpine(seed)
    else:
        t = Town(seed)
    t.generate()
    return t


# -- line of sight (used for grenades) -------------------------------------

class Solid:
    """The boxes of a town, prepared for segment tests."""

    def __init__(self, boxes):
        self.b = []
        for (cx, cy, cz, hx, hy, hz, yaw, mat, tint) in boxes:
            if mat == 'tile' and hy < 0.05:
                continue
            self.b.append((cx, cy, cz, hx, hy, hz, math.cos(yaw), math.sin(yaw),
                           math.sqrt(hx * hx + hy * hy + hz * hz)))

    def blocked(self, p, q):
        px, py, pz = p
        dx, dy, dz = q[0] - px, q[1] - py, q[2] - pz
        L = math.sqrt(dx * dx + dy * dy + dz * dz) or 1e-6
        for (cx, cy, cz, hx, hy, hz, c, s, rad) in self.b:
            # quick reject: distance from box centre to segment
            ox, oy, oz = cx - px, cy - py, cz - pz
            t = max(0.0, min(1.0, (ox * dx + oy * dy + oz * dz) / (L * L)))
            ex, ey, ez = ox - dx * t, oy - dy * t, oz - dz * t
            if ex * ex + ey * ey + ez * ez > rad * rad:
                continue
            # into box space
            rx, rz = -ox, -oz
            lx0 = c * rx - s * rz
            lz0 = s * rx + c * rz
            ly0 = -oy
            ldx = c * dx - s * dz
            ldz = s * dx + c * dz
            ldy = dy
            t0, t1 = 0.0, 1.0
            hit = True
            for (o, d, h) in ((lx0, ldx, hx), (ly0, ldy, hy), (lz0, ldz, hz)):
                if abs(d) < 1e-9:
                    if o < -h or o > h:
                        hit = False
                        break
                else:
                    a = (-h - o) / d
                    b = (h - o) / d
                    if a > b:
                        a, b = b, a
                    if a > t0:
                        t0 = a
                    if b < t1:
                        t1 = b
                    if t0 > t1:
                        hit = False
                        break
            if hit:
                return True
        return False


if __name__ == '__main__':
    import json
    import sys
    import time
    t0 = time.time()
    town = generate(int(sys.argv[1]) if len(sys.argv) > 1 else 1)
    j = town.to_json()
    print('buildings', len(town.rects), 'boxes', len(j['boxes']), 'deco', len(j['deco']),
          'ffa', len(j['ffaSpawns']), 'bytes', len(json.dumps(j, separators=(',', ':'))),
          'ms', int((time.time() - t0) * 1000))
