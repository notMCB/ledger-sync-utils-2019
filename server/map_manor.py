"""
The Manor: a neoclassical country house in its grounds.

The house is the biggest building in the game: three storeys around a
grand atrium that rises the full height, a ballroom, library, dining
room and kitchen on the ground floor, bedrooms and a study above, a
picture gallery on the top floor, galleries round the atrium on every
level, and a portico of columns at the front. It is furnished: sofas,
tables, beds, bookcases, a piano, statues on plinths, paintings on the
walls, chandeliers.

Outside, a gravel drive runs from the gate up to the forecourt between
short hedges; a formal parterre garden lies west, a tennis court east,
open lawn with a pond and a gazebo behind, and golf carts to drive.
About two thirds of the ground is outside, long sightlines broken by
hedges, statues, garden walls and trees; the house is close quarters.

Bomb sites: A in the ballroom, B on the tennis court.
Hills: the atrium, the parterre, the north lawn.
"""

import math

from mapgen import Town, rot, STEP_D

FLOOR = 3.6                   # storey height in the house
WT = 0.35                     # wall thickness
RISE = 0.257                  # a stair step
N_STEP = int(round(FLOOR / RISE))   # 14 steps a storey, 5.3 m of run
RUN = N_STEP * STEP_D

# the house, in local coordinates: x across (west negative), z into the
# depth with the front at +z; the house faces south (+z in the world)
HW, HD = 23.0, 13.0           # half width, half depth
X0, X1 = -HW + WT, HW - WT    # inside faces
Z0, Z1 = -HD + WT, HD - WT
COR_Z = -9.5                  # the back corridor runs behind z = COR_Z
AT_X = 7.0                    # the atrium's half width
AT_Z0, AT_Z1 = 2.0, 11.0      # the open well of the atrium, on the upper floors
WELL_X = 4.5                  # its half width: galleries run round it inside the wing walls
HOUSE_Z = -14.0               # where the house sits in the world (its centre)


