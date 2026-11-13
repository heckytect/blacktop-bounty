import * as THREE from 'three';
import type { ArenaBuilder, ArenaDef, ArenaTheme } from '../arena';
import { bomberEvent, bridgeEvent, collapseEvent, fallingSignEvent, floodEvent, propEvent, trainEvent, type Slab } from '../events';

// Spec §7 arenas as greybox data. Each: ~300×300 m, 2–3 levels, 8 spawns, 12–20 pickups,
// ≥ 6 destructible props, one event. M5 swaps the boxes for Blender art.

const PI = Math.PI;
// Ramp yaw: which way it rises. (yaw θ maps local +X to (cos θ, 0, -sin θ).)
const UP_POS_X = 0;
const UP_NEG_X = PI;
const UP_POS_Z = -PI / 2;
const UP_NEG_Z = PI / 2;

const dusk = (sky: number, o: Partial<ArenaTheme> = {}): ArenaTheme => ({
  sky, fogNear: 70, fogFar: 260, hemiSky: 0xffe2b8, hemiGround: 0x7a4a2c, hemiIntensity: 1.4, sun: 0xfff0d0, sunIntensity: 2.2,
  hdri: 'dusk', exposure: 0.8, surfaces: { ground: 'sand', building: 'brick', ramp: 'rock' }, ...o,
});

/** Standard pickup spread: 4 health, the given weapon spots, 1 special. */
function pickups(b: ArenaBuilder, health: number[][], weapons: number[][], special: number[]) {
  for (const [x, z, y = 0] of health) b.pickup('health', x, z, y);
  for (const [x, z, y = 0] of weapons) b.pickup('weapon', x, z, y);
  b.pickup('special', special[0], special[1], special[2] ?? 0);
}

function spawns(b: ArenaBuilder, pts: number[][]) {
  for (const [x, z, y = 0] of pts) b.spawn(x, z, y);
}

/** Tall pole with a glowing board on top (visual board; the pole is the collider). */
function signBoard(poleH: number) {
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(1, 7, 20),
    new THREE.MeshLambertMaterial({ color: 0xff3fa4, emissive: 0xff3fa4, emissiveIntensity: 0.9 }),
  );
  board.position.y = poleH + 3.5;
  return board;
}

