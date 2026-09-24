"""
The cosmetics catalogue as the server sees it: ids, rarities and which
crate each comes from. The look of every item lives in public/js/skins.js;
tools/test_catalog.py checks the two lists agree.
"""

import random

GUNS = ['smg', 'lmg', 'shotgun', 'sniper', 'pistol', 'knife']

RARITY_WEIGHTS = {'common': 55, 'uncommon': 25, 'rare': 13, 'epic': 5.5, 'legendary': 1.5}
# the Bazaar Case has no commons and better odds at the top
BAZAAR_WEIGHTS = {'uncommon': 42, 'rare': 33, 'epic': 18, 'legendary': 7}

REFUND = {'common': 20, 'uncommon': 30, 'rare': 50, 'epic': 80, 'legendary': 150}

CRATES = {
    'gun': {'name': 'Armory Crate', 'price': 100},
    'outfit': {'name': 'Wardrobe Crate', 'price': 100},
    'bazaar': {'name': 'Bazaar Case', 'price': 500},
    'blade': {'name': 'Blade Crate', 'price': 150},
    'camo': {'name': 'Tactical Camouflage Case', 'price': 1000},
    'party': {'name': 'Carnival Case', 'price': 2000},
}
# the two new cases have no commons either
CAMO_WEIGHTS = {'uncommon': 45, 'rare': 32, 'epic': 16, 'legendary': 7}
PARTY_WEIGHTS = {'uncommon': 42, 'rare': 33, 'epic': 18, 'legendary': 7}

# (id, rarity, crate)
FINISHES = [
    ('sandblast', 'common', 'armory'), ('olive', 'common', 'armory'), ('slate', 'common', 'armory'),
    ('rust', 'common', 'armory'), ('desertcamo', 'uncommon', 'armory'), ('urbancamo', 'uncommon', 'armory'),
    ('tealtwo', 'uncommon', 'armory'), ('brick', 'uncommon', 'armory'), ('zellige', 'rare', 'armory'),
    ('tiger', 'rare', 'armory'), ('carbon', 'rare', 'armory'), ('digital', 'rare', 'armory'),
    ('damascus', 'epic', 'armory'), ('neon', 'epic', 'armory'), ('crimsonweb', 'epic', 'armory'),
    ('gilded', 'legendary', 'armory'), ('mirage', 'legendary', 'armory'),
    # Bazaar Case
    ('bubblegum', 'uncommon', 'bazaar'), ('limesorbet', 'uncommon', 'bazaar'), ('polkapop', 'uncommon', 'bazaar'),
    ('toyblocks', 'rare', 'bazaar'), ('sunsetfade', 'rare', 'bazaar'), ('oceanwave', 'rare', 'bazaar'),
    ('graffiti', 'epic', 'bazaar'), ('galaxy', 'epic', 'bazaar'),
    ('holofoil', 'legendary', 'bazaar'), ('lavalamp', 'legendary', 'bazaar'),
    # Blade Case — knife finishes only
    ('polishedsteel', 'common', 'blade'), ('ebony', 'common', 'blade'),
    ('camelbone', 'uncommon', 'blade'), ('turquoise', 'uncommon', 'blade'),
    ('gildedhilt', 'rare', 'blade'), ('obsidian', 'rare', 'blade'),
    ('bloodsteel', 'epic', 'blade'), ('mirageblade', 'legendary', 'blade'),
    # Tactical Camouflage Case
    ('desertdpm', 'uncommon', 'camo'), ('woodlandgun', 'uncommon', 'camo'),
    ('arcticgun', 'rare', 'camo'), ('urbandigital', 'rare', 'camo'),
    ('multicamgun', 'epic', 'camo'), ('nightcamo', 'legendary', 'camo'),
    # Carnival Case
    ('candycane', 'uncommon', 'party'), ('polkapunch', 'uncommon', 'party'), ('sherbet', 'uncommon', 'party'),
    ('bubblecamo', 'rare', 'party'), ('zebrapop', 'rare', 'party'), ('rainbowroad', 'rare', 'party'),
    ('ultraviolet', 'epic', 'party'), ('electricstripe', 'epic', 'party'), ('discoball', 'epic', 'party'),
    ('plasma', 'legendary', 'party'), ('marquee', 'legendary', 'party'),
]

