"""
Daily challenges: three a day, the same three for everyone, picked from the
pool by the date. Each pays dinars the moment it is done. Progress is kept
on the account's locker (signed in) or carried by the player's browser
(guests), and resets at midnight Sydney time.

The client puts the words together from `kind`, `n`, `gun` and `mode`, so it
can use the gun and mode names it already has.
"""

import datetime
import os
import random

# kind, (target low, target high), reward in dinars
POOL = [
    ('kills', (15, 25), 150),
    ('gunkills', (8, 12), 200),
    ('head', (5, 10), 200),
    ('wins', (1, 2), 250),
    ('matches', (2, 4), 120),
    ('modematches', (1, 2), 150),
    ('nade', (2, 4), 200),
    ('knife', (1, 3), 250),
    ('assists', (4, 8), 120),
    ('streak', (4, 6), 200),
    ('long', (45, 70), 180),
]
GUNS = ['smg', 'lmg', 'shotgun', 'sniper', 'pistol', 'heavy', 'revolver', 'pdw', 'carbine']
MODES = ['tdm', 'ffa', 'koth', 'bomb']
BONUS = 250          # for finishing all three


def today(tz=None):
    pinned = os.environ.get('SOUK_DAILY_DAY')       # tests pin the day
    if pinned:
        return pinned
    t = datetime.datetime.now(tz) if tz else datetime.datetime.now()
    return t.strftime('%Y-%m-%d')


_cache = {}


def challenges(day):
    """The day's three, with ids, targets, and the gun or mode they are about."""
    hit = _cache.get(day)
    if hit:
        return hit
    rng = random.Random('souk-daily:' + day)
    picks = rng.sample(POOL, 3)
    out = []
    for i, (kind, (lo, hi), reward) in enumerate(picks):
        c = {'id': '%s:%d' % (day, i), 'kind': kind, 'n': rng.randint(lo, hi), 'reward': reward}
        if kind == 'gunkills':
            c['gun'] = rng.choice(GUNS)
        if kind == 'modematches':
            c['mode'] = rng.choice(MODES)
        if kind == 'long':
            c['n'] = 5 * round(c['n'] / 5)
        out.append(c)
    _cache.clear()
    _cache[day] = out
    return out


def fresh(day):
    return {'day': day, 'have': [0, 0, 0], 'done': [False, False, False], 'bonus': False}


def clean(rec, day):
    """A record a client sent, or one from a locker: today's or a fresh one."""
    if not isinstance(rec, dict) or rec.get('day') != day:
        return fresh(day)
    out = fresh(day)
    try:
        out['have'] = [max(0, min(10 ** 6, int(v))) for v in list(rec.get('have', []))[:3]] + [0] * (3 - len(list(rec.get('have', []))[:3]))
        out['done'] = [bool(v) for v in list(rec.get('done', []))[:3]] + [False] * (3 - len(list(rec.get('done', []))[:3]))
        out['bonus'] = bool(rec.get('bonus'))
    except (TypeError, ValueError):
        return fresh(day)
    return out


def public(rec, day):
    """What the client shows: the three, with how far along this player is."""
    rec = clean(rec, day)
    return {'t': 'daily', 'day': day, 'bonus': BONUS, 'bonusDone': rec['bonus'],
            'list': [dict(c, have=min(rec['have'][i], c['n']), done=rec['done'][i]) for i, c in enumerate(challenges(day))]}


def bump(rec, day, kind, amount=1, gun=None, mode=None, best=False):
    """Count something towards today's challenges. Returns (record, finished):
    the finished list holds (index, challenge) for anything just completed,
    plus ('bonus', BONUS) when that made it all three."""
    rec = clean(rec, day)
    finished = []
    for i, c in enumerate(challenges(day)):
        if c['kind'] != kind or rec['done'][i]:
            continue
        if kind == 'gunkills' and c.get('gun') != gun:
            continue
        if kind == 'modematches' and c.get('mode') != mode:
            continue
        rec['have'][i] = max(rec['have'][i], amount) if best else rec['have'][i] + amount
        if rec['have'][i] >= c['n']:
            rec['have'][i] = c['n']
            rec['done'][i] = True
            finished.append((i, c))
    if finished and all(rec['done']) and not rec['bonus']:
        rec['bonus'] = True
        finished.append(('bonus', BONUS))
    return rec, finished
