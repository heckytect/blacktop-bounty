import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { seedRandom } from './seed';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Match } from '../src/game';
import { ARENAS } from '../src/data/arenas';
import { VEHICLES } from '../src/data/vehicles';
import { NO_INPUT } from '../src/input';

beforeAll(() => RAPIER.init());
beforeEach(() => seedRandom(1234)); // reproducible bot/event randomness

const STEP = 1 / 60;
const run = (m: Match, seconds: number) => {
  for (let i = 0; i < seconds / STEP; i++) m.step(STEP);
};
/** 8 cars (player + 7 bots) with the bots switched off. */
function frozenMatch(arena: string) {
  const m = new Match(new THREE.Scene(), { playerDef: VEHICLES[1], botCount: 7, difficulty: 'normal', arena });
  for (const b of m.bots) b.think = () => NO_INPUT;
  return m;
}

// M4 acceptance: all events trigger; no fall-through; spawns valid. Plus spec §7 layout rules.
describe.each(ARENAS.map((a) => [a.name, a] as const))('%s', (_, def) => {
  const themed = def.id !== 'proving-ground';

  test('layout meets spec §7', () => {
    const m = frozenMatch(def.id);
    const { arena } = m;
    expect(arena.spawns).toHaveLength(8);
    if (!themed) return;
    expect(arena.pickups.length).toBeGreaterThanOrEqual(12);
    expect(arena.pickups.length).toBeLessThanOrEqual(20);
    expect(arena.props.length).toBeGreaterThanOrEqual(6);
    expect(arena.event).not.toBeNull();
    const levels = new Set(arena.nav.nodes.map((n) => Math.round(n.y)));
    expect(levels.size).toBeGreaterThanOrEqual(2); // vertical levels the bots can path on
  });

  test('spawns are valid: every car lands upright where it was placed', () => {
    const m = frozenMatch(def.id);
    run(m, 1.5);
    const bad = m.vehicles
      .map((v, i) => ({ v, s: m.arena.spawns[i] }))
      .filter(({ v, s }) => {
        const drift = Math.hypot(v.position.x - s.pos.x, v.position.z - s.pos.z);
        return !v.grounded || v.flipped || drift > 1.5 || Math.abs(v.position.y - s.pos.y) > 1.5;
      })
      .map(({ v, s }) => `${v.def.name} at ${s.pos.toArray().map(Math.round)} → ${v.position.toArray().map(Math.round)} grounded=${v.grounded}`);
    expect(bad).toEqual([]);
  });

  test.runIf(themed)('event triggers and hits a car at its test point', () => {
    const m = frozenMatch(def.id);
    const ev = m.arena.event!;
    const car = m.player!;
    run(m, 0.5);
    car.recoverAt(ev.testPoint, 0);
    run(m, 0.5);
    const before = m.vehicles.map((v) => ({ hp: v.hp, pos: v.position.clone(), deaths: v.deaths }));
    ev.trigger();
    run(m, 9);
    expect(ev.fired).toBeGreaterThanOrEqual(1);
    const hurt = m.vehicles.some((v, i) => v.hp < before[i].hp || v.deaths > before[i].deaths);
    const moved = car.position.distanceTo(before[0].pos) > 3;
    expect(hurt || moved, `${ev.name}: nothing happened`).toBe(true);
  });

  test('90 s with 7 live bots: no one stuck > 5 s, no fall-through, timed event fires', () => {
    const m = new Match(new THREE.Scene(), { playerDef: null, botCount: 7, difficulty: 'normal', arena: def.id });
    const trail = m.vehicles.map(() => [] as (THREE.Vector3 | null)[]);
    const stuck: string[] = [];
    for (let s = 0; s < 90; s++) {
      run(m, 1);
      m.vehicles.forEach((v, i) => {
        trail[i].push(v.alive ? v.position.clone() : null);
        const win = trail[i].slice(-6);
        if (win.length < 6 || win.some((p) => !p)) return;
        if (Math.max(...win.map((p) => p!.distanceTo(win[0]!))) < 3) stuck.push(`${v.def.name} at ${s}s near ${win[0]!.toArray().map(Math.round)}`);
      });
    }
    expect(stuck.slice(0, 5)).toEqual([]);
    if (!def.hasPits) expect(m.falls, 'cars fell through a solid arena').toBe(0);
    const ev = m.arena.event;
    const timed = ev && !['Fuel tanker explosion', 'Casino sign collapse', 'Bridge collapse'].includes(ev.name); // those need shooting
    if (timed) expect(ev!.fired).toBeGreaterThanOrEqual(1);
  }, 120_000);
});
