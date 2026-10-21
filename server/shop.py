"""
The item shop: listings the owner puts up (skins, carts, dinars) for real money,
paid through Stripe Checkout. The listings live in data/shop.json; what was
bought is granted to the account when Stripe's webhook says the payment went
through. With no Stripe key set, the shop shows its listings but cannot sell.

    STRIPE_SECRET_KEY      sk_live_... (or sk_test_...)
    STRIPE_WEBHOOK_SECRET  whsec_... for the endpoint POST /stripe/webhook
    PUBLIC_URL             where to send players back to (default https://souksiege.com)
"""

import hashlib
import hmac
import json
import os
import threading
import time
import urllib.parse
import urllib.request

import accounts
import catalog

SHOP_FILE = os.path.join(accounts.DATA_DIR, 'shop.json')
ORDERS_FILE = os.path.join(accounts.DATA_DIR, 'orders.jsonl')
STRIPE_KEY = os.environ.get('STRIPE_SECRET_KEY', '')
STRIPE_WEBHOOK = os.environ.get('STRIPE_WEBHOOK_SECRET', '')
PUBLIC_URL = (os.environ.get('PUBLIC_URL') or 'https://souksiege.com').rstrip('/')
CURRENCY = 'aud'
KINDS = ('outfit', 'gun', 'cart', 'dinars')
_lock = threading.Lock()
listings = []            # [{'sku', 'kind', 'id', 'name', 'price', 'blurb', 'added'}]
live_lookup = None       # set by the server: the in-memory locker of an account that is online, or None
live_push = None         # set by the server: send an account's tabs their locker again


def enabled():
    return bool(STRIPE_KEY)


def load():
    global listings
    try:
        with open(SHOP_FILE) as f:
            listings = [x for x in json.load(f) if isinstance(x, dict) and x.get('sku')]
    except (OSError, ValueError):
        listings = []


def save():
    try:
        os.makedirs(accounts.DATA_DIR, exist_ok=True)
        with open(SHOP_FILE, 'w') as f:
            json.dump(listings, f, indent=1)
    except OSError as e:
        print('shop file error: %r' % (e,), flush=True)


def public():
    """What the game shows: the listings and whether anything can actually be bought."""
    return {'on': enabled(), 'currency': CURRENCY, 'items': [{k: x[k] for k in ('sku', 'kind', 'id', 'name', 'price', 'blurb')} for x in listings]}


def valid_item(kind, item):
    """Is this something the catalog knows and that may be sold?"""
    if kind == 'outfit':
        return item in catalog.OUTFIT_IDS and item not in catalog.OWNER_ONLY and item != 'standard'
    if kind == 'gun':
        w, _, f = item.partition(':')
        return w in catalog.GUNS and f in catalog.FINISH_IDS
    if kind == 'cart':
        return item in catalog.CART_IDS and item not in catalog.OWNER_CARTS
    if kind == 'dinars':
        return item.isdigit() and 0 < int(item) <= 1000000
    return False


def add(kind, item, price_cents, name, blurb=''):
    if kind not in KINDS or not valid_item(kind, item):
        raise ValueError('not something the catalog knows')
    if not 50 <= int(price_cents) <= 50000:
        raise ValueError('price must be between 0.50 and 500')
    sku = '%s-%s' % (kind, item.replace(':', '-'))
    entry = {'sku': sku, 'kind': kind, 'id': item, 'name': (name or item)[:40], 'price': int(price_cents), 'blurb': (blurb or '')[:160],
             'added': time.strftime('%Y-%m-%d')}
    with _lock:
        listings[:] = [x for x in listings if x['sku'] != sku] + [entry]
        save()
    return entry


def remove(sku):
    with _lock:
        before = len(listings)
        listings[:] = [x for x in listings if x['sku'] != sku]
        save()
        return len(listings) < before


def find(sku):
    return next((x for x in listings if x['sku'] == sku), None)


def owned(locker, listing):
    k, item = listing['kind'], listing['id']
    if k == 'outfit':
        return item in locker.get('outfits', [])
    if k == 'gun':
        return item in locker.get('guns', [])
    if k == 'cart':
        return item in locker.get('carts', [])
    return False


