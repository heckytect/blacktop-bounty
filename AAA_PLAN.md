# BLACKTOP BOUNTY — AAA Production Plan (solo developer, Unity 6)

> Companion to [GAME_SPEC.md](GAME_SPEC.md), which stays the source of truth for rules, roster, balance numbers and content. This file covers how to take the shipped web prototype (M0–M7 plus the P0 feel slice, live on GitHub Pages) to a AAA-quality release on **Windows, Mac (Steam) and Apple Arcade**.
> Written for one developer with shipped-AAA experience (open-world and annual-sports pipelines). That experience is the plan's main asset: it brings the quality bar, the cert mindset and the pipeline discipline. What it can't bring is headcount.
> Built on the gamedev skills (`unity-csharp-scripting`, `unity-physics`, `unity-input-system`, `unity-scriptableobjects`, `unity-navmesh`, `unity-animation`, `unity-build-pipeline`, `unity-build-size`, `game-feel`, `camera-systems`, `physics-tuning`, `game-ai`, `audio-design`, `shader-programming`, `create-game-assets`, `performance-optimization`, `level-design`, `game-ui-ux`, `save-systems`, `steam-publish`). Each workstream names the skill to load before working on it.
> `[ASSUMPTION]` = my starting guess, change it freely. `[VERIFY]` = a third-party rule or price to confirm with the vendor before relying on it.

---

## 0. Decisions

| Decision | Choice | Why |
|---|---|---|
| Engine | **Unity 6.3 LTS** (6000.3.x) | One codebase for Windows, Mac, iPhone, iPad and Apple TV; Metal and Apple-controller support out of the box; many Apple Arcade titles ship on it |
| Render pipeline | **URP** (Forward+) with per-platform quality tiers | HDRP doesn't run on iPhone or Apple TV |
| Platforms | **Steam (Windows + Mac)** paid; **Apple Arcade** (iPhone, iPad, Mac, Apple TV) via pitch; fallback **App Store premium** if Arcade says no | Arcade is curated: you pitch, Apple chooses |
| Web prototype | Kept as the **free demo** and the **tuning reference** for the port. Frozen after the port except for fixes | Its numbers are already balanced and tested |
| Repo | Unity project in `unity/` in this repo, Git LFS for binaries | Design docs, Blender files and tools stay together |

### What "AAA" means for one person

A AAA studio game is 200–1,000 people for 3–5 years. One person can't match its **breadth**: hours of content, cinematic story, hand-made everything. One person **can** match its **quality per second on screen**: how a car handles, how a hit lands, how an arena reads, how the audio mixes, how stable the frame rate is.

**Strategy: AA scope, AAA finish.** One tight mode set and a few arenas, each polished to studio cert level.

| Axis | AAA studio | This plan |
|---|---|---|
| Content breadth | 20+ arenas, 30+ cars, cutscenes | 8 arenas, 11 playable cars (10 + Kingpin) + the drone, in-engine story beats |
| Moment-to-moment feel | Best in class | **Best in class (non-negotiable)** |
| Visual fidelity | Bespoke everything | Kitbash + CC0 + procedural + Blender MCP, under one strict art bible |
| Audio | Licensed score, Foley team | FMOD engine model + layered SFX library + 6–8 commissioned or library tracks |
| Online | Dedicated servers | Host-authoritative peer-to-peer, 2–8 players (phase-gated) |
| QA | 50-person QA team | Bots: soak, balance, screenshot and perf regression in CI |
| Platforms | Consoles + PC | Windows, Mac, Steam Deck, iPhone, iPad, Apple TV |

Timeline: about **19–21 months full-time**, including a 12-week port [ASSUMPTION: about 40 h/week, around $6–18k for music, sound libraries, outsourced hero cars and Apple hardware for testing].

---

## 1. Gap audit: web prototype vs the AAA bar

