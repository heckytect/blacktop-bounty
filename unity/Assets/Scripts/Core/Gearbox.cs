using System;

namespace Blacktop
{
    /// <summary>AAA_PLAN §4.6, ported from engineRpm() in src/audio.ts. RPM 0..1 drops at each upshift; it drives the FMOD engine event.</summary>
    public static class Gearbox
    {
        /// <summary>Top speed (m/s) of each virtual gear. Same as GEARS in src/audio.ts.</summary>
        public static readonly float[] Gears = { 8f, 15f, 23f, 32f, 44f };

        public static (int gear, float rpm) Rpm(float speed, float throttle)
        {
            int g = Array.FindIndex(Gears, top => speed < top);
            if (g < 0) g = Gears.Length - 1;
            float lo = g == 0 ? 0f : Gears[g - 1];
            float x = Math.Min(1f, (speed - lo) / (Gears[g] - lo));
            float rpm = g == 0 ? 0.15f + 0.85f * x : 0.35f + 0.65f * x;
            return (g, Math.Max(rpm, 0.15f + 0.3f * throttle * (g == 0 ? 1f : 0f))); // revs on the spot
        }
    }
}
