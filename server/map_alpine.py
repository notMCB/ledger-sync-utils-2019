"""
Ridgeline: a snowbound radar and comms station in the mountains.

Mid-to-long range and built around height. A rock ridge runs along the
north edge with overwatch over an open central lane (the snow road); a
covered trench runs the south flank; the radar dome, three concrete
bunkers, comms towers, generators, trucks and barriers stand in between,
and pine woods fill parts of the open ground.

Roughly half the map is open ground, a quarter or so semi-covered (the
trench, the woods, the walkway) and a fifth interiors (the bunkers, the
radar building).

Bomb sites: A at the radar building, B at the fuel dump by the east bunker.
Hills: the helipad in the middle, the ridge's overwatch shelf, the west yard.
"""

import math

import mapgen
from mapgen import Town, rot, STORY, STEP_N, STEP_D

RIDGE_H = 5.5          # the ridge shelf's height above the snow
TERRACE = 0.45         # each rock step up the ridge


class Alpine(Town):
    kind = 'alpine'
    name = 'Ridgeline'
    theme = 'snow'

    def __init__(self, seed):
        Town.__init__(self, seed)
        self.bx, self.bz = 78.0, 54.0

    # -- pieces ------------------------------------------------------------

    def rock(self, x, y, z, hx, hy, hz, yaw=0.0):
        self.box(x, y, z, hx, hy, hz, yaw, 'rock', 0)

    def ridge(self):
        """A stepped rock wall along the north edge: terraces a player can climb
        at the two ramps, a sheer face elsewhere, and a shelf on top to shoot from."""
        rng = self.rng
        bx, bz = self.bx, self.bz
        top = RIDGE_H
        z_face = -bz + 16.0          # where the ridge's south face stands
        # the shelf itself, and the cliff face below it
        self.rock(0, top / 2, (z_face - bz) / 2 - 1, bx + 1, top / 2, (bz + z_face) / 2 + 1)
        # a low parapet of boulders along the shelf edge, with gaps to shoot through
        x = -bx + 4
        while x < bx - 4:
            L = rng.uniform(3, 6)
            if rng.random() < 0.7:
                self.rock(x + L / 2, top + 0.45, z_face - 0.9, L / 2, 0.45, 0.6, rng.uniform(-0.1, 0.1))
            x += L + rng.uniform(1.6, 3.2)
        # the ramps: terraces stepping down to the snow at two places
        self.ramps = []
        for rx in (-40.0, 40.0):
            n = int(top / TERRACE)
            for i in range(n):
                h = top - (i + 1) * TERRACE
                zz = z_face + 1.2 * (i + 1)
                self.rock(rx, h / 2 if h > 0 else 0.05, zz, 3.0, max(0.1, h / 2), 0.6 + 0.02)
            self.ramps.append((rx, z_face + 1.2 * n + 1.5))
            self.rects.append((rx, z_face + 0.6 * (n + 1), 3.0, 0.6 * (n + 1) + 0.6, 0.0))   # nobody spawns on the steps
            self.areas.append({'n': 'Ridge Ramp', 'x': rx, 'z': z_face + 4, 'r': 5})
        # boulders scattered below the face for cover
        for _ in range(14):
            x = rng.uniform(-bx + 6, bx - 6)
            if any(abs(x - rx) < 5 for rx, _ in self.ramps):
                continue
            z = z_face + rng.uniform(1.5, 6)
            s = rng.uniform(0.6, 1.3)
            self.rock(x, s * 0.5, z, s, s * 0.5, s * 0.7, rng.uniform(0, 3))
            self.props.append((x, z, s + 0.3))
        self.z_face = z_face

    def bunker(self, x, z, w, d, yaw, roof_stairs=True):
        """A low concrete bunker: a door on one side, firing slits on the others,
        a flat roof reached by outside steps."""
        rng = self.rng
        hw, hd = w / 2, d / 2
        H = 3.1
        WT = 0.4
        loc = []

        def lb(x0, x1, y0, y1, z0, z1, mat='concrete', t=2):
            if x1 - x0 > 0.01 and y1 - y0 > 0.01 and z1 - z0 > 0.01:
                loc.append(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, mat, t))

        # south wall: the door
        du = rng.uniform(-hw + 2, hw - 2)
        lb(-hw, du - 0.8, 0, H, -hd, -hd + WT)
        lb(du + 0.8, hw, 0, H, -hd, -hd + WT)
        lb(du - 0.8, du + 0.8, 2.3, H, -hd, -hd + WT)
        # the other three walls: firing slits at chest height
        def slit_wall(along_x, at0, at1, lo, hi):
            n = max(1, int((hi - lo) // 4))
            cur = lo
            for k in range(n):
                su = lo + (hi - lo) * (k + 0.5) / n
                a, b = cur, su - 0.7
                if along_x:
                    lb(a, b, 0, H, at0, at1)
                    lb(su - 0.7, su + 0.7, 0, 1.2, at0, at1)
                    lb(su - 0.7, su + 0.7, 1.75, H, at0, at1)
                else:
                    lb(at0, at1, 0, H, a, b)
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
        # a parapet on the roof
        for (x0, x1, z0, z1) in ((-hw, hw, -hd, -hd + 0.25), (-hw, hw, hd - 0.25, hd), (-hw, -hw + 0.25, -hd, hd), (hw - 0.25, hw, -hd, hd)):
            lb(x0, x1, H, H + 0.7, z0, z1, 'concrete', 2)
        # a crate or two inside
        for _ in range(2):
            cx = rng.uniform(-hw + 1.2, hw - 1.2)
            cz = rng.uniform(-hd + 1.2, hd - 1.2)
            if abs(cx - du) < 1.6 and cz < -hd + 2.5:
                continue
            s = rng.uniform(0.8, 1.0)
            lb(cx - s / 2, cx + s / 2, 0, s, cz - s / 2, cz + s / 2, 'crate', 0)
        # outside steps up the east wall to the roof
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
        """The radar building: a concrete block with a big dome on the roof and
        a walkway round the dome."""
        H = self.building(x, z, 16.0, 12.0, 0.0, 2, 2, 'concrete')
        self.rects.append((x, z, 8.0, 6.0, 0.0))
        r = 5.0
        self.deco.append({'k': 'radome', 'x': round(x, 2), 'y': round(H, 2), 'z': round(z, 2), 'r': r})
        dh = r * 0.8
        for k in range(3):
            self.box(x, H + dh / 2 + 0.3, z, r * 0.95, dh / 2, r * 0.5, k * math.pi / 3, 'inv')
        self.areas.append({'n': 'Radar Station', 'x': x, 'z': z, 'r': 14})
        return H

    def tower(self, x, z, h):
        self.box(x, h / 2, z, 0.6, h / 2, 0.6, math.pi / 4, 'steel', 0)
        self.deco.append({'k': 'tower', 'x': round(x, 2), 'z': round(z, 2), 'h': h})
        self.props.append((x, z, 1.2))

    def generator(self, x, z, yaw):
        self.box(x, 0.8, z, 1.4, 0.8, 0.8, yaw, 'steel', 3)
        self.deco.append({'k': 'generator', 'x': round(x, 2), 'z': round(z, 2), 'yaw': round(yaw, 4)})
        self.props.append((x, z, 1.8))

    def truck(self, x, z, yaw):
        self.box(x, 1.0, z, 3.4, 1.0, 1.25, yaw, 'car', 5)
        ox, oz = rot(2.5, 0, yaw)
        self.box(x + ox, 1.7, z + oz, 1.0, 0.7, 1.2, yaw, 'car', 5)
        self.deco.append({'k': 'truck', 'x': round(x, 2), 'z': round(z, 2), 'yaw': round(yaw, 4)})
        self.props.append((x, z, 3.8))

    def jersey(self, x, z, yaw, n=1):
        for i in range(n):
            ox, oz = rot((i - (n - 1) / 2) * 2.05, 0, yaw)
            self.box(x + ox, 0.45, z + oz, 1.0, 0.45, 0.3, yaw, 'concrete', 1)
        self.props.append((x, z, n * 1.05 + 0.3))

    def pine(self, x, z):
        h = self.rng.uniform(5.5, 9.0)
        self.box(x, 1.2, z, 0.28, 1.2, 0.28, 0, 'inv')
        self.deco.append({'k': 'pine', 'x': round(x, 2), 'z': round(z, 2), 'h': round(h, 2), 's': self.rng.randrange(3)})
        self.props.append((x, z, 0.5))

    def wood(self, cx, cz, rx, rz, n):
        """A stand of pines: cover to move through, not a wall."""
        rng = self.rng
        placed = 0
        for _ in range(n * 12):
            if placed >= n:
                break
            x = cx + rng.uniform(-rx, rx)
            z = cz + rng.uniform(-rz, rz)
            if self.free(x, z, 0.5, 1.2, 1.4, road=True) and all(math.hypot(x - a, z - b) > 2.6 for (a, b) in self.tree_pts):
                self.pine(x, z)
                self.tree_pts.append((x, z))
                placed += 1

    def trench(self, x0, x1, z, roofed):
        """A covered walkway along the south flank: walls both sides, a roof over
        stretches of it, and gaps to step out of."""
        rng = self.rng
        hw = 1.6
        h = 2.3
        x = x0
        while x < x1:
            L = min(rng.uniform(6, 11), x1 - x)
            gap = rng.random() < 0.5
            # the north wall, with an opening on some sections; the south wall solid
            if gap and L > 5:
                self.box(x + 1.0, h / 2, z - hw, 1.0, h / 2, 0.2, 0, 'concrete', 2)
                self.box(x + L - 1.0, h / 2, z - hw, 1.0, h / 2, 0.2, 0, 'concrete', 2)
            else:
                self.box(x + L / 2, h / 2, z - hw, L / 2, h / 2, 0.2, 0, 'concrete', 2)
            self.box(x + L / 2, h / 2, z + hw, L / 2, h / 2, 0.2, 0, 'concrete', 2)
            if roofed and rng.random() < 0.7:
                self.box(x + L / 2, h + 0.12, z, L / 2, 0.12, hw + 0.2, 0, 'flatroof', 2)
            x += L + rng.uniform(0.0, 1.5)
        self.rects.append(((x0 + x1) / 2, z, (x1 - x0) / 2, hw + 0.4, 0.0))

    # -- the station ---------------------------------------------------------

    def generate(self):
        rng = self.rng
        bx, bz = self.bx, self.bz
        self.tree_pts = []
        self.spawn_w = (-68.0, rng.uniform(4, 14))
        self.spawn_e = (68.0, rng.uniform(4, 14))
        self.site_a = (-24.0, 6.0)         # by the radar building
        self.site_b = (38.0, 24.0)         # the fuel dump at the east bunker
        self.hills = [(0.0, 8.0), (0.0, -bz + 13.5), (-44.0, 22.0)]     # the second is up on the ridge shelf

        # the walls of the world: rock all round (the ridge makes the north side)
        wh = 7.0
        self.rock(0, wh / 2, bz + 1.5, bx + 3, wh / 2, 1.5)
        self.rock(-bx - 1.5, wh / 2, 0, 1.5, wh / 2, bz + 3)
        self.rock(bx + 1.5, wh / 2, 0, 1.5, wh / 2, bz + 3)
        self.ridge()

        # the snow road: the open central lane, and a track down to each end
        self.roads.append({'w': 9.0, 'c': 'snow', 'pts': [(-bx, 6.0), (bx, 6.0)]})
        self.roads.append({'w': 5.0, 'c': 'snow', 'pts': [(-24.0, 6.0), (-24.0, bz)]})
        self.roads.append({'w': 5.0, 'c': 'snow', 'pts': [(38.0, 6.0), (38.0, bz)]})

        # buildings: the radar station west of centre, bunkers east, south-west and on the ridge
        self.radar(-24.0, -10.0)
        self.bunker(38.0, -8.0, 12.0, 9.0, 0.0)
        self.bunker(-46.0, 32.0, 11.0, 8.0, 0.0)
        self.bunker(12.0, 30.0, 12.0, 9.0, 0.0)
        self.bunker(0.0, -bz + 8.0, 10.0, 7.0, 0.0, roof_stairs=False)      # up on the ridge, over the middle
        self.areas.append({'n': 'East Bunker', 'x': 38.0, 'z': -8.0, 'r': 9})
        self.areas.append({'n': 'West Bunker', 'x': -46.0, 'z': 32.0, 'r': 9})
        self.areas.append({'n': 'South Bunker', 'x': 12.0, 'z': 30.0, 'r': 9})
        self.areas.append({'n': 'Ridge Post', 'x': 0.0, 'z': -bz + 8.0, 'r': 9})
        self.areas.append({'n': 'The Ridge', 'x': 0.0, 'z': -bz + 12.0, 'r': 0})

        # the fuel dump: tanks and barrels behind barriers, site B
        fx, fz = self.site_b
        for k in range(4):
            self.box(fx - 6, 1.6, fz + 4, 2.2 * 0.97, 1.6, 2.2 * 0.42, k * math.pi / 4, 'inv')
        self.deco.append({'k': 'tank', 'x': fx - 6, 'z': fz + 4, 'r': 2.2, 'h': 3.2})
        self.props.append((fx - 6, fz + 4, 2.6))
        self.jersey(fx, fz - 5.5, 0.0, 3)
        self.jersey(fx + 6.5, fz, math.pi / 2, 2)
        for i in range(6):
            a = rng.uniform(0, math.tau)
            rr = rng.uniform(2.5, 5.0)
            px, pz = fx + math.cos(a) * rr, fz + math.sin(a) * rr
            if self.free(px, pz, 0.5, 0.4, 0.4, road=False):
                self.barrel(px, pz)
                self.props.append((px, pz, 0.5))
        self.areas.append({'n': 'Fuel Dump', 'x': fx, 'z': fz, 'r': 9})

        # the covered flank along the south, in two runs with a break in the middle
        self.trench(-60.0, -6.0, bz - 8.0, True)
        self.trench(4.0, 62.0, bz - 8.0, True)
        self.areas.append({'n': 'South Trench', 'x': 0.0, 'z': bz - 8.0, 'r': 0})

        # comms towers, generators, trucks
        self.tower(-10.0, -30.0, 16.0)
        self.tower(54.0, -30.0, 14.0)
        self.tower(-60.0, -26.0, 12.0)
        for (x, z, yaw) in ((-40.0, -4.0, 0.3), (24.0, 14.0, 1.2), (52.0, 10.0, 0.0)):
            if self.free(x, z, 2.0, 1.0, 0.8, road=False):
                self.generator(x, z, yaw)
        for (x, z, yaw) in ((-56.0, 14.0, 0.2), (58.0, -2.0, 1.4), (10.0, 20.0, 2.8)):
            if self.free(x, z, 4.0, 1.0, 0.8, road=False):
                self.truck(x, z, yaw)
        # barriers along the road for a little cover on the open lane
        for x in (-50.0, -34.0, -8.0, 16.0, 30.0, 50.0):
            self.jersey(x + rng.uniform(-3, 3), 6.0 + rng.choice([-5.5, 5.5]), rng.uniform(-0.3, 0.3), rng.choice([2, 3]))
        # the helipad in the middle: an open hill with a little cover
        self.deco.append({'k': 'helipad', 'x': 0.0, 'z': 8.0, 'r': 7.0})
        for i in range(3):
            a = i / 3 * math.tau + 0.7
            self.jersey(math.cos(a) * 9.5, 8.0 + math.sin(a) * 9.5, a + math.pi / 2, 2)

        # pine woods: in the open ground away from the lane, thick enough to move through unseen
        self.wood(-52.0, -12.0, 12, 8, 16)
        self.wood(30.0, -24.0, 9, 6, 12)
        self.wood(-10.0, 24.0, 12, 8, 14)
        self.wood(58.0, 24.0, 9, 8, 12)
        self.wood(-66.0, 34.0, 8, 8, 8)
        # a few lone trees anywhere else there's room
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

        for label, (sx, sz) in (('A', self.site_a), ('B', self.site_b)):
            self.deco.append({'k': 'site', 'x': round(sx, 2), 'z': round(sz, 2), 'r': 4.5, 'l': label})
        for rd in self.roads:
            self.deco.append({'k': 'road', 'w': rd['w'], 'c': rd['c'], 'pts': [[round(x, 2), round(z, 2)] for (x, z) in rd['pts']]})
        self.areas.append({'n': 'West Gate', 'x': self.spawn_w[0], 'z': round(self.spawn_w[1], 1), 'r': 10})
        self.areas.append({'n': 'East Gate', 'x': self.spawn_e[0], 'z': round(self.spawn_e[1], 1), 'r': 10})
        self.pick_spawns()
        # nobody spawns up on the ridge, or in the woods
        zf = self.z_face
        self.ffa_spawns = [s for s in self.ffa_spawns if s[1] > zf + 1.5]

    def road_dist(self, x, z):
        return 1e9
