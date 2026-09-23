"""
The Dockyard: a shipping container port.

Laid out like a working yard: a main lane the length of it, a crossing
road at each end, and everything else parked in the blocks between, so
the roads stay clear. Rows of stacked containers make short lanes,
corners and flanks around an open loading bay in the middle; two
warehouses, a fuel yard, a small office, gantry cranes and forklifts.

Bomb sites: A inside the west warehouse, B in the fuel yard.
Hills: the loading bay, and a yard either side of it.
"""

import math

import mapgen
from mapgen import Town, rot, point_in_rect, STORY, STEP_N, STEP_D

# a 40 ft container and a 20 ft one, half sizes
C_LEN, C_HALF, C_H = 6.1, 1.3, 2.6
S_LEN = 3.05
LANE_W = 7.0            # the main lane
CROSS_W = 6.0           # the crossing roads
CROSS_X = 47.0          # where they cross, east and west


def sx_end(hw, wt):
    """Where a shed's mezzanine stairs end along the north wall (they start at the west end)."""
    return -hw + wt + 0.6 + STEP_N * STEP_D


class Dockyard(Town):
    kind = 'dock'
    name = 'The Dockyard'
    theme = 'concrete'

    def __init__(self, seed):
        Town.__init__(self, seed)
        self.bx, self.bz = 62.0, 46.0

    # -- pieces ------------------------------------------------------------

    def container(self, x, z, yaw, level=0, long=True, tint=None, hollow=False):
        rng = self.rng
        hx = C_LEN if long else S_LEN
        t = rng.randrange(6) if tint is None else tint
        cy = C_H / 2 + level * C_H
        if hollow and level == 0:
            th = 0.08
            self.box(x, 0.05, z, hx, 0.05, C_HALF, yaw, 'container', t)
            self.box(x, C_H - th / 2, z, hx, th / 2, C_HALF, yaw, 'container', t)
            for side in (-1, 1):
                ox, oz = rot(0, side * (C_HALF - th / 2), yaw)
                self.box(x + ox, C_H / 2, z + oz, hx, C_H / 2, th / 2, yaw, 'container', t)
        else:
            self.box(x, cy, z, hx, C_H / 2, C_HALF, yaw, 'container', t)
        # the trim that makes it read as a container: posts, rails, doors
        self.deco.append({'k': 'cbox', 'x': round(x, 2), 'z': round(z, 2), 'yaw': round(yaw, 4), 'lv': level, 'l': hx, 't': t,
                          'open': 1 if (hollow and level == 0) else 0})
        if level == 0:
            self.rects.append((x, z, hx, C_HALF, yaw))
        return hx

    def stack(self, x, z, yaw, levels, long=True, hollow=False):
        for lv in range(levels):
            self.container(x, z, yaw, lv, long, None, hollow and lv == 0)

    def step_up(self, x, z, yaw):
        self.box(x, 0.5, z, 0.55, 0.5, 0.55, yaw, 'crate')
        self.box(x, 1.45, z, 0.5, 0.45, 0.5, yaw + 0.2, 'crate')
        self.props.append((x, z, 0.9))

    def forklift(self, x, z, yaw):
        # driveable: no fixed collision box; the game gives it one that moves with it
        fid = sum(1 for d in self.deco if d['k'] == 'forklift') + 1
        self.deco.append({'k': 'forklift', 'id': fid, 'x': round(x, 2), 'y': 0.0, 'z': round(z, 2), 'yaw': round(yaw, 4)})
        self.props.append((x, z, 1.4))

    def tank(self, x, z, r, h):
        for k in range(4):
            self.box(x, h / 2, z, r * 0.97, h / 2, r * 0.42, k * math.pi / 4, 'inv')
        self.deco.append({'k': 'tank', 'x': round(x, 2), 'z': round(z, 2), 'r': r, 'h': h})
        self.props.append((x, z, r + 0.4))

    def mast(self, x, z):
        self.box(x, 6, z, 0.22, 6, 0.22, 0, 'steel', 2)
        self.deco.append({'k': 'mast', 'x': round(x, 2), 'z': round(z, 2), 'h': 12})
        self.props.append((x, z, 0.6))

    def jersey(self, x, z, yaw, n=1):
        for i in range(n):
            ox, oz = rot((i - (n - 1) / 2) * 2.05, 0, yaw)
            self.box(x + ox, 0.45, z + oz, 1.0, 0.45, 0.3, yaw, 'concrete', 1)
        self.props.append((x, z, n * 1.05 + 0.3))

    def crane(self, x, z, yaw, span, height):
        for side in (-1, 1):
            ox, oz = rot(0, side * span / 2, yaw)
            for dx in (-1.6, 1.6):
                lx, lz = rot(dx, side * span / 2, yaw)
                self.box(x + lx, height / 2, z + lz, 0.35, height / 2, 0.35, yaw, 'steel', 0)
            self.props.append((x + ox, z + oz, 2.4))
        self.box(x, height + 0.5, z, 2.0, 0.5, span / 2 + 1.5, yaw, 'steel', 0)
        self.deco.append({'k': 'crane', 'x': round(x, 2), 'z': round(z, 2), 'yaw': round(yaw, 4), 'span': span, 'h': height})

    def shed(self, x, z, w, d, yaw, tint, keep_clear=None):
        """A warehouse: steel walls, a roller door on the south and east, a mezzanine."""
        rng = self.rng
        hw, hd = w / 2, d / 2
        H = 6.5
        WT = 0.25
        loc = []

        def lb(x0, x1, y0, y1, z0, z1, mat='steel', t=tint):
            if x1 - x0 > 0.01 and y1 - y0 > 0.01 and z1 - z0 > 0.01:
                loc.append(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, mat, t))

        dw, dh = 2.6, 4.2
        du = rng.uniform(-hw + 5, hw - 5)
        lb(-hw, du - dw, 0, H, -hd, -hd + WT)
        lb(du + dw, hw, 0, H, -hd, -hd + WT)
        lb(du - dw, du + dw, dh, H, -hd, -hd + WT)
        pu = rng.uniform(sx_end(hw, WT) + 1.6, hw - 3)      # the person door clear of the stairs
        lb(-hw, pu - 0.8, 0, H, hd - WT, hd)
        lb(pu + 0.8, hw, 0, H, hd - WT, hd)
        lb(pu - 0.8, pu + 0.8, 2.4, H, hd - WT, hd)
        ev = rng.uniform(-hd + 3.5, hd - 3.5)
        lb(hw - WT, hw, 0, H, -hd + WT, ev - dw)
        lb(hw - WT, hw, 0, H, ev + dw, hd - WT)
        lb(hw - WT, hw, dh, H, ev - dw, ev + dw)
        lb(-hw, -hw + WT, 0, 3.4, -hd + WT, hd - WT)
        lb(-hw, -hw + WT, 4.6, H, -hd + WT, hd - WT)
        for k in range(int(d // 2.4)):
            zz = -hd + WT + 1.2 + k * 2.4
            lb(-hw, -hw + WT, 3.4, 4.6, zz - 0.15, zz + 0.15)
        lb(-hw, hw, H - 0.2, H, -hd, hd, 'flatroof', tint)
        lb(-hw, hw, H, H + 0.4, -hd, -hd + WT, 'steel')
        lb(-hw, hw, H, H + 0.4, hd - WT, hd, 'steel')
        lb(-hw, -hw + WT, H, H + 0.4, -hd, hd, 'steel')
        lb(hw - WT, hw, H, H + 0.4, -hd, hd, 'steel')
        lb(-hw + WT, hw - WT, 0, 0.04, -hd + WT, hd - WT, 'concrete', 0)
        my = 3.2
        depth = 4.2
        sx0 = -hw + WT + 0.6
        sx1 = sx0 + STEP_N * STEP_D
        rise = my / STEP_N
        for i in range(STEP_N):
            lb(sx0 + i * STEP_D, sx0 + (i + 1) * STEP_D, 0, (i + 1) * rise, hd - WT - 1.3, hd - WT, 'stair')
        lb(sx1, hw - WT, my - 0.2, my, hd - WT - depth, hd - WT, 'concrete', 1)
        lb(sx1, hw - WT, my, my + 1.0, hd - WT - depth, hd - WT - depth + 0.08, 'steel', 2)
        lb(sx1 - 0.08, sx1, my, my + 1.0, hd - WT - depth, hd - WT - 1.3, 'steel', 2)
        for k in range(3):
            px = sx1 + 2 + k * ((hw - WT - sx1 - 4) / 2)
            lb(px - 0.12, px + 0.12, 0, H - 0.2, hd - WT - depth - 0.12, hd - WT - depth + 0.12, 'steel', 2)
        for row in range(2):
            zz = -hd + 3.5 + row * 4.0
            for k in range(int((w - 8) // 2.2)):
                xx = -hw + 4 + k * 2.2
                if abs(xx - du) < 3.4 and zz < -hd + 5:
                    continue
                if keep_clear and math.hypot(xx - keep_clear[0], zz - keep_clear[1]) < 3.2:
                    continue
                if rng.random() < 0.7:
                    sz = rng.uniform(0.9, 1.15)
                    lb(xx - sz / 2, xx + sz / 2, 0, sz, zz - sz / 2, zz + sz / 2, 'crate', 0)
                    if rng.random() < 0.45:
                        lb(xx - sz / 2 + 0.1, xx + sz / 2 - 0.1, sz, sz * 1.8, zz - sz / 2 + 0.1, zz + sz / 2 - 0.1, 'crate', 0)
        for (cx, cy, cz, hx, hy, hz, mat, t) in loc:
            wx, wz = rot(cx, cz, yaw)
            self.box(x + wx, cy, z + wz, hx, hy, hz, yaw, mat, t)
        self.rects.append((x, z, hw, hd, yaw))
        for (lx, lz) in ((du, -hd - 1.2), (pu, hd + 1.2), (hw + 1.2, ev)):
            wx, wz = rot(lx, lz, yaw)
            self.doors.append((x + wx, z + wz))
        return H

    def on_road(self, x, z, r):
        """Would something of radius r here sit on the main lane or a crossing?"""
        return abs(z) < LANE_W / 2 + r or abs(abs(x) - CROSS_X) < CROSS_W / 2 + r

    # -- the yard ----------------------------------------------------------

    def generate(self):
        rng = self.rng
        bx, bz = self.bx, self.bz
        self.spawn_w = (-56.0, 0.0)
        self.spawn_e = (56.0, 0.0)
        self.site_a = (-32.0, -23.0)      # inside the west warehouse
        self.site_b = (32.0, 27.0)        # the fuel yard
        self.hills = [(0.0, 0.0), (-32.0, 11.0), (32.0, -11.0)]

        wh = 3.6
        self.box(0, wh / 2, -bz - 0.5, bx + 1, wh / 2, 0.5, 0, 'concrete', 0)
        self.box(0, wh / 2, bz + 0.5, bx + 1, wh / 2, 0.5, 0, 'concrete', 0)
        self.box(-bx - 0.5, wh / 2, 0, 0.5, wh / 2, bz, 0, 'concrete', 0)
        self.box(bx + 0.5, wh / 2, 0, 0.5, wh / 2, bz, 0, 'concrete', 0)

        # the roads: the lane, and a crossing at each end between the blocks and the quays
        self.roads.append({'w': LANE_W, 'c': 'asphalt', 'pts': [(-bx, 0.0), (bx, 0.0)]})
        self.roads.append({'w': CROSS_W, 'c': 'asphalt', 'pts': [(-CROSS_X, -bz), (-CROSS_X, bz)]})
        self.roads.append({'w': CROSS_W, 'c': 'asphalt', 'pts': [(CROSS_X, -bz), (CROSS_X, bz)]})

        # the blocks: warehouses north, the office and fuel yard south, all off the roads
        self.shed(-32.0, -24.0, 22.0, 13.0, 0.0, 3, keep_clear=(0.0, 1.0))   # x -43..-21, z -30.5..-17.5
        self.shed(32.0, -24.0, 22.0, 13.0, 0.0, 4)                           # x 21..43
        self.building(-32.0, 27.0, 12.0, 10.0, 0.0, 2, 4, 'concrete')        # x -38..-26, z 22..32
        self.rects.append((-32.0, 27.0, 6.0, 5.0, 0.0))
        self.areas.append({'n': 'West Warehouse', 'x': -32.0, 'z': -24.0, 'r': 13})
        self.areas.append({'n': 'East Warehouse', 'x': 32.0, 'z': -24.0, 'r': 13})
        self.areas.append({'n': 'The Office', 'x': -32.0, 'z': 27.0, 'r': 8})

        # the fuel yard: tanks inside a bund wall, barrels about
        fx, fz = 32.0, 27.0
        self.tank(fx - 5.5, fz - 3.5, 3.0, 4.5)
        self.tank(fx + 5.5, fz - 3.5, 3.0, 4.5)
        self.tank(fx, fz + 6.5, 2.2, 3.6)
        self.lowwall(fx - 10.5, fz + 1, math.pi / 2, 13)
        self.lowwall(fx + 10.5, fz + 1, math.pi / 2, 13)
        for k in range(-6, 7, 2):
            self.props.append((fx - 10.5, fz + 1 + k, 0.8))
            self.props.append((fx + 10.5, fz + 1 + k, 0.8))
        for i in range(7):
            a = rng.uniform(0, math.tau)
            rr = rng.uniform(3.5, 9.0)
            px, pz = fx + math.cos(a) * rr, fz + math.sin(a) * rr
            if self.free(px, pz, 0.5, 0.4, 0.4, road=False) and not self.on_road(px, pz, 0.6):
                self.barrel(px, pz)
                self.props.append((px, pz, 0.5))
        self.areas.append({'n': 'Fuel Yard', 'x': fx, 'z': fz, 'r': 12})

        # container rows around the loading bay: the lane (|z| < 3.5) stays clear
        def row(x0, z0, n, yaw, levels, spacing=C_LEN * 2 + 0.6):
            for i in range(n):
                ox, oz = rot(i * spacing, 0, yaw)
                x, z = x0 + ox, z0 + oz
                lv = levels[i % len(levels)]
                hollow = lv == 1 and rng.random() < 0.3
                self.stack(x, z, yaw, lv, True, hollow)
                if lv == 1 and not hollow and rng.random() < 0.5:
                    sx, sz = rot(0, (C_HALF + 0.75) * (1 if rng.random() < 0.5 else -1), yaw)
                    self.step_up(x + sx, z + sz, yaw)

        # north and south of the bay: pairs of rows along x, centred on the bay
        row(-6.5, -9.0, 2, 0.0, [2, 1], 13.0)
        row(-6.5, 9.0, 2, 0.0, [1, 2], 13.0)
        row(-6.5, -15.5, 2, 0.0, [1, 3], 13.0)
        row(-6.5, 15.5, 2, 0.0, [3, 1], 13.0)
        # east and west of the bay: short rows along z, off the lane
        for sx in (-1, 1):
            row(sx * 17.0, -6.0 - C_LEN, 1, math.pi / 2, [2])
            row(sx * 17.0, 6.0 + C_LEN, 1, math.pi / 2, [1])
        # the quays beyond the crossings: 20 ft boxes and the cranes
        for sx in (-1, 1):
            self.container(sx * 56.0, -20.0, 0.0, 0, False)
            self.container(sx * 56.0, -20.0, 0.0, 1, False)
            self.container(sx * 56.0, 20.0, 0.0, 0, False)
            self.container(sx * 56.0, 32.0, math.pi / 2, 0, False)
            self.container(sx * 56.0, -32.0, math.pi / 2, 0, False)
        self.crane(-56.0, 0.0, 0.0, 22.0, 13.0)
        self.crane(56.0, 0.0, 0.0, 22.0, 13.0)
        # rows behind the warehouses and beside the office and fuel yard
        row(-43.0 + C_LEN, -39.0, 1, 0.0, [2])
        row(21.0, -39.0, 1, 0.0, [1])
        row(-43.0 + C_LEN, 39.0, 1, 0.0, [1])
        row(21.0, 39.0, 1, 0.0, [2])
        row(-21.0, 22.0 + C_LEN, 1, math.pi / 2, [2])
        row(21.0, 12.0 + C_LEN, 1, math.pi / 2, [1])
        # single short containers as scattered cover in the yards, never on a road
        for _ in range(80):
            if sum(1 for r in self.rects if r[2] == S_LEN) >= 16:
                break
            x = rng.uniform(-bx + 6, bx - 6)
            z = rng.uniform(-bz + 6, bz - 6)
            if self.on_road(x, z, 3.6):
                continue
            if self.free(x, z, 3.6, 1.2, 1.0, road=False):
                self.container(x, z, rng.choice([0.0, math.pi / 2]) + rng.uniform(-0.2, 0.2), 0, False)

        self.areas.append({'n': 'West Quay', 'x': -56.0, 'z': 0.0, 'r': 12})
        self.areas.append({'n': 'East Quay', 'x': 56.0, 'z': 0.0, 'r': 12})
        self.areas.append({'n': 'Loading Bay', 'x': 0.0, 'z': 0.0, 'r': 12})
        for _ in range(100):
            if sum(1 for d in self.deco if d['k'] == 'forklift') >= 5:
                break
            x = rng.uniform(-bx + 5, bx - 5)
            z = rng.uniform(-bz + 5, bz - 5)
            if self.free(x, z, 1.6, 1.0, 0.8, road=False) and not self.on_road(x, z, 1.6):
                self.forklift(x, z, rng.uniform(0, math.tau))
        for (x, z) in ((-bx + 4, -bz + 4), (bx - 4, -bz + 4), (-bx + 4, bz - 4), (bx - 4, bz - 4), (0, -bz + 3), (0, bz - 3)):
            self.mast(x, z)
        # barriers at the gates, along the kerb of the lane, not across it
        self.jersey(-58.0, -5.5, 0.0, 3)
        self.jersey(58.0, 5.5, 0.0, 3)
        # cover round the hills, off the roads
        for (hx, hz) in self.hills:
            for i in range(4):
                for _ in range(24):
                    a = rng.uniform(0, math.tau)
                    rr = rng.uniform(3.0, 7.0)
                    x, z = hx + math.cos(a) * rr, hz + math.sin(a) * rr
                    if self.on_road(x, z, 1.4):
                        continue
                    if self.free(x, z, 0.9, 0.8, 0.8, road=False):
                        if rng.random() < 0.5:
                            rad = self.crate_stack(x, z, rng.uniform(0, math.pi))
                            self.props.append((x, z, rad))
                        else:
                            self.jersey(x, z, a + math.pi / 2, 1)
                        break
        for label, (sx, sz) in (('A', self.site_a), ('B', self.site_b)):
            self.deco.append({'k': 'site', 'x': round(sx, 2), 'z': round(sz, 2), 'r': 4.5, 'l': label})
        for rd in self.roads:
            self.deco.append({'k': 'road', 'w': rd['w'], 'c': rd['c'], 'pts': [[round(x, 2), round(z, 2)] for (x, z) in rd['pts']]})
        # painted bay lines either side of the lane by the loading bay, running across it
        for i in range(-3, 4):
            for sz in (-1, 1):
                self.deco.append({'k': 'lines', 'x': i * 3.0, 'z': sz * 6.0, 'l': 5.0, 'yaw': 0.0})
        # the roads run on into the dark: tunnel mouths in the perimeter
        self.portal(-bx + 0.02, 0.0, math.pi / 2, LANE_W - 0.6, 3.3)
        self.portal(bx - 0.02, 0.0, -math.pi / 2, LANE_W - 0.6, 3.3)
        for cx in (-CROSS_X, CROSS_X):
            self.portal(cx, -bz + 0.02, 0.0, CROSS_W - 0.6, 3.3)
            self.portal(cx, bz - 0.02, math.pi, CROSS_W - 0.6, 3.3)
        self.areas.append({'n': 'West Gate', 'x': self.spawn_w[0], 'z': 0.0, 'r': 10})
        self.areas.append({'n': 'East Gate', 'x': self.spawn_e[0], 'z': 0.0, 'r': 10})
        self.pick_spawns()

    def road_dist(self, x, z):
        # the asphalt is open ground: spawns and props may use it (props check on_road themselves)
        return 1e9
