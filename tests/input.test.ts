import { expect, test } from 'vitest';
import { readInput } from '../src/input';
import { DEFAULT_BINDINGS, keyLabel } from '../src/settings';

const pad = (axes: number[], pressed: Record<number, number>) =>
  ({ axes, buttons: Array.from({ length: 17 }, (_, i) => ({ value: pressed[i] ?? 0 })) }) as unknown as Gamepad;

test('keyboard maps to drive input', () => {
  const i = readInput(new Set(['KeyW', 'KeyA', 'Space']), null);
  expect(i).toMatchObject({ throttle: 1, brake: 0, steer: -1, handbrake: true, jump: false });
});

test('gamepad triggers, stick deadzone and buttons', () => {
  expect(readInput(new Set(), pad([0.1], { 7: 0.5, 0: 1 }))).toMatchObject({ throttle: 0.5, steer: 0, jump: true });
  expect(readInput(new Set(), pad([0.8], { 6: 1, 1: 1 }))).toMatchObject({ brake: 1, steer: 0.8, handbrake: true });
});

test('fire and weapon controls', () => {
  expect(readInput(new Set(['Mouse0', 'KeyF', 'KeyE']), null)).toMatchObject({ fire: true, fireWeapon: true, nextWeapon: true, prevWeapon: false });
  expect(readInput(new Set(), pad([0], { 5: 1, 2: 1, 4: 1 }))).toMatchObject({ fire: true, fireWeapon: true, nextWeapon: true }); // L1; the D-pad is for energy combos
});

test('special on Shift / Triangle, reset on Select', () => {
  expect(readInput(new Set(['ShiftLeft']), null)).toMatchObject({ special: true, reset: false });
  expect(readInput(new Set(), pad([0], { 3: 1, 8: 1 }))).toMatchObject({ special: true, reset: true });
});

test('keyboard and gamepad combine', () => {
  expect(readInput(new Set(['KeyW']), pad([-0.5], { 7: 0.3 }))).toMatchObject({ throttle: 1, steer: -0.5 });
});

test('rebinding: custom keys drive the car, defaults stop working', () => {
  const bindings = { ...DEFAULT_BINDINGS, throttle: ['KeyI'], horn: ['KeyO'] };
  expect(readInput(new Set(['KeyI', 'KeyO']), null, bindings)).toMatchObject({ throttle: 1, horn: true });
  expect(readInput(new Set(['KeyW']), null, bindings)).toMatchObject({ throttle: 0 });
  expect(['ArrowLeft', 'ShiftRight', 'Mouse2', 'KeyF'].map(keyLabel)).toEqual(['Arrow Left', 'Shift Right', 'Right click', 'F']);
});
