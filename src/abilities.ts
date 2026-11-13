import * as THREE from 'three';
import type { ActiveAbility, Vehicle } from './vehicle';
import type { Combat, ProjectileDef } from './weapons';

// Spec §5.1: one small object per vehicle special. Numbers from the roster table.

interface Timed {
  duration: number;
  start?(): void;
  tick?(dt: number, t: number): void; // t = seconds since activation
  stop?(): void;
}

function timed(spec: Timed): ActiveAbility {
  let left = 0;
  return {
    get active() {
      return left > 0;
    },
    activate() {
      left = spec.duration;
      spec.start?.();
    },
    update(dt) {
      if (left <= 0) return;
      left -= dt;
      spec.tick?.(dt, spec.duration - left);
      if (left <= 0) spec.stop?.();
    },
    end() {
      if (left <= 0) return;
      left = 0;
      spec.stop?.();
    },
  };
}

const SIDEWINDER: ProjectileDef = {
  name: 'Sidewinder', damage: 18, speed: 34, life: 4, homing: 2.5, wiggle: 1.4, knockback: 3, splash: 3,
  color: 0xff8a3d, size: 0.2, shape: 'missile',
};
const COFFIN: ProjectileDef = {
  name: 'Coffin Bomb', damage: 70, speed: 0, life: 2, gravity: 20, sticky: true, proximity: 2.8, armTime: 0.6,
  knockback: 10, splash: 6, color: 0x5a3a28, size: 0.9, shape: 'box',
};
const SPIKE_STRIP: ProjectileDef = {
  name: 'Spike Strip', damage: 10, speed: 0, life: 12, gravity: 20, sticky: true, proximity: 2.5, armTime: 1,
  fizzle: true, stun: 3, splash: 0, knockback: 0, color: 0x9a9a9a, size: 1, shape: 'strip',
};
const TUMBLEWEED: ProjectileDef = {
  name: 'Tumbleweed', damage: 20, speed: 0, life: 5, gravity: 20, splash: 4, knockback: 5,
  fire: { radius: 3, dps: 6, time: 3 }, color: 0xc9a35a, size: 0.35, shape: 'ball',
};

const GOLD_BAR: ProjectileDef = {
  name: 'Gold Bar', damage: 18, speed: 0, life: 5, gravity: 20, splash: 4, knockback: 6, color: 0xffd23f, size: 0.4, shape: 'box',
};

const JACKKNIFE = { radius: 8, damage: 60, knock: 14, spin: 0.6 };
const HARVESTER = { dps: 18, reach: 1.2, duration: 3.5 }; // M7 balance: was 25 dps for 4 s
const ROADBLOCK = { range: 15, cone: Math.PI / 3, stun: 2.5 }; // M7 balance: was 3 s
const WHEELIE = { rate: 24, damage: 2, tilt: 0.35 };
const SUN_LANCE = { charge: 1, damage: 90, range: 200 };

