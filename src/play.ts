import * as THREE from 'three';
import { firstGamepad, readInput, type DriveInput } from './input';
import type { Vehicle } from './vehicle';
import { Hud } from './hud';
import { Match, RESPAWN_DELAY, type MatchOptions, type MatchResult } from './game';
import { Survival } from './modes';
import { Fx } from './fx';
import { createSky, outskirts } from './scenery';
import { applySky, applySurfaces, createPost, horizonColor, loadSky, TILE } from './look';
import { ARENAS } from './data/arenas';
import { wheelLayout, wheelY } from './data/vehicles';
import type { GameAudio } from './audio';
import type { Menus } from './menus';
import type { RetroPass } from './post';
import type { Settings } from './settings';
import type { Mode } from './select';

export interface App {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  audio: GameAudio;
  menus: Menus;
  retro: RetroPass;
  keys: Set<string>;
  settings: Settings;
  applySettings(): void;
}

export interface PlayResult {
  result: MatchResult | null;
  quit: boolean;
  restart: boolean;
  match: Match;
  survival: Survival | null;
}

const STEP = 1 / 60;
const END_DELAY = 2.5; // s of play after the result before the results screen
const SUN_OFFSET = new THREE.Vector3(30, 60, 20);
const RIGHT = new THREE.Vector3(0, 0, 1);

