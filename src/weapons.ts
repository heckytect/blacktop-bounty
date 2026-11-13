import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { NO_INPUT, type DriveInput } from './input';
import { ENERGY, type Vehicle } from './vehicle';
import type { Fx as Particles } from './fx';

export type WeaponId = 'homing' | 'power' | 'ricochet';

/** Anything that flies, rolls or sits on the ground and goes boom. */
export interface ProjectileDef {
  name: string;
  damage: number;
  speed: number; // m/s
  life: number; // s before detonating (or fizzling)
  color: number;
  size: number;
  shape: 'missile' | 'ball' | 'box' | 'strip';
  homing?: number; // turn rate toward target
  bounces?: number;
  knockback?: number; // m/s velocity change on direct hit
  splash?: number; // m, default SPLASH_RADIUS
  gravity?: number; // m/s², lobbed
  sticky?: boolean; // stops when it lands instead of exploding
  proximity?: number; // m, detonates when a car gets this close
  armTime?: number; // s the shooter is ignored by proximity/ray checks
  fizzle?: boolean; // expires silently
  stun?: number; // s of stun on direct hit
  freeze?: number; // s frozen on direct hit (energy move)
  wiggle?: number; // lateral snaking strength
  fire?: { radius: number; dps: number; time: number }; // burning ground left behind
}

export interface WeaponDef extends ProjectileDef {
  pickupAmmo: number;
}

// Spec §6. Tune here.
export const WEAPONS: Record<WeaponId, WeaponDef> = {
  homing: { name: 'Homing Missile', pickupAmmo: 4, damage: 15, speed: 40, life: 4, homing: 3, knockback: 4, color: 0xffd23f, size: 0.22, shape: 'missile' },
  power: { name: 'Power Missile', pickupAmmo: 2, damage: 35, speed: 60, life: 3, knockback: 14, color: 0xff3b2f, size: 0.32, shape: 'missile' },
  ricochet: { name: 'Ricochet Bomb', pickupAmmo: 2, damage: 30, speed: 32, life: 6, bounces: 3, knockback: 8, color: 0x7cf0ff, size: 0.45, shape: 'ball' },
};
export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];

// Spec §4 energy moves fired from the energy bar.
const FREEZE_BOLT: ProjectileDef = { name: 'Freeze Blast', damage: 5, speed: 70, life: 2, homing: 4, freeze: 2.5, splash: 0, knockback: 1, color: 0x8fe8ff, size: 0.3, shape: 'ball' };
const ENERGY_MINE: ProjectileDef = {
  name: 'Mine', damage: 30, speed: 0, life: 20, gravity: 20, sticky: true, proximity: 2.5, armTime: 1, splash: 4, knockback: 8, color: 0x8a1f1f, size: 0.6, shape: 'box',
};

export const MG = { damage: 2, rate: 12, range: 150, spread: 0.012, heatPerSec: 1 / 4, coolPerSec: 0.5, autoAim: 0.2 };
const SPLASH_RADIUS = 5;
const HOMING_LOCK_CONE = 1.0; // rad
const OWNER_SAFE_TIME = 0.3; // projectiles ignore their shooter briefly
const MIRROR_RADIUS = 3.5;

interface Projectile {
  mesh: THREE.Mesh;
  def: ProjectileDef;
  owner: Vehicle;
  vel: THREE.Vector3;
  age: number;
  bounces: number;
  target: Vehicle | null;
  active: boolean;
}

type FxKind = 'blast' | 'ring' | 'tracer' | 'beam';
interface Fx {
  kind: FxKind;
  obj: THREE.Mesh | THREE.Line;
  life: number;
  max: number;
  radius: number;
}

interface FireZone {
  pos: THREE.Vector3;
  radius: number;
  dps: number;
  time: number;
  owner: Vehicle;
  mesh: THREE.Mesh;
}

const X = new THREE.Vector3(1, 0, 0);
const sphereGeo = new THREE.SphereGeometry(1, 10, 8);
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true).rotateZ(Math.PI / 2); // along X
const fireGeo = new THREE.CylinderGeometry(1, 1, 0.3, 16);
const SHAPE_SCALE: Record<ProjectileDef['shape'], [number, number, number]> = {
  missile: [3, 1, 1],
  ball: [1, 1, 1],
  box: [2.4, 0.8, 1],
  strip: [0.5, 0.15, 5],
};

