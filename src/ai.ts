import * as THREE from 'three';
import { NO_INPUT, type DriveInput } from './input';
import { ENERGY, type Vehicle } from './vehicle';
import type { Combat } from './weapons';
import type { Pickups } from './pickups';
import type { Arena } from './arena';
import type { AiStyle } from './data/vehicles';

export type Difficulty = 'easy' | 'normal' | 'hard' | 'brutal';

// Spec §10: difficulty scales aim error, reaction delay and special usage.
export const DIFFICULTIES: Record<Difficulty, { aimError: number; reaction: number; fireCone: number; specialChance: number; weaponGap: number; energyChance: number }> = {
  easy: { aimError: 0.3, reaction: 0.6, fireCone: 0.12, specialChance: 0.15, weaponGap: 3.5, energyChance: 0.08 },
  normal: { aimError: 0.15, reaction: 0.35, fireCone: 0.18, specialChance: 0.4, weaponGap: 2, energyChance: 0.2 },
  hard: { aimError: 0.07, reaction: 0.2, fireCone: 0.22, specialChance: 0.7, weaponGap: 1.2, energyChance: 0.35 },
  brutal: { aimError: 0.02, reaction: 0.1, fireCone: 0.25, specialChance: 1, weaponGap: 0.6, energyChance: 0.6 },
};

const ENGAGE_RANGE: Record<AiStyle, number> = { aggressive: 70, rammer: 60, sniper: 100, hitAndRun: 70 };
const WAYPOINT_REACHED = 7;
const REPLAN_TIME = 3;
const LOW_HP = 0.25;
const MIN_STATE_TIME = 1.2; // s before switching to a non-urgent state (no dithering)
const STUCK_RADIUS = 6; // m; 2× the soak test's 3 m so anything it would flag, we catch first
const RELOCATE_AFTER = 4.5; // s; < the soak test's 5 s, with ~2 s after the 3-point turn to drive clear
const SAMPLE_EVERY = 0.25; // s

export type BotState = 'wander' | 'seekPickup' | 'engage' | 'flee' | 'seekHealth';

/** What a bot can see of the match. */
export interface BotWorld {
  vehicles: Vehicle[];
  combat: Combat;
  pickups: Pickups;
  arena: Arena;
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Spec §10 FSM: WANDER → SEEK_PICKUP → ENGAGE → FLEE (HP < 25%) → SEEK_HEALTH.
 * Decisions run every `reaction` seconds; steering runs every physics step.
 */
export class Bot {
  state: BotState = 'wander';
  target: Vehicle | null = null;
  relocations = 0; // times we gave up and hopped to a free node (should be rare)
  private readonly cfg: (typeof DIFFICULTIES)[Difficulty];
  private goal = new THREE.Vector3();
  private path: THREE.Vector3[] = [];
  private pathGoal = new THREE.Vector3(Infinity, 0, 0);
  private pathAge = 0;
  private direct = false; // clear line to goal: skip the path
  private stateTime = 0;
  private los = false;
  private aimOffset = 0; // rad, re-rolled each decision
  private thinkTimer = 0;
  private runAway = 0; // hit-and-run / sniper retreat time left
  private weaponTimer = 2;
  private specialPulse = false;
  private energyPulse: 'freeze' | 'shield' | 'mine' | null = null;
  energyUsed = 0; // energy moves fired (soak-test stat)
  // stuck handling
  private samples: THREE.Vector3[] = [];
  private sampleTimer = 0;
  private unstuckTries = 0;
  private reverseTime = 0; // 3-point turn: reverse with lock...
  private pullOutTime = 0; // ...then pull forward the other way
  private detourTime = 0; // after getting stuck: go somewhere else for a bit
  private reverseSteer = 1;
  private wantMove = false;
  private readonly orbitDir = Math.random() < 0.5 ? 1 : -1; // which way to circle in close combat

  constructor(
    readonly v: Vehicle,
    private w: BotWorld,
    difficulty: Difficulty,
  ) {
    this.cfg = DIFFICULTIES[difficulty];
  }

