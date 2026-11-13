import * as THREE from 'three';
import type { Vehicle } from './vehicle';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
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
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8, roughness: 0.3, metalness: 0.2 });
  if (kind === 'health') {
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.6, roughness: 0.3 });
    item.add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), mat));
    item.add(new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.3, 0.9), white), new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.9, 0.3), white));
  } else if (kind === 'special') {
    item.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.8), mat));
  } else {
    const band = new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xffd23f, emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.4 });
    item.add(new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.0, 1.0), mat));
    item.add(new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.25, 1.05), band));
  }
  // Slim light shaft + glowing ground ring so pickups read from across the arena without dominating it (spec §6).
  const glowMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.35, 10, 8, 1, true), glowMat);
  beam.position.y = 5;
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.5, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
  ring.position.y = 0.05;
  group.add(mergeItem(item), beam, ring);
  return group;
}

/** One mesh per pickup item (vertex colours) instead of 2–3: fewer draw calls with 13+ pickups per arena. */
function mergeItem(item: THREE.Group) {
  const geos = item.children.map((c) => {
    const m = c as THREE.Mesh;
    m.updateMatrix();
    const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrix);
    for (const a of Object.keys(g.attributes)) if (a !== 'position' && a !== 'normal') g.deleteAttribute(a);
    const color = (m.material as THREE.MeshStandardMaterial).color;
    const cols = new Float32Array(g.getAttribute('position').count * 3);
    for (let i = 0; i < cols.length; i += 3) color.toArray(cols, i);
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    return g;
  });
  const merged = new THREE.Group();
  merged.add(new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ vertexColors: true, emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 0.3, metalness: 0.2 })));
  return merged;
}