export function createAbility(v: Vehicle, combat: Combat): ActiveAbility {
  const enemies = () => combat.vehicles.filter((e) => e !== v && e.alive);
  const half = v.def.half;

  switch (v.def.ability) {
    case 'sidewinder': {
      let fired = 0;
      return timed({
        duration: 0.5,
        start: () => (fired = 0),
        tick: (_, t) => {
          while (fired < 4 && t >= fired * 0.12) {
            const side = fired % 2 ? 1 : -1;
            const origin = v.local(half.x + 0.4, -half.y + 0.4, side * 0.6);
            const target = combat.closestInCone(v, origin, v.forward(), 1.2, 150);
            const dir = v.forward().applyAxisAngle(new THREE.Vector3(0, 1, 0), -side * 0.25);
            combat.launch(v, SIDEWINDER, origin, dir.multiplyScalar(SIDEWINDER.speed), target);
            fired++;
          }
        },
      });
    }

    case 'jackknife': {
      let dir = 1;
      return timed({
        duration: JACKKNIFE.spin,
        start: () => {
          dir = Math.random() < 0.5 ? 1 : -1;
          combat.blast(v.position, JACKKNIFE.radius, 0xffc04a, 0.5, 'ring');
          for (const e of enemies()) {
            if (e.position.distanceTo(v.position) > JACKKNIFE.radius) continue;
            const away = e.position.clone().sub(v.position).setY(0.4).normalize();
            e.body.applyImpulse(away.multiplyScalar(e.body.mass() * JACKKNIFE.knock), true);
            combat.damage(e, JACKKNIFE.damage, v);
          }
        },
        // Keep forcing the spin; tyre grip would otherwise kill it.
        tick: () => v.body.setAngvel({ x: 0, y: (dir * Math.PI * 2) / JACKKNIFE.spin, z: 0 }, true),
        stop: () => v.body.setAngvel({ x: 0, y: 0, z: 0 }, true),
      });
    }

    case 'lastRites':
      return timed({
        duration: 0.1,
        start: () => {
          const origin = v.local(-half.x - 1.6, 0.3, 0);
          combat.launch(v, COFFIN, origin, v.forward().multiplyScalar(-3));
        },
      });

    case 'blink':
      return timed({
        duration: 0.4,
        start: () => {
          v.setPhased(true);
          const vel = v.body.linvel();
          const boost = v.forward().multiplyScalar(20);
          v.body.setLinvel({ x: vel.x + boost.x, y: vel.y, z: vel.z + boost.z }, true);
        },
        stop: () => v.setPhased(false),
      });

    case 'harvester': {
      const blades = new THREE.Group();
      const mat = new THREE.MeshLambertMaterial({ color: 0xd0d0d0, emissive: 0x444444 });
      blades.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.2, 0.35), mat), new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.35, 2.2), mat));
      blades.position.set(half.x + 0.35, 0, 0);
      blades.visible = false;
      v.pose.add(blades);
      return timed({
        duration: HARVESTER.duration,
        start: () => (blades.visible = true),
        tick: (dt) => {
          blades.rotation.x += dt * 25;
          const front = v.local(half.x + 1.0, 0, 0);
          for (const e of enemies()) {
            if (e.position.distanceTo(front) > e.def.half.x + HARVESTER.reach) continue;
            combat.damage(e, HARVESTER.dps * dt, v, v.position);
            if (Math.random() < 0.3) combat.blast(front, 0.7, 0xffe08a, 0.12);
          }
        },
        stop: () => (blades.visible = false),
      });
    }

    case 'mirrorBall': {
      const ball = new THREE.Mesh(
        new THREE.IcosahedronGeometry(3.2, 1),
        new THREE.MeshPhongMaterial({ color: 0xffffff, specular: 0xffffff, shininess: 120, flatShading: true, transparent: true, opacity: 0.4, depthWrite: false }),
      );
      ball.visible = false;
      v.mesh.add(ball);
      return timed({
        duration: 4,
        start: () => {
          v.mirror = 4;
          ball.visible = true;
        },
        tick: (dt) => (ball.rotation.y += dt * 3),
        stop: () => {
          v.mirror = 0;
          ball.visible = false;
        },
      });
    }

    case 'roadblock':
      return timed({
        duration: 0.1,
        start: () => {
          const fwd = v.forward();
          for (const e of enemies()) {
            const to = e.position.clone().sub(v.position);
            if (to.length() < ROADBLOCK.range && fwd.angleTo(to) < ROADBLOCK.cone) e.stun = ROADBLOCK.stun;
          }
          combat.blast(v.local(ROADBLOCK.range * 0.4, 0, 0), ROADBLOCK.range * 0.6, 0x3a7bff, 0.5, 'ring');
          combat.blast(v.position, 4, 0xff3a3a, 0.3);
          combat.launch(v, SPIKE_STRIP, v.local(-half.x - 1.5, 0.3, 0), new THREE.Vector3(0, -1, 0));
        },
      });

    case 'wheelie': {
      let acc = 0;
      return timed({
        duration: 3,
        start: () => {
          acc = 0;
          v.frontShield = 3;
          v.pose.rotation.z = WHEELIE.tilt;
          v.pose.position.y = 0.4;
        },
        tick: (dt) => {
          acc += dt;
          while (acc >= 1 / WHEELIE.rate) {
            combat.fireGun(v, WHEELIE.damage);
            acc -= 1 / WHEELIE.rate;
          }
        },
        stop: () => {
          v.frontShield = 0;
          v.pose.rotation.z = 0;
          v.pose.position.y = 0;
        },
      });
    }

    case 'tumbleweed':
      return timed({
        duration: 0.1,
        start: () => {
          const origin = v.local(0, half.y + 0.8, 0);
          const target = combat.closestInCone(v, origin, v.forward(), 0.6, 60);
          // Flight time with vy=9, g=20 is 0.9 s; pick horizontal speed so bombs land on the target.
          const reach = target ? target.position.distanceTo(origin) : 22;
          const hSpeed = THREE.MathUtils.clamp(reach / 0.9, 10, 40);
          const base = target ? target.position.clone().sub(origin).setY(0).normalize() : v.forward().setY(0).normalize();
          for (const yaw of [-0.3, -0.15, 0, 0.15, 0.3]) {
            const vel = base.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiplyScalar(hSpeed * (1 - Math.abs(yaw) * 0.5));
            vel.y = 9;
            combat.launch(v, TUMBLEWEED, origin, vel);
          }
        },
      });

    case 'payday':
      return timed({
        duration: 0.1,
        start: () => {
          combat.onSummon?.(v, 2);
          const origin = v.local(0, v.def.half.y + 1, 0);
          const target = combat.closestInCone(v, origin, v.forward(), 1.2, 80);
          const base = target ? target.position.clone().sub(origin).setY(0).normalize() : v.forward().setY(0).normalize();
          const reach = target ? target.position.distanceTo(origin) : 25;
          for (let i = 0; i < 6; i++) {
            const vel = base.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), (i - 2.5) * 0.12).multiplyScalar(THREE.MathUtils.clamp(reach / 0.9, 10, 40) * (0.8 + Math.random() * 0.4));
            vel.y = 9;
            combat.launch(v, GOLD_BAR, origin, vel);
          }
        },
      });

    case 'none':
      return timed({ duration: 0 });

    case 'sunLance': {
      const glow = new THREE.Mesh(
        new THREE.SphereGeometry(1, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0x8ff8ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      glow.position.set(half.x + 0.6, 0.1, 0);
      glow.visible = false;
      v.pose.add(glow);
      let fired = false;
      return timed({
        duration: SUN_LANCE.charge + 0.15,
        start: () => {
          fired = false;
          glow.visible = true;
        },
        tick: (_, t) => {
          glow.scale.setScalar(0.1 + Math.min(1, t / SUN_LANCE.charge) * 0.6);
          if (fired || t < SUN_LANCE.charge) return;
          fired = true;
          glow.visible = false;
          const origin = v.local(half.x + 0.6, 0.1, 0);
          const dir = combat.aim(v, origin, 0.12, SUN_LANCE.range);
          const end = combat.pierce(v, origin, dir, SUN_LANCE.range, SUN_LANCE.damage);
          combat.beam(origin, end, 0x8ff8ff, 0.45, 0.4);
          combat.blast(end, 2, 0x8ff8ff);
        },
        stop: () => (glow.visible = false),
      });
    }
  }
}
