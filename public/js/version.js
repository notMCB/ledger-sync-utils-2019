// The version shown in the game, and the notes shown every time the page loads.
// Every release bumps VERSION (keep server/server.py in step) and adds an entry
// at the top of PATCH_NOTES, written for players.

export const VERSION = '2.0.0';

export const PATCH_NOTES = [
  {
    version: '2.0.0',
    date: 'Coming soon',
    title: 'Loadouts, the Locker and accounts',
    notes: [
      'Accounts: create one with a username, email and password to keep your dinars, skins and loadouts on any computer. What you unlocked as a guest comes with you.',
      'Chat: press Enter to talk to everyone, or Y for just your team.',
      'Slide: crouch while running to slide. Jump out of a slide to keep your speed.',
      'Vault: jump at a window, crate or low wall to climb over it — in and out of buildings, even from upstairs.',
      'Perks, one per loadout (press X): Assault gets an Ammo Kit, Support a Medical Kit, Breacher a Breaching Ladder for high windows, Marksman a Recon Beacon that reveals nearby enemies.',
      'Breacher can swap frag grenades for flashbangs in the Locker.',
      'The SMG now has a red dot. The LMG has a 2× holographic sight with a circle-and-dot reticle.',
      'Kills pay 50 dinars (+10 for a headshot).',
      'The Locker: set up each loadout — gun skin, pistol skin, perk and grenade — and your outfit. Open Armory and Wardrobe Crates for 100 dinars, or the new Bazaar Case for 500: bright, colourful skins and outfits with no commons.',
      'Other players see your outfit and gun skins. Your vest keeps your team colour so sides stay easy to tell apart.',
      'Aim Training: a solo firing range in a bunker under the souk, with steel targets from 10 to 105 m — some of them moving. Works even offline.',
      'The town: dirt roads run through it, there are open areas, and every map has landmarks — The Oasis, Clock Tower, Water Tower, The Ruins, Tank Wreck, Grand Bazaar, Old Well Square or Camel Yard. The name of where you are shows under the minimap.',
      'Two-storey buildings can have balconies.',
      'The Breacher’s ladder now reaches one storey: upstairs windows, balconies, or the roof of a single-storey building.',
      'Jump onto crates and over low walls more easily.',
      'Spawns in Team Deathmatch, King of the Hill and Free for All are now anywhere in town, away from enemies.',
      'The Marksman’s rifle has a suppressor, and the Marksman and Breacher carry a suppressed pistol — the same pistol, stats and skins as everyone else’s. Suppressed shots are quiet, barely flash, and don’t show you on enemy minimaps.',
      'Assault carries three grenades; everyone else two. The Ammo Kit refills bullets but not grenades.',
      'Spare ammo is halved for every gun (magazines are unchanged).',
      'You can tell loadouts apart at a glance: Assault wears an ammo pouch, Support a medical pouch, the Breacher carries a ladder on their back and the Marksman wears a ghillie hood.',
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