def grant(locker, listing):
    """Put what was bought in the locker. Returns the locker."""
    k, item = listing['kind'], listing['id']
    if k == 'outfit':
        if item not in locker.setdefault('outfits', []):
            locker['outfits'].append(item)
    elif k == 'gun':
        if item not in locker.setdefault('guns', []):
            locker['guns'].append(item)
    elif k == 'cart':
        if item not in locker.setdefault('carts', []):
            locker['carts'].append(item)
    elif k == 'dinars':
        locker['dinars'] = int(locker.get('dinars', 0)) + int(item)
    return locker


def price_text(cents):
    return 'A$%d.%02d' % (cents // 100, cents % 100)


# -- Stripe -------------------------------------------------------------------

def _stripe(path, form):
    data = urllib.parse.urlencode(form).encode()
    req = urllib.request.Request('https://api.stripe.com/v1/' + path, data=data, method='POST')
    req.add_header('Authorization', 'Bearer ' + STRIPE_KEY)
    req.add_header('Content-Type', 'application/x-www-form-urlencoded')
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def checkout_session(listing, user):
    """A Stripe Checkout page for one listing, for one account. Returns its URL. Blocking: run it off the loop."""
    form = {
        'mode': 'payment',
        'success_url': PUBLIC_URL + '/?paid=' + urllib.parse.quote(listing['sku']),
        'cancel_url': PUBLIC_URL + '/?shop=1',
        'client_reference_id': str(user['id']),
        'metadata[account]': str(user['id']),
        'metadata[sku]': listing['sku'],
        'metadata[username]': user['username'],
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': CURRENCY,
        'line_items[0][price_data][unit_amount]': str(listing['price']),
        'line_items[0][price_data][product_data][name]': 'Souk Siege: ' + listing['name'],
    }
    if listing.get('blurb'):
        form['line_items[0][price_data][product_data][description]'] = listing['blurb']
    return _stripe('checkout/sessions', form)['url']


def verify_webhook(payload, sig_header, secret=None, now=None):
    """Stripe signs each webhook with the endpoint's secret: check it, and that it is fresh."""
    secret = secret or STRIPE_WEBHOOK
    if not secret or not sig_header:
        return None
    parts = dict(p.split('=', 1) for p in sig_header.split(',') if '=' in p)
    t = parts.get('t')
    v1 = parts.get('v1')
    if not t or not v1:
        return None
    expected = hmac.new(secret.encode(), ('%s.' % t).encode() + payload, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, v1):
        return None
    if abs((now or time.time()) - int(t)) > 600:
        return None
    try:
        return json.loads(payload.decode())
    except ValueError:
        return None


def _seen(order_id):
    try:
        with open(ORDERS_FILE) as f:
            return any(json.loads(l).get('order') == order_id for l in f if l.strip())
    except OSError:
        return False


def fulfil(event):
    """A verified checkout.session.completed event: grant the item once. Returns (user_id, listing) or None."""
    if not event or event.get('type') != 'checkout.session.completed':
        return None
    s = event.get('data', {}).get('object', {})
    if s.get('payment_status') != 'paid':
        return None
    meta = s.get('metadata') or {}
    sku, account = meta.get('sku'), meta.get('account')
    listing = find(sku) if sku else None
    if not listing or not account or not str(account).isdigit():
        return None
    order = s.get('id')
    uid = int(account)
    with _lock:
        if order and _seen(order):
            return None
        # a player who is online has their locker in memory: grant into that one, so nothing
        # they have done since is lost when it is saved
        locker = live_lookup(uid) if live_lookup else None
        if locker is None:
            locker = accounts.locker_of(uid)
        if locker is None:
            return None
        grant(locker, listing)
        accounts.save_locker(uid, locker)
        try:
            os.makedirs(accounts.DATA_DIR, exist_ok=True)
            with open(ORDERS_FILE, 'a') as f:
                f.write(json.dumps({'order': order, 'account': int(account), 'sku': sku, 'price': listing['price'],
                                    'when': time.strftime('%Y-%m-%d %H:%M:%S')}) + '\n')
        except OSError as e:
            print('order file error: %r' % (e,), flush=True)
    if live_push:
        live_push(uid)
    print('SHOP: %s bought %s (%s)' % (meta.get('username', account), sku, price_text(listing['price'])), flush=True)
    return int(account), listing


load()
