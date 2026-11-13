# BLACKTOP BOUNTY — Game Design & Build Specification

> Vehicular-combat arena game for the browser. Original IP.
> Genre reference: 1990s console car-combat (arena deathmatch, pickups, special weapons).
> Visual reference: late-90s low-poly console look — 1970s American Southwest, sun-bleached desert, flat-shaded vehicles, warm dusk skies, chunky particle explosions.
> **Constraint:** all names, characters, vehicles, arenas, art, music and story are original. Do not reuse names, character designs, logos, levels, or audio from any existing franchise.

| Field | Value |
|---|---|
| Version | 1.0 |
| Target | Desktop browsers (Chrome, Edge, Firefox, Safari 17+), gamepad + keyboard/mouse |
| Runtime | Three.js (WebGL2), TypeScript, Vite |
| Asset pipeline | Blender 4.x → glTF 2.0 (`.glb`) |
| Physics | Rapier (`@dimforge/rapier3d-compat`) |
| Players | 1 player vs. up to 7 AI; 2-player split-screen (stretch) |
| Frame target | 60 fps on integrated GPU (Intel Iris Xe / Apple M1) at 1080p |

---

## 1. Engine Decision: Three.js **and** Blender

These are not alternatives — they do different jobs.

- **Three.js = the game.** It runs in the browser: rendering, input, game loop, physics integration, UI. Blender cannot run in a browser.
- **Blender = the asset factory.** Model, UV, texture and bake vehicles and arenas, export `.glb`, load in Three.js.

**Rule:** Gameplay code never depends on Blender. Every asset has a procedural placeholder (box + cylinders) so the game is playable before any art lands. Swapping placeholder → `.glb` is a one-line registry change.

---

## 2. Game Pillars

1. **Arcade handling, not simulation.** Cars grip, drift, jump and recover instantly. Fun over realism.
2. **Every vehicle plays differently.** Unique special ability + distinct stats. No two pick the same way.
3. **Destructible, readable arenas.** Big landmarks, breakable props, health/weapon pickups always visible.
4. **Retro look, modern performance.** Low poly counts, vertex-colored/flat shading, 256–512px textures, aggressive fog — the look is the optimization.

---

## 3. Core Gameplay Loop

```
Select vehicle → Spawn in arena → Hunt pickups → Fight → Destroy enemies
      ↑                                                       ↓
  Next arena ← Defeat boss ← Last car standing ← Survive ←────┘
```

### 3.1 Modes
| Mode | Description | Priority |
|---|---|---|
| **Campaign** | Pick a driver, clear 6 arenas in sequence vs. AI, final boss, per-driver ending card | P0 |
| **Deathmatch** | Free-for-all, pick arena + AI count (1–7) + difficulty | P0 |
| **Survival** | Endless waves, score attack, local leaderboard (`localStorage`) | P1 |
| **Split-screen 2P** | Co-op campaign or versus | P2 |

### 3.2 Win / Lose
- Round won when the player is the last vehicle alive.
- Player has 3 lives per arena in Campaign; game over on 0.
- Respawn: 3 s delay, 2 s invulnerability, random spawn point farthest from enemies.

---

**M6 implementation notes (`src/modes.ts`, `src/game.ts`)**
- Campaign stages: Saguaro (3 opponents, easy) → Copper Canyon (3, normal) → Las Vistas (4, normal) → Hoover (4, normal) → Roswell (5, hard) → Painted Mesa (5, hard) → Penthouse Lot (Kingpin, hard). Player 3 lives per arena, opponents 1 life. Game over offers "Retry this arena".
- Deathmatch: 3 lives each, last car standing. "Watch AI only" ends when one car is left.
- Survival: wave *n* sends min(*n*+1, 7) one-life bots; difficulty easy → normal (wave 3) → hard (5) → brutal (8). Score = 100 per wreck + 250 per wave cleared; top-10 board per browser.
- Boss: Kingpin (3× armour) summons up to 4 Collector Drones and lobs gold-bar bombs; roof rings collapse at 75 / 50 / 25 % boss HP (the deathmatch timer is paused in the boss fight). Kingpin unlocks as playable after the campaign.

## 4. Controls

