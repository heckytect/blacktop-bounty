// AAA_PLAN §3.1: every hit is felt on screen (trauma shake), in time (hit-stop / slow-mo) and in the hands (rumble).
// All timers run on real time so shake keeps decaying while the simulation is frozen by a hit-stop.

export type Tier = 'small' | 'medium' | 'large';

export const TIERS: Record<Tier, { trauma: number; stop: number; slow: number; rumble: [number, number, number] }> = {
  //       trauma  hit-stop (s)  slow-mo (s, 0.3×)  rumble [strong, weak, ms]
  small: { trauma: 0.1, stop: 0, slow: 0, rumble: [0.1, 0.3, 60] },
  medium: { trauma: 0.35, stop: 0.04, slow: 0, rumble: [0.4, 0.6, 120] },
  large: { trauma: 0.8, stop: 0.11, slow: 0.15, rumble: [1, 1, 300] },
};

const STOP_SCALE = 0.05;
const SLOW_SCALE = 0.3;
const DECAY = 1.2; // trauma lost per real second
const MAX_OFFSET = 0.35; // m
const MAX_ROLL = (1.5 * Math.PI) / 180;

/** Tier for `amount` damage on a car with `maxHp`. */
export function tierFor(amount: number, maxHp: number, killed: boolean): Tier {
  if (killed) return 'large';
  const f = amount / maxHp;
  return f >= 0.15 ? 'large' : f >= 0.04 ? 'medium' : 'small';
}

export class Feel {
  trauma = 0;
  private stop = 0;
  private slow = 0;
  private t = 0;
  /** Player settings, 0..1. */
  shake = 1;
  rumble = 1;
  /** Kill slow-mo is skipped under reduced motion. */
  slowMo = true;

  hit(tier: Tier, pad?: Gamepad | null) {
    const d = TIERS[tier];
    this.trauma = Math.min(1, this.trauma + d.trauma); // hits add, never reset
    this.stop = Math.max(this.stop, d.stop);
    if (this.slowMo) this.slow = Math.max(this.slow, d.slow);
    const [strong, weak, ms] = d.rumble;
    if (this.rumble > 0) pad?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong * this.rumble, weakMagnitude: weak * this.rumble }).catch(() => {});
  }

  addTrauma(amount: number) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Advance on real time; returns the simulation time scale for this frame. */
  update(dt: number) {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - DECAY * dt);
    if (this.stop > 0) {
      this.stop -= dt;
      return STOP_SCALE;
    }
    if (this.slow > 0) {
      this.slow -= dt;
      return SLOW_SCALE;
    }
    return 1;
  }

  /** Camera offset (camera-local x/y, m) and roll (rad). Summed sines at unrelated rates: smooth, never a per-frame buzz. */
  offset() {
    const s = this.trauma * this.trauma * this.shake;
    const t = this.t * 30;
    return { x: MAX_OFFSET * s * Math.sin(t * 1.7), y: MAX_OFFSET * s * Math.sin(t * 2.3 + 1), roll: MAX_ROLL * s * Math.sin(t * 1.1 + 2) };
  }
}
