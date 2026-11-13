import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import type { Graphics } from './settings';

// "Modern stylized" look: Poly Haven PBR textures (CC0), HDRI sky + image-based lighting,
// ACES tone mapping, and post-processing (ground-truth AO, bloom, SMAA) scaled by the graphics preset.

export type Surface = 'sand' | 'asphalt' | 'concrete' | 'rock' | 'rust' | 'wood' | 'brick' | 'metal';
export type Sky = 'dusk' | 'day' | 'night' | 'purple';

/** World-space size (m) one texture tile covers. */
export const TILE: Record<Surface, number> = { sand: 7, asphalt: 6, concrete: 5, rock: 9, rust: 3, wood: 3, brick: 3, metal: 4 };

const BASE = `${import.meta.env.BASE_URL}assets/`;
const texLoader = new THREE.TextureLoader();
const surfaces = new Map<Surface, { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture }>();
const skies = new Map<Sky, THREE.DataTexture>();

function tex(file: string, color: boolean) {
  const t = texLoader.load(`${BASE}textures/${file}`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function surfaceMaps(s: Surface) {
  if (!surfaces.has(s)) {
    surfaces.set(s, { map: tex(`${s}_color.jpg`, true), normalMap: tex(`${s}_normal.jpg`, false), roughnessMap: tex(`${s}_rough.jpg`, false) });
  }
  return surfaces.get(s)!;
}

/** Attach PBR maps to every material tagged with userData.surface (arena merge, props). */
export function applySurfaces(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    const s = (o as THREE.Mesh).userData?.surface as Surface | undefined;
    if (!m || !s || !('roughnessMap' in m)) return;
    Object.assign(m, surfaceMaps(s));
    m.normalScale = new THREE.Vector2(0.9, 0.9);
    m.needsUpdate = true;
  });
}

export async function loadSky(sky: Sky) {
  if (!skies.has(sky)) {
    const t = await new HDRLoader().loadAsync(`${BASE}sky/${sky}.hdr`);
    t.mapping = THREE.EquirectangularReflectionMapping;
    skies.set(sky, t);
  }
  return skies.get(sky)!;
}

/** Average colour of the HDRI's horizon band, so distance fog melts into the sky. */
export function horizonColor(hdr: THREE.DataTexture) {
  const { data, width, height } = hdr.image as { data: Uint16Array | Float32Array; width: number; height: number };
  const half = data instanceof Uint16Array;
  const read = (i: number) => (half ? THREE.DataUtils.fromHalfFloat(data[i]) : data[i]);
  const c = [0, 0, 0];
  let n = 0;
  for (let y = Math.floor(height * 0.47); y < Math.floor(height * 0.5); y++) {
    for (let x = 0; x < width; x += 4) {
      const i = (y * width + x) * 4;
      for (let k = 0; k < 3; k++) c[k] += Math.min(read(i + k), 4);
      n++;
    }
  }
  return new THREE.Color().setRGB(c[0] / n, c[1] / n, c[2] / n);
}

/** HDRI as visible sky + environment light (reflections on paint, glass, metal). */
export function applySky(renderer: THREE.WebGLRenderer, scene: THREE.Scene, hdr: THREE.DataTexture, intensity: number) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(hdr).texture;
  pmrem.dispose();
  scene.background = hdr;
  scene.environment = env;
  scene.environmentIntensity = intensity;
  scene.backgroundIntensity = 0.7; // a touch darker than the light it casts, so the sky doesn't blow out
  return env;
}

/** Final grade in display space: contrast, saturation, gentle vignette. */
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, contrast: { value: 1.12 }, saturation: { value: 1.18 }, vignette: { value: 0.28 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float contrast; uniform float saturation; uniform float vignette; varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, saturation);
      c = (c - 0.5) * contrast + 0.5;
      float d = distance(vUv, vec2(0.5));
      c *= 1.0 - vignette * smoothstep(0.35, 0.85, d);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

/** Post-processing chain per graphics preset. Low = straight render. */
export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, preset: Graphics) {
  if (preset === 'low') {
    return { render: () => renderer.render(scene, camera), setSize: () => {}, dispose: () => {} };
  }
  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  let gtao: GTAOPass | null = null;
  if (preset === 'high') {
    // Ground-truth ambient occlusion: contact shadows under cars, in corners and crevices.
    gtao = new GTAOPass(scene, camera, size.x, size.y);
    gtao.updateGtaoMaterial({ radius: 1.2, distanceExponent: 1.6, thickness: 1.5, scale: 1.1, samples: 8 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, rings: 2, samples: 8 });
    gtao.blendIntensity = 0.85;
    composer.addPass(gtao);
  }
  // Bloom only on bright things (headlights, neon, explosions, muzzle flash).
  // Threshold is in linear HDR units: sunlit ground is ~1–2, so only lights/neon/fire (pushed to 3+) bloom.
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.45, 0.4, 2.6));
  composer.addPass(new OutputPass()); // tone mapping + sRGB
  composer.addPass(new ShaderPass(GradeShader));
  if (preset === 'high') composer.addPass(new SMAAPass());
  return {
    render: () => composer.render(),
    setSize: (w: number, h: number) => composer.setSize(w, h),
    dispose: () => composer.dispose(),
  };
}
