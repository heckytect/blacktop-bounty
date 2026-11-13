import * as THREE from 'three';

// Spec §8 VFX: additive fire/sparks/flashes, smoke and tyre dust, skid decals. Pooled; one draw call per pool.

const VERT = /* glsl */ `
  attribute float size;
  attribute float alpha;
  attribute vec3 color;
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uScale;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
    vAlpha = alpha;
    vColor = color;
  }`;
const FRAG = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.35, d) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor, a);
  }`;

interface Spawn {
  pos: THREE.Vector3;
  vel?: THREE.Vector3;
  color: number | THREE.Color;
  size: number;
  life: number;
  grow?: number; // size multiplier per second
  gravity?: number; // m/s² (negative rises)
  drag?: number;
  alpha?: number;
}

class Pool {
  readonly points: THREE.Points;
  private n = 0;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly vel: Float32Array;
  private readonly meta: Float32Array; // life, maxLife, grow, gravity, drag, alpha0, size0
  private readonly c = new THREE.Color();

  constructor(
    readonly max: number,
    blending: THREE.Blending,
  ) {
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.meta = new Float32Array(max * 7);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { uScale: { value: 500 } }, transparent: true, depthWrite: false, blending });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
  }

  set scale(v: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = v;
  }

  spawn(s: Spawn) {
    if (this.n >= this.max) return; // ponytail: drop when full; budget is ≤ 3000 particles (spec §12.4)
    const i = this.n++;
    s.pos.toArray(this.pos, i * 3);
    (s.vel ?? new THREE.Vector3()).toArray(this.vel, i * 3);
    this.c.set(s.color).toArray(this.col, i * 3);
    this.size[i] = s.size;
    this.alpha[i] = s.alpha ?? 1;
    this.meta.set([s.life, s.life, s.grow ?? 0, s.gravity ?? 0, s.drag ?? 0, s.alpha ?? 1, s.size], i * 7);
  }

  update(dt: number) {
    let w = 0;
    for (let r = 0; r < this.n; r++) {
      const m = r * 7;
      const life = this.meta[m] - dt;
      if (life <= 0) continue;
      const t = life / this.meta[m + 1]; // 1 → 0
      const drag = Math.max(0, 1 - this.meta[m + 4] * dt);
      for (let k = 0; k < 3; k++) {
        this.vel[r * 3 + k] *= drag;
        if (k === 1) this.vel[r * 3 + 1] -= this.meta[m + 3] * dt;
        this.pos[r * 3 + k] += this.vel[r * 3 + k] * dt;
      }
      if (w !== r) {
        this.pos.copyWithin(w * 3, r * 3, r * 3 + 3);
        this.vel.copyWithin(w * 3, r * 3, r * 3 + 3);
        this.col.copyWithin(w * 3, r * 3, r * 3 + 3);
        this.meta.copyWithin(w * 7, m, m + 7);
      }
      this.meta[w * 7] = life;
      this.size[w] = this.meta[w * 7 + 6] * (1 + this.meta[w * 7 + 2] * (1 - t));
      this.alpha[w] = this.meta[w * 7 + 5] * t;
      w++;
    }
    this.n = w;
    const g = this.points.geometry;
    for (const a of ['position', 'color', 'size', 'alpha']) g.getAttribute(a).needsUpdate = true;
    g.setDrawRange(0, w);
  }

  get count() {
    return this.n;
  }
}

const rnd = (s = 1) => (Math.random() * 2 - 1) * s;
const rv = (sx: number, sy: number, sz: number) => new THREE.Vector3(rnd(sx), rnd(sy), rnd(sz));

/** Skid marks: a ring buffer of flat dark quads (instanced, one draw call). */
class Skids {
  readonly mesh: THREE.InstancedMesh;
  private next = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();

  constructor(readonly max = 600) {
    const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x1a1410, transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.mesh = new THREE.InstancedMesh(g, mat, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  add(at: THREE.Vector3, dir: THREE.Vector3, length: number, width = 0.32) {
    this.q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().setY(0).normalize());
    this.m.compose(at, this.q, this.s.set(width, 1, length));
    this.mesh.setMatrixAt(this.next, this.m);
    this.next = (this.next + 1) % this.max;
    this.mesh.count = Math.min(this.max, this.mesh.count + 1);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Fx {
  private readonly glow = new Pool(1600, THREE.AdditiveBlending);
  private readonly smokePool = new Pool(1200, THREE.NormalBlending);
  readonly skids = new Skids();

  constructor(scene: THREE.Scene) {
    scene.add(this.glow.points, this.smokePool.points, this.skids.mesh);
  }

  /** Point-size scale; call on resize with the canvas height in pixels. */
  resize(heightPx: number, fovDeg: number) {
    const s = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    this.glow.scale = s;
    this.smokePool.scale = s;
  }

  get particles() {
    return this.glow.count + this.smokePool.count;
  }

  explosion(at: THREE.Vector3, radius: number, color: number) {
    // Big blasts get more, spread-out particles rather than bigger ones (keeps them readable, not a black disc).
    const n = Math.min(60, 10 + radius * 4);
    const spread = Math.min(radius * 0.35, 8);
    const ball = Math.min(radius * 0.9, 5);
    for (let i = 0; i < n; i++) {
      const v = rv(1, 0.6, 1).normalize().multiplyScalar(Math.min(radius, 10) * (1.5 + Math.random() * 2.5));
      v.y += Math.min(radius, 10) * 1.2;
      this.glow.spawn({ pos: at.clone().add(rv(spread, spread * 0.4, spread)), vel: v, color: i % 3 ? 0xffa040 : color, size: ball, life: 0.35 + Math.random() * 0.35, grow: 1.2, drag: 4 });
    }
    for (let i = 0; i < n * 0.7; i++) {
      this.glow.spawn({ pos: at.clone(), vel: rv(1, 0.5, 1).normalize().multiplyScalar(14 + Math.random() * 16).add(new THREE.Vector3(0, 6, 0)), color: 0xffe08a, size: 0.25, life: 0.4 + Math.random() * 0.4, gravity: 18, drag: 1 });
    }
    for (let i = 0; i < n * 0.5; i++) {
      this.smokePool.spawn({ pos: at.clone().add(rv(spread, 0.3, spread)), vel: rv(1.5, 0, 1.5).add(new THREE.Vector3(0, 2 + Math.random() * 2, 0)), color: 0x5a524a, size: Math.min(radius * 0.6, 3.5), life: 1.4 + Math.random(), grow: 1.8, gravity: -1, drag: 1, alpha: 0.45 });
    }
  }

  sparks(at: THREE.Vector3, n = 5, color = 0xffe08a) {
    for (let i = 0; i < n; i++) {
      this.glow.spawn({ pos: at.clone(), vel: rv(6, 4, 6).add(new THREE.Vector3(0, 3, 0)), color, size: 0.18, life: 0.15 + Math.random() * 0.2, gravity: 20 });
    }
  }

  muzzle(at: THREE.Vector3, dir: THREE.Vector3) {
    this.glow.spawn({ pos: at.clone().addScaledVector(dir, 0.3), vel: dir.clone().multiplyScalar(8), color: 0xfff0b0, size: 0.9, life: 0.05 });
  }

  trail(at: THREE.Vector3, color = 0x8a8078) {
    this.smokePool.spawn({ pos: at.clone(), vel: rv(0.3, 0.3, 0.3), color, size: 0.6, life: 0.6, grow: 2, alpha: 0.5 });
    this.glow.spawn({ pos: at.clone(), color: 0xffb050, size: 0.5, life: 0.06 });
  }

  smoke(at: THREE.Vector3, dark = true) {
    this.smokePool.spawn({ pos: at.clone().add(rv(0.3, 0, 0.3)), vel: new THREE.Vector3(rnd(0.5), 2.5, rnd(0.5)), color: dark ? 0x2a2624 : 0x9a948a, size: 1, life: 1.2, grow: 2.5, gravity: -0.5, drag: 0.5, alpha: 0.6 });
  }

  fire(at: THREE.Vector3, radius: number) {
    this.glow.spawn({ pos: at.clone().add(rv(radius * 0.7, 0, radius * 0.7)), vel: new THREE.Vector3(0, 2 + Math.random() * 2, 0), color: Math.random() < 0.5 ? 0xff6a1a : 0xffb030, size: 1.2, life: 0.5, grow: -0.6 });
  }

  dust(at: THREE.Vector3, color: number) {
    this.smokePool.spawn({ pos: at.clone(), vel: rv(1, 0, 1).add(new THREE.Vector3(0, 1.2, 0)), color, size: 0.9, life: 0.8, grow: 2.2, drag: 1.5, alpha: 0.5 });
  }

  update(dt: number) {
    this.glow.update(dt);
    this.smokePool.update(dt);
  }
}
