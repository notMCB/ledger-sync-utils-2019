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
TERRACE = 0.45         # each rock step of a ramp


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

    # -- the ground --------------------------------------------------------

    def smooth_height(self, x, z):
        """The land before it is stepped: a slope up to the south, knolls, the ridge."""
        h = BASE
        h += max(0.0, z - 6.0) * 0.05                       # rising to the south edge
        h += max(0.0, -10.0 - z) * 0.05                     # and a little toward the ridge foot
        h += 3.2 * bump(math.hypot(x + 46, z - 22) / 20)    # the west knoll
        h += 2.6 * bump(math.hypot(x - 52, z - 16) / 18)    # the east rise
        h += 1.6 * bump(math.hypot(x + 4, z - 34) / 14)     # a swell south of the helipad
        h -= 1.0 * bump(math.hypot(x - 14, z - 4) / 12)     # a hollow on the road east of the pad
        if z < self.z_face:
            h = BASE + 1.4 + RIDGE                          # the ridge shelf
        return h

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

    def flatten(self, x, z, hx, hz, height=None):
        """A level pad for a building or a feature. Returns its height."""
        if height is None:
            height = self.ground(x, z)
        i0, i1 = self.cell(x - hx, z - hz), self.cell(x + hx, z + hz)
        for ix in range(i0[0], i1[0] + 1):
            for iz in range(i0[1], i1[1] + 1):
                self.h[ix][iz] = height
        return height

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
        for rx in (-40.0, 40.0):
            foot = self.ground(rx, self.z_face + 18)
            n = int((top - foot) / TERRACE)
            for i in range(n):
                hgt = top - (i + 1) * TERRACE
                # each terrace runs from the face out to its own edge, so every
                # step lands on the one behind it and the top one meets the shelf
                depth = 1.25 * (i + 1)
                self.rock(rx, hgt / 2, self.z_face + depth / 2, 3.0, hgt / 2, depth / 2 + 0.02)
            # a level pad at the foot so the last step lands on the ground
            self.flatten(rx, self.z_face + 1.25 * n + 2.0, 3.5, 2.5, round(foot / QUANT) * QUANT)
            self.ramp_pts.append((rx, self.z_face + 1.25 * n + 1.5))
            self.rects.append((rx, self.z_face + 0.62 * (n + 1), 3.2, 0.62 * (n + 1) + 0.6, 0.0))
            self.areas.append({'n': 'Ridge Ramp', 'x': rx, 'z': self.z_face + 5, 'r': 5})

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
        for _ in range(14):
            x = rng.uniform(-self.bx + 6, self.bx - 6)
            if any(abs(x - rx) < 6 for rx, _ in self.ramp_pts):
                continue
            z = self.z_face + rng.uniform(2.0, 7.0)
            s = rng.uniform(0.6, 1.3)
            self.at(x, z)
            self.rock(x, s * 0.5, z, s, s * 0.5, s * 0.7, rng.uniform(0, 3))
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

    def trench(self, x0, x1, z):
        """A channel dug 1.6 m into the slope, 4 m wide, with a ramp down at each
        end and roofed stretches over the middle."""
        rng = self.rng
        hw = CELL          # half the width: two cells
        floor = self.dig(x0 + 8, x1 - 8, z - hw + 0.1, z + hw - 0.1, 1.6)
        # ramps: four cells stepping down to the floor at each end
        rim_w = self.ground(x0 + 6, z)
        rim_e = self.ground(x1 - 6, z)
        for k in range(4):
            hw_ = round((rim_w - (rim_w - floor) * (k + 1) / 4) / QUANT) * QUANT
            he_ = round((rim_e - (rim_e - floor) * (k + 1) / 4) / QUANT) * QUANT
            self.flatten(x0 + 8 - (4 - k) * CELL + CELL / 2, z, CELL / 2 - 0.1, hw - 0.1, hw_)
            self.flatten(x1 - 8 + (4 - k) * CELL - CELL / 2, z, CELL / 2 - 0.1, hw - 0.1, he_)
        # roofs at the rim's height over some stretches: a lid you can walk over
        self.base_y = 0.0
        x = x0 + 12
        while x < x1 - 14:
            L = min(rng.uniform(6, 10), x1 - 14 - x)
            if rng.random() < 0.7:
                rim = self.ground(x + L / 2, z + hw + 1.0)
                self.box(x + L / 2, rim + 0.06, z, L / 2, 0.08, hw + 0.15, 0, 'flatroof', 2)
            x += L + rng.uniform(2.0, 5.0)
        self.rects.append(((x0 + x1) / 2, z, (x1 - x0) / 2, hw + 0.4, 0.0))

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
        self.hills = [(0.0, 8.0), (0.0, -bz + 13.5), (-46.0, 22.0)]

        # the walls of the world: rock all round above the ground
        top = self.ridge_top()
        wh = 7.0
        self.base_y = 0.0
        self.rock(0, (wh + 6) / 2, bz + 1.5, bx + 3, (wh + 6) / 2, 1.5)
        self.rock(-bx - 1.5, (wh + 6) / 2, 0, 1.5, (wh + 6) / 2, bz + 3)
        self.rock(bx + 1.5, (wh + 6) / 2, 0, 1.5, (wh + 6) / 2, bz + 3)
        self.rock(0, (top + wh) / 2, -bz - 1.5, bx + 3, (top + wh) / 2, 1.5)

        # level ground where the road, the pads and the gates need it
        self.flatten(0.0, 8.0, 9.0, 9.0)                                   # the helipad
        self.flatten(self.spawn_w[0], self.spawn_w[1], 7.0, 8.0)
        self.flatten(self.spawn_e[0], self.spawn_e[1], 7.0, 8.0)
        self.flatten(self.site_b[0], self.site_b[1], 7.0, 7.0)

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
        self.trench(-60.0, -6.0, bz - 9.0)
        self.trench(4.0, 62.0, bz - 9.0)
        self.areas.append({'n': 'South Trench', 'x': 0.0, 'z': bz - 9.0, 'r': 0})
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
        for (x, z, yaw) in ((-56.0, 14.0, 0.2), (58.0, -2.0, 1.4), (10.0, 20.0, 2.8)):
            if self.free(x, z, 4.0, 1.0, 0.8, road=False):
                self.truck(x, z, yaw)
        for x in (-50.0, -34.0, -8.0, 16.0, 30.0, 50.0):
            self.jersey(x + rng.uniform(-3, 3), 6.0 + rng.choice([-5.5, 5.5]), rng.uniform(-0.3, 0.3), rng.choice([2, 3]))
        hy = self.ground(0.0, 8.0)
        self.deco.append({'k': 'helipad', 'x': 0.0, 'y': round(hy, 2), 'z': 8.0, 'r': 7.0})
        for i in range(3):
            a = i / 3 * math.tau + 0.7
            self.jersey(math.cos(a) * 9.5, 8.0 + math.sin(a) * 9.5, a + math.pi / 2, 2)

        # pine woods on the open slopes
        self.wood(-52.0, -12.0, 12, 8, 16)
        self.wood(30.0, -24.0, 9, 6, 12)
        self.wood(-10.0, 24.0, 12, 8, 14)
        self.wood(58.0, 24.0, 9, 8, 12)
        self.wood(-66.0, 34.0, 8, 8, 8)
        for _ in range(60):
            if len(self.tree_pts) >= 74:
                break
            x = rng.uniform(-bx + 4, bx - 4)
            z = rng.uniform(self.z_face + 4, bz - 4)
            if abs(z - 6.0) < 6:
                continue
            if self.free(x, z, 0.5, 1.4, 1.4, road=True) and all(math.hypot(x - a, z - b) > 4 for (a, b) in self.tree_pts):
                self.pine(x, z)
                self.tree_pts.append((x, z))
        self.base_y = 0.0

        # the snow road, sampled every half metre so it follows the steps
        def road(pts, w):
            out = []
            for i in range(len(pts) - 1):
                (ax, az), (bx2, bz2) = pts[i], pts[i + 1]
                n = max(1, int(math.hypot(bx2 - ax, bz2 - az) / 0.5))
                for k in range(n + (1 if i == len(pts) - 2 else 0)):
                    t = k / n
                    x, z = ax + (bx2 - ax) * t, az + (bz2 - az) * t
                    out.append([round(x, 2), round(z, 2), round(self.ground(x, z) + 0.03, 2)])
            self.deco.append({'k': 'road', 'w': w, 'c': 'snow', 'pts': out})
            self.roads.append({'w': w, 'pts': [(p[0], p[1]) for p in out]})
        road([(-bx, 6.0), (bx, 6.0)], 9.0)
        road([(-24.0, 6.0), (-24.0, bz)], 5.0)
        road([(38.0, 6.0), (38.0, bz)], 5.0)

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
