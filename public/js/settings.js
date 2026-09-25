// Player settings and key bindings, kept in localStorage.

export const ACTIONS = [
  { id: 'forward', label: 'Move forward', key: 'KeyW', group: 'Movement' },
  { id: 'back', label: 'Move back', key: 'KeyS', group: 'Movement' },
  { id: 'left', label: 'Strafe left', key: 'KeyA', group: 'Movement' },
  { id: 'right', label: 'Strafe right', key: 'KeyD', group: 'Movement' },
  { id: 'jump', label: 'Jump', key: 'Space', group: 'Movement' },
  { id: 'crouch', label: 'Crouch', key: 'KeyC', group: 'Movement' },
  { id: 'sprint', label: 'Run', key: 'ShiftLeft', group: 'Movement' },
  { id: 'fire', label: 'Fire', key: 'Mouse0', group: 'Combat' },
  { id: 'aim', label: 'Aim down sights', key: 'Mouse2', alt: 'KeyF', group: 'Combat' },
  { id: 'reload', label: 'Reload', key: 'KeyR', group: 'Combat' },
  { id: 'primary', label: 'Primary weapon', key: 'Digit1', group: 'Combat' },
  { id: 'secondary', label: 'Pistol', key: 'Digit2', group: 'Combat' },
  { id: 'melee', label: 'Knife', key: 'Digit3', alt: 'KeyV', group: 'Combat' },
  { id: 'swap', label: 'Switch weapon', key: 'KeyQ', alt: 'WheelDown', group: 'Combat' },
  { id: 'grenade', label: 'Throw grenade', key: 'KeyG', group: 'Combat' },
  { id: 'perk', label: 'Use perk', key: 'KeyX', group: 'Combat' },
  { id: 'prone', label: 'Go prone / get up', key: 'KeyZ', group: 'Movement' },
  { id: 'interact', label: 'Interact: plant, defuse, open, take', key: 'KeyE', group: 'Other' },
  { id: 'shield', label: 'Put on a vest (Souk Royale)', key: 'KeyH', group: 'Other' },
  { id: 'map', label: 'Full map', key: 'KeyM', group: 'Other' },
  { id: 'scores', label: 'Scoreboard', key: 'Tab', group: 'Other' },
  { id: 'loadout', label: 'Change loadout', key: 'KeyB', group: 'Other' },
  { id: 'chat', label: 'Chat to everyone', key: 'Enter', group: 'Other' },
  { id: 'teamchat', label: 'Chat to your team', key: 'KeyY', group: 'Other' },
];

const DEFAULTS = {
  name: '',
  // tuned for a trackpad: fingers travel less than a mouse, so look faster
  sens: 1.8,
  adsSens: 0.8,
  aimAssist: true,
  invertY: false,
  fov: 80,
  volume: 0.7,
  aimToggle: true,  // holding a two-finger click is hard on a trackpad
  crouchToggle: false,
  sprintToggle: false,
  shadows: true,
  renderScale: 1.0,
  showFps: false,
  // touch controls: 'auto' shows them on a touch screen; the layout is where each control was dragged to
  touchMode: 'auto',
  touchScale: 1.0,
  touchSens: 1.0,
  touch: {},
  binds: Object.fromEntries(ACTIONS.map((a) => [a.id, a.key])),
  alt: Object.fromEntries(ACTIONS.map((a) => [a.id, a.alt || ''])),
};

const KEY = 'souk-siege-settings-v2';

function load() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch (e) {
    saved = {};
  }
  const s = { ...DEFAULTS, ...saved };
  s.binds = { ...DEFAULTS.binds, ...(saved.binds || {}) };
  s.alt = { ...DEFAULTS.alt, ...(saved.alt || {}) };
  s.touch = saved.touch && typeof saved.touch === 'object' ? saved.touch : {};
  return s;
}

export const settings = load();

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch (e) {
    /* storage can be unavailable; settings still apply for this visit */
  }
}

export function resetBinds() {
  settings.binds = { ...DEFAULTS.binds };
  settings.alt = { ...DEFAULTS.alt };
  saveSettings();
}

export function resetAll() {
  const name = settings.name;
  Object.assign(settings, JSON.parse(JSON.stringify(DEFAULTS)));
  settings.name = name;
  saveSettings();
}

const NAMES = {
  Mouse0: 'Click', Mouse1: 'Middle click', Mouse2: 'Two-finger click', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5',
  WheelUp: 'Scroll up', WheelDown: 'Scroll down', Space: 'Space', ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift',
  ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl', AltLeft: 'Left Alt', AltRight: 'Right Alt', Tab: 'Tab',
  CapsLock: 'Caps Lock', Enter: 'Enter', Backspace: 'Backspace', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←',
  ArrowRight: '→', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';',
  Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', MetaLeft: 'Left ⌘', MetaRight: 'Right ⌘',
};

export function keyName(code) {
  if (!code) return '—';
  if (NAMES[code]) return NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}
