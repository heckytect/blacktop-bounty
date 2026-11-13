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

/**
 * Bake a glTF node (one mesh per material) into ≤ 2 meshes with vertex colours: flat Lambert for paint,
 * unlit for lights. Material names c_<hex> / glow_<hex> carry the colour. Keeps a car at ~6 draw calls.
 */
function bake(node: THREE.Object3D) {
  node.updateMatrixWorld(true);
  const inv = node.matrixWorld.clone().invert();
  const lit: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  node.traverse((c) => {
    if (!(c instanceof THREE.Mesh)) return;
    const [kind, hex] = (c.material as THREE.Material).name.split('_');
    const color = new THREE.Color(Number.isNaN(parseInt(hex, 16)) ? 0x888888 : parseInt(hex, 16));
    const g = (c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone()).applyMatrix4(inv.clone().multiply(c.matrixWorld));
    for (const a of Object.keys(g.attributes)) if (a !== 'position' && a !== 'normal') g.deleteAttribute(a);
    const n = g.getAttribute('position').count;
    const cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) color.toArray(cols, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    (kind === 'glow' ? glow : lit).push(g);
  });
  const out = new THREE.Group();
  if (lit.length) {
    const m = new THREE.Mesh(mergeGeometries(lit), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    m.castShadow = true;
    out.add(m);
  }
  if (glow.length) out.add(new THREE.Mesh(mergeGeometries(glow), new THREE.MeshBasicMaterial({ vertexColors: true })));
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
        models.set(id, { body, wheel: bake(wheelNode) }); // wheel baked about its own centre
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
