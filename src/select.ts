import * as THREE from 'three';
import { stats, type VehicleDef } from './data/vehicles';
import { buildVehicleMesh } from './vehicle';
import { firstGamepad } from './input';
import type { Difficulty } from './ai';
import { ARENAS } from './data/arenas';

export type Mode = 'campaign' | 'deathmatch' | 'survival';

export interface MatchSetup {
  def: VehicleDef;
  bots: number;
  difficulty: Difficulty;
  spectate: boolean;
  arena: string; // ArenaDef id
}
const SETTINGS_KEY = 'blacktop.settings';
const STAT_MAX = 5;

/** A lit floor + slowly spinning vehicle; used by vehicle select and the ending card. */
export function createTurntable(skyColor: number) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(skyColor);
  scene.fog = new THREE.Fog(skyColor, 20, 60);
  scene.add(new THREE.HemisphereLight(0xffe2b8, 0x7a4a2c, 1.4));
  const sun = new THREE.DirectionalLight(0xfff0d0, 2.2);
  sun.position.set(5, 10, 4);
  sun.castShadow = true;
  scene.add(sun);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(8, 48), new THREE.MeshLambertMaterial({ color: 0xc98b5a }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 100);
  const spinner = new THREE.Group();
  scene.add(spinner);
  return {
    show(def: VehicleDef) {
      spinner.clear();
      const mesh = buildVehicleMesh(def);
      mesh.position.y = def.half.y + 0.45; // wheels on the floor
      spinner.add(mesh);
      const d = 5 + def.half.x * 2.2;
      camera.position.set(d * 0.9, d * 0.45, d * 0.9);
      camera.lookAt(0, 0.8, 0);
    },
    render(renderer: THREE.WebGLRenderer, t: number) {
      spinner.rotation.y = t * 0.0006;
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    },
  };
}

