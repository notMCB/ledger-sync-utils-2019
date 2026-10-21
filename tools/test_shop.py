#!/usr/bin/env python3
"""
The shop, in-process on a throwaway database: listings are checked against the
catalog, a paid Stripe event (signed like Stripe signs it) grants the item once
and only once, and nothing is granted for a bad signature or an unpaid event.

    python3 tools/test_shop.py
"""

import hashlib
import hmac
import json
import os
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = '/tmp/souk-shop-test-%d' % os.getpid()


def main():
    shutil.rmtree(DATA, ignore_errors=True)
    os.makedirs(DATA)
    os.environ['DATA_DIR'] = DATA
    os.environ['STRIPE_WEBHOOK_SECRET'] = 'whsec_testsecret'
    sys.path.insert(0, os.path.join(os.path.dirname(HERE), 'server'))
    import accounts
    import shop
    # listings: only what the catalog knows, at a sane price
    e = shop.add('outfit', 'nomad', 299, 'Nomad outfit')
    assert e['sku'] == 'outfit-nomad' and shop.find('outfit-nomad'), e
    for bad in (('outfit', 'nosuch', 299), ('gun', 'smg:nosuch', 299), ('outfit', 'nomad', 10), ('cart', 'interceptor', 999)):
        try:
            shop.add(*bad, 'x')
            raise SystemExit('accepted a bad listing: %r' % (bad,))
        except ValueError:
            pass
    shop.add('gun', 'smg:tiger', 199, 'Tiger SMG')
    shop.add('dinars', '2000', 499, '2000 dinars')
    print('  ok   listings are checked against the catalog, and bad ones refused')
    user, token = accounts.signup('buyer', 'buyer@example.com', 'secret123')
    uid = user['id']
    assert 'nomad' not in accounts.locker_of(uid)['outfits']

    def event(sku, paid=True, order='cs_test_1'):
        return {'type': 'checkout.session.completed', 'data': {'object': {'id': order, 'payment_status': 'paid' if paid else 'unpaid',
                                                                            'metadata': {'sku': sku, 'account': str(uid), 'username': 'buyer'}}}}

    def signed(ev, secret='whsec_testsecret', t=None):
        payload = json.dumps(ev).encode()
        t = t or int(time.time())
        v1 = hmac.new(secret.encode(), ('%d.' % t).encode() + payload, hashlib.sha256).hexdigest()
        return payload, 't=%d,v1=%s' % (t, v1)
    payload, sig = signed(event('outfit-nomad'))
    assert shop.verify_webhook(payload, sig), 'a good signature verifies'
    assert not shop.verify_webhook(payload, sig.replace('v1=', 'v1=0')), 'a tampered signature does not'
    assert not shop.verify_webhook(payload, signed(event('outfit-nomad'), t=int(time.time()) - 3600)[1]), 'an old one does not'
    assert not shop.verify_webhook(payload, signed(event('outfit-nomad'), secret='whsec_other')[1]), 'the wrong secret does not'
    print('  ok   webhook signatures: good ones pass, tampered, stale and wrong-secret ones fail')
    assert shop.fulfil(event('outfit-nomad', paid=False)) is None and 'nomad' not in accounts.locker_of(uid)['outfits'], 'unpaid grants nothing'
    assert shop.fulfil(event('outfit-nomad')) == (uid, shop.find('outfit-nomad'))
    assert 'nomad' in accounts.locker_of(uid)['outfits'], 'paid: the outfit is on the account'
    assert shop.fulfil(event('outfit-nomad')) is None, 'the same order again grants nothing more'
    before = accounts.locker_of(uid)['dinars']
    shop.fulfil(event('dinars-2000', order='cs_test_2'))
    assert accounts.locker_of(uid)['dinars'] == before + 2000, 'dinars are added'
    shop.fulfil(event('gun-smg-tiger', order='cs_test_3'))
    assert 'smg:tiger' in accounts.locker_of(uid)['guns'], 'the finish is on the account'
    print('  ok   a paid event grants once; unpaid, repeated or unknown events grant nothing')
    assert shop.owned(accounts.locker_of(uid), shop.find('outfit-nomad')) and not shop.owned(accounts.locker_of(uid), shop.find('dinars-2000'))
    assert shop.remove('gun-smg-tiger') and not shop.find('gun-smg-tiger')
    pub = shop.public()
    assert pub['on'] is False and len(pub['items']) == 2 and all('added' not in it for it in pub['items'])
    print('  ok   ownership, removal and the public listing')
    shutil.rmtree(DATA, ignore_errors=True)
    print('all ok')


if __name__ == '__main__':
    main()