OUTFITS = [
    ('standard', 'common', 'starter'),
    ('porter', 'common', 'wardrobe'), ('scout', 'common', 'wardrobe'), ('fatigues', 'common', 'wardrobe'),
    ('nightwatch', 'uncommon', 'wardrobe'), ('urban', 'uncommon', 'wardrobe'), ('nomad', 'uncommon', 'wardrobe'),
    ('tigercamo', 'rare', 'wardrobe'), ('zelligeguard', 'rare', 'wardrobe'),
    ('crimson', 'epic', 'wardrobe'), ('midnight', 'epic', 'wardrobe'),
    ('sultan', 'legendary', 'wardrobe'), ('mirage', 'legendary', 'wardrobe'),
    # Bazaar Case
    ('tracksuit', 'uncommon', 'bazaar'), ('candystripe', 'uncommon', 'bazaar'),
    ('surfer', 'rare', 'bazaar'), ('popart', 'rare', 'bazaar'),
    ('festival', 'epic', 'bazaar'),
    ('stargazer', 'legendary', 'bazaar'),
    # Tactical Camouflage Case
    ('desertops', 'uncommon', 'camo'), ('woodlandops', 'uncommon', 'camo'),
    ('arcticops', 'rare', 'camo'), ('urbanops', 'rare', 'camo'),
    ('multiterrain', 'epic', 'camo'), ('ghillie', 'legendary', 'camo'),
]
# the outfits that hide you: recon beacons miss them, aim help ignores them
CAMO_OUTFITS = {o[0] for o in OUTFITS if o[2] == 'camo'}

SHOOTERS = [g for g in GUNS if g != 'knife']
FINISH_IDS = {f[0] for f in FINISHES}
OUTFIT_IDS = {o[0] for o in OUTFITS}
RARITY_OF_FINISH = {f[0]: f[1] for f in FINISHES}
RARITY_OF_OUTFIT = {o[0]: o[1] for o in OUTFITS}


def _pick_rarity(weights, rng):
    total = sum(weights.values())
    x = rng.random() * total
    for r, w in weights.items():
        x -= w
        if x <= 0:
            return r
    return list(weights)[0]


def roll(kind, rng=random):
    """A random prize from a crate: {'kind': 'gun'|'outfit', ...}."""
    if kind == 'gun':
        r = _pick_rarity(RARITY_WEIGHTS, rng)
        pool = [f for f in FINISHES if f[1] == r and f[2] == 'armory']
        f = rng.choice(pool)
        return {'kind': 'gun', 'weapon': rng.choice(SHOOTERS), 'finish': f[0], 'rarity': r}
    if kind == 'blade':
        r = _pick_rarity(RARITY_WEIGHTS, rng)
        pool = [f for f in FINISHES if f[1] == r and f[2] == 'blade']
        f = rng.choice(pool)
        return {'kind': 'gun', 'weapon': 'knife', 'finish': f[0], 'rarity': r}
    if kind == 'outfit':
        r = _pick_rarity(RARITY_WEIGHTS, rng)
        pool = [o for o in OUTFITS if o[1] == r and o[2] == 'wardrobe']
        o = rng.choice(pool)
        return {'kind': 'outfit', 'outfit': o[0], 'rarity': r}
    if kind == 'camo':
        # half outfits, half finishes for any gun or the knife
        r = _pick_rarity(CAMO_WEIGHTS, rng)
        if rng.random() < 0.5:
            o = rng.choice([o for o in OUTFITS if o[1] == r and o[2] == 'camo'])
            return {'kind': 'outfit', 'outfit': o[0], 'rarity': r}
        f = rng.choice([f for f in FINISHES if f[1] == r and f[2] == 'camo'])
        return {'kind': 'gun', 'weapon': rng.choice(GUNS), 'finish': f[0], 'rarity': r}
    if kind == 'party':
        r = _pick_rarity(PARTY_WEIGHTS, rng)
        f = rng.choice([f for f in FINISHES if f[1] == r and f[2] == 'party'])
        return {'kind': 'gun', 'weapon': rng.choice(GUNS), 'finish': f[0], 'rarity': r}
    # bazaar: mostly gun finishes, sometimes an outfit
    r = _pick_rarity(BAZAAR_WEIGHTS, rng)
    guns = [f for f in FINISHES if f[1] == r and f[2] == 'bazaar']
    outfits = [o for o in OUTFITS if o[1] == r and o[2] == 'bazaar']
    if outfits and (not guns or rng.random() < 0.4):
        o = rng.choice(outfits)
        return {'kind': 'outfit', 'outfit': o[0], 'rarity': r}
    f = rng.choice(guns)
    return {'kind': 'gun', 'weapon': rng.choice(SHOOTERS), 'finish': f[0], 'rarity': r}


# -- lockers ------------------------------------------------------------------

STARTING_DINARS = 300


GUN_ATTACH_SLOTS = ('optic', 'muzzle', 'mag', 'ammo', 'trigger', 'laser')
# the choices a loadout has (keyed by loadout number as a string); the first is the default
NADE_CHOICES = {'0': ('frag',), '1': ('frag', 'smoke'), '2': ('frag', 'flash'), '3': ('frag',)}
PERK_CHOICES = {'0': ('ammo',), '1': ('med', 'wall'), '2': ('ladder',), '3': ('beacon', 'drone')}