  think(dt: number): DriveInput {
    const v = this.v;
    if (!v.alive) {
      this.path = [];
      this.unstuckTries = this.reverseTime = this.pullOutTime = this.detourTime = 0;
      this.samples = [];
      return NO_INPUT;
    }

    this.thinkTimer -= dt;
    this.runAway = Math.max(0, this.runAway - dt);
    this.weaponTimer -= dt;
    this.pathAge += dt;
    this.detourTime = Math.max(0, this.detourTime - dt);
    this.stateTime += dt;
    if (this.thinkTimer <= 0) {
      this.thinkTimer = this.cfg.reaction;
      this.decide();
    }
    this.trackProgress(dt);

    if (this.reverseTime > 0) {
      this.reverseTime -= dt;
      this.wantMove = true;
      return { ...NO_INPUT, brake: 1, steer: this.reverseSteer };
    }
    if (this.pullOutTime > 0) {
      this.pullOutTime -= dt;
      this.wantMove = true;
      return { ...NO_INPUT, throttle: 1, steer: -this.reverseSteer };
    }

    const t = this.target;
    const dist = t ? t.position.distanceTo(v.position) : Infinity;
    const style = v.def.aiStyle;
    let throttle = 1;
    let aim: THREE.Vector3;

    if (this.state === 'engage' && t && !this.direct && this.path.length) {
      // Can see it but can't drive straight at it: go round along the nav path, still shooting.
      aim = this.path[0];
      if (v.position.distanceTo(aim) < WAYPOINT_REACHED) this.path.shift();
    } else if (this.state === 'engage' && t) {
      // Steer at the target, off by the difficulty's aim error.
      aim = t.position.clone().sub(v.position).applyAxisAngle(UP, this.aimOffset).add(v.position);
      if (style === 'sniper' && dist < 45) throttle = 0.35;
      const contact = v.def.half.x + t.def.half.x + 2;
      if (style === 'rammer' && dist < contact) {
        // Hit, back off, come round again.
        this.runAway = 1.2;
        this.state = 'flee';
        this.setGoal(this.awayFrom(t.position));
      } else if (style !== 'rammer' && dist < 12) {
        // Circle the target instead of shoving nose-to-nose.
        const to = t.position.clone().sub(v.position).setY(0).normalize();
        aim = t.position.clone().addScaledVector(new THREE.Vector3(-to.z, 0, to.x), 12 * this.orbitDir);
      }
      if ((style === 'hitAndRun' && dist < 14) || (style === 'sniper' && dist < 22)) {
        this.runAway = 2.5;
        this.state = 'flee';
        this.setGoal(this.awayFrom(t.position));
      }
    } else {
      aim = this.direct || !this.path.length ? this.goal : this.path[0];
      if (this.path.length && v.position.distanceTo(this.path[0]) < WAYPOINT_REACHED) this.path.shift();
      if ((this.state === 'seekHealth' || this.state === 'seekPickup') && v.position.distanceTo(this.goal) < 10) throttle = 0.7;
    }

    const angle = this.angleTo(aim);
    const abs = Math.abs(angle);
    const { bias, ahead, drop } = this.avoid();
    if (drop && v.speed > 6) {
      // Edge ahead: stand on the brakes and turn away rather than sail off.
      this.wantMove = true;
      return { ...NO_INPUT, brake: 1, steer: bias > 0 ? 1 : -1 };
    }
    const steer = THREE.MathUtils.clamp(angle * 2.5 + bias, -1, 1);
    const touching = this.touchingCar();
    if (Math.abs(v.speed) < 4 && (ahead > 0.75 || touching)) {
      // Nose against something (or tangled with another car): back off now rather than grinding.
      this.reverseTime = 0.8;
      this.pullOutTime = 0.5;
      // Reverse with opposite lock, then pull out toward the open side / away from the other car.
      const awaySide = touching ? -Math.sign(this.angleTo(touching.position)) || 1 : bias > 0 ? 1 : -1;
      this.reverseSteer = -awaySide;
    }
    this.wantMove = throttle > 0.2;

    // Weapons: judged against the real target, so aim error costs hits.
    const trueAbs = t ? Math.abs(this.angleTo(t.position)) : Infinity;
    const canShoot = !!t && this.los && this.state !== 'flee';
    const fireWeapon = canShoot && !!v.weapon && trueAbs < 0.3 && dist < 90 && this.weaponTimer <= 0;
    if (fireWeapon) this.weaponTimer = this.cfg.weaponGap * (0.7 + Math.random() * 0.6);
    const special = this.specialPulse;
    this.specialPulse = false;
    const energy = this.energyPulse;
    this.energyPulse = null;

    return {
      ...NO_INPUT,
      throttle,
      steer,
      handbrake: abs > 1.4 && v.speed > 15,
      fire: canShoot && trueAbs < this.cfg.fireCone && dist < 110,
      fireWeapon,
      special,
      freeze: energy === 'freeze',
      shield: energy === 'shield',
      mine: energy === 'mine',
    };
  }