| Action | Keyboard / Mouse | Gamepad (Standard mapping) |
|---|---|---|
| Accelerate | W / ↑ | R2 |
| Brake / Reverse | S / ↓ | L2 |
| Steer | A D / ← → | Left stick |
| Fire machine gun | Left mouse | R1 |
| Fire selected weapon | Right mouse / F | Square / X |
| Cycle weapon | Q / E / mouse wheel | L1 / D-pad ←→ |
| **Special ability** | Shift | Triangle / Y |
| Handbrake / drift | Space (not Ctrl: Ctrl+W closes the tab) | Circle / B |
| Jump (energy) | J | D-pad ↑ + X combo or Cross / A |
| Look back | C | R3 |
| Reset / flip car upright | R | Select / Back |
| Back to vehicle select | Esc | — (pause menu in M6) |
| Pause | Esc | Options / Start |

**Energy moves** (shared by all vehicles, cost from a regenerating energy bar 0–100):
| Move | Input | Cost | Effect |
|---|---|---|---|
| Freeze Blast | ↑ ↓ ↑ + fire | 25 | Freezes target 2.5 s |
| Shield | → → ↑ | 30 | Blocks damage 3 s |
| Jump | ↑ ↑ | 15 | Vertical leap ~6 m |
| Mine Drop | ← ← ↓ | 20 | Proximity mine behind car |

Combo inputs buffered over 600 ms. Gamepad uses D-pad for combos.

---

## 5. Roster — 10 Playable Vehicles

Stats on a 1–5 scale. **Armor** = max HP (1 = 100 HP, each step +40). **Speed** = top speed (1 = 30 m/s, each step +5). **Handling** = steer rate & grip.

| # | Vehicle | Driver | Class | Armor | Speed | Handling | Special Ability |
|---|---|---|---|---|---|---|---|
| 1 | **Dust Devil** | Rosa "Rattler" Quintero | 1971 muscle coupe | 3 | 4 | 3 | **Sidewinder Volley** — 4 homing missiles that snake along the ground, 15 dmg each |
| 2 | **Big Iron** | Earl Tubbs | 18-wheel semi cab | 5 | 1 | 1 | **Jackknife** — 360° spin with trailer swing, 60 dmg + knockback in 8 m radius |
| 3 | **Halo Hearse** | Father Ignatius Crowe | Black 1968 hearse | 4 | 2 | 2 | **Last Rites** — drops a coffin bomb; detonates after 2 s or on contact, 70 dmg |
| 4 | **Mojave Moth** | Lily Sato | Dune buggy | 1 | 5 | 5 | **Blink Boost** — 0.4 s phase dash, passes through enemies & projectiles |
| 5 | **Iron Prairie** | Hank "Tractor" Bodine | Armored farm tractor | 5 | 1 | 2 | **Harvester** — front blades spin 4 s, 25 dmg/s to rammed targets, immune to ram damage |
| 6 | **Disco Inferno** | Vince Valentino | 1976 custom van | 3 | 3 | 3 | **Mirror Ball** — reflective sphere 4 s, bounces projectiles back to sender |
| 7 | **Sheriff 9** | Deputy Mae Holloway | Interceptor cruiser | 3 | 4 | 4 | **Roadblock** — spike strip + EMP siren; enemies in 15 m cone lose weapons & steering 3 s |
| 8 | **Thunder Pony** | Joey "Gears" Nakamura | Chopper motorcycle + sidecar gun | 1 | 5 | 4 | **Wheelie Barrage** — 3 s minigun burst while invulnerable from the front |
| 9 | **Cactus Jack** | Delores "Ma" Pickett | Lifted 4x4 pickup | 4 | 3 | 2 | **Tumbleweed Barrage** — lobs 5 cluster bombs in an arc, 20 dmg each + fire DoT |
| 10 | **Solar Flare** | Dr. Anton Vesely | Experimental rocket car | 2 | 4 | 3 | **Sun Lance** — charged laser beam (hold 1 s), 90 dmg, pierces |

**Unlockable boss (not selectable until Campaign cleared):**
| 11 | **Kingpin** | "The Proprietor" | Armored land-yacht limo | 5 (×3 HP) | 3 | 2 | **Payday** — summons 2 drone cars + gold-bar mortar barrage |

### 5.1 Special Ability Rules
- Each special has a charge meter (fills over 25–40 s depending on power) and can also be refilled by the **Special** pickup.
- Specials are implemented as one `Ability` object per vehicle with `activate(ctx)`, `update(dt, ctx)`, `isActive`. No inheritance tree beyond that.
- All numbers above live in one data file (`src/data/vehicles.ts`) for balance tuning.

