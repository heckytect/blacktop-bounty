using System;

namespace Blacktop
{
    public enum Tier { Small, Medium, Large }

    /// <summary>
    /// AAA_PLAN §4.1, ported 1:1 from src/feel.ts. Trauma shake, hit-stop and kill slow-mo.
    /// Pure C# (no UnityEngine) so EditMode tests run it directly; FeelRunner applies it to Time and the camera.
    /// All timers advance on real (unscaled) time so shake keeps decaying during a hit-stop.
    /// </summary>
    public sealed class Feel
    {
        public readonly struct TierDef
        {
            public readonly float Trauma, Stop, Slow, Strong, Weak, RumbleSeconds;
            public TierDef(float trauma, float stop, float slow, float strong, float weak, float rumbleSeconds)
            {
                Trauma = trauma; Stop = stop; Slow = slow; Strong = strong; Weak = weak; RumbleSeconds = rumbleSeconds;
            }
        }

        // Same numbers as TIERS in src/feel.ts (also exported to Data/game.json; DataTests checks they agree).
        public static readonly TierDef[] Tiers =
        {
            new TierDef(0.1f, 0f, 0f, 0.1f, 0.3f, 0.06f),     // Small
            new TierDef(0.35f, 0.04f, 0f, 0.4f, 0.6f, 0.12f), // Medium
            new TierDef(0.8f, 0.11f, 0.15f, 1f, 1f, 0.3f),    // Large
        };

        public const float StopScale = 0.05f;
        public const float SlowScale = 0.3f;
        const float Decay = 1.2f;                          // trauma lost per real second
        const float MaxOffset = 0.35f;                     // m
        const float MaxRoll = 1.5f * (float)Math.PI / 180f; // rad

        public float Trauma { get; private set; }
        /// <summary>Player settings, 0..1.</summary>
        public float Shake = 1f, Rumble = 1f;
        /// <summary>Kill slow-mo is skipped under reduced motion.</summary>
        public bool SlowMo = true;

        float stop, slow, t;

        /// <summary>Tier for `amount` damage on a car with `maxHp`.</summary>
        public static Tier TierFor(float amount, float maxHp, bool killed)
        {
            if (killed) return Tier.Large;
            float f = amount / maxHp;
            return f >= 0.15f ? Tier.Large : f >= 0.04f ? Tier.Medium : Tier.Small;
        }

        /// <summary>Register a hit. Returns the rumble to play (strong, weak, seconds), already scaled by the setting.</summary>
        public (float strong, float weak, float seconds) Hit(Tier tier)
        {
            var d = Tiers[(int)tier];
            Trauma = Math.Min(1f, Trauma + d.Trauma); // hits add, never reset
            stop = Math.Max(stop, d.Stop);
            if (SlowMo) slow = Math.Max(slow, d.Slow);
            return (d.Strong * Rumble, d.Weak * Rumble, Rumble > 0 ? d.RumbleSeconds : 0f);
        }

        public void AddTrauma(float amount) => Trauma = Math.Min(1f, Trauma + amount);

        /// <summary>Advance on real time; returns the simulation time scale for this frame.</summary>
        public float Update(float dt)
        {
            t += dt;
            Trauma = Math.Max(0f, Trauma - Decay * dt);
            if (stop > 0) { stop -= dt; return StopScale; }
            if (slow > 0) { slow -= dt; return SlowScale; }
            return 1f;
        }

        /// <summary>Camera-local offset (m) and roll (rad). Summed sines at unrelated rates: smooth, never a per-frame buzz.</summary>
        public (float x, float y, float roll) Offset()
        {
            float s = Trauma * Trauma * Shake;
            float k = t * 30f;
            return (MaxOffset * s * (float)Math.Sin(k * 1.7f),
                    MaxOffset * s * (float)Math.Sin(k * 2.3f + 1f),
                    MaxRoll * s * (float)Math.Sin(k * 1.1f + 2f));
        }
    }
}
