// The Battle Pass: ten tiers, each 35 kills, each a piece of Italian brainrot.
// The tiers and what they give are listed here; server/catalog.py keeps the
// same list for signed-in players, and tools/test_catalog.py checks the two agree.

export const KILLS_PER_TIER = 35;
export const PASS_NAME = 'Season 1 · Italian Brainrot';

// kind: 'finish' is a gun skin for every gun; 'melee' is a knife skin that changes
// its shape; 'muzzle' is a look for the suppressor; 'outfit' is an outfit
export const PASS_TIERS = [
  { n: 1, kind: 'finish', id: 'sahurdots', name: 'Tung Tung Tung Dots', blurb: 'A gun skin: little Tung Tung Tung Sahurs all over it, like polka dots.' },
  { n: 2, kind: 'finish', id: 'ballerinadots', name: 'Cappuccina Dots', blurb: 'A gun skin: tiny Ballerina Cappuccinas in a polka-dot pattern.' },
  { n: 3, kind: 'melee', id: 'bat', name: 'Sahur’s Bat', blurb: 'Tung Tung Tung Sahur’s wooden baseball bat, in place of your knife. Same reach, same damage.' },
  { n: 4, kind: 'muzzle', id: 'sahur', name: 'Sahur Suppressor', blurb: 'Your suppressor becomes Tung Tung Tung Sahur: the wooden body, the eyes and the mouth. Same stats as any suppressor.' },
  { n: 5, kind: 'outfit', id: 'sahur', name: 'Tung Tung Tung Sahur', blurb: 'Be the log: the rounded wooden body, the face, the thin arms and legs.' },
  { n: 6, kind: 'melee', id: 'cane', name: 'Cappuccina’s Cane', blurb: 'A slender gold-and-porcelain cane, in place of your knife. Same reach, same damage.' },
  { n: 7, kind: 'finish', id: 'sahurwood', name: 'Tung Tung Tung Wood', blurb: 'A gun skin: the whole gun is wood, with his eyes and mouth on the side.' },
  { n: 8, kind: 'outfit', id: 'ballerina', name: 'Ballerina Cappuccina', blurb: 'The teacup head with its latte art and big eyes, the gold bodice and tutu, the thin legs on pointe.' },
  { n: 9, kind: 'finish', id: 'porcelain', name: 'Cappuccina Porcelain', blurb: 'A gun skin: glossy porcelain with gold and pink, like the cup.' },
  { n: 10, kind: 'outfit', id: 'tunggod', name: 'Tung Tung Tung God', blurb: 'The pearl-white god: tall and rounded, the calm smiling face, a halo and golden wings.' },
];

export const tierOf = (kills) => Math.min(PASS_TIERS.length, Math.floor(Math.max(0, kills) / KILLS_PER_TIER));

// put the rewards of every tier up to `tier` into a locker (the guest's copy,
// or the server's), returning the tiers that were new
export function grantPass(s, tier, gunIds) {
  const got = [];
  s.guns = s.guns || [];
  s.outfits = s.outfits || [];
  s.muzzles = s.muzzles || [];
  for (const t of PASS_TIERS) {
    if (t.n > tier) break;
    let fresh = false;
    if (t.kind === 'finish') {
      for (const w of gunIds) {
        if (w === 'knife') continue;
        const key = `${w}:${t.id}`;
        if (!s.guns.includes(key)) { s.guns.push(key); fresh = true; }
      }
    } else if (t.kind === 'melee') {
      const key = `knife:${t.id}`;
      if (!s.guns.includes(key)) { s.guns.push(key); fresh = true; }
    } else if (t.kind === 'muzzle') {
      if (!s.muzzles.includes(t.id)) { s.muzzles.push(t.id); fresh = true; }
    } else if (t.kind === 'outfit') {
      if (!s.outfits.includes(t.id)) { s.outfits.push(t.id); fresh = true; }
    }
    if (fresh) got.push(t);
  }
  return got;
}
