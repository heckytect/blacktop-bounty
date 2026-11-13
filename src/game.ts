import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { NO_INPUT, type DriveInput } from './input';
import { Vehicle } from './vehicle';
import { Combat } from './weapons';
import { Pickups } from './pickups';
import { Bot, type Difficulty } from './ai';
import { createAbility } from './abilities';
import { Arena, KILL_Y, type Spawn } from './arena';
import { ARENAS } from './data/arenas';
import { DRONE, VEHICLES, type VehicleDef } from './data/vehicles';

export const RESPAWN_DELAY = 3;
export const MAX_BOTS = 7;
const MAX_MINIONS = 4;
const BOSS_COLLAPSE_AT = [0.75, 0.5, 0.25]; // boss HP fractions that drop the next roof ring

export interface MatchOptions {
  playerDef: VehicleDef | null; // null = AI-only (spectate / soak test)
  botCount: number;
  difficulty: Difficulty;
  arena?: string; // ArenaDef id, default the first
  /** Explicit opponents (campaign); otherwise `botCount` random roster cars. */
  botDefs?: VehicleDef[];
  /** Final boss joins as an extra opponent; drives the roof collapse by its HP. */
  boss?: VehicleDef;
  /** Lives per car (spec §3.2). Default Infinity = free-roam (tests, dev). */
  lives?: { player: number; bots: number };
  /** Survival: clearing the bots doesn't end the match (the wave director spawns more). */
  endless?: boolean;
  random?: () => number;
}

export interface MatchResult {
  won: boolean;
  winner: Vehicle | null;
  reason: 'opponents-eliminated' | 'player-eliminated' | 'last-standing';
}

