import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { groundDetail } from './scenery';
import { TILE, type Sky, type Surface } from './look';
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
  hdri: Sky; // sky + image-based lighting
  exposure: number; // tone-mapping exposure
  surfaces: { ground: Surface; building: Surface; ramp: Surface }; // default PBR textures
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
  surface?: Surface; // PBR texture (default: painted)
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
   * Bake static meshes into one mesh per surface (+ painted + glow) with vertex colours and
   * world-space box-projected UVs, so textures tile at a constant scale on every face.
   * Bottoms of each piece are darkened (fake baked AO) so things sit on the ground.
   */
  private mergeStatic() {
    const groups = new Map<string, THREE.BufferGeometry[]>();
    const white = new THREE.Color(1, 1, 1);
    for (const m of this.staticMeshes) {
      if (m.userData.static === false || m.parent !== this.scene) continue;
      const mat = m.material as THREE.MeshStandardMaterial;
      const isGlow = mat.emissiveIntensity > 0;
      const surface = (isGlow ? null : (m.userData.surface as Surface | null)) ?? null;
      m.updateMatrixWorld();
      const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrixWorld);
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'color') g.deleteAttribute(name);
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      const pos = g.getAttribute('position');
      const nor = g.getAttribute('normal');
      const own = g.getAttribute('color');
      // Textured surfaces keep the texture's own colour, lightly tinted by the piece's colour.
      const base = (isGlow ? mat.emissive : mat.color).clone();
      if (surface) base.lerp(white, 0.55);
      g.computeBoundingBox();
      const { min, max } = g.boundingBox!;
      const tall = max.y - min.y > 0.3;
      const cols = new Float32Array(pos.count * 3);
      const uvs = new Float32Array(pos.count * 2);
      const tile = surface ? TILE[surface] : 4;
      for (let i = 0; i < pos.count; i++) {
        const ao = tall && !isGlow ? 0.62 + 0.38 * Math.min(1, (pos.getY(i) - min.y) / 2.5) : 1;
        const c = own ? new THREE.Color(own.getX(i), own.getY(i), own.getZ(i)) : base;
        if (own && surface) c.lerp(white, 0.55);
        cols[i * 3] = c.r * ao;
        cols[i * 3 + 1] = c.g * ao;
        cols[i * 3 + 2] = c.b * ao;
        const [ax, ay, az] = [Math.abs(nor.getX(i)), Math.abs(nor.getY(i)), Math.abs(nor.getZ(i))];
        const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
        const [u, v] = ay >= ax && ay >= az ? [x, z] : ax >= az ? [z, y] : [x, y];
        uvs[i * 2] = u / tile;
        uvs[i * 2 + 1] = v / tile;
      }
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      const key = isGlow ? 'glow' : surface ?? 'paint';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(g);
      this.scene.remove(m);
      m.geometry.dispose();
    }
    for (const [key, geos] of groups) {
      const glow = key === 'glow';
      const material = glow
        ? new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(3.5, 3.5, 3.5) }) // HDR-bright so neon blooms
        : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: key === 'paint' ? 0.65 : 1, metalness: key === 'metal' || key === 'rust' ? 0.35 : 0 });
      const mesh = new THREE.Mesh(mergeGeometries(geos), material);
      mesh.castShadow = mesh.receiveShadow = !glow;
      mesh.name = `arena-${key}`;
      if (!glow && key !== 'paint') mesh.userData.surface = key; // look.applySurfaces() attaches the maps
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
  new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, flatShading: true, emissive: glow ? color : 0x000000, emissiveIntensity: glow ? 1.6 : 0 });

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
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: number, opts: { rotY?: number; glow?: boolean; invisible?: boolean; surface?: Surface | null } = {}) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, opts.rotY ?? 0, 0));
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(x, y + h / 2, z).setRotation(q),
    );
    let mesh: THREE.Mesh | null = null;
    if (!opts.invisible) {
      mesh = this.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts.glow)));
      mesh.userData.surface = opts.surface === undefined ? this.arena.theme.surfaces.building : opts.surface;
      mesh.position.set(x, y + h / 2, z);
      if (!opts.rotY && !opts.glow && h >= 4 && y >= -0.5 && Math.min(w, d) >= 6 && Math.max(w, d) <= 120 && mesh.userData.surface && ['brick', 'concrete', 'wood', 'metal', 'rust'].includes(mesh.userData.surface)) {
        this.facade(w, h, d, x, y, z);
      }
      mesh.quaternion.copy(q);
    }
    return { collider, mesh };
  }

  /** Architectural detail on a building box: window rows, a door, a roof parapet (visual only, merged for free). */
  private facade(w: number, h: number, d: number, x: number, y: number, z: number) {
    const glass = 0x1d2a33;
    const trim = 0x8a8178;
    const floors = Math.max(1, Math.floor((h - 1) / 3.2));
    for (const [len, nx, nz, along] of [[w, 0, 1, 'x'], [w, 0, -1, 'x'], [d, 1, 0, 'z'], [d, -1, 0, 'z']] as const) {
      const fx = x + (nx * w) / 2 + nx * 0.06;
      const fz = z + (nz * d) / 2 + nz * 0.06;
      const cols = Math.max(1, Math.floor(len / 4.5));
      for (let f = 0; f < floors; f++) {
        const wy = y + 1.4 + f * 3.2;
        if (wy + 1.6 > y + h - 0.4) break;
        for (let c = 0; c < cols; c++) {
          const off = (c + 0.5) * (len / cols) - len / 2;
          const [wx, wz] = along === 'x' ? [x + off, fz] : [fx, z + off];
          const [sx, sz] = along === 'x' ? [1.6, 0.1] : [0.1, 1.6];
          this.deco(sx, 1.5, sz, wx, wy, wz, glass, { surface: 'metal' });
          this.deco(along === 'x' ? 1.9 : 0.14, 0.12, along === 'x' ? 0.14 : 1.9, wx, wy - 0.12, wz, trim); // sill
        }
      }
      // A door on the front face.
      if (along === 'x' && nz === 1) this.deco(1.8, 2.4, 0.12, x, y, fz, 0x3b2a1e, { surface: 'wood' });
    }
    // Roof parapet.
    for (const [px, pz, pw, pd] of [[x, z + d / 2 - 0.2, w, 0.4], [x, z - d / 2 + 0.2, w, 0.4], [x + w / 2 - 0.2, z, 0.4, d], [x - w / 2 + 0.2, z, 0.4, d]]) {
      this.deco(pw, 0.7, pd, px, y + h, pz, trim, { surface: 'concrete' });
    }
  }

  /** Visual-only box (decals, neon trim, rails). */
  deco(w: number, h: number, d: number, x: number, y: number, z: number, color: number, opts: { rotY?: number; glow?: boolean; surface?: Surface } = {}) {
    const m = this.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts.glow)));
    m.userData.surface = opts.surface ?? null;
    m.position.set(x, y + h / 2, z);
    m.rotation.y = opts.rotY ?? 0;
    m.castShadow = false;
    return m;
  }

  /** Ground slab with its top at `top`. Defaults to the whole arena. `detail` adds a dusty colour-varied surface. */
  ground(color: number, rect?: { minX: number; maxX: number; minZ: number; maxZ: number }, top = 0, detail = true, surface: Surface = this.arena.theme.surfaces.ground) {
    const h = this.arena.halfSize + 10;
    const r = rect ?? { minX: -h, maxX: h, minZ: -h, maxZ: h };
    const [w, d, cx, cz] = [r.maxX - r.minX, r.maxZ - r.minZ, (r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2];
    const slab = this.box(w, 4, d, cx, top - 4, cz, color, { surface });
    if (detail) {
      const m = this.add(new THREE.Mesh(groundDetail(w, d, color), mat(color)));
      m.userData.surface = surface;
      m.position.set(cx, top + 0.015, cz);
      m.castShadow = false;
    }
    return slab;
  }

  /** Raised block you can drive on top of (a vertical level). */
  platform(w: number, d: number, x: number, z: number, top: number, color: number, rotY = 0, surface?: Surface) {
    return this.box(w, top, d, x, 0, z, color, { rotY, surface });
  }

  /** Wedge rising `h` over `length` toward local +X (rotated by yaw), base at `baseY`. */
  ramp(x: number, z: number, length: number, width: number, h: number, yaw: number, color: number, baseY = 0, surface = this.arena.theme.surfaces.ramp) {
    const [l, w] = [length / 2, width / 2];
    return this.hull([[-l, 0, -w], [-l, 0, w], [l, 0, -w], [l, 0, w], [l, h, -w], [l, h, w]], x, baseY, z, yaw, color, surface);
  }

  /** Jump mound: sloped on every side. */
  mound(x: number, z: number, length: number, width: number, h: number, color: number, yaw = 0, surface = this.arena.theme.surfaces.ramp) {
    const [l, w] = [length / 2, width / 2];
    const [tl, tw] = [l * 0.35, w * 0.6];
    return this.hull(
      [[-l, 0, -w], [-l, 0, w], [l, 0, -w], [l, 0, w], [-tl, h, -tw], [-tl, h, tw], [tl, h, -tw], [tl, h, tw]],
      x, 0, z, yaw, color, surface,
    );
  }

  private hull(local: number[][], x: number, y: number, z: number, yaw: number, color: number, surface: Surface | null) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
    const pts = local.map(([a, b, c]) => new THREE.Vector3(a, b, c).applyQuaternion(q).add(new THREE.Vector3(x, y, z)));
    const collider = this.world.createCollider(RAPIER.ColliderDesc.convexHull(new Float32Array(pts.flatMap((p) => p.toArray())))!);
    this.add(new THREE.Mesh(new ConvexGeometry(pts), mat(color))).userData.surface = surface;
    return collider;
  }

  cyl(r: number, h: number, x: number, y: number, z: number, color: number, glow = false, surface: Surface | null = 'metal') {
    this.world.createCollider(RAPIER.ColliderDesc.cylinder(h / 2, r).setTranslation(x, y + h / 2, z));
    const m = this.add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 16), mat(color, glow)));
    m.userData.surface = glow ? null : surface;
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
    body.userData.surface = spec.surface ?? null;
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
    return this.prop({ shape: 'cyl', size: [0.7, 1.4, 0.7], pos: [x, y, z], color: 0xc0392b, hp: 15, surface: 'metal', explode: { radius: 7, damage: 30, knockback: 8 } });
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