/** Vehicle select: card grid + 3D turntable. Resolves with the setup, or null if the player backs out (Esc / B). */
export function chooseVehicle(renderer: THREE.WebGLRenderer, skyColor: number, mode: Mode, roster: VehicleDef[]): Promise<MatchSetup | null> {
  const root = document.getElementById('select')!;
  const grid = root.querySelector<HTMLElement>('.roster')!;
  const detail = root.querySelector<HTMLElement>('.detail')!;
  const botsEl = root.querySelector<HTMLSelectElement>('#opt-bots')!;
  const diffEl = root.querySelector<HTMLSelectElement>('#opt-difficulty')!;
  const spectateEl = root.querySelector<HTMLInputElement>('#opt-spectate')!;
  const arenaEl = root.querySelector<HTMLSelectElement>('#opt-arena')!;
  root.querySelector('h1')!.textContent = { campaign: 'CAMPAIGN · CHOOSE YOUR DRIVER', deathmatch: 'DEATHMATCH · CHOOSE YOUR RIDE', survival: 'SURVIVAL · CHOOSE YOUR RIDE' }[mode];
  // Only show the options that apply to this mode.
  const show = (el: HTMLElement, on: boolean) => ((el.closest('label') as HTMLElement).hidden = !on);
  show(arenaEl, mode !== 'campaign');
  show(botsEl, mode === 'deathmatch');
  show(diffEl, mode === 'deathmatch');
  show(spectateEl, mode === 'deathmatch');
  arenaEl.innerHTML = '<option value="random">Random</option>' + ARENAS.map((a) => `<option value="${a.id}">${a.name}</option>`).join('');
  // Remembered per browser; a convenience only, so failures are ignored.
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    botsEl.value = String(saved.bots ?? 3);
    diffEl.value = saved.difficulty ?? 'normal';
    spectateEl.checked = !!saved.spectate;
    arenaEl.value = ARENAS.some((a) => a.id === saved.arena) ? saved.arena : 'random';
  } catch {
    botsEl.value = '3';
  }
  document.body.classList.add('selecting');
  root.hidden = false;

  const table = createTurntable(skyColor);
  let index = 0;
  const select = (i: number) => {
    index = (i + roster.length) % roster.length;
    const def = roster[index];
    table.show(def);
    [...grid.children].forEach((c, j) => c.setAttribute('aria-selected', String(j === index)));
    (grid.children[index] as HTMLElement).focus({ preventScroll: true });
    const s = stats(def);
    const pips = (n: number) => '■'.repeat(n) + '□'.repeat(STAT_MAX - n);
    detail.innerHTML = `
      <h2>${def.name}</h2>
      <div class="cls">${def.cls} · ${def.driver}</div>
      <p>${def.bio}</p>
      <table>
        <tr><td>Armor</td><td class="pips">${pips(def.armor)}</td><td>${Math.round(s.maxHp)} HP</td></tr>
        <tr><td>Speed</td><td class="pips">${pips(def.speed)}</td><td>${Math.round(s.topSpeed * 3.6)} km/h</td></tr>
        <tr><td>Handling</td><td class="pips">${pips(def.handling)}</td><td></td></tr>
      </table>
      <h3>Special · ${def.abilityName}</h3>
      <p>${def.abilityDesc}</p>
      <div class="go">Enter / Ⓐ to drive · Esc / Ⓑ back</div>`;
  };

  grid.innerHTML = roster
    .map((d, i) => `<button role="option" data-i="${i}" style="--c:#${d.color.toString(16).padStart(6, '0')}"><b>${d.name}</b><span>${d.cls}</span></button>`)
    .join('');
  select(0);

  return new Promise((resolve) => {
    let padPrev: boolean[] = [true, true, true, true, true, true]; // ignore buttons still held from the menu
    const close = (picked: boolean) => {
      removeEventListener('keydown', onKey);
      grid.removeEventListener('click', onClick);
      root.hidden = true;
      document.body.classList.remove('selecting');
      renderer.setAnimationLoop(null);
      if (!picked) return resolve(null);
      const themed = ARENAS.filter((a) => a.id !== 'proving-ground');
      const arena = arenaEl.value === 'random' ? themed[Math.floor(Math.random() * themed.length)].id : arenaEl.value;
      const setup = { def: roster[index], bots: Number(botsEl.value), difficulty: diffEl.value as Difficulty, spectate: mode === 'deathmatch' && spectateEl.checked, arena };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({ bots: setup.bots, difficulty: setup.difficulty, spectate: spectateEl.checked, arena: arenaEl.value }));
      } catch {
        /* storage unavailable: settings just aren't remembered */
      }
      resolve(setup);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') return close(false);
      const inForm = e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement;
      if (inForm && e.code !== 'Enter') return; // let selects/checkbox handle their own keys
      const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
      const moves: Record<string, number> = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1, ArrowUp: -cols, KeyW: -cols, ArrowDown: cols, KeyS: cols };
      if (e.code in moves) {
        e.preventDefault();
        select(index + moves[e.code]);
      } else if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        close(true);
      }
    };
    const onClick = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest('button');
      if (!btn) return;
      const i = Number(btn.dataset.i);
      if (i === index) close(true); // second click on the selected card starts
      else select(i);
    };
    addEventListener('keydown', onKey);
    grid.addEventListener('click', onClick);

    renderer.setAnimationLoop((t) => {
      // Gamepad: d-pad to browse, A to pick, B to go back.
      const pad = firstGamepad();
      if (pad) {
        const now = [12, 13, 14, 15, 0, 1].map((b) => !!pad.buttons[b]?.pressed);
        const pressed = (k: number) => now[k] && !padPrev[k];
        const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
        if (pressed(0)) select(index - cols);
        if (pressed(1)) select(index + cols);
        if (pressed(2)) select(index - 1);
        if (pressed(3)) select(index + 1);
        if (pressed(4)) return close(true);
        if (pressed(5)) return close(false);
        padPrev = now;
      }
      table.render(renderer, t);
    });
  });
}
