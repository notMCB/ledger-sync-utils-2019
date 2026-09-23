"""
The Dockyard: a shipping container port.

Rows of stacked containers make short lanes, corners and flanks around an
open loading bay in the middle; one long sightline runs the length of the
yard. Two warehouses, a fuel yard, a small office, gantry cranes, forklifts.

Bomb sites: A inside the west warehouse, B in the fuel yard.
Hills: the loading bay, and the yards either side of it.
"""

import math

import mapgen
from mapgen import Town, rot, point_in_rect, STORY, STEP_N, STEP_D

# a 40 ft container and a 20 ft one, half sizes
C_LEN, C_HALF, C_H = 6.1, 1.3, 2.6
S_LEN = 3.05


class Dockyard(Town):
    kind = 'dock'
    name = 'The Dockyard'
    theme = 'concrete'

    def __init__(self, seed):
        Town.__init__(self, seed)
        self.bx, self.bz = 62.0, 46.0
        self.lanes = []        # painted lane lines: (x0, z0, x1, z1)

    # -- pieces ------------------------------------------------------------

    def container(self, x, z, yaw, level=0, long=True, tint=None, hollow=False):
        """One container at stack level `level` (0 = on the ground)."""
        rng = self.rng
        hx = C_LEN if long else S_LEN
        t = rng.randrange(6) if tint is None else tint
        cy = C_H / 2 + level * C_H
        if hollow and level == 0:
            # open at both ends: a walk-through
            th = 0.08
            self.box(x, 0.05, z, hx, 0.05, C_HALF, yaw, 'container', t)                          # floor
            self.box(x, C_H - th / 2, z, hx, th / 2, C_HALF, yaw, 'container', t)                # roof
            for side in (-1, 1):
                ox, oz = rot(0, side * (C_HALF - th / 2), yaw)
                self.box(x + ox, C_H / 2, z + oz, hx, C_H / 2, th / 2, yaw, 'container', t)     # sides
            self.deco.append({'k': 'cdoor', 'x': round(x, 2), 'y': 0, 'z': round(z, 2), 'yaw': round(yaw, 4), 'l': hx})
        else:
            self.box(x, cy, z, hx, C_H / 2, C_HALF, yaw, 'container', t)
        if level == 0:
            self.rects.append((x, z, hx, C_HALF, yaw))
        return hx

    def stack(self, x, z, yaw, levels, long=True, hollow=False):
        for lv in range(levels):
            self.container(x, z, yaw, lv, long, None, hollow and lv == 0)

    def step_up(self, x, z, yaw):
        """Two crates, one on the other, so a container's roof can be climbed."""
        self.box(x, 0.5, z, 0.55, 0.5, 0.55, yaw, 'crate')
        ox, oz = rot(0.0, 0.0, yaw)
        self.box(x + ox, 1.45, z + oz, 0.5, 0.45, 0.5, yaw + 0.2, 'crate')
        self.props.append((x, z, 0.9))

    def forklift(self, x, z, yaw):
        self.box(x, 0.6, z, 1.15, 0.6, 0.6, yaw, 'inv')
        self.deco.append({'k': 'forklift', 'x': round(x, 2), 'z': round(z, 2), 'yaw': round(yaw, 4)})
        self.props.append((x, z, 1.4))

    def tank(self, x, z, r, h):
        """A round fuel tank: eight-sided collision, drawn as a cylinder."""
        for k in range(4):
            self.box(x, h / 2, z, r * 0.97, h / 2, r * 0.42, k * math.pi / 4, 'inv')
        self.deco.append({'k': 'tank', 'x': round(x, 2), 'z': round(z, 2), 'r': r, 'h': h})
        self.props.append((x, z, r + 0.4))

    def mast(self, x, z):
        self.box(x, 6, z, 0.22, 6, 0.22, 0, 'steel', 2)
        self.deco.append({'k': 'mast', 'x': round(x, 2), 'z': round(z, 2), 'h': 12})
        self.props.append((x, z, 0.6))

    def jersey(self, x, z, yaw, n=1):
        """Concrete road barriers end to end."""
        for i in range(n):
            ox, oz = rot((i - (n - 1) / 2) * 2.05, 0, yaw)
            self.box(x + ox, 0.45, z + oz, 1.0, 0.45, 0.3, yaw, 'concrete', 1)
        self.props.append((x, z, n * 1.05 + 0.3))

    def crane(self, x, z, yaw, span, height):
        """A gantry crane: two legs and a beam; the legs are solid."""
        for side in (-1, 1):
            ox, oz = rot(0, side * span / 2, yaw)
            for dx in (-1.6, 1.6):
                lx, lz = rot(dx, side * span / 2, yaw)
                self.box(x + lx, height / 2, z + lz, 0.35, height / 2, 0.35, yaw, 'steel', 0)
            self.props.append((x + ox, z + oz, 2.4))
        self.box(x, height + 0.5, z, 2.0, 0.5, span / 2 + 1.5, yaw, 'steel', 0)      # the beam
        self.deco.append({'k': 'crane', 'x': round(x, 2), 'z': round(z, 2), 'yaw': round(yaw, 4),
                          'span': span, 'h': height})

    def shed(self, x, z, w, d, yaw, tint, keep_clear=None):
        """A warehouse: steel walls, a big roller door on two sides, a mezzanine."""
        rng = self.rng
        hw, hd = w / 2, d / 2
        H = 6.5
        WT = 0.25
        loc = []

        def lb(x0, x1, y0, y1, z0, z1, mat='steel', t=tint):
            if x1 - x0 > 0.01 and y1 - y0 > 0.01 and z1 - z0 > 0.01:
                loc.append(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, mat, t))

        # south wall with a roller door in the middle; north wall with a person door
        dw, dh = 2.6, 4.2
        du = rng.uniform(-hw + 5, hw - 5)
        lb(-hw, du - dw, 0, H, -hd, -hd + WT)
        lb(du + dw, hw, 0, H, -hd, -hd + WT)
        lb(du - dw, du + dw, dh, H, -hd, -hd + WT)
        pu = rng.uniform(-hw + 3, hw - 3)
        lb(-hw, pu - 0.8, 0, H, hd - WT, hd)
        lb(pu + 0.8, hw, 0, H, hd - WT, hd)
        lb(pu - 0.8, pu + 0.8, 2.4, H, hd - WT, hd)
        # east wall with a second roller door, west wall with a window strip
        ev = rng.uniform(-hd + 3.5, hd - 3.5)
        lb(hw - WT, hw, 0, H, -hd + WT, ev - dw)
        lb(hw - WT, hw, 0, H, ev + dw, hd - WT)
        lb(hw - WT, hw, dh, H, ev - dw, ev + dw)
        lb(-hw, -hw + WT, 0, 3.4, -hd + WT, hd - WT)
        lb(-hw, -hw + WT, 4.6, H, -hd + WT, hd - WT)
        for k in range(int(d // 2.4)):
            zz = -hd + WT + 1.2 + k * 2.4
            lb(-hw, -hw + WT, 3.4, 4.6, zz - 0.15, zz + 0.15)                 # window mullions
        # roof and a low parapet
        lb(-hw, hw, H - 0.2, H, -hd, hd, 'flatroof', tint)
        lb(-hw, hw, H, H + 0.4, -hd, -hd + WT, 'steel')
        lb(-hw, hw, H, H + 0.4, hd - WT, hd, 'steel')
        lb(-hw, -hw + WT, H, H + 0.4, -hd, hd, 'steel')
        lb(hw - WT, hw, H, H + 0.4, -hd, hd, 'steel')
        lb(-hw + WT, hw - WT, 0, 0.04, -hd + WT, hd - WT, 'concrete', 0)      # floor
        # mezzanine along the north wall, up a flight of stairs at the west end
        my = 3.2
        depth = 4.2
        sx0 = -hw + WT + 0.6
        sx1 = sx0 + STEP_N * STEP_D
        rise = my / STEP_N
        for i in range(STEP_N):
            lb(sx0 + i * STEP_D, sx0 + (i + 1) * STEP_D, 0, (i + 1) * rise, hd - WT - 1.3, hd - WT, 'stair')
        lb(sx1, hw - WT, my - 0.2, my, hd - WT - depth, hd - WT, 'concrete', 1)   # the deck
        lb(sx1, hw - WT, my, my + 1.0, hd - WT - depth, hd - WT - depth + 0.08, 'steel', 2)   # railing
        lb(sx1 - 0.08, sx1, my, my + 1.0, hd - WT - depth, hd - WT - 1.3, 'steel', 2)
        for k in range(3):                                                          # posts to the roof
            px = sx1 + 2 + k * ((hw - WT - sx1 - 4) / 2)
            lb(px - 0.12, px + 0.12, 0, H - 0.2, hd - WT - depth - 0.12, hd - WT - depth + 0.12, 'steel', 2)
        # racking: rows of crates on the floor, leaving the doors clear
        for row in range(2):
            zz = -hd + 3.5 + row * 4.0
            for k in range(int((w - 8) // 2.2)):
                xx = -hw + 4 + k * 2.2
                if abs(xx - du) < 3.4 and zz < -hd + 5:
                    continue
                if keep_clear and math.hypot(xx - keep_clear[0], zz - keep_clear[1]) < 3.2:
                    continue      # a bomb site stays open
                if rng.random() < 0.7:
                    sz = rng.uniform(0.9, 1.15)
                    lb(xx - sz / 2, xx + sz / 2, 0, sz, zz - sz / 2, zz + sz / 2, 'crate', 0)
                    if rng.random() < 0.45:
                        lb(xx - sz / 2 + 0.1, xx + sz / 2 - 0.1, sz, sz * 1.8, zz - sz / 2 + 0.1, zz + sz / 2 - 0.1, 'crate', 0)
        # to world
        for (cx, cy, cz, hx, hy, hz, mat, t) in loc:
            wx, wz = rot(cx, cz, yaw)
            self.box(x + wx, cy, z + wz, hx, hy, hz, yaw, mat, t)
        self.rects.append((x, z, hw, hd, yaw))
        # door approach points keep spawns and props off the thresholds
        for (lx, lz) in ((du, -hd - 1.2), (pu, hd + 1.2), (hw + 1.2, ev)):
            wx, wz = rot(lx, lz, yaw)
            self.doors.append((x + wx, z + wz))
        return H

    # -- the yard ----------------------------------------------------------

    def generate(self):
        rng = self.rng
        bx, bz = self.bx, self.bz
        self.spawn_w = (-54.0, rng.uniform(-6, 6))
        self.spawn_e = (54.0, rng.uniform(-6, 6))
        self.site_a = (-31.0, -25.0)      # inside the west warehouse
        self.site_b = (31.0, 25.0)        # the fuel yard
        self.hills = [(0.0, 0.0), (-33.0, 2.0), (33.0, -2.0)]

        # perimeter wall
        wh = 3.6
        self.box(0, wh / 2, -bz - 0.5, bx + 1, wh / 2, 0.5, 0, 'concrete', 0)
        self.box(0, wh / 2, bz + 0.5, bx + 1, wh / 2, 0.5, 0, 'concrete', 0)
        self.box(-bx - 0.5, wh / 2, 0, 0.5, wh / 2, bz, 0, 'concrete', 0)
        self.box(bx + 0.5, wh / 2, 0, 0.5, wh / 2, bz, 0, 'concrete', 0)

        # asphalt: the long lane through the middle and a crossing to each quay
        self.roads.append({'w': 7.0, 'c': 'asphalt', 'pts': [(-bx, 0.0), (bx, 0.0)]})
        self.roads.append({'w': 5.5, 'c': 'asphalt', 'pts': [(-31.0, -bz), (-31.0, bz)]})
        self.roads.append({'w': 5.5, 'c': 'asphalt', 'pts': [(31.0, -bz), (31.0, bz)]})

        # the buildings
        self.shed(-31.0, -26.0, 24.0, 15.0, 0.0, 3, keep_clear=(0.0, 1.0))   # west warehouse, site A inside
        self.shed(31.0, -26.0, 22.0, 14.0, 0.0, 4)           # east warehouse
        self.building(-31.0, 27.0, 12.0, 10.0, 0.0, 2, 4, 'concrete')   # the office
        self.rects.append((-31.0, 27.0, 6.0, 5.0, 0.0))
        self.areas.append({'n': 'West Warehouse', 'x': -31.0, 'z': -26.0, 'r': 14})
        self.areas.append({'n': 'East Warehouse', 'x': 31.0, 'z': -26.0, 'r': 13})
        self.areas.append({'n': 'The Office', 'x': -31.0, 'z': 27.0, 'r': 8})

        # the fuel yard: tanks, a bund wall, barrels
        fx, fz = 31.0, 27.0
        self.tank(fx - 5.5, fz - 3.5, 3.0, 4.5)
        self.tank(fx + 5.5, fz - 3.5, 3.0, 4.5)
        self.tank(fx, fz + 6.5, 2.2, 3.6)
        self.lowwall(fx - 11.5, fz + 1, math.pi / 2, 14)
        self.lowwall(fx + 11.5, fz + 1, math.pi / 2, 14)
        for k in range(-6, 7, 2):
            self.props.append((fx - 11.5, fz + 1 + k, 0.8))
            self.props.append((fx + 11.5, fz + 1 + k, 0.8))
        for i in range(7):
            a = rng.uniform(0, math.tau)
            rr = rng.uniform(3.5, 9.5)
            px, pz = fx + math.cos(a) * rr, fz + math.sin(a) * rr
            if self.free(px, pz, 0.5, 0.4, 0.4, road=False):
                self.barrel(px, pz)
                self.props.append((px, pz, 0.5))
        self.areas.append({'n': 'Fuel Yard', 'x': fx, 'z': fz, 'r': 13})

        # container rows: pairs of rows with a lane between, around the loading bay
        # and along the flanks; the middle lane (|z| < 4) stays clear end to end
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

        # north and south of the bay: rows along x
        row(-9.0, -13.0, 2, 0.0, [2, 1])
        row(-9.0, 13.0, 2, 0.0, [1, 2])
        row(-9.0, -19.5, 2, 0.0, [1, 3])
        row(-9.0, 19.5, 2, 0.0, [3, 1])
        # east and west of the bay: short rows along z, leaving the lane open
        for sx in (-1, 1):
            row(sx * 17.0, -9.0 - C_LEN, 1, math.pi / 2, [2])
            row(sx * 17.0, 9.0 + C_LEN, 1, math.pi / 2, [1])
            row(sx * 21.5, -9.0 - C_LEN, 1, math.pi / 2, [1])
            row(sx * 21.5, 9.0 + C_LEN, 1, math.pi / 2, [2])
        # the outer yards, either side of the crossings
        row(-53.0, -20.0, 1, 0.0, [2])
        row(-53.0, 20.0, 1, 0.0, [1])
        row(53.0 - C_LEN * 2, -20.0, 1, 0.0, [1])
        row(53.0 - C_LEN * 2, 20.0, 1, 0.0, [2])
        row(-47.0, -33.0, 1, math.pi / 2, [2])
        row(47.0, 33.0, 1, math.pi / 2, [2])
        row(-47.0, 33.0, 1, math.pi / 2, [1])
        row(47.0, -33.0, 1, math.pi / 2, [1])
        # single short containers as scattered cover in the yards and along the lane edges
        for _ in range(60):
            if sum(1 for r in self.rects if r[2] == S_LEN) >= 12:
                break
            x = rng.uniform(-bx + 6, bx - 6)
            z = rng.uniform(-bz + 6, bz - 6)
            if abs(z) < 5.5 or abs(abs(x) - 31) < 4.5:
                continue      # keep the lanes open
            if self.free(x, z, 3.6, 1.2, 1.0, road=True):
                self.container(x, z, rng.choice([0.0, math.pi / 2]) + rng.uniform(-0.2, 0.2), 0, False)

        # cranes over each quay, forklifts and floodlight masts about the yard
        self.crane(-46.0, 0.0, 0.0, 22.0, 13.0)
        self.crane(46.0, 0.0, 0.0, 22.0, 13.0)
        self.areas.append({'n': 'West Quay', 'x': -50.0, 'z': 0.0, 'r': 12})
        self.areas.append({'n': 'East Quay', 'x': 50.0, 'z': 0.0, 'r': 12})
        self.areas.append({'n': 'Loading Bay', 'x': 0.0, 'z': 0.0, 'r': 12})
        for _ in range(80):
            if sum(1 for d in self.deco if d['k'] == 'forklift') >= 5:
                break
            x = rng.uniform(-bx + 5, bx - 5)
            z = rng.uniform(-bz + 5, bz - 5)
            if self.free(x, z, 1.6, 1.0, 0.8, road=False) and abs(z) > 4.5:
                self.forklift(x, z, rng.uniform(0, math.tau))
        for (x, z) in ((-bx + 4, -bz + 4), (bx - 4, -bz + 4), (-bx + 4, bz - 4), (bx - 4, bz - 4), (0, -bz + 3), (0, bz - 3)):
            self.mast(x, z)
        # barriers at the gates, and a few pallets and barrels for cover at the hills
        self.jersey(-54.0, -9.0, 0.0, 3)
        self.jersey(54.0, 9.0, 0.0, 3)
        for (hx, hz) in self.hills:
            for i in range(4):
                for _ in range(20):
                    a = rng.uniform(0, math.tau)
                    rr = rng.uniform(3.0, 6.5)
                    x, z = hx + math.cos(a) * rr, hz + math.sin(a) * rr
                    if self.free(x, z, 0.9, 0.8, 0.8, road=False):
                        if rng.random() < 0.5:
                            rad = self.crate_stack(x, z, rng.uniform(0, math.pi))
                            self.props.append((x, z, rad))
                        else:
                            self.jersey(x, z, a + math.pi / 2, 1)
                        break
        # the site markings
        for label, (sx, sz) in (('A', self.site_a), ('B', self.site_b)):
            self.deco.append({'k': 'site', 'x': round(sx, 2), 'z': round(sz, 2), 'r': 4.5, 'l': label})
        for rd in self.roads:
            self.deco.append({'k': 'road', 'w': rd['w'], 'c': rd['c'], 'pts': [[round(x, 2), round(z, 2)] for (x, z) in rd['pts']]})
        # painted bay lines around the loading bay
        for i in range(-3, 4):
            self.deco.append({'k': 'lines', 'x': i * 3.0, 'z': 0.0, 'l': 9.0, 'yaw': 0.0})
        self.areas.append({'n': 'West Gate', 'x': self.spawn_w[0], 'z': round(self.spawn_w[1], 1), 'r': 10})
        self.areas.append({'n': 'East Gate', 'x': self.spawn_e[0], 'z': round(self.spawn_e[1], 1), 'r': 10})
        self.pick_spawns()

    def road_dist(self, x, z):
        # the asphalt lanes are open ground here, not something to keep clear of
        return 1e9