/** All game rules for one match, independent of rendering (runs headless in tests). */
export class Match {
  readonly world = new RAPIER.World({ x: 0, y: -20, z: 0 }); // heavier than real gravity = arcade feel
  readonly arena: Arena;
  readonly vehicles: Vehicle[] = [];
  readonly bots: Bot[] = [];
  readonly player: Vehicle | null;
  readonly boss: Vehicle | null = null;
  readonly combat: Combat;
  readonly pickups: Pickups;
  readonly lives = new Map<Vehicle, number>();
  readonly eliminated = new Set<Vehicle>();
  readonly minions = new Set<Vehicle>();
  time = 0;
  falls = 0; // times a car dropped below the map (pits, collapses, fall-through)
  result: MatchResult | null = null;
  onFeed?: (text: string, v: Vehicle | null) => void;
  /** Kill hook for HUD captions / audio / scoring. */
  onKill?: (victim: Vehicle, killer: Vehicle | null) => void;
  private collapsesDone = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly opts: MatchOptions,
  ) {
    const rand = opts.random ?? Math.random;
    this.arena = new Arena(ARENAS.find((a) => a.id === opts.arena) ?? ARENAS[0], this.world, scene);
    const { spawns } = this.arena;
    const lives = opts.lives ?? { player: Infinity, bots: Infinity };

    const pool = VEHICLES.filter((d) => d !== opts.playerDef);
    const botDefs = opts.botDefs ?? Array.from({ length: Math.min(opts.botCount, MAX_BOTS) }, () => pool.splice(Math.floor(rand() * pool.length), 1)[0]);
    this.combat = new Combat(this.world, scene, this.vehicles);

    this.player = opts.playerDef ? this.addCar(opts.playerDef, 'You', spawns[0], lives.player, null) : null;
    for (const d of botDefs) this.addCar(d, d.driver.replace(/ ".*"/, ''), spawns[this.vehicles.length % spawns.length], lives.bots, opts.difficulty);
    if (opts.boss) {
      // The boss starts across the arena from the player.
      const far = spawns.reduce((a, b) => (b.pos.distanceTo(spawns[0].pos) > a.pos.distanceTo(spawns[0].pos) ? b : a));
      this.boss = this.addCar(opts.boss, opts.boss.driver, far, 1, opts.difficulty);
    }

    this.combat.focus = this.player;
    this.pickups = new Pickups(scene, this.arena.pickups);
    this.combat.onKill = (victim, killer) => this.handleKill(victim, killer);
    this.combat.onSummon = (owner, count) => this.summon(owner, count);
    this.arena.attach({ world: this.world, scene, combat: this.combat, vehicles: this.vehicles, time: () => this.time });
    if (this.boss && this.arena.event) this.arena.event.paused = true; // the boss's HP drives the collapse, not the clock
  }

  /** Add a car mid-match (survival waves, boss drones). `difficulty` null = player-controlled. */
  addCar(def: VehicleDef, name: string, at: Spawn, lives: number, difficulty: Difficulty | null) {
    const v = new Vehicle(this.world, this.scene, def, name, at);
    this.vehicles.push(v);
    v.ability = createAbility(v, this.combat);
    this.lives.set(v, lives);
    if (difficulty) this.bots.push(new Bot(v, this, difficulty));
    return v;
  }

  /** Spawn a bot at the safest spawn point. */
  addBot(def: VehicleDef, difficulty: Difficulty, lives: number) {
    const s = this.safestSpawn(null);
    return this.addCar(def, def.driver.replace(/ ".*"/, ''), s, lives, difficulty);
  }

  removeCar(v: Vehicle) {
    v.dispose(this.world, this.scene);
    this.vehicles.splice(this.vehicles.indexOf(v), 1);
    const b = this.bots.findIndex((x) => x.v === v);
    if (b >= 0) this.bots.splice(b, 1);
    this.lives.delete(v);
    this.eliminated.delete(v);
    this.minions.delete(v);
  }

  /** Cars still in the fight (alive or waiting to respawn), minions excluded. */
  contenders() {
    return this.vehicles.filter((v) => !this.eliminated.has(v) && !this.minions.has(v));
  }

  step(dt: number, playerInput: DriveInput = NO_INPUT) {
    this.time += dt;
    for (const v of [...this.vehicles]) {
      const input = v === this.player ? playerInput : this.bots.find((b) => b.v === v)?.think(dt) ?? NO_INPUT;
      v.fixedUpdate(dt, input);
      this.combat.control(v, input, dt);
      if (!v.alive && v.deadTime > RESPAWN_DELAY && !this.eliminated.has(v)) {
        const s = this.safestSpawn(v);
        v.respawn(s.pos, s.yaw);
      }
    }
    this.world.timestep = dt;
    this.world.step();
    this.vehicles.forEach((v) => v.snapshot());
    this.combat.step(dt);
    this.arena.update(dt);
    this.handleFalls();
    this.pickups.update(dt, this.time, this.vehicles, (v, label) => this.onFeed?.(label, v));
    this.bossCollapse();
    // Drones vanish once their wreck has burned out.
    for (const m of [...this.minions]) if (!m.alive && m.deadTime > RESPAWN_DELAY) this.removeCar(m);
    this.checkEnd();
  }

  private handleKill(victim: Vehicle, killer: Vehicle | null) {
    const left = (this.lives.get(victim) ?? Infinity) - 1;
    this.lives.set(victim, left);
    if (left <= 0) this.eliminated.add(victim);
    if (victim === this.boss) for (const m of this.minions) if (m.alive) this.combat.damage(m, Infinity, null);
    this.onFeed?.(
      !killer ? `${victim.name} was wrecked by ${this.arena.def.name}` : killer !== victim ? `${killer.name} wrecked ${victim.name}` : `${victim.name} self-destructed`,
      null,
    );
    if (left <= 0 && !this.minions.has(victim)) this.onFeed?.(`${victim.name} is out!`, null);
    this.onKill?.(victim, killer);
  }

  private summon(owner: Vehicle, count: number) {
    for (let i = 0; i < count && this.minions.size < MAX_MINIONS; i++) {
      const side = i % 2 ? 1 : -1;
      const p = owner.local(-owner.def.half.x - 4, 1.5, side * 4);
      const yaw = new THREE.Euler().setFromQuaternion(owner.rotation, 'YXZ').y;
      const d = this.addCar(DRONE, 'Collector Drone', { pos: p, yaw }, 1, this.opts.difficulty);
      this.minions.add(d);
    }
  }

  /** Boss stage: each HP threshold drops the next ring of the roof (spec §7 Penthouse Lot). */
  private bossCollapse() {
    const b = this.boss;
    if (!b || !this.arena.event || this.collapsesDone >= BOSS_COLLAPSE_AT.length) return;
    if (b.hp / b.maxHp <= BOSS_COLLAPSE_AT[this.collapsesDone] || this.eliminated.has(b)) {
      this.collapsesDone++;
      this.arena.event.trigger();
    }
  }

  private checkEnd() {
    if (this.result) return;
    const p = this.player;
    if (p) {
      if (this.eliminated.has(p)) this.result = { won: false, winner: null, reason: 'player-eliminated' };
      else if (!this.opts.endless && this.contenders().every((v) => v === p)) this.result = { won: true, winner: p, reason: 'opponents-eliminated' };
    } else {
      const left = this.contenders();
      if (left.length <= 1 && this.lives.size > 1 && Number.isFinite(this.opts.lives?.bots ?? Infinity)) {
        this.result = { won: false, winner: left[0] ?? null, reason: 'last-standing' };
      }
    }
  }

  /** Spec §7: falling off the map costs 25% armor and drops you at the nearest spawn. */
  private handleFalls() {
    for (const v of this.vehicles) {
      if (!v.alive || v.position.y > KILL_Y) continue;
      this.falls++;
      const blame = v.lastHitAgo < 5 ? v.lastAttacker : null; // whoever knocked you off gets the kill
      this.combat.damage(v, v.maxHp * 0.25, blame);
      if (!v.alive) continue;
      const s = this.arena.nearestSpawn(v.position);
      v.recoverAt(s.pos, s.yaw);
    }
  }

  /** Spawn point farthest from every other living vehicle. */
  private safestSpawn(v: Vehicle | null) {
    const others = this.vehicles.filter((o) => o !== v && o.alive);
    const score = (s: Spawn) => Math.min(...others.map((o) => o.position.distanceTo(s.pos)), Infinity);
    return this.arena.spawns.reduce((best, s) => (score(s) > score(best) ? s : best));
  }
}