  // --- decisions (every `reaction` s) ------------------------------------
  private decide() {
    const v = this.v;
    const { pickups } = this.w;
    const t = (this.target = this.pickTarget());
    const dist = t ? t.position.distanceTo(v.position) : Infinity;
    this.los = !!t && this.lineOfSight(t);
    this.aimOffset = (Math.random() * 2 - 1) * this.cfg.aimError;
    const style = v.def.aiStyle;

    if (this.detourTime > 0) {
      this.state = 'wander'; // keep the detour goal
    } else if (v.hp / v.maxHp < LOW_HP) {
      const health = pickups.nearest('health', v.position);
      if (t && dist < 30 && style !== 'rammer') this.enter('flee', this.awayFrom(t.position), true);
      else if (health) this.enter('seekHealth', health, true);
      else if (t) this.enter(this.los ? 'engage' : 'wander', t.position);
      else this.wander();
    } else if (this.runAway > 0) {
      this.state = 'flee'; // keep the retreat goal
    } else if (t && this.los && dist < ENGAGE_RANGE[style]) {
      this.enter('engage', t.position);
    } else {
      const weapon = !v.weapon ? pickups.nearest('weapon', v.position) : null;
      const special = v.special < 0.5 ? pickups.nearest('special', v.position) : null;
      if (weapon && weapon.distanceTo(v.position) < 90) this.enter('seekPickup', weapon);
      else if (special && special.distanceTo(v.position) < 40) this.enter('seekPickup', special);
      else if (t) this.enter('wander', t.position); // hunt the target along the nav graph
      else this.wander();
    }

    if (t && v.special >= 1 && this.wantsSpecial(dist) && Math.random() < this.cfg.specialChance) this.specialPulse = true;
    this.energyPulse = t && Math.random() < this.cfg.energyChance ? this.pickEnergyMove(t, dist) : null;
    if (this.energyPulse) this.energyUsed++;
    this.direct = this.clearLine(v.position, this.goal);
  }

  private enter(state: BotState, goal: THREE.Vector3, urgent = false) {
    const targetGone = this.state === 'engage' && !this.target?.alive;
    if (state !== this.state && this.stateTime < MIN_STATE_TIME && !urgent && !targetGone) {
      if (this.state === 'engage' && this.target) this.setGoal(this.target.position); // keep chasing
      return;
    }
    if (state !== this.state) this.stateTime = 0;
    this.state = state;
    this.setGoal(goal);
  }

  private wander() {
    this.state = 'wander';
    if (this.path.length && this.goal.distanceTo(this.v.position) > WAYPOINT_REACHED) return;
    const nodes = this.w.arena.nav.liveNodes();
    this.setGoal(nodes[Math.floor(Math.random() * nodes.length)]);
  }

  private setGoal(goal: THREE.Vector3) {
    this.goal.copy(goal);
    if (this.goal.distanceTo(this.pathGoal) > 10 || this.pathAge > REPLAN_TIME || !this.path.length) {
      this.path = this.w.arena.nav.path(this.v.position, this.goal);
      this.pathGoal.copy(this.goal);
      this.pathAge = 0;
    }
  }

  /** Weighted target choice: close, weak, and whoever just hit us. */
  private pickTarget() {
    const v = this.v;
    const fwd = v.forward();
    let best: Vehicle | null = null;
    let bestScore = Infinity;
    for (const e of this.w.vehicles) {
      if (e === v || !e.alive || e.phased) continue;
      const to = e.position.clone().sub(v.position);
      let score = to.length() / 100 + (e.hp / e.maxHp) * 0.4;
      if (v.lastAttacker === e && v.lastHitAgo < 5) score -= 0.6;
      if (e === this.target) score -= 0.35; // don't flip-flop
      if (fwd.angleTo(to) < 0.6) score -= 0.2;
      if (score < bestScore) [best, bestScore] = [e, score];
    }
    return best;
  }

