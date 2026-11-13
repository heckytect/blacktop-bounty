import * as THREE from 'three';
import type { Vehicle } from './vehicle';
import { WEAPONS, WEAPON_IDS } from './weapons';

export type PickupKind = 'health' | 'weapon' | 'special';

const RESPAWN_TIME = 20; // spec §6
const GRAB_RADIUS = 2.8;
const HEAL = 0.3; // of max armor
const COLORS: Record<PickupKind, number> = { health: 0x3fd46b, weapon: 0xff5a36, special: 0xb36bff };

interface Pickup {
  kind: PickupKind;
  pos: THREE.Vector3;
  mesh: THREE.Group;
  timer: number; // >0 while waiting to respawn
}

export class Pickups {
  private items: Pickup[];

  constructor(scene: THREE.Scene, points: { kind: PickupKind; pos: THREE.Vector3 }[]) {
    this.items = points.map(({ kind, pos }) => {
      const mesh = buildMesh(kind);
      mesh.position.copy(pos);
      scene.add(mesh);
      return { kind, pos, mesh, timer: 0 };
    });
  }

  /** Pickups currently on the field (radar). */
  available() {
    return this.items.filter((p) => p.timer <= 0);
  }

  /** Closest pickup of this kind that is currently available. */
  nearest(kind: PickupKind, from: THREE.Vector3) {
    let best: THREE.Vector3 | null = null;
    for (const p of this.items) {
      if (p.kind === kind && p.timer <= 0 && (!best || p.pos.distanceTo(from) < best.distanceTo(from))) best = p.pos;
    }
    return best;
  }

  /** Spins/bobs pickups, hands them to vehicles that drive through, respawns them. */
  update(dt: number, t: number, vehicles: Vehicle[], onGrab?: (v: Vehicle, label: string) => void) {
    for (const p of this.items) {
      if (p.timer > 0) {
        p.timer -= dt;
        p.mesh.visible = p.timer <= 0;
        continue;
      }
      const item = p.mesh.children[0];
      item.rotation.y = t * 2;
      item.position.y = 1.2 + Math.sin(t * 3) * 0.2;

      for (const v of vehicles) {
        if (!v.alive || v.position.distanceTo(p.pos) > GRAB_RADIUS) continue;
        const label = apply(p.kind, v);
        if (!label) continue;
        p.timer = RESPAWN_TIME;
        p.mesh.visible = false;
        onGrab?.(v, label);
        break;
      }
    }
  }
}

/** Gives the pickup to the vehicle; null means it was not needed (health at full). */
function apply(kind: PickupKind, v: Vehicle): string | null {
  if (kind === 'health') {
    if (v.hp >= v.maxHp) return null;
    v.hp = Math.min(v.maxHp, v.hp + HEAL * v.maxHp);
    return '+30% Health';
  }
  if (kind === 'special') {
    if (v.special >= 1) return null;
    v.special = 1;
    return `${v.def.abilityName} ready`;
  }
  const id = WEAPON_IDS[Math.floor(Math.random() * WEAPON_IDS.length)];
  v.ammo[id] = (v.ammo[id] ?? 0) + WEAPONS[id].pickupAmmo;
  v.weapon ??= id;
  return `+${WEAPONS[id].pickupAmmo} ${WEAPONS[id].name}`;
}

// ponytail: primitive placeholder meshes; swap for Blender models in M5.
function buildMesh(kind: PickupKind) {
  const color = COLORS[kind];
  const group = new THREE.Group();
  const item = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.4, flatShading: true });
  if (kind === 'health') {
    const white = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.3 });
    item.add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), mat));
    item.add(new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.3, 0.9), white), new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.9, 0.3), white));
  } else if (kind === 'special') {
    item.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.8), mat));
  } else {
    const band = new THREE.MeshLambertMaterial({ color: 0xffd23f, emissive: 0xffd23f, emissiveIntensity: 0.3 });
    item.add(new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.0, 1.0), mat));
    item.add(new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.25, 1.05), band));
  }
  // Tall light beam so pickups read from across the arena (spec §6).
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.2, 40, 6, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  beam.position.y = 20;
  group.add(item, beam);
  return group;
}