### 5.2 Per-Driver Content
Each driver gets: name, 2-line bio, motive for entering the contest, portrait (2D, 512×512), and a campaign ending card (1 illustration + 3 sentences of text).

---

## 6. Weapons & Pickups

Machine gun is infinite on every car. All others are pickups with ammo. The machine gun and the non-homing weapons snap to any enemy within ~11° of the car's nose (light auto-aim); homing weapons lock the nearest enemy within ~57°.

| Weapon | Ammo | Damage | Behaviour |
|---|---|---|---|
| Machine Gun | ∞ | 2/bullet, 12 rps | Hitscan, slight spread, overheats after 4 s |
| Homing Missile | 4 | 15 | Moderate tracking, 40 m/s |
| Fire Missile | 4 | 12 | Strong tracking, slow |
| Power Missile | 2 | 35 | No tracking, fast, knockback |
| Ricochet Bomb | 2 | 30 | Bounces off walls 3 times |
| Napalm | 2 | 10 + 5/s for 4 s | Lobbed, creates fire pool |
| Remote Bomb | 1 | 50 | Drop, detonate with second press |
| Rail Mortar | 3 | 25 | Ballistic arc, splash 5 m |
| Lightning Bolt | 2 | 20 | Instant, auto-targets nearest in 30 m |

| Pickup | Effect |
|---|---|
| Health (wrench) | +30% max HP |
| Full Health (gold wrench) | +100% — 1 per arena, respawns 60 s |
| Special | Refills special meter |
| Turbo | +50% top speed 5 s |
| Weapon crate | Random weapon from arena's weighted table |

Pickups respawn 20 s after collection. Floating, rotating, color-coded, with a vertical light beam visible across the arena.

---

## 7. Arenas (6 + boss)

All set in an alternate 1970s American Southwest. Each arena ~300×300 m, 2–3 vertical levels, 8 spawn points, 12–20 pickup points, at least 6 destructible props and 1 **arena event**.

| # | Arena | Theme | Arena Event |
|---|---|---|---|
| 1 | **Saguaro Junction** | Desert gas station, motel, diner | Fuel tanker explodes when shot (40 m blast) |
| 2 | **Copper Canyon Mine** | Open-pit mine, rail tracks, ore carts | Runaway ore train crosses the arena every 45 s |
| 3 | **Las Vistas Strip** | Neon casino row at night | Breakable casino sign drops onto the road |
| 4 | **Hoover Spillway** | Dam top + dry spillway | Floodgates open, washing cars down the spillway |
| 5 | **Roswell Airfield** | Abandoned airbase, hangars, radar | Bomber taxis and drops ordnance on random cars |
| 6 | **Painted Mesa** | Cliffside ghost town + rope bridge | Bridge can be destroyed, creating a chasm |
| Boss | **The Penthouse Lot** | Rooftop parking deck of a desert tower | Edges collapse in stages as boss HP drops |

Out-of-bounds: invisible walls + "turn back" fade; falling off map = −25% HP and respawn at nearest spawn.

**M4 implementation notes**
- Greybox layouts live as data in `src/data/arenas.ts` (decided over Blender-first for M4); events in `src/events.ts`. M5 replaces visuals with Blender `.glb` art using the §8.1 names.
- Event schedules: ore train every 45 s (first at 20 s), floodgates every 50 s (first at 25 s), bomber every 40 s (first at 15 s), roof collapse stages at 60 / 120 / 180 s in deathmatch (the boss fight will call `trigger()` on HP thresholds instead). Tanker, casino sign and bridge fire when shot.
- Painted Mesa has curbs along the chasm and guard rails on the rock arches; the Penthouse Lot has a parapet that falls with the first collapse stage. Cars can be blasted over, not roll over.
- A dev-only "Proving Ground" (flat test ground) stays in the arena list.

---

## 8. Visual Direction

**Target: late-90s console look, rendered cleanly.**

