import { beforeAll, expect, test } from 'vitest';
import { seedRandom } from './seed';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Match } from '../src/game';
import type { BotState } from '../src/ai';

beforeAll(() => {
  seedRandom(42); // reproducible bot randomness
  return RAPIER.init();
});

const STEP = 1 / 60;
const MINUTES = 5;
const STUCK_WINDOW = 5; // s
const STUCK_RADIUS = 3; // m

// M3 acceptance: 7 bots fight each other unattended for 5 min without getting stuck > 5 s.
test(`7 bots, ${MINUTES} min unattended: nobody stuck > ${STUCK_WINDOW}s`, () => {
  const match = new Match(new THREE.Scene(), { playerDef: null, botCount: 7, difficulty: 'normal' });
  const trail = match.vehicles.map(() => [] as (THREE.Vector3 | null)[]); // 1 sample/s, null while dead
  const stuck: string[] = [];
  const states = new Set<BotState>();

  for (let s = 0; s < MINUTES * 60; s++) {
    for (let i = 0; i < 60; i++) match.step(STEP);
    match.bots.forEach((b) => states.add(b.state));
    match.vehicles.forEach((v, i) => {
      const t = trail[i];
      t.push(v.alive ? v.position.clone() : null);
      const win = t.slice(-STUCK_WINDOW - 1);
      if (win.length <= STUCK_WINDOW || win.some((p) => !p)) return;
      const spread = Math.max(...win.map((p) => p!.distanceTo(win[0]!)));
      if (spread < STUCK_RADIUS) {
        const b = match.bots.find((x) => x.v === v)!;
        const td = b.target ? Math.round(b.target.position.distanceTo(v.position)) : '-';
        stuck.push(`${v.name} (${v.def.name}) at ${s}s near ${win[0]!.toArray().map(Math.round)} state=${b.state} targetDist=${td} speed=${v.speed.toFixed(1)}`);
      }
    });
  }

  const kills = match.vehicles.reduce((n, v) => n + v.kills, 0);
  console.log({ kills, relocations: match.bots.map((b) => b.relocations), deaths: match.vehicles.map((v) => `${v.def.name}:${v.kills}/${v.deaths}`), states: [...states] });
  expect(stuck.slice(0, 10)).toEqual([]);
  expect(kills).toBeGreaterThan(5); // they actually fight (M7: more armour + shields make fights longer)
  expect(states).toContain('engage');
}, 300_000);
