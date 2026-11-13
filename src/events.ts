import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { ArenaEvent, EventContext, Prop } from './arena';
import type { Vehicle } from './vehicle';

// Arena hazards (spec §7). Each can fire on its own schedule and via trigger() for tests.

const findProp = (ctx: EventContext, tag: string) => {
  const p = ctx.arena.props.find((q) => q.spec.tag === tag);
  if (!p) throw new Error(`arena ${ctx.arena.def.id} has no prop tagged "${tag}"`);
  return p;
};

/** Shoot the prop, it blows (the explosion itself comes from the prop's `explode` spec). */
export function propEvent(ctx: EventContext, name: string, tag: string, testOffset: THREE.Vector3, onBreak?: (p: Prop) => void): ArenaEvent {
  const prop = findProp(ctx, tag);
  const ev: ArenaEvent = {
    name,
    fired: 0,
    testPoint: prop.centre.clone().setY(prop.spec.pos[1] + 1.5).add(testOffset),
    trigger: () => ctx.arena.destroyProp(prop, null),
    update: () => {},
  };
  ctx.arena.onPropDestroyed.push((p) => {
    if (p !== prop) return;
    ev.fired++;
    onBreak?.(p);
  });
  return ev;
}

/** Physics body + mesh that the arena keeps in sync each step. */
function debris(ctx: EventContext, w: number, h: number, d: number, pos: THREE.Vector3, color: number, density = 5, mesh?: THREE.Object3D) {
  const body = ctx.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z));
  ctx.world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setDensity(density), body);
  const m = mesh ?? new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color, flatShading: true }));
  if (!m.parent) ctx.scene.add(m);
  ctx.arena.movers.push(() => {
    const t = body.translation();
    m.position.set(t.x, t.y, t.z);
    m.quaternion.copy(body.rotation() as THREE.QuaternionLike);
    if (t.y < -60) body.setEnabled(false); // fell out of the world
  });
  return body;
}

/** Copper Canyon: a runaway ore train crosses the arena every `every` s. */
export function trainEvent(ctx: EventContext, trackZ: number, opts = { every: 45, first: 20, speed: 30, damage: 60 }): ArenaEvent {
  const LEN = 36;
  const HALF_W = 1.8;
  const H = 3.2;
  const body = ctx.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -100, trackZ));
  ctx.world.createCollider(RAPIER.ColliderDesc.cuboid(LEN / 2, H / 2, HALF_W), body);

  const mesh = new THREE.Group();
  const loco = new THREE.Mesh(new THREE.BoxGeometry(10, H, HALF_W * 2), new THREE.MeshLambertMaterial({ color: 0x2f2f35, flatShading: true }));
  loco.position.x = LEN / 2 - 5;
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.6, 0.8), new THREE.MeshBasicMaterial({ color: 0xfff2a0 }));
  lamp.position.set(LEN / 2 + 0.1, 0.6, 0);
  mesh.add(loco, lamp);
  for (const x of [-LEN / 2 + 6, -LEN / 2 + 18]) {
    const car = new THREE.Mesh(new THREE.BoxGeometry(11, H * 0.8, HALF_W * 2), new THREE.MeshLambertMaterial({ color: 0x8a4b2a, flatShading: true }));
    car.position.set(x, -H * 0.1, 0);
    mesh.add(car);
  }
  mesh.visible = false;
  ctx.scene.add(mesh);

  const lim = ctx.arena.halfSize + LEN;
  let timer = opts.first;
  let x = 0;
  let dir = 1;
  let running = false;
  const hit = new Set<Vehicle>();
  const start = () => {
    running = true;
    dir = Math.random() < 0.5 ? 1 : -1;
    x = -dir * lim;
    hit.clear();
    mesh.visible = true;
    mesh.rotation.y = dir > 0 ? 0 : Math.PI;
    ev.fired++;
  };
  const ev: ArenaEvent = {
    name: 'Runaway ore train',
    fired: 0,
    testPoint: new THREE.Vector3(0, 1.5, trackZ),
    trigger: () => !running && start(),
    update: (dt) => {
      if (!running) {
        timer -= dt;
        if (timer <= 0) start();
        return;
      }
      x += dir * opts.speed * dt;
      const y = H / 2 + 0.2;
      body.setNextKinematicTranslation({ x, y, z: trackZ });
      mesh.position.set(x, y, trackZ);
      for (const v of ctx.vehicles) {
        if (!v.alive || hit.has(v)) continue;
        const dz = v.position.z - trackZ;
        if (Math.abs(v.position.x - x) > LEN / 2 + 1 || Math.abs(dz) > HALF_W + v.def.half.z + 0.8 || v.position.y > H + 2) continue;
        hit.add(v);
        const m = v.body.mass();
        v.body.applyImpulse({ x: dir * m * 10, y: m * 6, z: (Math.sign(dz) || 1) * m * 14 }, true);
        ctx.combat.damage(v, opts.damage, null);
        ctx.combat.blast(v.position, 2, 0xffd08a, 0.3);
      }
      if (Math.abs(x) > lim) {
        running = false;
        mesh.visible = false;
        body.setNextKinematicTranslation({ x: 0, y: -100, z: trackZ });
        timer = opts.every;
      }
    },
  };
  return ev;
}

