"""
Guest names: a player who is not signed in plays as an adjective and an animal,
picked from these lists by a hash of their device id and a salt they may re-roll.
Keep the lists in step with public/js/names.js, which makes the same choice.
"""

import re

ADJ = ['funny', 'bold', 'sneaky', 'brave', 'lazy', 'happy', 'grumpy', 'quick', 'sleepy', 'jolly', 'fancy', 'wild', 'clever', 'shy', 'loud', 'quiet', 'tiny', 'mighty', 'salty', 'spicy', 'sunny', 'frosty', 'dusty', 'rusty', 'shiny', 'lucky', 'mellow', 'zippy', 'sassy', 'witty', 'dizzy', 'cheeky', 'fuzzy', 'hungry', 'cosy', 'crispy', 'smoky', 'breezy', 'stormy', 'golden', 'silver', 'rapid', 'gentle', 'rowdy', 'sleek', 'plucky', 'nimble', 'hardy', 'merry', 'proud', 'humble', 'eager', 'calm', 'feisty', 'sly', 'bouncy', 'groovy', 'snappy', 'soggy', 'perky', 'peppy', 'jumpy', 'dapper', 'noble']
ANIMALS = ['camel', 'pig', 'goat', 'falcon', 'gecko', 'otter', 'badger', 'ferret', 'heron', 'ibis', 'jackal', 'koala', 'lemur', 'moose', 'newt', 'ocelot', 'panda', 'quail', 'raven', 'sloth', 'toad', 'viper', 'walrus', 'yak', 'zebra', 'bison', 'crab', 'dingo', 'eagle', 'finch', 'gazelle', 'hyena', 'iguana', 'jaguar', 'kiwi', 'llama', 'mole', 'narwhal', 'oryx', 'parrot', 'rabbit', 'seal', 'tiger', 'urchin', 'vole', 'weasel', 'lynx', 'donkey', 'beetle', 'cobra', 'dolphin', 'emu', 'frog', 'hornet', 'lobster', 'magpie', 'owl', 'pelican', 'rhino', 'shrimp', 'turtle', 'wombat', 'marmot', 'puffin']
PATTERN = re.compile('^(' + '|'.join(ADJ) + ')(' + '|'.join(ANIMALS) + ')$')


def fnv(s):
    h = 0x811c9dc5
    for b in str(s).encode('utf-8'):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def guest_name(seed):
    h = fnv(seed or '')
    return ADJ[h % len(ADJ)] + ANIMALS[(h // len(ADJ)) % len(ANIMALS)]


def is_guest_name(n):
    return bool(PATTERN.match(str(n or '')))
