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


class Town:
    def __init__(self, seed):
        self.seed = seed
        self.rng = random.Random(seed)
        self.boxes = []
        self.deco = []
        self.rects = []      # building footprints, for placement tests
        self.props = []      # (x, z, radius) of street props
        self.doors = []      # world positions just outside each door

    # -- primitives -------------------------------------------------------

    def box(self, cx, cy, cz, hx, hy, hz, yaw=0.0, mat='wall', tint=0):
        if hx <= 0.005 or hy <= 0.005 or hz <= 0.005:
            return
        self.boxes.append([round(cx, 3), round(cy, 3), round(cz, 3),
                           round(hx, 3), round(hy, 3), round(hz, 3),
                           round(yaw, 4), mat, tint])

    # -- buildings --------------------------------------------------------

    def building(self, bx, bz, w, d, yaw, floors, tint):
        rng = self.rng
        hw, hd = w / 2, d / 2
        H = floors * STORY
        loc = []

        def lb(x0, x1, y0, y1, z0, z1, mat='wall'):
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

        # an internal partition wall with a doorway
        part = None
        lo = (stairs[1] + 1.8) if stairs else (-hw + 3.4)
        hi = hw - 3.4
        if w - 2 * WT > 9 and hi > lo and rng.random() < 0.85:
            px = rng.uniform(lo, hi)
            dz = rng.uniform(-hd + WT + 1.1, hd - WT - 1.1)
            part = (px, dz)

        # openings for each side and storey: (u, width, bottom, top)
        side_len = {'S': w, 'N': w, 'W': d - 2 * WT, 'E': d - 2 * WT}
        excl = {s: [] for s in 'SNWE'}
        if part:
            excl['S'].append((part[0] - 0.4, part[0] + 0.4))
            excl['N'].append((part[0] - 0.4, part[0] + 0.4))
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
        # parapet around the roof
        lb(-hw, hw, H, H + 0.55, -hd, -hd + WT)
        lb(-hw, hw, H, H + 0.55, hd - WT, hd)
        lb(-hw, -hw + WT, H, H + 0.55, -hd + WT, hd - WT)
        lb(hw - WT, hw, H, H + 0.55, -hd + WT, hd - WT)
        # roof
        lb(-hw, hw, H - 0.25, H, -hd, hd, 'roof')
        # interior floor tiles
        X0, X1, Z0, Z1 = -hw + WT, hw - WT, -hd + WT, hd - WT
        lb(X0, X1, 0.0, 0.03, Z0, Z1, 'tile')

        if part:
            px, dz = part
            ptop = STORY - 0.25 if floors == 2 else H - 0.25
            lb(px - 0.1, px + 0.1, 0, ptop, Z0, dz - 0.7)
            lb(px - 0.1, px + 0.1, 0, ptop, dz + 0.7, Z1)
            lb(px - 0.1, px + 0.1, 2.3, ptop, dz - 0.7, dz + 0.7)

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
            if part and abs(x - part[0]) < r + 0.9:
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
                if part and abs(x - part[0]) < 1.2:
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
                    self.deco.append({'k': 'awning', 'x': round(bx + wx, 2), 'y': 2.75,
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

        # buildings
        tints = 6
        for _ in range(4000):
            if len(self.rects) >= 42:
                break
            w = rng.uniform(7.5, 14.5)
            d = rng.uniform(7.5, 13.0)
            yaw = rng.choice([0.0, math.pi / 2]) + rng.uniform(-0.45, 0.45)
            x = rng.uniform(-BX + 6, BX - 6)
            z = rng.uniform(-BZ + 6, BZ - 6)
            r = (x, z, w / 2, d / 2, yaw)
            # inside the walls, with room for a street along them
            ok = True
            for (sx, sz) in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
                cxz = rot(sx * w / 2, sz * d / 2, yaw)
                if abs(x + cxz[0]) > BX - 3.2 or abs(z + cxz[1]) > BZ - 3.2:
                    ok = False
            if not ok:
                continue
            if any(circle_rect_dist(rx, rz, r) < rr for (rx, rz, rr) in reserved):
                continue
            gap = rng.uniform(2.8, 5.0)
            if any(rects_overlap(r, o, gap) for o in self.rects):
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
                floors = 2 if (w >= 8.2 and d >= 7.8 and rng.random() < 0.5) else 1
            tint = rng.randrange(tints)
            H = self.building(x, z, w, d, yaw, floors, tint)
            if i in dome_ids:
                self.deco.append({'k': 'dome', 'x': round(x, 2), 'y': round(H, 2), 'z': round(z, 2),
                                  'r': round(min(w, d) * 0.36, 2), 't': tint})
                if i == order[0]:
                    mx, mz = rot(hw - 1.4, -hd + 1.4, yaw)
                    self.deco.append({'k': 'minaret', 'x': round(x + mx, 2), 'y': round(H, 2),
                                      'z': round(z + mz, 2), 'h': 13.0, 't': tint})

        # the town wall
        wh = 6.0
        self.box(0, wh / 2, -BZ - 0.5, BX + 1, wh / 2, 0.5, 0, 'stone')
        self.box(0, wh / 2, BZ + 0.5, BX + 1, wh / 2, 0.5, 0, 'stone')
        self.box(-BX - 0.5, wh / 2, 0, 0.5, wh / 2, BZ, 0, 'stone')
        self.box(BX + 0.5, wh / 2, 0, 0.5, wh / 2, BZ, 0, 'stone')

        self.place_props()
        self.pick_spawns()

    def free(self, x, z, r, bmargin=1.6, pmargin=0.6):
        if abs(x) > BX - r - 0.8 or abs(z) > BZ - r - 0.8:
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

    def barrel(self, x, z):
        self.box(x, 0.5, z, 0.32, 0.5, 0.32, 0, 'inv')
        self.deco.append({'k': 'barrel', 'x': round(x, 2), 'z': round(z, 2), 'c': self.rng.randrange(3)})

    def car(self, x, z, yaw):
        c = self.rng.randrange(5)
        self.box(x, 0.55, z, 2.1, 0.45, 0.9, yaw, 'car', c)
        ox, oz = rot(-0.2, 0, yaw)
        self.box(x + ox, 1.25, z + oz, 1.1, 0.3, 0.82, yaw, 'car', c)

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
                    x = rng.uniform(-BX + 2, BX - 2)
                    z = rng.uniform(-BZ + 2, BZ - 2)
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
            x = rng.uniform(-BX + 3, BX - 3)
            z = rng.uniform(-BZ + 3, BZ - 3)
            if self.free(x, z, 0.5, 0.9, 0.5):
                pts.append((x, z))
        chosen = []
        if pts:
            chosen.append(pts[rng.randrange(len(pts))])
            while len(chosen) < 36 and len(chosen) < len(pts):
                best, bd = None, -1
                for p in pts:
                    dd = min(math.hypot(p[0] - c[0], p[1] - c[1]) for c in chosen)
                    if dd > bd:
                        best, bd = p, dd
                chosen.append(best)
        self.ffa_spawns = [[round(x, 2), round(z, 2)] for (x, z) in chosen]

        def zone(cx, cz):
            out = []
            for _ in range(400):
                if len(out) >= 10:
                    break
                x = cx + rng.uniform(-5, 5)
                z = cz + rng.uniform(-7, 7)
                if self.free(x, z, 0.5, 0.9, 0.4) and all(math.hypot(x - a, z - b) > 1.6 for a, b in out):
                    out.append((x, z))
            while len(out) < 8:
                out.append((cx + rng.uniform(-1, 1), cz + rng.uniform(-1, 1)))
            return [[round(x, 2), round(z, 2)] for (x, z) in out]

        self.team_spawns = [zone(*self.spawn_w), zone(*self.spawn_e)]

    def to_json(self):
        return {
            'seed': self.seed,
            'bounds': [BX, BZ],
            'boxes': self.boxes,
            'deco': self.deco,
            'sites': {'A': [round(self.site_a[0], 2), round(self.site_a[1], 2)],
                      'B': [round(self.site_b[0], 2), round(self.site_b[1], 2)]},
            'hills': [[round(x, 2), round(z, 2)] for (x, z) in self.hills],
            'teamSpawns': self.team_spawns,
            'ffaSpawns': self.ffa_spawns,
        }


def generate(seed):
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
