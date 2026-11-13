import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { DriveInput } from './input';
import type { WeaponId } from './weapons';
import { stats, wheelLayout, SUSPENSION_REST, type VehicleDef } from './data/vehicles';
import { cloneModel, vehicleModel } from './models';

// Car local frame: +X forward, +Y up, +Z right (Rapier's default forward axis is X).
const REF_MASS = 800; // tuning below was done at this mass
const BRAKE_FORCE = 60;
const DRIFT_GRIP_RATIO = 0.7;
const REVERSE_TOP = 15;
const JUMP_SPEED = 9; // m/s added upward
const JUMP_COOLDOWN = 1.0;
const INVULN_TIME = 2;
const SELF_RIGHTING = 4; // arcade anti-roll assist strength (0 = off)
export const ENERGY = { max: 100, regen: 8, jump: 15, freeze: 25, shield: 30, mine: 20 }; // spec §4 energy moves

// Collision groups: (membership << 16) | filter. Phased cars only touch the world (group 1).
const GROUP_VEHICLE = 0x0002;
const GROUPS_NORMAL = (GROUP_VEHICLE << 16) | 0xffff;
const GROUPS_PHASED = (GROUP_VEHICLE << 16) | 0x0001;

export interface ActiveAbility {
  readonly active: boolean;
  activate(): void;
  update(dt: number): void;
  end(): void;
}

export class Vehicle {
  readonly mesh = new THREE.Group();
  /** Visual-only child of mesh; abilities tilt it (wheelie) without touching physics. */
  readonly pose: THREE.Group;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly maxHp: number;
  private readonly s: ReturnType<typeof stats>;
  private ctrl: RAPIER.DynamicRayCastVehicleController;
  private wheels: THREE.Object3D[];
  private layout: ReturnType<typeof wheelLayout>;
  private jumpTimer = 0;
  private flippedTimer = 0;
  // previous physics transform, for render interpolation
  private prevPos = new THREE.Vector3();
  private prevRot = new THREE.Quaternion();
  private currPos = new THREE.Vector3();
  private currRot = new THREE.Quaternion();

  // combat state (rules live in weapons.ts / abilities.ts)
  hp: number;
  alive = true;
  deadTime = 0;
  invuln = 0;
  kills = 0;
  deaths = 0;
  ammo: Partial<Record<WeaponId, number>> = {};
  weapon: WeaponId | null = null;
  heat = 0; // machine gun 0..1
  overheated = false;
  gunCooldown = 0;
  prevInput: DriveInput | null = null;
  special = 0; // 0..1 meter
  ability: ActiveAbility | null = null;
  stun = 0; // s left: no steering, no weapons
  mirror = 0; // s left: reflects projectiles
  frontShield = 0; // s left: immune to damage from the front
  phased = false;
  energy = ENERGY.max;
  shield = 0; // s left: blocks all damage (energy move)
  frozen = 0; // s left: no driving, no weapons (hit by a freeze blast)
  private shell: { shield: THREE.Mesh; ice: THREE.Mesh } | null = null;
  lastAttacker: Vehicle | null = null;
  lastHitAgo = Infinity; // s since last damage from another car

