"""
Souk Royale: the battle royale map. Downtown in the middle, the four towns
round it, and real roads between them.

The city (map_city.py) sits at the centre: the largest place on the map,
with the Spire in the middle of it. Out past the ring road that runs round
the city are the four towns, one to each corner: Ridgeline in the north-west
with its ridge on the outer edge, Old Town in the north-east (always from
the same seed, so the souk is the same every game), the Dockyard in the
south-west and the Manor in the south-east, turned so its gate faces in.
None of them gets its boundary wall.

The roads are solid slabs of asphalt you stand and drive on, laid on the
ground and stepping with it: the city's avenues run out to the ring, spurs
run from the ring to each town's own roads, the Manor's drive comes up to
meet it, and field roads cross the open country west and east. Between the
towns the ground blends: stepped terrain ramps down from the snow to the
flat, the ground's texture changes patch by patch, and the cover in a field
is the kind its nearest town uses.

Loot chests stand in rooms on every storey and outside by cover, all over;
the three gold chests are in the gold room at the top of the Spire. The
plane, the gas and the players' kit live in server.py.
"""

import math

import mapgen
from mapgen import Town
import map_dock
import map_alpine
import map_manor
import map_city

TOWN_SEED = 20260925      # the souk never changes
CELL = 2.0                # the blend terrain grid
QUANT = 0.4               # a step of ground, under what a player can walk up
BX, BZ = 292.0, 166.0     # half size of the whole map
RING_X, RING_Z = 110.0, 94.0    # the ring road round the city
ROAD_H = 0.12             # a road's top stands this much over the ground it runs on
GROUND_TINT = {'alpine': 1, 'town': 0, 'dock': 3, 'manor': 2, 'city': 3}    # terrain tops: sand, snow, grass, concrete
N_CHESTS = 340
N_CARTS = 14           # golf carts parked about the seams, besides the ones the quarters bring
# where each town goes: centre and the turn, chosen so their roads come out facing the ring
LAYOUT = {
    'alpine': (-202.0, -96.0, 0.0),
    'town': (202.0, -86.0, 0.0),
    'dock': (-192.0, 94.0, 0.0),
    'manor': (202.0, 100.0, math.pi),
}
CHESTS_OF = {'town': (24, 14), 'dock': (16, 16), 'alpine': (14, 18), 'manor': (26, 14), 'city': (60, 34)}


def transform(cx, cz, yaw):
    """A function taking a quarter's local point to the world."""
    c, s = math.cos(yaw), math.sin(yaw)
    return lambda x, z: (cx + c * x + s * z, cz - s * x + c * z)


