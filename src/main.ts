import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createKeyboard } from './input';
import { chooseVehicle, createTurntable, type Mode } from './select';
import { ALL_VEHICLES, KINGPIN, VEHICLES, type VehicleDef } from './data/vehicles';
import { ARENAS } from './data/arenas';
import { loadVehicleModels } from './models';
import { RetroPass } from './post';
import { GameAudio } from './audio';
import { Menus, text } from './menus';
import { loadSettings, saveSettings } from './settings';
import { CAMPAIGN, Campaign, DEATHMATCH_LIVES, PLAYER_LIVES, kingpinUnlocked, leaderboard, recordScore } from './modes';
import { playMatch, type App } from './play';
import type { MatchOptions } from './game';

// Spec §11 flow: Title → Mode Select → Vehicle Select → (Arena) → Loading → Game → Results.

await RAPIER.init();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.domElement.setAttribute('role', 'img');
renderer.domElement.setAttribute('aria-label', 'Game view');
document.body.appendChild(renderer.domElement);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 400);
addEventListener('resize', () => renderer.setSize(innerWidth, innerHeight));

const app: App = {
  renderer,
  camera,
  audio: new GameAudio(),
  menus: new Menus(),
  retro: new RetroPass(),
  keys: createKeyboard(),
  settings: loadSettings(),
  applySettings() {
    const s = app.settings;
    app.audio.setVolumes(s.music, s.sfx);
    app.retro.enabled = s.retro;
    // Post-processing runs per pixel, so "high" caps density at 1.25× (SMAA handles the edges).
    renderer.setPixelRatio(s.graphics === 'high' ? Math.min(devicePixelRatio, 1.25) : 1);
    saveSettings(s);
  },
};
app.applySettings();
app.menus.onMove = () => app.audio.sfx('click');
Object.assign(window, { __app: app }); // debugging / smoke checks

const MENU_SKY = 0xe9a36b;
document.body.classList.add('in-menu');
await loadVehicleModels(ALL_VEHICLES.map((d) => d.id)); // Blender models; missing ones fall back to boxes

/** Spinning car behind the menus. */
function backdrop(def: VehicleDef = VEHICLES[Math.floor(Math.random() * VEHICLES.length)]) {
  const t = createTurntable(MENU_SKY);
  t.show(def);
  renderer.setAnimationLoop((ms) => t.render(renderer, ms));
}

const roster = () => (kingpinUnlocked() ? [...VEHICLES, KINGPIN] : VEHICLES);

// --- title ------------------------------------------------------------------
backdrop();
app.audio.playMusic('menu');
await app.menus.choose('BLACKTOP BOUNTY', [{ label: 'Press Enter / Ⓐ to start', value: 0 }], {
  subtitle: 'Vehicular combat in the 1970s Southwest. Last car running collects the bounty.',
  className: 'title',
});

for (;;) {
  backdrop();
  app.audio.playMusic('menu');
  const mode = await app.menus.choose<Mode | 'board' | 'settings'>(
    'BLACKTOP BOUNTY',
    [
      { label: 'Campaign', hint: '6 arenas + the boss', value: 'campaign' },
      { label: 'Deathmatch', hint: 'last car standing', value: 'deathmatch' },
      { label: 'Survival', hint: 'endless waves', value: 'survival' },
      { label: 'Leaderboard', value: 'board' },
      { label: 'Settings', value: 'settings' },
    ],
    { subtitle: kingpinUnlocked() ? 'Kingpin is unlocked in the garage.' : 'Clear the campaign to unlock the boss car.' },
  );
  if (mode === 'settings') await app.menus.settings(app.settings, () => app.applySettings());
  else if (mode === 'board') await showLeaderboard(null);
  else if (mode === 'campaign') await campaign();
  else if (mode === 'deathmatch') await deathmatch();
  else await survival();
}

// --- modes ------------------------------------------------------------------
async function campaign() {
  const setup = await chooseVehicle(renderer, MENU_SKY, 'campaign', roster());
  if (!setup) return;
  const c = new Campaign(setup.def);
  for (;;) {
    const stage = c.current;
    const arenaName = ARENAS.find((a) => a.id === stage.arena)!.name;
    await loading(`Arena ${c.stage + 1} of ${CAMPAIGN.length}`, stage.boss ? `${arenaName} · ${KINGPIN.driver} awaits` : `${arenaName} · ${stage.opponents} opponents · ${PLAYER_LIVES} lives`);
    const r = await playMatch(app, c.matchOptions(), 'campaign');
    if (r.restart) continue;
    if (r.quit || !r.result) return;
    const state = c.finish(r.result);
    backdrop(setup.def);
    if (state === 'complete') return ending(setup.def);
    if (state === 'stage-won') {
      const next = ARENAS.find((a) => a.id === c.current.arena)!.name;
      const go = await app.menus.choose('ARENA CLEARED', [{ label: `Continue to ${next}`, value: true }, { label: 'Quit to menu', value: false }], {
        subtitle: `${r.match.player!.kills} wrecks with ${r.match.lives.get(r.match.player!)} of ${PLAYER_LIVES} lives left.`,
        back: false,
      });
      if (!go) return;
      c.next();
    } else {
      app.audio.playMusic('results');
      const retry = await app.menus.choose('GAME OVER', [{ label: 'Retry this arena', value: true }, { label: 'Quit to menu', value: false }], {
        subtitle: `${arenaName} got the better of you.`,
        back: false,
      });
      if (!retry) return;
      c.retry();
    }
  }
}

