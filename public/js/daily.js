// Daily challenges: the words for each one, from what the server sends.
import { WEAPONS } from './weapons.js';
import { MODE_INFO } from './hud.js';

export function dailyText(c) {
  const n = c.n;
  const gun = c.gun && WEAPONS[c.gun] ? WEAPONS[c.gun].name : 'gun';
  const mode = c.mode && MODE_INFO[c.mode] ? MODE_INFO[c.mode].name : 'a mode';
  switch (c.kind) {
    case 'kills': return `Get ${n} kills`;
    case 'gunkills': return `Get ${n} kills with the ${gun}`;
    case 'head': return `Land ${n} headshots`;
    case 'wins': return n === 1 ? 'Win a match' : `Win ${n} matches`;
    case 'matches': return `Finish ${n} matches`;
    case 'modematches': return n === 1 ? `Finish a match of ${mode}` : `Finish ${n} matches of ${mode}`;
    case 'nade': return `Get ${n} grenade kills`;
    case 'knife': return n === 1 ? 'Get a knife kill' : `Get ${n} knife kills`;
    case 'assists': return `Get ${n} kill assists`;
    case 'streak': return `Get ${n} kills in one life`;
    case 'long': return `Get a kill from ${n} metres or more`;
    default: return c.kind;
  }
}
