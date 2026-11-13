import { DEFAULT_BINDINGS, type Action } from './settings';

export interface DriveInput {
  throttle: number; // 0..1
  brake: number; // 0..1 (brake, then reverse)
  steer: number; // -1 left .. 1 right
  handbrake: boolean;
  jump: boolean;
  reset: boolean;
  fire: boolean; // machine gun (held)
  fireWeapon: boolean; // selected weapon (fires on press)
  nextWeapon: boolean;
  prevWeapon: boolean;
  special: boolean;
  horn: boolean;
  freeze: boolean; // energy moves (spec §4)
  shield: boolean;
  mine: boolean;
}

export const NO_INPUT: DriveInput = {
  throttle: 0, brake: 0, steer: 0, handbrake: false, jump: false, reset: false,
  fire: false, fireWeapon: false, nextWeapon: false, prevWeapon: false, special: false, horn: false,
  freeze: false, shield: false, mine: false,
};

const DEADZONE = 0.15;

// Pure: merges keyboard/mouse (KeyboardEvent.code / Mouse<n> set, via bindings) and a Standard-mapping gamepad.
export function readInput(keys: ReadonlySet<string>, pad: Gamepad | null, bindings: Record<Action, string[]> = DEFAULT_BINDINGS): DriveInput {
  const k = (a: Action) => bindings[a].some((c) => keys.has(c));
  let throttle = k('throttle') ? 1 : 0;
  let brake = k('brake') ? 1 : 0;
  let steer = (k('right') ? 1 : 0) - (k('left') ? 1 : 0);
  let handbrake = k('handbrake');
  let jump = k('jump');
  let reset = k('reset');
  let fire = k('fire');
  let fireWeapon = k('fireWeapon');
  let nextWeapon = k('nextWeapon');
  let prevWeapon = k('prevWeapon');
  let special = k('special');
  const horn = k('horn');
  let freeze = k('freeze');
  let shield = k('shield');
  let mine = k('mine');

  if (pad) {
    const b = (i: number) => pad.buttons[i]?.value ?? 0;
    const stick = pad.axes[0] ?? 0;
    throttle = Math.max(throttle, b(7));
    brake = Math.max(brake, b(6));
    if (Math.abs(stick) > DEADZONE) steer = stick;
    handbrake ||= b(1) > 0.5;
    jump ||= b(0) > 0.5;
    reset ||= b(8) > 0.5; // Select/Back
    special ||= b(3) > 0.5; // Triangle/Y
    fire ||= b(5) > 0.5;
    fireWeapon ||= b(2) > 0.5;
    nextWeapon ||= b(4) > 0.5; // L1 (the D-pad is for energy-move combos)
    const combo = combos.read(pad);
    freeze ||= combo === 'freeze';
    shield ||= combo === 'shield';
    mine ||= combo === 'mine';
    jump ||= combo === 'jump';
  }
  steer = Math.max(-1, Math.min(1, steer));
  return { throttle, brake, steer, handbrake, jump, reset, fire, fireWeapon, nextWeapon, prevWeapon, special, horn, freeze, shield, mine };
}

export type Combo = 'freeze' | 'shield' | 'mine' | 'jump';
type Dir = 'U' | 'D' | 'L' | 'R';
// Spec §4 energy-move combos on the D-pad, each press within 600 ms of the last.
const COMBOS: [string, Combo][] = [
  ['UDU', 'freeze'],
  ['RRU', 'shield'],
  ['LLD', 'mine'],
  ['UU', 'jump'],
];
const COMBO_WINDOW = 600; // ms

/** Reads D-pad presses into combos. Pure apart from its own buffer; `now` is injectable for tests. */
export class ComboReader {
  private seq = '';
  private last = 0;
  private prev: boolean[] = [false, false, false, false];

  /** Feed one press (tests) → combo or null. */
  press(d: Dir, now: number): Combo | null {
    if (now - this.last > COMBO_WINDOW) this.seq = '';
    this.last = now;
    this.seq = (this.seq + d).slice(-3);
    for (const [pattern, combo] of COMBOS) {
      if (this.seq.endsWith(pattern)) {
        this.seq = ''; // a finished combo doesn't feed the next one
        return combo;
      }
    }
    return null;
  }

  read(pad: Gamepad, now = performance.now()): Combo | null {
    const dirs: Dir[] = ['U', 'D', 'L', 'R'];
    let out: Combo | null = null;
    [12, 13, 14, 15].forEach((b, i) => {
      const down = !!pad.buttons[b]?.pressed;
      if (down && !this.prev[i]) out = this.press(dirs[i], now) ?? out;
      this.prev[i] = down;
    });
    return out;
  }
}
const combos = new ComboReader();

export function createKeyboard(): Set<string> {
  const keys = new Set<string>();
  addEventListener('keydown', (e) => {
    keys.add(e.code);
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('mousedown', (e) => keys.add(`Mouse${e.button}`));
  addEventListener('mouseup', (e) => keys.delete(`Mouse${e.button}`));
  addEventListener('contextmenu', (e) => e.preventDefault()); // right mouse fires a weapon
  addEventListener('blur', () => keys.clear());
  return keys;
}

export const firstGamepad = (): Gamepad | null =>
  navigator.getGamepads?.().find((p) => p?.connected) ?? null;
