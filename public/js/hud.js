// The heads-up display: DOM elements over the canvas.

import { TEAM_COLORS, TEAM_NAMES, playerColor } from './avatars.js';
import { WEAPONS } from './weapons.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const MODE_INFO = {
  tdm: { name: 'Team Deathmatch', short: 'TDM', desc: 'Sand against Sky, 4 on 4. First team to 50 kills.' },
  ffa: { name: 'Free for All', short: 'FFA', desc: 'Everyone for themselves. First to 25 kills.' },
  koth: { name: 'King of the Hill', short: 'KOTH', desc: 'Hold the marked ground alone to score. It moves every 75 seconds. First to 150.' },
  bomb: { name: 'Bomb Defusal', short: 'Bomb', desc: 'Attackers plant at A or B, defenders stop them. One life per round, first to 7 rounds.' },
  range: { name: 'Aim Training', short: 'Range', desc: 'Just you, a bunker under the souk and steel targets from 10 to 105 m. Works offline.' },
  niche: { name: 'Niche Modes', short: 'Niche', desc: 'Snipers, Knife Fight, Firefight and One in the Chamber. Everyone for themselves.' },
  snipers: { name: 'Snipers', short: 'Snipers', desc: 'The Kabir .50 and nothing else. One shot, one kill. First to 20.' },
  knives: { name: 'Knife Fight', short: 'Knives', desc: 'Knives only. A stab to the head or the back kills. First to 25.' },
  firefight: { name: 'Firefight', short: 'Fire', desc: 'Flamethrowers and molotovs only. First to 25.' },
  oitc: { name: 'One in the Chamber', short: 'OITC', desc: 'A pistol with one round, a knife, three lives. A hit kills and gives you another round; a miss leaves you the knife. Most kills wins.' },
};
export const TEAM_MODES = ['tdm', 'koth', 'bomb'];
export const NICHE_MODES = ['snipers', 'knives', 'firefight', 'oitc'];
export const isTeamMode = (mode) => TEAM_MODES.includes(mode);

