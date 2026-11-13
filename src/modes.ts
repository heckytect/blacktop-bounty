import type { Difficulty } from './ai';
import type { Match, MatchOptions, MatchResult } from './game';
import { KINGPIN, VEHICLES, type VehicleDef } from './data/vehicles';

// Spec §3.1 modes. Pure rules; the menus and main loop drive them.

export interface Stage {
  arena: string;
  opponents: number;
  difficulty: Difficulty;
  boss?: boolean;
}

/** Campaign: 6 arenas in sequence, then the boss (spec §3.1). */
export const CAMPAIGN: Stage[] = [
  { arena: 'saguaro-junction', opponents: 3, difficulty: 'easy' },
  { arena: 'copper-canyon', opponents: 3, difficulty: 'normal' },
  { arena: 'las-vistas', opponents: 4, difficulty: 'normal' },
  { arena: 'hoover-spillway', opponents: 4, difficulty: 'normal' },
  { arena: 'roswell-airfield', opponents: 5, difficulty: 'hard' },
  { arena: 'painted-mesa', opponents: 5, difficulty: 'hard' },
  { arena: 'penthouse-lot', opponents: 0, difficulty: 'hard', boss: true },
];
export const PLAYER_LIVES = 3; // per arena (spec §3.2)
export const DEATHMATCH_LIVES = 3;

export type CampaignState = 'playing' | 'stage-won' | 'game-over' | 'complete';

export class Campaign {
  stage = 0;
  state: CampaignState = 'playing';

  constructor(
    readonly driver: VehicleDef,
    private readonly rand = Math.random,
  ) {}

  get current() {
    return CAMPAIGN[this.stage];
  }

  matchOptions(): MatchOptions {
    const s = this.current;
    const pool = VEHICLES.filter((d) => d.id !== this.driver.id);
    const botDefs = Array.from({ length: s.opponents }, () => pool.splice(Math.floor(this.rand() * pool.length), 1)[0]);
    return {
      playerDef: this.driver,
      botCount: botDefs.length,
      botDefs,
      difficulty: s.difficulty,
      arena: s.arena,
      boss: s.boss ? KINGPIN : undefined,
      lives: { player: PLAYER_LIVES, bots: 1 },
    };
  }

  /** Feed the finished match in; returns the new state. */
  finish(r: MatchResult): CampaignState {
    if (!r.won) return (this.state = 'game-over');
    this.stage++;
    if (this.stage < CAMPAIGN.length) return (this.state = 'stage-won');
    unlockKingpin();
    return (this.state = 'complete');
  }

  /** Game over → try the same arena again. */
  retry() {
    this.state = 'playing';
  }

  next() {
    this.state = 'playing';
  }
}

// --- Survival (spec §3.1: endless waves, score attack) ----------------------

export const waveDifficulty = (wave: number): Difficulty => (wave <= 2 ? 'easy' : wave <= 4 ? 'normal' : wave <= 7 ? 'hard' : 'brutal');
export const waveSize = (wave: number) => Math.min(wave + 1, 7);
const WAVE_GAP = 3; // s between a cleared wave and the next
const KILL_POINTS = 100;
const WAVE_POINTS = 250;

export class Survival {
  wave = 0;
  wavesCleared = 0;
  private gap = 0.5;

  constructor(
    private readonly match: Match,
    private readonly rand = Math.random,
  ) {}

  get score() {
    return (this.match.player?.kills ?? 0) * KILL_POINTS + this.wavesCleared * WAVE_POINTS;
  }

  /** Call every step: when the wave is wiped out, clear the wrecks and send the next one. */
  update(dt: number) {
    const m = this.match;
    const enemies = m.contenders().filter((v) => v !== m.player);
    if (enemies.length) return;
    this.gap -= dt;
    if (this.gap > 0) return;
    if (this.wave > 0) this.wavesCleared++;
    for (const v of [...m.vehicles]) if (v !== m.player && m.eliminated.has(v)) m.removeCar(v);
    this.wave++;
    this.gap = WAVE_GAP;
    const pool = VEHICLES.filter((d) => d.id !== m.player?.def.id);
    for (let i = 0; i < waveSize(this.wave); i++) {
      m.addBot(pool[Math.floor(this.rand() * pool.length)], waveDifficulty(this.wave), 1);
    }
    m.onFeed?.(`Wave ${this.wave}`, null);
  }
}

// --- Persistence: per-browser, so storage failures are ignored --------------

export interface ScoreEntry {
  score: number;
  wave: number;
  driver: string;
  date: string;
}

const memory = new Map<string, string>(); // fallback when localStorage is unavailable (private mode, tests)
function load(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}
function save(key: string, v: string) {
  memory.set(key, v);
  try {
    localStorage.setItem(key, v);
  } catch {
    /* kept in memory for this session */
  }
}

const BOARD_KEY = 'blacktop.survival';
export const LEADERBOARD_SIZE = 10;

/** Insert, sort, keep the top 10. Returns the board and the new entry's rank (-1 if it didn't place). */
export function addScore(board: ScoreEntry[], e: ScoreEntry) {
  const next = [...board, e].sort((a, b) => b.score - a.score).slice(0, LEADERBOARD_SIZE);
  return { board: next, rank: next.indexOf(e) };
}

export function leaderboard(): ScoreEntry[] {
  try {
    return JSON.parse(load(BOARD_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function recordScore(e: ScoreEntry) {
  const { board, rank } = addScore(leaderboard(), e);
  save(BOARD_KEY, JSON.stringify(board));
  return rank;
}

const UNLOCK_KEY = 'blacktop.kingpin';
export const kingpinUnlocked = () => load(UNLOCK_KEY) === '1';
export const unlockKingpin = () => save(UNLOCK_KEY, '1');
