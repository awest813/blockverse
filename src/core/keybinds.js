// Rebindable keyboard actions. Bindings are KeyboardEvent.code strings;
// settings store only the overrides, so new actions pick up their defaults.

export const ACTIONS = [
  { id: 'forward', label: 'Walk forward', def: 'KeyW', group: 'Movement' },
  { id: 'back', label: 'Walk backward', def: 'KeyS', group: 'Movement' },
  { id: 'left', label: 'Strafe left', def: 'KeyA', group: 'Movement' },
  { id: 'right', label: 'Strafe right', def: 'KeyD', group: 'Movement' },
  { id: 'jump', label: 'Jump / swim / fly up', def: 'Space', group: 'Movement' },
  { id: 'sneak', label: 'Sneak / fly down / dive', def: 'ShiftLeft', group: 'Movement' },
  { id: 'sprint', label: 'Sprint / swim', def: 'ControlLeft', group: 'Movement' },
  { id: 'inventory', label: 'Inventory', def: 'KeyE', group: 'Gameplay' },
  { id: 'drop', label: 'Drop item', def: 'KeyQ', group: 'Gameplay' },
  // touchpads (Chromebooks, most laptops) have no middle button
  { id: 'pickBlock', label: 'Pick block (also middle click)', def: 'KeyR', group: 'Gameplay' },
  { id: 'chat', label: 'Open chat', def: 'KeyT', group: 'Interface' },
  { id: 'command', label: 'Open command', def: 'Slash', group: 'Interface' },
  { id: 'hideHud', label: 'Hide HUD', def: 'F1', group: 'Interface' },
  { id: 'debug', label: 'Debug overlay', def: 'F3', group: 'Interface' },
  { id: 'screenshot', label: 'Screenshot', def: 'F2', group: 'Interface' },
];

// Keys that can't be bound: they're reserved for menus and the hotbar.
// The Search / Windows / Command keys belong to the system (on a Chromebook
// Search opens the launcher), so they can't be bound either.
export const RESERVED = new Set(['Escape', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9',
  'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight']);

export function resolveBindings(overrides = {}) {
  const out = {};
  for (const a of ACTIONS) out[a.id] = overrides?.[a.id] ?? a.def;
  return out;
}

const NAMED = {
  Space: 'Space', Slash: '/', Backslash: '\\', Backquote: '`', Minus: '-', Equal: '=',
  BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.',
  ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl',
  AltLeft: 'L-Alt', AltRight: 'R-Alt', MetaLeft: 'L-Meta', MetaRight: 'R-Meta',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', CapsLock: 'Caps Lock',
};

// Human-readable name for a KeyboardEvent.code.
export function keyLabel(code) {
  if (!code) return '—';
  if (NAMED[code]) return NAMED[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

// Set of action ids whose key is also bound to another action.
export function findConflicts(bindings) {
  const byCode = new Map();
  for (const [id, code] of Object.entries(bindings)) {
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push(id);
  }
  return new Set([...byCode.values()].filter((ids) => ids.length > 1).flat());
}