export const ARENAS: ArenaDef[] = [
  {
    id: 'saguaro-junction',
    name: 'Saguaro Junction',
    blurb: 'Desert gas station, motel and diner. Shoot the fuel tanker for a 40 m fireball.',
    theme: dusk(0xe9a36b),
    half: 140,
    build(b) {
      b.ground(0xd6a46b);
      b.deco(280, 0.05, 16, 0, 0, 0, 0x4a4a4f, { surface: 'asphalt' }); // highway
      for (let x = -130; x <= 130; x += 12) b.deco(5, 0.06, 0.4, x, 0, 0, 0xf2d24b, { glow: true });
      // Gas station: canopy on pillars, building, pumps that explode.
      b.box(26, 1, 16, 40, 5, -35, 0xd8d8d8, { surface: 'metal' });
      for (const [dx, dz] of [[-12, -7], [12, -7], [-12, 7], [12, 7]]) b.cyl(0.4, 5, 40 + dx, 0, -35 + dz, 0xbbbbbb);
      b.box(16, 6, 10, 40, 0, -57, 0xc96a3a, { surface: 'concrete' });
      for (const dx of [-6, 0, 6]) b.prop({ shape: 'box', size: [1.2, 2, 1.6], pos: [40 + dx, 0, -35], color: 0xe23b2e, hp: 20, surface: 'metal', explode: { radius: 8, damage: 35, knockback: 10 } });
      // Motel: drive up the ramp onto its roof (level 2).
      b.platform(50, 14, -60, 60, 6, 0xe0b98c);
      b.ramp(-23, 60, 24, 10, 6, UP_NEG_X, 0x9a8a78);
      for (let x = -80; x <= -40; x += 8) b.deco(3, 3, 0.2, x, 0, 52.9, 0x5ec8c8, { glow: true });
      // Diner and water tower.
      b.box(20, 5, 12, 70, 0, 60, 0x8fc1c9);
      b.prop({ shape: 'cyl', size: [3, 14, 3], pos: [-115, 0, -110], color: 0x9aa3a8, hp: 80, surface: 'metal' });
      // Event: the fuel tanker.
      const cab = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3.2), new THREE.MeshLambertMaterial({ color: 0xb03030, flatShading: true }));
      cab.position.set(8.5, 1.5, 0);
      b.prop({ shape: 'box', size: [14, 3.6, 3.2], pos: [-10, 0, -22], rotY: 0.3, color: 0xdedede, hp: 60, tag: 'tanker', surface: 'metal', explode: { radius: 40, damage: 80, knockback: 16 }, extra: cab });
      for (const [x, z] of [[20, 30], [-30, 20], [60, 100], [-90, -60], [100, -80], [-50, -100], [110, 20], [10, 110]]) b.cactus(x, z);
      for (const [x, z] of [[25, -20], [55, -20], [-40, 40], [85, 45]]) b.barrel(x, z);
      b.mound(-70, -40, 18, 12, 2.4, 0xc79a62, 0.4);
      b.mound(80, -110, 18, 12, 2.4, 0xc79a62);
      spawns(b, [[101, 42], [42, 101], [-42, 101], [-101, 42], [-101, -42], [-42, -101], [42, -101], [101, -42]]);
      pickups(
        b,
        [[60, 0], [-60, 0], [0, 60], [-45, 60, 6]],
        [[35, 0], [25, 25], [0, 35], [-25, 25], [-35, 0], [-25, -25], [0, -35], [25, -25], [-70, 60, 6], [100, 100]],
        [0, 0],
      );
    },
    event: (ctx) => propEvent(ctx, 'Fuel tanker explosion', 'tanker', new THREE.Vector3(14, 0, 0)),
  },
  {
    id: 'copper-canyon',
    name: 'Copper Canyon Mine',
    blurb: 'Open-pit benches and a rail line. A runaway ore train tears through every 45 s.',
    theme: dusk(0xd98c5f, { hemiGround: 0x6a3a22, surfaces: { ground: 'rock', building: 'rust', ramp: 'rock' } }),
    half: 140,
    build(b) {
      b.ground(0x9c5a33);
      // Benches: level 2 at 5 m, level 3 at 10 m.
      b.platform(280, 40, 0, 100, 5, 0x8a4e2c, 0, 'rock');
      b.platform(280, 20, 0, 130, 10, 0x7a4426, 0, 'rock');
      b.ramp(-60, 70, 20, 12, 5, UP_POS_Z, 0x9c6a48);
      b.ramp(60, 110, 20, 12, 5, UP_POS_Z, 0x9c6a48, 5);
      // Rail line along z = 20 (the event's track).
      b.deco(300, 0.12, 0.3, 0, 0, 19.25, 0x777777, { surface: 'metal' });
      b.deco(300, 0.12, 0.3, 0, 0, 20.75, 0x777777, { surface: 'metal' });
      for (let x = -140; x <= 140; x += 3) b.deco(0.5, 0.08, 3, x, 0, 20, 0x5a3a22, { surface: 'wood' });
      for (const x of [-100, 100]) {
        b.cyl(0.25, 5, x, 0, 25, 0x333333);
        b.deco(0.6, 0.6, 0.6, x, 5, 25, 0xff2a2a, { glow: true });
      }
      // Processing shed, headframe tower, ore carts and TNT.
      b.box(30, 10, 16, -80, 0, -90, 0x6b5a4a);
      b.prop({ shape: 'box', size: [6, 18, 6], pos: [80, 0, -95], color: 0x5a4a3a, hp: 120, surface: 'rust' });
      for (const x of [-40, -30, -20, 20, 30, 40]) b.prop({ shape: 'box', size: [3, 2, 2], pos: [x, 0, -60], color: 0x7a5a3a, hp: 25, surface: 'rust' });
      for (const [x, z] of [[-110, -20], [110, -20], [0, -100], [-30, 60]]) b.barrel(x, z);
      b.mound(-90, -30, 18, 12, 2.4, 0xa86a40);
      b.mound(60, -30, 18, 12, 2.4, 0xa86a40, 0.6);
      spawns(b, [[-110, -40], [-60, -110], [0, -50], [60, -110], [110, -45], [-100, 50], [100, 50], [0, 55]]);
      pickups(
        b,
        [[-120, 0], [120, 0], [0, -110], [0, 100, 5]],
        [[-90, -10], [-30, -15], [30, -15], [90, -10], [-90, 45], [90, 45], [-30, 100, 5], [30, 100, 5], [0, 130, 10]],
        [0, -80],
      );
    },
    event: (ctx) => trainEvent(ctx, 20),
  },
  {
    id: 'las-vistas',
    name: 'Las Vistas Strip',
    blurb: 'Neon casino row at night with a two-deck parking garage. Drop the giant sign on the road.',
    theme: {
      sky: 0x1b1035, fogNear: 60, fogFar: 240, hemiSky: 0x8a6bd8, hemiGround: 0x20142e, hemiIntensity: 0.9, sun: 0x9fb0ff, sunIntensity: 0.8, dust: 0x4a4650,
      hdri: 'night', exposure: 1.3, surfaces: { ground: 'asphalt', building: 'concrete', ramp: 'concrete' },
    },
    half: 140,
    build(b) {
      b.ground(0x2b2b33);
      for (let z = -130; z <= 130; z += 10) b.deco(0.4, 0.06, 5, 0, 0, z, 0xf2d24b, { glow: true });
      // Casinos with neon trim.
      const casinos: [number, number, number, number, number, number][] = [
        [-45, -70, 40, 18, 50, 0xff3fa4], [-45, 30, 40, 22, 40, 0x3fd4ff],
        [45, -40, 40, 16, 40, 0xffd23f], [45, 60, 40, 20, 50, 0x7cff6b],
      ];
      for (const [x, z, w, h, d, neon] of casinos) {
        b.box(w, h, d, x, 0, z, 0x3a3346);
        const face = x < 0 ? x + w / 2 + 0.2 : x - w / 2 - 0.2;
        b.deco(0.3, 1, d, face, h - 3, z, neon, { glow: true });
        b.deco(0.3, 1, d, face, 2, z, neon, { glow: true });
      }
      // Parking garage: deck at 6 m, top deck at 12 m.
      b.platform(50, 40, 100, -95, 6, 0x55555e);
      b.ramp(100, -65, 20, 12, 6, UP_NEG_Z, 0x66666e);
      b.platform(25, 40, 112, -95, 12, 0x4a4a52);
      b.ramp(89.5, -95, 20, 12, 6, UP_POS_X, 0x66666e, 6);
      // Event: the casino sign beside the road.
      b.prop({ shape: 'box', size: [1.2, 16, 1.2], pos: [-18, 0, 0], color: 0x888899, hp: 120, tag: 'sign', extra: signBoard(16) });
      for (const z of [-110, -30, 30, 110]) b.prop({ shape: 'cyl', size: [0.5, 7, 0.5], pos: [-16, 0, z], color: 0x3fd4ff, hp: 20, glow: true });
      for (const z of [-110, 110]) b.prop({ shape: 'cyl', size: [0.5, 7, 0.5], pos: [16, 0, z], color: 0xff3fa4, hp: 20, glow: true });
      for (const [x, z] of [[-90, -20], [90, 20], [-100, 80], [70, -120]]) b.barrel(x, z);
      spawns(b, [[0, -125], [0, 125], [-110, -120], [-110, 110], [110, 120], [-80, -10], [80, 10], [125, -40]]);
      pickups(
        b,
        [[0, -60], [0, 60], [-100, 0], [100, -95, 6]],
        [[-8, -100], [8, 100], [-90, 80], [90, -10], [-90, -50], [112, -95, 12], [40, -120], [-40, 120], [65, 10]],
        [5, 0],
      );
    },
    event: (ctx) => fallingSignEvent(ctx, 'sign', 1),
  },
  {
    id: 'hoover-spillway',
    name: 'Hoover Spillway',
    blurb: 'A dam-top plateau above a dry basin. When the floodgates open, the spillway washes cars down.',
    theme: dusk(0xbfd7e0, { hemiSky: 0xe8f2ff, hemiGround: 0x6a6a60, sun: 0xffffff, dust: 0xb0a898, hdri: 'day', exposure: 0.9, surfaces: { ground: 'sand', building: 'concrete', ramp: 'concrete' } }),
    half: 140,
    build(b) {
      b.ground(0xb08a5a);
      // Dam top + reservoir bed: one plateau at 10 m (level 2) north of z = -32.
      b.box(290, 10, 182, 0, 0, 59, 0xb8b2a6);
      // Spillway channel down to the basin, with walls.
      b.ramp(0, -52, 40, 30, 10, UP_POS_Z, 0xa8a296);
      b.box(1.5, 12, 40, -16, 0, -52, 0x8f8a80);
      b.box(1.5, 12, 40, 16, 0, -52, 0x8f8a80);
      // Access roads at the ends of the dam.
      b.ramp(110, -52, 40, 14, 10, UP_POS_Z, 0x9a948a);
      b.ramp(-110, -52, 40, 14, 10, UP_POS_Z, 0x9a948a);
      // Control house and a level-3 lookout on the plateau.
      b.box(16, 6, 10, -40, 10, -20, 0x9f998e);
      b.platform(30, 30, 60, 90, 16, 0xa39d92);
      b.ramp(60, 63, 24, 12, 6, UP_POS_Z, 0x9a948a, 10);
      // Props: lamp posts along the dam, transformers, barrels.
      for (const x of [-120, -80, 40, 80, 120, -100]) b.prop({ shape: 'cyl', size: [0.3, 6, 0.3], pos: [x, 10, -28], color: 0xdddddd, hp: 15 });
      for (const x of [-70, 70]) b.prop({ shape: 'box', size: [3, 3, 3], pos: [x, 10, 10], color: 0x6b7a5a, hp: 30, explode: { radius: 9, damage: 35, knockback: 10 } });
      for (const [x, z] of [[-60, -110], [60, -110], [-30, 40], [30, 120]]) b.barrel(x, z, z > -32 ? 10 : 0);
      b.mound(-70, -100, 18, 12, 2.4, 0xa07a4a);
      b.mound(70, -95, 18, 12, 2.4, 0xa07a4a, 0.5);
      spawns(b, [[-80, -110], [80, -120], [-40, -125], [40, -125], [-80, 60, 10], [100, 30, 10], [-40, 110, 10], [10, 120, 10]]);
      pickups(
        b,
        [[0, -110], [0, -20, 10], [-100, 40, 10], [100, 40, 10]],
        [[-60, -60], [60, -60], [-110, -110], [110, -110], [-70, -20, 10], [70, -20, 10], [-40, 70, 10], [20, 70, 10], [60, 90, 16]],
        [0, 60, 10],
      );
    },
    event: (ctx) => floodEvent(ctx, { minX: -15, maxX: 15, minZ: -72, maxZ: -24, maxY: 12 }, new THREE.Vector3(0, 0, -1)),
  },
  {
    id: 'roswell-airfield',
    name: 'Roswell Airfield',
    blurb: 'Hangars, a runway and parked aircraft. A bomber makes regular passes.',
    theme: dusk(0xf0c27a, { hdri: 'day', exposure: 0.95, surfaces: { ground: 'sand', building: 'metal', ramp: 'concrete' } }),
    half: 140,
    build(b) {
      b.ground(0xc9b28a);
      b.deco(270, 0.05, 30, 0, 0, -60, 0x55555a, { surface: 'asphalt' }); // runway
      for (let x = -120; x <= 120; x += 20) b.deco(10, 0.06, 1, x, 0, -60, 0xffffff);
      // Hangars: three-sided, drive-in; the east one has a ramp to its roof (level 2).
      for (const hx of [-60, 0, 60]) {
        b.box(32, 10, 1, hx, 0, 76, 0x8a9096);
        b.box(1, 10, 32, hx - 16, 0, 60, 0x8a9096);
        b.box(1, 10, 32, hx + 16, 0, 60, 0x8a9096);
        b.box(34, 1, 34, hx, 10, 60, 0x9aa0a6);
      }
      b.ramp(89, 60, 24, 12, 11, UP_NEG_X, 0x8a8f94);
      // Control tower (level 3 via a long ramp) with a radar dish.
      b.platform(16, 16, -110, -10, 14, 0xa89f90, 0, 'concrete');
      b.ramp(-110, 16, 36, 10, 14, UP_NEG_Z, 0x8a8f94);
      b.prop({ shape: 'cyl', size: [2.5, 1, 2.5], pos: [-110, 14, -10], color: 0xd0d0d0, hp: 50, surface: 'metal' });
      // Parked planes (solid fuselages), fuel trucks, light towers, barrels.
      for (const [x, z] of [[-40, -20], [40, -20]]) {
        b.box(18, 3, 3, x, 0, z, 0x7d8a6e);
        b.deco(4, 0.4, 20, x + 1, 2, z, 0x6d7a5e);
      }
      for (const x of [-80, 100]) b.prop({ shape: 'box', size: [8, 3, 2.6], pos: [x, 0, 20], color: 0xd9a33a, hp: 40, surface: 'metal', explode: { radius: 12, damage: 45, knockback: 12 } });
      for (const [x, z] of [[-130, -100], [130, -100], [-130, 100], [130, 100]]) b.prop({ shape: 'cyl', size: [0.4, 10, 0.4], pos: [x, 0, z], color: 0x777777, hp: 25, surface: 'metal' });
      for (const [x, z] of [[-20, 30], [20, 30], [110, -20], [-60, -110]]) b.barrel(x, z);
      spawns(b, [[-120, -110], [-40, -110], [40, -110], [120, -110], [-120, 0], [120, 0], [-40, 10], [40, 10]]);
      pickups(
        b,
        [[0, -60], [-120, 60], [120, 60], [60, 60, 11]],
        [[-95, -30], [95, -30], [-60, -90], [60, -90], [-110, 110], [110, 110], [0, 60], [-60, 60], [-110, -10, 14]],
        [0, -10],
      );
    },
    event: (ctx) => bomberEvent(ctx),
  },
  {
    id: 'painted-mesa',
    name: 'Painted Mesa',
    blurb: 'A ghost town split by a chasm. Two rock arches and one rope bridge… until someone shoots the bridge.',
    theme: dusk(0xf2a65a, { hemiGround: 0x7a2e1c, surfaces: { ground: 'rock', building: 'wood', ramp: 'rock' } }),
    half: 140,
    hasPits: true,
    build(b) {
      const h = 150;
      b.ground(0xb5562f, { minX: -h, maxX: -10, minZ: -h, maxZ: h });
      b.ground(0xb5562f, { minX: 10, maxX: h, minZ: -h, maxZ: h });
      for (const x of [-11, 11]) b.deco(2, 40, 300, x, -40, 0, 0x6a2a18, { surface: 'rock' }); // chasm walls
      // Curbs along the chasm (gaps at the bridge and arches): you can be blasted over, not roll over.
      for (const x of [-10.5, 10.5]) {
        for (const [z0, z1] of [[-150, -112], [-88, -8], [8, 88], [112, 150]]) b.box(1, 0.8, z1 - z0, x, 0, (z0 + z1) / 2, 0x7a3220);
      }
      // Rock arches (permanent) and the rope bridge (event).
      for (const z of [-100, 100]) {
        b.box(22, 2, 24, 0, -2, z, 0x8a3a22, { surface: 'rock' });
        for (const dz of [-12, 12]) b.box(20, 1, 0.8, 0, 0, z + dz, 0x6a2a18); // guard rails
      }
      b.prop({ shape: 'box', size: [22, 1.2, 12], pos: [0, -1.2, 0], color: 0x8b5a2b, hp: 200, tag: 'bridge', surface: 'wood' });
      // Mesa (level 2) and its summit (level 3) on the west side.
      b.platform(60, 50, -90, 40, 8, 0xa04a28, 0, 'rock');
      b.ramp(-90, 5, 20, 12, 8, UP_POS_Z, 0x9a4a2a);
      b.platform(20, 20, -100, 50, 14, 0x8a3e22, 0, 'rock');
      b.ramp(-100, 30, 20, 10, 6, UP_POS_Z, 0x9a4a2a, 8);
      // Ghost town to the east.
      b.box(20, 8, 14, 70, 0, -50, 0x8a6a4a);
      b.box(16, 7, 12, 100, 0, 20, 0x7a5a3a);
      b.box(12, 10, 18, 60, 0, 60, 0x9a7a5a);
      for (const [x, z] of [[40, -20], [90, -80], [120, 50], [40, 90]]) b.prop({ shape: 'box', size: [5, 2.2, 2.5], pos: [x, 0, z], color: 0x6b4a2a, hp: 25, surface: 'wood' });
      for (const [x, z] of [[-40, -60], [-130, -20], [130, -20], [-40, 80]]) b.cactus(x, z);
      for (const [x, z] of [[30, -40], [80, 0], [-60, -30], [-30, 40]]) b.barrel(x, z);
      spawns(b, [[-120, -110], [-40, -110], [-40, 115], [-120, 115], [40, -110], [120, -110], [40, 115], [120, 115]]);
      pickups(
        b,
        [[-60, -60], [60, -60], [-75, 30, 8], [100, 80]],
        [[-110, -60], [-30, -30], [30, 30], [110, 60], [0, 0], [-100, 50, 14], [0, 100], [0, -100], [-30, 100]],
        [60, 0],
      );
    },
    event: (ctx) => bridgeEvent(ctx, 'bridge', [-12, 12, -8, 8]),
  },
  {
    id: 'penthouse-lot',
    name: 'The Penthouse Lot',
    blurb: 'Boss arena: a rooftop car park high above the city. The edges fall away in stages.',
    theme: {
      sky: 0x6a4c93, fogNear: 80, fogFar: 300, hemiSky: 0xffc8e0, hemiGround: 0x2a1a3a, hemiIntensity: 1.1, sun: 0xffb8a0, sunIntensity: 1.6, dust: 0x8a8890,
      hdri: 'purple', exposure: 1, surfaces: { ground: 'concrete', building: 'concrete', ramp: 'concrete' },
    },
    half: 90,
    walls: false,
    hasPits: true,
    horizon: 'none',
    build(b) {
      const CORE = 50;
      b.ground(0x7a7a80, { minX: -CORE, maxX: CORE, minZ: -CORE, maxZ: CORE });
      // Outer rings collapse in three stages (outermost first).
      const rings: [number, number][] = [[75, 90], [62, 75], [CORE, 62]];
      const stages: Slab[][] = rings.map(([rin, rout]) => {
        const slab = (minX: number, maxX: number, minZ: number, maxZ: number): Slab => {
          const { collider, mesh } = b.ground(0x84848a, { minX, maxX, minZ, maxZ }, 0, false);
          mesh!.userData.static = false; // these fall away
          return { collider, mesh: mesh!, size: [maxX - minX, 4, maxZ - minZ], rect: [minX - 2, maxX + 2, minZ - 2, maxZ + 2] };
        };
        return [slab(-rout, rout, rin, rout), slab(-rout, rout, -rout, -rin), slab(rin, rout, -rin, rin), slab(-rout, -rin, -rin, rin)];
      });
      b.arena.data.slabs = stages;
      // Parapet on the outer edge (it goes down with the first collapse).
      for (const [x, z, w, d] of [[0, 89.5, 180, 1], [0, -89.5, 180, 1], [89.5, 0, 1, 178], [-89.5, 0, 1, 178]]) {
        const { collider, mesh } = b.box(w, 0.8, d, x, 0, z, 0x6a6a72);
        mesh!.userData.static = false;
        stages[0].push({ collider, mesh: mesh!, size: [w, 0.8, d], rect: [0, 0, 0, 0] });
      }
      for (let x = -80; x <= 80; x += 8) b.deco(0.3, 0.05, 6, x, 0, 30, 0xeeeeee);
      // Helipad (level 2) with a ramp.
      b.platform(24, 24, 0, 0, 4, 0x5a5a62);
      b.ramp(22, 0, 20, 10, 4, UP_NEG_X, 0x6a6a72);
      b.deco(10, 0.06, 2, 0, 4, 0, 0xffd23f, { glow: true });
      // Props: AC units, light poles, barrels.
      for (const [x, z] of [[40, 40], [-40, 40], [40, -40], [-40, -40]]) b.prop({ shape: 'box', size: [4, 3, 4], pos: [x, 0, z], color: 0x9a9aa2, hp: 40, surface: 'metal' });
      for (const [x, z] of [[0, 46], [0, -46], [46, 12], [-46, 15]]) b.prop({ shape: 'cyl', size: [0.3, 8, 0.3], pos: [x, 0, z], color: 0xcccccc, hp: 20, surface: 'metal' });
      for (const [x, z] of [[25, 45], [-25, -45], [-45, -20], [20, -25]]) b.barrel(x, z);
      // City below (visual only).
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * PI * 2;
        const r = 150 + (i % 3) * 30;
        b.deco(30, 160 + (i % 4) * 30, 30, Math.cos(a) * r, -200, Math.sin(a) * r, i % 2 ? 0x2a2440 : 0x3a3050);
      }
      b.spawnRing(35, 8, 0, 0.5);
      pickups(
        b,
        [[-42, 0], [42, 0], [0, 42], [0, -42]],
        [[25, 25], [-25, 25], [25, -25], [-25, -25], [42, 42], [-42, 42], [42, -42], [-42, -42]],
        [0, 0, 4],
      );
    },
    event: (ctx) => collapseEvent(ctx, ctx.arena.data.slabs as Slab[][]),
  },
  {
    id: 'proving-ground',
    name: 'Proving Ground (dev)',
    blurb: 'Flat test ground with mounds and crates. No event.',
    theme: dusk(0xe9a36b, { surfaces: { ground: 'sand', building: 'wood', ramp: 'rock' } }),
    half: 145,
    build(b) {
      b.ground(0xc98b5a);
      b.mound(30, 0, 16, 12, 2.2, 0x6f8f8a);
      b.mound(-40, 25, 16, 12, 2.2, 0x6f8f8a);
      b.mound(0, -50, 22, 16, 3.5, 0x6f8f8a);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * PI * 2;
        b.box(3, 3, 3, Math.cos(a) * 80, 0, Math.sin(a) * 80, 0x8c5b3a);
      }
      b.spawnRing(60, 8, 0, 0.5);
      b.pickupRing('health', 100, 4);
      b.pickupRing('weapon', 40, 8);
      b.pickup('special', 0, 0);
    },
  },
];
