"""
Sending email: the confirmation codes for changing a username or password.

Picks whichever is set up, in this order:
  RESEND_API_KEY            Resend's HTTP API (https://resend.com), from MAIL_FROM
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS   any mailbox that does STARTTLS, from MAIL_FROM
Neither set: nothing is sent, the message is printed to the log instead and
send() returns False. The last few messages are kept in OUTBOX so a local
test can read the code back (GET /__mail on localhost).
"""

import collections
import json
import os
import smtplib
import urllib.request
from email.message import EmailMessage

RESEND_API_KEY = os.environ.get('RESEND_API_KEY', '')
SMTP_HOST = os.environ.get('SMTP_HOST', '')
SMTP_PORT = int(os.environ.get('SMTP_PORT') or 587)
SMTP_USER = os.environ.get('SMTP_USER', '')
SMTP_PASS = os.environ.get('SMTP_PASS', '')
MAIL_FROM = os.environ.get('MAIL_FROM') or 'Souk Siege <noreply@souksiege.com>'

OUTBOX = collections.deque(maxlen=50)


def configured():
    return bool(RESEND_API_KEY or SMTP_HOST)


def send(to, subject, text):
    """Send one plain-text email. Blocking: call it off the event loop.
    Returns True when a provider took it, False when it was only logged."""
    OUTBOX.append({'to': to, 'subject': subject, 'text': text})
    if RESEND_API_KEY:
        body = json.dumps({'from': MAIL_FROM, 'to': [to], 'subject': subject, 'text': text}).encode()
        req = urllib.request.Request('https://api.resend.com/emails', data=body, method='POST',
                                     headers={'Authorization': 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=15) as r:
            r.read()
        return True
    if SMTP_HOST:
        msg = EmailMessage()
        msg['From'] = MAIL_FROM
        msg['To'] = to
        msg['Subject'] = subject
        msg.set_content(text)
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as s:
            s.starttls()
            if SMTP_USER:
                s.login(SMTP_USER, SMTP_PASS)
            s.send_message(msg)
        return True
    print('mail (not sent, no mailer set up) to %s: %s / %s' % (to, subject, text.replace('\n', ' ')), flush=True)
    return False


def masked(email):
    """m•••@example.com: enough to know which inbox to look in."""
    if '@' not in email:
        return '•••'
    name, dom = email.split('@', 1)
    return name[:1] + '•••@' + dom