class Royale(Town):
    kind = 'royale'
    name = 'Souk Royale'
    theme = 'royale'

    def __init__(self, seed):
        Town.__init__(self, seed)
        self.bx, self.bz = BX, BZ
        self.vehicles = 0
        self.quarters = []     # {'kind', 'town', 'cx', 'cz', 'rot', 'x0', 'x1', 'z0', 'z1'}
        self.h = None          # blend terrain heights, [ix][iz]
        self.blend = None      # which cells are seam, not quarter
        self.tint = None
        self.chests = []       # [x, y, z, yaw] or [x, y, z, yaw, 1] for a gold one
        self.nx = int(2 * BX / CELL)
        self.nz = int(2 * BZ / CELL)
        self.city = None
        self.door_leaves = []  # the Manor's doors, carried across
        self.panes = []        # and its window glass

    # -- the quarters --------------------------------------------------------

    def make_quarter(self, kind, seed):
        if kind == 'town':
            t = Town(TOWN_SEED)
        elif kind == 'dock':
            t = map_dock.Dockyard(seed)
        elif kind == 'alpine':
            t = map_alpine.Alpine(seed)
        elif kind == 'city':
            t = map_city.City(seed)
        else:
            t = map_manor.Manor(seed)
        t.open = True
        t.generate()
        return t

    def place(self, kind, t, cx, cz, yaw):
        pt = transform(cx, cz, yaw)
        q = {'kind': kind, 'town': t, 'cx': cx, 'cz': cz, 'rot': yaw,
             'x0': cx - t.bx, 'x1': cx + t.bx, 'z0': cz - t.bz, 'z1': cz + t.bz, 'pt': pt}
        self.quarters.append(q)
        snow = kind == 'alpine'
        for b in t.boxes:
            x, z = pt(b[0], b[2])
            tint = 1 if (snow and b[7] == 'terrain') else b[8]
            self.boxes.append([round(x, 3), b[1], round(z, 3), b[3], b[4], b[5], round(b[6] + yaw, 4), b[7], tint])
        for d in t.deco:
            d = dict(d)
            k = d['k']
            if k in ('site', 'portal'):
                continue
            if k in ('forklift', 'golfcart'):
                self.vehicles += 1
                d['id'] = self.vehicles
            if 'x' in d:
                x, z = pt(d['x'], d['z'])
                d['x'], d['z'] = round(x, 2), round(z, 2)
            if 'yaw' in d:
                d['yaw'] = round(d['yaw'] + yaw, 4)
            if k == 'road':
                d['pts'] = [[round(v, 2) for v in pt(p[0], p[1])] + list(p[2:]) for p in d['pts']]
            if k == 'cliff':
                # the ridge's face is a line along x: it moves with its quarter, which is never turned
                if abs(yaw) > 1e-6:
                    continue
                d['pts'] = [[round(p[0] + cx, 2), round(p[1] + cz, 2), p[2], round(p[3] + cz, 2), p[4]] for p in d['pts']]
            if k == 'lanterns':
                d['a'] = [round(v, 2) for v in pt(*d['a'])]
                d['b'] = [round(v, 2) for v in pt(*d['b'])]
            self.deco.append(d)
        for (x, z, hw, hd, ry) in t.rects:
            wx, wz = pt(x, z)
            self.rects.append((wx, wz, hw, hd, ry + yaw))
        for (x, z, r) in t.props:
            self.props.append((*pt(x, z), r))
        for (x, z) in t.doors:
            self.doors.append(pt(x, z))
        # doors that open and glass that breaks come across with the quarter
        for d in getattr(t, 'door_leaves', []):
            x, z = pt(d['x'], d['z'])
            self.door_leaves.append(dict(d, id='d%d' % len(self.door_leaves), x=round(x, 2), z=round(z, 2), yaw=round(d['yaw'] + yaw, 4)))
        for d in getattr(t, 'panes', []):
            x, z = pt(d['x'], d['z'])
            self.panes.append(dict(d, id='p%d' % len(self.panes), x=round(x, 2), z=round(z, 2), yaw=round(d['yaw'] + yaw, 4)))
        for rd in t.roads:
            self.roads.append({'w': rd['w'], 'pts': [pt(p[0], p[1]) for p in rd['pts']]})
        for a in t.areas:
            if 'Gate' in a['n'] or 'End' in a['n'] or a['n'] == 'Tunnels':
                continue
            x, z = pt(a['x'], a['z'])
            self.areas.append({'n': a['n'], 'x': round(x, 1), 'z': round(z, 1), 'r': a['r']})
        # the flat quarters get their own ground: concrete for the yard, lawn for the estate
        if kind == 'dock':
            self.deco.append({'k': 'ground', 'x': cx, 'z': cz, 'w': 2 * t.bx, 'd': 2 * t.bz, 'c': 'concrete'})
        elif kind == 'manor':
            self.deco.append({'k': 'ground', 'x': cx, 'z': cz, 'w': 2 * t.bx, 'd': 2 * t.bz, 'c': 'grass'})
        # the quarter's own chests, in its rooms and yards
        for (x, y, z) in t.loot_spots(*CHESTS_OF[kind]):
            wx, wz = pt(x, z)
            self.chests.append([round(wx, 2), y, round(wz, 2), round(self.rng.uniform(0, math.pi), 3)])
        if kind == 'city':
            for (x, y, z) in t.gold:
                wx, wz = pt(x, z)
                self.chests.append([round(wx, 2), y, round(wz, 2), round(self.rng.uniform(0, math.pi), 3), 1])

    def in_quarter(self, x, z):
        for q in self.quarters:
            if q['x0'] <= x <= q['x1'] and q['z0'] <= z <= q['z1']:
                return q
        return None

    def exits(self, q, side):
        """Where a quarter's roads reach one of its edges ('N' is the low-z edge), in the world."""
        t, pt = q['town'], q['pt']
        out = []
        for rd in t.roads:
            for p in (rd['pts'][0], rd['pts'][-1]):
                wx, wz = pt(p[0], p[1])
                s = ('W' if abs(wx - q['x0']) < 1.5 else 'E' if abs(wx - q['x1']) < 1.5 else
                     'N' if abs(wz - q['z0']) < 1.5 else 'S' if abs(wz - q['z1']) < 1.5 else None)
                if s == side:
                    out.append((round(wx, 1), round(wz, 1), rd['w']))
        return out

    # -- the seams' ground ----------------------------------------------------

    def cell(self, x, z):
        return (max(0, min(self.nx - 1, int((x + BX) / CELL))), max(0, min(self.nz - 1, int((z + BZ) / CELL))))

    def ground(self, x, z):
        if self.h is None:
            return 0.0
        ix, iz = self.cell(x, z)
        if not self.blend[ix][iz]:
            q = self.in_quarter(x, z)
            if q:
                return q['town'].ground(x - q['cx'], z - q['cz'])
            return 0.0
        return self.h[ix][iz]

    def height_grid(self):
        """The whole map's cell heights and ground kinds for the smooth surface: the
        seams' own cells, Ridgeline's cells where its quarter lies (its grid lines up
        with this one), and flat ground everywhere else. The kind (sand, snow, grass,
        concrete) says what the raised ground is dressed in."""
        alp = next((q for q in self.quarters if q['kind'] == 'alpine'), None)
        A = alp['town'] if alp else None
        h = [[0.0] * self.nz for _ in range(self.nx)]
        tint = [[0] * self.nz for _ in range(self.nx)]
        for ix in range(self.nx):
            x = -BX + (ix + 0.5) * CELL
            for iz in range(self.nz):
                z = -BZ + (iz + 0.5) * CELL
                if self.blend[ix][iz]:
                    h[ix][iz] = round(self.h[ix][iz], 2)
                    tint[ix][iz] = self.tint[ix][iz]
                elif alp and alp['x0'] <= x <= alp['x1'] and alp['z0'] <= z <= alp['z1']:
                    h[ix][iz] = round(A.ground(x - alp['cx'], z - alp['cz']), 2)
                    tint[ix][iz] = 1
                else:
                    q = self.in_quarter(x, z)
                    tint[ix][iz] = GROUND_TINT[q['kind']] if q else 0
        return {'x0': -BX, 'z0': -BZ, 'cell': CELL, 'nx': self.nx, 'nz': self.nz, 'h': h, 'tint': tint}

    def surface(self, x, z):
        """The smooth ground a player walks on (see mapgen.surface_at)."""
        if self.h is None:
            return 0.0
        if getattr(self, '_grid', None) is None:
            self._grid = self.height_grid()      # the cells are settled once make_ground is done
        return mapgen.surface_at(self._grid, x, z)

    def make_ground(self):
        """Heights for every seam cell: the ridge's ground carried out and ramped
        down to the flat quarters, then relaxed so no step is over a player's stride."""
        rng = self.rng
        alp = next(q for q in self.quarters if q['kind'] == 'alpine')
        A = alp['town']
        q = lambda v: round(v / QUANT) * QUANT
        self.h = [[0.0] * self.nz for _ in range(self.nx)]
        self.blend = [[True] * self.nz for _ in range(self.nx)]
        self.tint = [[0] * self.nz for _ in range(self.nx)]
        fixed = set()
        self.fixed = fixed
        for ix in range(self.nx):
            x = -BX + (ix + 0.5) * CELL
            for iz in range(self.nz):
                z = -BZ + (iz + 0.5) * CELL
                if self.in_quarter(x, z):
                    self.blend[ix][iz] = False
                    continue
                # the nearest point of each quarter, and how far it is
                near = []
                for qq in self.quarters:
                    qx, qz = max(qq['x0'], min(qq['x1'], x)), max(qq['z0'], min(qq['z1'], z))
                    near.append((math.hypot(x - qx, z - qz), qq, qx, qz))
                dA, _, ax, az = next(n for n in near if n[1] is alp)
                hA = A.ground(ax - alp['cx'], az - alp['cz'])
                if alp['x0'] <= x <= alp['x1'] and z < alp['z0']:
                    h = hA          # the strip north of the ridge stays up on the ridge
                    fixed.add((ix, iz))
                elif alp['z0'] <= z <= alp['z1'] and x < alp['x0']:
                    h = hA          # and west of it stays at its own height, cliff and all
                    fixed.add((ix, iz))
                else:
                    wsum = 0.0
                    hsum = 0.0
                    for (d, qq, _, _) in near:
                        w = 1.0 / (d + 1.0) ** 2
                        wsum += w
                        if qq is alp:
                            hsum += w * hA
                    h = hsum / wsum
                self.h[ix][iz] = q(h)
                dmin = min(n[0] for n in near)
                if dmin <= CELL * 0.75:
                    fixed.add((ix, iz))
                # the ground's texture: the nearest quarter's, with the border wandering
                best = min(near, key=lambda n: n[0] + rng.uniform(-7, 7))
                self.tint[ix][iz] = GROUND_TINT[best[1]['kind']]
        # relax: every seam cell within one step of each neighbour. The pinned
        # cells (the quarters' edges) set bounds that spread outwards: a cell may
        # be no lower than a neighbour less a step, and no higher than one plus a step.
        nx, nz, h = self.nx, self.nz, self.h
        for _ in range(400):
            changed = False
            for ix in range(nx):
                for iz in range(nz):
                    if not self.blend[ix][iz] or (ix, iz) in fixed:
                        continue
                    lo, hi = -1e9, 1e9
                    for (jx, jz) in ((ix + 1, iz), (ix - 1, iz), (ix, iz + 1), (ix, iz - 1)):
                        if 0 <= jx < nx and 0 <= jz < nz and self.blend[jx][jz]:
                            lo = max(lo, h[jx][jz] - QUANT)
                            hi = min(hi, h[jx][jz] + QUANT)
                    v = h[ix][iz]
                    if lo > hi + 1e-6:
                        w = q(lo)       # where the ridge's cliff runs out: a drop, never a pit
                    else:
                        w = q(max(lo, min(hi, v)))
                    if abs(w - v) > 1e-6:
                        h[ix][iz] = w
                        changed = True
            if not changed:
                break
        self._grid = None      # the smooth surface is read from these cells from here on

    def emit_ground(self):
        """The seam terrain as boxes: runs of equal height and texture along x."""
        for iz in range(self.nz):
            z = -BZ + (iz + 0.5) * CELL
            ix = 0
            while ix < self.nx:
                if not self.blend[ix][iz]:
                    ix += 1
                    continue
                hgt, tint = self.h[ix][iz], self.tint[ix][iz]
                j = ix
                while j + 1 < self.nx and self.blend[j + 1][iz] and self.h[j + 1][iz] == hgt and self.tint[j + 1][iz] == tint:
                    j += 1
                # sand is the ground plane itself; anything else, or anything raised, is a slab
                top = hgt if hgt > 0 else (0.06 if tint else 0.0)
                if top > 0:
                    x0, x1 = -BX + ix * CELL, -BX + (j + 1) * CELL
                    self.box((x0 + x1) / 2, top / 2, z, (x1 - x0) / 2, top / 2, CELL / 2, 0.0, 'terrain', tint)
                ix = j + 1

    def at(self, x, z):
        self.base_y = self.ground(x, z)
        return self.base_y

    def seam_free(self, x, z, r, bmargin=1.6, pmargin=0.8):
        """Open seam ground: not in a quarter, not on a road, clear of everything placed."""
        if self.in_quarter(x, z) or abs(x) > BX - r - 1.5 or abs(z) > BZ - r - 1.5:
            return False
        return self.free(x, z, r, bmargin, pmargin, road=True)

    # -- the roads across the seams ----------------------------------------------

    def road(self, pts, w, c='asphalt', lift=0.0):
        """A road laid on the smooth ground: a strip with a point every metre at the
        surface's height, which the client lays vertex by vertex on the land. You
        walk on the ground under it. `lift` stacks one road a hair over another where they cross."""
        out = []
        for i in range(len(pts) - 1):
            (ax, az), (bx2, bz2) = pts[i], pts[i + 1]
            L = math.hypot(bx2 - ax, bz2 - az)
            if L < 0.05:
                continue
            ux, uz = (bx2 - ax) / L, (bz2 - az) / L
            n = max(1, int(L / 1.0))
            for k in range(n + 1):
                if k == 0 and out:
                    continue
                s = L if k == n else k * 1.0
                x, z = ax + ux * s, az + uz * s
                out.append([round(x, 2), round(z, 2), round(self.surface(x, z) + 0.05, 2)])
        self.deco.append({'k': 'road', 'w': w, 'c': c, 'h': round(lift, 3), 'pts': out})
        self.roads.append({'w': w, 'pts': [(x, z) for (x, z) in pts]})

    def spur(self, x, z, w):
        """A road from a town's exit to the ring: straight if the ring is across from it,
        else out to the level of the nearest corner and along to it."""
        if abs(x) > RING_X and abs(z) <= RING_Z:
            self.road([(x, z), (RING_X if x > 0 else -RING_X, z)], w, lift=0.003)
        elif abs(z) > RING_Z and abs(x) <= RING_X:
            self.road([(x, z), (x, RING_Z if z > 0 else -RING_Z)], w, lift=0.003)
        else:
            tx = RING_X if x > 0 else -RING_X
            tz = RING_Z if z > 0 else -RING_Z
            mx = (x + tx) / 2
            self.road([(x, z), (mx, z), (mx, tz), (tx, tz)], w, lift=0.003)

    def make_roads(self):
        Q = {q['kind']: q for q in self.quarters}
        # the ring road round the city
        self.road([(-RING_X, -RING_Z), (RING_X, -RING_Z), (RING_X, RING_Z), (-RING_X, RING_Z), (-RING_X, -RING_Z)], 7.0)
        # the city's avenues and streets carry on out to it
        HX, HZ = map_city.HX, map_city.HZ
        for (ax, w) in map_city.AVES:
            self.road([(ax, -HZ), (ax, -RING_Z)], w, lift=0.003)
            self.road([(ax, HZ), (ax, RING_Z)], w, lift=0.003)
        for (sz, w) in map_city.STS:
            self.road([(-HX, sz), (-RING_X, sz)], w, lift=0.003)
            self.road([(HX, sz), (RING_X, sz)], w, lift=0.003)
        # each town's roads reach the ring where they face it
        for (kind, side) in (('alpine', 'E'), ('town', 'W'), ('dock', 'E')):
            for (x, z, w) in self.exits(Q[kind], side):
                self.spur(x, z, min(w, 7.0))
        # the Manor's drive comes out of its gate, turns and runs to the ring;
        # Old Town's southern streets come down the east field to meet it
        gate = self.exits(Q['manor'], 'N')
        gx, gz = (gate[0][0], gate[0][1]) if gate else (Q['manor']['cx'], Q['manor']['z0'])
        jz = (gz + Q['town']['z1']) / 2
        self.road([(gx, gz), (gx, jz), (RING_X, jz)], 8.0, lift=0.003)
        town_s = sorted(self.exits(Q['town'], 'S'))
        for i, (x, z, w) in enumerate(town_s):
            if x <= gx:
                self.road([(x, z), (x, jz)], min(w, 6.0), lift=0.006)
            else:
                self.road([(x, z), (x - 10.0, jz), (gx, jz)], min(w, 6.0), lift=0.006)
        # the west field: from the ring out to Ridgeline's tracks and the Dockyard's gates
        alp_s = sorted(self.exits(Q['alpine'], 'S'))
        dock_n = sorted(self.exits(Q['dock'], 'N'))
        fz = (Q['alpine']['z1'] + Q['dock']['z0']) / 2
        fx = -RING_X - 40.0
        self.road([(-RING_X, fz), (fx, fz)], 6.0, lift=0.003)
        if alp_s:
            (x, z, w) = alp_s[-1]
            self.road([(fx, fz), (x, z)], 6.0, lift=0.006)
        if dock_n:
            (x, z, w) = dock_n[-1]
            self.road([(fx, fz), (x, z)], 6.0, lift=0.006)
        if len(alp_s) > 1 and len(dock_n) > 1:
            (ax, az, _), (dx, dz, _) = alp_s[0], dock_n[0]
            self.road([(ax, az), ((ax + dx) / 2 - 6.0, fz), (dx, dz)], 5.0, lift=0.006)

    # -- cover in the seams ---------------------------------------------------------

    def flavour(self, x, z):
        """Which quarter's kind of cover belongs here: the nearest, mostly."""
        rng = self.rng
        best, bd = None, 1e9
        for q in self.quarters:
            qx, qz = max(q['x0'], min(q['x1'], x)), max(q['z0'], min(q['z1'], z))
            d = math.hypot(x - qx, z - qz) + rng.uniform(-10, 10)
            if d < bd:
                best, bd = q['kind'], d
        return best

    def scatter(self):
        rng = self.rng
        placed = 0
        tries = 0
        while placed < 480 and tries < 6000:
            tries += 1
            x = rng.uniform(-BX + 4, BX - 4)
            z = rng.uniform(-BZ + 4, BZ - 4)
            if self.in_quarter(x, z):
                continue
            kind = self.flavour(x, z)
            r = rng.random()
            y = self.at(x, z)
            flat = y < 0.01
            if kind == 'alpine':
                if r < 0.55:
                    if self.seam_free(x, z, 0.6, 1.2, 1.2):
                        map_alpine.Alpine.pine(self, x, z)
                        placed += 1
                elif r < 0.85:
                    if self.seam_free(x, z, 1.2):
                        s = rng.uniform(0.6, 1.6)
                        self.at(x, z)
                        self.box(x, s * 0.5, z, s, s * 0.5, s * 0.7, rng.uniform(0, 3), 'rock')
                        self.props.append((x, z, s + 0.3))
                        placed += 1
                elif self.seam_free(x, z, 2.4):
                    map_alpine.Alpine.jersey(self, x, z, rng.uniform(0, math.pi), rng.choice([2, 3]))
                    placed += 1
            elif kind == 'town':
                if r < 0.4:
                    if self.seam_free(x, z, 1.2):
                        rad = self.crate_stack(x, z, rng.uniform(0, math.pi))
                        self.props.append((x, z, rad))
                        placed += 1
                elif r < 0.6:
                    if self.seam_free(x, z, 0.6):
                        self.barrel(x, z)
                        self.props.append((x, z, 0.5))
                        placed += 1
                elif r < 0.75 and flat:
                    if self.seam_free(x, z, 1.6):
                        self.stall(x, z, rng.uniform(0, math.pi))
                        self.props.append((x, z, 1.5))
                        placed += 1
                elif r < 0.9 and flat:
                    if self.seam_free(x, z, 0.6):
                        self.box(x, 1.5, z, 0.2, 1.5, 0.2, 0, 'inv')
                        self.deco.append({'k': 'palm', 'x': round(x, 2), 'z': round(z, 2), 'h': round(rng.uniform(5.5, 8.5), 2), 's': rng.randrange(1000)})
                        self.props.append((x, z, 0.5))
                        placed += 1
                elif self.seam_free(x, z, 2.2):
                    self.lowwall(x, z, rng.uniform(0, math.pi), rng.uniform(2.5, 4.5))
                    self.props.append((x, z, 2.2))
                    placed += 1
            elif kind == 'dock':
                if r < 0.45:
                    if self.seam_free(x, z, 3.6, 1.2, 1.0):
                        map_dock.Dockyard.container(self, x, z, rng.choice([0.0, math.pi / 2]) + rng.uniform(-0.3, 0.3), 0, False)
                        placed += 1
                elif r < 0.7:
                    if self.seam_free(x, z, 2.4):
                        map_dock.Dockyard.jersey(self, x, z, rng.uniform(0, math.pi), rng.choice([1, 2, 3]))
                        placed += 1
                elif r < 0.85:
                    if self.seam_free(x, z, 0.6):
                        self.barrel(x, z)
                        self.props.append((x, z, 0.5))
                        placed += 1
                elif self.seam_free(x, z, 1.2):
                    rad = self.crate_stack(x, z, rng.uniform(0, math.pi))
                    self.props.append((x, z, rad))
                    placed += 1
            elif kind == 'city':
                # the edge of town: cars, barriers, bins, the odd lamp
                if r < 0.35:
                    if self.seam_free(x, z, 2.6):
                        self.car(x, z, rng.uniform(0, math.pi))
                        self.props.append((x, z, 2.4))
                        placed += 1
                elif r < 0.6:
                    if self.seam_free(x, z, 2.4):
                        map_dock.Dockyard.jersey(self, x, z, rng.uniform(0, math.pi), rng.choice([1, 2]))
                        placed += 1
                elif r < 0.85:
                    if self.seam_free(x, z, 1.2):
                        rad = self.crate_stack(x, z, rng.uniform(0, math.pi))
                        self.props.append((x, z, rad))
                        placed += 1
                elif self.seam_free(x, z, 0.6):
                    map_city.City.lamp(self, x, z)
                    placed += 1
            else:
                if r < 0.4 and flat:
                    if self.seam_free(x, z, 2.4, 2.0, 1.2):
                        map_manor.Manor.tree(self, x, z)
                        placed += 1
                elif r < 0.7:
                    if self.seam_free(x, z, 2.6):
                        map_manor.Manor.hedge(self, x, z, 2.4, 0.5, rng.choice([0.0, math.pi / 2]), rng.uniform(0.9, 1.3))
                        placed += 1
                elif r < 0.85:
                    if self.seam_free(x, z, 2.2):
                        map_manor.Manor.garden_wall(self, x, z, rng.choice([0.0, math.pi / 2]), 4.0)
                        placed += 1
                elif r < 0.95:
                    if self.seam_free(x, z, 1.2):
                        map_manor.Manor.bench(self, x, z, rng.uniform(0, math.tau))
                        placed += 1
                elif self.seam_free(x, z, 1.2):
                    map_manor.Manor.statue(self, x, z, rng.uniform(0, math.tau), 1.0, y)
                    placed += 1
        self.base_y = 0.0

    def fields(self):
        """Something to fight over in the open country: a truck stop in the west
        field on the way to the docks, an orchard with a barn in the east."""
        rng = self.rng
        Q = {q['kind']: q for q in self.quarters}
        # west: containers and lorries pulled up beside the field road
        fz = (Q['alpine']['z1'] + Q['dock']['z0']) / 2
        cx = -RING_X - 22.0
        self.base_y = 0.0
        for (dx, dz, yaw) in ((-6.0, -9.0, 0.2), (2.0, -11.0, -0.1), (-4.0, 10.0, 0.05)):
            x, z = cx + dx, fz + dz
            self.at(x, z)
            map_dock.Dockyard.container(self, x, z, yaw, 0, True)
        self.at(cx + 8.0, fz + 9.0)
        map_dock.Dockyard.container(self, cx + 8.0, fz + 9.0, 1.5, 0, False)
        map_dock.Dockyard.container(self, cx + 8.0, fz + 9.0, 1.5, 1, False)
        for (dx, dz, yaw) in ((12.0, -7.0, 0.3), (-14.0, 8.0, 1.2)):
            self.at(cx + dx, fz + dz)
            self.car(cx + dx, fz + dz, yaw)
            self.props.append((cx + dx, fz + dz, 2.4))
        self.at(cx - 10.0, fz - 2.0)
        map_dock.Dockyard.jersey(self, cx - 10.0, fz - 2.0, 1.57, 2)
        self.areas.append({'n': 'Truck Stop', 'x': round(cx, 1), 'z': round(fz, 1), 'r': 18})
        # east: rows of trees, hedges, and a barn with a door each end
        ez = (Q['town']['z1'] + Q['manor']['z0']) / 2
        ex = RING_X + 48.0
        self.base_y = 0.0
        H = self.building(ex, ez, 14.0, 9.0, 0.0, 1, 2, 'wall')
        self.rects.append((ex, ez, 7.0, 4.5, 0.0))
        for i in range(4):
            for j in range(3):
                x, z = ex - 30.0 + i * 8.0, ez - 22.0 + j * 7.0
                if self.seam_free(x, z, 2.4, 2.0, 1.2):
                    map_manor.Manor.tree(self, x, z, 2.4)
        for (dx, dz, yaw) in ((-16.0, 12.0, 0.0), (16.0, 12.0, 0.0), (0.0, 16.0, 0.0)):
            if self.seam_free(ex + dx, ez + dz, 2.6):
                map_manor.Manor.hedge(self, ex + dx, ez + dz, 3.0, 0.5, yaw, 1.1)
        self.areas.append({'n': 'The Orchard', 'x': round(ex, 1), 'z': round(ez, 1), 'r': 24})
        self.base_y = 0.0

    # -- the whole thing --------------------------------------------------------------

    def generate(self):
        rng = self.rng
        seeds = [rng.randrange(1, 2 ** 31) for _ in range(4)]
        self.city = self.make_quarter('city', seeds[3])
        self.place('city', self.city, 0.0, 0.0, 0.0)
        for (kind, (cx, cz, yaw)) in LAYOUT.items():
            seed = {'alpine': seeds[0], 'town': 0, 'dock': seeds[1], 'manor': seeds[2]}[kind]
            self.place(kind, self.make_quarter(kind, seed), cx, cz, yaw)
        self.make_ground()
        self.base_y = 0.0
        self.emit_ground()
        self.make_roads()
        self.fields()
        self.scatter()
        # the edge of the world: rock all round, tall enough where the ridge meets it
        self.base_y = 0.0
        wh = 14.0
        self.box(0, wh / 2, -BZ - 1.5, BX + 3, wh / 2, 1.5, 0, 'rock')
        self.box(0, wh / 2, BZ + 1.5, BX + 3, wh / 2, 1.5, 0, 'rock')
        self.box(-BX - 1.5, wh / 2, 0, 1.5, wh / 2, BZ + 3, 0, 'rock')
        self.box(BX + 1.5, wh / 2, 0, 1.5, wh / 2, BZ + 3, 0, 'rock')
        self.areas.append({'n': 'North Road', 'x': 0.0, 'z': -125.0, 'r': 40})
        self.areas.append({'n': 'South Road', 'x': 0.0, 'z': 125.0, 'r': 40})
        self.areas.append({'n': 'West Field', 'x': -180.0, 'z': 0.0, 'r': 44})
        self.areas.append({'n': 'East Field', 'x': 190.0, 'z': 0.0, 'r': 44})
        self.areas.append({'n': 'The Ridge', 'x': -202.0, 'z': -150.0, 'r': 0})
        # chests in the seams, by the cover
        tries = 0
        while len(self.chests) < N_CHESTS and tries < 4000:
            tries += 1
            x = rng.uniform(-BX + 6, BX - 6)
            z = rng.uniform(-BZ + 6, BZ - 6)
            if self.in_quarter(x, z):
                continue
            if not any(math.hypot(x - px, z - pz) < pr + 3.0 for (px, pz, pr) in self.props):
                continue
            if not self.seam_free(x, z, 0.7, 0.9, 0.5):
                continue
            y = self.ground(x, z)
            if any(math.hypot(x - c[0], z - c[2]) < 6.0 for c in self.chests):
                continue
            self.chests.append([round(x, 2), round(y, 2), round(z, 2), round(rng.uniform(0, math.pi), 3)])
        # golf carts parked about the seams, by the roads, to get across the map in
        tries = 0
        carts = []
        while len(carts) < N_CARTS and tries < 6000:
            tries += 1
            x = rng.uniform(-BX + 10, BX - 10)
            z = rng.uniform(-BZ + 10, BZ - 10)
            if self.in_quarter(x, z) or not (0.5 < self.road_dist(x, z) < 7.0):
                continue
            if not self.seam_free(x, z, 1.8, 2.0, 1.2):
                continue
            if any(math.hypot(x - cx, z - cz) < 28.0 for (cx, cz) in carts):
                continue
            if any(math.hypot(x - c[0], z - c[2]) < 4.0 for c in self.chests):
                continue
            carts.append((x, z))
            self.vehicles += 1
            self.deco.append({'k': 'golfcart', 'id': self.vehicles, 'x': round(x, 2), 'y': round(self.surface(x, z), 2), 'z': round(z, 2),
                              'yaw': round(rng.uniform(0, math.tau), 4)})
        # nobody fights over sites or hills here, but the record wants them
        self.site_a = (0.0, 0.0)
        self.site_b = (0.0, 0.0)
        self.hills = [(0.0, 0.0)]
        self.spawn_w = (-20.0, 0.0)
        self.spawn_e = (20.0, 0.0)
        # the lobby: everyone stands on the plaza round the Spire before the plane
        pts = list(self.city.spawn_spots)
        rng.shuffle(pts)
        self.ffa_spawns = pts
        self.team_spawns = [pts[:10], pts[10:20]]

    def road_dist(self, x, z):
        best = 1e9
        for rd in self.roads:
            pts = rd['pts']
            for i in range(len(pts) - 1):
                d = mapgen.seg_dist(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) - rd['w'] / 2
                if d < best:
                    best = d
        return best

    def to_json(self):
        m = Town.to_json(self)
        m['chests'] = self.chests
        m['royale'] = True
        m['tower'] = round(self.city.tower_h, 1) if self.city else 0
        m['height'] = self.height_grid()
        return m