class Manor(Town):
    kind = 'manor'
    name = 'The Manor'
    theme = 'garden'

    def __init__(self, seed):
        Town.__init__(self, seed)
        self.bx, self.bz = 76.0, 54.0
        self.vehicles = 0

    # -- primitives ----------------------------------------------------------

    def lb(self, x0, x1, y0, y1, z0, z1, mat='marble', tint=0):
        """A box in the house's local frame, by its extents."""
        if x1 - x0 > 0.01 and y1 - y0 > 0.01 and z1 - z0 > 0.01:
            self.box((x0 + x1) / 2, (y0 + y1) / 2, HOUSE_Z + (z0 + z1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, 0.0, mat, tint)

    def dd(self, k, x, z, **kw):
        """A deco entry in the house's local frame."""
        d = {'k': k, 'x': round(x, 2), 'z': round(HOUSE_Z + z, 2)}
        d.update(kw)
        self.deco.append(d)

    def hedge(self, x, z, hx, hz, yaw=0.0, h=0.9):
        self.box(x, h / 2, z, hx, h / 2, hz, yaw, 'hedge')
        self.props.append((x, z, max(hx, hz) + 0.3))

    def tree(self, x, z, r=None):
        rng = self.rng
        r = r or rng.uniform(2.2, 3.4)
        h = rng.uniform(4.0, 5.5)
        self.box(x, h / 2, z, 0.3, h / 2, 0.3, 0, 'inv')
        self.deco.append({'k': 'tree', 'x': round(x, 2), 'z': round(z, 2), 'h': round(h, 2), 'r': round(r, 2), 'c': rng.randrange(3)})
        self.props.append((x, z, 0.8))

    def topiary(self, x, z, r=0.8):
        self.box(x, r + 0.3, z, r * 0.8, r, r * 0.8, 0, 'inv')
        self.box(x, 0.15, z, 0.35, 0.15, 0.35, 0, 'marble')
        self.deco.append({'k': 'topiary', 'x': round(x, 2), 'z': round(z, 2), 'r': r})
        self.props.append((x, z, r + 0.3))

    def statue(self, x, z, yaw=0.0, plinth=1.0, y=0.0, local=False):
        wz = HOUSE_Z + z if local else z
        self.box(x, y + plinth / 2, wz, 0.55, plinth / 2, 0.55, yaw, 'marble')
        self.box(x, y + plinth + 0.9, wz, 0.32, 0.9, 0.32, yaw, 'inv')
        self.deco.append({'k': 'statue', 'x': round(x, 2), 'y': round(y + plinth, 2), 'z': round(wz, 2), 'yaw': round(yaw, 4), 'p': self.rng.randrange(4)})
        if not local:
            self.props.append((x, wz, 1.0))

    def bench(self, x, z, yaw):
        self.box(x, 0.25, z, 0.9, 0.25, 0.28, yaw, 'wood')
        ox, oz = rot(0, -0.2, yaw)
        self.box(x + ox, 0.62, z + oz, 0.9, 0.2, 0.06, yaw, 'wood')
        self.props.append((x, z, 1.1))

    def garden_wall(self, x, z, yaw, L, h=1.1):
        self.box(x, h / 2, z, L / 2, h / 2, 0.25, yaw, 'stone')
        for k in range(int(L // 2) + 1):
            ox, oz = rot(-L / 2 + k * 2, 0, yaw)
            self.props.append((x + ox, z + oz, 1.0))

    def golfcart(self, x, z, yaw):
        # driveable, like the forklift: the game gives it a moving collision box
        self.vehicles += 1
        self.deco.append({'k': 'golfcart', 'id': self.vehicles, 'x': round(x, 2), 'y': 0.0, 'z': round(z, 2), 'yaw': round(yaw, 4)})
        self.props.append((x, z, 1.5))

    # -- the house -----------------------------------------------------------

    def wall_x(self, z, xa, xb, y0, y1, doors, mat='wall', lintel=2.6):
        """A wall along x at z, from xa to xb, with door gaps [(u, width)]."""
        cur = xa
        for (u, w) in sorted(doors):
            self.lb(cur, u - w / 2, y0, y1, z - 0.15, z + 0.15, mat)
            self.lb(u - w / 2, u + w / 2, y0 + lintel, y1, z - 0.15, z + 0.15, mat)
            cur = u + w / 2
        self.lb(cur, xb, y0, y1, z - 0.15, z + 0.15, mat)

    def wall_z(self, x, za, zb, y0, y1, doors, mat='wall', lintel=2.6):
        cur = za
        for (u, w) in sorted(doors):
            self.lb(x - 0.15, x + 0.15, y0, y1, cur, u - w / 2, mat)
            self.lb(x - 0.15, x + 0.15, y0 + lintel, y1, u - w / 2, u + w / 2, mat)
            cur = u + w / 2
        self.lb(x - 0.15, x + 0.15, y0, y1, cur, zb, mat)

    def house(self):
        lb = self.lb
        H = 3 * FLOOR

        # openings in the outer walls: (side, floor, u, width, bottom, top) where u
        # runs along the wall; doors reach the floor, windows start at 1.0
        ops = []

        def door(side, u, w=1.6, f=0, h=2.6):
            ops.append((side, f, u, w, 0.0, h))

        def window(side, u, f, w=1.3, b=1.0, t=3.0):
            ops.append((side, f, u, w, b, t))

        # the front door and the tall windows either side, three storeys of them
        door('S', 0.0, 3.2, 0, 3.3)
        for f in range(3):
            for u in (-19.5, -15.5, -11.5, 11.5, 15.5, 19.5):
                window('S', u, f, 1.3, 1.0, 3.0 if f < 2 else 2.6)
            if f > 0:
                for u in (-4.5, 4.5):
                    window('S', u, f)
        door('S', 0.0, 1.8, 1, 2.6)                       # the balcony door over the portico
        door('N', 0.0, 2.0)                               # the back door, into the corridor
        for f in range(3):
            for u in (-19, -14, -9, -4.5, 4.5, 9, 14, 19):
                window('N', u, f)
        # the ends: french doors from the ballroom and dining room to the terraces,
        # a door at each end of the corridor, windows above
        for s in 'WE':
            door(s, 5.0, 2.4)
            door(s, -11.0, 1.6)
            for f in range(3):
                for u in ((0.0, 9.0) if f == 0 else (-4.0, 2.0, 8.0)):
                    window(s, u, f)

        def run(side, f):
            y0, y1 = f * FLOOR, (f + 1) * FLOOR
            L = 2 * HW if side in 'SN' else 2 * HD - 2 * WT
            mine = sorted([(u, w, b, t) for (s, ff, u, w, b, t) in ops if s == side and ff == f])
            cur = -L / 2
            pieces = []
            for (u, w, b, t) in mine:
                pieces.append((cur, u - w / 2, y0, y1))
                if b > 0:
                    pieces.append((u - w / 2, u + w / 2, y0, y0 + b))
                if y0 + t < y1:
                    pieces.append((u - w / 2, u + w / 2, y0 + t, y1))
                cur = u + w / 2
            pieces.append((cur, L / 2, y0, y1))
            for (a, b, p0, p1) in pieces:
                if side == 'S':
                    lb(a, b, p0, p1, HD - WT, HD)
                elif side == 'N':
                    lb(a, b, p0, p1, -HD, -HD + WT)
                elif side == 'W':
                    lb(-HW, -HW + WT, p0, p1, a, b)
                else:
                    lb(HW - WT, HW, p0, p1, a, b)

        for s in 'SNWE':
            for f in range(3):
                run(s, f)
        # a string course between the storeys and a cornice under the roof
        for y in (FLOOR, 2 * FLOOR):
            lb(-HW - 0.12, HW + 0.12, y - 0.1, y + 0.1, HD - 0.05, HD + 0.12)
            lb(-HW - 0.12, HW + 0.12, y - 0.1, y + 0.1, -HD - 0.12, -HD + 0.05)
        lb(-HW - 0.3, HW + 0.3, H - 0.35, H, -HD - 0.3, HD + 0.3)                       # cornice
        lb(-HW - 0.3, HW + 0.3, H, H + 0.25, -HD - 0.3, HD + 0.3, 'roof')               # the roof
        for (x0, x1, z0, z1) in ((-HW - 0.3, HW + 0.3, HD, HD + 0.3), (-HW - 0.3, HW + 0.3, -HD - 0.3, -HD),
                                 (-HW - 0.3, -HW, -HD, HD), (HW, HW + 0.3, -HD, HD)):
            lb(x0, x1, H + 0.25, H + 1.2, z0, z1, 'stone')                              # balustrade
        # a low dome over the atrium, and chimneys
        self.dd('dome', 0.0, 5.5, y=round(H + 0.25, 2), r=6.0, t=0)
        for k in range(3):
            self.box(0, H + 0.25 + 2.4, HOUSE_Z + 5.5, 5.8, 2.4, 3.0, k * math.pi / 3, 'inv')
        for x in (-16, 16):
            lb(x - 1.0, x + 1.0, H + 0.25, H + 2.2, -6.0, -4.6, 'marble')

        # -- inside: the same plan on every floor --
        lb(X0, X1, 0.0, 0.04, Z0, Z1, 'tile')
        HX = 15.0                     # the stair halls fill the ends of the back rooms
        for f in range(3):
            y0, y1 = f * FLOOR, (f + 1) * FLOOR
            # the back corridor wall: doors into the stair halls, the back rooms, and
            # a wide opening onto the stair hall behind the atrium
            self.wall_x(COR_Z, X0, -AT_X, y0, y1, [(-HX - 0.6, 1.2), (-(HX + AT_X + 0.15) / 2, 1.8)])
            self.wall_x(COR_Z, AT_X, X1, y0, y1, [(HX + 0.6, 1.2), ((HX + AT_X + 0.15) / 2, 1.8)])
            lb(-AT_X, -4.2, y0, y1, COR_Z - 0.15, COR_Z + 0.15, 'wall')
            lb(4.2, AT_X, y0, y1, COR_Z - 0.15, COR_Z + 0.15, 'wall')
            lb(-4.2, 4.2, y0 + 2.9, y1, COR_Z - 0.15, COR_Z + 0.15, 'wall')
            # the walls between the wings and the atrium: a door to the front room
            # and one to the back room on each side
            for x in (-AT_X, AT_X):
                self.wall_z(x, COR_Z + 0.15, Z1, y0, y1, [(-6.1, 1.8), (6.0, 1.8)])
            # each wing split into a front room and a back room
            for (a, b) in ((X0, -AT_X - 0.15), (AT_X + 0.15, X1)):
                mid = (a + b) / 2 if a > 0 else (a + b) / 2
                u = (-HX - AT_X - 0.15) / 2 if a < 0 else (HX + AT_X + 0.15) / 2
                self.wall_x(-2.0, a, b, y0, y1, [(u, 1.8)])
            # the stair halls' inner walls, a door onto the landing side
            self.wall_z(-HX, COR_Z + 0.15, -2.15, y0, y1, [(-3.7, 1.4)])
            self.wall_z(HX, COR_Z + 0.15, -2.15, y0, y1, [(-3.7, 1.4)])

        # the grand stair: up the middle of the stair hall from z = 0 to the
        # first-floor landing at z = -RUN, three metres wide, balustrades either side
        for i in range(N_STEP):
            z1 = 0.0 - i * STEP_D
            lb(-1.6, 1.6, 0.0, (i + 1) * RISE, z1 - STEP_D, z1, 'stair')
            for sx in (-1, 1):
                lb(sx * 1.66 - 0.06, sx * 1.66 + 0.06, (i + 1) * RISE, (i + 1) * RISE + 0.95, z1 - STEP_D, z1, 'wood')
        # the stair halls at each end: flight A up the north side to the first floor,
        # flight B up the south side to the second
        for sgn in (-1, 1):
            self.stair(sgn * 16.2, -9.35, -6.35, 0.0, sgn)             # A: climbs towards the end wall
            self.stair(sgn * 22.2, -5.15, -2.15, FLOOR, -sgn)         # B: climbs back towards the middle
        # floor slabs: the atrium well, the stair heads
        holes1 = [(-WELL_X, WELL_X, AT_Z0, AT_Z1), (-1.6, 1.6, -RUN, 0.0)]
        holes2 = [(-WELL_X, WELL_X, AT_Z0, AT_Z1)]
        for sgn in (-1, 1):
            a_top = sgn * 16.2 + sgn * RUN          # where flight A ends
            a_low = sgn * 16.2 + sgn * 5 * STEP_D   # where heads start to need the room
            holes1.append((min(a_top, a_low), max(a_top, a_low), -9.35, -6.35))
            b_top = sgn * 22.2 - sgn * RUN
            b_low = sgn * 22.2 - sgn * 5 * STEP_D
            holes2.append((min(b_top, b_low), max(b_top, b_low), -5.15, -2.15))
        self.slab(1, holes1)
        self.slab(2, holes2)
        # rails round the holes, so nobody walks off a landing
        for sgn in (-1, 1):
            a0, a1, _, _ = holes1[2 if sgn < 0 else 3]
            b0, b1, _, _ = holes2[1 if sgn < 0 else 2]
            y = FLOOR
            lb(a0, a1, y, y + 1.0, -6.35, -6.23, 'wood')                       # along flight A's open side
            inner = a1 if sgn < 0 else a0                                       # the hole's edge nearest the middle
            lb(inner - 0.06, inner + 0.06, y, y + 1.0, -9.35, -6.35, 'wood')
            y = 2 * FLOOR
            lb(b0, b1, y, y + 1.0, -5.27, -5.15, 'wood')                       # along flight B's open side
            outer = b0 if sgn < 0 else b1                                       # the hole's edge nearest the end wall
            lb(outer - 0.06, outer + 0.06, y, y + 1.0, -5.15, -2.15, 'wood')
        # galleries round the well: balustrades on the first and second floors
        for f in (1, 2):
            y = f * FLOOR
            lb(-WELL_X - 0.12, WELL_X + 0.12, y, y + 1.0, AT_Z0 - 0.12, AT_Z0, 'wood')
            lb(-WELL_X - 0.12, WELL_X + 0.12, y, y + 1.0, AT_Z1, AT_Z1 + 0.12, 'wood')
            lb(-WELL_X - 0.12, -WELL_X, y, y + 1.0, AT_Z0, AT_Z1, 'wood')
            lb(WELL_X, WELL_X + 0.12, y, y + 1.0, AT_Z0, AT_Z1, 'wood')
        # rails beside the grand stair's well on the first floor
        y = FLOOR
        lb(-1.72, -1.6, y, y + 0.95, -RUN, 0.0, 'wood')
        lb(1.6, 1.72, y, y + 0.95, -RUN, 0.0, 'wood')

        # the portico: six columns under a roof at the front door, a balcony above
        for x in (-6.0, -3.6, -1.2, 1.2, 3.6, 6.0):
            self.dd('column', x, HD + 2.2, h=round(2 * FLOOR, 2))
            self.box(x, FLOOR, HOUSE_Z + HD + 2.2, 0.36, FLOOR, 0.36, 0, 'inv')
        lb(-7.2, 7.2, 2 * FLOOR, 2 * FLOOR + 0.3, HD, HD + 3.4)
        lb(-7.2, 7.2, 2 * FLOOR + 0.3, 2 * FLOOR + 1.1, HD + 3.1, HD + 3.4, 'stone')
        lb(-7.2, -6.9, 2 * FLOOR + 0.3, 2 * FLOOR + 1.1, HD, HD + 3.4, 'stone')
        lb(6.9, 7.2, 2 * FLOOR + 0.3, 2 * FLOOR + 1.1, HD, HD + 3.4, 'stone')
        lb(-4.0, 4.0, FLOOR - 0.2, FLOOR, HD, HD + 1.6, 'marble')
        lb(-4.0, 4.0, FLOOR, FLOOR + 1.0, HD + 1.5, HD + 1.6, 'stone')
        lb(-4.0, -3.9, FLOOR, FLOOR + 1.0, HD, HD + 1.6, 'stone')
        lb(3.9, 4.0, FLOOR, FLOOR + 1.0, HD, HD + 1.6, 'stone')

        self.furnish()
        self.rects.append((0.0, HOUSE_Z, HW + 1.0, HD + 1.0, 0.0))
        self.rects.append((0.0, HOUSE_Z + HD + 2.2, 8.0, 2.4, 0.0))
        for (lx, lz) in ((0.0, HD + 5.0), (0.0, -HD - 1.2), (-HW - 1.2, 5.0), (-HW - 1.2, -11.0), (HW + 1.2, 5.0), (HW + 1.2, -11.0)):
            self.doors.append((lx, HOUSE_Z + lz))

    def slab(self, f, holes):
        """A floor slab at storey f with rectangular holes cut out of it."""
        y0, y1 = f * FLOOR - 0.25, f * FLOOR
        xs = sorted({X0, X1} | {h[0] for h in holes} | {h[1] for h in holes})
        for (a, b) in zip(xs, xs[1:]):
            zs = sorted({Z0, Z1} | {h[2] for h in holes if h[0] <= a + 1e-6 and h[1] >= b - 1e-6} | {h[3] for h in holes if h[0] <= a + 1e-6 and h[1] >= b - 1e-6})
            for (c, d) in zip(zs, zs[1:]):
                mid = ((a + b) / 2, (c + d) / 2)
                if any(h[0] < mid[0] < h[1] and h[2] < mid[1] < h[3] for h in holes):
                    continue
                self.lb(a, b, y0, y1, c, d, 'tile')

    def stair(self, x_foot, z0, z1, y_base, direction):
        """A straight flight a storey high: its foot at x_foot, climbing along x
        in `direction` (+1 east, -1 west)."""
        for i in range(N_STEP):
            xa = x_foot + direction * i * STEP_D
            xb = xa + direction * STEP_D
            self.lb(min(xa, xb), max(xa, xb), y_base, y_base + (i + 1) * RISE, z0, z1, 'stair')

    def furnish(self):
        rng = self.rng
        lb = self.lb
        dd = self.dd
        W = -AT_X - 0.15          # the east face of the west wing's rooms
        E = AT_X + 0.15
        HX = 15.0

        def sofa(x, z, yaw, y=0.0):
            self.box(x, y + 0.3, HOUSE_Z + z, 1.1, 0.3, 0.45, yaw, 'velvet', rng.randrange(3))
            ox, oz = rot(0, -0.3, yaw)
            self.box(x + ox, y + 0.62, HOUSE_Z + z + oz, 1.1, 0.32, 0.15, yaw, 'velvet', 0)

        def table(x, z, hx, hz, y=0.0, h=0.75, mat='wood'):
            lb(x - hx, x + hx, y + h - 0.06, y + h, z - hz, z + hz, mat)
            for (sx, sz) in ((-1, -1), (-1, 1), (1, -1), (1, 1)):
                lb(x + sx * (hx - 0.12) - 0.05, x + sx * (hx - 0.12) + 0.05, y, y + h - 0.06,
                   z + sz * (hz - 0.12) - 0.05, z + sz * (hz - 0.12) + 0.05, mat)

        def chair(x, z, y=0.0):
            lb(x - 0.22, x + 0.22, y, y + 0.45, z - 0.22, z + 0.22, 'wood')
            lb(x - 0.22, x + 0.22, y + 0.45, y + 0.95, z + 0.15, z + 0.22, 'wood')

        def bed(x, z, y):
            lb(x - 1.0, x + 1.0, y, y + 0.55, z - 1.1, z + 1.1, 'velvet', 1)
            lb(x - 1.05, x + 1.05, y, y + 1.3, z - 1.2, z - 1.1, 'wood')
            lb(x - 0.8, x + 0.8, y + 0.55, y + 0.7, z - 1.0, z - 0.5, 'wall', 0)

        def bookcase(x0, x1, z0, z1, y):
            lb(x0, x1, y, y + 2.6, z0, z1, 'wood')
            dd('books', (x0 + x1) / 2, (z0 + z1) / 2, y=round(y, 2), w=round(max(x1 - x0, z1 - z0), 2),
               yaw=0.0 if x1 - x0 > z1 - z0 else round(math.pi / 2, 4))

        def painting(x, z, yaw, y, w=1.6, h=1.2):
            dd('painting', x, z, y=round(y, 2), yaw=round(yaw, 4), w=w, h=h, c=rng.randrange(8))

        def chandelier(x, z, y, r=1.0):
            dd('chandelier', x, z, y=round(y, 2), r=r)

        def rug(x, z, y=0.0, c=None):
            dd('rug', x, z, y=round(y + 0.04, 2), yaw=0.0, c=rng.randrange(6) if c is None else c)

        # -- ground floor --
        # the atrium: statues either side of the door, potted trees, a chandelier high above
        for x in (-4.5, 4.5):
            self.statue(x, 9.0, math.pi, 1.1, local=True)
        for x in (-5.5, 5.5):
            self.topiary_in(x, 2.0)
        chandelier(0.0, 5.5, 2 * FLOOR + 1.6, 1.6)
        for x in (-AT_X + 0.16, AT_X - 0.16):
            for z in (3.0, 9.0):
                painting(x, z, math.pi / 2 if x < 0 else -math.pi / 2, 2.0, 1.4, 1.8)
        for x in (-4.5, 4.5):
            painting(x, Z1 - 0.16, math.pi, 2.2, 1.2, 1.6)
        for z in (-3.0, -8.0):
            painting(-AT_X + 0.16, z, math.pi / 2, 2.0)
            painting(AT_X - 0.16, z, -math.pi / 2, 2.0)
        # the ballroom (west front): a grand piano, sofas along the walls, carpets
        px, pz = -18.0, 8.0
        lb(px - 0.8, px + 0.8, 0.6, 0.9, pz - 1.2, pz + 1.2, 'lacquer')
        lb(px - 0.7, px + 0.1, 0.0, 0.6, pz - 1.1, pz + 1.1, 'lacquer')
        lb(px - 0.9, px + 0.9, 0.9, 1.5, pz - 1.2, pz - 1.1, 'lacquer')            # the lid up
        for z in (0.5, 9.5):
            sofa(X0 + 0.55, z, -math.pi / 2)
        for x in (-12.0, -9.5):
            sofa(x, Z1 - 0.65, math.pi)
        table(-13.5, 3.0, 0.6, 0.6, h=0.5)
        rug(-14.0, 6.0, 0, 0)
        rug(-14.0, 1.0, 0, 0)
        chandelier(-15.0, 5.0, FLOOR - 0.5)
        for x in (-19.0, -13.0):
            painting(x, Z1 - 0.16, math.pi, 2.0, 1.8, 1.3)
        painting(W - 0.16, 8.0, -math.pi / 2, 2.0, 1.6, 1.2)
        painting(W - 0.16, 1.0, -math.pi / 2, 2.0, 1.6, 1.2)
        # the library (west back, between the stair hall and the atrium)
        bookcase(-14.6, -12.4, -2.6, -2.2, 0.0)
        bookcase(-9.8, -7.6, -2.6, -2.2, 0.0)
        bookcase(-14.6, -12.4, -9.1, -8.7, 0.0)
        table(-11.0, -6.0, 1.2, 0.6)
        for x in (-12.0, -10.0):
            chair(x, -7.0)
        rug(-11.0, -6.0, 0, 1)
        painting(W - 0.16, -7.0, -math.pi / 2, 2.0, 1.2, 1.0)
        # the dining room (east front): a long table and chairs, a sideboard
        table(15.0, 5.5, 3.0, 0.7)
        for x in (12.8, 14.3, 15.8, 17.2):
            chair(x, 4.3)
            chair(x, 6.7)
        lb(X1 - 0.6, X1, 0.0, 0.95, 8.0, 11.0, 'wood')
        chandelier(15.0, 5.5, FLOOR - 0.5)
        rug(15.0, 5.5, 0, 2)
        for x in (12.0, 18.0):
            painting(x, Z1 - 0.16, math.pi, 2.0, 1.8, 1.3)
        painting(E + 0.16, 8.0, math.pi / 2, 2.0, 1.6, 1.2)
        painting(X1 - 0.16, 3.0, -math.pi / 2, 2.0, 1.4, 1.1)
        # the kitchen (east back): an island and a counter, crates of stores
        lb(9.5, 13.0, 0.0, 0.95, -6.5, -5.5, 'marble')
        lb(HX - 1.0, HX - 0.2, 0.0, 0.95, -8.6, -3.0, 'marble')
        lb(9.0, 10.0, 0.0, 1.0, -4.5, -3.5, 'crate')
        lb(11.0, 12.0, 0.0, 1.0, -4.5, -3.5, 'crate')
        # the corridor: pictures along it, a light at each end on every floor
        for x in (-12.0, -9.0, -3.0, 3.0, 9.0, 12.0):
            painting(x, Z0 + 0.16, 0.0, 1.9, 1.2, 0.9)
        for f in range(3):
            chandelier(-12.0, -11.1, f * FLOOR + FLOOR - 0.5, 0.6)
            chandelier(12.0, -11.1, f * FLOOR + FLOOR - 0.5, 0.6)

        # -- first floor --
        y = FLOOR
        bed(-16.0, 8.0, y)                                                    # the master bedroom
        lb(X0, X0 + 0.6, y, y + 2.2, 1.0, 3.0, 'wood')
        sofa(-11.0, 2.0, math.pi / 2, y)
        rug(-16.0, 4.0, y)
        painting(-18.0, Z1 - 0.16, math.pi, y + 2.0, 1.6, 1.2)
        table(-11.0, -6.0, 1.0, 0.6, y)                                       # the study
        chair(-11.0, -7.0, y)
        chair(-9.5, -5.0, y)
        bookcase(-14.6, -12.4, -2.6, -2.2, y)
        painting(W - 0.16, -5.0, -math.pi / 2, y + 2.0)
        bed(16.0, 8.0, y)                                                     # the east bedrooms
        bed(11.0, -6.0, y)
        lb(X1 - 0.6, X1, y, y + 2.2, 1.0, 3.0, 'wood')
        rug(16.0, 4.0, y)
        painting(18.0, Z1 - 0.16, math.pi, y + 2.0, 1.6, 1.2)
        painting(E + 0.16, -6.0, math.pi / 2, y + 2.0)
        for x in (-AT_X + 0.16, AT_X - 0.16):
            for z in (2.5, 8.5):
                painting(x, z, math.pi / 2 if x < 0 else -math.pi / 2, y + 2.0, 1.4, 1.8)

        # -- second floor: the picture gallery round the well, bedrooms in the wings --
        y = 2 * FLOOR
        for x in (-AT_X + 0.16, AT_X - 0.16):
            for z in (2.0, 5.5, 9.0):
                painting(x, z, math.pi / 2 if x < 0 else -math.pi / 2, y + 2.0, 1.2, 1.6)
        for x in (-4.5, 4.5):
            painting(x, Z1 - 0.16, math.pi, y + 2.0, 1.6, 1.2)
            self.statue(x * 1.3, -7.5, 0.0, 0.8, y, local=True)
        sofa(-6.0, 6.5, math.pi / 2, y)
        sofa(6.0, 6.5, -math.pi / 2, y)
        bed(-16.0, 8.0, y)
        bed(-11.0, -6.0, y)
        bed(16.0, 8.0, y)
        table(11.0, -6.0, 1.0, 0.6, y)
        chair(11.0, -7.0, y)
        for x in (-19.0, -13.0, 13.0, 19.0):
            painting(x, Z1 - 0.16, math.pi, y + 2.0, 1.6, 1.2)
        lb(X1 - 0.6, X1, y, y + 2.2, 1.0, 3.0, 'wood')
        rug(-16.0, 4.0, y)
        rug(16.0, 4.0, y)
        lb(-11.0, -10.0, y, y + 1.0, 2.0, 3.0, 'crate')

    def topiary_in(self, x, z):
        # a potted tree in the house
        self.box(x, 0.4, HOUSE_Z + z, 0.4, 0.4, 0.4, 0, 'marble')
        self.box(x, 1.6, HOUSE_Z + z, 0.5, 0.8, 0.5, 0, 'inv')
        self.dd('topiary', x, z, r=0.7, y=0.9)

    # -- the grounds ---------------------------------------------------------

    def reserved_near(self, x, z, r):
        """Too close to a spawn, a bomb site or a hill to put cover there."""
        for (px, pz, pr) in ((self.spawn_w[0], self.spawn_w[1], 10.0), (self.spawn_e[0], self.spawn_e[1], 10.0),
                             (self.site_a[0], self.site_a[1], 4.0), (self.site_b[0], self.site_b[1], 5.0)) + tuple((hx, hz, 5.0) for (hx, hz) in self.hills):
            if math.hypot(x - px, z - pz) < r + pr:
                return True
        return False

    def generate(self):
        rng = self.rng
        bx, bz = self.bx, self.bz
        self.spawn_w = (-66.0, 0.0)
        self.spawn_e = (66.0, 0.0)
        self.site_a = (-15.0, HOUSE_Z + 5.0)     # the ballroom
        self.site_b = (42.0, 20.0)               # the south half of the tennis court
        self.hills = [(0.0, HOUSE_Z + 5.5), (-44.0, 14.0), (38.0, -38.0)]

        # the estate wall, brick, with piers at the gate at the foot of the drive
        wh = 3.2
        self.box(0, wh / 2, -bz - 0.5, bx + 1, wh / 2, 0.5, 0, 'wall', 5)
        self.box(0, wh / 2, bz + 0.5, bx + 1, wh / 2, 0.5, 0, 'wall', 5)
        self.box(-bx - 0.5, wh / 2, 0, 0.5, wh / 2, bz, 0, 'wall', 5)
        self.box(bx + 0.5, wh / 2, 0, 0.5, wh / 2, bz, 0, 'wall', 5)
        for x in (-5.5, 5.5):
            self.box(x, 2.2, bz - 0.4, 0.6, 2.2, 0.6, 0, 'stone')
            self.props.append((x, bz - 0.4, 1.0))
        self.portal(0.0, bz - 0.02, math.pi, 9.0, 3.4)
        for x in (-bx + 20, -bx + 40, bx - 20, bx - 40):
            for z in (-bz + 1.2, bz - 1.2):
                self.tree(x, z, 2.6)

        # the drive: gravel from the gate to the forecourt, hedges either side
        FRONT = HOUSE_Z + HD          # the house front, in the world
        self.roads.append({'w': 9.0, 'c': 'gravel', 'pts': [(0.0, bz), (0.0, FRONT + 4.0)]})
        self.roads.append({'w': 34.0, 'c': 'gravel', 'pts': [(0.0, FRONT + 4.6), (0.0, FRONT + 13.0)]})
        # the ring round the house, clear of the terraces, and paths to the gardens
        r0, r1 = HW + 7.0, HD + 4.0
        ring = [(-r0, HOUSE_Z + r1), (-r0, HOUSE_Z - r1), (r0, HOUSE_Z - r1), (r0, HOUSE_Z + r1), (-r0, HOUSE_Z + r1)]
        self.roads.append({'w': 4.0, 'c': 'gravel', 'pts': ring})
        self.roads.append({'w': 3.0, 'c': 'gravel', 'pts': [(-r0, -8.0), (-44.0, 8.0), (-44.0, 22.0)]})
        self.roads.append({'w': 3.0, 'c': 'gravel', 'pts': [(r0, -2.0), (42.0, 8.0), (42.0, 12.0)]})
        self.roads.append({'w': 3.0, 'c': 'gravel', 'pts': [(-r0, HOUSE_Z - r1), (-33.0, -33.0)]})
        self.roads.append({'w': 3.0, 'c': 'gravel', 'pts': [(r0, HOUSE_Z - r1), (38.0, -36.0)]})
        for z in range(int(FRONT + 15), int(bz - 4), 2):
            for sx in (-1, 1):
                # a gap in the hedge every ten metres, so the drive can be crossed
                if (z - 5) % 10 in (0, 1, 2, 3):
                    continue
                self.hedge(sx * 6.0, z, 0.5, 1.0, 0, 0.9)
        for z in range(int(FRONT + 16), int(bz - 6), 10):
            for sx in (-1, 1):
                self.box(sx * 7.6, 1.6, z, 0.12, 1.6, 0.12, 0, 'steel', 2)
                self.deco.append({'k': 'lamp', 'x': sx * 7.6, 'y': 3.4, 'z': z})
                self.props.append((sx * 7.6, z, 0.5))

        self.house()
        self.areas.append({'n': 'The Manor', 'x': 0.0, 'z': HOUSE_Z, 'r': 26})
        self.areas.append({'n': 'The Drive', 'x': 0.0, 'z': 30.0, 'r': 14})
        self.areas.append({'n': 'The Forecourt', 'x': 0.0, 'z': FRONT + 8.0, 'r': 12})

        # the terraces: balustraded paving off the ballroom and dining room, a gap
        # in the rail to step down onto the lawn
        for sx in (-1, 1):
            tx = sx * (HW + 2.2)
            self.box(tx, 0.2, HOUSE_Z + 3.0, 2.2, 0.2, 7.0, 0, 'marble')
            self.box(tx, 0.9, HOUSE_Z - 4.0, 2.2, 0.5, 0.15, 0, 'stone')
            self.box(tx, 0.9, HOUSE_Z + 10.0, 2.2, 0.5, 0.15, 0, 'stone')
            ox = sx * (HW + 4.4 - 0.15)
            self.box(ox, 0.9, HOUSE_Z - 1.5, 0.15, 0.5, 2.5, 0, 'stone')
            self.box(ox, 0.9, HOUSE_Z + 7.5, 0.15, 0.5, 2.5, 0, 'stone')
            self.statue(sx * 33.0, HOUSE_Z + 3.0, 0.0, 1.0)
            self.props.append((tx, HOUSE_Z + 3.0, 7.5))

        # golf carts: on the forecourt, by the court, by the pond
        self.golfcart(-13.0, FRONT + 9.0, 0.3)
        self.golfcart(13.0, FRONT + 9.0, -0.3)
        self.golfcart(50.0, 10.0, math.pi / 2)
        self.golfcart(-30.0, -28.0, 2.4)

        # the west garden: a parterre of hedges round a statue, walls and benches
        px, pz = -44.0, 26.0
        self.statue(px, pz, 0.0, 1.4)
        for (dx, dz) in ((-9, -9), (9, -9), (-9, 9), (9, 9)):
            for (ex, ez) in ((3.5, 0.0), (0.0, 3.5)):
                self.hedge(px + dx + (ex if dx < 0 else -ex), pz + dz + (ez if dz < 0 else -ez),
                           3.0 if ex else 0.5, 0.5 if ex else 3.0, 0, 1.1)
        for (dx, dz) in ((-4, 0), (4, 0), (0, -4), (0, 4)):
            self.topiary(px + dx, pz + dz, 0.7)
        for (dx, dz, yaw) in ((-16, 0, math.pi / 2), (16, 0, -math.pi / 2), (0, 16, 0.0)):
            self.bench(px + dx, pz + dz, yaw)
        self.garden_wall(px - 20.0, pz, math.pi / 2, 14)
        self.garden_wall(px, pz + 20.0, 0.0, 16)
        self.hedge(px - 12.0, pz - 14.0, 6.0, 0.5, 0, 1.1)
        self.hedge(px + 12.0, pz - 14.0, 6.0, 0.5, 0, 1.1)
        self.areas.append({'n': 'The Parterre', 'x': px, 'z': pz, 'r': 18})

        # the east garden: a tennis court inside a hedge, benches, a pavilion
        cx, cz = 42.0, 26.0
        self.roads.append({'w': 12.0, 'c': 'court', 'pts': [(cx, cz - 13.0), (cx, cz + 13.0)]})
        for dz in (-11.9, 11.9):
            self.deco.append({'k': 'lines', 'x': cx, 'z': cz + dz, 'l': 11.0, 'yaw': math.pi / 2})
        for dx in (-5.5, 5.5, -4.1, 4.1):
            self.deco.append({'k': 'lines', 'x': cx + dx, 'z': cz, 'l': 23.8, 'yaw': 0.0})
        for dz in (-6.4, 6.4):
            self.deco.append({'k': 'lines', 'x': cx, 'z': cz + dz, 'l': 8.2, 'yaw': math.pi / 2})
        self.deco.append({'k': 'lines', 'x': cx, 'z': cz, 'l': 12.8, 'yaw': 0.0})
        self.box(cx, 0.5, cz, 6.4, 0.5, 0.04, 0, 'inv')
        self.deco.append({'k': 'net', 'x': cx, 'z': cz, 'w': 12.8, 'yaw': 0.0})
        self.hedge(cx - 8.5, cz, 0.5, 11.0, 0, 1.2)
        self.hedge(cx + 8.5, cz, 0.5, 11.0, 0, 1.2)
        self.hedge(cx, cz - 15.0, 6.0, 0.5, 0, 1.2)
        self.hedge(cx, cz + 15.0, 6.0, 0.5, 0, 1.2)
        for (dx, dz) in ((-11.5, -18.0), (11.5, -18.0), (-11.5, 18.0), (11.5, 18.0)):
            self.bench(cx + dx, cz + dz, 0.0 if dz < 0 else math.pi)
        self.pavilion(cx + 20.0, cz, math.pi / 2)
        self.areas.append({'n': 'Tennis Court', 'x': cx, 'z': cz, 'r': 18})

        # behind the house: open lawn with a pond, a gazebo, garden walls and trees
        self.deco.append({'k': 'pond', 'x': -40.0, 'z': -38.0, 'r': 8.0})
        self.props.append((-40.0, -38.0, 9.0))
        self.pavilion(52.0, -40.0, 0.0)
        self.areas.append({'n': 'The Pond', 'x': -40.0, 'z': -38.0, 'r': 12})
        self.areas.append({'n': 'North Lawn', 'x': 20.0, 'z': -42.0, 'r': 20})
        self.garden_wall(0.0, -40.0, 0.0, 18, 1.2)
        self.garden_wall(-22.0, -46.0, math.pi / 2, 10, 1.2)
        self.garden_wall(22.0, -46.0, math.pi / 2, 10, 1.2)
        for (x, z) in ((-8.0, -46.0), (8.0, -46.0), (-14.0, -34.0), (14.0, -34.0)):
            self.topiary(x, z, 0.9)
        for (x, z) in ((-58.0, -20.0), (58.0, -20.0), (-58.0, 40.0), (58.0, 40.0)):
            self.statue(x, z, 0.0, 1.2)
        # trees: along the boundary, round the pond and lawn, never on a road
        for _ in range(500):
            if sum(1 for d in self.deco if d['k'] == 'tree') >= 44:
                break
            x = rng.uniform(-bx + 4, bx - 4)
            z = rng.uniform(-bz + 4, bz - 4)
            if self.road_near(x, z, 3.0) or (abs(x) < 14 and z > 6) or self.reserved_near(x, z, 2.0):
                continue
            if self.free(x, z, 2.0, 2.0, 1.2, road=False):
                self.tree(x, z)
        # low hedges and walls scattered as cover in the open, off the roads
        for _ in range(400):
            if sum(1 for b in self.boxes if b[7] == 'hedge') >= 100:
                break
            x = rng.uniform(-bx + 6, bx - 6)
            z = rng.uniform(-bz + 6, bz - 6)
            if self.road_near(x, z, 2.5) or (abs(x) < 10 and z > 0) or self.reserved_near(x, z, 2.6):
                continue
            yaw = rng.choice([0.0, math.pi / 2])
            if self.free(x, z, 2.6, 1.6, 0.8, road=False):
                if rng.random() < 0.7:
                    self.hedge(x, z, 2.4, 0.5, yaw, rng.uniform(0.9, 1.3))
                else:
                    self.garden_wall(x, z, yaw, 4.0)

        for label, (sx, sz) in (('A', self.site_a), ('B', self.site_b)):
            self.deco.append({'k': 'site', 'x': round(sx, 2), 'z': round(sz, 2), 'r': 4.5, 'l': label})
        for rd in self.roads:
            self.deco.append({'k': 'road', 'w': rd['w'], 'c': rd['c'], 'pts': [[round(x, 2), round(z, 2)] for (x, z) in rd['pts']]})
        self.areas.append({'n': 'West Gate', 'x': self.spawn_w[0], 'z': 0.0, 'r': 10})
        self.areas.append({'n': 'East Gate', 'x': self.spawn_e[0], 'z': 0.0, 'r': 10})
        self.pick_spawns()

    def pavilion(self, x, z, yaw):
        """An open garden pavilion: four columns, a low wall on two sides, a roof."""
        for (dx, dz) in ((-2.5, -2.5), (2.5, -2.5), (-2.5, 2.5), (2.5, 2.5)):
            ox, oz = rot(dx, dz, yaw)
            self.deco.append({'k': 'column', 'x': round(x + ox, 2), 'z': round(z + oz, 2), 'h': 3.4})
            self.box(x + ox, 1.7, z + oz, 0.34, 1.7, 0.34, 0, 'inv')
        self.box(x, 3.6, z, 3.2, 0.2, 3.2, yaw, 'roof', 4)
        for side in (-1, 1):
            ox, oz = rot(0, side * 2.6, yaw)
            self.box(x + ox, 0.45, z + oz, 2.0, 0.45, 0.15, yaw, 'stone')
        self.props.append((x, z, 3.6))

    def road_near(self, x, z, r):
        for rd in self.roads:
            pts = rd['pts']
            for (a, b) in zip(pts, pts[1:]):
                ax, az = a
                bxx, bzz = b
                vx, vz = bxx - ax, bzz - az
                L2 = vx * vx + vz * vz or 1.0
                t = max(0.0, min(1.0, ((x - ax) * vx + (z - az) * vz) / L2))
                if math.hypot(x - (ax + vx * t), z - (az + vz * t)) < rd['w'] / 2 + r:
                    return True
        return False

    def road_dist(self, x, z):
        # gravel is open ground: spawns may use it
        return 1e9