/** Las Vistas: shoot the casino sign's pole and the board topples onto the road. */
export function fallingSignEvent(ctx: EventContext, tag: string, towardX: 1 | -1): ArenaEvent {
  const prop = findProp(ctx, tag);
  const [px, , pz] = prop.spec.pos;
  const BOARD = { w: 1, h: 7, d: 20 }; // long axis along Z (the road)
  let falling = 0;
  let board: RAPIER.RigidBody | null = null;
  const crushed = new Set<Vehicle>();
  const ev = propEvent(ctx, 'Casino sign collapse', tag, new THREE.Vector3(towardX * 12, 0, 0), () => {
    const mesh = prop.spec.extra?.clone() ?? undefined;
    if (mesh) mesh.position.set(0, 0, 0);
    board = debris(ctx, BOARD.w, BOARD.h, BOARD.d, new THREE.Vector3(px + towardX * 1.5, prop.spec.size[1] + BOARD.h / 2, pz), 0xff3fa4, 8, mesh);
    board.setAngvel({ x: 0, y: 0, z: -towardX * 1.2 }, true); // tip over toward the road
    board.setLinvel({ x: towardX * 8, y: 0, z: 0 }, true); // lands across the road
    falling = 4;
    crushed.clear();
  });
  ev.update = (dt) => {
    if (falling <= 0 || !board) return;
    falling -= dt;
    const t = board.translation();
    if (board.linvel().y > -3) return; // only a falling board crushes
    const box = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(t.x, t.y, t.z), new THREE.Vector3(BOARD.h + 2, BOARD.h + 2, BOARD.d + 2));
    for (const v of ctx.vehicles) {
      if (!v.alive || crushed.has(v) || !box.containsPoint(v.position)) continue;
      crushed.add(v);
      ctx.combat.damage(v, 70, null);
      ctx.combat.blast(v.position, 3, 0xff3fa4, 0.4);
    }
  };
  return ev;
}

/** Hoover Spillway: floodgates open and water sweeps cars down the channel. */
export function floodEvent(
  ctx: EventContext,
  zone: { minX: number; maxX: number; minZ: number; maxZ: number; maxY: number },
  downstream: THREE.Vector3,
  opts = { every: 50, first: 25, duration: 8, push: 18, dps: 5 },
): ArenaEvent {
  const water = new THREE.Mesh(
    new THREE.BoxGeometry(zone.maxX - zone.minX, 1, zone.maxZ - zone.minZ),
    new THREE.MeshLambertMaterial({ color: 0x3a8fd0, transparent: true, opacity: 0.55, depthWrite: false }),
  );
  water.position.set((zone.minX + zone.maxX) / 2, 0, (zone.minZ + zone.maxZ) / 2);
  water.visible = false;
  ctx.scene.add(water);
  let timer = opts.first;
  let flooding = 0;
  const ev: ArenaEvent = {
    name: 'Floodgates open',
    fired: 0,
    testPoint: new THREE.Vector3((zone.minX + zone.maxX) / 2, zone.maxY / 2 + 2, (zone.minZ + zone.maxZ) / 2),
    trigger: () => {
      flooding = opts.duration;
      ev.fired++;
    },
    update: (dt) => {
      timer -= dt;
      if (timer <= 0 && flooding <= 0) {
        timer = opts.every;
        ev.trigger();
      }
      water.visible = flooding > 0;
      if (flooding <= 0) return;
      flooding -= dt;
      // Water sloshes down the channel: a tilted slab that bobs.
      water.position.y = zone.maxY * 0.5 + Math.sin(flooding * 4) * 0.4;
      water.scale.y = zone.maxY;
      for (const v of ctx.vehicles) {
        const p = v.position;
        if (!v.alive || p.x < zone.minX || p.x > zone.maxX || p.z < zone.minZ || p.z > zone.maxZ || p.y > zone.maxY + 2) continue;
        const m = v.body.mass();
        v.body.applyImpulse({ x: downstream.x * m * opts.push * dt, y: 0, z: downstream.z * m * opts.push * dt }, true);
        ctx.combat.damage(v, opts.dps * dt, null);
      }
    },
  };
  return ev;
}

