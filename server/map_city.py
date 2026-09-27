"""
Downtown: the city in the middle of Souk Royale.

A grid of avenues and cross streets, every road a solid slab of asphalt
you stand and drive on, with a raised concrete pavement on every block.
The Spire stands in the middle: a glass tower thirty storeys high with a
marble lobby you can walk through, a stairwell up the middle of it,
terraces where it steps back, and the gold room at the very top, with the
three gold chests that each hold one legendary gun. Round it, the blocks
are glass high-rises with lobbies, two-storey shops you can go inside,
a park, a car park and a building site.

Everything here is built in the city's own coordinates, centred on the
tower; the royale map sets it down in the middle and carries the streets
on out to the ring road.
"""

import math

import mapgen
from mapgen import Town, rot, STORY, STEP_N, STEP_D, WT
import map_manor
import map_dock

HX, HZ = 96.0, 80.0                 # half size of the city
AVES = ((-70.0, 10.0), (-28.0, 12.0), (28.0, 12.0), (70.0, 10.0))     # (x, width): north-south
STS = ((-58.0, 10.0), (-26.0, 12.0), (26.0, 12.0), (58.0, 10.0))      # (z, width): east-west
KERB = 0.16                         # the pavement stands this much over the road's base
ROAD = 0.12                         # a road slab's thickness; its top is what you drive on
LOBBY = 5.0                         # the tower's lobby, floor to ceiling
TIERS = ((13.0, 12), (10.0, 22), (8.0, 30))     # (half width, storeys to its top) of each tier of the tower
WELL_X, WELL_Z = 1.8, 2.95          # half size of the stairwell, walls included
RISE = STORY / STEP_N
FLIGHT = 6 * STEP_D                 # one flight of a switchback: six steps
GOLD = 4.0                          # the gold room's height


