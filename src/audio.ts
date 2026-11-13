import * as THREE from 'three';

// Spec §9 audio, fully procedural (no asset files): an original synth-funk / desert-rock loop per arena, menu
// and boss from a tiny seeded sequencer, plus synthesized SFX. Positional SFX via PannerNodes on the
// camera's AudioListener, capped at 16 voices.

export type TrackId = 'menu' | 'boss' | 'survival' | 'results' | string; // string = arena id

interface Track {
  bpm: number;
  root: number; // MIDI note of the key
  scale: number[];
  seed: number;
  lead: boolean;
}

const MINOR_PENT = [0, 3, 5, 7, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const MIXO = [0, 2, 4, 5, 7, 9, 10];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
const HARM_MINOR = [0, 2, 3, 5, 7, 8, 11];

const TRACKS: Record<string, Track> = {
  menu: { bpm: 92, root: 45, scale: MINOR_PENT, seed: 11, lead: false },
  results: { bpm: 96, root: 43, scale: DORIAN, seed: 5, lead: false },
  survival: { bpm: 126, root: 47, scale: MINOR_PENT, seed: 23, lead: true },
  boss: { bpm: 140, root: 45, scale: HARM_MINOR, seed: 31, lead: true },
  'saguaro-junction': { bpm: 112, root: 40, scale: MIXO, seed: 3, lead: true },
  'copper-canyon': { bpm: 104, root: 38, scale: DORIAN, seed: 7, lead: true },
  'las-vistas': { bpm: 118, root: 42, scale: MINOR_PENT, seed: 13, lead: true },
  'hoover-spillway': { bpm: 100, root: 43, scale: DORIAN, seed: 17, lead: false },
  'roswell-airfield': { bpm: 120, root: 48, scale: MINOR_PENT, seed: 19, lead: true },
  'painted-mesa': { bpm: 108, root: 40, scale: PHRYGIAN, seed: 29, lead: true },
  'penthouse-lot': { bpm: 140, root: 45, scale: HARM_MINOR, seed: 31, lead: true },
};

const midiHz = (n: number) => 440 * 2 ** ((n - 69) / 12);

function rng(seed: number) {
  let s = seed * 9301 + 49297;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}

/** 4-bar, 16-step-per-bar patterns generated from the track seed. */
function patterns(t: Track) {
  const r = rng(t.seed);
  const steps = 64;
  const kick = Array.from({ length: steps }, (_, i) => i % 16 === 0 || i % 16 === 8 || (i % 16 === 10 && r() < 0.5) || (i % 16 === 14 && r() < 0.3));
  const snare = Array.from({ length: steps }, (_, i) => i % 16 === 4 || i % 16 === 12 || (i === 63 && r() < 0.6));
  const hat = Array.from({ length: steps }, (_, i) => (i % 2 === 0 ? 1 : r() < 0.35 ? 0.5 : 0));
  const prog = [0, 0, Math.floor(r() * 3) + 3, Math.floor(r() * 2) + 4].map((d) => t.scale[d % t.scale.length] + (d >= t.scale.length ? 12 : 0));
  const rhythm = Array.from({ length: 16 }, (_, i) => i % 4 === 0 || r() < 0.35);
  const bass = Array.from({ length: steps }, (_, i) => (rhythm[i % 16] ? t.root - 12 + prog[Math.floor(i / 16)] + (i % 8 === 6 && r() < 0.4 ? 12 : 0) : null));
  const lead = Array.from({ length: steps }, (_, i) =>
    t.lead && Math.floor(i / 16) % 2 === 1 && i % 2 === 0 && r() < 0.7 ? t.root + 12 + t.scale[Math.floor(r() * t.scale.length)] + prog[Math.floor(i / 16)] : null,
  );
  return { kick, snare, hat, bass, lead };
}

export type Sfx = 'gun' | 'launch' | 'explode' | 'hit' | 'pickup' | 'laser' | 'horn' | 'click' | 'win' | 'lose';
const MAX_VOICES = 16;

type EngineLayer = { osc: OscillatorNode; filter: BiquadFilterNode; gain: GainNode };

/** Top speed (m/s) of each virtual gear. */
export const GEARS = [8, 15, 23, 32, 44];

/** Engine RPM 0..1 and gear for a ground speed. RPM drops at each upshift, like a real gearbox. */
export function engineRpm(speed: number, throttle: number) {
  const gear = GEARS.findIndex((top) => speed < top);
  const g = gear < 0 ? GEARS.length - 1 : gear;
  const lo = g === 0 ? 0 : GEARS[g - 1];
  const x = Math.min(1, (speed - lo) / (GEARS[g] - lo));
  const rpm = g === 0 ? 0.15 + 0.85 * x : 0.35 + 0.65 * x;
  return { gear: g, rpm: Math.max(rpm, 0.15 + 0.3 * throttle * (g === 0 ? 1 : 0)) }; // revs on the spot
}

export class GameAudio {
  readonly listener = new THREE.AudioListener();
  private readonly ctx: AudioContext;
  private readonly musicGain: GainNode;
  private readonly sfxGain: GainNode;
  private readonly noise: AudioBuffer;
  private voices = 0;
  /** Debug counters (smoke checks). */
  readonly stats = { sfx: 0, notes: 0 };
  private timer: ReturnType<typeof setInterval> | null = null;
  private track: string | null = null;
  private engine: { out: GainNode; idle: EngineLayer; mid: EngineLayer; high: EngineLayer; detune: OscillatorNode } | null = null;

  constructor() {
    this.ctx = this.listener.context as AudioContext;
    this.musicGain = this.ctx.createGain();
    this.sfxGain = this.ctx.createGain();
    this.musicGain.connect(this.listener.getInput());
    this.sfxGain.connect(this.listener.getInput());
    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // Browsers start audio suspended until the first user gesture (spec §9).
    const unlock = () => this.ctx.state !== 'running' && this.ctx.resume();
    for (const e of ['keydown', 'mousedown', 'touchstart', 'gamepadconnected']) addEventListener(e, unlock);
  }

  setVolumes(music: number, sfx: number) {
    this.musicGain.gain.value = music * 0.5;
    this.sfxGain.gain.value = sfx;
  }

  // --- music --------------------------------------------------------------
  playMusic(id: TrackId) {
    if (this.track === id) return;
    this.stopMusic();
    const t = TRACKS[id] ?? TRACKS.menu;
    this.track = id;
    const p = patterns(t);
    const stepDur = 60 / t.bpm / 4;
    let step = 0;
    let next = this.ctx.currentTime + 0.1;
    // Lookahead scheduler: queue notes ~120 ms ahead on the audio clock.
    this.timer = setInterval(() => {
      while (next < this.ctx.currentTime + 0.12) {
        const i = step % 64;
        this.stats.notes++;
        if (p.kick[i]) this.kick(next);
        if (p.snare[i]) this.snare(next);
        if (p.hat[i]) this.hat(next, p.hat[i] as number);
        if (p.bass[i] !== null) this.tone(next, midiHz(p.bass[i]!), 'sawtooth', stepDur * 1.6, 0.16, 500);
        if (p.lead[i] !== null) this.tone(next, midiHz(p.lead[i]!), 'square', stepDur * 0.9, 0.05, 2400);
        next += stepDur * (i % 2 ? 0.92 : 1.08); // a little swing
        step++;
      }
    }, 25);
  }

  stopMusic() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.track = null;
  }

  private env(at: number, peak: number, dur: number, dest: AudioNode = this.musicGain) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    g.connect(dest);
    return g;
  }

  private kick(at: number) {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(150, at);
    o.frequency.exponentialRampToValueAtTime(45, at + 0.12);
    o.connect(this.env(at, 0.5, 0.25));
    o.start(at);
    o.stop(at + 0.3);
  }

  private noiseHit(at: number, type: BiquadFilterType, freq: number, peak: number, dur: number, dest?: AudioNode) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    src.connect(f).connect(this.env(at, peak, dur, dest));
    src.start(at, Math.random() * 0.5);
    src.stop(at + dur + 0.05);
    return { src, f };
  }

  private snare(at: number) {
    this.noiseHit(at, 'bandpass', 1800, 0.25, 0.15);
    this.tone(at, 190, 'triangle', 0.08, 0.15);
  }

  private hat(at: number, level: number) {
    this.noiseHit(at, 'highpass', 7500, 0.08 * level, level < 1 ? 0.12 : 0.04);
  }

  private tone(at: number, hz: number, type: OscillatorType, dur: number, peak: number, cutoff = 4000, dest?: AudioNode) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = hz;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, at);
    f.frequency.exponentialRampToValueAtTime(Math.max(80, cutoff * 0.3), at + dur);
    o.connect(f).connect(this.env(at, peak, dur, dest));
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  // --- sound effects ------------------------------------------------------
  /** One-shot SFX; positional when `at` is given (spec §9: 3D audio for enemies, ≤ 16 voices). */
  sfx(kind: Sfx, at?: THREE.Vector3, size = 1, pitch = 1) {
    if (this.ctx.state !== 'running' || this.voices >= MAX_VOICES) return;
    let out: AudioNode = this.sfxGain;
    if (at) {
      const p = this.ctx.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = 8;
      p.maxDistance = 250;
      p.positionX.value = at.x;
      p.positionY.value = at.y;
      p.positionZ.value = at.z;
      p.connect(this.sfxGain);
      out = p;
    }
    const t = this.ctx.currentTime;
    const dur = { gun: 0.06, launch: 0.4, explode: 0.9, hit: 0.05, pickup: 0.35, laser: 0.5, horn: 0.45, click: 0.04, win: 1.2, lose: 1.2 }[kind];
    this.voices++;
    this.stats.sfx++;
    setTimeout(() => this.voices--, dur * 1000 + 60);
    switch (kind) {
      case 'gun':
        this.noiseHit(t, 'bandpass', 1400 * pitch, 0.35, 0.06, out);
        break;
      case 'launch': {
        const { f } = this.noiseHit(t, 'bandpass', 400, 0.4, 0.4, out);
        f.frequency.exponentialRampToValueAtTime(2200, t + 0.35);
        break;
      }
      case 'explode': {
        const { f } = this.noiseHit(t, 'lowpass', 1200, Math.min(1, 0.4 + size * 0.06), 0.9, out);
        f.frequency.exponentialRampToValueAtTime(90, t + 0.8);
        this.tone(t, 55, 'sine', 0.5, Math.min(0.9, 0.3 + size * 0.05), 400, out);
        break;
      }
      case 'hit':
        this.tone(t, 1500, 'square', 0.05, 0.12, 6000, out);
        break;
      case 'pickup':
        this.tone(t, 880, 'sine', 0.15, 0.25, 6000, out);
        this.tone(t + 0.1, 1320, 'sine', 0.25, 0.25, 6000, out);
        break;
      case 'laser': {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(1400, t);
        o.frequency.exponentialRampToValueAtTime(180, t + 0.45);
        o.connect(this.env(t, 0.3, 0.5, out));
        o.start(t);
        o.stop(t + 0.55);
        break;
      }
      case 'horn':
        this.tone(t, 330 * pitch, 'square', 0.45, 0.15, 1800, out);
        this.tone(t, 415 * pitch, 'square', 0.45, 0.12, 1800, out);
        break;
      case 'click':
        this.tone(t, 900, 'triangle', 0.04, 0.12, 4000, out);
        break;
      case 'win':
        [0, 4, 7, 12].forEach((n, i) => this.tone(t + i * 0.12, midiHz(64 + n), 'square', 0.4, 0.12, 3000, out));
        break;
      case 'lose':
        [7, 3, 0, -5].forEach((n, i) => this.tone(t + i * 0.18, midiHz(57 + n), 'triangle', 0.5, 0.18, 2000, out));
        break;
    }
  }

  /**
   * Player engine (AAA_PLAN §3.6): a virtual gearbox drives RPM, and three synth layers (idle rumble,
   * mid growl, high whine) crossfade by RPM. Heavier cars sit lower. Pass null to silence.
   */
  setEngine(speed: number | null, throttle = 0, mass = 1500) {
    if (speed === null || this.ctx.state !== 'running') {
      this.engine?.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
      return;
    }
    const c = this.ctx;
    if (!this.engine) {
      const out = c.createGain();
      out.gain.value = 0;
      out.connect(this.sfxGain);
      const layer = (type: OscillatorType, filterType: BiquadFilterType, q = 0.7) => {
        const osc = c.createOscillator();
        osc.type = type;
        const filter = c.createBiquadFilter();
        filter.type = filterType;
        filter.Q.value = q;
        const gain = c.createGain();
        gain.gain.value = 0;
        osc.connect(filter).connect(gain).connect(out);
        osc.start();
        return { osc, filter, gain };
      };
      const high = layer('sawtooth', 'bandpass', 1.5);
      const detune = c.createOscillator(); // second whine voice, slightly detuned for width
      detune.type = 'sawtooth';
      detune.detune.value = 7;
      detune.connect(high.filter);
      detune.start();
      this.engine = { out, idle: layer('square', 'lowpass'), mid: layer('sawtooth', 'lowpass'), high, detune };
    }
    const e = this.engine;
    const t = c.currentTime;
    const { rpm } = engineRpm(Math.abs(speed), throttle);
    const pitch = Math.min(1.35, Math.max(0.75, 1400 / mass));
    const f = (30 + rpm * 110) * pitch;
    const idle = Math.max(0, 1 - rpm / 0.45);
    const high = Math.min(1, Math.max(0, (rpm - 0.55) / 0.35));
    const mid = Math.max(0, 1 - idle - high);
    const set = (p: AudioParam, v: number, k = 0.04) => p.setTargetAtTime(v, t, k);
    set(e.idle.osc.frequency, f / 2);
    set(e.idle.filter.frequency, 220);
    set(e.idle.gain.gain, idle * 0.9);
    set(e.mid.osc.frequency, f);
    set(e.mid.filter.frequency, 350 + throttle * 900 + rpm * 400);
    set(e.mid.gain.gain, mid * 0.8);
    set(e.high.osc.frequency, f * 2);
    set(e.detune.frequency, f * 2);
    set(e.high.filter.frequency, f * 4);
    set(e.high.gain.gain, high * 0.5);
    set(e.out.gain, 0.05 + throttle * 0.06, 0.08); // load: louder on throttle
  }

}