  constructor(
    world: RAPIER.World,
    scene: THREE.Scene,
    readonly def: VehicleDef,
    readonly name: string,
    spawn: { pos: THREE.Vector3; yaw: number },
  ) {
    this.s = stats(def);
    this.maxHp = this.hp = this.s.maxHp;
    const { half } = def;
    const m = this.s.mass;

    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawn.pos.x, spawn.pos.y, spawn.pos.z)
        .setRotation(yawQuat(spawn.yaw))
        .setLinearDamping(0.05)
        .setAngularDamping(0.6),
    );
    // Box inertia with extra roll resistance + lowered center of mass keeps it arcade-stable.
    const [w, h, l] = [half.z * 2, half.y * 2, half.x * 2];
    const inertia = { x: (m / 12) * (h * h + w * w) * 1.7, y: (m / 12) * (l * l + w * w), z: (m / 12) * (l * l + h * h) };
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
        .setMassProperties(m, { x: 0, y: -0.4, z: 0 }, inertia, { x: 0, y: 0, z: 0, w: 1 })
        .setFriction(0.3)
        .setCollisionGroups(GROUPS_NORMAL),
      this.body,
    );

    this.layout = wheelLayout(def);
    this.ctrl = world.createVehicleController(this.body);
    this.layout.forEach(([x, z], i) => {
      this.ctrl.addWheel({ x, y: -half.y + 0.1, z }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, SUSPENSION_REST, def.wheelR);
      this.ctrl.setWheelSuspensionStiffness(i, 28);
      this.ctrl.setWheelSuspensionCompression(i, 2.4);
      this.ctrl.setWheelSuspensionRelaxation(i, 2.8);
      this.ctrl.setWheelMaxSuspensionTravel(i, 0.4);
      this.ctrl.setWheelFrictionSlip(i, this.s.grip);
      this.ctrl.setWheelSideFrictionStiffness(i, 1);
    });

    this.pose = buildVehicleMesh(def);
    this.wheels = this.pose.children.filter((c) => c.name === 'wheel');
    this.mesh.add(this.pose);
    scene.add(this.mesh);
    this.snapshot();
    this.snapshot();
  }

  get speed() {
    return this.ctrl.currentVehicleSpeed(); // m/s, signed along forward
  }

  get topSpeed() {
    return this.s.topSpeed;
  }

  get position() {
    return this.currPos;
  }

  get rotation() {
    return this.currRot;
  }

  /** Unit forward vector in world space (local +X). */
  forward(out = new THREE.Vector3()) {
    return out.set(1, 0, 0).applyQuaternion(this.currRot);
  }

  /** Converts a car-local point (+X fwd, +Z right) to world space. */
  local(x: number, y: number, z: number) {
    return new THREE.Vector3(x, y, z).applyQuaternion(this.currRot).add(this.currPos);
  }

  kill() {
    this.ability?.end();
    this.alive = false;
    this.deadTime = 0;
    this.deaths++;
    this.mesh.visible = false;
    this.body.setEnabled(false);
  }

  respawn(pos: THREE.Vector3, yaw: number) {
    this.hp = this.maxHp;
    this.alive = true;
    this.invuln = INVULN_TIME;
    this.heat = 0;
    this.overheated = false;
    this.stun = this.mirror = this.frontShield = this.shield = this.frozen = 0;
    this.energy = ENERGY.max;
    this.mesh.visible = true;
    this.body.setEnabled(true);
    this.place(pos, yaw);
    this.snapshot();
    this.snapshot();
  }

  /** Phase through cars (Blink Boost). Projectiles skip phased cars in weapons.ts. */
  setPhased(on: boolean) {
    this.phased = on;
    this.collider.setCollisionGroups(on ? GROUPS_PHASED : GROUPS_NORMAL);
    this.mesh.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
        mat.transparent = on;
        mat.opacity = on ? 0.35 : 1;
      }
    });
  }

  private place(pos: THREE.Vector3Like, yaw: number) {
    this.body.setTranslation(pos, true);
    this.body.setRotation(yawQuat(yaw), true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.flippedTimer = 0;
  }

  /** Lying on its side or roof (auto-recover will flip it back). */
  get flipped() {
    return new THREE.Vector3(0, 1, 0).applyQuaternion(this.currRot).y < 0.3;
  }

  get grounded() {
    return this.layout.some((_, i) => this.ctrl.wheelIsInContact(i));
  }

  fixedUpdate(dt: number, input: DriveInput) {
    if (!this.alive) {
      this.deadTime += dt;
      return;
    }
    this.invuln = Math.max(0, this.invuln - dt);
    this.lastHitAgo += dt;
    this.stun = Math.max(0, this.stun - dt);
    this.mirror = Math.max(0, this.mirror - dt);
    this.frontShield = Math.max(0, this.frontShield - dt);
    if (!this.ability?.active) this.special = Math.min(1, this.special + dt / this.def.chargeTime);
    this.energy = Math.min(ENERGY.max, this.energy + ENERGY.regen * dt);
    this.shield = Math.max(0, this.shield - dt);
    this.frozen = Math.max(0, this.frozen - dt);
    if (this.frozen > 0) input = { ...input, throttle: 0, brake: 0, steer: 0, handbrake: false, jump: false }; // iced solid: it just slides

    const { topSpeed, mass, accel, grip, maxSteer } = this.s;
    const engineForce = mass * accel;
    const brakeForce = BRAKE_FORCE * (mass / REF_MASS);
    const speed = this.speed;
    // Less steering at speed so it stays controllable. Stunned cars can't steer.
    const steer = this.stun > 0 ? 0 : -input.steer * maxSteer * (1 / (1 + Math.abs(speed) * 0.07));

    // S brakes while rolling forward, reverses once nearly stopped.
    const reversing = input.brake > 0 && speed < 1;
    // Engine force fades to zero at top speed (simple governor, no gearbox).
    const fwdPull = input.throttle * engineForce * Math.max(0, 1 - speed / topSpeed);
    const revPull = reversing ? input.brake * engineForce * 0.6 * Math.max(0, 1 + speed / REVERSE_TOP) : 0;
    const engine = fwdPull - revPull;
    const brake = !reversing ? input.brake * brakeForce : 0;

    this.layout.forEach(([, , front], i) => {
      if (front) this.ctrl.setWheelSteering(i, steer);
      this.ctrl.setWheelEngineForce(i, front ? engine * 0.3 : engine * 0.7); // AWD, rear-biased
      this.ctrl.setWheelBrake(i, brake + (!front && input.handbrake ? brakeForce * 0.15 : 0));
      this.ctrl.setWheelFrictionSlip(i, !front && input.handbrake ? grip * DRIFT_GRIP_RATIO : grip);
    });

    this.jumpTimer -= dt;
    if (input.jump && this.jumpTimer <= 0 && this.grounded && this.energy >= ENERGY.jump) {
      this.energy -= ENERGY.jump;
      this.body.applyImpulse({ x: 0, y: mass * JUMP_SPEED, z: 0 }, true);
      this.jumpTimer = JUMP_COOLDOWN;
    }

    // Arcade anti-roll: a gentle torque back toward upright so hits rarely roll the car.
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.currRot);
    const right = up.clone().cross(new THREE.Vector3(0, 1, 0)).multiplyScalar(mass * SELF_RIGHTING * dt);
    this.body.applyTorqueImpulse(right, true);

    // Auto-recover when stuck upside down, or on demand.
    this.flippedTimer = up.y < 0.3 && this.body.linvel().y ** 2 < 1 ? this.flippedTimer + dt : 0;
    if (input.reset || this.flippedTimer > 1.5) this.recover(); // falling off the map is handled by Match

    this.ctrl.updateVehicle(dt);
  }

  /** Remove from physics and scene (summoned drones, finished survival waves). Geometry is shared with the model template. */
  dispose(world: RAPIER.World, scene: THREE.Scene) {
    this.ability?.end();
    world.removeVehicleController(this.ctrl);
    world.removeRigidBody(this.body);
    scene.remove(this.mesh);
    this.mesh.traverse((o) => {
      if (o instanceof THREE.Mesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
    });
  }

  /** Put the car upright at a given spot (bot unsticking). */
  recoverAt(pos: THREE.Vector3Like, yaw: number) {
    this.place(pos, yaw);
    this.snapshot();
    this.snapshot();
  }

  private recover() {
    const p = this.body.translation();
    const yaw = new THREE.Euler().setFromQuaternion(this.currRot, 'YXZ').y;
    this.place({ x: p.x, y: p.y + 2, z: p.z }, yaw);
  }

  /** Call after each physics step. */
  snapshot() {
    this.prevPos.copy(this.currPos);
    this.prevRot.copy(this.currRot);
    this.currPos.copy(this.body.translation() as THREE.Vector3Like);
    this.currRot.copy(this.body.rotation() as THREE.QuaternionLike);
  }

  /** Shield bubble + ice shell, created on first use. */
  private renderShells() {
    if (!this.shell && this.shield <= 0 && this.frozen <= 0) return;
    if (!this.shell) {
      const { x, y, z } = this.def.half;
      const shield = new THREE.Mesh(shellGeo, shieldMat);
      shield.scale.set(x + 1, y + 1.4, z + 1);
      const ice = new THREE.Mesh(new THREE.BoxGeometry(x * 2 + 0.4, y * 2 + 0.9, z * 2 + 0.4), iceMat);
      ice.position.y = 0.2;
      this.mesh.add(shield, ice);
      this.shell = { shield, ice };
    }
    this.shell.shield.visible = this.shield > 0;
    this.shell.shield.rotation.y += 0.05;
    this.shell.ice.visible = this.frozen > 0;
  }

  /** alpha = fraction of a physics step since the last snapshot. */
  render(alpha: number) {
    if (!this.alive) return;
    this.renderShells();
    this.mesh.visible = this.invuln === 0 || Math.floor(this.invuln * 10) % 2 === 0; // blink while invulnerable
    this.mesh.position.lerpVectors(this.prevPos, this.currPos, alpha);
    this.mesh.quaternion.slerpQuaternions(this.prevRot, this.currRot, alpha);
    const y0 = -this.def.half.y + 0.1;
    this.wheels.forEach((w, i) => {
      const [x, z] = this.layout[i];
      w.position.set(x, y0 - (this.ctrl.wheelSuspensionLength(i) ?? SUSPENSION_REST), z);
      w.rotation.y = this.ctrl.wheelSteering(i) ?? 0;
      w.children[0].rotation.z = -(this.ctrl.wheelRotation(i) ?? 0);
    });
  }
}

