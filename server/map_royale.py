"""
Souk Royale: the battle royale map, all four towns at once.

Each of the four maps is built by its own generator and set down in a
quarter of one big map: Ridgeline in the north-west with its ridge on the
outer edge, Old Town in the north-east (always from the same seed, so the
souk is the same every game), the Dockyard in the south-west and the
Manor in the south-east, turned so its gate faces the middle. None of them
gets its boundary wall, so they run into each other.

Between and around them is as much ground again: seams sixty-odd metres
wide and a crossroads in the middle, built so the join is hard to spot.
Stepped terrain ramps down from the snow to the flat, the ground changes
texture patch by patch rather than along a line, the roads of each quarter
carry on across the seams to meet, and the cover in a seam is the kind its
nearest quarter uses: pines and rock near the ridge, crates and stalls near
the souk, containers and barriers near the docks, hedges and trees near
the manor.

Loot chests stand in rooms on every storey and outside by cover, all over.
The plane, the gas and the players' kit live in server.py.
"""

import math
import random

import mapgen
from mapgen import Town, rot, circle_rect_dist
import map_dock
import map_alpine
import map_manor

TOWN_SEED = 20260925      # the souk never changes
CELL = 2.0                # the blend terrain grid
QUANT = 0.4               # a step of ground, under what a player can walk up
BX, BZ = 198.0, 152.0     # half size of the whole map
G = 34.0                  # half the width of the seams between the quarters
GROUND_TINT = {'alpine': 1, 'town': 0, 'dock': 3, 'manor': 2}    # terrain top textures: sand, snow, grass, concrete
N_CHESTS = 190


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
        self.chests = []       # [x, y, z, yaw]
        self.nx = int(2 * BX / CELL)
        self.nz = int(2 * BZ / CELL)

    # -- the quarters --------------------------------------------------------

    def make_quarter(self, kind, seed):
        if kind == 'town':
            t = Town(TOWN_SEED)
        elif kind == 'dock':
            t = map_dock.Dockyard(seed)
        elif kind == 'alpine':
            t = map_alpine.Alpine(seed)
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
        # the quarters' own chests, in their rooms and yards
        for (x, y, z) in t.loot_spots(*({'town': (24, 14), 'dock': (16, 16), 'alpine': (14, 18), 'manor': (26, 14)}[kind])):
            wx, wz = pt(x, z)
            self.chests.append([round(wx, 2), y, round(wz, 2), round(self.rng.uniform(0, math.pi), 3)])

    def in_quarter(self, x, z):
        for q in self.quarters:
            if q['x0'] <= x <= q['x1'] and q['z0'] <= z <= q['z1']:
                return q
        return None

    # -- the seams' ground ----------------------------------------------------

    def cell(self, x, z):
        return (max(0, min(self.nx - 1, int((x + BX) / CELL))), max(0, min(self.nz - 1, int((z + BZ) / CELL))))

    def ground(self, x, z):
        if self.h is None:
            return 0.0
        ix, iz = self.cell(x, z)
        if not self.blend[ix][iz]:
            q = self.in_quarter(x, z)
            if q and q['kind'] == 'alpine':
                return q['town'].ground(x - q['cx'], z - q['cz'])
            return 0.0
        return self.h[ix][iz]

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

    def road(self, pts, w, c='dirt'):
        """A road along the seam ground, following its steps."""
        out = []
        for i in range(len(pts) - 1):
            (ax, az), (bx2, bz2) = pts[i], pts[i + 1]
            L = math.hypot(bx2 - ax, bz2 - az)
            n = max(1, int(L / 0.5))
            last = None
            for k in range(n + 1):
                t = k / n
                x, z = ax + (bx2 - ax) * t, az + (bz2 - az) * t
                cell = self.cell(x, z)
                g = self.ground(x, z)
                if last is not None and cell != last and out and abs(out[-1][2] - (g + 0.03)) > 0.01:
                    out.append([round(x, 2), round(z, 2), out[-1][2]])
                    out.append([round(x, 2), round(z, 2), round(g + 0.03, 2)])
                elif last is None or cell != last or k == n:
                    out.append([round(x, 2), round(z, 2), round(g + 0.03, 2)])
                last = cell
        d = {'k': 'road', 'w': w, 'pts': out}
        if c != 'dirt':
            d['c'] = c
        self.deco.append(d)
        self.roads.append({'w': w, 'pts': [(p[0], p[1]) for p in out]})

    def quarter_exits(self):
        """Where each quarter's roads reach its edge, in the world."""
        ex = {}
        for q in self.quarters:
            t, pt = q['town'], q['pt']
            pts = []
            for rd in t.roads:
                for p in (rd['pts'][0], rd['pts'][-1]):
                    if abs(abs(p[0]) - t.bx) < 1.5 or abs(abs(p[1]) - t.bz) < 1.5:
                        wx, wz = pt(p[0], p[1])
                        # keep the ones that open onto a seam, not the outer edge
                        if abs(abs(wx) - G) < 2.5 or abs(abs(wz) - G) < 2.5:
                            pts.append((round(wx, 1), round(wz, 1), rd['w']))
            ex[q['kind']] = pts
        return ex

    def make_roads(self):
        ex = self.quarter_exits()
        # the crossroads: every quarter's main road meets in the middle
        C = (0.0, 0.0)
        alp = [p for p in ex['alpine'] if abs(p[0] + G) < 3]          # the ridge road comes out at its east edge
        town = [p for p in ex['town'] if abs(p[0] - G) < 3]
        dock = [p for p in ex['dock'] if abs(p[0] + G) < 3]
        manor = [p for p in ex['manor'] if abs(p[1] - G) < 3]         # the gate, on the manor's north edge
        for (x, z, w) in alp:
            self.road([(x, z), ((x + C[0]) / 2 - 6, (z + C[1]) / 2), C], w)
        for (x, z, w) in town:
            self.road([(x, z), ((x + C[0]) / 2 + 6, (z + C[1]) / 2), C], w)
        for (x, z, w) in dock:
            self.road([(x, z), ((x + C[0]) / 2 - 8, (z + C[1]) / 2 + 4), C], w, 'asphalt')
        for (x, z, w) in manor:
            self.road([(x, z), (x, z - 14), (x * 0.55, 18.0), C], min(w, 7.0), 'gravel')
        # the west seam: the ridge's tracks run down to the docks' crossings
        alp_s = sorted(p for p in ex['alpine'] if abs(p[1] + G) < 3)
        dock_n = sorted(p for p in ex['dock'] if abs(p[1] - G) < 3)
        for (a, b) in zip(alp_s, dock_n):
            self.road([(a[0], a[1]), ((a[0] + b[0]) / 2, 0.0), (b[0], b[1])], 5.0)
        # the east seam: the souk's crossing streets run on to the manor's gate
        town_s = sorted(p for p in ex['town'] if abs(p[1] + G) < 3)
        gate = manor[0] if manor else (110.0, G, 7.0)
        for (x, z, w) in town_s:
            self.road([(x, z), ((x + gate[0]) / 2, 0.0), (gate[0], gate[1] - 14)], 4.5)
        # a ring lane round the edge of the whole map, through the margins
        m = 6.0
        ring = [(-BX + m, -BZ + m), (BX - m, -BZ + m), (BX - m, BZ - m), (-BX + m, BZ - m), (-BX + m, -BZ + m)]
        self.road(ring, 4.0)

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
        while placed < 330 and tries < 4000:
            tries += 1
            x = rng.uniform(-BX + 4, BX - 4)
            z = rng.uniform(-BZ + 4, BZ - 4)
            if self.in_quarter(x, z):
                continue
            if math.hypot(x, z) < 22:
                continue      # the crossroads is laid out by hand
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

    def crossroads(self):
        """The middle of the map: a paved circle round a well, market stalls and a few
        containers and cars about it, so it is worth dropping on."""
        rng = self.rng
        self.base_y = 0.0
        self.deco.append({'k': 'paving', 'x': 0.0, 'z': 0.0, 'r': 16.0})
        self.solid(0, 0.5, 0, 1.0, 0.5, 1.0, 0.0, 'inv', rad=1.4)
        self.deco.append({'k': 'well', 'x': 0.0, 'z': 0.0})
        for i in range(8):
            a = i / 8 * math.tau + 0.2
            px, pz = math.cos(a) * 9.5, math.sin(a) * 9.5
            if i % 2 == 0:
                self.stall(px, pz, -a + math.pi / 2)
                self.props.append((px, pz, 1.5))
            else:
                rad = self.crate_stack(px, pz, a)
                self.props.append((px, pz, rad))
        for (x, z, yaw) in ((-14.0, 5.0, 0.4), (13.0, -6.0, -0.7)):
            self.car(x, z, yaw)
            self.props.append((x, z, 2.4))
        map_dock.Dockyard.container(self, 15.0, 12.0, 0.9, 0, False)
        map_dock.Dockyard.container(self, -16.0, -13.0, -0.6, 0, False)
        map_dock.Dockyard.container(self, -16.0, -13.0, -0.6, 1, False)
        for (x, z) in ((6.0, -16.0), (-4.0, 17.0)):
            map_manor.Manor.hedge(self, x, z, 3.0, 0.5, 0.0, 1.1)
        for i in range(4):
            a = i / 4 * math.tau + 0.8
            self.deco.append({'k': 'lamp', 'x': round(math.cos(a) * 13.5, 2), 'y': 3.4, 'z': round(math.sin(a) * 13.5, 2)})
            self.box(math.cos(a) * 13.5, 1.6, math.sin(a) * 13.5, 0.12, 1.6, 0.12, 0, 'steel', 2)
            self.props.append((math.cos(a) * 13.5, math.sin(a) * 13.5, 0.5))
        self.deco.append({'k': 'lanterns', 'a': [-9.0, -9.0], 'b': [9.0, 9.0]})
        self.deco.append({'k': 'lanterns', 'a': [-9.0, 9.0], 'b': [9.0, -9.0]})
        self.areas.append({'n': 'The Crossroads', 'x': 0.0, 'z': 0.0, 'r': 24})

    # -- the whole thing --------------------------------------------------------------

    def generate(self):
        rng = self.rng
        seeds = [rng.randrange(1, 2 ** 31) for _ in range(3)]
        self.place('alpine', self.make_quarter('alpine', seeds[0]), -112.0, -88.0, 0.0)
        self.place('town', self.make_quarter('town', 0), 110.0, -88.0, 0.0)
        self.place('dock', self.make_quarter('dock', seeds[1]), -96.0, 80.0, 0.0)
        self.place('manor', self.make_quarter('manor', seeds[2]), 110.0, 88.0, math.pi)
        self.make_ground()
        self.base_y = 0.0
        self.emit_ground()
        self.make_roads()
        self.crossroads()
        self.scatter()
        # the edge of the world: rock all round, tall enough where the ridge meets it
        self.base_y = 0.0
        wh = 14.0
        self.box(0, wh / 2, -BZ - 1.5, BX + 3, wh / 2, 1.5, 0, 'rock')
        self.box(0, wh / 2, BZ + 1.5, BX + 3, wh / 2, 1.5, 0, 'rock')
        self.box(-BX - 1.5, wh / 2, 0, 1.5, wh / 2, BZ + 3, 0, 'rock')
        self.box(BX + 1.5, wh / 2, 0, 1.5, wh / 2, BZ + 3, 0, 'rock')
        self.areas.append({'n': 'North Pass', 'x': 0.0, 'z': -85.0, 'r': 36})
        self.areas.append({'n': 'South Road', 'x': 0.0, 'z': 85.0, 'r': 36})
        self.areas.append({'n': 'West Rise', 'x': -100.0, 'z': 0.0, 'r': 34})
        self.areas.append({'n': 'East Way', 'x': 100.0, 'z': 0.0, 'r': 34})
        self.areas.append({'n': 'The Ridge', 'x': -112.0, 'z': -132.0, 'r': 0})
        # chests in the seams, by the cover
        tries = 0
        while len(self.chests) < N_CHESTS and tries < 3000:
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
        # nobody fights over sites or hills here, but the record wants them
        self.site_a = (0.0, 0.0)
        self.site_b = (0.0, 0.0)
        self.hills = [(0.0, 0.0)]
        self.spawn_w = (-20.0, 0.0)
        self.spawn_e = (20.0, 0.0)
        # the lobby: everyone stands about the crossroads before the plane
        pts = []
        tries = 0
        while len(pts) < 40 and tries < 1500:
            tries += 1
            a, r = rng.uniform(0, math.tau), rng.uniform(4, 38)
            x, z = math.cos(a) * r, math.sin(a) * r
            if self.seam_free(x, z, 0.5, 0.9, 0.5) and all(math.hypot(x - p[0], z - p[1]) > 2.0 for p in pts):
                pts.append([round(x, 2), round(z, 2), round(self.ground(x, z), 2)])
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
        return m
