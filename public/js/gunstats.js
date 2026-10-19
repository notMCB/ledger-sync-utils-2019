// The gun stats page: every gun's numbers with the attachments you have fitted,
// and the attachments themselves, so changing one shows what it does at once.

import { WEAPONS, DAMAGE } from './weapons.js';
import { apply, slotsFor, slotList, ATTACHMENTS } from './attachments.js';
import { locker } from './locker.js';
import { uiBlip } from './audio.js';
import { esc } from './hud.js';

const $ = (id) => document.getElementById(id);

// the order guns are listed in: the loadouts' primaries, then sidearms, then the knife
export const GUN_ORDER = ['smg', 'pdw', 'carbine', 'lmg', 'shotgun', 'flamer', 'sniper', 'heavy', 'pistol', 'revolver', 'knife'];
const SIGHTS = { irons: 'Iron sights', reddot: 'Red dot', holo: 'Holographic', scope: 'Scope', none: '—' };

// everything the page shows about one gun, worked out from its numbers
export function gunStats(id, fitted) {
  const d = apply(WEAPONS[id], fitted || null);
  const dm = d.slug ? DAMAGE.slug : DAMAGE[id];
  const hip = d.base * (d.hip || 1);
  const ads = d.base * d.adsMul;
  const perShot = d.dmg * d.pellets;
  const melee = !!d.melee;
  // shots to put down a 100-health player up close, every pellet landing
  const stk = (mul) => (d.oneShot ? 1 : Math.max(1, Math.ceil(100 / (perShot * mul))));
  const gap = 60 / d.rpm;
  const ttk = (n) => Math.round((n - 1) * gap * 1000);
  const ttkText = (n) => (n <= 1 ? 'one shot' : `${ttk(n)} ms`);
  const falloff = dm.near >= 999 ? 'None' : `Full to ${dm.near} m, ${Math.round(dm.min * 100)}% from ${dm.far} m`;
  return {
    def: d,
    melee,
    rows: [
      { k: 'dmg', label: 'Damage', v: perShot, text: d.pellets > 1 ? `${d.pellets} × ${d.dmg}` : `${d.dmg}`, better: 'high', max: 140 },
      { k: 'head', label: 'Headshot damage', v: melee ? d.dmg : perShot * dm.head, text: melee ? 'A kill' : d.pellets > 1 ? `${d.pellets} × ${Math.round(d.dmg * dm.head)}` : `${Math.round(d.dmg * dm.head)} (×${dm.head})`, better: 'high', max: 240 },
      { k: 'fall', label: 'Damage falloff', v: dm.near >= 999 ? 999 : dm.near, text: falloff, better: 'high', max: 60, nobar: true },
      { k: 'rpm', label: 'Fire rate', v: d.rpm, text: `${d.rpm} rpm`, better: 'high', max: 1100 },
      { k: 'stk', label: 'Shots to kill, close', v: stk(1), text: melee ? (d.blurb || '') : `${stk(1)} body · ${stk(dm.head)} head`, better: 'low', max: 8, nobar: melee },
      { k: 'ttk', label: 'Time to kill, close', v: ttk(stk(1)), text: melee ? '—' : `${ttkText(stk(1))} body · ${ttkText(stk(dm.head))} head`, better: 'low', max: 1500, nobar: melee },
      { k: 'range', label: 'Range', v: d.range, text: `${d.range} m`, better: 'high', max: 400 },
      ...(melee ? [] : [
        { k: 'mag', label: d.flame ? 'Fuel' : 'Magazine', v: d.mag, text: d.flame ? `${d.mag}` : `${d.mag} rounds${d.reserve ? ` · ${d.reserve} spare` : ''}`, better: 'high', max: 150 },
        { k: 'reload', label: 'Reload', v: d.perShell ? d.reload * d.mag : d.reload, text: d.flame ? '—' : d.perShell ? `${d.reload.toFixed(2)} s a shell` : `${d.reload.toFixed(2)} s`, better: 'low', max: 5 },
        { k: 'hip', label: 'Hip-fire spread', v: hip, text: `${hip.toFixed(2)}°`, better: 'low', max: 8 },
        { k: 'ads', label: 'Aimed spread', v: ads, text: `${ads.toFixed(2)}°`, better: 'low', max: 3 },
        { k: 'move', label: 'Spread on the move', v: d.move, text: `+${d.move.toFixed(2)}°`, better: 'low', max: 6 },
        { k: 'bloom', label: 'Bloom a shot', v: d.bloomShot, text: `+${d.bloomShot.toFixed(2)}° · up to ${d.bloomMax.toFixed(1)}°`, better: 'low', max: 5 },
        { k: 'recoil', label: 'Recoil', v: d.recoilUp * 1000, text: `${(d.recoilUp * 1000).toFixed(1)}`, better: 'low', max: 110 },
        { k: 'adsTime', label: 'Aim time', v: d.adsTime, text: `${d.adsTime.toFixed(2)} s`, better: 'low', max: 0.6 },
        { k: 'zoom', label: 'Zoom', v: d.zoom, text: `${d.zoom}× · ${SIGHTS[d.sight] || d.sight}`, better: 'high', max: 8 },
      ]),
      { k: 'speed', label: 'Move speed', v: d.moveMul * 100, text: `${Math.round(d.moveMul * 100)}%`, better: 'high', max: 115 },
    ],
    tags: [d.quiet ? 'Suppressed' : null, d.laser ? `${d.laser === 'red' ? 'Red' : 'Green'} laser` : null, d.slug ? 'Slugs' : null,
      d.auto ? 'Full auto' : d.melee ? null : d.bolt ? 'Bolt action' : 'Semi-auto', d.oneShot ? 'One hit kills' : null].filter(Boolean),
  };
}

