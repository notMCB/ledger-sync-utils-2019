// In-game chat: to everyone, or to your team in team modes.

import { input } from './input.js';
import { playerColor } from './avatars.js';
import { esc } from './hud.js';

const $ = (id) => document.getElementById(id);
const SHOW_FOR = 9; // seconds a line stays up when chat is closed

export class Chat {
  constructor(net) {
    this.net = net;
    this.log = $('chat-log');
    this.box = $('chat-entry');
    this.field = $('chat-input');
    this.modeEl = $('chat-mode');
    this.team = false;
    this.isOpen = false;
    this.field.addEventListener('keydown', (e) => {
      // keep the game (and the window-level key handler) out of it
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        this.send();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        this.setTeam(!this.team);
      }
    });
    this.field.addEventListener('keyup', (e) => e.stopPropagation());
    this.field.addEventListener('blur', () => { if (this.isOpen) setTimeout(() => this.isOpen && this.field.focus(), 0); });
  }

  setTeam(team) {
    this.team = team && this.teamAllowed;
    this.modeEl.textContent = this.team ? 'Team' : 'All';
    this.modeEl.classList.toggle('team', this.team);
  }

  open(team) {
    if (this.isOpen) return;
    this.teamAllowed = !!this.canTeam && this.canTeam();
    this.isOpen = true;
    this.setTeam(team);
    this.box.hidden = false;
    this.log.classList.add('open');
    input.setTyping(true);
    this.field.value = '';
    // focus after this key event has finished, so the key isn't typed into the box
    setTimeout(() => this.field.focus(), 0);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.box.hidden = true;
    this.log.classList.remove('open');
    this.field.blur();
    input.setTyping(false);
  }

  send() {
    const text = this.field.value.trim();
    if (text) this.net.send({ t: 'chat', m: text.slice(0, 120), team: this.team });
    this.close();
  }

  add(m, myId) {
    if (m.sys) return this.system(m.m);
    const line = document.createElement('div');
    line.className = 'chat-line' + (m.id === myId ? ' me' : '');
    const col = playerColor(m.id, m.tm);
    line.innerHTML = `${m.team ? '<span class="chat-tag">Team</span>' : ''}<b style="color:${col}">${esc(m.n)}</b> ${esc(m.m)}`;
    line.dataset.t = String(performance.now());
    this.log.appendChild(line);
    while (this.log.children.length > 40) this.log.firstChild.remove();
  }

  system(text) {
    const line = document.createElement('div');
    line.className = 'chat-line sys';
    line.textContent = text;
    line.dataset.t = String(performance.now());
    this.log.appendChild(line);
  }

  update() {
    const now = performance.now();
    for (const line of this.log.children) {
      const age = (now - Number(line.dataset.t)) / 1000;
      line.classList.toggle('old', age > SHOW_FOR);
    }
  }
}