- **Geometry:** vehicles 1,500–4,000 tris; arena total ≤ 150k tris visible.
- **Shading:** `MeshLambertMaterial` / `MeshToonMaterial` or flat-shaded `MeshStandardMaterial` with roughness 0.9. No PBR texture sets.
- **Textures:** 256–512 px, `NearestFilter` optional toggle for "retro pixel" mode. Baked ambient occlusion and lighting into vertex colors or lightmaps in Blender.
- **Palette:** burnt orange, rust, turquoise, mustard, dusty pink; dusk sky gradient.
- **Atmosphere:** linear `THREE.Fog` matched to sky horizon; sky = gradient dome shader + low-poly mesas on the horizon.
- **Lighting:** 1 directional sun (shadow map 2048, single cascade on the player area), 1 hemisphere light. Headlights as spot lights on the player only; billboard glows on AI.
- **VFX:** sprite-sheet explosions, additive particle fire, smoke puffs (instanced quads), muzzle flashes, tire dust, skid decals (pooled).
- **Post (optional, toggleable):** low-res render target upscaled (e.g. 480p → screen) + slight dither + color grading LUT for the authentic retro feel.
- **Camera:** chase cam with spring damping, FOV kick on turbo, screen shake on hits/explosions, rear-view on hold.

**M5 implementation notes:** gradient sky dome with sun glow + low-poly mesa ring (`src/scenery.ts`); dusty vertex-coloured ground; all static arena geometry merged into 2 draw calls with darkened bases (fake baked AO); particle VFX — fireballs, smoke, sparks, muzzle flash, missile trails, tyre dust, damage smoke, burning wrecks — plus skid decals (`src/fx.ts`, 3 draw calls total); retro mode on **P** (360p nearest upscale, 4×4 ordered dither, warm grade; `src/post.ts`). Measured with 8 cars: 60 fps, 79–132 draw calls, 18–27k triangles across all 7 arenas. Arena art is still the M4 greybox upgraded in code; Blender arena models are a follow-up.

**Graphics overhaul (post-M7, "modern stylized" direction chosen by the owner):** the retro brief above is superseded. Physically based materials (`MeshStandard/Physical`), Poly Haven CC0 PBR textures with world-space box-projected UVs on all arena geometry, HDRI skies as background + image-based lighting, ACES tone mapping, sky-matched distance haze, terrain out to the horizon, auto building facades (windows, door, parapet), clear-coated car paint / mirror glass / chrome, rounded smooth-shaded vehicle models, HDR-bright lights and neon. Post (`src/look.ts`): bloom + colour grade (Medium, default), plus GTAO ambient occlusion + SMAA (High); Low = no post. Measured on the dev Mac, 8 cars in combat: Medium 60 fps / 127–170 draws, High 60 fps / 240–306 draws. Credits: `public/assets/CREDITS.md`.

### 8.1 Blender Pipeline
1. Model at real scale (1 unit = 1 m), Z-up in Blender, export Y-up glTF.
2. Naming convention per vehicle: `body`, `wheel_FL`, `wheel_FR`, `wheel_RL`, `wheel_RR`, `muzzle_L`, `muzzle_R`, `special_mount`, `exhaust`. Empties for mount points.
3. Arenas: separate `collision_*` meshes (simplified) from `visual_*` meshes. Spawn points/pickup points as empties named `spawn_N`, `pickup_N`.
4. Bake lighting/AO into a 2nd UV or vertex colors.
5. Export: `.glb`, Draco or Meshopt compression, textures as KTX2 (via `gltf-transform`).
6. Budget check script (`tools/check-assets.mjs`) fails CI if a vehicle > 5k tris or file > 1.5 MB.

**Vehicle workflow (as built in M5)**
- Source of truth for sizes/wheels: `src/data/vehicles.ts`. `node tools/export-vehicle-data.ts` writes `tools/blender/vehicles.json`.
- `blender/vehicles.blend` holds all 10 vehicles, each under a root empty named by id with children `<id>:body`, `<id>:wheel_FL` … (Blender needs unique names; the exporter strips the prefix).
- **Edit models in `blender/vehicles.blend`, then re-export** with `tools/blender/export_vehicles.py` (in Blender: `exec(open('<repo>/tools/blender/export_vehicles.py').read(), {'ROOT': '<repo>'})`, or headless `blender -b blender/vehicles.blend -P tools/blender/export_vehicles.py -- <repo>`). Keep wheel centres where they are: physics uses the data-file layout.
- `tools/blender/build_vehicles.py` is the one-time bootstrap that generated the .blend from data. It refuses to overwrite an existing .blend unless forced (`FORCE=True` / `--force`).
- Materials are flat colours named `c_<hex>` / `glow_<hex>`; the game bakes each body into one lit + one glow mesh with vertex colours (≈ 6 draw calls per car). A missing/broken .glb falls back to the box placeholder.
- The budget check is `tests/assets.test.ts` (≤ 5k tris, ≤ 1.5 MB, §8.1 node names) — it runs with `npm test`. Models are tiny (≈ 60–80 KB) so Draco/Meshopt/KTX2 are not used yet.