| Area | Web prototype today | AAA bar | Gap |
|---|---|---|---|
| Camera and hit feel | **P0 done:** trauma shake, hit tiers, hit-stop, rumble, chase camera with lead and pull-in | Same, plus kill cam and boost FOV kick | Low: port it as-is |
| Hit feedback | Shake, freeze-frame, rumble, particles | + impact decals, car deformation, hit-marker SFX layers | Medium |
| Handling | Rapier ray-cast vehicle, tuned for arcade play | Per-car grip curves, drift boost, air control, landing recovery, surface response | Medium |
| Car models | 12 Blender-generated models (≈1 MB total) | Hero cars: 30–60k tris, damage states, LODs, baked AO, decals | **High** |
| Arenas | Code greybox with tiled PBR and generated facades | Hand-dressed Blender scenes, landmarks, destructible layers, baked lighting | **High** |
| Lighting | HDRI light + 1 shadowed sun + AO on High | Baked lightmaps, probe volumes, local lights at night, volumetric fog | Medium |
| VFX | Instanced particles | Flipbook explosions, soft smoke, heat haze, lit sparks, debris physics | **High** |
| Audio | Synth music, synth SFX, 5-gear synth engine | Recorded engine model, layered SFX, mix busses, ducking, reverb zones, adaptive music | **High** |
| AI | State machine + grid A* + personalities | + utility scoring, telegraphed attacks, fairness caps, pacing director | Medium |
| UI/UX | HTML menus and HUD | Art-directed front end, 3D garage, diegetic HUD, controller-first and touch UX | Medium |
| Story | Ending cards per driver | In-engine intros, rival radio calls, endings | Medium |
| Online | None | Online versus | **High** (biggest scope risk) |
| Progression | Kingpin unlock | Cosmetic mastery tracks, challenges (no loot boxes, no in-app purchases) | Medium |
| Perf/stability | 60 fps on the dev Mac | Locked 60 on min spec of every platform, p99 ≤ 18 ms, 0 crashes in 24 h soak | Medium |
| Accessibility | Focus trap, reduced motion, captions, axe pass | Remapping on pad and touch, colour-blind modes, aim assist, subtitle sizing, one-handed preset, VoiceOver menus on Apple | Medium |

---

## 2. Pillars

1. **Every hit is felt.** Each impact plays on 4 channels: screen, sound, controller or haptics, world. Nothing silent, nothing weightless.
2. **Arcade handling with mastery depth.** A car that's fun in 10 seconds still rewards 10 hours: drift boosts, air control, energy-move combos.
3. **Ten cars, ten playstyles.** Distinct in silhouette, sound and tactics, balanced by playtest, not by spreadsheet.
4. **Arenas are characters.** Every arena has a landmark, an event and a destruction story you'll remember.
5. **Locked performance on every device.** 60 fps on min spec is a feature, from Apple TV to a gaming PC. A dropped frame is a bug.

---

## 3. Unity architecture (`unity-csharp-scripting`, `unity-scriptableobjects`)

The prototype's split carries over: headless game rules apart from presentation. That's what made its soak and balance tests possible, and it does the same in Unity.

