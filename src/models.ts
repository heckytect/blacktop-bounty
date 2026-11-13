import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Blender-made vehicle (spec §8.1): `body` plus one wheel template taken from `wheel_FL`. */
export interface VehicleModel {
  body: THREE.Object3D;
  wheel: THREE.Object3D;
}

const models = new Map<string, VehicleModel>();
export const vehicleModel = (id: string) => models.get(id);

type Finish = 'paint' | 'glass' | 'chrome' | 'rubber' | 'glow';
const GLASS = 0x3a6f80;
const CHROME = 0xc9ccd1;
const DARK = 0x222222;

/** Physically based finishes for a modern look: clear-coated paint, mirror glass, chrome, rubber, emissive lights. */
function finishMaterial(f: Finish) {
  switch (f) {
    case 'glow':
      return new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(4, 4, 4) }); // keeps each light's colour, HDR-bright for bloom
    case 'glass':
      return new THREE.MeshPhysicalMaterial({ color: 0x0d1418, roughness: 0.04, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6 });
    case 'chrome':
      return new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.12, metalness: 1, envMapIntensity: 1.3 });
    case 'rubber':
      return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
    default:
      return new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.05, clearcoat: 0.6, clearcoatRoughness: 0.12, envMapIntensity: 0.6 });
  }
}

/**
 * Bake a glTF node (one mesh per Blender material) into ≤ 5 meshes grouped by finish, with vertex colours.
 * Material names c_<hex> / glow_<hex> carry the colour; the hex picks the finish.
 */
function bake(node: THREE.Object3D, oneMaterial = false) {
  node.updateMatrixWorld(true);
  const inv = node.matrixWorld.clone().invert();
  const groups = new Map<Finish, THREE.BufferGeometry[]>();
  node.traverse((c) => {
    if (!(c instanceof THREE.Mesh)) return;
    const [kind, hex] = (c.material as THREE.Material).name.split('_');
    const n16 = parseInt(hex, 16);
    const finish: Finish = oneMaterial ? 'rubber' : kind === 'glow' ? 'glow' : n16 === GLASS ? 'glass' : n16 === CHROME ? 'chrome' : n16 === DARK ? 'rubber' : 'paint';
    const color = new THREE.Color(Number.isNaN(n16) ? 0x888888 : n16);
    const g = (c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone()).applyMatrix4(inv.clone().multiply(c.matrixWorld));
    for (const a of Object.keys(g.attributes)) if (a !== 'position' && a !== 'normal') g.deleteAttribute(a);
    const n = g.getAttribute('position').count;
    const cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) color.toArray(cols, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    if (!groups.has(finish)) groups.set(finish, []);
    groups.get(finish)!.push(g);
  });
  const out = new THREE.Group();
  for (const [finish, geos] of groups) {
    const m = new THREE.Mesh(mergeGeometries(geos), finishMaterial(finish));
    m.castShadow = finish !== 'glow';
    m.receiveShadow = true;
    out.add(m);
  }
  return out;
}

/** Loads public/assets/vehicles/<id>.glb for each id. Missing or broken files fall back to the box placeholder. */
export async function loadVehicleModels(ids: string[], base = `${import.meta.env.BASE_URL}assets/vehicles/`) {
  const loader = new GLTFLoader();
  await Promise.all(
    ids.map(async (id) => {
      try {
        const { scene } = await loader.loadAsync(`${base}${id}.glb`);
        const bodyNode = scene.getObjectByName('body');
        const wheelNode = scene.getObjectByName('wheel_FL');
        if (!bodyNode || !wheelNode) throw new Error('needs "body" and "wheel_FL" nodes');
        const body = bake(bodyNode);
        body.position.copy(bodyNode.position); // body sits at the car origin
        models.set(id, { body, wheel: bake(wheelNode, true) }); // wheel: one mesh (×4 per car, so draw calls matter more than finish)
      } catch (e) {
        console.warn(`vehicle model "${id}" unavailable, using placeholder:`, e);
      }
    }),
  );
}

/** Deep clone with its own materials (Blink Boost fades materials per car). */
export function cloneModel(o: THREE.Object3D) {
  const c = o.clone(true);
  c.traverse((n) => {
    if (n instanceof THREE.Mesh) n.material = Array.isArray(n.material) ? n.material.map((m) => m.clone()) : n.material.clone();
  });
  return c;
}
