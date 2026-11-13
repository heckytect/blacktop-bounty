import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { groundDetail } from './scenery';
import type { PickupKind } from './pickups';
import type { Vehicle } from './vehicle';
import type { Combat } from './weapons';
import { buildGridNav, type NavGraph } from './nav';

export interface Spawn {
  pos: THREE.Vector3;
  yaw: number;
}

export interface ArenaTheme {
  sky: number;
  fogNear: number;
  fogFar: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  sun: number;
  sunIntensity: number;
  dust?: number; // tyre dust colour
}

export interface PropSpec {
  shape: 'box' | 'cyl';
  size: [number, number, number]; // box: w,h,d · cyl: radius,h,radius
  pos: [number, number, number]; // bottom centre
  color: number;
  hp: number;
  rotY?: number;
  glow?: boolean;
  explode?: { radius: number; damage: number; knockback: number };
  tag?: string; // events find their prop by tag
  extra?: THREE.Object3D; // visual-only parts (sign board, tank shell)
}

export interface Prop {
  spec: PropSpec;
  mesh: THREE.Object3D;
  collider: RAPIER.Collider | null;
  hp: number;
  centre: THREE.Vector3;
  radius: number; // rough bounding radius, for splash damage
}

/** Scripted hazard (spec §7). `trigger()` fires it now; tests use it. */
export interface ArenaEvent {
  readonly name: string;
  fired: number;
  /** A spot where a car is guaranteed to feel the event. */
  testPoint: THREE.Vector3;
  trigger(): void;
  /** Stop the event's own schedule (the boss fight drives the roof collapse instead). */
  paused?: boolean;
  update(dt: number): void;
}

export interface EventContext {
  world: RAPIER.World;
  scene: THREE.Scene;
  combat: Combat;
  vehicles: Vehicle[];
  arena: Arena;
  time: () => number;
}

export interface ArenaDef {
  id: string;
  name: string;
  blurb: string;
  theme: ArenaTheme;
  half: number; // playable half-size (m)
  walls?: boolean; // invisible perimeter walls (default true)
  hasPits?: boolean; // falling off is part of the design
  horizon?: 'mesas' | 'none'; // backdrop ring (default mesas)
  build(b: ArenaBuilder): void;
  event?(ctx: EventContext): ArenaEvent;
}

export const KILL_Y = -15;
const NAV_SPACING = 12;

/** A built arena: static world, props, spawns, pickups, nav graph and its event. */
export class Arena {
  readonly spawns: Spawn[] = [];
  readonly pickups: { kind: PickupKind; pos: THREE.Vector3 }[] = [];
  readonly props: Prop[] = [];
  readonly nav: NavGraph;
  readonly halfSize: number;
  readonly theme: ArenaTheme;
  event: ArenaEvent | null = null;
  /** Scratch space for a def's build() to hand things to its event() (e.g. collapse slabs). */
  readonly data: Record<string, unknown> = {};
  /** Called when any prop is destroyed (events listen for theirs). */
  readonly onPropDestroyed: ((p: Prop, by: Vehicle | null) => void)[] = [];
  /** Builder-made meshes that never move; merged into two draw calls after the build (spec §12.4). */
  readonly staticMeshes: THREE.Mesh[] = [];
  /** Things the arena moves every step (debris, trains). */
  readonly movers: ((dt: number) => void)[] = [];
  private combat: Combat | null = null;
  private readonly propByCollider = new Map<number, Prop>();

  constructor(
    readonly def: ArenaDef,
    readonly world: RAPIER.World,
    readonly scene: THREE.Scene,
  ) {
    this.halfSize = def.half;
    this.theme = def.theme;
    const b = new ArenaBuilder(this);
    def.build(b);
    if (def.walls !== false) b.perimeterWalls();
    for (const p of this.props) if (p.collider) this.propByCollider.set(p.collider.handle, p);
    this.nav = buildGridNav(world, def.half - 6, NAV_SPACING);
    this.mergeStatic();
  }