  /** Spec §10: bots use energy moves too. Shield when under fire, freeze a lined-up target, mine a tailgater. */
  private pickEnergyMove(t: Vehicle, dist: number) {
    const v = this.v;
    const abs = Math.abs(this.angleTo(t.position));
    if (v.energy >= ENERGY.shield && v.shield <= 0 && (v.lastHitAgo < 0.6 || v.hp < v.maxHp * 0.3) && dist < 50) return 'shield';
    if (v.energy >= ENERGY.freeze && this.los && abs < 0.3 && dist < 50) return 'freeze';
    if (v.energy >= ENERGY.mine && abs > 2.4 && dist < 25) return 'mine';
    return null;
  }

  private wantsSpecial(dist: number) {
    const { ability, aiRange } = this.v.def;
    const abs = this.target ? Math.abs(this.angleTo(this.target.position)) : Infinity;
    if (ability === 'lastRites') return dist < 15 && abs > 2.4; // drop it on a tailgater
    if (ability === 'mirrorBall') return this.v.lastHitAgo < 1 || dist < aiRange; // pop it under fire
    return dist < aiRange && abs < 0.5 && this.los;
  }

  // --- steering helpers ---------------------------------------------------
  /** Signed angle to a point in the car's frame: positive = turn right. */
  private angleTo(p: THREE.Vector3) {
    const local = p.clone().sub(this.v.position).applyQuaternion(this.v.rotation.clone().invert());
    return Math.atan2(local.z, local.x);
  }

  /** Another car we're physically pressed against, if any. */
  private touchingCar() {
    const v = this.v;
    for (const o of this.w.vehicles) {
      if (o === v || !o.alive || o.phased) continue;
      if (o.position.distanceTo(v.position) < v.def.half.x + o.def.half.x + 0.8) return o;
    }
    return null;
  }

  /** Steering bias away from walls, crates and cars ahead (whiskers). */
  private avoid() {
    const v = this.v;
    const len = 4 + Math.max(8, Math.abs(v.speed)) * 0.5;
    // Two heights: body height for walls/cars, knee height for low stuff like ramp sides.
    const origins = [v.local(v.def.half.x + 0.2, 0, 0), v.local(v.def.half.x + 0.2, -v.def.half.y + 0.35, 0)];
    const fwd = v.forward().setY(0).normalize();
    const probe = (a: number) =>
      Math.max(
        ...origins.map((origin) => {
          const hit = this.w.combat.castRay(origin, fwd.clone().applyAxisAngle(UP, a), len, v.body);
          const other = hit && this.w.combat.vehicleOf(hit.collider);
          const ignore = other && other === this.target && this.state === 'engage'; // rammers ram
          return hit && !ignore ? 1 - hit.timeOfImpact / len : 0; // 0 = clear, 1 = touching
        }),
      );
    // Ledges: no ground a few metres ahead counts as a wall (chasms, roof edges).
    const ledge = (a: number) => {
      const p = v.position.clone().addScaledVector(fwd.clone().applyAxisAngle(UP, a), 4 + Math.abs(v.speed) * 0.45);
      return this.groundBelow(p, v.position.y) ? 0 : 1;
    };
    const left = Math.max(probe(0.45), ledge(0.5)); // +Y rotation turns +X toward -Z = left
    const right = Math.max(probe(-0.45), ledge(-0.5));
    const drop = ledge(0);
    const ahead = Math.max(probe(0), drop);
    let bias = (left - right) * 1.2;
    if (ahead > 0) bias += (left > right ? 1 : -1) * ahead * 1.5;
    return { bias, ahead, drop: drop > 0 };
  }

  private lineOfSight(t: Vehicle) {
    const from = this.v.position;
    const dir = t.position.clone().sub(from);
    const hit = this.w.combat.castRay(from, dir.clone().normalize(), dir.length(), this.v.body);
    return !hit || !!this.w.combat.vehicleOf(hit.collider);
  }

  /** Car-wide clear line to a point (walls/crates only). */
  /** Is there drivable ground under p (no more than a short drop below `fromY`)? */
  private groundBelow(p: THREE.Vector3, fromY: number) {
    const hit = this.w.combat.castRay(new THREE.Vector3(p.x, fromY + 3, p.z), new THREE.Vector3(0, -1, 0), 9, this.v.body);
    return !!hit;
  }

