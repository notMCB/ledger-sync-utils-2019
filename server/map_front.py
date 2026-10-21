"""
The Long Souk: the Old Town twice as long, always the same (one fixed seed), for
Attack and Defend (Rush and Breakthrough). Attackers start at the west end and
push east through three sectors; each sector has two points, A on the south
side and B on the north, one of them inside a building and the other out in the
open, placed from the generated town so they are always somewhere that works.
"""

import math

import mapgen
from mapgen import Town, rot, point_in_rect, circle_rect_dist

FRONT_SEED = 20261021      # the town never changes
SECTORS = 3
ZONE_R = 7.0               # an outdoor point: a circle this wide
FLOOR_H = 3.0              # an indoor point: the ground floor, this high
SPAWNS_PER_POINT = 10


class Front(Town):
    kind = 'front'
    name = 'The Long Souk'

    def __init__(self, seed=FRONT_SEED):
        super().__init__(FRONT_SEED)
        self.bx = mapgen.BX * 2
        self.max_rects = 120
        self.build_tries = 40000
        self.ad = None

    def make_roads(self):
        super().make_roads()
        # the old town's cross streets sit in the middle; the long souk gets one in each outer half
        rng = self.rng
        for x0 in (-self.bx * 0.62, self.bx * 0.62):
            x0 += rng.uniform(-10, 10)
            self.roads.append({'w': rng.uniform(3.8, 5.0), 'pts': self._path((x0, -self.bz), (x0 + rng.uniform(-14, 14), self.bz), 10)})

    def _path(self, p0, p1, wiggle):
        rng = self.rng
        dx, dz = p1[0] - p0[0], p1[1] - p0[1]
        L = math.hypot(dx, dz)
        nx, nz = -dz / L, dx / L
        ctrl = [p0]
        for i in range(1, 6):
            t = i / 6
            off = rng.uniform(-wiggle, wiggle)
            ctrl.append((p0[0] + dx * t + nx * off, p0[1] + dz * t + nz * off))
        ctrl.append(p1)
        out = []
        for i in range(len(ctrl) - 1):
            a, b = ctrl[max(0, i - 1)], ctrl[i]
            c, d = ctrl[i + 1], ctrl[min(len(ctrl) - 1, i + 2)]
            for k in range(8):
                out.append(mapgen.catmull(a, b, c, d, k / 8))
        out.append(ctrl[-1])
        return [(max(-self.bx, min(self.bx, x)), max(-self.bz, min(self.bz, z))) for (x, z) in out]

    def generate(self):
        super().generate()
        self.layout()

    # -- the sectors --------------------------------------------------------------

    def inside_spot(self, sx, sz):
        """A roomy building near (sx, sz): its footprint, a clear spot on its ground floor up
        against a wall, and the way the thing standing there should face (into the room)."""
        best = None
        for rc in sorted(self.rects, key=lambda r: math.hypot(r[0] - sx, r[1] - sz)):
            x, z, hw, hd, yaw = rc
            if hw < 3.6 or hd < 3.4 or abs(x - sx) > 30:
                continue
            # candidates run along each wall first, a metre or so in, then further into the room
            cands = []
            for inset in (1.1, 1.5, 2.0, 2.8):
                along = [0.0, 1.2, -1.2, 2.4, -2.4, 3.6, -3.6]
                for a in along:
                    if abs(a) < hd - 1.4:
                        cands.append((-hw + inset, a, 0.0))      # the west wall: faces +x
                        cands.append((hw - inset, a, math.pi))   # the east wall: faces -x
                    if abs(a) < hw - 1.4:
                        cands.append((a, -hd + inset, math.pi / 2))   # the north wall of the room: faces +z
                        cands.append((a, hd - inset, -math.pi / 2))
            spot = None
            for (lx, lz, lface) in cands:
                wx, wz = rot(lx, lz, yaw)
                px, pz = x + wx, z + wz
                if self.clear_here(px, pz, 0.62, 0.1, 2.2):
                    spot = (px, pz, lface)
                    break
            if spot:
                best = (rc, spot)
                break
        return best

    def gap_rect(self, ox, oz):
        """The ground between the buildings either side of (ox, oz): a rectangle running
        wall to wall across the narrower of the two gaps, twelve metres the other way."""
        def reach(dx, dz):
            d = 0.0
            while d < 40.0:
                d += 0.5
                x, z = ox + dx * d, oz + dz * d
                if abs(x) > self.bx - 1.0 or abs(z) > self.bz - 1.0:
                    return d - 0.5
                if any(point_in_rect(x, z, rc, 0.0) for rc in self.rects):
                    return d - 0.5
            return 40.0
        gx = (reach(-1, 0), reach(1, 0))
        gz = (reach(0, -1), reach(0, 1))
        sx, sz = gx[0] + gx[1], gz[0] + gz[1]
        if min(sx, sz) >= 36.0:
            return None
        if sx <= sz:
            cx = ox + (gx[1] - gx[0]) / 2
            return {'k': 'rect', 'x': round(cx, 2), 'z': round(oz, 2), 'hw': round(sx / 2 - 0.1, 2), 'hd': 6.0, 'yaw': 0.0}
        cz = oz + (gz[1] - gz[0]) / 2
        return {'k': 'rect', 'x': round(ox, 2), 'z': round(cz, 2), 'hw': 6.0, 'hd': round(sz / 2 - 0.1, 2), 'yaw': 0.0}

    def outside_spot(self, sx, sz):
        """The most open patch of ground near (sx, sz): well clear of every building and prop."""
        best, best_d = None, -1.0
        for i in range(-10, 11):
            for j in range(-8, 9):
                x, z = sx + i * 2.0, sz + j * 2.0
                if abs(x) > self.bx - 10 or abs(z) > self.bz - 9:
                    continue
                if not self.free(x, z, 2.5, 1.0, 0.8, road=False):
                    continue
                d = min([circle_rect_dist(x, z, rc) for rc in self.rects] + [self.bz - abs(z), 30.0])
                d -= 0.08 * math.hypot(x - sx, z - sz)      # close to where it was asked for, all else equal
                if d > best_d:
                    best, best_d = (x, z), d
        return best

    def spawn_spots(self, cx, cz, n, rmin=7.0, rmax=22.0, side=None, away=None):
        """Open ground around a point to come back to life on, never inside a building."""
        rng = self.rng
        out = []
        tries = 0
        while len(out) < n and tries < 1500:
            tries += 1
            a = rng.uniform(0, math.tau)
            r = rng.uniform(rmin, rmax)
            x, z = cx + math.cos(a) * r, cz + math.sin(a) * r
            if side is not None and (z < 0) != (side == 0):
                continue
            if away and math.hypot(x - away[0], z - away[1]) < away[2]:
                continue
            if not self.free(x, z, 0.7, 0.9, 0.5):
                continue
            if any(math.hypot(x - ox, z - oz) < 2.2 for (ox, oz) in out):
                continue
            out.append((round(x, 2), round(z, 2)))
        return out

    def layout(self):
        L = self.bx
        sectors = []
        for i in range(SECTORS):
            sx = -L * 0.45 + i * (L * 0.45)       # -68, 0, +68 along the length
            pts = []
            for side, sz in ((0, -self.bz * 0.5), (1, self.bz * 0.5)):
                inside = (i + side) % 2 == 0      # A inside, B out; then the other way round; and so on
                p = None
                if inside:
                    found = self.inside_spot(sx, sz)
                    if found:
                        (x, z, hw, hd, yaw), (px, pz, lface) = found
                        p = {'id': 'AB'[side], 'x': round(px, 2), 'y': round(self.base_y, 2), 'z': round(pz, 2), 'in': 1,
                             'face': round(lface + yaw, 4),
                             'zone': {'k': 'rect', 'x': round(x, 2), 'z': round(z, 2), 'hw': round(hw, 2), 'hd': round(hd, 2), 'yaw': round(yaw, 4),
                                      'y0': round(self.base_y - 1.0, 2), 'y1': round(self.base_y + FLOOR_H, 2)}}
                if p is None:
                    ox, oz = self.outside_spot(sx, sz) or (sx, sz)
                    zone = self.gap_rect(ox, oz) or {'k': 'circle', 'x': round(ox, 2), 'z': round(oz, 2), 'r': ZONE_R}
                    zone.update({'y0': round(self.base_y - 1.0, 2), 'y1': round(self.base_y + FLOOR_H, 2)})
                    p = {'id': 'AB'[side], 'x': round(ox, 2), 'y': round(self.base_y, 2), 'z': round(oz, 2), 'in': 0, 'face': round(-math.pi / 2, 4), 'zone': zone}
                p['spawns'] = self.spawn_spots(p['x'], p['z'], SPAWNS_PER_POINT)
                pts.append(p)
            sectors.append({'x': round(sx, 2), 'pts': pts})
        # Rush goes one further: a single bomb in the back corner of the town, on the attackers'
        # left (the south side, looking east from where they start)
        ex, ez = self.outside_spot(L - 18, -self.bz + 16) or (L - 18, -self.bz + 16)
        extra = {'id': 'A', 'x': round(ex, 2), 'y': round(self.base_y, 2), 'z': round(ez, 2), 'in': 0, 'face': round(-math.pi / 2, 4),
                 'zone': {'k': 'circle', 'x': round(ex, 2), 'z': round(ez, 2), 'r': ZONE_R, 'y0': round(self.base_y - 1.0, 2), 'y1': round(self.base_y + FLOOR_H, 2)},
                 'spawns': self.spawn_spots(ex, ez, SPAWNS_PER_POINT)}
        start = [self.spawn_spots(-L + 16, -self.bz * 0.45, SPAWNS_PER_POINT, 0.0, 12.0, side=0),
                 self.spawn_spots(-L + 16, self.bz * 0.45, SPAWNS_PER_POINT, 0.0, 12.0, side=1)]
        keep_off = (ex, ez, 18.0)      # the defenders of the last bomb never come back on top of it
        end = [self.spawn_spots(L - 14, -8.0, SPAWNS_PER_POINT, 0.0, 14.0, side=0, away=keep_off),
               self.spawn_spots(L - 14, self.bz * 0.45, SPAWNS_PER_POINT, 0.0, 12.0, side=1, away=keep_off)]
        self.ad = {'sectors': sectors, 'rush_extra': {'x': round(L - 18, 2), 'pts': [extra]}, 'start': start, 'end': end}
        # the plain modes' records, should anyone ever use them here
        self.spawn_w = (-L + 16, 0.0)
        self.spawn_e = (L - 16, 0.0)

    def to_json(self):
        m = super().to_json()
        m['ad'] = self.ad
        m['fixed'] = 1
        return m