| Layer | Unity form | Ported from |
|---|---|---|
| Data: vehicles, weapons, abilities, arenas, difficulties | **ScriptableObjects**, generated once from the TS data by an importer (`tools/export-vehicle-data.ts` → JSON → Editor script) | `src/data/*`, `src/weapons.ts`, `src/abilities.ts`, `src/ai.ts` |
| Rules: match, lives, scoring, modes, survival waves | Plain C# classes, no `MonoBehaviour`, so EditMode tests run them headless | `src/game.ts`, `src/modes.ts` |
| Simulation: vehicles, projectiles, pickups | `MonoBehaviour`s in `FixedUpdate` at **60 Hz** (`Time.fixedDeltaTime = 1/60`), pooled objects | `src/vehicle.ts`, `src/weapons.ts`, `src/pickups.ts` |
| Vehicle physics | **Custom ray-cast suspension on a `Rigidbody`** (4 `Physics.Raycast`/`SphereCast` wheels, spring + damper + lateral grip curve). Not `WheelCollider`: it fights arcade tuning | Rapier `DynamicRayCastVehicleController` settings |
| Feel and camera | `Feel` service: trauma, tiers, hit-stop through `Time.timeScale`, timers on `Time.unscaledDeltaTime`; Cinemachine 3 camera with a custom extension for the shake and lead | `src/feel.ts`, chase camera in `src/play.ts` |
| AI | **AI Navigation** package (NavMesh + off-mesh links for ramps) replaces the grid A*; the state machine and personalities port as C# | `src/ai.ts`, `src/nav.ts` |
| Input | **Input System 1.20** project-wide actions: gamepad, keyboard/mouse, touch; Siri Remote as a menu-only device on Apple TV | `src/input.ts`, `src/settings.ts` bindings |
| UI | **UI Toolkit** for menus and HUD; world-space markers for off-screen arrows | `src/menus.ts`, `src/hud.ts` |
| Audio | **FMOD Studio** for the engine model, adaptive music and the mix [VERIFY: FMOD indie licence terms and budget threshold]; Unity Audio as fallback | `src/audio.ts` |
| Platform services | **Steamworks.NET** on Steam; Apple's open-source **Unity plug-ins** (GameKit, GameController, CoreHaptics, Accessibility) on Apple platforms, behind one `IPlatform` interface | — |

**Assets:** Blender stays the asset factory. `tools/blender/export_vehicles.py` gains an FBX export alongside glTF, with the same §8.1 node names, or Unity imports `.glb` through the glTFast package. Textures are compressed per platform: **ASTC** on Apple, **BC7** on Windows and Mac (`unity-build-size`).

---

## 4. Workstreams

Each workstream has a **target**, **starting numbers** [ASSUMPTION unless noted] and an **exit check**.

### 4.1 Game feel and camera (`game-feel`, `camera-systems`)

**Status: done in the web prototype (P0). In Unity, port it 1:1 and keep the numbers.**

- **Shake:** trauma² driven by summed sines (rates 1.7 / 2.3 / 1.1). Max offset 0.35 m, max roll 1.5°, decay 1.2/s in real time. Hits add trauma, never reset it. Settings slider 0–100 %.
- **Hit tiers** (source of truth: `src/feel.ts` `TIERS`, mirrored in a `FeelTiers` ScriptableObject):

  | Tier | Trauma | Hit-stop | Rumble (strong/weak, ms) | Events |
  |---|---|---|---|---|
  | small | 0.1 | — | 0.1/0.3, 60 | MG hit, pickup |
  | medium | 0.35 | 40 ms | 0.4/0.6, 120 | missile hit, ram, hard landing |
  | large | 0.8 | 110 ms + 0.15 s slow-mo at 0.3× | 1.0/1.0, 300 | kill, special hit, boss phase |

- **Camera:** exponential follow (rate 8 position, 12 look), 0.25 s velocity lead, FOV 70 → 82° by speed, +4° kick on boost (with drift boost, §4.2), wall pull-in that snaps in and eases out. New: kill cam, a 1.2 s orbit at 0.4× time, skippable and off under reduced motion.
- **Haptics:** `Gamepad.SetMotorSpeeds` on PC pads; the Apple GameController plug-in for Apple pads; **Core Haptics** patterns on iPhone (light tap, thud, long rumble for the three tiers).
- **Exit check:** the port matches the prototype in a side-by-side capture, then 5 of 5 blind testers pick the new build as "punchier" [ASSUMPTION: friends/Discord testers].

### 4.2 Handling and physics (`unity-physics`, `physics-tuning`)

