# BLACKTOP BOUNTY — AAA Production Plan (solo developer)

> Companion to [GAME_SPEC.md](GAME_SPEC.md), which stays the source of truth for rules, roster and numbers that already ship. This file covers how to take the shipped v1 (M0–M7, live on GitHub Pages) to a AAA-quality release.
> Written for one developer with shipped-AAA experience (open-world and annual-sports pipelines). That experience is the plan's main asset: it brings the quality bar, the cert mindset and the pipeline discipline. What it can't bring is headcount.
> Built on the gamedev skills (`game-feel`, `camera-systems`, `physics-tuning`, `game-ai`, `audio-design`, `threejs-materials-lighting`, `create-game-assets`, `performance-optimization`, `level-design`, `game-ui-ux`, `steam-publish`, `itch-publish`). Each workstream below names the skill to load before working on it.

---

## 0. Reality check: what "AAA" means for one person

A AAA studio game is 200–1,000 people for 3–5 years. One person can't match its **breadth**: hours of content, cinematic story, hand-made everything. One person **can** match its **quality per second on screen**: how a car handles, how a hit lands, how an arena reads, how the audio mixes, how stable the frame rate is.

**Strategy: AA scope, AAA finish.** That is the "indie AAA" model: one tight mode set and a few arenas, each polished to studio cert level.

| Axis | AAA studio | This plan |
|---|---|---|
| Content breadth | 20+ arenas, 30+ cars, cutscenes | 8 arenas, 11 playable cars (10 + Kingpin) + the drone, in-engine story beats |
| Moment-to-moment feel | Best in class | **Best in class (non-negotiable)** |
| Visual fidelity | Bespoke everything | Kitbash + CC0 + procedural + Blender MCP, under one strict art bible |
| Audio | Licensed score, Foley team | Procedural engine synth + layered SFX library + 4–6 commissioned or library tracks |
| Online | Dedicated servers | Host-authoritative peer-to-peer, 2–8 players (phase-gated) |
| QA | 50-person QA team | Bots: soak, balance and screenshot regression in CI |
| Platforms | Consoles | Web (free demo) + Steam (paid; desktop wrapper, Steam Deck verified) |

Scoped like this, the timeline is about **14–18 months full-time** [ASSUMPTION: about 40 h/week, around $5–15k budget for music, sound libraries and outsourced hero assets].

---

## 1. Gap audit: v1 today vs the AAA bar

What the code does now, and what a AAA reviewer would notice in the first 60 seconds.

| Area | v1 today (verified in code) | AAA bar | Gap |
|---|---|---|---|
| Camera shake | Random direction every frame (`play.ts:141`) → buzzes | Trauma² with summed sines, decays in real time, separate positional and rotational parts | **High**: reads as cheap |
| Hit feedback | Damage number + particles | Hit-stop tiers, controller rumble, hit-marker SFX, impact decals, car deformation | **High** |
| Handling | Rapier ray-cast vehicle, tuned for arcade play | Per-car tuned grip curves, drift assist, air control, landing recovery, tyre-surface response | Medium |
| Car models | 12 Blender-generated `.glb` (≈1 MB total), rounded bevels | Hero-quality cars: 30–60k tris, damage states, LODs, baked AO, decals | **High** |
| Arenas | Merged greybox with tiled PBR and generated facades | Hand-dressed set pieces, unique landmarks, destructible layers, light baked into vertex colour/lightmaps | **High** |
| Lighting | HDRI image-based light + 1 shadowed sun + GTAO on High | + light probes, local lights at night, volumetric fog shafts, emissive signage | Medium |
| VFX | Instanced particles | Flipbook explosions, smoke with soft particles, heat haze, sparks with light, debris physics | **High** |
| Audio | Procedural synth music + synth SFX | Layered SFX (transient + body + tail), RPM-driven engine, mix busses, ducking, reverb zones | **High** |
| AI | State machine + A* nav + personalities | + squad pressure, telegraphed attacks, rubber-band-free fairness, a director that paces the fight | Medium |
| UI/UX | Functional HTML menus, HUD | Animated, art-directed front end, 3D garage, readable diegetic HUD, full controller UX | Medium |
| Story | Ending cards per driver | Intro/outro in-engine vignettes, radio chatter, rival arcs | Medium |
| Online | None | Online versus/co-op | **High** (biggest scope risk) |
| Progression | Kingpin unlock | Cosmetic unlocks, mastery tracks, challenges (no paid loot boxes) | Medium |
| Perf/stability | 60 fps on the dev Mac, Medium preset | 60 fps locked on min spec, frame-time p99 < 20 ms, zero crashes in 24 h soak | Medium |
| Accessibility | Focus trap, reduced motion, captions, axe pass | Remapping on the pad, colour-blind modes, aim assist slider, subtitle sizing, one-handed preset | Medium |