class City(Town):
    kind = 'city'
    name = 'Downtown'
    theme = 'concrete'

    def __init__(self, seed):
        Town.__init__(self, seed)
        self.bx, self.bz = HX, HZ
        self.open = True
        self.fixed = []         # (x, y, z) chest spots chosen by hand: roofs, terraces, the lobby
        self.gold = []          # (x, y, z) the gold chests
        self.spawn_spots = []   # [x, z, y] where the lobby stands before the plane
        self.tower_h = 0.0

    # -- the ground ---------------------------------------------------------------

    @staticmethod
    def on_road(x, z):
        return any(abs(x - ax) < w / 2 for (ax, w) in AVES) or any(abs(z - sz) < w / 2 for (sz, w) in STS)

    def ground(self, x, z):
        if abs(x) > HX or abs(z) > HZ:
            return 0.0
        return ROAD if self.on_road(x, z) else KERB

    def road_dist(self, x, z):
        best = 1e9
        for (ax, w) in AVES:
            best = min(best, abs(x - ax) - w / 2)
        for (sz, w) in STS:
            best = min(best, abs(z - sz) - w / 2)
        return best

    @staticmethod
    def spans(half, lines):
        """The block intervals between the roads along one axis."""
        out = []
        lo = -half
        for (at, w) in lines:
            out.append((lo, at - w / 2))
            lo = at + w / 2
        out.append((lo, half))
        return out

    # -- pieces -----------------------------------------------------------------------

    def slab(self, x0, x1, z0, z1, y0, y1, mat, tint=0):
        self.box((x0 + x1) / 2, (y0 + y1) / 2 - self.base_y, (z0 + z1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, 0.0, mat, tint)

    def walls(self, cx, cz, hw, hd, y0, y1, mat, tint, doors=(), windows=(), t=0.3):
        """Four walls round a rectangle, with openings: doors (side, u, width, height)
        and windows (side, u, width, bottom, top). u runs along the wall from its middle."""
        ops = {s: [] for s in 'NSEW'}
        for (s, u, w, h) in doors:
            ops[s].append((u, w, y0, y0 + h))
        for (s, u, w, b, tp) in windows:
            ops[s].append((u, w, y0 + b, y0 + tp))
        for s in 'NSEW':
            L = 2 * hw if s in 'NS' else 2 * hd
            pieces = []
            cur = -L / 2
            for (u, w, b, tp) in sorted(ops[s]):
                pieces.append((cur, u - w / 2, y0, y1))
                if b > y0:
                    pieces.append((u - w / 2, u + w / 2, y0, b))
                if tp < y1:
                    pieces.append((u - w / 2, u + w / 2, tp, y1))
                cur = u + w / 2
            pieces.append((cur, L / 2, y0, y1))
            for (a, b, p0, p1) in pieces:
                if b - a < 0.01 or p1 - p0 < 0.01:
                    continue
                if s == 'S':
                    self.slab(cx + a, cx + b, cz - hd, cz - hd + t, p0, p1, mat, tint)
                elif s == 'N':
                    self.slab(cx + a, cx + b, cz + hd - t, cz + hd, p0, p1, mat, tint)
                elif s == 'W':
                    self.slab(cx - hw, cx - hw + t, cz + a, cz + b, p0, p1, mat, tint)
                else:
                    self.slab(cx + hw - t, cx + hw, cz + a, cz + b, p0, p1, mat, tint)
        for (s, u, w, h) in doors:
            if s == 'S':
                self.doors.append((cx + u, cz - hd - 0.9))
            elif s == 'N':
                self.doors.append((cx + u, cz + hd + 0.9))
            elif s == 'W':
                self.doors.append((cx - hw - 0.9, cz + u))
            else:
                self.doors.append((cx + hw + 0.9, cz + u))

    def parapet(self, cx, cz, hw, hd, y0, h=1.0, mat='concrete', tint=0, t=0.3):
        self.slab(cx - hw, cx + hw, cz - hd, cz - hd + t, y0, y0 + h, mat, tint)
        self.slab(cx - hw, cx + hw, cz + hd - t, cz + hd, y0, y0 + h, mat, tint)
        self.slab(cx - hw, cx - hw + t, cz - hd + t, cz + hd - t, y0, y0 + h, mat, tint)
        self.slab(cx + hw - t, cx + hw, cz - hd + t, cz + hd - t, y0, y0 + h, mat, tint)

    def ring_slabs(self, cx, cz, hw, hd, y0, y1, mat, tint=0, ix=WELL_X, iz=WELL_Z, skip_s=False):
        """A slab with a hole in the middle (the stairwell): four pieces."""
        self.slab(cx - hw, cx - ix, cz - hd, cz + hd, y0, y1, mat, tint)
        self.slab(cx + ix, cx + hw, cz - hd, cz + hd, y0, y1, mat, tint)
        if not skip_s:
            self.slab(cx - ix, cx + ix, cz - hd, cz - iz, y0, y1, mat, tint)
        self.slab(cx - ix, cx + ix, cz + iz, cz + hd, y0, y1, mat, tint)

    def stairwell(self, cx, cz, y0, storeys, doors=(), walls=True, rail=True):
        """A switchback stair up a 3 by 5.3 m well: a flight up the west side, a landing,
        a flight back down the east side to the next landing, each landing a storey up.
        The way in and out is a door in the south wall at every level in `doors`
        (storey numbers), and the top landing opens onto whatever is up there."""
        wx, wz = WELL_X - 0.3, WELL_Z - 0.3          # the clear well
        za = -wz + 1.5                               # the south landing ends, flight A starts
        self.slab(cx - wx, cx + wx, cz - wz, cz + za, y0 - 0.25, y0, 'concrete', 2)
        for n in range(storeys):
            base = y0 + n * STORY
            for i in range(6):
                top = base + (i + 1) * RISE
                self.slab(cx - wx, cx - 0.1, cz + za + i * STEP_D, cz + za + (i + 1) * STEP_D, top - RISE - 0.02, top, 'stair')
            mid = base + 6 * RISE
            self.slab(cx - wx, cx + wx, cz + za + FLIGHT, cz + wz, mid - 0.25, mid, 'concrete', 2)
            for j in range(6):
                top = mid + (j + 1) * RISE
                self.slab(cx + 0.1, cx + wx, cz + za + FLIGHT - (j + 1) * STEP_D, cz + za + FLIGHT - j * STEP_D, top - RISE - 0.02, top, 'stair')
            self.slab(cx - wx, cx + wx, cz - wz, cz + za, base + STORY - 0.25, base + STORY, 'concrete', 2)
        top = y0 + storeys * STORY
        if walls:
            # east and west, full height, plus a railing round the hole on the roof
            extra = 1.0 if rail else 0.0
            self.slab(cx - WELL_X, cx - wx, cz - WELL_Z, cz + WELL_Z, y0, top + extra, 'concrete', 2)
            self.slab(cx + wx, cx + WELL_X, cz - WELL_Z, cz + WELL_Z, y0, top + extra, 'concrete', 2)
            self.slab(cx - wx, cx + wx, cz + wz, cz + WELL_Z, y0, top + extra, 'concrete', 2)
            # south: solid between the doors, which are 1.4 wide and 2.3 tall at each landing
            levels = sorted(set(d for d in doors if 0 <= d < storeys))
            y = y0
            for lvl in levels:
                dy = y0 + lvl * STORY
                if dy > y:
                    self.slab(cx - WELL_X, cx + WELL_X, cz - WELL_Z, cz - wz, y, dy, 'concrete', 2)
                self.slab(cx - WELL_X, cx - 0.7, cz - WELL_Z, cz - wz, dy, dy + 2.3, 'concrete', 2)
                self.slab(cx + 0.7, cx + WELL_X, cz - WELL_Z, cz - wz, dy, dy + 2.3, 'concrete', 2)
                y = dy + 2.3
            if top > y:
                self.slab(cx - WELL_X, cx + WELL_X, cz - WELL_Z, cz - wz, y, top, 'concrete', 2)
            for lvl in levels:
                self.doors.append((cx, cz - WELL_Z - 0.9))
        return top

    def lamp(self, x, z):
        self.box(x, 1.7, z, 0.1, 1.7, 0.1, 0, 'steel', 2)
        self.deco.append({'k': 'lamp', 'x': round(x, 2), 'y': round(self.base_y + 3.4, 2), 'z': round(z, 2)})
        self.props.append((x, z, 0.4))

    def tree(self, x, z, r=None):
        rng = self.rng
        r = r or rng.uniform(2.0, 3.0)
        h = rng.uniform(4.0, 5.5)
        self.box(x, h / 2, z, 0.3, h / 2, 0.3, 0, 'inv')
        self.box(x, h + 0.3 * r, z, r * 0.8, r * 0.7, r * 0.8, 0, 'inv')
        self.deco.append({'k': 'tree', 'x': round(x, 2), 'y': round(self.base_y, 2), 'z': round(z, 2), 'h': round(h, 2), 'r': round(r, 2), 'c': rng.randrange(3)})
        self.props.append((x, z, 0.8))

    def ac_unit(self, x, z, yaw=0.0):
        self.box(x, 0.7, z, 1.1, 0.7, 0.8, yaw, 'steel', 1)
        self.props.append((x, z, 1.4))

    def chest_at(self, x, y, z):
        self.fixed.append((round(x, 2), round(y, 2), round(z, 2)))

    # -- the tower ---------------------------------------------------------------------

    def tower(self):
        """The Spire: lobby, three tiers of glass, the stairwell up the middle, terraces
        at each set-back, and the gold room on the roof."""
        rng = self.rng
        self.base_y = KERB
        hw = TIERS[0][0]
        # the lobby: marble, a door in the middle of each side, tall windows either side
        doors = [(s, 0.0, 3.0, 3.4) for s in 'NSEW']
        wins = [(s, u, 2.6, 1.2, 4.2) for s in 'NSEW' for u in (-7.0, 7.0)]
        self.walls(0.0, 0.0, hw, hw, KERB, KERB + LOBBY, 'marble', 0, doors, wins, t=0.4)
        self.slab(-hw + 0.4, hw - 0.4, -hw + 0.4, hw - 0.4, KERB, KERB + 0.03, 'tile')
        for (x, z) in ((-7.0, -7.0), (7.0, -7.0), (-7.0, 7.0), (7.0, 7.0)):
            self.slab(x - 0.45, x + 0.45, z - 0.45, z + 0.45, KERB, KERB + LOBBY, 'marble')
            self.props.append((x, z, 0.7))
        self.slab(-3.0, 3.0, 6.6, 7.6, KERB, KERB + 1.05, 'marble')            # the desk
        self.props.append((0.0, 7.1, 3.2))
        for (x, z) in ((-9.5, 9.5), (9.5, -9.5), (9.5, 9.5)):
            self.chest_at(x, KERB + 0.03, z)
        # the body: solid glass round the stairwell, tier by tier, with a cap on each
        y = KERB + LOBBY
        prev = None
        top_y = KERB
        for ti, (half, storeys) in enumerate(TIERS):
            top_y = KERB + storeys * STORY
            # the first storey of a set-back tier has a passage from the well out to the terrace
            if ti > 0:
                self.ring_slabs(0.0, 0.0, half, half, y, y + STORY, 'glass', ti, skip_s=True)
                self.slab(-WELL_X, WELL_X, -half, -WELL_Z, y, y + 0.05, 'tile')
                self.ring_slabs(0.0, 0.0, half, half, y + STORY, top_y, 'glass', ti)
            else:
                self.ring_slabs(0.0, 0.0, half, half, y, top_y, 'glass', ti)
            if ti + 1 < len(TIERS):
                nxt = TIERS[ti + 1][0]
                # the terrace: a concrete deck round the next tier, a parapet, some cover, chests
                self.slab(-half, -nxt, -half, half, top_y, top_y + 0.05, 'flatroof')
                self.slab(nxt, half, -half, half, top_y, top_y + 0.05, 'flatroof')
                self.slab(-nxt, nxt, -half, -nxt, top_y, top_y + 0.05, 'flatroof')
                self.slab(-nxt, nxt, nxt, half, top_y, top_y + 0.05, 'flatroof')
                self.parapet(0.0, 0.0, half, half, top_y + 0.05, 1.0, 'concrete', 2)
                self.base_y = top_y + 0.05
                m = (half + nxt) / 2
                for (x, z) in ((-m, -m), (m, -m), (-m, m), (m, m)):
                    self.chest_at(x, top_y + 0.05, z)
                for (x, z, yaw) in ((0.0, -m, 0.0), (m, 0.0, math.pi / 2), (-m, 0.0, math.pi / 2), (0.0, m, 0.0)):
                    self.ac_unit(x, z, yaw)
                self.base_y = KERB
            y = top_y
        # the roof deck and the gold room on it
        half = TIERS[-1][0]
        self.slab(-half, -5.0, -half, half, top_y, top_y + 0.05, 'flatroof')
        self.slab(5.0, half, -half, half, top_y, top_y + 0.05, 'flatroof')
        self.slab(-5.0, 5.0, -half, -5.0, top_y, top_y + 0.05, 'flatroof')
        self.slab(-5.0, 5.0, 5.0, half, top_y, top_y + 0.05, 'flatroof')
        self.parapet(0.0, 0.0, half, half, top_y + 0.05, 1.0, 'concrete', 2)
        self.ring_slabs(0.0, 0.0, 5.0, 5.0, top_y, top_y + 0.05, 'marble')
        self.walls(0.0, 0.0, 5.0, 5.0, top_y, top_y + GOLD, 'gold', 0,
                   [('N', 0.0, 2.4, 2.8)], [('E', 0.0, 2.0, 1.2, 3.0), ('W', 0.0, 2.0, 1.2, 3.0)], t=0.4)
        self.slab(-5.0, 5.0, -5.0, 5.0, top_y + GOLD, top_y + GOLD + 0.4, 'gold')
        self.slab(-1.2, 1.2, -1.2, 1.2, top_y + GOLD + 0.4, top_y + GOLD + 1.6, 'steel', 2)
        self.slab(-0.3, 0.3, -0.3, 0.3, top_y + GOLD + 1.6, top_y + GOLD + 14.0, 'steel', 2)
        self.deco.append({'k': 'lamp', 'x': 0.0, 'y': round(top_y + GOLD + 14.0, 2), 'z': 0.0})
        for (x, z) in ((-3.4, 3.4), (3.4, 3.4), (3.4, -3.4)):
            self.gold.append((x, round(top_y + 0.05, 2), z))
        self.tower_h = top_y + GOLD + 14.0
        # the stairwell, all the way up, with a door at the lobby, each terrace and the top
        self.base_y = 0.0
        self.stairwell(0.0, 0.0, KERB, TIERS[-1][1], doors=[0] + [s for (_, s) in TIERS[:-1]])
        self.base_y = KERB
        self.rects.append((0.0, 0.0, hw, hw, 0.0))
        self.areas.append({'n': 'The Spire', 'x': 0.0, 'z': 0.0, 'r': 24})

    # -- the blocks -------------------------------------------------------------------

    def midrise(self, cx, cz, hw, hd, floors, tint, glass=True):
        """A building you can go all the way up: a floor at every storey round a
        stairwell in the middle, doors at the street, windows on every side, a
        partition or two, and the stair opening onto the roof. Glass above the
        ground floor for the towers, concrete for the rest."""
        rng = self.rng
        self.base_y = KERB
        floors = max(4, floors)
        H = KERB + floors * STORY
        sides = ['N', 'S', 'E', 'W']
        rng.shuffle(sides)
        doors = [(s, rng.uniform(-hw * 0.4, hw * 0.4) if s in 'NS' else rng.uniform(-hd * 0.4, hd * 0.4), 2.0, 2.6) for s in sides[:rng.choice([1, 2, 2])]]
        for f in range(floors):
            y0 = KERB + f * STORY
            wins = []
            for s in 'NSEW':
                L = hw if s in 'NS' else hd
                us = (-L * 0.6, L * 0.6) if L < 7.5 else (-L * 0.66, 0.0, L * 0.66)
                for u in us:
                    if f == 0 and any(abs(u - du) < 2.6 for (ds, du, _, _) in doors if ds == s):
                        continue
                    wins.append((s, u, 1.6, 1.0, 2.4))
            mat, mt = ('concrete', tint % 3) if (f == 0 or not glass) else ('glass', tint % 3)
            self.walls(cx, cz, hw, hd, y0, y0 + STORY, mat, mt, doors if f == 0 else (), wins)
            if f == 0:
                self.slab(cx - hw + 0.3, cx + hw - 0.3, cz - hd + 0.3, cz + hd - 0.3, KERB, KERB + 0.03, 'tile')
            else:
                self.ring_slabs(cx, cz, hw - 0.3, hd - 0.3, y0 - 0.25, y0, 'concrete', 0)
            # a partition across one end, with a doorway, where there is room for a room
            if hd >= 8.5:
                side = 1 if f % 2 else -1
                pz = cz + side * (hd - 0.3 + WELL_Z) / 2
                dx = rng.uniform(-hw + 1.6, hw - 1.6)
                self.slab(cx - hw + 0.3, cx + dx - 0.7, pz - 0.1, pz + 0.1, y0, y0 + STORY - 0.25, 'concrete', 2)
                self.slab(cx + dx + 0.7, cx + hw - 0.3, pz - 0.1, pz + 0.1, y0, y0 + STORY - 0.25, 'concrete', 2)
                self.slab(cx + dx - 0.7, cx + dx + 0.7, pz - 0.1, pz + 0.1, y0 + 2.3, y0 + STORY - 0.25, 'concrete', 2)
            # something to stand behind on every floor, and a chest on the ones the
            # general lottery does not reach
            sz = rng.uniform(0.8, 1.1)
            bxp = cx + rng.choice([-1, 1]) * (hw - 1.6)
            bzp = cz + rng.choice([-1, 1]) * (hd - 1.6)
            self.slab(bxp - sz / 2, bxp + sz / 2, bzp - sz / 2, bzp + sz / 2, y0 + (0.03 if f == 0 else 0), y0 + sz, 'crate')
            if y0 >= 12.0:
                self.chest_at(cx - (bxp - cx), y0, cz - (bzp - cz))
        # the roof: a deck with the stair opening, a parapet, an air unit, a chest
        self.ring_slabs(cx, cz, hw, hd, H, H + 0.1, 'flatroof')
        self.parapet(cx, cz, hw, hd, H + 0.1, 1.0, 'concrete', 2)
        self.base_y = H + 0.1
        self.ac_unit(cx + rng.choice([-1, 1]) * (hw - 2.2), cz + rng.choice([-1, 1]) * (hd - 2.2), rng.choice([0.0, math.pi / 2]))
        self.chest_at(cx + rng.choice([-1, 1]) * (hw - 1.8), H + 0.1, cz + rng.choice([-1, 1]) * (hd - 1.8))
        self.base_y = 0.0
        self.stairwell(cx, cz, KERB, floors, doors=list(range(floors)))
        self.base_y = KERB
        self.rects.append((cx, cz, hw, hd, 0.0))

    def highrise(self, cx, cz, hw, hd, storeys, tint):
        self.midrise(cx, cz, hw, hd, storeys, tint, glass=True)

    def shop(self, cx, cz, w, d, tint):
        self.midrise(cx, cz, w / 2, d / 2, 4, tint, glass=False)

    def park(self, x0, x1, z0, z1):
        rng = self.rng
        self.base_y = KERB
        cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
        map_manor.Manor.statue(self, cx, cz, rng.uniform(0, math.tau), 1.2)
        self.slab(cx - 2.2, cx + 2.2, cz - 2.2, cz + 2.2, KERB, KERB + 0.4, 'marble')
        for (dx, dz) in ((-4.5, 0.0), (4.5, 0.0), (0.0, -4.5), (0.0, 4.5)):
            map_manor.Manor.bench(self, cx + dx, cz + dz, math.atan2(dz, dx) + math.pi / 2)
        for _ in range(60):
            if sum(1 for d in self.deco if d['k'] == 'tree' and x0 < d['x'] < x1 and z0 < d['z'] < z1) >= 9:
                break
            x, z = rng.uniform(x0 + 2.5, x1 - 2.5), rng.uniform(z0 + 2.5, z1 - 2.5)
            if math.hypot(x - cx, z - cz) > 6.5 and self.free(x, z, 1.4, 1.0, 1.0, road=False):
                self.tree(x, z)
        for (x, z, yaw) in ((x0 + 3.0, z0 + 3.0, 0.0), (x1 - 3.0, z1 - 3.0, 0.0), (x0 + 3.0, z1 - 3.0, math.pi / 2), (x1 - 3.0, z0 + 3.0, math.pi / 2)):
            map_manor.Manor.hedge(self, x, z, 2.2, 0.5, yaw, 1.0)
        self.chest_at(cx - 3.2, KERB, cz - 3.2)
        self.chest_at(cx + 3.2, KERB, cz + 3.2)
        self.areas.append({'n': 'The Park', 'x': round(cx, 1), 'z': round(cz, 1), 'r': 16})

    def carpark(self, x0, x1, z0, z1):
        rng = self.rng
        self.base_y = KERB
        cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
        # the booth by the entrance
        self.walls(x0 + 3.0, z0 + 3.0, 1.6, 1.6, KERB, KERB + 2.7, 'concrete', 1, [('E', 0.0, 1.2, 2.2)], [('S', 0.0, 1.4, 1.0, 2.0)])
        self.slab(x0 + 1.4, x0 + 4.6, z0 + 1.4, z0 + 4.6, KERB + 2.7, KERB + 2.9, 'flatroof')
        self.rects.append((x0 + 3.0, z0 + 3.0, 1.6, 1.6, 0.0))
        rows = int((z1 - z0 - 6) / 6.5)
        for r in range(rows):
            z = z0 + 5.0 + r * 6.5
            x = x0 + 8.0
            while x < x1 - 3.0:
                if rng.random() < 0.7:
                    self.car(x, z, rng.uniform(-0.15, 0.15))
                    self.props.append((x, z, 2.4))
                x += 4.8
        map_dock.Dockyard.jersey(self, cx, z1 - 2.0, 0.0, 3)
        self.lamp(x1 - 2.0, z0 + 2.0)
        self.chest_at(x1 - 3.5, KERB, cz)
        self.chest_at(x0 + 8.0, KERB, z1 - 3.0)
        self.areas.append({'n': 'The Car Park', 'x': round(cx, 1), 'z': round(cz, 1), 'r': 16})

    def site(self, x0, x1, z0, z1):
        """A building site: three open concrete decks on columns, a stair up them,
        containers and materials about the yard."""
        rng = self.rng
        self.base_y = KERB
        cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
        hw, hd = min(9.0, (x1 - x0) / 2 - 3.0), min(7.0, (z1 - z0) / 2 - 3.0)
        for lvl in range(1, 4):
            y = KERB + lvl * STORY
            self.ring_slabs(cx, cz, hw, hd, y - 0.25, y, 'concrete', 0)
            self.parapet(cx, cz, hw, hd, y, 1.0, 'wood', 0, 0.12)
            self.chest_at(cx + (hw - 2.5) * rng.choice([-1, 1]), y, cz + (hd - 2.0) * rng.choice([-1, 1]))
        for x in (cx - hw + 0.5, cx, cx + hw - 0.5):
            for z in (cz - hd + 0.5, cz + hd - 0.5):
                self.slab(x - 0.3, x + 0.3, z - 0.3, z + 0.3, KERB, KERB + 3 * STORY, 'concrete', 1)
        self.stairwell(cx, cz, KERB, 3, doors=[0], walls=False)
        self.rects.append((cx, cz, hw, hd, 0.0))
        map_dock.Dockyard.container(self, x0 + 5.0, z1 - 3.5, 0.0, 0, False)
        map_dock.Dockyard.container(self, x1 - 5.0, z0 + 3.5, 0.0, 0, False)
        for _ in range(4):
            x, z = rng.uniform(x0 + 2, x1 - 2), rng.uniform(z0 + 2, z1 - 2)
            if self.free(x, z, 1.2, 1.0, 0.8, road=False):
                r = self.crate_stack(x, z, rng.uniform(0, math.pi))
                self.props.append((x, z, r))
        map_dock.Dockyard.jersey(self, x0 + 6.0, z0 + 2.0, 0.0, 2)
        self.areas.append({'n': 'Building Site', 'x': round(cx, 1), 'z': round(cz, 1), 'r': 16})

    # -- the streets ----------------------------------------------------------------

    def street_props(self, blocks):
        rng = self.rng
        # lamps on every block corner
        for (x0, x1, z0, z1) in blocks:
            for (x, z) in ((x0 + 1.0, z0 + 1.0), (x1 - 1.0, z0 + 1.0), (x0 + 1.0, z1 - 1.0), (x1 - 1.0, z1 - 1.0)):
                self.base_y = KERB
                self.lamp(x, z)
        # cars parked along the kerbs of the avenues, never in a junction
        for (ax, w) in AVES:
            for side in (-1, 1):
                z = -HZ + 6.0
                while z < HZ - 6.0:
                    if not any(abs(z - sz) < sw / 2 + 3.0 for (sz, sw) in STS) and rng.random() < 0.45:
                        x = ax + side * (w / 2 - 1.3)
                        self.base_y = ROAD
                        self.car(x, z, math.pi / 2 + rng.uniform(-0.05, 0.05))
                        self.props.append((x, z, 2.4))
                    z += 5.4
        # bins, barrels and barriers on the pavements
        self.base_y = KERB
        n = 0
        for _ in range(400):
            if n >= 60:
                break
            (x0, x1, z0, z1) = rng.choice(blocks)
            if (x0, x1, z0, z1) == self.centre:
                continue
            x, z = rng.uniform(x0 + 1.2, x1 - 1.2), rng.uniform(z0 + 1.2, z1 - 1.2)
            near_edge = min(x - x0, x1 - x, z - z0, z1 - z) < 2.2
            if not near_edge or not self.free(x, z, 1.0, 0.8, 0.8, road=False):
                continue
            r = rng.random()
            if r < 0.4:
                rad = self.crate_stack(x, z, rng.uniform(0, math.pi))
                self.props.append((x, z, rad))
            elif r < 0.7:
                self.barrel(x, z)
                self.props.append((x, z, 0.5))
            elif r < 0.85:
                map_dock.Dockyard.jersey(self, x, z, 0.0 if abs(x - x0) < 2.2 or abs(x1 - x) < 2.2 else math.pi / 2, 1)
            else:
                map_manor.Manor.hedge(self, x, z, 1.6, 0.5, 0.0 if abs(z - z0) < 2.2 or abs(z1 - z) < 2.2 else math.pi / 2, 1.0)
            n += 1
        # the plaza round the tower: planters, benches, a few trees
        (x0, x1, z0, z1) = self.centre
        for (x, z) in ((x0 + 3.0, z0 + 3.0), (x1 - 3.0, z0 + 3.0), (x0 + 3.0, z1 - 3.0), (x1 - 3.0, z1 - 3.0)):
            map_manor.Manor.hedge(self, x, z, 1.6, 1.6, 0.0, 0.8)
        for (x, z, yaw) in ((0.0, z0 + 3.0, 0.0), (0.0, z1 - 3.0, math.pi), (x0 + 4.0, 0.0, math.pi / 2), (x1 - 4.0, 0.0, -math.pi / 2)):
            map_manor.Manor.bench(self, x, z, yaw)
        for (x, z) in ((x0 + 8.0, z0 + 3.5), (x1 - 8.0, z1 - 3.5)):
            self.tree(x, z, 2.2)

    # -- the whole thing ------------------------------------------------------------

    def generate(self):
        rng = self.rng
        xs = self.spans(HX, AVES)
        zs = self.spans(HZ, STS)
        blocks = [(x0, x1, z0, z1) for (x0, x1) in xs for (z0, z1) in zs]
        self.centre = (xs[2][0], xs[2][1], zs[2][0], zs[2][1])
        # which block is the park, the car park and the site: outer blocks, away from each other
        outer = [b for b in blocks if b != self.centre and (b[0] == xs[0][0] or b[1] == xs[-1][1] or b[2] == zs[0][0] or b[3] == zs[-1][1])]
        rng.shuffle(outer)
        special = {}
        for kind in ('park', 'carpark', 'site'):
            for b in outer:
                if b in special:
                    continue
                if all(math.hypot((b[0] + b[1]) / 2 - (o[0] + o[1]) / 2, (b[2] + b[3]) / 2 - (o[2] + o[3]) / 2) > 60 for o in special):
                    special[b] = kind
                    break
        # the pavements: a concrete step up from the road on every block, grass for the park
        self.base_y = 0.0
        for b in blocks:
            (x0, x1, z0, z1) = b
            self.slab(x0, x1, z0, z1, 0.0, KERB, 'terrain', 2 if special.get(b) == 'park' else 3)
        # the roads: solid asphalt, the avenues owning the junctions
        for (ax, w) in AVES:
            self.box(ax, ROAD / 2, 0.0, w / 2, ROAD / 2, HZ, 0.0, 'asphalt')
            self.roads.append({'w': w, 'pts': [(ax, -HZ), (ax, HZ)]})
            self.deco.append({'k': 'road', 'w': w, 'c': 'asphalt', 'solid': 1, 'pts': [[ax, -HZ, ROAD], [ax, HZ, ROAD]]})
        for (sz, w) in STS:
            for (x0, x1) in xs:
                self.box((x0 + x1) / 2, ROAD / 2, sz, w / 2, ROAD / 2, (x1 - x0) / 2, math.pi / 2, 'asphalt')
            self.roads.append({'w': w, 'pts': [(-HX, sz), (HX, sz)]})
            self.deco.append({'k': 'road', 'w': w, 'c': 'asphalt', 'solid': 1, 'pts': [[-HX, sz, ROAD], [HX, sz, ROAD]]})
        # the tower, then the blocks round it
        self.tower()
        for b in blocks:
            if b == self.centre:
                continue
            (x0, x1, z0, z1) = b
            kind = special.get(b)
            if kind == 'park':
                self.park(x0, x1, z0, z1)
            elif kind == 'carpark':
                self.carpark(x0, x1, z0, z1)
            elif kind == 'site':
                self.site(x0, x1, z0, z1)
            else:
                self.fill_block(x0, x1, z0, z1)
        self.street_props(blocks)
        # the lobby stands on the plaza before the plane
        (x0, x1, z0, z1) = self.centre
        pts = []
        for x in range(int(x0) + 3, int(x1) - 2, 2):
            for z in (z0 + 3.0, z1 - 3.0):
                pts.append((float(x), z))
        for z in range(int(z0) + 5, int(z1) - 4, 2):
            for x in (x0 + 3.0, x1 - 3.0):
                pts.append((x, float(z)))
        self.spawn_spots = [[round(x, 2), round(z, 2), KERB] for (x, z) in pts if self.free(x, z, 0.5, 0.6, 0.4, road=False)]
        self.areas.append({'n': 'Downtown', 'x': 0.0, 'z': 0.0, 'r': 0})
        self.areas.append({'n': 'North Downtown', 'x': 0.0, 'z': -60.0, 'r': 40})
        self.areas.append({'n': 'South Downtown', 'x': 0.0, 'z': 60.0, 'r': 40})
        self.areas.append({'n': 'West Downtown', 'x': -70.0, 'z': 0.0, 'r': 34})
        self.areas.append({'n': 'East Downtown', 'x': 70.0, 'z': 0.0, 'r': 34})
        self.base_y = 0.0
        self.site_a = (0.0, 0.0)
        self.site_b = (0.0, 0.0)
        self.hills = [(0.0, 0.0)]
        self.spawn_w = (-20.0, 0.0)
        self.spawn_e = (20.0, 0.0)
        self.ffa_spawns = self.spawn_spots
        self.team_spawns = [self.spawn_spots[:10], self.spawn_spots[10:20]]

    def fill_block(self, x0, x1, z0, z1):
        """Buildings on a block: high-rises near the middle of town, shops at its edge,
        each set back from the kerb by a pavement."""
        rng = self.rng
        w, d = x1 - x0, z1 - z0
        cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
        inner = abs(cx) < 50 and abs(cz) < 45
        m = 2.5                       # the pavement round a building
        if inner or rng.random() < 0.35:
            # one tower, or two side by side if the block is wide
            storeys = rng.randrange(5, 9) if inner else rng.randrange(4, 6)
            if w > 24 and rng.random() < 0.5:
                bw = (w - 3 * m) / 2
                self.highrise(x0 + m + bw / 2, cz, bw / 2, d / 2 - m, storeys, rng.randrange(3))
                self.highrise(x1 - m - bw / 2, cz, bw / 2, d / 2 - m, rng.randrange(4, 7), rng.randrange(3))
            else:
                self.highrise(cx, cz, w / 2 - m, d / 2 - m, storeys, rng.randrange(3))
        else:
            # a row of shops along the block, each with its own doors and rooms
            n = max(1, int((w - m) / 12.5))
            bw = (w - (n + 1) * m) / n
            for i in range(n):
                self.shop(x0 + m + bw / 2 + i * (bw + m), cz, bw, min(d - 2 * m, 13.0), rng.randrange(3))

    def loot_spots(self, n_in, n_out):
        out = Town.loot_spots(self, n_in, n_out)
        keep = [s for s in out if all(math.hypot(s[0] - f[0], s[2] - f[2]) > 4.0 or abs(s[1] - f[1]) > 2.5 for f in self.fixed)]
        return list(self.fixed) + keep
