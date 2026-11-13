import { describe, expect, it } from 'vitest';
import { Feel, tierFor } from '../src/feel';
import { engineRpm, GEARS } from '../src/audio';

describe('feel (AAA_PLAN §3.1)', () => {
  it('tiers by share of max HP; kills are always large', () => {
    expect(tierFor(2, 150, false)).toBe('small');
    expect(tierFor(15, 150, false)).toBe('medium');
    expect(tierFor(35, 150, false)).toBe('large');
    expect(tierFor(1, 150, true)).toBe('large');
  });

  it('hits add trauma, hit-stop slows the sim then releases, shake decays to rest', () => {
    const f = new Feel();
    f.hit('medium');
    f.hit('medium');
    expect(f.trauma).toBeCloseTo(0.7);
    expect(f.update(0.016)).toBeLessThan(0.1); // inside the 40 ms stop
    f.update(0.05);
    expect(f.update(0.016)).toBe(1);
    for (let i = 0; i < 120; i++) f.update(1 / 60);
    expect(f.trauma).toBe(0);
    const o = f.offset();
    expect(Math.abs(o.x) + Math.abs(o.y) + Math.abs(o.roll)).toBe(0);
  });

  it('kill slow-mo is skipped when slowMo is off (reduced motion)', () => {
    const f = new Feel();
    f.slowMo = false;
    f.hit('large');
    f.update(0.12); // past the hit-stop
    expect(f.update(0.016)).toBe(1);
  });
});

describe('engine gearbox (AAA_PLAN §3.6)', () => {
  it('RPM climbs within a gear and drops at each upshift', () => {
    for (let g = 0; g < GEARS.length - 1; g++) {
      const before = engineRpm(GEARS[g] - 0.01, 1);
      const after = engineRpm(GEARS[g] + 0.01, 1);
      expect(after.gear).toBe(g + 1);
      expect(before.rpm).toBeGreaterThan(0.95);
      expect(after.rpm).toBeLessThan(0.4);
    }
    expect(engineRpm(100, 1).rpm).toBe(1);
  });
});
