// The menu's rotating facts, and the first month's party: on 22 October 2026 every bit
// of text goes rainbow, a "1 month of Souk Siege" splash covers the screen on every
// load (click to clear it), and everyone who plays gets the "1 Month" outfit.

import { WEAPONS } from './weapons.js';
import { OUTFITS, FINISHES, CARTS, GUN_IDS } from './skins.js';
import { MODE_INFO } from './hud.js';
import { locker } from './locker.js';

export const PARTY_DATE = '2026-10-22';
export const PARTY_OUTFIT = 'month1';

// the day, 00:01 to 23:59, on this machine's clock
export function partyNow() {
  const d = new Date();
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (ymd !== PARTY_DATE) return false;
  const m = d.getHours() * 60 + d.getMinutes();
  return m >= 1 && m <= 23 * 60 + 59;
}

const NAMES = { ffa: 'Free for All', tdm: 'Team Deathmatch', koth: 'King of the Hill', bomb: 'Bomb Defusal', royale: 'Souk Royale', derby: 'Derby',
  snipers: 'Snipers', knives: 'Knife Fight', firefight: 'Firefight', oitc: 'One in the Chamber', rush: 'Rush', breakthrough: 'Breakthrough' };

// the facts, built from the game's own numbers and whatever the server has counted
export function buildFacts(live) {
  const W = WEAPONS;
  const shooters = GUN_IDS.filter((g) => g !== 'knife');
  const f = [
    `The Rimah Carbine fires ${W.carbine.rpm} rounds a minute.`,
    `The Saqr .338 takes ${W.sniper.reload} seconds to reload.`,
    `The Barakh LMG carries ${W.lmg.mag} rounds in the box.`,
    `The Hamada 12-gauge throws ${W.shotgun.pellets} pellets a shell.`,
    `The Kabir .50 does ${W.heavy.dmg} damage: one hit, anywhere.`,
    `The Barq PDW is the fastest gun in the souk: ${W.pdw.rpm} rounds a minute.`,
    `The Gatling fires ${W.minigun.rpm} rounds a minute and never reloads.`,
    `A knife to the head or the back kills. Two stabs from the front.`,
    `There are ${OUTFITS.length} outfits to collect.`,
    `${FINISHES.length} finishes, on ${shooters.length} guns: ${FINISHES.length * shooters.length} gun skins.`,
    `${CARTS.length} golf cart skins come out of the Pit Lane Crate.`,
    `${Object.keys(NAMES).length} modes, on five maps and a town twice the size of the rest.`,
    `Souk Royale takes 64 players, and the plane flies at 160 metres.`,
    `The gas in Souk Royale closes six times, down to nothing.`,
    `The helicopter gunner circles at a hundred feet, for 45 seconds.`,
    `The airstrike’s B-2s cross the town at two thousand feet, and the bombs land five seconds after the call.`,
    `Two kills in a life earn the scan, five the airstrike, eight the helicopter.`,
    `Voice chat carries thirty metres, and your killer hears you three times louder.`,
    `In Rush, a bomb takes four seconds to arm and goes off forty seconds later.`,
    `In Breakthrough, outnumber the defenders on a point for 25 seconds and it is yours.`,
    `Attackers get 40 lives a sector. Defenders get as many as they like.`,
    `Aim Training’s farthest target stands 105 metres down the range.`,
    `A molotov burns for 15 seconds and anyone it touches burns for 10 more.`,
    `A frag does up to ${125} damage, seven metres out.`,
    `A grenade launcher round goes off where it lands.`,
    `Four matches in ten on the Old Town, the Dockyard and Ridgeline are played after dark.`,
    `The Derby is twelve golf carts, three frags each, and no getting out.`,
    `A Bazaar Case costs 500 dinars and never gives commons.`,
    `The Interceptor is one golf cart, with one owner, and a Gatling on the roof.`,
    `Souk Siege was launched on 22 September 2026.`,
    'MCB',
  ];
  if (live) {
    const top = (o) => Object.entries(o || {}).sort((a, b) => b[1] - a[1])[0];
    const m = top(live.modes);
    if (m && m[1] > 0) f.push(`The most played mode of all time is ${NAMES[m[0]] || m[0]}, with ${m[1]} ${m[1] === 1 ? 'match' : 'matches'}.`);
    const g = top(live.guns);
    if (g && g[1] > 0 && W[g[0]]) f.push(`The most used gun of all time is the ${W[g[0]].name}, with ${g[1]} kills.`);
    if (live.kills > 0) f.push(`${live.kills} kills have been counted since the counting started.`);
    if (live.accounts > 0) f.push(`${live.accounts} players have an account.`);
  }
  return f;
}

// the ticker under the title: a new fact every few seconds, the "MCB" one rare and alone
export function startFacts(el) {
  let facts = buildFacts(null);
  let i = Math.floor(Math.random() * facts.length);
  fetch('/facts', { cache: 'no-store' }).then((r) => r.json()).then((live) => { facts = buildFacts(live); }).catch(() => {});
  const show = () => {
    i = (i + 1) % facts.length;
    el.classList.add('fade');
    setTimeout(() => {
      el.textContent = facts[i];
      el.classList.toggle('mcb', facts[i] === 'MCB');
      el.classList.remove('fade');
    }, 400);
  };
  el.textContent = facts[i];
  setInterval(show, 6000);
}

// the party: rainbow text all day, the splash on every load, the outfit for guests
export function startParty(onClear) {
  const apply = () => {
    const on = partyNow();
    document.body.classList.toggle('party', on);
    return on;
  };
  const on = apply();
  setInterval(apply, 30000);
  if (!on) return;
  const splash = document.getElementById('party-splash');
  splash.hidden = false;
  splash.addEventListener('click', () => { splash.hidden = true; if (onClear) onClear(); }, { once: true });
  // guests keep their locker in the browser: the gift goes in there
  try {
    if (!locker.signedIn && !localStorage.getItem('souk-month1')) {
      locker.grantOutfit(PARTY_OUTFIT, null);
      localStorage.setItem('souk-month1', '1');
    }
  } catch (e) { /* no storage */ }
}
