// Dumps the roster (src/data/vehicles.ts) to JSON for the Blender generator, so models and physics share one source.
// Run: node tools/export-vehicle-data.ts
import { writeFileSync } from 'node:fs';
import { ALL_VEHICLES, wheelLayout, wheelY } from '../src/data/vehicles.ts';

const out = ALL_VEHICLES.map((d) => ({
  id: d.id,
  half: d.half,
  wheelR: d.wheelR,
  color: d.color,
  parts: d.parts,
  wheels: wheelLayout(d).map(([x, z, front]) => ({ x, y: wheelY(d), z, front })),
}));
writeFileSync(new URL('./blender/vehicles.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(`wrote ${out.length} vehicles`);