export class Combat {
  /** Trauma from blasts near the camera target, drained each frame by the feel layer (feel.ts). */
  shake = 0;
  /** Camera target; explosions near it shake the screen. */
  focus: Vehicle | null = null;
  /** Particle effects (browser only; headless tests run without). */
  particles: Particles | null = null;
  onKill?: (victim: Vehicle, killer: Vehicle | null) => void;
  /** Bullet hit something that isn't a car (arena props listen). */
  onStaticHit?: (c: RAPIER.Collider, damage: number, point: THREE.Vector3, from: Vehicle | null) => void;
  /** Sound hook (browser only). `by` is the shooter/attacker when there is one. */
  onSound?: (kind: 'gun' | 'launch' | 'explode' | 'hit' | 'laser', at: THREE.Vector3, by: Vehicle | null, size?: number) => void;
  /** Any damage that landed (browser feel layer listens). */
  onHurt?: (victim: Vehicle, amount: number, from: Vehicle | null, killed: boolean) => void;
  /** Boss special asks the match for minions. */
  onSummon?: (owner: Vehicle, count: number) => void;
  /** Any explosion (arena props listen). */
  onBlast?: (point: THREE.Vector3, radius: number, damage: number, from: Vehicle | null) => void;
  private projectiles: Projectile[] = [];
  private fx: Fx[] = [];
  private fires: FireZone[] = [];
  private mats = new Map<number, THREE.Material>();

  constructor(
    private world: RAPIER.World,
    private scene: THREE.Scene,
    readonly vehicles: Vehicle[],
  ) {}

  /** Per vehicle, per fixed step: gun, weapons, special and weapon cycling. */
  control(v: Vehicle, input: DriveInput, dt: number) {
    const prev = v.prevInput ?? NO_INPUT;
    v.prevInput = input;
    if (!v.alive) return;
    v.ability?.update(dt);

    if (input.nextWeapon && !prev.nextWeapon) cycleWeapon(v, 1);
    if (input.prevWeapon && !prev.prevWeapon) cycleWeapon(v, -1);
    if (input.special && !prev.special && v.special >= 1 && v.stun === 0 && v.ability && !v.ability.active) {
      v.special = 0;
      v.ability.activate();
    }

    const armed = v.stun === 0 && v.frozen === 0; // EMP / ice jams all weapons
    if (armed) this.energyMoves(v, input, prev);
    v.gunCooldown -= dt;
    if (input.fire && armed && !v.overheated) {
      v.heat = Math.min(1, v.heat + MG.heatPerSec * dt);
      if (v.heat >= 1) v.overheated = true;
      while (v.gunCooldown <= 0) {
        this.fireGun(v);
        v.gunCooldown += 1 / MG.rate;
      }
    } else {
      v.gunCooldown = Math.max(0, v.gunCooldown);
      v.heat = Math.max(0, v.heat - MG.coolPerSec * dt);
      if (v.overheated && v.heat < 0.3) v.overheated = false;
    }

    if (armed && input.fireWeapon && !prev.fireWeapon && v.weapon) this.fireWeapon(v, v.weapon);
  }

  /** Spec §4: freeze blast, shield, mine drop (jump is in the vehicle). Edge-triggered, paid from the energy bar. */
  private energyMoves(v: Vehicle, input: DriveInput, prev: DriveInput) {
    if (input.freeze && !prev.freeze && v.energy >= ENERGY.freeze) {
      v.energy -= ENERGY.freeze;
      const origin = v.local(v.def.half.x + 0.6, 0.3, 0);
      const target = this.closestInCone(v, origin, v.forward(), 0.6, 120);
      this.launch(v, FREEZE_BOLT, origin, v.forward().multiplyScalar(FREEZE_BOLT.speed), target);
    }
    if (input.shield && !prev.shield && v.energy >= ENERGY.shield && v.shield <= 0) {
      v.energy -= ENERGY.shield;
      v.shield = 3;
    }
    if (input.mine && !prev.mine && v.energy >= ENERGY.mine) {
      v.energy -= ENERGY.mine;
      this.launch(v, ENERGY_MINE, v.local(-v.def.half.x - 1.4, 0.3, 0), new THREE.Vector3(0, -1, 0));
    }
  }

