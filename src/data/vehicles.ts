// Single source of truth for the roster (spec §5). Tune balance here.

export type AbilityId =
  | 'sidewinder' | 'jackknife' | 'lastRites' | 'blink' | 'harvester'
  | 'mirrorBall' | 'roadblock' | 'wheelie' | 'tumbleweed' | 'sunLance' | 'payday' | 'none';

/** Placeholder geometry: a box in car-local space (+X forward, +Y up, +Z right). */
export interface Part {
  size: [number, number, number];
  pos: [number, number, number];
  color: number;
  glow?: boolean;
}

export interface VehicleDef {
  id: string;
  name: string;
  driver: string;
  cls: string;
  bio: string;
  armor: number; // 1..5
  speed: number; // 1..5
  handling: number; // 1..5
  half: { x: number; y: number; z: number }; // collider half-extents
  wheelR: number;
  color: number;
  parts: Part[];
  ability: AbilityId;
  abilityName: string;
  abilityDesc: string;
  chargeTime: number; // s to refill special
  aiRange: number; // bot uses special when target is closer than this
  aiStyle: AiStyle;
  /** Campaign ending card: three sentences (spec §5.2). */
  ending: string;
  /** Caption lines (spec §11 subtitles): when this driver wrecks you / gets wrecked. */
  taunts: { kill: string; wrecked: string };
  hpScale?: number; // boss armour multiplier
}

/** Bot personality (spec §10): how it engages. */
export type AiStyle = 'aggressive' | 'sniper' | 'rammer' | 'hitAndRun';

// Stat → physics (spec §5).
export const stats = (d: VehicleDef) => ({
  maxHp: (120 + 30 * (d.armor - 1)) * (d.hpScale ?? 1), // M7 balance: flatter than 100 + 40/pt (armour dominated bot fights)
  topSpeed: 30 + 5 * (d.speed - 1), // m/s
  mass: 500 + 250 * (d.armor - 1), // kg
  accel: 6 + 1 * (d.speed - 1), // m/s², sets engine force
  grip: 2.0 + 0.3 * (d.handling - 1),
  maxSteer: 0.5 + 0.05 * (d.handling - 1), // rad
});

export const SUSPENSION_REST = 0.35;

/** Wheel layout derived from the collider: [x, z, front?] in car space (+X fwd, +Z right). Wheel centre y = wheelY(d). */
export const wheelLayout = (d: VehicleDef) =>
  [
    [d.half.x - 0.65, -d.half.z, true],
    [d.half.x - 0.65, d.half.z, true],
    [-d.half.x + 0.7, -d.half.z, false],
    [-d.half.x + 0.7, d.half.z, false],
  ] as const;

/** Wheel centre height at suspension rest. */
export const wheelY = (d: VehicleDef) => -d.half.y + 0.1 - SUSPENSION_REST;

const DARK = 0x222222;
const GLASS = 0x3a6f80;
const CHROME = 0xc9ccd1;

