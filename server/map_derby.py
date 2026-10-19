"""
Dockyard Derby: the port turned into a race track, for the Derby mode.

A closed circuit of asphalt runs round the yard between red and white
barriers: a long start straight along the south quay, a chicane up the
east side, a hairpin into the middle of the yard and out again, an S-bend
down the west quay and back to the line. Containers, sheds and cranes fill
the infield and the edges; two gantry cranes stand over the track.

Every golf cart on the map sits on the starting grid. The map also carries
the track's centre line ('track'), so the server and the game can put a
player back on the tarmac facing the right way.
"""

import math

import mapgen
from mapgen import catmull
from map_dock import Dockyard, C_LEN, C_HALF, S_LEN

TRACK_W = 11.0          # the tarmac, kerb to kerb
BARRIER_T = 0.3         # half the thickness of a barrier
BARRIER_H = 0.45        # half its height: a cart can't climb it
CARTS = 12              # one for everyone in a full room
# the circuit, clockwise from the start straight (checked in tools/test_v33.py:
# no bend tighter than a cart can take, no two parts of it closer than 30 m)
CONTROL = [(-40, 34), (-10, 36), (20, 34), (42, 31), (51, 18), (47.5, 4), (52, -10), (48, -30), (36, -38),
           (20, -32), (12, -18), (0, -11), (-12, -16), (-20, -32), (-34, -38), (-50, -31), (-53, -14),
           (-47.5, 0), (-53, 15), (-51, 28)]
START_S = 22.0          # the start line, this far along the lap from the first point
# where the carts nobody is driving are parked: a row inside the start straight
PIT_X0, PIT_Z, PIT_STEP = -26.0, 24.5, 4.4


def centre_line(step=1.5):
    """The circuit as a closed list of points about `step` apart."""
    n = len(CONTROL)
    pts = []
    for i in range(n):
        p0, p1, p2, p3 = CONTROL[(i - 1) % n], CONTROL[i], CONTROL[(i + 1) % n], CONTROL[(i + 2) % n]
        L = math.hypot(p2[0] - p1[0], p2[1] - p1[1])
        k = max(4, int(L / step))
        for j in range(k):
            pts.append(catmull(p0, p1, p2, p3, j / k))
    return pts


