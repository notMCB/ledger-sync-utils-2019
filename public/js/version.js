// The version shown in the game, and the notes shown every time the page loads.
// Every release bumps VERSION (keep server/server.py in step) and adds an entry
// at the top of PATCH_NOTES, written for players.

export const VERSION = '2.0.0';

export const PATCH_NOTES = [
  {
    version: '2.0.0',
    date: 'Coming soon',
    title: 'The Locker',
    notes: [
      'New: the Locker. Open Armory Crates for gun finishes and Wardrobe Crates for outfits, each for 100 dinars.',
      '17 gun finishes for every gun — 85 skins to collect — from Common Sandblast up to Legendary Gilded and the shifting Mirage.',
      '13 outfits with their own headgear: wraps, helmets, berets and hoods, up to the Legendary Golden Sultan.',
      'Earn dinars by playing: 10 a kill (+5 for a headshot), 20 for a bomb plant, 25 for a defuse, 15 a round win, 25 for finishing a match and 50 more for winning it. Holding the hill pays too.',
      'Everyone starts with 300 dinars. A duplicate gives some dinars back.',
      'Other players see your outfit and gun finish. Your vest keeps your team colour so sides stay easy to tell apart.',
      'Your locker is saved in this browser.',
    ],
  },
  {
    version: '1.1.0',
    date: '22 September 2026',
    title: 'Steadier aim',
    notes: [
      'Hold F to aim down sights. Holding it stops you running straight away, so you can go from a sprint to aiming without letting go of Shift.',
      'The two-finger click still toggles aim on and off, as before.',
      'The Saqr .338 sniper now has a 6× scope, up from 3×.',
    ],
  },
  {
    version: '1.0.0',
    date: '22 September 2026',
    title: 'Launch',
    notes: [
      'Four modes: Team Deathmatch, Free for All, King of the Hill and Bomb Defusal.',
      'Up to 8 players a match. Team modes are 4 against 4, and every match needs at least 2 players to start — until then you can warm up.',
      'A new walled desert town is built for every match: winding streets, market stalls, domes and a minaret. Every building can be entered, some have an upstairs, and bullets stop at the walls.',
      'Four loadouts — SMG, LMG, Shotgun and Sniper — each with the same pistol and two grenades.',
      'Every gun fires visible tracers with muzzle flash and recoil, and spread grows the longer you hold the trigger.',
      'Aim down sights on every gun: iron sights on the SMG, Shotgun and pistol, a red dot on the LMG and a 3× scope on the Sniper.',
      'Full reload animations for every weapon.',
      'Rebind every key in Settings, including jump, crouch and run — every action takes two bindings.',
      'Built for trackpads: two-finger click (or F) toggles aim, a two-finger scroll switches weapons once per swipe, look speed starts higher, and optional aim help slows your turn over an enemy.',
    ],
  },
];