async function deathmatch() {
  for (;;) {
    const setup = await chooseVehicle(renderer, MENU_SKY, 'deathmatch', roster());
    if (!setup) return;
    const opts: MatchOptions = {
      playerDef: setup.spectate ? null : setup.def,
      botCount: setup.bots,
      difficulty: setup.difficulty,
      arena: setup.arena,
      lives: { player: DEATHMATCH_LIVES, bots: DEATHMATCH_LIVES },
    };
    for (;;) {
      await loading('Deathmatch', `${ARENAS.find((a) => a.id === setup.arena)!.name} · ${setup.bots} opponents · ${DEATHMATCH_LIVES} lives each`);
      const r = await playMatch(app, opts, 'deathmatch');
      if (r.restart) continue;
      if (r.quit) return; // "Quit to menu" means the main menu
      backdrop(setup.def);
      app.audio.playMusic('results');
      const rows = [...r.match.vehicles]
        .filter((v) => !r.match.minions.has(v))
        .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
        .map((v) => `<tr class="${v === r.match.player ? 'me' : ''}"><td>${text(v.name)}</td><td>${text(v.def.name)}</td><td>${v.kills}</td><td>${v.deaths}</td></tr>`)
        .join('');
      const again = await app.menus.choose(
        r.result?.won ? 'VICTORY' : r.match.player ? 'DEFEATED' : `${r.result?.winner?.name ?? 'NOBODY'} WINS`,
        [{ label: 'Play again', value: 'again' }, { label: 'Change car / arena', value: 'change' }, { label: 'Quit to menu', value: 'menu' }],
        { body: `<table><tr><th>Driver</th><th>Car</th><th>Wrecks</th><th>Wrecked</th></tr>${rows}</table>`, back: 'menu' },
      );
      if (again === 'menu') return;
      if (again === 'change') break;
    }
  }
}

async function survival() {
  for (;;) {
    const setup = await chooseVehicle(renderer, MENU_SKY, 'survival', roster());
    if (!setup) return;
    for (;;) {
      await loading('Survival', `${ARENAS.find((a) => a.id === setup.arena)!.name} · waves until you drop · ${PLAYER_LIVES} lives`);
      const r = await playMatch(
        app,
        { playerDef: setup.def, botCount: 0, botDefs: [], difficulty: 'easy', arena: setup.arena, lives: { player: PLAYER_LIVES, bots: 1 }, endless: true },
        'survival',
      );
      if (r.restart) continue;
      if (r.quit) return; // "Quit to menu" means the main menu
      const s = r.survival!;
      const rank = recordScore({ score: s.score, wave: s.wave, driver: setup.def.driver, date: new Date().toLocaleDateString() });
      backdrop(setup.def);
      const again = await showLeaderboard(rank, `Wave ${s.wave} · ${s.score} points${rank >= 0 ? ` · #${rank + 1} on the board!` : ''}`);
      if (!again) return;
    }
  }
}

// --- screens ----------------------------------------------------------------
/** rank null = browsing from the menu; otherwise the result of a run just finished (-1 = didn't place). */
async function showLeaderboard(rank: number | null, subtitle = 'Best Survival runs on this device.') {
  app.audio.playMusic('results');
  const board = leaderboard();
  const rows = board.length
    ? board.map((e, i) => `<tr class="${i === rank ? 'me' : ''}"><td>${i + 1}</td><td>${e.score}</td><td>${e.wave}</td><td>${text(e.driver)}</td><td>${text(e.date)}</td></tr>`).join('')
    : '<tr><td colspan="5">No runs yet. Survive a wave or two!</td></tr>';
  const choices = rank === null ? [{ label: 'Back', value: false }] : [{ label: 'Play again', value: true }, { label: 'Quit to menu', value: false }];
  return app.menus.choose('LEADERBOARD', choices, { subtitle, body: `<table><tr><th>#</th><th>Score</th><th>Wave</th><th>Driver</th><th>Date</th></tr>${rows}</table>`, back: false });
}

/** Spec §5.2 ending card: the driver's car on the turntable + three sentences. */
async function ending(def: VehicleDef) {
  backdrop(def);
  app.audio.playMusic('results');
  app.audio.sfx('win');
  await app.menus.choose(def.driver.toUpperCase(), [{ label: 'Return to menu', value: 0 }], {
    subtitle: 'Champion of the Blacktop Bounty',
    body: `<p class="ending-text">${text(def.ending)}</p><p class="sub"><b>Kingpin unlocked:</b> the Proprietor's limo is now in your garage.</p>`,
    className: 'ending',
  });
}

/** Brief loading card while the arena builds (spec §11 Loading). */
async function loading(title: string, subtitle: string) {
  app.menus.close();
  const el = document.getElementById('menu')!;
  el.innerHTML = `<div class="panel"><h1>${text(title.toUpperCase())}</h1><p class="sub">${text(subtitle)}</p><p class="sub">Loading…</p></div>`;
  el.hidden = false;
  document.body.classList.add('in-menu');
  await new Promise((r) => setTimeout(r, 600)); // let the card paint before the synchronous arena build
  el.hidden = true;
  document.body.classList.remove('in-menu');
}