/** Roswell: a bomber passes over and drops bombs where cars are heading. */
export function bomberEvent(ctx: EventContext, opts = { every: 40, first: 15, altitude: 45, targets: 3, radius: 8, damage: 40 }): ArenaEvent {
  const half = ctx.arena.halfSize;
  const plane = new THREE.Group();
  const m = new THREE.MeshLambertMaterial({ color: 0x5b6470, flatShading: true });
  plane.add(new THREE.Mesh(new THREE.BoxGeometry(22, 3, 3), m));
  const wing = new THREE.Mesh(new THREE.BoxGeometry(5, 0.6, 34), m);
  plane.add(wing);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(3, 4, 0.5), m);
  tail.position.set(-10, 2, 0);
  plane.add(tail);
  plane.visible = false;
  ctx.scene.add(plane);

  type Drop = { at: THREE.Vector3; delay: number; y: number; vy: number; bomb: THREE.Mesh; marker: THREE.Mesh };
  const drops: Drop[] = [];
  let timer = opts.first;
  let flight = 0;
  let laneZ = 0;
  const bombGeo = new THREE.SphereGeometry(0.6, 8, 6);
  const markerGeo = new THREE.RingGeometry(opts.radius * 0.8, opts.radius, 24).rotateX(-Math.PI / 2);

  const groundY = (x: number, z: number) => {
    const hit = ctx.world.castRay(new RAPIER.Ray({ x, y: 60, z }, { x: 0, y: -1, z: 0 }), 120, true, undefined, undefined, undefined, undefined, (c) => !ctx.combat.vehicleOf(c));
    return hit ? 60 - hit.timeOfImpact : 0;
  };

  const ev: ArenaEvent = {
    name: 'Bomber run',
    fired: 0,
    testPoint: new THREE.Vector3(0, 1.5, 0),
    trigger: () => {
      ev.fired++;
      flight = 7;
      laneZ = (Math.random() * 2 - 1) * half * 0.5;
      plane.visible = true;
      const alive = ctx.vehicles.filter((v) => v.alive).sort(() => Math.random() - 0.5).slice(0, opts.targets);
      alive.forEach((v, i) => {
        const lv = v.body.linvel();
        const x = v.position.x + lv.x * 1.6;
        const z = v.position.z + lv.z * 1.6;
        const at = new THREE.Vector3(x, groundY(x, z), z);
        const bomb = new THREE.Mesh(bombGeo, new THREE.MeshLambertMaterial({ color: 0x222222 }));
        const marker = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
        marker.position.copy(at).setY(at.y + 0.1);
        bomb.visible = false;
        ctx.scene.add(bomb, marker);
        drops.push({ at, delay: 0.6 + i * 0.5, y: opts.altitude, vy: 0, bomb, marker });
      });
    },
    update: (dt) => {
      timer -= dt;
      if (timer <= 0) {
        timer = opts.every;
        ev.trigger();
      }
      if (flight > 0) {
        flight -= dt;
        plane.position.set(-half - 40 + (1 - flight / 7) * (half * 2 + 80), opts.altitude + 5, laneZ);
        plane.visible = flight > 0;
      }
      for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i];
        d.delay -= dt;
        if (d.delay > 0) continue;
        d.vy -= 25 * dt;
        d.y += d.vy * dt;
        d.bomb.visible = true;
        d.bomb.position.set(d.at.x, d.y, d.at.z);
        if (d.y > d.at.y) continue;
        ctx.combat.explosion(d.at, opts.radius, opts.damage, 10, null, 0xff6a2a);
        ctx.scene.remove(d.bomb, d.marker);
        drops.splice(i, 1);
      }
    },
  };
  return ev;
}

/** Painted Mesa: destroy the rope bridge and the chasm opens (bots stop pathing over it). */
export function bridgeEvent(ctx: EventContext, tag: string, navRect: [number, number, number, number]): ArenaEvent {
  return propEvent(ctx, 'Bridge collapse', tag, new THREE.Vector3(0, 0, 0), () => ctx.arena.nav.removeArea(...navRect));
}

export interface Slab {
  collider: RAPIER.Collider;
  mesh: THREE.Mesh;
  size: [number, number, number];
  rect: [number, number, number, number];
}

/** Penthouse Lot: roof edges drop away in stages (timed in deathmatch; the boss fight calls trigger()). */
export function collapseEvent(ctx: EventContext, stages: Slab[][], times = [60, 120, 180]): ArenaEvent {
  let stage = 0;
  const ev: ArenaEvent = {
    name: 'Roof collapse',
    fired: 0,
    testPoint: (() => {
      const r = stages[0][0].rect;
      return new THREE.Vector3((r[0] + r[1]) / 2, 1.5, (r[2] + r[3]) / 2);
    })(),
    trigger: () => {
      if (stage >= stages.length) return;
      for (const s of stages[stage]) {
        const t = s.collider.translation();
        ctx.world.removeCollider(s.collider, false);
        ctx.arena.nav.removeArea(...s.rect);
        const body = debris(ctx, ...s.size, new THREE.Vector3(t.x, t.y, t.z), 0, 20, s.mesh);
        body.setAngvel({ x: (Math.random() - 0.5) * 0.6, y: 0, z: (Math.random() - 0.5) * 0.6 }, true);
        ctx.combat.blast(new THREE.Vector3(t.x, 0, t.z), 6, 0xbbbbbb, 0.6);
      }
      stage++;
      ev.fired++;
    },
    update: () => {
      if (stage < times.length && ctx.time() >= times[stage]) ev.trigger();
    },
  };
  return ev;
}