class DockDerby(Dockyard):
    kind = 'derby'
    name = 'Dockyard Derby'
    theme = 'concrete'

    def __init__(self, seed):
        Dockyard.__init__(self, seed)
        self.track = centre_line()
        # the start line: the point START_S along, and the arc length at each point
        self.arc = [0.0]
        for i in range(1, len(self.track)):
            a, b = self.track[i - 1], self.track[i]
            self.arc.append(self.arc[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
        self.start_i = min(range(len(self.track)), key=lambda i: abs(self.arc[i] - START_S))

    # -- the track ----------------------------------------------------------

    def track_dist(self, x, z):
        best = 1e9
        T = self.track
        for i in range(len(T)):
            a, b = T[i], T[(i + 1) % len(T)]
            d = mapgen.seg_dist(x, z, a[0], a[1], b[0], b[1])
            if d < best:
                best = d
        return best

    def road_dist(self, x, z):
        # anything kept off a road is kept off the track and its barriers
        return self.track_dist(x, z) - TRACK_W / 2 - BARRIER_T * 2 - 1.0

    def clear_of_track(self, x, z, hx, hz, yaw, margin=1.5):
        """Is a rectangle (centre, half sizes, yaw) clear of the tarmac and its barriers?"""
        for lx in (-hx, 0.0, hx):
            for lz in (-hz, 0.0, hz):
                ox, oz = mapgen.rot(lx, lz, yaw)
                if self.track_dist(x + ox, z + oz) < TRACK_W / 2 + BARRIER_T * 2 + margin:
                    return False
        return abs(x) + max(hx, hz) < self.bx - 0.8 and abs(z) + max(hx, hz) < self.bz - 0.8

    def heading(self, i):
        """The way the track runs at point i, as a cart's yaw (local +x forward)."""
        T = self.track
        a, b = T[(i - 1) % len(T)], T[(i + 1) % len(T)]
        return math.atan2(-(b[1] - a[1]), b[0] - a[0])

    def barriers(self):
        T = self.track
        n = len(T)
        off = TRACK_W / 2 + BARRIER_T
        side_pts = {-1: [], 1: []}
        for i in range(n):
            a, b = T[(i - 1) % n], T[(i + 1) % n]
            dx, dz = b[0] - a[0], b[1] - a[1]
            L = math.hypot(dx, dz) or 1.0
            nx, nz = -dz / L, dx / L
            for s in (-1, 1):
                side_pts[s].append((T[i][0] + nx * off * s, T[i][1] + nz * off * s))
        for s in (-1, 1):
            P = side_pts[s]
            for i in range(n):
                a, b = P[i], P[(i + 1) % n]
                dx, dz = b[0] - a[0], b[1] - a[1]
                L = math.hypot(dx, dz)
                if L < 0.05:
                    continue
                yaw = math.atan2(-dz, dx)
                # red and white in runs of two
                self.box((a[0] + b[0]) / 2, BARRIER_H, (a[1] + b[1]) / 2, L / 2 + 0.12, BARRIER_H, BARRIER_T, yaw, 'barrier', (i // 2) % 2)

    # -- the yard -----------------------------------------------------------

    def generate(self):
        rng = self.rng
        bx, bz = self.bx, self.bz
        T = self.track
        n = len(T)
        wh = 3.6
        self.box(0, wh / 2, -bz - 0.5, bx + 1, wh / 2, 0.5, 0, 'concrete', 0)
        self.box(0, wh / 2, bz + 0.5, bx + 1, wh / 2, 0.5, 0, 'concrete', 0)
        self.box(-bx - 0.5, wh / 2, 0, 0.5, wh / 2, bz, 0, 'concrete', 0)
        self.box(bx + 0.5, wh / 2, 0, 0.5, wh / 2, bz, 0, 'concrete', 0)

        # the tarmac, closed round on itself, and the barriers either side
        loop = [[round(x, 2), round(z, 2)] for (x, z) in T] + [[round(T[0][0], 2), round(T[0][1], 2)]]
        self.deco.append({'k': 'road', 'w': TRACK_W, 'c': 'asphalt', 'pts': loop})
        self.barriers()
        # the chequered line across the track
        si = self.start_i
        sx, sz = T[si]
        self.deco.append({'k': 'checker', 'x': round(sx, 2), 'z': round(sz, 2), 'yaw': round(self.heading(si), 4), 'w': TRACK_W})
        self.areas.append({'n': 'Start Line', 'x': round(sx, 1), 'z': round(sz, 1), 'r': 10})

        # the grid: two columns behind the line, nose to tail. A cart is put on it
        # when someone starts a race; the rest wait in the pit row, off the track
        self.grid = []
        i = si
        while len(self.grid) < CARTS:
            i = (i - 3) % n          # about four and a half metres back each row
            yaw = self.heading(i)
            fx, fz = math.cos(yaw), -math.sin(yaw)
            lx, lz = -fz, fx        # across the track
            for s in (-1, 1):
                if len(self.grid) < CARTS:
                    self.grid.append((T[i][0] + lx * s * 2.3, T[i][1] + lz * s * 2.3, yaw))
        for k in range(CARTS):
            x, z = PIT_X0 + k * PIT_STEP, PIT_Z
            self.deco.append({'k': 'golfcart', 'id': k + 1, 'x': round(x, 2), 'y': 0.0, 'z': round(z, 2), 'yaw': 0.0})
        self.rects.append((PIT_X0 + (CARTS - 1) * PIT_STEP / 2, PIT_Z, (CARTS - 1) * PIT_STEP / 2 + 2.0, 1.8, 0.0))
        self.deco.append({'k': 'lines', 'x': round(PIT_X0 + (CARTS - 1) * PIT_STEP / 2, 2), 'z': PIT_Z + 1.6, 'l': (CARTS - 1) * PIT_STEP + 4, 'yaw': round(math.pi / 2, 4)})
        self.areas.append({'n': 'Pit Row', 'x': PIT_X0 + (CARTS - 1) * PIT_STEP / 2, 'z': PIT_Z, 'r': 10})

        # two gantry cranes standing over the track: the start straight and the east side
        for (cx, cz) in ((-37.0, 34.4), (50.5, -20.0)):
            j = min(range(n), key=lambda q: math.hypot(T[q][0] - cx, T[q][1] - cz))
            yaw = self.heading(j)
            # the crane's legs stand across the track: its span runs along local z
            self.crane(T[j][0], T[j][1], yaw, 20.0, 12.0)

        # sheds and stacks of containers wherever the track leaves room
        for (x, z, w, d, yaw, tint) in ((0.0, 15.0, 22.0, 13.0, 0.0, 3), (0.0, -30.0, 18.0, 10.0, 0.0, 4)):
            if self.clear_of_track(x, z, w / 2, d / 2, yaw, 2.0):
                self.shed(x, z, w, d, yaw, tint)
                self.areas.append({'n': 'Pit Warehouse' if z > 0 else 'North Warehouse', 'x': x, 'z': z, 'r': 10})
        tries = 0
        while tries < 600 and sum(1 for r in self.rects if abs(r[2] - C_LEN) < 0.01) < 26:
            tries += 1
            x = rng.uniform(-bx + 4, bx - 4)
            z = rng.uniform(-bz + 4, bz - 4)
            yaw = rng.choice([0.0, math.pi / 2])
            if not self.clear_of_track(x, z, C_LEN, C_HALF, yaw, 2.0) or not self.free(x, z, C_LEN, 1.2, 1.0, road=False):
                continue
            self.stack(x, z, yaw, rng.choice([1, 1, 2, 2, 3]))
        tries = 0
        while tries < 400 and sum(1 for r in self.rects if abs(r[2] - S_LEN) < 0.01) < 14:
            tries += 1
            x = rng.uniform(-bx + 4, bx - 4)
            z = rng.uniform(-bz + 4, bz - 4)
            yaw = rng.uniform(0, math.pi)
            if not self.clear_of_track(x, z, S_LEN, C_HALF, yaw, 1.5) or not self.free(x, z, S_LEN, 1.0, 0.8, road=False):
                continue
            self.container(x, z, yaw, 0, False)
        # tyre walls on the outside of the tightest bends, and barrels in the run-off
        for cp in ((51, 18), (47.5, 4), (-47.5, 0), (0, -11), (36, -38)):
            j = min(range(n), key=lambda q: math.hypot(T[q][0] - cp[0], T[q][1] - cp[1]))
            for q in (j - 4, j, j + 4):
                a, b = T[(q - 1) % n], T[(q + 1) % n]
                dx, dz = b[0] - a[0], b[1] - a[1]
                L = math.hypot(dx, dz) or 1.0
                for s in (-1, 1):
                    x = T[q % n][0] - dz / L * s * (TRACK_W / 2 + 1.6)
                    z = T[q % n][1] + dx / L * s * (TRACK_W / 2 + 1.6)
                    if self.free(x, z, 0.5, 0.6, 0.4, road=False) and abs(x) < bx - 1.5 and abs(z) < bz - 1.5:
                        self.barrel(x, z)
                        self.props.append((x, z, 0.5))
        for (x, z) in ((-bx + 4, -bz + 4), (bx - 4, -bz + 4), (-bx + 4, bz - 4), (bx - 4, bz - 4)):
            if self.free(x, z, 0.4, 0.6, 0.4, road=False):
                self.mast(x, z)

        # nothing here uses the other modes' sites and hills, but the map carries them
        self.spawn_w = (-40.0, 34.0)
        self.spawn_e = (20.0, 34.0)
        self.site_a = (-40.0, 34.0)
        self.site_b = (20.0, 34.0)
        self.hills = [(0.0, 0.0)]
        self.ffa_spawns = [[round(x, 2), round(z, 2)] for (x, z, _) in self.grid]
        self.team_spawns = [self.ffa_spawns[0::2], self.ffa_spawns[1::2]]
        self.areas.append({'n': 'The Hairpin', 'x': 0.0, 'z': -11.0, 'r': 10})
        self.areas.append({'n': 'East Chicane', 'x': 50.0, 'z': 6.0, 'r': 12})
        self.areas.append({'n': 'West Esses', 'x': -50.0, 'z': 0.0, 'r': 12})

        # floodlights all the way round, for the night races
        self.base_y = 0.0
        for q in range(0, n, 14):
            a, b = T[(q - 1) % n], T[(q + 1) % n]
            dx, dz = b[0] - a[0], b[1] - a[1]
            L = math.hypot(dx, dz) or 1.0
            x = T[q][0] + dz / L * (TRACK_W / 2 + 2.2)
            z = T[q][1] - dx / L * (TRACK_W / 2 + 2.2)
            if self.free(x, z, 0.4, 0.6, 0.4, road=False) and abs(x) < bx - 1 and abs(z) < bz - 1:
                self.light('flood', x, 9.5, z)
        for a in self.areas:
            if 'Warehouse' in a['n']:
                self.light('bulb', a['x'], 5.6, a['z'])

    def to_json(self):
        j = Dockyard.to_json(self)
        j['track'] = [[round(x, 2), round(z, 2)] for (x, z) in self.track]
        j['trackW'] = TRACK_W
        j['start'] = self.start_i
        return j
