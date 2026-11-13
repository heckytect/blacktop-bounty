using NUnit.Framework;

namespace Blacktop.Tests
{
    // Mirrors tests/feel.test.ts in the web build: the port must match it number for number.
    public class FeelTests
    {
        [Test]
        public void TiersByShareOfMaxHp_KillsAlwaysLarge()
        {
            Assert.AreEqual(Tier.Small, Feel.TierFor(2, 150, false));
            Assert.AreEqual(Tier.Medium, Feel.TierFor(15, 150, false));
            Assert.AreEqual(Tier.Large, Feel.TierFor(35, 150, false));
            Assert.AreEqual(Tier.Large, Feel.TierFor(1, 150, true));
        }

        [Test]
        public void HitsAddTrauma_HitStopReleases_ShakeDecaysToRest()
        {
            var f = new Feel();
            f.Hit(Tier.Medium);
            f.Hit(Tier.Medium);
            Assert.AreEqual(0.7f, f.Trauma, 1e-4f);
            Assert.Less(f.Update(0.016f), 0.1f); // inside the 40 ms stop
            f.Update(0.05f);
            Assert.AreEqual(1f, f.Update(0.016f));
            for (int i = 0; i < 120; i++) f.Update(1f / 60f);
            Assert.AreEqual(0f, f.Trauma);
            var (x, y, roll) = f.Offset();
            Assert.AreEqual(0f, System.Math.Abs(x) + System.Math.Abs(y) + System.Math.Abs(roll));
        }

        [Test]
        public void KillSlowMoSkippedUnderReducedMotion()
        {
            var f = new Feel { SlowMo = false };
            f.Hit(Tier.Large);
            f.Update(0.12f); // past the hit-stop
            Assert.AreEqual(1f, f.Update(0.016f));
        }

        [Test]
        public void RumbleScalesWithSetting_ZeroMeansNoRumble()
        {
            var f = new Feel { Rumble = 0.5f };
            var r = f.Hit(Tier.Large);
            Assert.AreEqual(0.5f, r.strong, 1e-5f);
            f.Rumble = 0;
            Assert.AreEqual(0f, f.Hit(Tier.Large).seconds);
        }

        [Test]
        public void GearboxRpmDropsAtEachUpshift()
        {
            for (int g = 0; g < Gearbox.Gears.Length - 1; g++)
            {
                var before = Gearbox.Rpm(Gearbox.Gears[g] - 0.01f, 1);
                var after = Gearbox.Rpm(Gearbox.Gears[g] + 0.01f, 1);
                Assert.AreEqual(g + 1, after.gear);
                Assert.Greater(before.rpm, 0.95f);
                Assert.Less(after.rpm, 0.4f);
            }
            Assert.AreEqual(1f, Gearbox.Rpm(100, 1).rpm);
        }
    }
}
