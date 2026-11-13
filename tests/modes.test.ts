import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Match, RESPAWN_DELAY } from '../src/game';
import { CAMPAIGN, Campaign, Survival, addScore, kingpinUnlocked, waveSize, type ScoreEntry } from '../src/modes';
import { KINGPIN, VEHICLES } from '../src/data/vehicles';
import { seedRandom } from './seed';

beforeAll(() => RAPIER.init());
beforeEach(() => seedRandom(7));

const STEP = 1 / 60;
const run = (m: Match, seconds: number, each?: () => void) => {
  for (let i = 0; i < seconds / STEP && !m.result; i++) {
    m.step(STEP);
    each?.();
  }
};

/** "Win" a stage without needing AI skill: the player wears each opponent down until the match says it's won. */
function winStage(m: Match) {
  const p = m.player!;
  for (let t = 0; t < 120 && !m.result; t += 0.5) {
    run(m, 0.5);
    for (const v of m.contenders()) if (v !== p && v.alive) m.combat.damage(v, v.maxHp * 0.3, p);
  }
  return m.result;
}

// M6 acceptance: full campaign completable start to ending card.
test('campaign: every stage in order, boss stage, ending + Kingpin unlock', () => {
  const driver = VEHICLES[0];
  const c = new Campaign(driver);
  const played: string[] = [];
  while (c.state !== 'complete') {
    const opts = c.matchOptions();
    const m = new Match(new THREE.Scene(), opts);
    played.push(opts.arena!);
    expect(m.player!.def).toBe(driver);
    if (c.current.boss) {
      // Boss stage: Kingpin is there, summons drones, and the roof collapses on its HP.
      expect(m.boss!.def).toBe(KINGPIN);
      run(m, 0.5);
      m.boss!.ability!.activate();
      run(m, 0.2);
      expect(m.minions.size).toBe(2);
    } else {
      expect(m.contenders().length).toBe(1 + c.current.opponents);
    }
    const r = winStage(m);
    expect(r?.won, `stage ${c.stage} (${opts.arena})`).toBe(true);
    if (c.current.boss) expect(m.arena.event!.fired).toBe(3);
    c.finish(r!);
    if (c.state === 'stage-won') c.next();
  }
  expect(played).toEqual(CAMPAIGN.map((s) => s.arena));
  expect(driver.ending.split('. ').length).toBeGreaterThanOrEqual(3); // ending card text
  expect(kingpinUnlocked()).toBe(true);
}, 60_000);

test('boss stage: roof collapse follows boss HP, not the clock', () => {
  const c = new Campaign(VEHICLES[1]);
  c.stage = CAMPAIGN.length - 1;
  const m = new Match(new THREE.Scene(), c.matchOptions());
  for (const b of m.bots) {
    const think = b.think.bind(b);
    b.think = (dt) => ({ ...think(dt), fire: false, fireWeapon: false, special: false }); // boss drives but can't hurt anyone
  }
  run(m, 65); // past the 60 s deathmatch schedule
  expect(m.arena.event!.fired).toBe(0);
  m.combat.damage(m.boss!, m.boss!.maxHp * 0.3, m.player);
  run(m, 0.1);
  expect(m.arena.event!.fired).toBe(1);
});

test('campaign: losing all 3 lives is game over, retry replays the same arena', () => {
  const c = new Campaign(VEHICLES[2]);
  const m = new Match(new THREE.Scene(), c.matchOptions());
  for (let life = 0; life < 3; life++) {
    m.combat.damage(m.player!, Infinity, null);
    run(m, RESPAWN_DELAY + 2.5); // respawn + 2 s invulnerability
  }
  expect(m.result).toMatchObject({ won: false, reason: 'player-eliminated' });
  expect(m.player!.alive).toBe(false); // no respawn after the last life
  expect(c.finish(m.result!)).toBe('game-over');
  c.retry();
  expect(c.state).toBe('playing');
  expect(c.current.arena).toBe(CAMPAIGN[0].arena);
});

describe('match rules', () => {
  test('deathmatch: opponents need all their lives taken; last car standing wins', () => {
    const m = new Match(new THREE.Scene(), { playerDef: VEHICLES[0], botCount: 2, difficulty: 'easy', lives: { player: 3, bots: 3 } });
    const [a, b] = m.vehicles.filter((v) => v !== m.player);
    for (let i = 0; i < 3; i++) {
      for (const v of [a, b]) if (v.alive) m.combat.damage(v, Infinity, m.player);
      run(m, RESPAWN_DELAY + 2.5); // respawn + 2 s invulnerability
      if (i < 2) expect(m.result).toBeNull();
    }
    expect(m.result).toMatchObject({ won: true, reason: 'opponents-eliminated' });
    expect(m.player!.kills).toBe(6);
  });

  test('AI-only match ends with one survivor', () => {
    const m = new Match(new THREE.Scene(), { playerDef: null, botCount: 3, difficulty: 'easy', lives: { player: 1, bots: 1 } });
    m.vehicles.slice(1).forEach((v) => m.combat.damage(v, Infinity, null));
    run(m, 0.1);
    expect(m.result).toMatchObject({ reason: 'last-standing', winner: m.vehicles[0] });
  });
});

describe('survival', () => {
  test('waves grow, wrecks are cleared, score counts kills and waves', () => {
    const m = new Match(new THREE.Scene(), { playerDef: VEHICLES[0], botCount: 0, botDefs: [], difficulty: 'easy', lives: { player: 3, bots: 1 }, endless: true });
    const s = new Survival(m);
    run(m, 1, () => s.update(STEP));
    expect(s.wave).toBe(1);
    expect(m.vehicles.length).toBe(1 + waveSize(1));
    for (const v of m.vehicles) if (v !== m.player) m.combat.damage(v, Infinity, m.player);
    run(m, 4, () => s.update(STEP));
    expect(s.wave).toBe(2);
    expect(m.vehicles.length).toBe(1 + waveSize(2)); // old wrecks removed
    expect(m.result).toBeNull(); // clearing a wave doesn't end survival
    expect(s.score).toBe(waveSize(1) * 100 + 250);
  });

  test('leaderboard keeps the top 10, best first', () => {
    let board: ScoreEntry[] = [];
    for (let i = 0; i < 12; i++) board = addScore(board, { score: i * 10, wave: i, driver: 'x', date: '' }).board;
    expect(board).toHaveLength(10);
    expect(board[0].score).toBe(110);
    expect(addScore(board, { score: 5, wave: 0, driver: 'y', date: '' }).rank).toBe(-1);
  });
});