  /**
   * Bake static meshes into one lit + one glow mesh with vertex colours. Bottoms of each piece are
   * darkened (fake baked AO, spec §8) so things sit on the ground.
   */
  private mergeStatic() {
    const lit: THREE.BufferGeometry[] = [];
    const glow: THREE.BufferGeometry[] = [];
    for (const m of this.staticMeshes) {
      if (m.userData.static === false || m.parent !== this.scene) continue;
      const mat = m.material as THREE.MeshLambertMaterial;
      const isGlow = mat.emissiveIntensity > 0;
      m.updateMatrixWorld();
      const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrixWorld);
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'color') g.deleteAttribute(name);
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      const pos = g.getAttribute('position');
      const own = g.getAttribute('color');
      const base = isGlow ? mat.emissive : mat.color;
      g.computeBoundingBox();
      const { min, max } = g.boundingBox!;
      const tall = max.y - min.y > 0.3;
      const cols = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const ao = tall && !isGlow ? 0.68 + 0.32 * Math.min(1, (pos.getY(i) - min.y) / 2.5) : 1;
        cols[i * 3] = (own ? own.getX(i) : base.r) * ao;
        cols[i * 3 + 1] = (own ? own.getY(i) : base.g) * ao;
        cols[i * 3 + 2] = (own ? own.getZ(i) : base.b) * ao;
      }
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      (isGlow ? glow : lit).push(g);
      this.scene.remove(m);
      m.geometry.dispose();
    }
    if (lit.length) {
      const mesh = new THREE.Mesh(mergeGeometries(lit), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.name = 'arena-static';
      this.scene.add(mesh);
    }
    if (glow.length) {
      const mesh = new THREE.Mesh(mergeGeometries(glow), new THREE.MeshBasicMaterial({ vertexColors: true }));
      mesh.name = 'arena-glow';
      this.scene.add(mesh);
    }
  }

  /** Second stage, once vehicles and combat exist. */
  attach(ctx: Omit<EventContext, 'arena'>) {
    this.combat = ctx.combat;
    ctx.combat.onStaticHit = (c, dmg, _point, from) => {
      const p = this.propByCollider.get(c.handle);
      if (p) this.damageProp(p, dmg, from);
    };
    ctx.combat.onBlast = (point, radius, dmg, from) => {
      for (const p of this.props) {
        const d = Math.max(0, p.centre.distanceTo(point) - p.radius);
        if (p.hp > 0 && d < radius) this.damageProp(p, dmg * (1 - d / radius), from);
      }
    };
    this.event = this.def.event?.({ ...ctx, arena: this }) ?? null;
  }

  update(dt: number) {
    for (const m of this.movers) m(dt);
    if (!this.event?.paused) this.event?.update(dt);
  }

  damageProp(p: Prop, amount: number, from: Vehicle | null) {
    if (p.hp <= 0) return;
    p.hp -= amount;
    if (p.hp <= 0) this.destroyProp(p, from);
  }

  destroyProp(p: Prop, from: Vehicle | null) {
    if (p.collider) {
      this.propByCollider.delete(p.collider.handle);
      this.world.removeCollider(p.collider, false);
      p.collider = null;
    }
    p.hp = 0;
    p.mesh.visible = false;
    const c = this.combat;
    if (c) {
      if (p.spec.explode) {
        const e = p.spec.explode;
        c.explosion(p.centre, e.radius, e.damage, e.knockback, from, 0xff9a2a);
      } else c.blast(p.centre, Math.max(1.5, p.radius), 0xd9b48a, 0.35);
    }
    for (const fn of this.onPropDestroyed) fn(p, from);
  }

  /** Nearest spawn to a point (fall-off respawns, spec §7). */
  nearestSpawn(p: THREE.Vector3) {
    return this.spawns.reduce((best, s) => (s.pos.distanceTo(p) < best.pos.distanceTo(p) ? s : best));
  }
}