---

## 9. Audio

- Music: original synth-funk / desert-rock loops, one per arena + menu + boss. Web Audio, crossfade between tracks.
- SFX: engine (pitch-shifted by RPM), gunfire, missile launch/whoosh, explosion (3 variants), pickup chime, hit confirm, horn per vehicle.
- 3D positional audio via `THREE.PositionalAudio` for enemies, capped at 16 simultaneous voices.
- All audio unlocked on first user interaction (browser autoplay policy).

---

## 10. AI Opponents

State machine per bot:
```
WANDER → SEEK_PICKUP → ENGAGE → FLEE (HP < 25%) → SEEK_HEALTH
```
- Navigation: waypoint graph authored in Blender as empties (`nav_N`) + edges by name; A* over graph; local steering (seek + obstacle avoidance raycasts).
- Target selection: weighted by distance, low HP, and who last damaged them.
- Difficulty (Easy/Normal/Hard/Brutal) scales: aim error, reaction delay, special usage frequency, energy-move usage.
- Each vehicle has an AI personality tag (aggressive / sniper / rammer / hit-and-run) tied to its special.
- Budget: AI tick at 10 Hz, steering at 60 Hz.
- Difficulty values (aim error / reaction / fire cone / special chance / weapon gap) live in `src/ai.ts` `DIFFICULTIES`.
- Until an arena ships Blender `nav_N` empties, the nav graph is auto-generated as a 12 m grid from the collision world (nodes need 3 m clear ground, edges need a car-wide clear line).
- Unsticking: back off immediately when nose-blocked or tangled with another car; a 3-point turn + detour after 1 s without leaving a 6 m circle; relocate to a free nav node 15 m+ away after 4.5 s (≈ 0.7 relocations per bot-minute in the soak test).
- Arcade anti-roll assist keeps cars upright through most hits; rollovers still auto-recover after 1.5 s.

---

## 11. HUD & UI

HTML/CSS overlay above the canvas (not rendered in WebGL) for crisp text and easy layout.

- **HUD:** health bar (car silhouette that cracks), energy bar, special meter, current weapon + ammo, radar (top-right, 2D canvas), kill feed, lives, enemy health bar when targeted, off-screen enemy arrows.
- **Menus:** Title → Mode Select → Vehicle Select (3D turntable of the vehicle, stats bars, driver portrait & bio) → Arena Select → Loading → Game → Results.
- **Pause:** resume, controls, settings, quit.
- **Settings:** volume (music/SFX), graphics preset (Low/Med/High), retro pixel mode, invert Y, key rebinding (stored in `localStorage`).
- **Accessibility:** colorblind-safe pickup colors + icons, subtitle captions for driver taunts, screen-shake toggle, full keyboard menu navigation.

---

**M6 implementation notes**
- Menus (`src/menus.ts`): one overlay; ↑/↓ or D-pad, Enter/Ⓐ, Esc/Ⓑ. Pause on Esc / Start: Resume, Settings, Restart, Quit to menu.
- Settings (`src/settings.ts`): music + SFX volume, graphics preset (Low: 1× pixels, no shadows · Medium: 1× pixels, 1024 shadows · High: up to 2× pixels, 2048 shadows; shadow changes apply from the next match), retro mode, screen shake, keyboard/mouse rebinding. *Invert Y is omitted: the game has no camera pitch control.*
- HUD: lives (♥), opponents-left / wave + score line, radar (forward = up, 120 m), off-screen enemy arrows, boss bar, taunt captions. *The cracking car-silhouette health gauge is still a bar.*
- Driver content: bio, two caption lines and a three-sentence ending each; the ending card shows the car on a 3D turntable instead of a 2D portrait illustration.
- Audio (`src/audio.ts`): all procedural Web Audio — seeded 16-step sequencer (kick/snare/hat/bass/arp) with its own tempo/key/scale per arena, menu, results, survival and boss; synthesized SFX (gun, launch, explosion, hit confirm, pickup, laser, horn, UI), positional via PannerNodes, ≤ 16 voices; engine tone follows speed/throttle. No voice acting.
- Still not built anywhere: the §4 energy moves (freeze, shield, energy jump, mine drop) and 2-player split-screen (P2).

