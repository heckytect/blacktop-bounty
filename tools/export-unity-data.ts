// AAA_PLAN §3: the web build's tuned data is the Unity port's source of truth.
// Writes unity/Assets/Resources/Data/game.json in Unity's frame (+Z forward, +X right, +Y up).
// Web frame is +X forward, +Z right, so web (x, y, z) → Unity (z, y, x).
// Run: node tools/export-unity-data.ts
import { writeFileSync, mkdirSync } from 'node:fs';
import { ALL_VEHICLES, stats, wheelLayout, wheelY, SUSPENSION_REST } from '../src/data/vehicles.ts';
import { TIERS } from '../src/feel.ts';
import { GEARS } from '../src/audio.ts';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

const game = {
  version: 1,
  gravity: -20,
  suspensionRest: SUSPENSION_REST,
  gears: GEARS,
  tiers: Object.entries(TIERS).map(([name, t]) => ({ name, trauma: t.trauma, stop: t.stop, slow: t.slow, strong: t.rumble[0], weak: t.rumble[1], rumbleMs: t.rumble[2] })),
  vehicles: ALL_VEHICLES.map((d) => ({
    id: d.id,
    name: d.name,
    driver: d.driver,
    cls: d.cls,
    armor: d.armor,
    speed: d.speed,
    handling: d.handling,
    hpScale: d.hpScale ?? 1,
    half: { x: d.half.z, y: d.half.y, z: d.half.x },
    wheelR: d.wheelR,
    color: hex(d.color),
    ability: d.ability,
    abilityName: d.abilityName,
    chargeTime: d.chargeTime,
    aiRange: d.aiRange,
    aiStyle: d.aiStyle,
    stats: stats(d),
    wheels: wheelLayout(d).map(([x, z, front]) => ({ pos: { x: z, y: wheelY(d), z: x }, front })),
    parts: d.parts.map((p) => ({ size: { x: p.size[2], y: p.size[1], z: p.size[0] }, pos: { x: p.pos[2], y: p.pos[1], z: p.pos[0] }, color: hex(p.color), glow: !!p.glow })),
  })),
};

const dir = new URL('../unity/Assets/Resources/Data/', import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL('game.json', dir), JSON.stringify(game, null, 1) + '\n');
console.log(`wrote ${game.vehicles.length} vehicles, ${game.tiers.length} tiers, ${game.gears.length} gears`);