const mat = (color: number, glow = false) =>
  new THREE.MeshLambertMaterial({ color, flatShading: true, emissive: glow ? color : 0x000000, emissiveIntensity: glow ? 0.9 : 0 });

/** Greybox helpers. Positions are bottom-centre; yaw rotates around Y. */
export class ArenaBuilder {
  constructor(readonly arena: Arena) {}

  private get world() {
    return this.arena.world;
  }

  private add(mesh: THREE.Mesh) {
    mesh.castShadow = mesh.receiveShadow = true;
    this.arena.scene.add(mesh);
    this.arena.staticMeshes.push(mesh); // merged after build unless userData.static === false
    return mesh;
  }

  /** Solid box. Returns its collider so events can remove it. */
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: number, opts: { rotY?: number; glow?: boolean; invisible?: boolean } = {}) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, opts.rotY ?? 0, 0));
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(x, y + h / 2, z).setRotation(q),
    );
    let mesh: THREE.Mesh | null = null;
    if (!opts.invisible) {
      mesh = this.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts.glow)));
      mesh.position.set(x, y + h / 2, z);
      mesh.quaternion.copy(q);
    }
    return { collider, mesh };
  }

  /** Visual-only box (decals, neon trim, rails). */
  deco(w: number, h: number, d: number, x: number, y: number, z: number, color: number, opts: { rotY?: number; glow?: boolean } = {}) {
    const m = this.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts.glow)));
    m.position.set(x, y + h / 2, z);
    m.rotation.y = opts.rotY ?? 0;
    m.castShadow = false;
    return m;
  }

  /** Ground slab with its top at `top`. Defaults to the whole arena. `detail` adds a dusty colour-varied surface. */
  ground(color: number, rect?: { minX: number; maxX: number; minZ: number; maxZ: number }, top = 0, detail = true) {
    const h = this.arena.halfSize + 10;
    const r = rect ?? { minX: -h, maxX: h, minZ: -h, maxZ: h };
    const [w, d, cx, cz] = [r.maxX - r.minX, r.maxZ - r.minZ, (r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2];
    const slab = this.box(w, 4, d, cx, top - 4, cz, color);
    if (detail) {
      const m = this.add(new THREE.Mesh(groundDetail(w, d, color), mat(color)));
      m.position.set(cx, top + 0.015, cz);
      m.castShadow = false;
    }
    return slab;
  }

  /** Raised block you can drive on top of (a vertical level). */
  platform(w: number, d: number, x: number, z: number, top: number, color: number, rotY = 0) {
    return this.box(w, top, d, x, 0, z, color, { rotY });
  }

  /** Wedge rising `h` over `length` toward local +X (rotated by yaw), base at `baseY`. */
  ramp(x: number, z: number, length: number, width: number, h: number, yaw: number, color: number, baseY = 0) {
    const [l, w] = [length / 2, width / 2];
    return this.hull([[-l, 0, -w], [-l, 0, w], [l, 0, -w], [l, 0, w], [l, h, -w], [l, h, w]], x, baseY, z, yaw, color);
  }

  /** Jump mound: sloped on every side. */
  mound(x: number, z: number, length: number, width: number, h: number, color: number, yaw = 0) {
    const [l, w] = [length / 2, width / 2];
    const [tl, tw] = [l * 0.35, w * 0.6];
    return this.hull(
      [[-l, 0, -w], [-l, 0, w], [l, 0, -w], [l, 0, w], [-tl, h, -tw], [-tl, h, tw], [tl, h, -tw], [tl, h, tw]],
      x, 0, z, yaw, color,
    );
  }

  private hull(local: number[][], x: number, y: number, z: number, yaw: number, color: number) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
    const pts = local.map(([a, b, c]) => new THREE.Vector3(a, b, c).applyQuaternion(q).add(new THREE.Vector3(x, y, z)));
    const collider = this.world.createCollider(RAPIER.ColliderDesc.convexHull(new Float32Array(pts.flatMap((p) => p.toArray())))!);
    this.add(new THREE.Mesh(new ConvexGeometry(pts), mat(color)));
    return collider;
  }

  cyl(r: number, h: number, x: number, y: number, z: number, color: number, glow = false) {
    this.world.createCollider(RAPIER.ColliderDesc.cylinder(h / 2, r).setTranslation(x, y + h / 2, z));
    const m = this.add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 10), mat(color, glow)));
    m.position.set(x, y + h / 2, z);
    return m;
  }

  /** Destructible prop (spec §7: ≥ 6 per arena). */
  prop(spec: PropSpec): Prop {
    const [sx, sy, sz] = spec.size;
    const [x, y, z] = spec.pos;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, spec.rotY ?? 0, 0));
    const desc = spec.shape === 'box' ? RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2) : RAPIER.ColliderDesc.cylinder(sy / 2, sx);
    const collider = this.world.createCollider(desc.setTranslation(x, y + sy / 2, z).setRotation(q));
    const geo = spec.shape === 'box' ? new THREE.BoxGeometry(sx, sy, sz) : new THREE.CylinderGeometry(sx, sx, sy, 10);
    const group = new THREE.Group();
    const body = new THREE.Mesh(geo, mat(spec.color, spec.glow));
    body.castShadow = body.receiveShadow = true;
    body.position.y = sy / 2;
    group.add(body);
    if (spec.extra) group.add(spec.extra);
    group.position.set(x, y, z);
    group.quaternion.copy(q);
    this.arena.scene.add(group);
    const p: Prop = {
      spec, mesh: group, collider, hp: spec.hp,
      centre: new THREE.Vector3(x, y + sy / 2, z),
      radius: spec.shape === 'box' ? Math.hypot(sx, sz) / 2 : sx,
    };
    this.arena.props.push(p);
    return p;
  }

  barrel(x: number, z: number, y = 0) {
    return this.prop({ shape: 'cyl', size: [0.7, 1.4, 0.7], pos: [x, y, z], color: 0xc0392b, hp: 15, explode: { radius: 7, damage: 30, knockback: 8 } });
  }

  cactus(x: number, z: number, h = 4) {
    return this.prop({ shape: 'cyl', size: [0.45, h, 0.45], pos: [x, 0, z], color: 0x4f7f3a, hp: 12 });
  }

  /** Spawn on a surface at height y, facing the arena centre (yaw θ faces (cos θ, 0, -sin θ)). */
  spawn(x: number, z: number, y = 0) {
    this.arena.spawns.push({ pos: new THREE.Vector3(x, y + 1.5, z), yaw: Math.atan2(z, -x) });
  }

  spawnRing(radius: number, count = 8, y = 0, offset = 0.5) {
    for (let i = 0; i < count; i++) {
      const a = ((i + offset) / count) * Math.PI * 2;
      this.spawn(Math.cos(a) * radius, Math.sin(a) * radius, y);
    }
  }

  pickup(kind: PickupKind, x: number, z: number, y = 0) {
    this.arena.pickups.push({ kind, pos: new THREE.Vector3(x, y, z) });
  }

  pickupRing(kind: PickupKind, radius: number, count: number, y = 0, offset = 0) {
    for (let i = 0; i < count; i++) {
      const a = ((i + offset) / count) * Math.PI * 2;
      this.pickup(kind, Math.cos(a) * radius, Math.sin(a) * radius, y);
    }
  }

  /** Invisible walls at the playable edge (spec §7 out-of-bounds). */
  perimeterWalls() {
    const h = this.arena.halfSize;
    for (const [x, z, w, d] of [[0, h + 1, h * 2 + 4, 2], [0, -h - 1, h * 2 + 4, 2], [h + 1, 0, 2, h * 2 + 4], [-h - 1, 0, 2, h * 2 + 4]]) {
      this.box(w, 30, d, x, -5, z, 0, { invisible: true });
    }
  }
}
