// Guest names: a browser that is not signed in plays as an adjective and an animal,
// chosen from these lists by a hash of its device id and a salt it may re-roll.
// The server keeps the same lists (server/names.py) and makes the same choice, so a
// guest cannot pick a name of their own.

export const ADJ = ['funny', 'bold', 'sneaky', 'brave', 'lazy', 'happy', 'grumpy', 'quick', 'sleepy', 'jolly', 'fancy', 'wild', 'clever', 'shy', 'loud', 'quiet', 'tiny', 'mighty', 'salty', 'spicy', 'sunny', 'frosty', 'dusty', 'rusty', 'shiny', 'lucky', 'mellow', 'zippy', 'sassy', 'witty', 'dizzy', 'cheeky', 'fuzzy', 'hungry', 'cosy', 'crispy', 'smoky', 'breezy', 'stormy', 'golden', 'silver', 'rapid', 'gentle', 'rowdy', 'sleek', 'plucky', 'nimble', 'hardy', 'merry', 'proud', 'humble', 'eager', 'calm', 'feisty', 'sly', 'bouncy', 'groovy', 'snappy', 'soggy', 'perky', 'peppy', 'jumpy', 'dapper', 'noble'];
export const ANIMALS = ['camel', 'pig', 'goat', 'falcon', 'gecko', 'otter', 'badger', 'ferret', 'heron', 'ibis', 'jackal', 'koala', 'lemur', 'moose', 'newt', 'ocelot', 'panda', 'quail', 'raven', 'sloth', 'toad', 'viper', 'walrus', 'yak', 'zebra', 'bison', 'crab', 'dingo', 'eagle', 'finch', 'gazelle', 'hyena', 'iguana', 'jaguar', 'kiwi', 'llama', 'mole', 'narwhal', 'oryx', 'parrot', 'rabbit', 'seal', 'tiger', 'urchin', 'vole', 'weasel', 'lynx', 'donkey', 'beetle', 'cobra', 'dolphin', 'emu', 'frog', 'hornet', 'lobster', 'magpie', 'owl', 'pelican', 'rhino', 'shrimp', 'turtle', 'wombat', 'marmot', 'puffin'];

// FNV-1a over the UTF-8 bytes, like the server's
function fnv(s) {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(s)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function guestName(seed) {
  const h = fnv(String(seed || ''));
  return ADJ[h % ADJ.length] + ANIMALS[Math.floor(h / ADJ.length) % ANIMALS.length];
}

const PATTERN = new RegExp('^(' + ADJ.join('|') + ')(' + ANIMALS.join('|') + ')$');
export function isGuestName(n) {
  return PATTERN.test(String(n || ''));
}