def new_locker():
    return {'dinars': STARTING_DINARS, 'guns': [], 'outfits': ['standard'], 'kills': {},
            'equip': {'outfit': 'standard', 'guns': {}, 'pistol': {}, 'nade': {}, 'attach': {}, 'perk': {}}, 'opened': 0}


def clean_locker(d, dinar_cap=None):
    """Keep only valid items from a locker someone sent us."""
    out = new_locker()
    if not isinstance(d, dict):
        return out
    try:
        dn = int(d.get('dinars', STARTING_DINARS))
    except (TypeError, ValueError):
        dn = STARTING_DINARS
    out['dinars'] = max(0, dn if dinar_cap is None else min(dn, dinar_cap))
    guns = d.get('guns') if isinstance(d.get('guns'), list) else []
    seen = set()
    for k in guns:
        if isinstance(k, str) and ':' in k:
            w, f = k.split(':', 1)
            if w in GUNS and f in FINISH_IDS and k not in seen:
                seen.add(k)
                out['guns'].append(k)
    outfits = d.get('outfits') if isinstance(d.get('outfits'), list) else []
    for o in outfits:
        if isinstance(o, str) and o in OUTFIT_IDS and o not in out['outfits']:
            out['outfits'].append(o)
    kills = d.get('kills')
    if isinstance(kills, dict):
        for wpn, n in kills.items():
            if wpn in GUNS:
                try:
                    out['kills'][wpn] = max(0, min(10 ** 7, int(n)))
                except (TypeError, ValueError):
                    pass
    out['equip'] = clean_equip(d.get('equip'), out)
    try:
        out['opened'] = max(0, int(d.get('opened', 0)))
    except (TypeError, ValueError):
        out['opened'] = 0
    return out


def clean_equip(e, locker):
    """Equipped items, dropping anything the locker doesn't own."""
    res = {'outfit': 'standard', 'guns': {}, 'pistol': {}, 'nade': {}, 'attach': {}, 'perk': {}}
    if not isinstance(e, dict):
        return res
    if e.get('outfit') in locker['outfits']:
        res['outfit'] = e['outfit']
    g = e.get('guns') if isinstance(e.get('guns'), dict) else {}
    for w in ('smg', 'lmg', 'shotgun', 'sniper', 'knife'):
        f = g.get(w)
        if isinstance(f, str) and '%s:%s' % (w, f) in locker['guns']:
            res['guns'][w] = f
    p = e.get('pistol') if isinstance(e.get('pistol'), dict) else {}
    for ld in ('0', '1', '2', '3'):
        f = p.get(ld)
        if isinstance(f, str) and 'pistol:%s' % f in locker['guns']:
            res['pistol'][ld] = f
    n = e.get('nade') if isinstance(e.get('nade'), dict) else {}
    for ld, kinds in NADE_CHOICES.items():
        if n.get(ld) in kinds:
            res['nade'][ld] = n[ld]
    pk = e.get('perk') if isinstance(e.get('perk'), dict) else {}
    for ld, opts in PERK_CHOICES.items():
        if pk.get(ld) in opts:
            res['perk'][ld] = pk[ld]
    # fitted attachments: ids are checked against the kills the player has in the game
    at = e.get('attach') if isinstance(e.get('attach'), dict) else {}
    for wpn, fitted in at.items():
        if wpn not in GUNS or not isinstance(fitted, dict):
            continue
        keep = {}
        for slot in GUN_ATTACH_SLOTS:
            v = fitted.get(slot)
            if isinstance(v, str) and 0 < len(v) <= 24 and v.isalnum():
                keep[slot] = v
        if keep:
            res['attach'][wpn] = keep
    return res


def open_crate(locker, kind, rng=random):
    """Pay for and open a crate. Returns the prize, or None if unaffordable."""
    crate = CRATES.get(kind)
    if not crate or locker['dinars'] < crate['price']:
        return None
    locker['dinars'] -= crate['price']
    locker['opened'] = locker.get('opened', 0) + 1
    prize = roll(kind, rng)
    if prize['kind'] == 'gun':
        key = '%s:%s' % (prize['weapon'], prize['finish'])
        prize['dup'] = key in locker['guns']
        if not prize['dup']:
            locker['guns'].append(key)
    else:
        prize['dup'] = prize['outfit'] in locker['outfits']
        if not prize['dup']:
            locker['outfits'].append(prize['outfit'])
    prize['refund'] = REFUND[prize['rarity']] if prize['dup'] else 0
    locker['dinars'] += prize['refund']
    return prize
