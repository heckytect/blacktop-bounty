import { describe, expect, test } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { ALL_VEHICLES } from '../src/data/vehicles';

// Spec §8.1 item 6: fail CI if a vehicle model is over budget or missing the names the game needs.
const MAX_TRIS = 5000;
const MAX_BYTES = 1.5 * 1024 * 1024;
const REQUIRED = ['body', 'wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR', 'muzzle_L', 'muzzle_R', 'special_mount', 'exhaust'];

/** Reads the JSON chunk of a .glb (no deps). */
function glbJson(path: string) {
  const b = readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'glTF') throw new Error(`${path} is not a GLB`);
  const len = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
}

describe.each(ALL_VEHICLES.map((v) => [v.id] as const))('%s.glb', (id) => {
  const path = `public/assets/vehicles/${id}.glb`;

  test('exists, within size and triangle budget, §8.1 node names', () => {
    expect(statSync(path).size).toBeLessThanOrEqual(MAX_BYTES);
    const j = glbJson(path);
    const names = j.nodes.map((n: { name: string }) => n.name);
    for (const n of REQUIRED) expect(names).toContain(n);
    let tris = 0;
    for (const mesh of j.meshes) {
      for (const p of mesh.primitives) {
        const acc = j.accessors[p.indices ?? p.attributes.POSITION];
        tris += acc.count / 3;
      }
    }
    expect(tris).toBeLessThanOrEqual(MAX_TRIS);
  });
});
