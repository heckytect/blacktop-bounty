import { beforeAll, beforeEach, expect, test } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Match } from '../src/game';
import { VEHICLES } from '../src/data/vehicles';
import { ComboReader, NO_INPUT, type DriveInput } from '../src/input';
import { ENERGY } from '../src/vehicle';
import { seedRandom } from './seed';

beforeAll(() => RAPIER.init());
beforeEach(() => seedRandom(3));

const STEP = 1 / 60;
/** Player at the centre facing +X, one idle bot `ahead` metres in front. */
function duel(ahead: number, arena = 'proving-ground') {
  const m = new Match(new THREE.Scene(), { playerDef: VEHICLES[0], botCount: 1, difficulty: 'easy', arena });
  m.bots[0].think = () => NO_INPUT;
  const [p, b] = [m.player!, m.bots[0].v];
  p.recoverAt({ x: -100, y: 1.5, z: -20 }, 0);
  b.recoverAt({ x: -100 + ahead, y: 1.5, z: -20 }, ahead > 0 ? Math.PI : 0); // bot faces the player
  for (let i = 0; i < 30; i++) m.step(STEP);
  p.invuln = b.invuln = 0;
  return { m, p, b };
}
const press = (m: Match, input: Partial<DriveInput>, seconds = 0.05) => {
  for (let i = 0; i < seconds / STEP; i++) m.step(STEP, { ...NO_INPUT, ...input });
  for (let i = 0; i < 2; i++) m.step(STEP); // release
};

test('freeze blast costs 25 energy and ices the target (it can\'t drive)', () => {
  const { m, p, b } = duel(30);
  press(m, { freeze: true });
  expect(p.energy).toBeLessThan(ENERGY.max - ENERGY.freeze + 2);
  for (let i = 0; i < 40 && b.frozen === 0; i++) m.step(STEP);
  expect(b.frozen).toBeGreaterThan(0);
  m.bots[0].think = () => ({ ...NO_INPUT, throttle: 1 });
  const at = b.position.clone();
  for (let i = 0; i < 60; i++) m.step(STEP);
  expect(b.position.distanceTo(at)).toBeLessThan(1.5); // frozen: throttle ignored
});

test('shield blocks all damage for 3 s, then wears off', () => {
  const { m, p } = duel(40);
  press(m, { shield: true });
  expect(p.shield).toBeGreaterThan(2.5);
  const hp = p.hp;
  m.combat.damage(p, 50, null);
  expect(p.hp).toBe(hp);
  for (let i = 0; i < 3.2 / STEP; i++) m.step(STEP);
  m.combat.damage(p, 50, null);
  expect(p.hp).toBe(hp - 50);
});

test('mine drops behind and blows up a car that drives over it', () => {
  const { m, p, b } = duel(-25); // bot behind the player
  press(m, { mine: true });
  for (let i = 0; i < 90; i++) m.step(STEP); // arm
  m.bots[0].think = () => ({ ...NO_INPUT, throttle: 1 });
  const hp = b.hp;
  for (let i = 0; i < 240 && b.hp === hp; i++) m.step(STEP);
  expect(b.hp).toBeLessThan(hp);
});

test('energy: moves fail when empty, refill at 8/s, jump costs 15', () => {
  const { m, p } = duel(40);
  p.energy = 10;
  press(m, { freeze: true, shield: true, mine: true });
  expect(p.shield).toBe(0);
  p.energy = 20;
  press(m, { jump: true });
  expect(p.energy).toBeLessThan(10);
  const e = p.energy;
  for (let i = 0; i < 60; i++) m.step(STEP);
  expect(p.energy).toBeCloseTo(e + 8, 0);
});

test('gamepad combos: ↑↓↑ freeze, →→↑ shield, ←←↓ mine, ↑↑ jump; slow presses don\'t count', () => {
  const c = new ComboReader();
  const seq = (dirs: string, gap = 100, t0 = 0) => dirs.split('').map((d, i) => c.press(d as 'U', t0 + i * gap)).filter(Boolean);
  expect(seq('UDU', 100, 0)).toEqual(['freeze']);
  expect(seq('RRU', 100, 5000)).toEqual(['shield']);
  expect(seq('LLD', 100, 10000)).toEqual(['mine']);
  expect(seq('UU', 100, 15000)).toEqual(['jump']);
  expect(seq('UDU', 900, 20000)).toEqual([]); // too slow
});

test('bots use energy moves in a fight', () => {
  const m = new Match(new THREE.Scene(), { playerDef: null, botCount: 6, difficulty: 'hard', arena: 'proving-ground' });
  for (let i = 0; i < 90 / STEP; i++) m.step(STEP);
  const used = m.bots.reduce((n, b) => n + b.energyUsed, 0);
  console.log('bot energy moves in 90 s:', used);
  expect(used).toBeGreaterThan(5);
}, 60_000);
