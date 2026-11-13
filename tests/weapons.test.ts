import { expect, test } from 'vitest';
import { cycleWeapon } from '../src/weapons';
import type { Vehicle } from '../src/vehicle';

test('cycleWeapon wraps through owned weapons and empties to null', () => {
  const v = { ammo: { homing: 2, ricochet: 1 }, weapon: 'homing' } as unknown as Vehicle;
  expect(cycleWeapon(v, 1)).toBe('ricochet');
  expect(cycleWeapon(v, 1)).toBe('homing');
  expect(cycleWeapon(v, -1)).toBe('ricochet');
  v.ammo = {};
  expect(cycleWeapon(v, 1)).toBeNull();
});
