"""
Ridgeline: a snowbound radar and comms station in the mountains.

Built on stepped ground: a heightfield on a 2 m grid, quantised to 40 cm
steps a player can walk up, so the map rises and falls. A rock ridge along
the north edge stands 5.5 m over everything, climbed by stepped ramps at
each end; the ground rises to the south and swells into knolls east and
west; a trench is cut into the southern slope, below ground level, with
roofed stretches; the snow road runs the open middle.

The radar dome, three bunkers with firing slits and roof steps (plus one
on the ridge), comms towers, generators, trucks, barriers and pine woods
stand on the slopes, each on a flattened pad.

Bomb sites: A at the radar building, B at the fuel dump by the east bunker.
Hills: the helipad in the middle, the ridge shelf, the west knoll.
"""

import math

import mapgen
from mapgen import Town, rot, STORY, STEP_N, STEP_D

CELL = 2.0             # the terrain grid
QUANT = 0.4            # each step of ground
BASE = 2.0             # the lowest ground, above the world's floor plane
RIDGE = 5.5            # the ridge shelf above the ground at its foot
TERRACE = 0.4          # each rock step of a ramp: under the physics step limit with margin


def bump(r):
    """A smooth hill profile: 1 at the centre, 0 at r = 1 and beyond."""
    if r >= 1:
        return 0.0
    return (1 - r * r) ** 2