let sel = 'smg';
let onClose = null;

function bar(row, base) {
  const pct = Math.max(3, Math.min(100, (row.v / row.max) * 100));
  let diff = '';
  if (base && Math.abs(row.v - base.v) > 1e-6) {
    const better = row.better === 'high' ? row.v > base.v : row.v < base.v;
    const ch = base.v ? Math.round(((row.v - base.v) / base.v) * 100) : 0;
    diff = `<em class="gs-diff ${better ? 'up' : 'down'}">${ch > 0 ? '+' : ''}${ch}%</em>`;
  }
  return `<div class="gs-row"><span class="gs-label">${row.label}</span>` +
    (row.nobar ? '<span class="gs-bar none"></span>' : `<span class="gs-bar"><i style="width:${pct}%"></i>${base && !row.nobar ? `<b style="left:${Math.max(0, Math.min(100, (base.v / row.max) * 100))}%"></b>` : ''}</span>`) +
    `<span class="gs-val">${esc(row.text)}${diff}</span></div>`;
}

function render() {
  const list = $('gs-guns');
  list.innerHTML = '';
  for (const id of GUN_ORDER) {
    const b = document.createElement('button');
    b.className = 'lk-chip' + (id === sel ? ' on' : '');
    b.textContent = WEAPONS[id].short;
    b.addEventListener('click', () => { sel = id; uiBlip(); render(); });
    list.appendChild(b);
  }
  const fitted = ATTACHMENTS[sel] ? locker.attachFor(sel) : null;
  const now = gunStats(sel, fitted);
  const factory = gunStats(sel, null);
  const d = WEAPONS[sel];
  $('gs-name').textContent = d.name;
  $('gs-tags').innerHTML = now.tags.map((t) => `<span>${esc(t)}</span>`).join('');
  $('gs-rows').innerHTML = now.rows.map((r, i) => bar(r, factory.rows[i])).join('');
  $('gs-note').textContent = fitted ? 'The bar is the gun as you have it; the mark on it is the gun out of the box.' : 'No attachments for this one.';
  // the attachments: fit one and the numbers above change
  const host = $('gs-attach');
  host.innerHTML = '';
  if (fitted) {
    const kills = locker.killsWith(sel);
    for (const slot of slotsFor(sel)) {
      const row = document.createElement('div');
      row.className = 'at-row';
      row.innerHTML = `<div class="at-slot">${esc(slot.name)}</div>`;
      const items = document.createElement('div');
      items.className = 'at-items';
      for (const a of slotList(sel, slot.id)) {
        const locked = kills < a.unlock;
        const on = fitted[slot.id] === a.id;
        const b = document.createElement('button');
        b.className = 'at' + (on ? ' on' : '') + (locked ? ' locked' : '');
        b.innerHTML = `<div class="at-name">${esc(a.name)}</div><div class="at-sub">${esc(a.blurb)}</div>` +
          (locked ? `<div class="at-lock">${a.unlock} kills · you have ${kills}</div>` : on ? '<div class="at-on">Fitted</div>' : '');
        b.disabled = locked;
        if (!locked) b.addEventListener('click', () => { locker.setAttach(sel, slot.id, a.id); uiBlip(); render(); if (onClose) onClose.changed(); });
        // hovering an attachment shows what the gun would be with it
        if (!locked && !on) {
          b.addEventListener('mouseenter', () => {
            const trial = gunStats(sel, { ...fitted, [slot.id]: a.id });
            $('gs-rows').innerHTML = trial.rows.map((r, i) => bar(r, now.rows[i])).join('');
            $('gs-note').textContent = `With the ${a.name}: compared with what you have fitted now.`;
          });
          b.addEventListener('mouseleave', () => {
            $('gs-rows').innerHTML = now.rows.map((r, i) => bar(r, factory.rows[i])).join('');
            $('gs-note').textContent = 'The bar is the gun as you have it; the mark on it is the gun out of the box.';
          });
        }
        items.appendChild(b);
      }
      row.appendChild(items);
      host.appendChild(row);
    }
  }
  // every gun side by side, as you have them fitted
  const cols = ['dmg', 'head', 'rpm', 'ttk', 'mag', 'reload', 'hip', 'ads', 'range'];
  const head = ['Gun', 'Damage', 'Headshot', 'Fire rate', 'Time to kill', 'Magazine', 'Reload', 'Hip', 'Aimed', 'Range'];
  const rows = GUN_ORDER.map((id) => {
    const st = gunStats(id, ATTACHMENTS[id] ? locker.attachFor(id) : null);
    const by = Object.fromEntries(st.rows.map((r) => [r.k, r]));
    const cell = (k) => {
      const r = by[k];
      if (!r) return '—';
      if (k === 'ttk') return st.melee ? '—' : r.v === 0 ? 'one shot' : `${r.v} ms`;
      if (k === 'head') return st.melee ? 'Kill' : `${Math.round(r.v)}`;
      if (k === 'mag') return `${r.v}`;
      if (k === 'reload') return st.def.flame ? '—' : st.def.perShell ? `${st.def.reload.toFixed(2)}/shell` : `${r.v.toFixed(1)} s`;
      if (k === 'hip' || k === 'ads') return `${r.v.toFixed(2)}°`;
      if (k === 'rpm') return `${r.v}`;
      return r.text;
    };
    return `<tr class="${id === sel ? 'on' : ''}" data-gun="${id}"><th>${esc(WEAPONS[id].name)}</th>${cols.map((k) => `<td>${esc(cell(k))}</td>`).join('')}</tr>`;
  }).join('');
  $('gs-table').innerHTML = `<thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody>`;
  $('gs-table').querySelectorAll('tbody tr').forEach((tr) => tr.addEventListener('click', () => { sel = tr.dataset.gun; uiBlip(); render(); $('gunstats').querySelector('.gs-detail').scrollIntoView({ block: 'nearest' }); }));
}

export function openGunStats(gun, hooks) {
  if (gun && WEAPONS[gun]) sel = gun;
  onClose = hooks || null;
  render();
  $('gunstats').hidden = false;
}

export function gunStatsOpen() {
  return !$('gunstats').hidden;
}

$('gs-close').addEventListener('click', () => {
  $('gunstats').hidden = true;
  if (onClose && onClose.closed) onClose.closed();
});
locker.onChange(() => { if (!$('gunstats').hidden) render(); });