  private clearLine(a: THREE.Vector3, b: THREE.Vector3) {
    const dir = b.clone().sub(a).setY(0);
    const len = dir.length();
    if (len < 1) return true;
    dir.normalize();
    // Ground all the way (a straight line over a chasm isn't clear).
    for (let d = 4; d < len; d += 4) if (!this.groundBelow(a.clone().addScaledVector(dir, d), Math.max(a.y, b.y))) return false;
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(1.2);
    return [0, 1, -1].every((k) => {
      const hit = this.w.combat.castRay(a.clone().addScaledVector(side, k), dir, len, this.v.body);
      return !hit || !!this.w.combat.vehicleOf(hit.collider);
    });
  }

  /** Last resort when wedged (wall + another car): hop to the nearest free nav node toward the centre. */
  private relocate() {
    const v = this.v;
    const inward = v.position.clone().multiplyScalar(0.85);
    const free = this.w.arena.nav
      .liveNodes()
      .filter((n) => n.distanceTo(v.position) > 15) // actually somewhere else
      .filter((n) => this.w.vehicles.every((o) => o === v || !o.alive || o.position.distanceTo(n) > 8))
      .sort((a, b) => a.distanceTo(inward) - b.distanceTo(inward));
    const spot = free[0];
    if (!spot) return;
    this.relocations++;
    v.recoverAt({ x: spot.x, y: spot.y + 0.5, z: spot.z }, Math.atan2(spot.z, -spot.x)); // yaw facing the centre
    this.samples = [];
    this.unstuckTries = this.reverseTime = this.pullOutTime = 0;
    this.path = [];
    this.thinkTimer = 0;
  }

  private awayFrom(p: THREE.Vector3) {
    const lim = this.w.arena.halfSize - 15;
    const dest = this.v.position.clone().add(this.v.position.clone().sub(p).setY(0).setLength(50));
    dest.x = THREE.MathUtils.clamp(dest.x, -lim, lim);
    dest.z = THREE.MathUtils.clamp(dest.z, -lim, lim);
    const { nav } = this.w.arena;
    return nav.nodes[nav.nearest(dest)];
  }

  /**
   * Stuck = every position from the last N seconds is within STUCK_RADIUS of where we are now
   * (catches shuffling back and forth, not just standing still). After 1 s: 3-point turn +
   * detour. After RELOCATE_AFTER s (or 1 s beached with the wheels in the air): relocate.
   */
  private trackProgress(dt: number) {
    const v = this.v;
    this.sampleTimer -= dt;
    if (this.sampleTimer <= 0) {
      this.sampleTimer = SAMPLE_EVERY;
      this.samples.push(v.position.clone());
      if (this.samples.length > RELOCATE_AFTER / SAMPLE_EVERY + 2) this.samples.shift();
    }
    let n = 0; // how many recent samples are all near us
    for (let i = this.samples.length - 1; i >= 0 && this.samples[i].distanceTo(v.position) < STUCK_RADIUS; i--) n++;
    const stuckFor = Math.max(0, n - 1) * SAMPLE_EVERY;
    if (n < this.samples.length || stuckFor < 1) this.unstuckTries = stuckFor < 1 ? 0 : this.unstuckTries;

    if (v.flipped) return; // the vehicle's own auto-recover handles rollovers
    if (stuckFor >= RELOCATE_AFTER || (stuckFor >= 1 && !v.grounded)) return this.relocate();
    if (stuckFor < 1 || this.unstuckTries > 0) return;
    this.unstuckTries = 1;
    this.path = [];
    this.thinkTimer = 0; // re-plan as soon as we're free
    this.reverseTime = 1;
    this.pullOutTime = 0.6;
    // Back out with the wheel turned away from the goal, so the nose swings toward it.
    this.reverseSteer = this.angleTo(this.goal) > 0 ? -1 : 1;
    // Then head somewhere else for a while instead of retrying the same line.
    const near = this.w.arena.nav.liveNodes().filter((p) => {
      const d = p.distanceTo(v.position);
      return d > 15 && d < 45;
    });
    if (near.length) {
      this.detourTime = 3 + this.reverseTime + this.pullOutTime;
      this.state = 'wander';
      this.setGoal(near[Math.floor(Math.random() * near.length)]);
      this.direct = false;
    }
  }

}