---

## 2. Pillars (revised for AAA)

The v1 pillars hold. Pillar 4 changes from "retro look" to the modern stylized look that shipped.

1. **Every hit is felt.** Each impact plays on 4 channels: screen, sound, controller, world. Nothing silent, nothing weightless.
2. **Arcade handling with mastery depth.** A car that's fun in 10 seconds still rewards 10 hours: drift boosts, air control, energy-move combos.
3. **Ten cars, ten playstyles.** Each one is distinct in silhouette, sound and tactics, and balanced by playtest, not by spreadsheet.
4. **Arenas are characters.** Every arena has a landmark, an event and a destruction story you'll remember.
5. **Locked performance.** 60 fps on min spec is a feature. A dropped frame is a bug.

---

## 3. Workstreams

Each workstream has a **target**, **starting numbers** [ASSUMPTION unless noted] and an **exit check**. Load the named skill before starting the workstream.

### 3.1 Game feel and camera (`game-feel`, `camera-systems`)

**Do first: highest return on effort in the whole plan.**

- **Shake:** replace the random per-frame offset with trauma² driven by summed sines (rates ~1.7 / 2.3 / 1.1). Max offset 0.35 m, max roll 1.5°, decay 1.2/s in real time. Hits add trauma; they never reset it. The settings slider scales it from 0 to 1, replacing the current on/off.
- **Hit tiers:**

  | Tier | Trauma | Hit-stop | Rumble (low/high, ms) | Events |
  |---|---|---|---|---|
  | small | 0.1 | — | 0.1/0.3, 60 | MG hit, pickup |
  | medium | 0.35 | 40 ms | 0.4/0.6, 120 | missile hit, ram, hard landing |
  | large | 0.8 | 110 ms + 0.15 s slow-mo to 0.3× | 1.0/1.0, 300 | kill, special hit, boss phase |

- **Camera:** spring-damped chase with `1 - exp(-rate·dt)` smoothing (rate 8 for position, 12 for look). Lead the target by 0.25 s of velocity. FOV goes from 70° up to 82° with speed, plus a +4° kick on boost. Collision pull-in uses a sphere cast. Kill cam: 1.2 s orbit around the wreck at 0.4× time (skippable, and off under reduced motion).
- **Controller:** `GamepadHapticActuator.playEffect('dual-rumble')` behind a feature check, with a rumble slider in settings.
- **Exit check:** a side-by-side capture of v1 against the new build. 5 of 5 blind testers pick the new one as "punchier" [ASSUMPTION: friends/Discord testers].

### 3.2 Handling and physics (`physics-tuning`)

