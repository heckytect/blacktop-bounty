import { beforeAll, expect, test } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Match } from '../src/game';
import { VEHICLES } from '../src/data/vehicles';
import { ARENAS } from '../src/data/arenas';
import { seedRandom } from './seed';

// Balance tournament (M7). Slow, so opt-in:  BALANCE=1 npx vitest run tests/balance.test.ts
// 4-car free-for-alls, 1 life each, normal bots. Every car appears equally often; fair share = 25 % wins.

const ROUNDS = Number(process.env.BALANCE_ROUNDS ?? 120);
const STEP = 1 / 60;
const TIME_LIMIT = 150; // s; then the healthiest car wins

beforeAll(() => RAPIER.init());

test.runIf(!!process.env.BALANCE)(`balance: ${ROUNDS} four-car rounds`, () => {
  seedRandom(2024);
  const arenas = ARENAS.filter((a) => a.id !== 'proving-ground' && a.id !== 'penthouse-lot');
  const wins = new Map(VEHICLES.map((v) => [v.id, 0]));
  const games = new Map(VEHICLES.map((v) => [v.id, 0]));
  const kills = new Map(VEHICLES.map((v) => [v.id, 0]));
  let order: number[] = [];
  for (let r = 0; r < ROUNDS; r++) {
    if (order.length < 4) order = [...order, ...VEHICLES.map((_, i) => i).sort(() => Math.random() - 0.5)];
    const picks = [...new Set(order.splice(0, 4))];
    while (picks.length < 4) picks.push(order.shift()!);
    const defs = picks.map((i) => VEHICLES[i]);
    const m = new Match(new THREE.Scene(), { playerDef: null, botCount: 4, botDefs: defs, difficulty: 'normal', arena: arenas[r % arenas.length].id, lives: { player: 1, bots: 1 } });
    for (let i = 0; i < TIME_LIMIT / STEP && !m.result; i++) m.step(STEP);
    const winner = m.result?.winner ?? [...m.contenders()].sort((a, b) => b.hp / b.maxHp - a.hp / a.maxHp)[0];
    for (const v of m.vehicles) {
      games.set(v.def.id, games.get(v.def.id)! + 1);
      kills.set(v.def.id, kills.get(v.def.id)! + v.kills);
    }
    if (winner) wins.set(winner.def.id, wins.get(winner.def.id)! + 1);
    m.world.free();
  }
  const table = VEHICLES.map((v) => ({
    car: v.name,
    games: games.get(v.id)!,
    winRate: Math.round((wins.get(v.id)! / games.get(v.id)!) * 100),
    killsPerGame: +(kills.get(v.id)! / games.get(v.id)!).toFixed(2),
  })).sort((a, b) => b.winRate - a.winRate);
  console.table(table);
  // Guard rails: nobody wins more than twice their fair share or under a third of it.
  for (const row of table) {
    expect(row.winRate, `${row.car} dominates`).toBeLessThanOrEqual(50);
    expect(row.winRate, `${row.car} is hopeless`).toBeGreaterThanOrEqual(8);
  }
}, 900_000);