## 12. Technical Architecture

### 12.1 Stack
| Concern | Choice |
|---|---|
| Language | TypeScript (strict) |
| Bundler | Vite |
| Renderer | Three.js (latest stable r16x+) |
| Physics | Rapier 3D — `DynamicRayCastVehicleController` for cars |
| Asset loading | `GLTFLoader` + `DRACOLoader`/`MeshoptDecoder` + `KTX2Loader` |
| Audio | Web Audio via Three.js `AudioListener` |
| State/UI | Plain DOM + CSS; no framework required |
| Tests | Vitest (logic), Playwright (smoke: loads, starts a match, no console errors) |
| Hosting | Static (any CDN); no backend required |

### 12.2 Folder Structure
```
/
├─ index.html
├─ src/
│  ├─ main.ts              # boot, renderer, game loop (fixed 60 Hz physics, variable render)
│  ├─ game.ts              # match state, rules, win/lose
│  ├─ input.ts             # keyboard/mouse/gamepad → actions, combo buffer
│  ├─ vehicle.ts           # Rapier vehicle + mesh + health/energy/weapons
│  ├─ abilities.ts         # 11 special abilities (one object each)
│  ├─ weapons.ts           # projectile defs + pooled projectiles
│  ├─ pickups.ts
│  ├─ ai.ts                # bot FSM + nav graph
│  ├─ arena.ts             # load .glb, extract collision/spawns/pickups/nav
│  ├─ fx.ts                # particles, decals, explosions (pooled/instanced)
│  ├─ audio.ts
│  ├─ camera.ts
│  ├─ hud.ts               # DOM HUD + radar
│  ├─ menus.ts
│  └─ data/
│     ├─ vehicles.ts       # stats + ability params (single source of truth)
│     ├─ weapons.ts
│     └─ arenas.ts
├─ public/assets/
│  ├─ vehicles/*.glb
│  ├─ arenas/*.glb
│  ├─ textures/  audio/  ui/
├─ blender/                # .blend sources (Git LFS)
├─ tools/check-assets.mjs
└─ tests/
```

### 12.3 Game Loop
```ts
const STEP = 1 / 60;
let acc = 0;
function frame(t: number) {
  acc += Math.min(clock.getDelta(), 0.1);
  while (acc >= STEP) { input.poll(); game.fixedUpdate(STEP); world.step(); acc -= STEP; }
  game.render(acc / STEP);   // interpolate transforms
  requestAnimationFrame(frame);
}
```

### 12.4 Performance Budgets
| Metric | Budget |
|---|---|
| Draw calls | ≤ 250 |
| Visible triangles | ≤ 400k |
| Active projectiles | ≤ 200 (pooled) |
| Particles | ≤ 3,000 (instanced) |
| JS heap | ≤ 300 MB |
| Initial download (menu playable) | ≤ 8 MB |
| Per-arena download | ≤ 15 MB |
| Load time per arena (broadband) | ≤ 5 s |

Techniques: object pooling for everything spawned, `InstancedMesh` for props/particles, merged static arena geometry, frustum culling, LOD for vehicles at > 60 m, no per-frame allocations in hot loops.

---

## 13. Delivery Milestones

Each milestone ends in a playable build with acceptance criteria met.