/** Run one match to its end (or until the player quits from the pause menu). */
export async function playMatch(app: App, opts: MatchOptions, mode: Mode): Promise<PlayResult> {
  const { renderer, camera, audio, menus, retro, keys } = app;
  const settings = () => app.settings;
  const def = ARENAS.find((a) => a.id === opts.arena) ?? ARENAS[0];
  const hdr = await loadSky(def.theme.hdri); // the loading card is up while this downloads

  // --- scene ----------------------------------------------------------------
  const scene = new THREE.Scene();
  const match = new Match(scene, opts);
  const { player, combat, arena } = match;
  const theme = arena.theme;
  // Modern look: HDRI sky + image-based lighting, ACES tone mapping, soft shadows (see look.ts).
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = theme.exposure;
  applySky(renderer, scene, hdr, 0.9);
  const haze = horizonColor(hdr).multiplyScalar(0.75);
  scene.fog = new THREE.Fog(haze, theme.fogNear * 3.5, theme.fogFar * 3.2);
  scene.add(new THREE.HemisphereLight(theme.hemiSky, theme.hemiGround, theme.hemiIntensity * 0.3));
  const sun = new THREE.DirectionalLight(theme.sun, theme.sunIntensity * 1.5);
  const shadows = settings().graphics !== 'low';
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap; // soft via shadow.radius (PCFSoft was removed upstream)
  sun.castShadow = shadows;
  const mapSize = settings().graphics === 'high' ? 2048 : 1024;
  sun.shadow.mapSize.set(mapSize, mapSize);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, far: 220 });
  scene.add(sun, sun.target);
  camera.far = theme.fogFar * 3.2 + 120;
  camera.add(audio.listener);
  scene.add(camera);
  const sky = createSky(theme, SUN_OFFSET, { radius: camera.far * 0.85, mesas: arena.def.horizon !== 'none', dome: false, haze });
  scene.add(sky.group);
  if (arena.def.walls !== false) {
    const ring = outskirts(arena.halfSize, 0xc8b49a, TILE[theme.surfaces.ground]);
    ring.userData.surface = theme.surfaces.ground;
    scene.add(ring);
  }
  applySurfaces(scene);
  const post = createPost(renderer, scene, camera, settings().graphics);
  const resizePost = () => post.setSize(innerWidth, innerHeight);
  addEventListener('resize', resizePost);

  const fx = new Fx(scene);
  combat.particles = fx;
  const resizeFx = () => fx.resize(renderer.domElement.height, camera.fov);
  resizeFx();
  addEventListener('resize', resizeFx);
  const hud = new Hud();
  // Compile every shader now instead of on first sight mid-fight (avoids frame hitches).
  fx.explosion(new THREE.Vector3(0, -50, 0), 3, 0xffa040);
  renderer.compile(scene, camera);
  const survival = mode === 'survival' ? new Survival(match) : null;

  // --- audio + captions -----------------------------------------------------
  audio.playMusic(match.boss ? 'boss' : survival ? 'survival' : arena.def.id);
  let gunTick = 0;
  combat.onSound = (kind, at, by) => {
    if (kind === 'hit') return by === player && audio.sfx('hit');
    if (kind === 'gun' && by !== player && gunTick++ % 3) return; // thin out enemy gunfire (16-voice cap)
    audio.sfx(kind, by === player && kind === 'gun' ? undefined : at, 1, 1);
  };
  match.onFeed = (text, v) => {
    if (v === null || v === player) hud.feed(text);
    if (v && v === player) audio.sfx('pickup');
  };
  match.onKill = (victim, killer) => {
    if (!player) return;
    if (victim === player && killer && killer !== player) hud.caption(killer.def.driver, killer.def.taunts.kill);
    else if (killer === player && victim !== player) hud.caption(victim.def.driver, victim.def.taunts.wrecked);
  };
  hud.feed(`${arena.def.name}${arena.event ? ` · ${arena.event.name}` : ''}`);
  if (match.boss) hud.caption(match.boss.def.driver, 'So you made it to the top. Let\'s see what you\'re worth.');

  // --- camera focus (spectate cycles with Tab) -------------------------------
  let focus: Vehicle = player ?? match.vehicles[0];
  combat.focus = focus;
  const onTab = (e: KeyboardEvent) => {
    if (e.code !== 'Tab' || player) return;
    e.preventDefault();
    const list = match.vehicles.filter((v) => !match.eliminated.has(v));
    focus = combat.focus = list[(list.indexOf(focus) + 1) % list.length] ?? focus;
  };
  addEventListener('keydown', onTab);

  const camPos = new THREE.Vector3().copy(focus.position).add(new THREE.Vector3(-10, 5, 0));
  const tmpFwd = new THREE.Vector3();
  const updateCamera = (dt: number) => {
    const car = focus;
    tmpFwd.set(1, 0, 0).applyQuaternion(car.mesh.quaternion).setY(0);
    if (tmpFwd.lengthSq() < 1e-4) tmpFwd.set(1, 0, 0);
    tmpFwd.normalize();
    const back = 7 + car.def.half.x;
    const target = car.mesh.position.clone().addScaledVector(tmpFwd, -back).setY(car.mesh.position.y + 3 + car.def.half.y);
    camPos.lerp(target, 1 - Math.exp(-6 * dt));
    camera.position.copy(camPos);
    if (combat.shake > 0 && settings().shake) camera.position.add(new THREE.Vector3().randomDirection().multiplyScalar(combat.shake * 0.6));
    camera.lookAt(car.mesh.position.clone().addScaledVector(tmpFwd, 4).setY(car.mesh.position.y + 1));
    const speedFov = 70 + Math.min(Math.abs(car.speed), 40) * 0.25;
    camera.fov += (speedFov - camera.fov) * (1 - Math.exp(-4 * dt));
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    sun.position.copy(car.mesh.position).add(SUN_OFFSET);
    sun.target.position.copy(car.mesh.position);
    sky.follow(camera);
  };

  // --- per-car effects: skids, dust, damage smoke, burning wrecks -------------
  const dustColor = theme.dust ?? 0xb89a72;
  const lastSkid = new Map<Vehicle, (THREE.Vector3 | null)[]>();
  const vehicleEffects = () => {
    for (const v of match.vehicles) {
      if (!v.alive) {
        lastSkid.delete(v);
        if (v.deadTime < RESPAWN_DELAY) {
          if (Math.random() < 0.5) fx.smoke(v.position);
          if (Math.random() < 0.4) fx.fire(v.position, 1.5);
        }
        continue;
      }
      if (v.hp < v.maxHp * 0.35 && Math.random() < 0.25) fx.smoke(v.local(v.def.half.x * 0.5, v.def.half.y, 0), v.hp < v.maxHp * 0.15);
      const lv = v.body.linvel();
      const right = RIGHT.clone().applyQuaternion(v.rotation);
      const lateral = Math.abs(lv.x * right.x + lv.z * right.z);
      const speed = Math.hypot(lv.x, lv.z);
      const sliding = v.grounded && (lateral > 4 || (!!v.prevInput?.handbrake && speed > 8));
      const rear = wheelLayout(v.def).filter(([, , front]) => !front);
      const prev = lastSkid.get(v) ?? [];
      const now = rear.map(([x, z]) => (sliding ? v.local(x, wheelY(v.def) - v.def.wheelR + 0.04, z) : null));
      now.forEach((p, i) => {
        const q = prev[i];
        if (p && q && p.distanceTo(q) > 0.25 && p.distanceTo(q) < 4) fx.skids.add(p.clone().lerp(q, 0.5), p.clone().sub(q), p.distanceTo(q));
        if (p && Math.random() < 0.35) fx.dust(p, dustColor);
      });
      if (v.grounded && !sliding && speed > 22 && Math.random() < 0.2) fx.dust(v.local(-v.def.half.x, -v.def.half.y, 0), dustColor);
      lastSkid.set(v, now.map((p, i) => (p && prev[i] && p.distanceTo(prev[i]!) <= 0.25 ? prev[i] : p)));
    }
  };

  /** Enemy in the top bar: in our sights, else whoever hit us last, else the nearest. */
  const hudFoe = (me: Vehicle) => {
    const inSights = combat.closestInCone(me, me.position, me.forward(), 0.5, 150);
    if (inSights) return inSights;
    if (me.lastAttacker?.alive && me.lastHitAgo < 5) return me.lastAttacker;
    let nearest: Vehicle | null = null;
    for (const e of match.vehicles) if (e !== me && e.alive && (!nearest || e.position.distanceTo(me.position) < nearest.position.distanceTo(me.position))) nearest = e;
    return nearest;
  };

  const status = () => {
    if (!player) return `Watching ${focus.name} · ${match.bots.find((b) => b.v === focus)?.state ?? ''} · Tab to switch`;
    if (survival) return `Wave ${survival.wave} · ${survival.score} pts`;
    return `Opponents left ${match.contenders().filter((v) => v !== player).length}`;
  };

  // --- loop -----------------------------------------------------------------
  const speedEl = document.getElementById('speed')!;
  const fpsEl = document.getElementById('fps')!;
  const warnEl = document.getElementById('warn')!;
  const clock = new THREE.Timer();
  let acc = 0;
  let frames = 0;
  let fpsTime = 0;
  let paused = false;
  let endTimer = -1;
  let prevHorn = false;
  let prevStart = true;
  renderer.info.autoReset = false;

  return new Promise<PlayResult>((resolve) => {
    const finish = (quit: boolean, restart = false) => {
      renderer.setAnimationLoop(null);
      removeEventListener('keydown', onKey);
      removeEventListener('keydown', onTab);
      removeEventListener('resize', resizeFx);
      removeEventListener('resize', resizePost);
      post.dispose();
      audio.setEngine(null);
      camera.remove(audio.listener);
      warnEl.textContent = '';
      document.getElementById('msg')!.innerHTML = '';
      document.getElementById('caption')!.style.opacity = '0';
      for (const a of document.querySelectorAll<HTMLElement>('#arrows .arrow')) a.style.display = 'none';
      resolve({ result: match.result, quit, restart, match, survival });
      dispose(scene);
      match.world.free();
    };

    const pause = async () => {
      if (paused || endTimer >= 0) return;
      paused = true;
      audio.setEngine(null);
      for (;;) {
        const pick = await menus.choose('PAUSED', [
          { label: 'Resume', value: 'resume' },
          { label: 'Settings', value: 'settings' },
          { label: 'Restart', value: 'restart' },
          { label: 'Quit to menu', value: 'quit' },
        ], { back: 'resume' });
        if (pick === 'settings') {
          await menus.settings(app.settings, () => app.applySettings());
          continue;
        }
        if (pick === 'quit') return finish(true);
        if (pick === 'restart') return finish(true, true);
        break;
      }
      clock.update(); // don't count the pause as frame time
      paused = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape' && !menus.isOpen) pause();
      if (e.code === 'KeyP' && !menus.isOpen) {
        app.settings.retro = !app.settings.retro;
        app.applySettings();
      }
    };
    addEventListener('keydown', onKey);

    renderer.setAnimationLoop(() => {
      clock.update();
      const dt = Math.min(clock.getDelta(), 0.1);
      const pad = firstGamepad();
      const start = !!pad?.buttons[9]?.pressed; // Options/Start pauses
      if (start && !prevStart) pause();
      prevStart = start;

      let input: DriveInput | null = null;
      if (!paused) {
        acc += dt;
        input = readInput(keys, pad, app.settings.bindings);
        while (acc >= STEP) {
          match.step(STEP, input);
          survival?.update(STEP);
          acc -= STEP;
        }
        if (match.result && endTimer < 0) {
          endTimer = END_DELAY;
          audio.sfx(match.result.won || (!player && match.result.winner) ? 'win' : 'lose');
          hud.feed(match.result.won ? 'VICTORY' : player ? (survival ? 'GAME OVER' : 'DEFEATED') : `${match.result.winner?.name ?? 'Nobody'} wins`);
        }
        if (endTimer >= 0 && (endTimer -= dt) <= 0) return finish(false);
      }
      if (player && input && !paused) {
        if (input.horn && !prevHorn) audio.sfx('horn', undefined, 1, 1.3 - Math.min(0.6, player.body.mass() / 3000));
        prevHorn = input.horn;
        audio.setEngine(player.alive ? player.speed : null, input.throttle);
      }

      match.vehicles.forEach((v) => v.render(acc / STEP));
      if (!paused) {
        vehicleEffects();
        fx.update(dt);
      }
      hud.update(dt, {
        me: focus,
        foe: hudFoe(focus),
        enemies: match.vehicles.filter((v) => v !== focus),
        boss: match.boss,
        pickups: match.pickups.available(),
        camera,
        respawnIn: RESPAWN_DELAY - focus.deadTime,
        lives: match.lives.get(focus) ?? Infinity,
        status: status(),
      });
      updateCamera(dt);
      renderer.info.reset();
      if (retro.enabled) retro.render(renderer, scene, camera);
      else post.render();

      const lim = arena.halfSize - 12;
      const nearEdge = focus.alive && (Math.abs(focus.position.x) > lim || Math.abs(focus.position.z) > lim);
      warnEl.textContent = nearEdge ? (arena.def.walls === false ? 'EDGE!' : 'TURN BACK') : '';
      frames++;
      fpsTime += dt;
      if (fpsTime >= 0.5) {
        const { calls, triangles } = renderer.info.render;
        fpsEl.textContent = `${Math.round(frames / fpsTime)} fps · ${calls} draws · ${Math.round(triangles / 1000)}k tris`;
        frames = fpsTime = 0;
      }
      speedEl.textContent = String(Math.round(Math.abs(focus.speed) * 3.6));
    });

    // Exposed for debugging / automated smoke checks.
    Object.assign(window, { __game: { match, car: player, vehicles: match.vehicles, combat, survival, finish } });
  });
}

/** Free GPU resources of a finished match. Shared model geometry is simply re-uploaded if used again. */
function dispose(scene: THREE.Scene) {
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) mat.dispose();
  });
  scene.clear();
}