- Per-car **tuning sheet** in `src/data/vehicles.ts`: grip curve (lateral friction against slip angle), drift threshold, drift-boost charge (0.6 / 1.2 / 2.0 s tiers → +15 / 25 / 35 % thrust for 0.8 s), air pitch/yaw control (2.5 rad/s²), landing recovery (auto-level within 0.3 s if angle < 35°).
- **Surface response:** sand -15 % grip with dust FX, asphalt baseline, metal -8 % with sparks, shallow water -25 % with spray.
- **Collision damage model:** ram damage = relative velocity² × mass ratio, capped at 40, with soft-body-style vertex dents on the car mesh (precomputed morph targets: front, rear, left, right).
- **Exit check:** a scripted handling course (slalom, jump, 180° drift) recorded for every car. Lap-time spread under 12 %, and each car's best line differs.

### 3.3 Vehicles: hero art (`create-game-assets`, `threejs-gltf-loading`, Blender MCP)

- **Budget per car:** LOD0 35k tris / LOD1 12k (> 30 m) / LOD2 3k (> 70 m). One 2K texture set (base colour, ORM, normal), a 512 decal atlas, and 4 damage morph targets plus a burnt-material swap.
- **Pipeline:**
  - block out in `blender/vehicles.blend` with the existing generator
  - hand-model the hero pass
  - bake AO and curvature, and texture with procedural Blender node materials (rust, dust, chipped paint)
  - export via `tools/blender/export_vehicles.py`, keeping §8.1 node names
