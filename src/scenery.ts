import * as THREE from 'three';
import type { ArenaTheme } from './arena';

// Spec §8 atmosphere: gradient sky dome with a sun glow and low-poly mesas on the horizon.
// Both follow the camera (they read as infinitely far) and ignore fog; the mesas are pre-tinted toward the haze.

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const SKY_FRAG = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uSunDir;
  uniform vec3 uSun;
  varying vec3 vDir;
  void main() {
    float h = clamp(vDir.y, 0.0, 1.0);
    vec3 c = mix(uHorizon, uTop, pow(h, 0.6));
    float s = max(dot(vDir, uSunDir), 0.0);
    c += uSun * (pow(s, 600.0) * 1.5 + pow(s, 12.0) * 0.25);
    gl_FragColor = vec4(c, 1.0);
  }`;

export interface Sky {
  group: THREE.Group;
  follow(camera: THREE.Camera): void;
}

export function createSky(theme: ArenaTheme, sunDir: THREE.Vector3, opts: { radius: number; mesas: boolean }): Sky {
  const group = new THREE.Group();
  const horizon = new THREE.Color(theme.sky);
  // Darker, cooler zenith derived from the horizon colour.
  const top = horizon.clone().offsetHSL(0.04, 0.05, -0.18);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(opts.radius, 24, 12),
    new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { uTop: { value: top }, uHorizon: { value: horizon }, uSunDir: { value: sunDir.clone().normalize() }, uSun: { value: new THREE.Color(theme.sun) } },
    }),
  );
  dome.renderOrder = -2;
  group.add(dome);

  if (opts.mesas) {
    // Ring of flat-topped buttes, tinted 55% toward the horizon so they sit in the haze.
    const rock = new THREE.Color(theme.hemiGround).lerp(horizon, 0.55);
    const mat = new THREE.MeshBasicMaterial({ color: rock, fog: false });
    const r = opts.radius * 0.92;
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + rand() * 0.15;
      const w = 18 + rand() * 40;
      const h = 8 + rand() * 30;
      const g = new THREE.CylinderGeometry(w * 0.55, w * 0.75, h, 6 + Math.floor(rand() * 3), 1);
      const m = new THREE.Mesh(g, mat);
      m.position.set(Math.cos(a) * r, h / 2 - 4, Math.sin(a) * r);
      m.rotation.y = rand() * Math.PI;
      m.renderOrder = -1;
      group.add(m);
    }
  }
  return {
    group,
    follow(camera) {
      group.position.set(camera.position.x, 0, camera.position.z);
    },
  };
}

/** Subdivided ground overlay with dusty colour variation (vertex colours, no textures). */
export function groundDetail(w: number, d: number, color: number, cell = 5) {
  const segX = Math.max(1, Math.round(w / cell));
  const segZ = Math.max(1, Math.round(d / cell));
  const g = new THREE.PlaneGeometry(w, d, segX, segZ).rotateX(-Math.PI / 2);
  const base = new THREE.Color(color);
  const pos = g.getAttribute('position');
  const cols = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    // Cheap value noise: two octaves of hashed sines → patches + speckle.
    const n = Math.sin(x * 0.045 + Math.sin(z * 0.03) * 2) * Math.cos(z * 0.05 + Math.sin(x * 0.02)) * 0.5 + 0.5;
    const speck = (Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
    c.copy(base).multiplyScalar(0.86 + n * 0.16 + Math.abs(speck) * 0.05);
    c.toArray(cols, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return g;
}