class Alpine(Town):
    kind = 'alpine'
    name = 'Ridgeline'
    theme = 'snow'

    def __init__(self, seed):
        Town.__init__(self, seed)
        self.bx, self.bz = 78.0, 54.0
        self.z_face = -self.bz + 16.0       # the ridge's south face
        self.nx = int(self.bx * 2 / CELL)
        self.nz = int(self.bz * 2 / CELL)
        self.h = None                        # cell heights, [ix][iz]
        self.fixed = set()                   # cells that are pads: the land shapes itself around them

    # -- the ground --------------------------------------------------------

    def smooth_height(self, x, z):
        """The land before it is stepped: a slope up to the south, knolls, the ridge."""
        h = BASE
        h += max(0.0, z - 6.0) * 0.05                       # rising to the south edge
        h += max(0.0, -10.0 - z) * 0.05                     # and a little toward the ridge foot
        h += 3.2 * bump(math.hypot(x + 46, z - 22) / 26)    # the west knoll (slopes stay under one step a cell)
        h += 2.6 * bump(math.hypot(x - 52, z - 16) / 22)    # the east rise
        h += 1.6 * bump(math.hypot(x + 4, z - 34) / 14)     # a swell south of the helipad
        h -= 1.0 * bump(math.hypot(x - 14, z - 4) / 12)     # a hollow on the road east of the pad
        if z < self.face_z(x):
            h = BASE + 1.4 + RIDGE                          # the ridge shelf
        return h

    def face_z(self, x):
        """Where the cliff stands at this x: it wanders in and out a few metres."""
        return self.z_face + 1.8 * math.sin(x * 0.23) + 1.3 * math.sin(x * 0.61 + 1.2) + 0.7 * math.sin(x * 1.7)

    def cell(self, x, z):
        return (max(0, min(self.nx - 1, int((x + self.bx) / CELL))), max(0, min(self.nz - 1, int((z + self.bz) / CELL))))

    def ground(self, x, z):
        """The stepped ground height at a point."""
        ix, iz = self.cell(x, z)
        return self.h[ix][iz]

    def make_ground(self):
        q = lambda v: round(v / QUANT) * QUANT
        self.h = [[q(self.smooth_height(-self.bx + (ix + 0.5) * CELL, -self.bz + (iz + 0.5) * CELL))
                   for iz in range(self.nz)] for ix in range(self.nx)]

    def flatten(self, x, z, hx, hz, height=None, protect=True):
        """A level pad for a building or a feature. Returns its height. Pads are
        protected: the relaxation pass shapes the land around them, not them."""
        if height is None:
            height = self.ground(x, z)
        i0, i1 = self.cell(x - hx, z - hz), self.cell(x + hx, z + hz)
        for ix in range(i0[0], i1[0] + 1):
            for iz in range(i0[1], i1[1] + 1):
                self.h[ix][iz] = height
                if protect:
                    self.fixed.add((ix, iz))
        return height

    def relax(self):
        """Shape the land so no two neighbouring cells south of the cliff differ by
        more than one step: the ground ramps up to and down from every pad
        instead of meeting it with a wall. Pads themselves and the ridge stay put."""
        south = [[(-self.bz + (iz + 0.5) * CELL) >= self.face_z(-self.bx + (ix + 0.5) * CELL) + 2.5
                  for iz in range(self.nz)] for ix in range(self.nx)]
        for _ in range(120):
            changed = False
            for ix in range(self.nx):
                for iz in range(self.nz):
                    if not south[ix][iz]:
                        continue
                    for (jx, jz) in ((ix + 1, iz), (ix, iz + 1)):
                        if jx >= self.nx or jz >= self.nz or not south[jx][jz]:
                            continue
                        a, b = self.h[ix][iz], self.h[jx][jz]
                        if abs(a - b) <= QUANT + 1e-6:
                            continue
                        fa, fb = (ix, iz) in self.fixed, (jx, jz) in self.fixed
                        if fa and fb:
                            continue
                        # move the free cell to within one step of the other
                        if fa or (not fb and b > a):
                            self.h[jx][jz] = round((a + (QUANT if b > a else -QUANT)) / QUANT) * QUANT
                        else:
                            self.h[ix][iz] = round((b + (QUANT if a > b else -QUANT)) / QUANT) * QUANT
                        changed = True
            if not changed:
                break

    def dig(self, x0, x1, z0, z1, depth):
        """Cut a channel `depth` below the ground on each side, with the floor level."""
        i0, i1 = self.cell(x0, z0), self.cell(x1, z1)
        rim = min(self.h[ix][iz] for ix in range(i0[0], i1[0] + 1) for iz in range(i0[1], i1[1] + 1))
        floor = round((rim - depth) / QUANT) * QUANT
        for ix in range(i0[0], i1[0] + 1):
            for iz in range(i0[1], i1[1] + 1):
                self.h[ix][iz] = floor
        return floor

    def emit_ground(self):
        """The heightfield as boxes: runs of equal height along x, one box each."""
        for iz in range(self.nz):
            z = -self.bz + (iz + 0.5) * CELL
            ix = 0
            while ix < self.nx:
                hgt = self.h[ix][iz]
                j = ix
                while j + 1 < self.nx and self.h[j + 1][iz] == hgt:
                    j += 1
                x0, x1 = -self.bx + ix * CELL, -self.bx + (j + 1) * CELL
                self.box((x0 + x1) / 2, hgt / 2, z, (x1 - x0) / 2, hgt / 2, CELL / 2, 0.0, 'terrain', 0)
                ix = j + 1

    def at(self, x, z):
        """Build the next things at the ground height here."""
        self.base_y = self.ground(x, z)
        return self.base_y

    # -- pieces ------------------------------------------------------------

    def rock(self, x, y, z, hx, hy, hz, yaw=0.0):
        self.box(x, y, z, hx, hy, hz, yaw, 'rock', 0)

    def ridge_top(self):
        return BASE + 1.4 + RIDGE

    def ramps(self):
        """Stepped rock terraces down the ridge face at two places."""
        top = self.ridge_top()
        self.ramp_pts = []
        self.base_y = 0.0
        rng = self.rng
        for rx in (-40.0, 40.0):
            # the cliff is flat and the shelf level for the ramp's width, so the steps meet it cleanly
            fz = self.z_face
            for ix in range(*[self.cell(rx - 6, 0)[0], self.cell(rx + 6, 0)[0] + 1]):
                for iz in range(self.nz):
                    z = -self.bz + (iz + 0.5) * CELL
                    if z < fz:
                        self.h[ix][iz] = top
                    elif z < fz + 2.5:
                        self.h[ix][iz] = round(self.smooth_height(rx, fz + 3) / QUANT) * QUANT
            foot = self.ground(rx, fz + 20)
            n = int((top - foot) / TERRACE)
            depth = 0.0
            for i in range(n):
                hgt = top - (i + 1) * TERRACE
                depth += rng.uniform(1.0, 1.6)
                wobble = rng.uniform(-0.5, 0.5)
                half = rng.uniform(2.2, 3.4)
                # each terrace runs from the face out to its own edge, so every
                # step lands on the one behind it; widths and offsets wander like rock
                self.rock(rx + wobble, hgt / 2, fz + depth / 2, half, hgt / 2, depth / 2 + 0.02, rng.uniform(-0.04, 0.04))
                # loose rock either side instead of a flat wall
                if i % 2 == 0:
                    for side in (-1, 1):
                        s = rng.uniform(0.5, 1.1)
                        self.rock(rx + side * (half + s * 0.6 + 0.2), hgt + s * 0.3, fz + depth - 0.6, s, s * 0.55, s * 0.7, rng.uniform(0, 3))
            # a level pad at the foot so the last step lands on the ground
            self.flatten(rx, fz + depth + 2.0, 4.0, 2.5, round(foot / QUANT) * QUANT)
            self.ramp_pts.append((rx, fz + depth + 1.5))
            self.rects.append((rx, fz + depth / 2, 4.6, depth / 2 + 1.0, 0.0))
            self.areas.append({'n': 'Ridge Ramp', 'x': rx, 'z': fz + 5, 'r': 5})

    def parapet(self):
        """Boulders along the shelf edge with gaps to shoot through, and a few below."""
        rng = self.rng
        top = self.ridge_top()
        self.base_y = top
        x = -self.bx + 4
        while x < self.bx - 4:
            L = rng.uniform(3, 6)
            if rng.random() < 0.7 and all(abs(x + L / 2 - rx) > 5 for rx, _ in self.ramp_pts):
                self.rock(x + L / 2, 0.45, self.z_face - 0.9, L / 2, 0.45, 0.6, rng.uniform(-0.1, 0.1))
            x += L + rng.uniform(1.6, 3.2)
        for _ in range(40):
            x = rng.uniform(-self.bx + 6, self.bx - 6)
            if any(abs(x - rx) < 7 for rx, _ in self.ramp_pts):
                continue
            z = self.face_z(x) + rng.uniform(0.6, 6.0)
            s = rng.uniform(0.5, 1.6)
            self.at(x, z)
            self.rock(x, s * 0.5, z, s, s * 0.5, s * 0.7, rng.uniform(0, 3))
            self.props.append((x, z, s + 0.3))
        # outcrops on the shelf edge and boulders back from it, so the top is not a flat lip either
        for _ in range(18):
            x = rng.uniform(-self.bx + 6, self.bx - 6)
            if any(abs(x - rx) < 7 for rx, _ in self.ramp_pts):
                continue
            z = self.face_z(x) - rng.uniform(1.5, 9.0)
            s = rng.uniform(0.6, 1.4)
            self.base_y = top
            self.rock(x, s * 0.45, z, s, s * 0.45, s * 0.8, rng.uniform(0, 3))
            self.props.append((x, z, s + 0.3))

    def bunker(self, x, z, w, d, yaw, roof_stairs=True):
        """A low concrete bunker: a door on the south, firing slits on the other
        sides, a flat roof reached by outside steps. Built on a level pad."""
        rng = self.rng
        hw, hd = w / 2, d / 2
        pad = self.flatten(x, z, hw + 2.0, hd + 2.0)
        self.base_y = pad
        H = 3.1
        WT = 0.4
        loc = []

        def lb(x0, x1, y0, y1, z0, z1, mat='concrete', t=2):
            if x1 - x0 > 0.01 and y1 - y0 > 0.01 and z1 - z0 > 0.01:
                loc.append(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, mat, t))

        du = rng.uniform(-hw + 2, hw - 2)
        lb(-hw, du - 0.8, 0, H, -hd, -hd + WT)
        lb(du + 0.8, hw, 0, H, -hd, -hd + WT)
        lb(du - 0.8, du + 0.8, 2.3, H, -hd, -hd + WT)

        def slit_wall(along_x, at0, at1, lo, hi):
            n = max(1, int((hi - lo) // 4))
            cur = lo
            for k in range(n):
                su = lo + (hi - lo) * (k + 0.5) / n
                if along_x:
                    lb(cur, su - 0.7, 0, H, at0, at1)
                    lb(su - 0.7, su + 0.7, 0, 1.2, at0, at1)
                    lb(su - 0.7, su + 0.7, 1.75, H, at0, at1)
                else:
                    lb(at0, at1, 0, H, cur, su - 0.7)
                    lb(at0, at1, 0, 1.2, su - 0.7, su + 0.7)
                    lb(at0, at1, 1.75, H, su - 0.7, su + 0.7)
                cur = su + 0.7
            if along_x:
                lb(cur, hi, 0, H, at0, at1)
            else:
                lb(at0, at1, 0, H, cur, hi)
        slit_wall(True, hd - WT, hd, -hw, hw)
        slit_wall(False, -hw, -hw + WT, -hd + WT, hd - WT)
        slit_wall(False, hw - WT, hw, -hd + WT, hd - WT)
        lb(-hw, hw, H - 0.25, H, -hd, hd, 'flatroof', 2)
        lb(-hw + WT, hw - WT, 0, 0.04, -hd + WT, hd - WT, 'concrete', 1)
        for (x0, x1, z0, z1) in ((-hw, hw, -hd, -hd + 0.25), (-hw, hw, hd - 0.25, hd), (-hw, -hw + 0.25, -hd, hd), (hw - 0.25, hw, -hd, hd)):
            lb(x0, x1, H, H + 0.7, z0, z1, 'concrete', 2)
        for _ in range(2):
            cx = rng.uniform(-hw + 1.2, hw - 1.2)
            cz = rng.uniform(-hd + 1.2, hd - 1.2)
            if abs(cx - du) < 1.6 and cz < -hd + 2.5:
                continue
            s = rng.uniform(0.8, 1.0)
            lb(cx - s / 2, cx + s / 2, 0, s, cz - s / 2, cz + s / 2, 'crate', 0)
        if roof_stairs:
            n = 7
            rise = H / n
            for i in range(n):
                z0 = -hd + 0.4 + i * 1.0
                lb(hw, hw + 1.2, 0, (i + 1) * rise, z0, z0 + 1.0, 'stair', 0)
        for (cx, cy, cz, hx, hy, hz, mat, t) in loc:
            wx, wz = rot(cx, cz, yaw)
            self.box(x + wx, cy, z + wz, hx, hy, hz, yaw, mat, t)
        self.rects.append((x, z, hw + (1.2 if roof_stairs else 0), hd, yaw))
        wx, wz = rot(du, -hd - 1.2, yaw)
        self.doors.append((x + wx, z + wz))
        return H

    def radar(self, x, z):
        pad = self.flatten(x, z, 10.0, 8.0)
        self.base_y = pad
        H = self.building(x, z, 16.0, 12.0, 0.0, 2, 2, 'concrete')
        self.rects.append((x, z, 8.0, 6.0, 0.0))
        r = 5.0
        self.deco.append({'k': 'radome', 'x': round(x, 2), 'y': round(H + pad, 2), 'z': round(z, 2), 'r': r})
        dh = r * 0.8
        for k in range(3):
            self.box(x, H + dh / 2 + 0.3, z, r * 0.95, dh / 2, r * 0.5, k * math.pi / 3, 'inv')
        self.areas.append({'n': 'Radar Station', 'x': x, 'z': z, 'r': 14})

    def tower(self, x, z, h):
        y = self.at(x, z)
        self.box(x, h / 2, z, 0.6, h / 2, 0.6, math.pi / 4, 'steel', 0)
        self.deco.append({'k': 'tower', 'x': round(x, 2), 'y': round(y, 2), 'z': round(z, 2), 'h': h})
        self.props.append((x, z, 1.2))

    def generator(self, x, z, yaw):
        y = self.at(x, z)
        self.box(x, 0.8, z, 1.4, 0.8, 0.8, yaw, 'steel', 3)
        self.deco.append({'k': 'generator', 'x': round(x, 2), 'y': round(y, 2), 'z': round(z, 2), 'yaw': round(yaw, 4)})
        self.props.append((x, z, 1.8))

    def truck(self, x, z, yaw):
        y = self.flatten(x, z, 4.5, 2.0)
        self.base_y = y
        self.box(x, 1.0, z, 3.4, 1.0, 1.25, yaw, 'car', 5)
        ox, oz = rot(2.5, 0, yaw)
        self.box(x + ox, 1.7, z + oz, 1.0, 0.7, 1.2, yaw, 'car', 5)
        self.deco.append({'k': 'truck', 'x': round(x, 2), 'y': round(y, 2), 'z': round(z, 2), 'yaw': round(yaw, 4)})
        self.props.append((x, z, 3.8))

    def jersey(self, x, z, yaw, n=1):
        self.at(x, z)
        for i in range(n):
            ox, oz = rot((i - (n - 1) / 2) * 2.05, 0, yaw)
            self.box(x + ox, 0.45, z + oz, 1.0, 0.45, 0.3, yaw, 'concrete', 1)
        self.props.append((x, z, n * 1.05 + 0.3))

    def pine(self, x, z):
        y = self.at(x, z)
        h = self.rng.uniform(5.5, 9.0)
        self.box(x, 1.2, z, 0.28, 1.2, 0.28, 0, 'inv')
        self.deco.append({'k': 'pine', 'x': round(x, 2), 'y': round(y, 2), 'z': round(z, 2), 'h': round(h, 2), 's': self.rng.randrange(3)})
        self.props.append((x, z, 0.5))

    def wood(self, cx, cz, rx, rz, n):
        rng = self.rng
        placed = 0
        for _ in range(n * 12):
            if placed >= n:
                break
            x = cx + rng.uniform(-rx, rx)
            z = cz + rng.uniform(-rz, rz)
            if z < self.z_face + 3:
                continue
            if self.free(x, z, 0.5, 1.2, 1.4, road=True) and all(math.hypot(x - a, z - b) > 2.6 for (a, b) in self.tree_pts):
                self.pine(x, z)
                self.tree_pts.append((x, z))
                placed += 1

    def trench(self, x0, x1, z, cross=()):
        """A channel dug 1.6 m into the slope, 4 m wide, with a ramp down at each
        end and roofed stretches over the middle."""
        rng = self.rng
        hw = CELL          # half the width of the cut: two cells
        DEPTH = 2.0
        INNER = 1.3        # half the walkway between the revetments
        floor = self.dig(x0 + 10, x1 - 10, z - hw + 0.1, z + hw - 0.1, DEPTH)
        # ramps: five cells stepping down to the floor at each end
        rim_w = self.ground(x0 + 8, z)
        rim_e = self.ground(x1 - 8, z)
        for k in range(5):
            hw_ = round((rim_w - (rim_w - floor) * (k + 1) / 5) / QUANT) * QUANT
            he_ = round((rim_e - (rim_e - floor) * (k + 1) / 5) / QUANT) * QUANT
            self.flatten(x0 + 10 - (5 - k) * CELL + CELL / 2, z, CELL / 2 - 0.1, hw - 0.1, hw_)
            self.flatten(x1 - 10 + (5 - k) * CELL - CELL / 2, z, CELL / 2 - 0.1, hw - 0.1, he_)
        # timber revetments line the cut, narrowing it to a walkway
        self.base_y = 0.0
        for side in (-1, 1):
            self.box((x0 + x1) / 2, floor + DEPTH / 2, z + side * (INNER + (hw - INNER) / 2), (x1 - x0) / 2 - 10, DEPTH / 2, (hw - INNER) / 2, 0, 'wood', 0)
        # lids at the rim's height: one under every road that crosses, and some more
        def lid(cx, L):
            rim = min(self.ground(cx, z + hw + 1.0), self.ground(cx, z - hw - 1.0))
            self.box(cx, rim + 0.06, z, L / 2, 0.08, hw + 0.15, 0, 'flatroof', 2)
            self.lids.append((cx - L / 2, cx + L / 2, z - hw - 0.15, z + hw + 0.15, rim + 0.14))
        for cx in cross:
            lid(cx, 8.0)
        x = x0 + 14
        while x < x1 - 16:
            L = min(rng.uniform(6, 10), x1 - 16 - x)
            if rng.random() < 0.7 and all(abs(x + L / 2 - cx) > 4 + L / 2 for cx in cross):
                lid(x + L / 2, L)
            x += L + rng.uniform(2.0, 5.0)
        self.rects.append(((x0 + x1) / 2, z, (x1 - x0) / 2, hw + 0.4, 0.0))

    def level_road(self, pts, w, skip_band=None):
        """Flatten the ground across a road's width: every column of cells across
        the road takes the height of the cell on the centre line, so the road is
        level across and steps only along its length, as the land does."""
        for i in range(len(pts) - 1):
            (ax, az), (bx2, bz2) = pts[i], pts[i + 1]
            along_x = abs(bx2 - ax) >= abs(bz2 - az)
            if along_x:
                i0, i1 = self.cell(min(ax, bx2), az)[0], self.cell(max(ax, bx2), az)[0]
                for ix in range(i0, i1 + 1):
                    cx = -self.bx + (ix + 0.5) * CELL
                    self.flatten(cx, az, 0.01, w / 2 + 0.5, self.ground(cx, az))
            else:
                j0, j1 = self.cell(ax, min(az, bz2))[1], self.cell(ax, max(az, bz2))[1]
                for iz in range(j0, j1 + 1):
                    cz = -self.bz + (iz + 0.5) * CELL
                    if skip_band and skip_band[0] <= cz <= skip_band[1]:
                        continue      # the main road's band keeps the main road's level
                    self.flatten(ax, cz, w / 2 + 0.5, 0.01, self.ground(ax, cz))

    def spawn_y(self, pts):
        return [[p[0], p[1], round(self.ground(p[0], p[1]), 2)] for p in pts]

    # -- the station ---------------------------------------------------------

    def generate(self):
        rng = self.rng
        bx, bz = self.bx, self.bz
        self.tree_pts = []
        self.make_ground()
        self.spawn_w = (-68.0, rng.uniform(4, 14))
        self.spawn_e = (68.0, rng.uniform(4, 14))
        self.site_a = (-24.0, 6.0)
        self.site_b = (38.0, 24.0)
        self.hills = [(0.0, 19.0), (0.0, -bz + 13.5), (-46.0, 22.0)]     # the helipad sits just south of the road
        for (hx, hz) in self.hills:
            self.props.append((hx, hz, 6.5))      # nothing grows or parks on a hill

        # the walls of the world: rock all round above the ground
        top = self.ridge_top()
        wh = 7.0
        self.base_y = 0.0
        self.rock(0, (wh + 6) / 2, bz + 1.5, bx + 3, (wh + 6) / 2, 1.5)
        self.rock(-bx - 1.5, (wh + 6) / 2, 0, 1.5, (wh + 6) / 2, bz + 3)
        self.rock(bx + 1.5, (wh + 6) / 2, 0, 1.5, (wh + 6) / 2, bz + 3)
        self.rock(0, (top + wh) / 2, -bz - 1.5, bx + 3, (top + wh) / 2, 1.5)

        # the roads first: level across their width, following the land along their length
        # level pads for everything that needs one: the helipad, the gates, site B,
        # every building and every truck; then let the land ramp into them
        self.flatten(0.0, 19.0, 8.0, 8.0)                                  # the helipad
        self.flatten(self.spawn_w[0], self.spawn_w[1], 7.0, 8.0)
        self.flatten(self.spawn_e[0], self.spawn_e[1], 7.0, 8.0)
        self.flatten(self.site_b[0], self.site_b[1], 7.0, 7.0)
        self.flatten(-24.0, -10.0, 10.0, 8.0)                              # the radar building
        for (x, z, w, d) in ((38.0, -8.0, 12.0, 9.0), (-46.0, 32.0, 11.0, 8.0), (12.0, 30.0, 12.0, 9.0)):
            self.flatten(x, z, w / 2 + 2.0, d / 2 + 2.0)                   # the bunkers
        for (x, z) in ((-56.0, 14.0), (58.0, -2.0), (-12.0, 40.0)):
            self.flatten(x, z, 4.5, 2.0)                                   # the trucks
        self.relax()
        # then the roads: the main road first, and the side tracks keep out of its
        # band, so every road is one level across its width and steps only along it
        self.lids = []
        self.road_lines = [([(-bx, 6.0), (bx, 6.0)], 9.0), ([(-24.0, 6.0), (-24.0, bz)], 5.0), ([(38.0, 6.0), (38.0, bz)], 5.0)]
        self.level_road(self.road_lines[0][0], 9.0)
        for (pts, w) in self.road_lines[1:]:
            self.level_road(pts, w, skip_band=(0.0, 12.0))

        # buildings on their pads
        self.radar(-24.0, -10.0)
        self.bunker(38.0, -8.0, 12.0, 9.0, 0.0)
        self.bunker(-46.0, 32.0, 11.0, 8.0, 0.0)
        self.bunker(12.0, 30.0, 12.0, 9.0, 0.0)
        self.flatten(0.0, -bz + 8.0, 7.0, 5.5, top)
        self.bunker(0.0, -bz + 8.0, 10.0, 7.0, 0.0, roof_stairs=False)      # up on the ridge
        self.areas.append({'n': 'East Bunker', 'x': 38.0, 'z': -8.0, 'r': 9})
        self.areas.append({'n': 'West Bunker', 'x': -46.0, 'z': 32.0, 'r': 9})
        self.areas.append({'n': 'South Bunker', 'x': 12.0, 'z': 30.0, 'r': 9})
        self.areas.append({'n': 'Ridge Post', 'x': 0.0, 'z': -bz + 8.0, 'r': 9})
        self.areas.append({'n': 'The Ridge', 'x': 0.0, 'z': -bz + 12.0, 'r': 0})

        # the trench cut into the southern slope, and the ridge ramps
        self.trench(-60.0, -6.0, bz - 8.0, cross=[-24.0])       # z 46: two whole cells, 44..48
        self.trench(4.0, 62.0, bz - 8.0, cross=[38.0])
        self.areas.append({'n': 'South Trench', 'x': 0.0, 'z': bz - 8.0, 'r': 0})
        self.ramps()

        # the ground itself, now every pad and cut is in
        self.base_y = 0.0
        self.emit_ground()
        self.parapet()

        # the fuel dump: a tank and barrels behind barriers, site B
        fx, fz = self.site_b
        self.at(fx - 6, fz + 4)
        for k in range(4):
            self.box(fx - 6, 1.6, fz + 4, 2.2 * 0.97, 1.6, 2.2 * 0.42, k * math.pi / 4, 'inv')
        self.deco.append({'k': 'tank', 'x': fx - 6, 'y': round(self.base_y, 2), 'z': fz + 4, 'r': 2.2, 'h': 3.2})
        self.props.append((fx - 6, fz + 4, 2.6))
        self.jersey(fx, fz - 5.5, 0.0, 3)
        self.jersey(fx + 6.5, fz, math.pi / 2, 2)
        for i in range(6):
            a = rng.uniform(0, math.tau)
            rr = rng.uniform(2.5, 5.0)
            px, pz = fx + math.cos(a) * rr, fz + math.sin(a) * rr
            if self.free(px, pz, 0.5, 0.4, 0.4, road=False):
                self.at(px, pz)
                self.barrel(px, pz)
                self.props.append((px, pz, 0.5))
        self.areas.append({'n': 'Fuel Dump', 'x': fx, 'z': fz, 'r': 9})

        # comms towers, generators, trucks, barriers along the road
        self.tower(-10.0, -30.0, 16.0)
        self.tower(54.0, -30.0, 14.0)
        self.tower(-60.0, -26.0, 12.0)
        for (x, z, yaw) in ((-40.0, -4.0, 0.3), (24.0, 14.0, 1.2), (52.0, 10.0, 0.0)):
            if self.free(x, z, 2.0, 1.0, 0.8, road=False):
                self.generator(x, z, yaw)
        for (x, z, yaw) in ((-56.0, 14.0, 0.2), (58.0, -2.0, 1.4), (-12.0, 40.0, 0.2)):
            if self.free(x, z, 4.0, 1.0, 0.8, road=False):
                self.truck(x, z, yaw)
        for x in (-50.0, -34.0, -8.0, 16.0, 30.0, 50.0):
            self.jersey(x + rng.uniform(-3, 3), 6.0 + rng.choice([-5.5, 5.5]), rng.uniform(-0.3, 0.3), rng.choice([2, 3]))
        hy = self.ground(0.0, 19.0)
        self.deco.append({'k': 'helipad', 'x': 0.0, 'y': round(hy, 2), 'z': 19.0, 'r': 7.0})
        for i in range(3):
            a = i / 3 * math.tau + 0.7
            bx_, bz_ = math.cos(a) * 9.5, 19.0 + math.sin(a) * 9.5
            if abs(bz_ - 6.0) > 5.5:      # never on the road
                self.jersey(bx_, bz_, a + math.pi / 2, 2)

        # pine woods on the open slopes
        self.wood(-52.0, -12.0, 12, 8, 24)
        self.wood(30.0, -24.0, 10, 6, 18)
        self.wood(-10.0, 24.0, 12, 8, 20)
        self.wood(58.0, 24.0, 10, 8, 18)
        self.wood(-66.0, 34.0, 8, 8, 12)
        self.wood(14.0, -30.0, 8, 5, 10)
        self.wood(-30.0, 40.0, 10, 5, 12)
        self.wood(50.0, 42.0, 9, 5, 10)
        for _ in range(140):
            if len(self.tree_pts) >= 150:
                break
            x = rng.uniform(-bx + 4, bx - 4)
            z = rng.uniform(self.z_face + 4, bz - 4)
            if abs(z - 6.0) < 6:
                continue
            if self.free(x, z, 0.5, 1.4, 1.4, road=True) and all(math.hypot(x - a, z - b) > 4 for (a, b) in self.tree_pts):
                self.pine(x, z)
                self.tree_pts.append((x, z))
        self.base_y = 0.0

        # the snow road: a point at every cell centre and a pair either side of each
        # change of level, so the strip lies flat on every step
        def road(pts, w):
            out = []
            for i in range(len(pts) - 1):
                (ax, az), (bx2, bz2) = pts[i], pts[i + 1]
                L = math.hypot(bx2 - ax, bz2 - az)
                n = max(1, int(L / 0.25))
                last_cell = None
                for k in range(n + 1):
                    t = k / n
                    x, z = ax + (bx2 - ax) * t, az + (bz2 - az) * t
                    cell = self.cell(x, z)
                    g = self.ground(x, z)
                    for (lx0, lx1, lz0, lz1, top) in self.lids:
                        if lx0 <= x <= lx1 and lz0 <= z <= lz1:
                            g = max(g, top)
                    if last_cell is not None and cell != last_cell and out and abs(out[-1][2] - (g + 0.03)) > 0.01:
                        # step: close the old level exactly at the cell edge and open the new one
                        if cell[0] != last_cell[0]:
                            ex, ez = -self.bx + max(cell[0], last_cell[0]) * CELL, z
                        else:
                            ex, ez = x, -self.bz + max(cell[1], last_cell[1]) * CELL
                        out.append([round(ex, 2), round(ez, 2), out[-1][2]])
                        out.append([round(ex, 2), round(ez, 2), round(g + 0.03, 2)])
                    elif last_cell is None or cell != last_cell or k == n:
                        out.append([round(x, 2), round(z, 2), round(g + 0.03, 2)])
                    last_cell = cell
            self.deco.append({'k': 'road', 'w': w, 'c': 'snow', 'pts': out})
            self.roads.append({'w': w, 'pts': [(p[0], p[1]) for p in out]})
        for (pts, w) in self.road_lines:
            road(pts, w)

        for (px, pz, yaw) in ((-bx + 0.02, 6.0, math.pi / 2), (bx - 0.02, 6.0, -math.pi / 2), (-24.0, bz - 0.02, math.pi), (38.0, bz - 0.02, math.pi)):
            self.base_y = self.ground(px, pz)
            self.portal(px, pz, yaw, 6.0 if abs(pz - 6.0) < 0.1 else 4.4, 4.2)
        self.base_y = 0.0
        for label, (sx, sz) in (('A', self.site_a), ('B', self.site_b)):
            self.deco.append({'k': 'site', 'x': round(sx, 2), 'y': round(self.ground(sx, sz), 2), 'z': round(sz, 2), 'r': 4.5, 'l': label})
        self.areas.append({'n': 'West Gate', 'x': self.spawn_w[0], 'z': round(self.spawn_w[1], 1), 'r': 10})
        self.areas.append({'n': 'East Gate', 'x': self.spawn_e[0], 'z': round(self.spawn_e[1], 1), 'r': 10})
        self.pick_spawns()
        zf = self.z_face
        self.ffa_spawns = self.spawn_y([s for s in self.ffa_spawns if s[1] > zf + 1.5])
        self.team_spawns = [self.spawn_y(z) for z in self.team_spawns]

    def road_dist(self, x, z):
        return 1e9

    def to_json(self):
        m = Town.to_json(self)
        m['sites'] = {k: [v[0], v[1], round(self.ground(v[0], v[1]), 2)] for k, v in m['sites'].items()}
        m['hills'] = [[x, z, round(self.ground(x, z), 2)] for (x, z) in m['hills']]
        return m