const shellGeo = new THREE.IcosahedronGeometry(1, 1);
// Shared by every car so the shaders compile once (no hitch on the first shield / freeze).
const shieldMat = new THREE.MeshBasicMaterial({ color: 0x5ab0ff, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending });
const iceMat = new THREE.MeshLambertMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.55, flatShading: true });

/** Blender model when loaded (src/models.ts), else the box-part placeholder from data. */
export function buildVehicleMesh(def: VehicleDef) {
  const group = new THREE.Group();
  const model = vehicleModel(def.id);
  if (model) group.add(cloneModel(model.body));
  else for (const p of def.parts) {
    const mat = new THREE.MeshLambertMaterial({ color: p.color, flatShading: true, emissive: p.glow ? p.color : 0x000000 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(...p.size), mat);
    m.position.set(...p.pos);
    m.castShadow = true;
    group.add(m);
  }
  const tire = new THREE.CylinderGeometry(def.wheelR, def.wheelR, 0.35, 12);
  tire.rotateX(Math.PI / 2); // axle along Z
  const hub = new THREE.BoxGeometry(def.wheelR * 0.8, def.wheelR * 0.85, 0.1); // makes spin visible
  const dark = new THREE.MeshLambertMaterial({ color: 0x222222, flatShading: true });
  const paint = new THREE.MeshLambertMaterial({ color: def.color, flatShading: true });
  for (const [x, z] of wheelLayout(def)) {
    const steerPivot = new THREE.Object3D();
    steerPivot.name = 'wheel';
    steerPivot.position.set(x, -def.half.y + 0.1 - SUSPENSION_REST, z);
    const spin = new THREE.Object3D();
    if (model) spin.add(cloneModel(model.wheel));
    else {
      const t = new THREE.Mesh(tire, dark);
      t.castShadow = true;
      spin.add(t, new THREE.Mesh(hub, paint));
    }
    steerPivot.add(spin);
    group.add(steerPivot);
  }
  return group;
}

function yawQuat(yaw: number) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
}