- Per-car **tuning ScriptableObject**: grip curve (lateral friction against slip angle, an `AnimationCurve`), drift threshold, drift-boost charge (0.6 / 1.2 / 2.0 s → +15 / 25 / 35 % thrust for 0.8 s), air pitch/yaw control (2.5 rad/s²), landing recovery (auto-level within 0.3 s if angle < 35°).
- **Surface response** by physics material tag: sand -15 % grip with dust, asphalt baseline, metal -8 % with sparks, shallow water -25 % with spray.
- **Collision damage:** ram damage = relative velocity² × mass ratio, capped at 40; dents via blend shapes (front, rear, left, right).
- **Exit check:** a scripted handling course (slalom, jump, 180° drift) for every car. Lap-time spread under 12 %, and each car's best line differs. At the end of the port, every car's lap time is within 5 % of the web prototype's.

### 4.3 Vehicles: hero art (`create-game-assets`, `unity-animation`, Blender MCP)

- **Budget per car:** LOD0 35k tris / LOD1 12k / LOD2 3k (Unity `LODGroup`; mobile tier drops LOD0). One 2K texture set (base colour, mask map, normal), a 512 decal atlas, 4 damage blend shapes plus a burnt-material swap.
- **Pipeline:**
  - block out in `blender/vehicles.blend` with the existing generator
  - hand-model the hero pass
  - bake AO and curvature, and texture with Blender node materials (rust, dust, chipped paint)
  - export to FBX or glTF via `tools/blender/export_vehicles.py`, keeping §8.1 node names
- **Outsourcing option:** 2–4 hero cars from freelance artists at about $400–900 each [ASSUMPTION], with a strict brief: silhouette sheet, palette, tri budget, node names.
- **Driver portraits:** painted busts for select and ending screens. Image generation for concepts only; final art painted over or commissioned. Disclose any shipped AI content on Steam's content survey and follow Apple's rules for Arcade [VERIFY].
- **Exit check:** every car reads by silhouette alone at 40 m on a grey background (5-second test).

### 4.4 Arenas and level art (`level-design`, `procedural-gen`)

- **Scope:** the 7 existing arenas plus 1 new one (8 total), rebuilt as Blender-modelled scenes assembled in Unity. Collision uses simplified mesh colliders and primitives.
- **Each arena gets:** 1 landmark visible from everywhere, 3 traversal routes (ground, elevated, secret), 1 big event (already designed) plus 2 small destructibles, and pickup sightlines checked from every spawn.
- **Lighting:** Unity's GPU lightmapper for statics, **Adaptive Probe Volumes** for cars and dynamic props, real-time sun shadows. Night arenas get 8–16 local lights (Forward+ handles the count) and emissive signage feeding bloom.
- **Atmosphere:** height fog, URP volumetric light shafts on the PC High tier only, wind-driven dust, tumbleweeds.
- **Exit check:** §6 budgets met on every platform tier. A screenshot from any random camera position is "postable" (art-bible review, §7).

### 4.5 VFX (`shader-programming`)

- **Explosion kit:** flash (1 frame, HDR 8.0) → fireball flipbook (8×8, 0.6 s) → soft smoke (3 s) → debris (6–12 pooled rigid bodies) → URP decal scorch (30 s fade).
- Built with the **Particle System** (Shuriken) so it runs on Apple TV; VFX Graph only for PC-tier extras. Muzzle-flash light pool (max 4), tracers, missile smoke trails, freeze-crystal shader, shield fresnel with hit ripples (Shader Graph).
- **Exit check:** under 3,000 particles and under 0.8 ms GPU for VFX in an 8-car melee (Unity Profiler, GPU module) on the Apple TV tier.

### 4.6 Audio (`audio-design`)