export const VEHICLES: VehicleDef[] = [
  {
    id: 'dust-devil', name: 'Dust Devil', driver: 'Rosa "Rattler" Quintero', cls: '1971 muscle coupe',
    bio: 'Ran moonshine across three state lines. Wants the prize money to buy back her father\'s garage.',
    hpScale: 1.1, armor: 3, speed: 4, handling: 3, half: { x: 2.0, y: 0.45, z: 0.95 }, wheelR: 0.42, color: 0xe07a2b,
    parts: [
      { size: [4.0, 0.9, 1.9], pos: [0, 0, 0], color: 0xe07a2b },
      { size: [1.7, 0.55, 1.6], pos: [-0.3, 0.72, 0], color: GLASS },
      { size: [0.8, 0.18, 0.5], pos: [1.1, 0.54, 0], color: DARK },
      { size: [0.1, 0.12, 1.9], pos: [-2.0, 0.5, 0], color: DARK },
    ],
    ability: 'sidewinder', abilityName: 'Sidewinder Volley',
    abilityDesc: '4 homing missiles that snake along the ground, 15 dmg each.', chargeTime: 30, aiRange: 70, aiStyle: 'aggressive',
    ending: 'Rosa buys back the garage the morning after the final, cash still smelling of smoke. She paints the Dust Devil\'s name over the door and opens for business at noon. By dusk there is a line of drivers outside who want her to build them something fast.',
    taunts: { kill: 'Should\'ve stayed home, sugar.', wrecked: 'This isn\'t over, I know where you park.' },
  },
  {
    id: 'big-iron', name: 'Big Iron', driver: 'Earl Tubbs', cls: '18-wheel semi cab',
    bio: 'Forty years hauling freight. The company folded; Earl kept the truck.',
    hpScale: 0.9, armor: 5, speed: 1, handling: 1, half: { x: 3.0, y: 0.6, z: 1.2 }, wheelR: 0.6, color: 0x3d5a80,
    parts: [
      { size: [6.0, 1.2, 2.4], pos: [0, 0, 0], color: 0x2b3f5c },
      { size: [2.2, 1.6, 2.4], pos: [1.7, 1.4, 0], color: 0x3d5a80 },
      { size: [0.1, 0.7, 2.0], pos: [2.81, 1.6, 0], color: GLASS },
      { size: [0.2, 1.8, 0.2], pos: [0.5, 2.0, 1.05], color: CHROME },
      { size: [0.2, 1.8, 0.2], pos: [0.5, 2.0, -1.05], color: CHROME },
      { size: [0.2, 0.5, 2.3], pos: [3.05, -0.1, 0], color: CHROME },
    ],
    ability: 'jackknife', abilityName: 'Jackknife',
    abilityDesc: 'Full 360° spin with trailer swing: 60 dmg + knockback within 8 m.', chargeTime: 30, aiRange: 7, aiStyle: 'rammer',
    ending: 'Earl buys the trucking company that let him go and hires back every driver it fired. He keeps the semi\'s battered cab in the yard as a reminder. On quiet nights he still takes it out on the interstate, just to hear the engine.',
    taunts: { kill: 'Forty years on the road and you\'re the slowest thing I\'ve passed.', wrecked: 'Somebody call a tow. A big one.' },
  },
  {
    id: 'halo-hearse', name: 'Halo Hearse', driver: 'Father Ignatius Crowe', cls: 'Black 1968 hearse',
    bio: 'Buried too many of the contest\'s losers. This year he intends to send them off personally.',
    armor: 4, speed: 2, handling: 2, half: { x: 2.6, y: 0.45, z: 1.0 }, wheelR: 0.44, color: 0x1d1b22,
    parts: [
      { size: [5.2, 0.9, 2.0], pos: [0, 0, 0], color: 0x1d1b22 },
      { size: [3.6, 0.85, 1.85], pos: [-0.6, 0.87, 0], color: 0x2a2730 },
      { size: [0.9, 0.5, 1.86], pos: [0.9, 0.75, 0], color: GLASS },
      { size: [1.0, 0.06, 1.0], pos: [-0.6, 1.75, 0], color: 0xffd25a, glow: true },
    ],
    ability: 'lastRites', abilityName: 'Last Rites',
    abilityDesc: 'Drops a coffin bomb behind: 70 dmg on contact or after 2 s.', chargeTime: 28, aiRange: 0, aiStyle: 'hitAndRun',
    ending: 'Father Crowe donates the prize to the town\'s cemetery and finally gives its forgotten graves headstones. He parks the Halo Hearse behind the chapel and retires it with a blessing. The townsfolk swear they still hear its engine on Sunday nights.',
    taunts: { kill: 'Rest easy. I\'ll handle the paperwork.', wrecked: 'Pray for me, I\'m busy.' },
  },
  {
    id: 'mojave-moth', name: 'Mojave Moth', driver: 'Lily Sato', cls: 'Dune buggy',
    bio: 'Stunt rider who never met a jump she would not take. Racing for the thrill and the cameras.',
    hpScale: 1.25, armor: 1, speed: 5, handling: 5, half: { x: 1.6, y: 0.35, z: 0.85 }, wheelR: 0.5, color: 0xe8c547,
    parts: [
      { size: [3.2, 0.5, 1.7], pos: [0, 0, 0], color: 0xe8c547 },
      { size: [0.08, 0.8, 0.08], pos: [0.3, 0.65, 0.6], color: DARK },
      { size: [0.08, 0.8, 0.08], pos: [0.3, 0.65, -0.6], color: DARK },
      { size: [0.08, 0.8, 0.08], pos: [-0.6, 0.65, 0.6], color: DARK },
      { size: [0.08, 0.8, 0.08], pos: [-0.6, 0.65, -0.6], color: DARK },
      { size: [1.0, 0.08, 1.3], pos: [-0.15, 1.05, 0], color: DARK },
      { size: [0.7, 0.45, 1.0], pos: [-1.2, 0.4, 0], color: 0x555555 },
    ],
    ability: 'blink', abilityName: 'Blink Boost',
    abilityDesc: '0.4 s phase dash: passes through cars and projectiles.', chargeTime: 25, aiRange: 30, aiStyle: 'hitAndRun',
    ending: 'Lily\'s footage of the final jump goes everywhere within the week. She turns down every sponsor deal and spends the money building the biggest ramp the desert has ever seen. Nobody knows if the landing works yet; she says that\'s the fun part.',
    taunts: { kill: 'Caught that on camera, thanks!', wrecked: 'Ugh, that\'s going in the blooper reel.' },
  },
  {
    id: 'iron-prairie', name: 'Iron Prairie', driver: 'Hank "Tractor" Bodine', cls: 'Armored farm tractor',
    bio: 'The bank took the farm. Hank took the tractor and bolted plate steel to it.',
    armor: 4, speed: 1, handling: 2, half: { x: 1.9, y: 0.6, z: 1.0 }, wheelR: 0.65, color: 0xb8312f,
    parts: [
      { size: [3.8, 1.0, 2.0], pos: [0, 0, 0], color: 0x7a1f1d },
      { size: [1.7, 0.6, 1.0], pos: [0.9, 0.8, 0], color: 0xb8312f },
      { size: [1.1, 1.3, 1.5], pos: [-0.9, 1.15, 0], color: GLASS },
      { size: [1.2, 0.1, 1.7], pos: [-0.9, 1.85, 0], color: 0xb8312f },
      { size: [0.15, 1.3, 0.15], pos: [0.7, 1.6, 0.3], color: DARK },
      { size: [0.3, 0.7, 2.3], pos: [2.05, -0.1, 0], color: 0x555555 },
    ],
    ability: 'harvester', abilityName: 'Harvester',
    abilityDesc: 'Front blades spin for 4 s: 25 dmg/s to anything rammed.', chargeTime: 30, aiRange: 12, aiStyle: 'rammer',
    ending: 'Hank pays off the bank and buys the farm back with acres to spare. He bolts the Harvester blades over the barn door as a warning to future debt collectors. The first crop comes in heavy that autumn, and nobody bothers him again.',
    taunts: { kill: 'Plowed you under, city slicker.', wrecked: 'Dang. That\'ll buff out.' },
  },
  {
    id: 'disco-inferno', name: 'Disco Inferno', driver: 'Vince Valentino', cls: '1976 custom van',
    bio: 'Nightclub owner with debts to the wrong people. Winning is cheaper than paying.',
    armor: 3, speed: 3, handling: 3, half: { x: 2.3, y: 0.5, z: 1.05 }, wheelR: 0.45, color: 0x8e44ad,
    parts: [
      { size: [4.6, 1.0, 2.1], pos: [0, 0, 0], color: 0x8e44ad },
      { size: [3.4, 1.0, 2.05], pos: [-0.5, 1.0, 0], color: 0x8e44ad },
      { size: [3.42, 0.15, 2.07], pos: [-0.5, 0.85, 0], color: 0xff9a3c },
      { size: [0.1, 0.6, 1.8], pos: [1.2, 1.05, 0], color: GLASS },
    ],
    ability: 'mirrorBall', abilityName: 'Mirror Ball',
    abilityDesc: 'Reflective sphere for 4 s: bounces projectiles back to the sender.', chargeTime: 32, aiRange: 40, aiStyle: 'aggressive',
    ending: 'Vince pays off the people he owed and walks out with his kneecaps intact. He reopens the club with the Mirror Ball hung from the ceiling, still dented from the final. The dance floor is packed every night, and he finally sleeps well.',
    taunts: { kill: 'Stayin\' alive. You, not so much.', wrecked: 'The night is young... was young.' },
  },
  {
    id: 'sheriff-9', name: 'Sheriff 9', driver: 'Deputy Mae Holloway', cls: 'Interceptor cruiser',
    bio: 'The county stopped paying her years ago. She still wears the badge, and she still makes arrests.',
    armor: 3, speed: 4, handling: 4, half: { x: 2.2, y: 0.45, z: 0.95 }, wheelR: 0.42, color: 0xf2f2f2,
    parts: [
      { size: [4.4, 0.9, 1.9], pos: [0, 0, 0], color: 0xf2f2f2 },
      { size: [1.6, 0.5, 1.92], pos: [0, 0, 0], color: DARK },
      { size: [1.9, 0.55, 1.7], pos: [-0.3, 0.72, 0], color: GLASS },
      { size: [0.3, 0.15, 0.6], pos: [-0.3, 1.07, -0.35], color: 0xff2a2a, glow: true },
      { size: [0.3, 0.15, 0.6], pos: [-0.3, 1.07, 0.35], color: 0x2a6bff, glow: true },
    ],
    ability: 'roadblock', abilityName: 'Roadblock',
    abilityDesc: 'EMP siren jams weapons + steering of cars in a 15 m cone ahead for 3 s, and drops a spike strip behind.', chargeTime: 32, aiRange: 15, aiStyle: 'aggressive',
    ending: 'Mae drags the Proprietor out of the wreckage in cuffs and reads him his rights by flashlight. The county finally pays her back wages, with interest she calculated herself. She pins a new badge on Sheriff 9\'s dashboard and keeps patrolling.',
    taunts: { kill: 'You have the right to remain wrecked.', wrecked: 'Officer down. Send backup.' },
  },
  {
    id: 'thunder-pony', name: 'Thunder Pony', driver: 'Joey "Gears" Nakamura', cls: 'Chopper + sidecar gun',
    bio: 'Mechanic, gearhead, and the youngest driver in the contest. Built the sidecar gun himself.',
    hpScale: 1.3, armor: 1, speed: 5, handling: 4, half: { x: 1.6, y: 0.4, z: 0.85 }, wheelR: 0.45, color: 0x2b2b2b,
    parts: [
      { size: [2.6, 0.35, 0.35], pos: [0, 0.1, -0.4], color: CHROME },
      { size: [0.8, 0.35, 0.45], pos: [0.3, 0.45, -0.4], color: 0xd23a3a },
      { size: [0.5, 0.9, 0.45], pos: [-0.3, 0.85, -0.4], color: 0x5b3a26 },
      { size: [0.1, 0.5, 0.9], pos: [0.9, 0.7, -0.4], color: CHROME },
      { size: [1.7, 0.55, 0.8], pos: [-0.1, 0.05, 0.45], color: 0xd23a3a },
      { size: [1.0, 0.15, 0.15], pos: [0.7, 0.45, 0.45], color: DARK },
    ],
    ability: 'wheelie', abilityName: 'Wheelie Barrage',
    abilityDesc: '3 s minigun burst while popping a wheelie: invulnerable from the front.', chargeTime: 28, aiRange: 60, aiStyle: 'hitAndRun',
    ending: 'Joey opens a custom shop where nobody is too young to learn to weld. The first bike out of the door is a perfect copy of the Thunder Pony, sidecar gun and all. He tells every kid the same thing: build it yourself, then you know how to fix it.',
    taunts: { kill: 'Built that gun myself. Neat, huh?', wrecked: 'Aw man, I just rebuilt that!' },
  },
  {
    id: 'cactus-jack', name: 'Cactus Jack', driver: 'Delores "Ma" Pickett', cls: 'Lifted 4x4 pickup',
    bio: 'Raised six boys and a ranch on her own. The contest is just one more mess to clean up.',
    armor: 4, speed: 3, handling: 2, half: { x: 2.3, y: 0.5, z: 1.05 }, wheelR: 0.62, color: 0x6f8a3a,
    parts: [
      { size: [4.6, 1.0, 2.1], pos: [0, 0, 0], color: 0x6f8a3a },
      { size: [1.5, 0.75, 1.95], pos: [0.3, 0.87, 0], color: 0x6f8a3a },
      { size: [0.1, 0.5, 1.8], pos: [1.06, 0.9, 0], color: GLASS },
      { size: [0.15, 0.15, 1.7], pos: [-0.3, 1.4, 0], color: 0xffe14d, glow: true },
      { size: [2.0, 0.3, 0.1], pos: [-1.2, 0.65, 1.0], color: DARK },
      { size: [2.0, 0.3, 0.1], pos: [-1.2, 0.65, -1.0], color: DARK },
    ],
    ability: 'tumbleweed', abilityName: 'Tumbleweed Barrage',
    abilityDesc: 'Lobs 5 cluster bombs in an arc: 20 dmg each + burning ground.', chargeTime: 32, aiRange: 35, aiStyle: 'sniper',
    ending: 'Ma pays the ranch off and throws a barbecue for the whole valley. All six sons show up, and for once nobody fights. She keeps the leftover cluster bombs in the root cellar, just in case.',
    taunts: { kill: 'Mind your manners next time.', wrecked: 'Now look what you made me do.' },
  },
  {
    id: 'solar-flare', name: 'Solar Flare', driver: 'Dr. Anton Vesely', cls: 'Experimental rocket car',
    bio: 'Disgraced physicist. Needs a public demonstration of the Sun Lance, and a contest is public.',
    armor: 2, speed: 4, handling: 3, half: { x: 2.2, y: 0.35, z: 0.9 }, wheelR: 0.4, color: 0xd8d8e0,
    parts: [
      { size: [4.4, 0.7, 1.8], pos: [0, 0, 0], color: 0xd8d8e0 },
      { size: [1.2, 0.4, 0.8], pos: [-0.2, 0.55, 0], color: GLASS },
      { size: [0.8, 0.7, 0.08], pos: [-1.9, 0.6, 0.6], color: 0xe8b13a },
      { size: [0.8, 0.7, 0.08], pos: [-1.9, 0.6, -0.6], color: 0xe8b13a },
      { size: [0.4, 0.5, 0.5], pos: [-2.3, 0.1, 0], color: 0xff7a1a, glow: true },
      { size: [0.8, 0.12, 0.12], pos: [2.5, 0.1, 0], color: 0x5ff2ff, glow: true },
    ],
    ability: 'sunLance', abilityName: 'Sun Lance',
    abilityDesc: 'Charges for 1 s, then fires a piercing laser: 90 dmg to everything in line.', chargeTime: 40, aiRange: 120, aiStyle: 'sniper',
    ending: 'Dr. Vesely\'s Sun Lance demonstration fills every physics journal for a year. The university that fired him offers him a lab, and he declines in a very public letter. He builds his own institute out in the desert, powered entirely by the sun.',
    taunts: { kill: 'Peer review complete. You failed.', wrecked: 'An unexpected result. Fascinating.' },
  },
];