function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class Hud {
  constructor() {
    this.el = $('hud');
    this.ch = $('crosshair');
    this.chParts = [...this.ch.querySelectorAll('.ch')];
    this.hm = $('hitmarker');
    this.hmT = 0;
    this.vig = $('vignette');
    this.vigA = 0;
    this.feed = $('killfeed');
    this.centerT = 0;
    this.centerPrio = 0;
    this.dirs = [];
    this.mm = $('minimap');
    this.mmg = this.mm.getContext('2d');
    this.fm = $('fullmap');
    this.fmc = $('fullmap-canvas');
    this.fmg = this.fmc.getContext('2d');
    this.mmBase = null;
    this.markerEls = new Map();
    this.lastTop = '';
    this.lastAmmo = '';
  }

  show(on) {
    this.el.hidden = !on;
  }

  setHP(hp) {
    $('hp-num').textContent = Math.max(0, Math.round(hp));
    const bar = $('hp-bar');
    bar.style.width = Math.max(0, Math.min(100, hp)) + '%';
    bar.classList.toggle('low', hp <= 35);
  }

  setTeamLabel(text, color) {
    const el = $('team-label');
    el.textContent = text;
    el.style.color = color || '';
  }

  setAmmo(ws, nades, maxNades, reloadKey) {
    const key = `${ws.id}|${ws.mag}|${ws.reserve}|${nades}|${maxNades}|${ws.reloading}`;
    if (key === this.lastAmmo) return;
    this.lastAmmo = key;
    const m = $('ammo-mag');
    const melee = !!ws.def.melee;
    m.textContent = melee ? '—' : ws.def.flame ? `${Math.ceil(ws.mag)}%` : ws.mag;
    document.querySelector('.ammo .sep').style.visibility = melee ? 'hidden' : '';
    m.classList.toggle('low', !melee && ws.mag <= Math.ceil(ws.def.mag * 0.25));
    $('ammo-res').textContent = melee ? '' : ws.reserve;
    $('weapon-name').textContent = ws.reloading ? 'Reloading…' : ws.def.name;
    $('nades').innerHTML = Array.from({ length: maxNades }, (_, i) => `<i class="${i < nades ? '' : 'used'}"></i>`).join('');
    $('reload-hint').hidden = !(!ws.def.melee && ws.mag === 0 && !ws.reloading && ws.reserve > 0);
    $('reload-key').textContent = reloadKey;
  }

  setPerk(name, left, key, nade) {
    const k = `${name}|${left}|${key}|${nade}`;
    if (k === this.lastPerk) return;
    this.lastPerk = k;
    $('perk').innerHTML = `<span class="pk-key">${esc(key)}</span> ${esc(name)} <b>×${left}</b><span class="pk-nade">${esc(nade)}</span>`;
    $('perk').classList.toggle('spent', left <= 0);
  }

  // flying the bomb drone: a battery bar and the controls
  droneOverlay(on, frac = 1, controls = []) {
    const el = $('drone');
    if (!on) {
      if (!el.hidden) el.hidden = true;
      return;
    }
    el.hidden = false;
    const bar = $('drone-bat');
    bar.style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
    bar.classList.toggle('low', frac < 0.25);
    const hint = controls.join('\n');
    if (this.droneHint !== hint) {
      this.droneHint = hint;
      $('drone-hint').innerHTML = controls.map((c) => {
        const i = c.indexOf('  ');
        return `<div><b>${esc(c.slice(0, i))}</b><span>${esc(c.slice(i + 2))}</span></div>`;
      }).join('');
    }
  }

  crosshair(gapPx, visible, enemy, style = 'lines') {
    this.ch.style.display = visible ? '' : 'none';
    if (!visible) return;
    const g = Math.round(Math.max(3, Math.min(160, gapPx)));
    const [t, b, l, r] = this.chParts;
    t.style.top = `${-g - 9}px`;
    b.style.top = `${g}px`;
    l.style.left = `${-g - 9}px`;
    r.style.left = `${g}px`;
    this.ch.classList.toggle('enemy', enemy);
    // a ring with a dot for the spread guns: its radius is the spread
    this.ch.classList.toggle('circle', style === 'circle');
    if (style === 'circle') {
      const ring = this.ch.querySelector('.ring');
      const d = g * 2 + 8;
      ring.style.width = ring.style.height = `${d}px`;
      ring.style.left = ring.style.top = `${-d / 2}px`;
    }
  }

  // being on fire: the edges of the screen glow
  burn(k) {
    const el = $('burn');
    const o = Math.max(0, Math.min(1, k)).toFixed(2);
    if (el.style.opacity !== o) el.style.opacity = o;
  }

  hit(kill, head, blocked) {
    this.hm.classList.remove('kill', 'head', 'blocked');
    if (blocked) this.hm.classList.add('blocked');
    else if (kill) this.hm.classList.add('kill');
    else if (head) this.hm.classList.add('head');
    this.hm.classList.add('show');
    this.hmT = kill ? 0.35 : 0.14;
  }

  hurt(amount, angle) {
    this.vigA = Math.min(0.9, this.vigA + amount / 60);
    if (angle === null || angle === undefined) return;
    const d = document.createElement('div');
    d.className = 'dmgdir';
    d.style.transform = `rotate(${angle}rad)`;
    $('dmgdirs').appendChild(d);
    this.dirs.push({ d, t: 1.2 });
  }

  feedKill(ev, myId) {
    const row = document.createElement('div');
    row.className = 'kf' + (ev.k === myId || ev.v === myId ? ' me' : '');
    const names = { nade: 'grenade', bomb: 'bomb', forklift: 'roadkill', fire: 'fire', molotov: 'molotov', tknife: 'throwing knife' };
    const wname = names[ev.w] || (WEAPONS[ev.w] ? WEAPONS[ev.w].short : ev.w);
    const kc = ev.kc || '#fff', vc = ev.vc || '#fff';
    if (ev.k && ev.k !== ev.v) {
      const helpers = ev.as && ev.as.length ? `<span class="as" style="color:${kc}">+ ${esc(ev.as.join(', '))}</span>` : '';
      row.innerHTML = `<span style="color:${kc}">${esc(ev.kn)}</span>${helpers}<span class="w">${esc(wname)}</span>${ev.hs ? '<span class="hs">HEAD</span>' : ''}<span style="color:${vc}">${esc(ev.vn)}</span>`;
    } else {
      row.innerHTML = `<span style="color:${vc}">${esc(ev.vn)}</span><span class="w">${esc(ev.w === 'bomb' ? 'bomb' : 'self')}</span>`;
    }
    this.feedAdd(row);
  }

  feedText(text) {
    const row = document.createElement('div');
    row.className = 'kf';
    row.innerHTML = `<span class="w" style="font-size:13px;text-transform:none;color:var(--plaster)">${esc(text)}</span>`;
    this.feedAdd(row);
  }

  feedAdd(row) {
    this.feed.prepend(row);
    while (this.feed.children.length > 6) this.feed.lastChild.remove();
    setTimeout(() => row.remove(), 7000);
  }

  center(big, small = '', cls = '', dur = 3, prio = 1) {
    if (this.centerT > 0 && prio < this.centerPrio) return;
    const b = $('center-big');
    b.textContent = big;
    b.className = cls;
    $('center-small').textContent = small;
    this.centerT = dur;
    this.centerPrio = prio;
  }

  // a message that holds while a condition lasts (waiting, countdown)
  holdCenter(big, small = '', cls = '') {
    if (this.centerT > 0 && this.centerPrio > 0) return;
    const b = $('center-big');
    if (b.textContent !== big) b.textContent = big;
    b.className = cls;
    $('center-small').textContent = small;
    this.centerPrio = 0;
    this.centerT = 0.1;
  }

  prompt(text, progress) {
    const p = $('prompt');
    if (!text) {
      p.hidden = true;
      return;
    }
    p.hidden = false;
    $('prompt-text').textContent = text;
    $('prompt-bar').style.width = `${Math.round((progress || 0) * 100)}%`;
    p.querySelector('.bar').style.visibility = progress === undefined ? 'hidden' : 'visible';
  }

  scope(on, reticle = 'cross') {
    $('scope').hidden = !on;
    $('scope').classList.toggle('tri', reticle === 'tri');
  }

  top(g, myTeam, myId, roster, localTime) {
    if (!g) return;
    let html = '';
    const mode = g.mode;
    const ph = g.ph;
    const tl = g.tl !== undefined ? g.tl : 0;
    let sub = '';
    if (ph === 'waiting') sub = 'Warm-up';
    else if (ph === 'countdown') sub = 'Starting';
    else if (ph === 'freeze') sub = 'Get ready';
    else if (ph === 'post') sub = 'Round over';
    else if (ph === 'ended') sub = 'Match over';
    else if (mode === 'bomb') sub = `Round ${g.rd}`;
    else sub = MODE_INFO[mode].short;
    let timeText = ph === 'waiting' ? `${g.n}/2` : fmtTime(tl);
    let hot = false;
    if (mode === 'bomb' && g.b && g.b.s === 'planted') {
      timeText = fmtTime(g.b.ex);
      sub = `Bomb at ${g.b.site}`;
      hot = true;
    }
    const mid = `<div class="tb-mid"><div class="time${hot ? ' hot' : ''}">${timeText}</div><div class="sub">${sub}</div></div>`;
    if (!isTeamMode(mode)) {
      const sorted = [...roster.values()].sort((a, b) => b.k - a.k);
      const me = roster.get(myId);
      const lead = sorted[0];
      const mine = me ? me.k : 0;
      const other = lead && lead.id !== myId ? lead : sorted[1];
      html = `<div class="tb-team" style="box-shadow:inset 0 -3px 0 ${playerColor(myId, -1)}"><div class="n">${mine}</div><div class="l">You</div></div>${mid}` +
        `<div class="tb-team" style="box-shadow:inset 0 -3px 0 ${other ? playerColor(other.id, -1) : '#666'}"><div class="n">${other ? other.k : 0}</div><div class="l">${other ? esc(other.n).slice(0, 10) : '—'}</div></div>`;
    } else {
      const sc = g.sc || [0, 0];
      const lab = (i) => {
        if (mode === 'bomb' && g.att !== undefined) return i === g.att ? 'Attack' : 'Defend';
        return TEAM_NAMES[i];
      };
      html = `<div class="tb-team sand${myTeam === 0 ? ' mine' : ''}"><div class="n">${sc[0]}</div><div class="l">${lab(0)}</div></div>${mid}` +
        `<div class="tb-team sky${myTeam === 1 ? ' mine' : ''}"><div class="n">${sc[1]}</div><div class="l">${lab(1)}</div></div>`;
    }
    if (html !== this.lastTop) {
      $('topbar').innerHTML = html;
      this.lastTop = html;
    }
  }

  // the firing range's scoreboard
  rangeTop(s) {
    const acc = s.shots ? Math.round((s.hits / s.shots) * 100) : 0;
    const cell = (n, l) => `<div class="tb-team"><div class="n">${n}</div><div class="l">${l}</div></div>`;
    const html = cell(s.hits, 'Hits') + cell(`${acc}%`, 'Accuracy') + `<div class="tb-mid"><div class="time">${s.streak}</div><div class="sub">Streak · best ${s.bestStreak}</div></div>` +
      cell(s.heads, 'Headshots') + cell(`${s.best}m`, 'Longest');
    if (html !== this.lastTop) {
      $('topbar').innerHTML = html;
      this.lastTop = html;
    }
  }

  // objective markers projected to the screen: [{key, x, y, cls, label, dist}]
  markers(list) {
    const host = $('markers');
    const seen = new Set();
    for (const m of list) {
      seen.add(m.key);
      let el = this.markerEls.get(m.key);
      if (!el) {
        el = document.createElement('div');
        el.innerHTML = '<div class="ic"></div><div class="dist"></div>';
        host.appendChild(el);
        this.markerEls.set(m.key, el);
      }
      el.className = 'mk ' + m.cls;
      el.style.left = m.x + 'px';
      el.style.top = m.y + 'px';
      const ic = el.firstChild;
      if (ic.textContent !== m.label) ic.textContent = m.label;
      el.lastChild.textContent = m.dist ? `${Math.round(m.dist)}m` : '';
    }
    for (const [k, el] of this.markerEls) {
      if (!seen.has(k)) {
        el.remove();
        this.markerEls.delete(k);
      }
    }
  }

  // -- minimap --

  buildMinimap(world, map) {
    const S = 400;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const [bx, bz] = map.bounds;
    const scale = (S - 8) / (Math.max(bx, bz) * 2);
    this.mmScale = scale;
    this.mmS = S;
    const theme = map.theme || 'sand';
    g.fillStyle = theme === 'snow' ? 'rgba(226, 232, 240, 0.55)' : theme === 'concrete' ? 'rgba(125, 126, 130, 0.5)' : 'rgba(201, 168, 119, 0.35)';
    g.fillRect(S / 2 - bx * scale, S / 2 - bz * scale, bx * 2 * scale, bz * 2 * scale);
    // rock terrain: the ridge and its terraces, or stepped ground shaded by height
    for (const f of world.terrain()) {
      const t = Math.max(0, Math.min(1, (f.h - 1) / 8));
      g.fillStyle = theme === 'snow' ? `rgba(${Math.round(150 + 90 * t)}, ${Math.round(156 + 88 * t)}, ${Math.round(166 + 84 * t)}, 0.95)` : 'rgba(150, 148, 144, 0.9)';
      g.save();
      g.translate(S / 2 + f.x * scale, S / 2 + f.z * scale);
      g.rotate(-f.yaw);
      g.fillRect(-f.hx * scale, -f.hz * scale, f.hx * 2 * scale, f.hz * 2 * scale);
      g.restore();
    }
    const draw = (list, fill) => {
      g.fillStyle = fill;
      for (const f of list) {
        g.save();
        g.translate(S / 2 + f.x * scale, S / 2 + f.z * scale);
        g.rotate(-f.yaw);
        g.fillRect(-f.hx * scale, -f.hz * scale, f.hx * 2 * scale, f.hz * 2 * scale);
        g.restore();
      }
    };
    // dirt roads under everything
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const d of map.deco) {
      if (d.k !== 'road') continue;
      g.strokeStyle = d.c === 'asphalt' ? 'rgba(70, 71, 75, 0.9)' : d.c === 'snow' ? 'rgba(190, 198, 206, 0.95)' : 'rgba(140, 105, 62, 0.85)';
      g.lineWidth = Math.max(3, d.w * scale);
      g.beginPath();
      d.pts.forEach(([x, z], i) => (i ? g.lineTo(S / 2 + x * scale, S / 2 + z * scale) : g.moveTo(S / 2 + x * scale, S / 2 + z * scale)));
      g.stroke();
    }
    for (const d of map.deco) {
      if (d.k === 'pond') {
        g.fillStyle = 'rgba(60, 140, 160, 0.9)';
        g.beginPath();
        g.arc(S / 2 + d.x * scale, S / 2 + d.z * scale, d.r * scale, 0, Math.PI * 2);
        g.fill();
      }
    }
    // the tunnels, faint, under everything else
    const tun = map.tunnels;
    if (tun && tun.pits) {
      g.fillStyle = 'rgba(70, 58, 44, 0.55)';
      for (const [x0, z0, x1, z1] of tun.pits) {
        g.fillRect(S / 2 + x0 * scale, S / 2 + z0 * scale, (x1 - x0) * scale, (z1 - z0) * scale);
      }
    }
    const fp = world.footprints();
    draw(fp.filter((f) => f.h < 4), 'rgba(239, 228, 207, 0.75)');
    draw(fp.filter((f) => f.h >= 4), 'rgba(255, 246, 228, 0.95)');
    draw(world.props(), 'rgba(90, 70, 45, 0.7)');
    g.strokeStyle = 'rgba(239,228,207,0.5)';
    g.lineWidth = 2;
    g.strokeRect(S / 2 - bx * scale, S / 2 - bz * scale, bx * 2 * scale, bz * 2 * scale);
    // hatches on top, so you can find the way down
    if (tun && tun.hatches) {
      for (const [x, z] of tun.hatches) {
        const px = S / 2 + x * scale, pz = S / 2 + z * scale;
        g.beginPath();
        g.arc(px, pz, 4, 0, Math.PI * 2);
        g.fillStyle = '#2a2018';
        g.fill();
        g.strokeStyle = '#d8b56a';
        g.lineWidth = 1.5;
        g.stroke();
      }
    }
    this.mmBase = c;
    this.areas = map.areas || [];
    this.areaName = '';
  }

  // the name of wherever you're standing, under the minimap
  area(x, z) {
    let name = '';
    let best = 1e9;
    for (const a of this.areas) {
      const d = Math.hypot(x - a.x, z - a.z);
      if (d < a.r && d < best) {
        best = d;
        name = a.n;
      }
    }
    if (name === this.areaName) return;
    this.areaName = name;
    const el = $('area');
    el.textContent = name;
    el.classList.toggle('on', !!name);
  }

  minimap(me, others, objectives) {
    const g = this.mmg;
    const W = this.mm.width;
    g.clearRect(0, 0, W, W);
    if (!this.mmBase || !me) return;
    // centred on the player, rotated so up is where they face
    const zoom = 2.2;
    const sc = this.mmScale * zoom * (W / this.mmS);
    g.save();
    g.beginPath();
    g.rect(0, 0, W, W);
    g.clip();
    g.translate(W / 2, W / 2);
    g.rotate(me.yaw);
    g.scale(zoom * (W / this.mmS), zoom * (W / this.mmS));
    g.translate(-this.mmS / 2 - me.x * this.mmScale, -this.mmS / 2 - me.z * this.mmScale);
    g.drawImage(this.mmBase, 0, 0);
    g.restore();
    const toMap = (x, z) => {
      const dx = (x - me.x) * sc, dz = (z - me.z) * sc;
      const c = Math.cos(me.yaw), s = Math.sin(me.yaw);
      return [W / 2 + dx * c - dz * s, W / 2 + dx * s + dz * c];
    };
    for (const o of objectives) {
      let [x, y] = toMap(o.x, o.z);
      const clampR = W / 2 - 10;
      const dx = x - W / 2, dy = y - W / 2;
      const d = Math.hypot(dx, dy);
      if (d > clampR) { x = W / 2 + (dx / d) * clampR; y = W / 2 + (dy / d) * clampR; }
      if (o.r) {
        g.beginPath();
        g.arc(x, y, Math.max(4, o.r * sc), 0, Math.PI * 2);
        g.fillStyle = o.fill || 'rgba(255,255,255,0.18)';
        g.fill();
        g.strokeStyle = o.color;
        g.lineWidth = 2;
        g.stroke();
        if (o.sweep !== undefined) {
          // a beacon's pulse sweeping out across its circle
          g.beginPath();
          g.arc(x, y, Math.max(2, o.r * sc * o.sweep), 0, Math.PI * 2);
          g.strokeStyle = `rgba(255, 120, 100, ${(1 - o.sweep) * 0.9})`;
          g.lineWidth = 3;
          g.stroke();
        }
      }
      if (o.label) {
        g.fillStyle = o.color;
        g.font = '700 13px "Reem Kufi", sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(o.label, x, y);
      }
      if (o.dot) {
        g.beginPath();
        g.arc(x, y, 4, 0, Math.PI * 2);
        g.fillStyle = o.color;
        g.fill();
      }
    }
    for (const o of others) {
      const [x, y] = toMap(o.x, o.z);
      if (x < 0 || y < 0 || x > W || y > W) continue;
      g.beginPath();
      g.arc(x, y, 3.5, 0, Math.PI * 2);
      g.fillStyle = o.color;
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.lineWidth = 1;
      g.stroke();
    }
    // me
    g.save();
    g.translate(W / 2, W / 2);
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(0, -7); g.lineTo(5, 5); g.lineTo(0, 2); g.lineTo(-5, 5);
    g.closePath();
    g.fill();
    g.restore();
  }

  // -- the whole map, opened with M --

  fullmap(show, me, others, objectives, mapKey) {
    if (this.fm.hidden === !show && !show) return;
    this.fm.hidden = !show;
    if (!show || !this.mmBase || !me) return;
    const g = this.fmg;
    const W = this.fmc.width;
    g.clearRect(0, 0, W, W);
    const S = this.mmS;
    const k = W / S;                       // the whole town, north up, filling the canvas
    g.drawImage(this.mmBase, 0, 0, S, S, 0, 0, W, W);
    const toMap = (x, z) => [W / 2 + x * this.mmScale * k, W / 2 + z * this.mmScale * k];
    for (const o of objectives) {
      const [x, y] = toMap(o.x, o.z);
      if (o.r) {
        g.beginPath();
        g.arc(x, y, Math.max(6, o.r * this.mmScale * k), 0, Math.PI * 2);
        g.fillStyle = o.fill || 'rgba(255,255,255,0.14)';
        g.fill();
        g.strokeStyle = o.color;
        g.lineWidth = 2;
        g.stroke();
      }
      if (o.label) {
        g.fillStyle = o.color;
        g.font = '700 22px "Reem Kufi", sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(o.label, x, y);
      }
      if (o.dot) {
        g.beginPath();
        g.arc(x, y, 7, 0, Math.PI * 2);
        g.fillStyle = o.color;
        g.fill();
      }
    }
    // where everything is called
    g.font = '600 15px "Reem Kufi", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const a of this.areas) {
      const [x, y] = toMap(a.x, a.z);
      g.fillStyle = 'rgba(20, 24, 32, 0.55)';
      g.fillText(a.n, x + 1, y + 1);
      g.fillStyle = 'rgba(239, 228, 207, 0.85)';
      g.fillText(a.n, x, y);
    }
    for (const o of others) {
      const [x, y] = toMap(o.x, o.z);
      g.beginPath();
      g.arc(x, y, 6, 0, Math.PI * 2);
      g.fillStyle = o.color;
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.lineWidth = 1.5;
      g.stroke();
    }
    const [mx, my] = toMap(me.x, me.z);
    g.save();
    g.translate(mx, my);
    // north is up and forward is -z, so a yaw of zero points straight up
    g.rotate(-me.yaw);
    g.fillStyle = '#fff';
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, -12); g.lineTo(8, 8); g.lineTo(0, 3); g.lineTo(-8, 8);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
    if (mapKey !== this.mapKeyShown) {
      this.mapKeyShown = mapKey;
      $('fullmap-hint').textContent = `${mapKey} to close`;
    }
  }

  // -- scoreboard --

  scoreboard(show, roster, g, myId, alive, roomName) {
    const el = $('scoreboard');
    el.hidden = !show;
    if (!show || !g) return;
    const mode = g.mode;
    const rows = (list) => list.map((p) => `<tr class="${p.id === myId ? 'me' : ''} ${alive(p.id) ? '' : 'dead'}">` +
      `<td><span class="swatch" style="background:${playerColor(p.id, p.tm)}"></span>${esc(p.n)}</td>` +
      `<td>${p.k}</td><td>${p.a || 0}</td><td>${p.d}</td><td>${p.s}</td><td>${p.ping}</td></tr>`).join('');
    const head = '<tr><th>Player</th><th>Kills</th><th>Assists</th><th>Deaths</th><th>Score</th><th>Ping</th></tr>';
    const all = [...roster.values()];
    let body = '';
    if (!isTeamMode(mode)) {
      all.sort((a, b) => b.k - a.k || a.d - b.d);
      body = `<table class="sb-table">${head}${rows(all)}</table>`;
    } else {
      const sc = g.sc || [0, 0];
      for (const t of [0, 1]) {
        const list = all.filter((p) => p.tm === t).sort((a, b) => b.s - a.s);
        const role = mode === 'bomb' && g.att !== undefined ? (t === g.att ? ' · attacking' : ' · defending') : '';
        body += `<div class="sb-team ${t ? 'sky' : 'sand'}"><span>${TEAM_NAMES[t]}${role}</span><span>${sc[t]}</span></div>` +
          `<table class="sb-table">${head}${rows(list)}</table>`;
      }
    }
    el.innerHTML = `<div class="sb-head"><h3>${esc(roomName || MODE_INFO[mode].name)}</h3><span>${all.length}/${(g && g.max) || 20} players</span></div>${body}`;
  }

  // dinars earned, floating up by the ammo counter
  earn(n, why) {
    const labels = { kill: 'Kill', assist: 'Kill assist', supply: 'Teammate used your crate', shotdown: 'Drone shot down', plant: 'Bomb planted', defuse: 'Bomb defused', round: 'Round won', match: 'Match played', win: 'Match won', hill: 'Holding the hill' };
    const el = document.createElement('div');
    el.className = 'earn-pop';
    el.innerHTML = `<b>+${n}</b> dinars <span>${esc(labels[why] || '')}</span>`;
    $('earns').appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  update(dt) {
    if (this.hmT > 0) {
      this.hmT -= dt;
      if (this.hmT <= 0) this.hm.classList.remove('show');
    }
    this.vigA = Math.max(0, this.vigA - dt * 0.8);
    this.vig.style.opacity = this.vigA.toFixed(3);
    for (let i = this.dirs.length - 1; i >= 0; i--) {
      const d = this.dirs[i];
      d.t -= dt;
      d.d.style.opacity = Math.max(0, d.t / 1.2).toFixed(2);
      if (d.t <= 0) {
        d.d.remove();
        this.dirs.splice(i, 1);
      }
    }
    if (this.centerT > 0) {
      this.centerT -= dt;
      if (this.centerT <= 0) {
        $('center-big').textContent = '';
        $('center-small').textContent = '';
        this.centerPrio = 0;
      }
    }
  }
}

export { TEAM_COLORS, TEAM_NAMES, esc, fmtTime };