- **Engine:** FMOD event per car class (4 classes × idle, mid and high loops), with the RPM parameter fed by the same 5-gear virtual gearbox as the prototype (`GEARS` in `src/audio.ts`), plus a load layer on throttle.
- **SFX:** every impact layered as transient + body + tail, ±8 % pitch, no repeat within 3 plays. CC0 or purchased libraries [ASSUMPTION: about $300–600].
- **Mix:** busses for music, SFX, UI, voice, ambience. Duck music -6 dB on large hits and voice. Reverb snapshots per arena (canyon, city, hangar). Spatialised off-screen threats.
- **Music:** 6 arena tracks plus menu and boss, commissioned or library [ASSUMPTION: $2–6k], each with adaptive stems (calm, combat, last-two-standing).
- **Voice:** taunts for 11 drivers, by voice actors or synthesised only with proper rights. Every line captioned.
- **Exit check:** testers identify each car by engine sound with eyes closed; mix at -16 LUFS integrated loudness, peaks under -1 dBTP.

### 4.7 AI and encounter direction (`game-ai`, `ai-behavior-trees-utility-ai`, `unity-navmesh`)

- Port the state machine and personalities, moving navigation to NavMesh with off-mesh links for ramps and jumps.
- Add **utility scoring** on top: score = threat × opportunity × health × personality weight.
- **Fairness rules:** no aimbot (spread grows with target speed), specials telegraphed 0.4 s ahead (light and audio cue), at most 2 bots focusing the player on normal.
- **Director:** tracks player stress (damage in the last 10 s); holds attackers back when it's high and spawns pickups when the fight is dry.
- **Exit check:** the soak test passes (no bot stuck over 5 s). Human win rate on normal between 45 and 60 % [ASSUMPTION].

### 4.8 Front end, HUD and controls (`game-ui-ux`, `unity-input-system`)