/** Final boss (spec §5 #11). Unlocked as playable after the campaign. */
export const KINGPIN: VehicleDef = {
  id: 'kingpin', name: 'Kingpin', driver: 'The Proprietor', cls: 'Armored land-yacht limo',
  bio: 'Owns the contest, the city and most of the people in it. Plays the final himself, because he has never once lost.',
  armor: 5, speed: 3, handling: 2, hpScale: 3, half: { x: 3.1, y: 0.55, z: 1.15 }, wheelR: 0.5, color: 0x1c1c22,
  parts: [
    { size: [6.2, 1.1, 2.3], pos: [0, 0, 0], color: 0x1c1c22 },
    { size: [3.2, 0.6, 2.1], pos: [-0.4, 0.85, 0], color: GLASS },
    { size: [6.24, 0.12, 2.34], pos: [0, 0.2, 0], color: 0xd4af37 },
    { size: [0.4, 0.3, 0.3], pos: [3.0, 0.7, 0], color: 0xffd23f, glow: true },
    { size: [1.0, 0.4, 0.8], pos: [-0.4, 1.35, 0], color: 0x2a2a30 },
    { size: [1.0, 0.12, 0.12], pos: [0.3, 1.45, 0], color: 0xd4af37 },
  ],
  ability: 'payday', abilityName: 'Payday',
  abilityDesc: 'Summons two Collector Drones and lobs a barrage of exploding gold bars.', chargeTime: 18, aiRange: 60, aiStyle: 'aggressive',
  ending: 'The Proprietor is finished.',
  taunts: { kill: 'Everything has a price. Yours was cheap.', wrecked: 'Impossible. I own this city!' },
};

/** Kingpin's summoned minions: small, fast, fragile rammers. */
export const DRONE: VehicleDef = {
  id: 'drone', name: 'Collector Drone', driver: 'Repo Unit', cls: 'Remote repo car',
  bio: 'Collects debts. Asks no questions.',
  armor: 1, speed: 4, handling: 4, hpScale: 0.6, half: { x: 1.3, y: 0.3, z: 0.75 }, wheelR: 0.32, color: 0xd4af37,
  parts: [
    { size: [2.6, 0.6, 1.5], pos: [0, 0, 0], color: 0xd4af37 },
    { size: [1.0, 0.35, 1.0], pos: [-0.2, 0.45, 0], color: 0x2a2a30 },
    { size: [0.1, 0.15, 0.6], pos: [1.31, 0.1, 0], color: 0xff2a2a, glow: true },
  ],
  ability: 'none', abilityName: '—', abilityDesc: '', chargeTime: 999, aiRange: 0, aiStyle: 'rammer',
  ending: '', taunts: { kill: '', wrecked: '' },
};

/** Every vehicle with a model (roster + boss + drone). */
export const ALL_VEHICLES = [...VEHICLES, KINGPIN, DRONE];