| Milestone | Scope | Acceptance Criteria |
|---|---|---|
| **M0 — Prototype** | Vite+Three+Rapier boot, 1 placeholder car drives on flat plane, chase cam | Car drives, drifts, jumps at 60 fps; gamepad + keyboard both work |
| **M1 — Combat core** | Machine gun, 3 weapons, pickups, health, death/respawn, 1 dumb bot | Can destroy bot and be destroyed; pickups respawn |
| **M2 — Roster** | All 10 vehicles (placeholder meshes), all 10 specials, stats from data file, vehicle select screen | Each special works and is visually distinct; stats change feel measurably |
| **M3 — AI** | Full FSM, nav graph, difficulty levels, 7 bots | 7 bots fight each other unattended for 5 min without getting stuck > 5 s |
| **M4 — Arenas** | 6 arenas + boss arena greyboxed from Blender, arena events | All events trigger; no fall-through; spawns valid |
| **M5 — Art pass** | Final Blender vehicles & arenas, VFX, sky, fog, post | Meets visual direction §8 and perf budgets §12.4 |
| **M6 — Game flow** | Campaign, deathmatch, survival, HUD, menus, settings, audio | Full campaign completable start to ending card |
| **M7 — Polish & ship** | Balance, accessibility, Playwright smoke test, static deploy | No console errors; 60 fps on reference hardware; WCAG-friendly menus |

---

## 14. Definition of Done (whole game)

Status after M7 (how each was verified):

- [x] 10 playable vehicles, each with a unique working special ability and distinct stats — scripted browser run of every special; `tests/physics.test.ts` (stats feel); `tests/balance.test.ts` (win rates)
- [x] Boss vehicle unlocks after campaign — `tests/modes.test.ts`; browser campaign run
- [x] 6 arenas + boss arena, each with a working arena event — `tests/arenas.test.ts`
- [x] Campaign, Deathmatch, Survival modes — `tests/modes.test.ts`; browser runs of all three
- [~] Keyboard/mouse and gamepad fully supported, rebindable — keyboard/mouse rebindable; gamepad supported with a fixed layout (combos on the D-pad); gamepad tested in code only, not on a physical pad
- [x] AI uses weapons, pickups, specials, and energy moves — `tests/energy.test.ts`, soak tests
- [~] Holds 60 fps on reference hardware with 8 vehicles in combat — 60 fps measured on the dev Mac (all arenas, 8 cars, 79–132 draws, ≤ 27k tris); not yet measured on an Intel Iris Xe / M1 machine
- [x] Loads from static hosting, no backend — build served from a subfolder by a plain static server, zero console errors
- [x] All content original — names, drivers, vehicles, arenas, text and procedural music written for this project; repo searched for franchise names (none)
- [~] Vitest logic tests + Playwright smoke test pass in CI — both pass locally; `.github/workflows/ci.yml` is ready but has not run (no git repository yet)

**M7 implementation notes**
- Energy moves (§4): energy 0–100, +8/s. Keyboard 1 = Freeze blast (25), 2 = Shield (30), 3 = Mine (20), J = Jump (15) — all rebindable; gamepad D-pad combos ↑↓↑ / →→↑ / ←←↓ / ↑↑ within 600 ms. Weapon cycling on the pad is L1 only (the D-pad is for combos). Bots use them by difficulty (`energyChance`).
- Balance: `npm run balance` (opt-in, ~5 min for 300 rounds) runs 4-car, one-life free-for-alls with normal bots and fails if any car wins > 50 % or < 8 % (fair share 25 %). Changes: armour curve 120 + 30/pt (was 100 + 40/pt), Iron Prairie armour 4, Harvester 18 dps for 3.5 s, Roadblock jam 2.5 s, Sidewinder 18 dmg, light-car HP bonuses (Pony ×1.3, Moth ×1.25, Dust Devil ×1.1), Big Iron ×0.9. Bot-vs-bot win rates are a floor for balance; human playtests should have the final say.
- Accessibility: menus are a labelled modal dialog with a focus trap; full keyboard and gamepad navigation; `prefers-reduced-motion` turns screen shake off by default and stops CSS transitions; pickups differ by shape as well as colour; taunts are captioned. `e2e/smoke.spec.ts` runs axe-core (WCAG 2.0/2.1 A + AA) on the title, mode, settings, controls and vehicle-select screens: no serious or critical violations.
- Smoke test: `npm run e2e` builds, serves the static build and plays a deathmatch with zero console errors. Locally it uses the installed Chrome; CI installs Playwright's Chromium.
- Deploy: `npm run build` → `dist/` (≈ 5.7 MB, relative paths) can be dropped on any static host or subfolder (GitHub Pages, Netlify, itch.io HTML5…). Publishing is not done yet.

---

## 15. Out of Scope (v1)

- Online multiplayer (would need a netcode server; revisit after v1)
- Mobile/touch controls
- Accounts, cloud saves, monetization
- Level editor