  step(dt: number) {
    for (const p of this.projectiles) if (p.active) this.stepProjectile(p, dt);
    for (const f of this.fx) {
      if (f.life <= 0) continue;
      f.life -= dt;
      const t = 1 - Math.max(0, f.life) / f.max;
      const r = f.radius * (0.3 + 0.7 * t);
      if (f.kind === 'blast') f.obj.scale.setScalar(r);
      if (f.kind === 'ring') f.obj.scale.set(r, 0.15, r);
      (f.obj.material as THREE.MeshBasicMaterial).opacity = 1 - t;
      f.obj.visible = f.life > 0;
    }
    for (const z of this.fires) {
      if (z.time <= 0) continue;
      z.time -= dt;
      z.mesh.visible = z.time > 0;
      (z.mesh.material as THREE.MeshBasicMaterial).opacity = 0.45 + Math.random() * 0.25;
      if (Math.random() < 0.6) this.particles?.fire(z.pos, z.radius);
      for (const v of this.vehicles) if (v.alive && v.position.distanceTo(z.pos) < z.radius + 1) this.damage(v, z.dps * dt, z.owner);
    }
    // EMP-jammed cars crackle blue.
    for (const v of this.vehicles) {
      if (v.alive && v.stun > 0 && Math.random() < 0.25) {
        this.blast(v.position.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(1.2)), 0.6, 0x5aa0ff, 0.15);
      }
    }
  }

  /** srcPos lets front-shielded cars (Wheelie Barrage) ignore hits from ahead. Returns damage dealt. */
  damage(v: Vehicle, amount: number, from: Vehicle | null, srcPos?: THREE.Vector3) {
    if (!v.alive || v.invuln > 0) return 0;
    if (v.shield > 0) {
      this.particles?.sparks(v.position.clone().add(new THREE.Vector3(0, 1, 0)), 3, 0x5ab0ff);
      return 0;
    }
    if (v.frontShield > 0 && srcPos && v.forward().dot(srcPos.clone().sub(v.position)) > 0) return 0;
    if (from && from !== v) {
      v.lastAttacker = from;
      v.lastHitAgo = 0;
    }
    v.hp -= amount;
    if (from && from !== v) this.onSound?.('hit', v.position, from);
    this.onHurt?.(v, amount, from, v.hp <= 0);
    if (v.hp > 0) return amount;
    v.hp = 0;
    this.blast(v.position, 6, 0xffa040);
    v.kill();
    if (from && from !== v) from.kills++;
    this.onKill?.(v, from);
    return amount;
  }

  // --- machine gun --------------------------------------------------------
  fireGun(v: Vehicle, damage = MG.damage) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const origin = muzzle(v, side);
    const dir = this.aim(v, origin, MG.autoAim, MG.range);
    dir.x += (Math.random() - 0.5) * MG.spread * 2;
    dir.y += (Math.random() - 0.5) * MG.spread * 2;
    dir.z += (Math.random() - 0.5) * MG.spread * 2;
    dir.normalize();

    const hit = this.castRay(origin, dir, MG.range, v.body);
    const end = origin.clone().addScaledVector(dir, hit ? hit.timeOfImpact : MG.range);
    if (hit) {
      const victim = this.vehicleOf(hit.collider);
      if (victim?.mirror) this.blast(end, 0.6, 0xffffff, 0.1); // mirror ball shrugs off bullets
      else if (victim) this.damage(victim, damage, v, origin);
      else this.onStaticHit?.(hit.collider, damage, end, v);
      this.blast(end, 0.5, 0xffe08a, 0.1);
    }
    this.tracer(origin, end);
    this.particles?.muzzle(origin, dir);
    this.onSound?.('gun', origin, v);
  }

  /** Forward, or snapped to the closest enemy inside the cone. */
  aim(v: Vehicle, origin: THREE.Vector3, cone: number, range: number) {
    const fwd = v.forward();
    const target = this.closestInCone(v, origin, fwd, cone, range);
    return target ? target.position.clone().sub(origin).normalize() : fwd;
  }

  closestInCone(v: Vehicle, origin: THREE.Vector3, fwd: THREE.Vector3, cone: number, range: number) {
    let best: Vehicle | null = null;
    let bestAngle = cone;
    for (const e of this.vehicles) {
      if (e === v || !e.alive || e.phased) continue;
      const to = e.position.clone().sub(origin);
      if (to.length() > range) continue;
      const a = fwd.angleTo(to);
      if (a < bestAngle) [best, bestAngle] = [e, a];
    }
    return best;
  }

  /** Every car on the line until the first wall (Sun Lance). Returns the end point. */
  pierce(v: Vehicle, origin: THREE.Vector3, dir: THREE.Vector3, range: number, damage: number) {
    const hits: { toi: number; c: RAPIER.Collider }[] = [];
    this.world.intersectionsWithRay(new RAPIER.Ray(origin, dir), range, true, (h) => {
      hits.push({ toi: h.timeOfImpact, c: h.collider });
      return true;
    }, undefined, undefined, undefined, v.body);
    hits.sort((a, b) => a.toi - b.toi);
    let end = range;
    for (const h of hits) {
      const victim = this.vehicleOf(h.c);
      if (!victim) {
        end = h.toi;
        break;
      }
      if (!victim.phased) this.damage(victim, damage, v, origin);
    }
    return origin.clone().addScaledVector(dir, end);
  }

  // --- projectiles --------------------------------------------------------
  private fireWeapon(v: Vehicle, id: WeaponId) {
    const def = WEAPONS[id];
    const origin = muzzle(v, 0).add(new THREE.Vector3(0, 0.3, 0));
    const fwd = v.forward();
    const target = def.homing ? this.closestInCone(v, origin, fwd, HOMING_LOCK_CONE, 200) : null;
    const dir = target ? fwd : this.aim(v, origin, MG.autoAim, 200);
    this.launch(v, def, origin, dir.multiplyScalar(def.speed), target);

    const left = (v.ammo[id] ?? 0) - 1;
    if (left > 0) v.ammo[id] = left;
    else {
      delete v.ammo[id];
      cycleWeapon(v, 1);
    }
  }

  /** Spawn any projectile (weapons and specials share this). */
  launch(owner: Vehicle, def: ProjectileDef, origin: THREE.Vector3, vel: THREE.Vector3, target: Vehicle | null = null) {
    let p = this.projectiles.find((q) => !q.active);
    if (!p) {
      p = { mesh: new THREE.Mesh(sphereGeo), def, owner, vel: new THREE.Vector3(), age: 0, bounces: 0, target: null, active: false };
      this.scene.add(p.mesh);
      this.projectiles.push(p);
    }
    Object.assign(p, { def, owner, age: 0, bounces: def.bounces ?? 0, target, active: true });
    p.mesh.geometry = def.shape === 'box' || def.shape === 'strip' ? boxGeo : sphereGeo;
    p.mesh.material = this.mat(def.color);
    p.mesh.position.copy(origin);
    const [sx, sy, sz] = SHAPE_SCALE[def.shape];
    p.mesh.scale.set(def.size * sx, def.size * sy, def.size * sz);
    p.mesh.quaternion.setFromUnitVectors(X, owner.forward().setY(0).normalize());
    p.vel.copy(vel);
    p.mesh.visible = true;
    if (vel.lengthSq() > 1) this.onSound?.('launch', origin, owner); // dropped mines are silent
    return p;
  }

  private stepProjectile(p: Projectile, dt: number) {
    const { def } = p;
    const pos = p.mesh.position;
    p.age += dt;
    if (p.age > def.life) {
      if (def.fizzle) return this.retire(p);
      return this.detonate(p, pos.clone(), null);
    }
    const armed = p.age >= (def.armTime ?? OWNER_SAFE_TIME);

    // Proximity mines.
    if (def.proximity) {
      for (const v of this.vehicles) {
        if (!v.alive || v.phased || (v === p.owner && !armed)) continue;
        if (v.position.distanceTo(pos) < def.proximity) return this.detonate(p, pos.clone(), v);
      }
    }

    if (p.vel.lengthSq() < 1e-4) return; // resting mine

    // Mirror Ball: send it back where it came from.
    for (const v of this.vehicles) {
      if (v.mirror <= 0 || v === p.owner || v.position.distanceTo(pos) > MIRROR_RADIUS) continue;
      const shooter = p.owner;
      const speed = Math.max(p.vel.length(), 30);
      p.vel.copy(shooter.position).sub(pos).normalize().multiplyScalar(speed);
      Object.assign(p, { owner: v, target: shooter, age: 0 });
      this.blast(pos, 1.2, 0xffffff, 0.2);
      break;
    }

    if (def.homing && p.target?.alive && !p.target.phased) {
      const desired = p.target.position.clone().sub(pos).normalize();
      const speed = p.vel.length();
      p.vel.normalize().lerp(desired, Math.min(1, def.homing * dt)).setLength(speed);
    }
    if (def.wiggle) {
      const speed = p.vel.length();
      const side = new THREE.Vector3(-p.vel.z, 0, p.vel.x).normalize();
      p.vel.addScaledVector(side, Math.cos(p.age * 12) * def.wiggle * speed * dt).setLength(speed);
    }
    if (def.gravity) p.vel.y -= def.gravity * dt;

    const speed = p.vel.length();
    const dir = p.vel.clone().divideScalar(speed);
    const hit = this.castRay(pos, dir, speed * dt, armed ? undefined : p.owner.body);

    if (!hit) pos.addScaledVector(dir, speed * dt);
    else {
      const point = pos.clone().addScaledVector(dir, hit.timeOfImpact);
      const victim = this.vehicleOf(hit.collider);
      const n = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
      if (!victim && def.sticky) {
        p.vel.set(0, 0, 0);
        pos.copy(point).addScaledVector(n, def.size * 0.5);
        return;
      }
      if (victim || p.bounces <= 0) return this.detonate(p, point, victim);
      p.vel.reflect(n);
      p.bounces--;
      pos.copy(point).addScaledVector(n, 0.05);
    }
    if (def.shape === 'missile' || def.shape === 'ball') p.mesh.quaternion.setFromUnitVectors(X, p.vel.clone().normalize());
    if (def.shape === 'missile' && Math.round(p.age * 60) % 2 === 0) this.particles?.trail(pos);
  }

  private retire(p: Projectile) {
    p.active = false;
    p.mesh.visible = false;
  }

  private detonate(p: Projectile, point: THREE.Vector3, direct: Vehicle | null) {
    this.retire(p);
    const { def, owner } = p;
    const knock = def.knockback ?? 0;
    const radius = def.splash ?? SPLASH_RADIUS;
    if (direct?.alive) {
      const kickDir = p.vel.lengthSq() > 0 ? p.vel.clone().normalize() : direct.position.clone().sub(point).normalize();
      direct.body.applyImpulse(kickDir.setY(0.35).normalize().multiplyScalar(direct.body.mass() * knock), true);
      if (def.stun) direct.stun = Math.max(direct.stun, def.stun);
      if (def.freeze && direct.shield <= 0 && direct.invuln <= 0) direct.frozen = Math.max(direct.frozen, def.freeze);
      this.damage(direct, def.damage, owner, point);
    }
    // Splash (includes the shooter: ricochets can come back to bite you).
    this.explosion(point, radius, def.damage * 0.5, knock * 0.5, owner, def.color, direct);
    if (def.fire) this.ignite(point, def.fire, owner);
  }

  /** Area damage + knockback with linear falloff (projectiles, exploding props, arena events). */
  explosion(point: THREE.Vector3, radius: number, damage: number, knockback: number, owner: Vehicle | null, color: number, skip: Vehicle | null = null) {
    if (radius > 0) {
      for (const v of this.vehicles) {
        if (v === skip || !v.alive || v.phased) continue;
        const d = v.position.distanceTo(point);
        if (d >= radius) continue;
        const falloff = 1 - d / radius;
        const away = v.position.clone().sub(point).setY(0.5).normalize();
        v.body.applyImpulse(away.multiplyScalar(v.body.mass() * knockback * falloff), true);
        this.damage(v, damage * falloff, owner, point);
      }
      this.onBlast?.(point, radius, damage, owner);
    }
    this.blast(point, Math.max(2.5, radius * 0.5), color);
  }

  private ignite(point: THREE.Vector3, f: NonNullable<ProjectileDef['fire']>, owner: Vehicle) {
    let z = this.fires.find((q) => q.time <= 0);
    if (!z) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xff6a1a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      z = { pos: new THREE.Vector3(), radius: 0, dps: 0, time: 0, owner, mesh: new THREE.Mesh(fireGeo, mat) };
      this.scene.add(z.mesh);
      this.fires.push(z);
    }
    Object.assign(z, { radius: f.radius, dps: f.dps, time: f.time, owner });
    z.pos.copy(point).setY(0.15);
    z.mesh.position.copy(z.pos);
    z.mesh.scale.set(f.radius, 1, f.radius);
    z.mesh.visible = true;
  }

  // --- fx -----------------------------------------------------------------
  // ponytail: sphere flashes + line tracers stand in for sprite-sheet VFX (spec §8, M5).
  blast(pos: THREE.Vector3, radius: number, color: number, life = 0.45, kind: 'blast' | 'ring' = 'blast') {
    const closeness = this.focus ? 1 - this.focus.position.distanceTo(pos) / 40 : 0;
    if (closeness > 0) this.shake = Math.min(1, this.shake + closeness * radius * 0.08);
    if (kind === 'blast' && radius >= 2) this.onSound?.('explode', pos, null, radius);
    if (kind === 'blast' && this.particles) {
      if (radius < 1.2) this.particles.sparks(pos, 4, color);
      else this.particles.explosion(pos, radius, color);
      if (radius < 2) return; // big blasts keep a short flash sphere for punch
      life = 0.15;
    }
    const f = this.takeFx(kind, () => new THREE.Mesh(sphereGeo, this.fxMat()));
    Object.assign(f, { life, max: life, radius });
    (f.obj.material as THREE.MeshBasicMaterial).color.set(color);
    f.obj.position.copy(pos);
    f.obj.visible = true;
  }

  beam(a: THREE.Vector3, b: THREE.Vector3, color: number, width: number, life = 0.35) {
    this.onSound?.('laser', a, null);
    const f = this.takeFx('beam', () => new THREE.Mesh(beamGeo, this.fxMat()));
    Object.assign(f, { life, max: life, radius: width });
    (f.obj.material as THREE.MeshBasicMaterial).color.set(color);
    f.obj.position.copy(a).lerp(b, 0.5);
    f.obj.scale.set(a.distanceTo(b), width, width);
    f.obj.quaternion.setFromUnitVectors(X, b.clone().sub(a).normalize());
    f.obj.visible = true;
  }

  private tracer(a: THREE.Vector3, b: THREE.Vector3) {
    const f = this.takeFx('tracer', () => {
      const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(6, 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xfff1a8, transparent: true }));
      line.frustumCulled = false;
      return line;
    });
    Object.assign(f, { life: 0.05, max: 0.05 });
    const attr = f.obj.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.setXYZ(0, a.x, a.y, a.z);
    attr.setXYZ(1, b.x, b.y, b.z);
    attr.needsUpdate = true;
    f.obj.visible = true;
  }

  private takeFx(kind: FxKind, make: () => THREE.Mesh | THREE.Line) {
    const pool = kind === 'ring' ? 'blast' : kind; // rings are squashed blasts
    let f = this.fx.find((x) => x.life <= 0 && (x.kind === pool || (pool === 'blast' && x.kind === 'ring')));
    if (!f) {
      f = { kind, obj: make(), life: 0, max: 0, radius: 0 };
      this.scene.add(f.obj);
      this.fx.push(f);
    }
    f.kind = kind;
    f.obj.quaternion.identity();
    return f;
  }

  private fxMat() {
    return new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  }

  private mat(color: number) {
    if (!this.mats.has(color)) this.mats.set(color, new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.6 }));
    return this.mats.get(color)!;
  }

  /** Ray that ignores phased cars (Blink Boost) and optionally one body. */
  castRay(origin: THREE.Vector3, dir: THREE.Vector3, len: number, exclude?: RAPIER.RigidBody) {
    const pred = (c: RAPIER.Collider) => !this.vehicleOf(c)?.phased;
    return this.world.castRayAndGetNormal(new RAPIER.Ray(origin, dir), len, true, undefined, undefined, undefined, exclude, pred);
  }

  vehicleOf(c: RAPIER.Collider) {
    // ponytail: linear scan, fine for ≤ 8 vehicles.
    return this.vehicles.find((v) => v.collider.handle === c.handle) ?? null;
  }
}

/** Select the next/previous weapon that has ammo (null when empty). */
export function cycleWeapon(v: Vehicle, dir: 1 | -1) {
  const owned = WEAPON_IDS.filter((id) => (v.ammo[id] ?? 0) > 0);
  if (!owned.length) return (v.weapon = null);
  const i = v.weapon ? owned.indexOf(v.weapon) : -1;
  v.weapon = i < 0 ? owned[0] : owned[(i + dir + owned.length) % owned.length];
  return v.weapon;
}

function muzzle(v: Vehicle, side: number) {
  return v.local(v.def.half.x + 0.3, 0.35, side * Math.min(0.6, v.def.half.z * 0.7));
}
