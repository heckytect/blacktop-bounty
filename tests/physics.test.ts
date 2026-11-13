import { beforeAll, expect, test } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vehicle } from '../src/vehicle';
import { Combat, WEAPONS } from '../src/weapons';
import { VEHICLES } from '../src/data/vehicles';
import { NO_INPUT } from '../src/input';

beforeAll(() => RAPIER.init());

const STEP = 1 / 60;
const byId = (id: string) => VEHICLES.find((d) => d.id === id)!;

function arena() {
  const world = new RAPIER.World({ x: 0, y: -20, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(500, 1, 500).setTranslation(0, -1, 0));
  return { world, scene: new THREE.Scene() };
}

function run(world: RAPIER.World, vehicles: Vehicle[], seconds: number, input = NO_INPUT, combat?: Combat) {
  for (let i = 0; i < seconds / STEP; i++) {
    for (const v of vehicles) {
      v.fixedUpdate(STEP, v === vehicles[0] ? input : NO_INPUT);
      combat?.control(v, v === vehicles[0] ? input : NO_INPUT, STEP);
    }
    world.timestep = STEP;
    world.step();
    vehicles.forEach((v) => v.snapshot());
    combat?.step(STEP);
  }
}

/** Speed after 3 s of full throttle and yaw rate while steering at speed. */
function measure(id: string) {
  const { world, scene } = arena();
  const v = new Vehicle(world, scene, byId(id), 'test', { pos: new THREE.Vector3(0, 1.5, 0), yaw: 0 });
  run(world, [v], 0.5);
  run(world, [v], 3, { ...NO_INPUT, throttle: 1 });
  const speed3s = v.speed;
  const yaw = () => new THREE.Euler().setFromQuaternion(v.rotation, 'YXZ').y;
  const y0 = yaw();
  run(world, [v], 0.5, { ...NO_INPUT, throttle: 1, steer: 1 });
  return { speed3s, turnRate: Math.abs(yaw() - y0) / 0.5 };
}

test('stats change feel measurably (spec §5)', () => {
  const iron = measure('big-iron'); // speed 1, handling 1
  const devil = measure('dust-devil'); // speed 4, handling 3
  const moth = measure('mojave-moth'); // speed 5, handling 5
  console.table({ iron, devil, moth });
  expect(devil.speed3s).toBeGreaterThan(iron.speed3s * 1.15);
  expect(moth.speed3s).toBeGreaterThan(devil.speed3s);
  expect(moth.turnRate).toBeGreaterThan(iron.turnRate * 1.15);
});

test('homing missile keeps its speed and hits', () => {
  const { world, scene } = arena();
  const shooter = new Vehicle(world, scene, byId('dust-devil'), 'a', { pos: new THREE.Vector3(0, 1.5, 0), yaw: 0 });
  const target = new Vehicle(world, scene, byId('big-iron'), 'b', { pos: new THREE.Vector3(35, 1.5, 6), yaw: 0 });
  const combat = new Combat(world, scene, [shooter, target]);
  run(world, [shooter, target], 0.5);
  const p = combat.launch(shooter, WEAPONS.homing, shooter.local(2.5, 0.5, 0), shooter.forward().multiplyScalar(40), target);
  run(world, [shooter, target], 0.2, NO_INPUT, combat);
  expect(p.vel.length()).toBeCloseTo(40, 0);
  run(world, [shooter, target], 1.5, NO_INPUT, combat);
  expect(target.hp).toBe(target.maxHp - WEAPONS.homing.damage);
});