- **Outsourcing option:** 2–4 hero cars from freelance artists at about $400–900 each [ASSUMPTION]. Give them a strict brief: silhouette sheet, palette, tri budget, node names.
- **Driver portraits:** 2D painted busts for select and ending screens (image generation for concept only; final art is painted over or commissioned, and disclosed in Steam's AI content survey if any AI art ships).
- **Exit check:** every car reads by silhouette alone at 40 m on a grey background (5-second test with testers).

### 3.4 Arenas and level art (`level-design`, `procedural-gen`, `threejs-materials-lighting`)

- **Scope:** keep the 7 existing arenas plus 1 new one (8 total). Rebuild each as a **Blender scene** exported to `.glb`, replacing the code greybox. Collision stays as simplified generated colliders.
- **Each arena gets:**
  - 1 landmark visible from everywhere
  - 3 traversal routes (ground, elevated, secret)
  - 1 big event (already exists) plus 2 small destructibles (fuel tanks, billboards, fences)
  - pickup sightlines checked from every spawn
- **Lighting:** bake lightmaps or vertex AO in Blender (Cycles) for statics, keep real-time sun shadows for cars, add light probes (`LightProbeGenerator`) per arena zone. Night arenas get 8–16 shadowless local point lights and emissive signage feeding bloom.
- **Atmosphere:** height fog shader, god-ray pass on High, wind-driven dust sprites, tumbleweeds.
- **Exit check:** budgets from §5 met in every arena. A screenshot from any random camera position is "postable" (the art-bible review in §6).

### 3.5 VFX (`shader-programming`)

- **Explosion kit:** flash (1 frame, HDR 8.0) → fireball flipbook (8×8, 0.6 s) → smoke with soft particles (3 s) → debris (6–12 pooled rigid bodies) → scorch decal (projected, 30 s fade).
- Muzzle flashes with a short-lived point light pool (max 4 active), tracer trails, missile smoke ribbons, freeze-crystal shader, shield fresnel with hit ripples.
- **Exit check:** under 3,000 particles and under 0.8 ms GPU for VFX in an 8-car melee (measured with `EXT_disjoint_timer_query`).

### 3.6 Audio (`audio-design`)

- **Engine:** granular or RPM-crossfaded loops per car class (4 classes × 3 layers: idle, mid, high), pitched by RPM, plus a load layer when throttling.
- **SFX:** every impact layered as transient + body + tail, randomized ±8 % pitch, with no repeats within 3 plays. Use CC0 or purchased libraries [ASSUMPTION: about $300–600 in sound packs].
- **Mix:** busses for music, SFX, UI, voice, ambience. Duck music by -6 dB on large hits and voice. Convolution reverb per arena (canyon, city, hangar). HRTF panning for off-screen threats.
- **Music:** 6 arena tracks plus menu and boss, either commissioned or library [ASSUMPTION: $2–6k]. Each has adaptive intensity stems (calm, combat, last-two-standing).
- **Voice:** taunts for 11 drivers, recorded by voice actors or synthesized only with proper rights. Every line captioned.
- **Exit check:** an eyes-closed test where testers identify each car by engine sound, and the mix peaks under -1 dBTP with -16 LUFS integrated loudness.

### 3.7 AI and encounter direction (`game-ai`, `ai-behavior-trees-utility-ai`)

- Move from the state machine to **utility scoring** layered on top of the existing states: score = threat × opportunity × health × personality weight.
- **Fairness rules:** no aimbot (spread grows with target speed), telegraph specials 0.4 s ahead (light + audio cue), cap bots focusing the player at 2 at once on normal difficulty.
- **Director:** tracks the player's stress (damage taken in the last 10 s). It holds back attackers when stress is high and spawns pickups when the fight is dry.
- **Exit check:** the soak test still passes (no stuck bot over 5 s). The win rate of a human playtester on normal sits between 45 and 60 % [ASSUMPTION].

### 3.8 Front end and HUD (`game-ui-ux`)

- **3D garage:** turntable with camera blends between cars, stat bars, ability preview clip, livery picker.
- **HUD:** diegetic health (car smoke and sparks) plus a minimal overlay. Weapon wheel on hold. Damage-direction indicators. Everything scales from 75 to 150 %.
- **Motion:** 150–250 ms ease-out transitions, sound on every focus change, no dead clicks.
- **Exit check:** every screen works with keyboard only, pad only and mouse only, and axe still reports 0 serious issues.

### 3.9 Narrative (`dialogue-systems`)

- Each driver gets a 3-beat arc: intro vignette, mid-campaign rival radio call, ending. These are in-engine camera shots with captions and voice, with no pre-rendered video.
- **Exit check:** 11 intros and 11 endings, each 20–40 s, skippable.

### 3.10 Progression and save (`save-systems`)

- Driver mastery: levels 1–10 per car, which unlock liveries, horns and trails (cosmetic only).
- Daily challenge: seeded arena + car + modifier, with a global leaderboard if online ships, otherwise local.
- Save: versioned JSON in IndexedDB on web, and Steam Cloud on the Steam build. Add schema migration tests.
- **No** paid loot boxes, energy timers or pay-to-win. The game is premium.

### 3.11 Online multiplayer (phase-gated: decide at the end of Phase 2)

- **Model:** host-authoritative over WebRTC data channels (browser) and Steam Networking Sockets (Steam build). The host runs the existing fixed 60 Hz simulation and sends snapshots at 20 Hz with delta compression. Clients interpolate other cars at 100 ms and predict their own car with reconciliation.
- **Scope:** 2–8 players in deathmatch only, with private lobbies first and matchmaking later.
- **Go/no-go:** only if Phases 0–2 land on schedule. Otherwise ship 2-player split-screen (spec P2) as v1.0 and online in a 1.x update.
- **Exit check:** at 150 ms RTT with 2 % packet loss, the local car feels the same as offline and remote cars never visibly teleport more than 0.5 m.

---

## 4. Production phases

Each phase ends in a build a player can judge. **Do not start the next phase until the current one passes its gate.**

| Phase | Weeks | Scope | Gate |
|---|---|---|---|
| **P0: Feel slice** | 1–6 | §3.1 feel/camera, §3.2 handling, §3.6 engine audio and impact layers, on **one** arena with **two** cars | Blind test: new build preferred 5/5. Handling course spread < 12 % |
| **P1: Vertical slice** | 7–16 | 1 arena at final art (§3.4), 2 hero cars (§3.3), full VFX kit (§3.5), adaptive music, new HUD | "Trailer test": 60 s of raw gameplay capture looks shippable. Perf budget met on min spec |
| **P2: Production** | 17–44 | Remaining 9 vehicle models and 7 arenas to the slice standard, AI utility layer, front end, narrative, progression | Every Definition-of-Done row in §7 passes for content, plus external playtest NPS ≥ 40 [ASSUMPTION] |
| **P3: Online or split-screen** | 45–56 | §3.11 per the go/no-go decision | Exit check in §3.11. 4-hour playtest session with 0 desyncs |
| **P4: Beta and cert** | 57–66 | Steam build, Steam Deck verification, achievements, cloud saves, localization (FR, DE, ES, PT-BR, JA) [ASSUMPTION], closed beta | Crash-free sessions ≥ 99.5 %, 0 open A/B bugs, Steam review passed |
| **P5: Launch** | 67–72 | Store page live ≥ 2 weeks as Coming Soon, demo during Steam Next Fest, web demo stays free | Release |

**Cut list, in order, if the schedule slips:** online (move to 1.x) → arena #8 → daily challenges → voice acting (keep text) → Kingpin as a playable hero car (keep it boss-only). Feel, performance and the vertical-slice quality bar are **never** cut.

---

## 5. Technical budgets (replace GAME_SPEC §12.4 at P1)

**Min spec** [ASSUMPTION]: Intel Iris Xe / Apple M1 / Steam Deck, 1080p (Deck 800p), Medium preset.

| Metric | v1 budget | AAA budget |
|---|---|---|
| Frame time | 60 fps average | **p99 ≤ 18 ms**, p50 ≤ 14 ms on min spec |
| Draw calls | ≤ 250 | ≤ 300 (High), ≤ 180 (Medium) |
| Visible triangles | ≤ 400k | ≤ 1.2M (High), ≤ 500k (Medium) |
| GPU memory | — | ≤ 1.2 GB (High), ≤ 600 MB (Medium) |
| Texture compression | JPEG | **KTX2 / Basis Universal** (UASTC normals, ETC1S colour) |
| Mesh compression | none | **Meshopt** (`EXT_meshopt_compression`) |
| Web first-play download | ≤ 8 MB | ≤ 25 MB, streaming the rest per arena |
| Load per arena | ≤ 5 s | ≤ 3 s warm, ≤ 8 s cold |
| Shader hitches | precompiled at load | 0 hitches > 33 ms in a full campaign run |

**Tech upgrades, in order of payoff:**
1. KTX2 + Meshopt: halves download and VRAM.
2. Instanced static props and per-arena BVH culling.
3. A WebGPU renderer path (`three/webgpu`) behind a flag, with WebGL2 kept as fallback. Adopt it only if it's ≥ 15 % faster on min spec.
4. Move AI and physics to a Web Worker if the main thread exceeds 8 ms.

**Desktop wrapper:** Tauri, or Electron if Steamworks bindings are easier (`steamworks.js`). Pin the Chromium version for Deck consistency.

---

## 6. Solo force multipliers

The AAA habit that matters most here: **automate the QA team you don't have.**

| Tool | What it replaces | Built on |
|---|---|---|
| Bot soak in CI (nightly, 30 min, all arenas) | Overnight QA soak | `tests/soak` (exists) |
| Balance sim (300 rounds, nightly) | Balance designer | `npm run balance` (exists) |
| **Screenshot regression:** fixed seeds and camera points per arena, pixel diff ≤ 2 % | Art QA | Playwright (exists) + new |
| **Perf regression:** scripted 8-car melee, fails CI if p99 > budget | Perf team | Playwright + `performance.now` traces |
| Telemetry (opt-in): deaths heatmap, car pick and win rate, session length | Analytics team | Plain JSON POST to a tiny endpoint [ASSUMPTION: Cloudflare Worker] |
| Art bible (1 page + reference board) and review checklist | Art director | `docs/ART_BIBLE.md`, written at P1 |
| Blender MCP and generator scripts | Junior environment artists | `tools/blender/*` (exists) |

**Weekly rhythm:** Monday plan, Tuesday to Thursday build, Friday playtest build plus 30-minute capture review. Every 4 weeks, an external playtest with 5+ new players.

---

## 7. AAA Definition of Done

- [ ] All 4 hit channels (screen, audio, rumble, world) fire for every damage event
- [ ] 11 playable cars + the drone at hero quality with LODs, damage states and distinct engine audio
- [ ] 8 arenas built in Blender with baked lighting, 1 landmark, 1 major and 2 minor destructibles each
- [ ] p99 frame time ≤ 18 ms on min spec in every arena with 8 cars; 0 shader hitches in a full campaign
- [ ] Mix at -16 LUFS integrated loudness, adaptive music in every arena
- [ ] Full controller, keyboard and mouse parity, with remapping on all three
- [ ] Accessibility: colour-blind modes (3), subtitle size and background, shake slider, aim assist slider, one-handed preset, reduced motion
- [ ] 11 driver arcs (intro, rival call, ending), captioned
- [ ] Online, or split-screen, passes its exit check
- [ ] Steam: achievements, cloud saves, Deck verified, store page approved, AI content survey answered accurately
- [ ] Localization in 5 languages with no truncated UI strings
- [ ] 24-hour bot soak: 0 crashes, 0 memory growth > 50 MB
- [ ] All content original: same rule as GAME_SPEC; legal check on names and logos before the store page goes live

---

## 8. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Online multiplayer eats 6+ months | High | Phase gate at the end of P2; split-screen fallback |
| Hero art throughput (12 vehicle models × ~2 weeks each) | High | Outsource 2–4 cars; generator blockouts first; kitbash parts library |
| Browser perf ceiling vs AAA visuals | Medium | Quality presets; KTX2 and Meshopt; WebGPU path; Deck as the reference |
| Solo burnout | Medium | Fixed weekly rhythm; phase gates as natural breaks; cut list agreed up front |
| Genre comparison: reviewers name the inspiration | Medium | Lean on what's original (energy combos, 70s Southwest setting, drift-boost mastery) in all marketing |
| Steam rejection | Low | Untick unfinished features; test every listed OS; answer the AI disclosure accurately |

---

## 9. First two weeks (P0 kickoff)

1. [x] Trauma shake with summed sines, hit tiers and hit-stop: `src/feel.ts` (tier table, real-time timers), `Combat.onHurt` hook, simulation time scaled in the `play.ts` loop. Hard landings (falling faster than 9 m/s) are medium hits. Dealing a hit plays one tier lighter than taking it; chip damage under 1 HP only hums.
2. [x] Gamepad rumble (`vibrationActuator.playEffect('dual-rumble')`, feature-checked) with shake and rumble sliders in Settings. Old on/off shake settings migrate. Not yet felt on a physical pad.
3. [x] Chase camera: exponential spring (rate 8), 0.25 s velocity lead on the look point (rate 12), FOV 70 → 82° by speed, wall pull-in by ray cast against static colliders (snap in, ease out). The +4° boost kick is skipped: no car has a generic boost yet (comes with drift boost, §3.2).
4. [x] Engine audio: a 5-gear virtual gearbox drives RPM (drops on each upshift), and idle, mid and high synth layers crossfade by RPM. Pitch scales with car mass, so all classes are covered. Synth only; recorded engine loops come with the §3.6 sound libraries.
5. [ ] Record the before-and-after capture and run the 5-tester blind test (needs people).

Checks: `tests/feel.test.ts` (tiers, hit-stop release, trauma decay, reduced-motion slow-mo, gear shifts); headless run measured medium hit = 0.35 trauma, kill = 0.8 with sim slowed, trauma back to 0 after 2 s, 60 fps at 107 draws, 0 console errors; e2e smoke and axe pass.
