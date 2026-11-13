// Spec §11 settings, stored per browser. Storage can be unavailable (private mode), so it's best-effort.

export type Action =
  | 'throttle' | 'brake' | 'left' | 'right' | 'handbrake' | 'jump' | 'reset'
  | 'fire' | 'fireWeapon' | 'nextWeapon' | 'prevWeapon' | 'special' | 'horn' | 'freeze' | 'shield' | 'mine';

export const ACTION_LABELS: Record<Action, string> = {
  throttle: 'Accelerate', brake: 'Brake / reverse', left: 'Steer left', right: 'Steer right', handbrake: 'Handbrake',
  jump: 'Jump', reset: 'Flip upright', fire: 'Machine gun', fireWeapon: 'Fire weapon', nextWeapon: 'Next weapon',
  prevWeapon: 'Previous weapon', special: 'Special', horn: 'Horn',
  freeze: 'Freeze blast (25 energy)', shield: 'Shield (30 energy)', mine: 'Mine drop (20 energy)',
};

export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  throttle: ['KeyW', 'ArrowUp'], brake: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'], jump: ['KeyJ'], reset: ['KeyR'], fire: ['Mouse0'], fireWeapon: ['Mouse2', 'KeyF'],
  nextWeapon: ['KeyE'], prevWeapon: ['KeyQ'], special: ['ShiftLeft', 'ShiftRight'], horn: ['KeyH'],
  freeze: ['Digit1'], shield: ['Digit2'], mine: ['Digit3'],
};

export type Graphics = 'low' | 'medium' | 'high';

export interface Settings {
  music: number; // 0..1
  sfx: number;
  graphics: Graphics;
  retro: boolean;
  shake: boolean;
  bindings: Record<Action, string[]>;
}

const KEY = 'blacktop.options';
const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const DEFAULTS: Settings = { music: 0.6, sfx: 0.8, graphics: 'medium', retro: false, shake: !reducedMotion, bindings: DEFAULT_BINDINGS };

export function loadSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...s, bindings: { ...DEFAULT_BINDINGS, ...(s.bindings ?? {}) } };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* not remembered */
  }
}

/** Human label for a KeyboardEvent.code / Mouse<n>. */
export function keyLabel(code: string) {
  if (code === 'Mouse0') return 'Left click';
  if (code === 'Mouse2') return 'Right click';
  if (code.startsWith('Mouse')) return `Mouse ${code.slice(5)}`;
  return code.replace(/^(Key|Digit)/, '').replace(/^Arrow/, 'Arrow ').replace(/(Left|Right)$/, ' $1').replace(/\s+/g, ' ').trim();
}