- **3D garage:** turntable with camera blends between cars, stat bars, ability preview clip, livery picker.
- **HUD:** diegetic health (car smoke and sparks) plus a minimal overlay; weapon wheel on hold; damage-direction indicators; scaling 75–150 %.
- **Controls per platform:**
  - PC and Mac: keyboard/mouse and gamepad, both remappable
  - iPhone and iPad: **touch layout** (left-thumb steer pad, right-thumb throttle and fire, swipe or buttons for weapons and energy moves) plus any MFi/Xbox/PlayStation pad
  - Apple TV: gamepad to play, Siri Remote for menus only [VERIFY: Apple's current tvOS controller rules]
- **Motion:** 150–250 ms ease-out transitions, sound on every focus change, no dead clicks.
- **Exit check:** every screen works with gamepad only, keyboard only, mouse only and touch only. VoiceOver reads every menu on Apple platforms.

### 4.9 Narrative (`dialogue-systems`)

- Each driver gets a 3-beat arc: intro vignette, mid-campaign rival radio call, ending. In-engine Timeline shots with captions and voice, no pre-rendered video.
- **Exit check:** 11 intros and 11 endings, each 20–40 s, skippable.

### 4.10 Progression and save (`save-systems`)

- Driver mastery: levels 1–10 per car, unlocking liveries, horns and trails (cosmetic only).
- Daily challenge: seeded arena + car + modifier, with Steam and Game Center leaderboards.
- Save: versioned JSON in `Application.persistentDataPath`, synced by **Steam Cloud** and **iCloud** (key-value or CloudKit through the Apple plug-ins), with schema migration tests.
- **No** ads, in-app purchases, loot boxes or energy timers on any platform. The game is premium, which is also an Apple Arcade requirement.

### 4.11 Online multiplayer (phase-gated: decide at the end of P2)

- **Model:** host-authoritative with **Netcode for GameObjects** + Unity Transport (or Fish-Net if NGO's prediction falls short). The host runs the 60 Hz simulation and sends snapshots at 20 Hz; clients interpolate other cars at 100 ms and predict their own car with reconciliation.
- **Lobbies and relay:** Steam lobbies and Steam Networking Sockets on Steam; **Game Center** matchmaking on Apple. Crossplay between the two is out of scope for v1.0.
- **Scope:** 2–8 players in deathmatch only; private lobbies first.
- **Go/no-go:** only if P0–P2 land on schedule. Otherwise ship local 2-player split-screen (spec P2) in v1.0 and online in a 1.x update.
- **Exit check:** at 150 ms RTT with 2 % packet loss, the local car feels the same as offline and remote cars never visibly jump more than 0.5 m.

---

## 5. Production phases

Each phase ends in a build a player can judge. **Do not start the next phase until the current one passes its gate.**

| Phase | Weeks | Scope | Gate |
|---|---|---|---|
| **P0: Feel slice** (web) | 1–4 | §4.1 feel and camera, §4.6 geared engine model, in the web prototype | **Code done.** Remaining: blind test 5/5 |
| **PP: Port to Unity** | 5–16 | §3 architecture; data importer; vehicle physics; combat, pickups, abilities, energy moves; feel and camera; AI on NavMesh; match rules and 3 modes; greybox arenas from the prototype; placeholder UI; Steam (Windows + Mac) and TestFlight (iPhone + Apple TV) builds from CI | **Parity:** handling-course times within 5 % of the web build; balance sim win spread inside 18–32 % (same as the prototype); the same tier numbers in the feel tests; 60 fps on Apple TV with 8 cars on greybox |
| **P1: Vertical slice** | 17–26 | 1 arena at final art (§4.4), 2 hero cars (§4.3), full VFX kit (§4.5), FMOD audio and adaptive music, new HUD, touch controls | "Trailer test": 60 s of raw capture looks shippable on every platform; budgets met. **Pitch Apple Arcade with this build** |
| **P2: Production** | 27–54 | Remaining 9 vehicle models and 7 arenas to the slice standard, AI utility layer, front end and garage, narrative, progression | Every content row of §8 passes; external playtest NPS ≥ 40 [ASSUMPTION] |
| **P3: Online or split-screen** | 55–66 | §4.11 per the go/no-go decision | §4.11 exit check; 4-hour session with 0 desyncs |
| **P4: Beta and cert** | 67–78 | Steam: achievements, cloud, Deck verification. Apple: Game Center, iCloud, controller and touch QA on every device, App Review. Localisation (FR, DE, ES, PT-BR, JA) [ASSUMPTION]. Closed beta on Steam Playtest and TestFlight | Crash-free sessions ≥ 99.5 %; 0 open A/B bugs; Steam review and Apple review passed |
| **P5: Launch** | 79–84 | Steam page live ≥ 2 weeks as Coming Soon, demo in Steam Next Fest, web demo stays free; Arcade launch date set by Apple, or App Store premium launch | Release |

**Cut list, in order, if the schedule slips:** online (to 1.x) → arena #8 → daily challenges → voice acting (keep text) → Kingpin as a playable hero car → Apple TV (ship iPhone, iPad and Mac first, unless Arcade requires it [VERIFY]). Feel, performance and the vertical-slice quality bar are **never** cut.

---

## 6. Technical budgets per platform tier (replace GAME_SPEC §12.4 at PP)

**Min spec** [ASSUMPTION, confirm by testing on real devices]:

| Tier | Devices | Target |
|---|---|---|
| **Apple TV / Mobile** | Apple TV 4K (A12 or later), iPhone with A15 or later, iPad with M1 or A14 or later | 60 fps, 1080p render on TV with spatial upscaling, native res × 0.8 on phones |
| **Mac / PC Medium** | Apple M1, Intel Iris Xe, Steam Deck | 60 fps at 1080p (Deck 800p) |
| **PC High** | GTX 1660 / RX 5600 or better | 60 fps at 1440p, all features |

| Metric | Apple TV / Mobile | Mac / PC Medium | PC High |
|---|---|---|---|
| Frame time | p99 ≤ 18 ms | p99 ≤ 18 ms | p99 ≤ 18 ms |
| Draw calls (SRP batches) | ≤ 150 | ≤ 250 | ≤ 400 |
| Visible triangles | ≤ 400k | ≤ 800k | ≤ 1.5M |
| Texture memory | ≤ 300 MB | ≤ 700 MB | ≤ 1.5 GB |
| Shadows | 1 cascade, 1024 | 2 cascades, 2048 | 4 cascades, 2048, soft |
| Post | Bloom, tonemap, colour grade | + SSAO | + SSAO, volumetrics, TAA/SMAA |
| Load per arena | ≤ 5 s | ≤ 4 s | ≤ 3 s |
| Install size | ≤ 2 GB [VERIFY: Apple size and on-demand-resource rules] | — | — |

Techniques: object pooling for everything spawned; SRP Batcher and GPU Resident Drawer; static batching for arenas; LODGroups; Addressables per arena (`unity-build-size`); shader variant stripping and a **warm-up collection** so there are 0 hitches over 33 ms in a full campaign; thermal check on iPhone (30-minute session holds 60 fps).

---

## 7. Solo force multipliers

The AAA habit that matters most here: **automate the QA team you don't have.**

| Tool | What it replaces | Built on |
|---|---|---|
| EditMode tests for rules, feel tiers, gearbox, data import | Unit-test coverage | Unity Test Framework; ported from the Vitest suites |
| Bot soak (nightly, 30 min, all arenas, `-batchmode -nographics`) | Overnight QA soak | PlayMode test, ported from `tests/soak.test.ts` |
| Balance sim (300 rounds, nightly) | Balance designer | PlayMode test, ported from `tests/balance.test.ts` |
| Screenshot regression: fixed seeds and camera points per arena, pixel diff ≤ 2 % | Art QA | PlayMode capture + image diff |
| Perf regression: scripted 8-car melee, fails if p99 > budget | Perf team | Profiler markers + a CI job on a Mac with a real Apple TV or iPhone attached [ASSUMPTION] |
| CI builds: Windows, Mac, iOS, tvOS | Build engineer | GitHub Actions with GameCI for Windows/Mac [VERIFY: Unity licence activation in CI]; a self-hosted Mac or Xcode Cloud for Apple; fastlane uploads to TestFlight |
| Telemetry (opt-in): deaths heatmap, car pick and win rate, session length | Analytics team | Small endpoint [ASSUMPTION: Cloudflare Worker]. Default off on Apple builds until Arcade's data rules are checked [VERIFY] |
| Art bible (1 page + reference board) and review checklist | Art director | `docs/ART_BIBLE.md`, written at P1 |
| Blender MCP and generator scripts | Junior environment artists | `tools/blender/*` (exists) |
| Web prototype | Tuning sandbox | Try a number in the browser in seconds, then copy it to the ScriptableObject |

**Weekly rhythm:** Monday plan, Tuesday to Thursday build, Friday playtest build plus 30-minute capture review. Every 4 weeks, an external playtest with 5+ new players (Steam Playtest or TestFlight).

---

## 8. AAA Definition of Done

- [ ] All 4 hit channels (screen, audio, rumble or haptics, world) fire for every damage event
- [ ] 11 playable cars + the drone at hero quality with LODs, damage states and distinct engine audio
- [ ] 8 arenas built in Blender, lit in Unity with baked lighting, 1 landmark, 1 major and 2 minor destructibles each
- [ ] p99 frame time ≤ 18 ms on every tier's min spec, in every arena with 8 cars; 0 shader hitches in a full campaign
- [ ] Mix at -16 LUFS integrated loudness, adaptive music in every arena
- [ ] Full parity across gamepad, keyboard/mouse and touch, remappable
- [ ] Accessibility: colour-blind modes (3), subtitle size and background, shake and haptics sliders, aim assist slider, one-handed preset, reduced motion, VoiceOver menus on Apple
- [ ] 11 driver arcs (intro, rival call, ending), captioned
- [ ] Online, or split-screen, passes its exit check
- [ ] Steam: achievements, cloud saves, Deck verified, store page approved, AI content survey answered accurately
- [ ] Apple: Game Center (achievements, leaderboards), iCloud sync across iPhone, iPad, Mac and Apple TV, controller and touch support, no ads or in-app purchases, offline play, App Review passed [VERIFY: the current Apple Arcade requirements list]
- [ ] Localisation in 5 languages with no truncated UI strings
- [ ] 24-hour bot soak: 0 crashes, memory growth under 50 MB
- [ ] All content original, same rule as GAME_SPEC; legal check on names and logos before any store page goes live

---

## 9. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Online multiplayer eats 6+ months | High | Phase gate at the end of P2; split-screen fallback |
| Hero art throughput (12 vehicle models × ~2 weeks each) | High | Outsource 2–4 cars; generator blockouts first; kitbash parts library |
| Apple Arcade doesn't pick the game | Medium | Pitch with the P1 slice; App Store premium and Steam are the plan B, with no rework needed |
| Port drifts from the tuned feel | Medium | Parity gate with numeric checks; the web build stays available as reference |
| Apple TV performance | Medium | Apple TV tier budgets from the first port build; perf CI on a real device |
| Touch controls make car combat feel bad | Medium | Prototype touch in PP, not P4; auto-aim and assisted steering options on touch only |
| Vendor terms change (Unity, FMOD, Apple, Steam) | Low | `[VERIFY]` items checked at the start of PP and again before P4 |
| Solo burnout | Medium | Fixed weekly rhythm; phase gates as natural breaks; cut list agreed up front |
| Reviewers compare it to the genre's classics | Medium | Lean on what's original (energy combos, 70s Southwest setting, drift-boost mastery) in all marketing |

---

## 10. P0 results (web prototype)

1. [x] Trauma shake with summed sines, hit tiers and hit-stop: `src/feel.ts` (tier table, real-time timers), `Combat.onHurt` hook, simulation time scaled in the `play.ts` loop. Hard landings (falling faster than 9 m/s) are medium hits. Dealing a hit plays one tier lighter than taking it; chip damage under 1 HP only adds a faint shake.
2. [x] Gamepad rumble (`vibrationActuator.playEffect('dual-rumble')`, feature-checked) with shake and rumble sliders in Settings. Old on/off shake settings migrate. Not yet felt on a physical pad.
3. [x] Chase camera: exponential follow (rate 8), 0.25 s velocity lead on the look point (rate 12), FOV 70 → 82° by speed, wall pull-in by ray cast against static colliders (snap in, ease out). The +4° boost kick waits for drift boost (§4.2).
4. [x] Engine audio: a 5-gear virtual gearbox drives RPM (drops on each upshift), and idle, mid and high synth layers crossfade by RPM. Pitch scales with car mass.
5. [ ] Record the before-and-after capture and run the 5-tester blind test (needs people).

Checks: `tests/feel.test.ts` (tiers, hit-stop release, trauma decay, reduced-motion slow-mo, gear shifts); headless run measured medium hit = 0.35 trauma, kill = 0.8 with the simulation slowed, trauma back to 0 after 2 s, 60 fps at 107 draws, 0 console errors; e2e smoke and axe pass.

## 11. First two weeks of the port (PP kickoff)

1. Install Unity 6.3 LTS with the Windows, Mac, iOS and tvOS build modules; create `unity/` (URP 3D template), Git LFS rules and a Unity `.gitignore`.
2. Check the `[VERIFY]` items: Unity Personal revenue limit, FMOD indie licence, current Apple Arcade requirements and pitch process, Apple size rules.
3. Data importer: export the TS vehicle, weapon, ability and arena data to JSON and generate ScriptableObjects.
4. Ray-cast vehicle on a `Rigidbody` with one car on the Proving Ground greybox; tune against the web build's handling course.
5. Port `Feel` and the chase camera; confirm the tier numbers with an EditMode test.
6. First CI build for Windows and Mac, and a TestFlight build on one iPhone and one Apple TV.
