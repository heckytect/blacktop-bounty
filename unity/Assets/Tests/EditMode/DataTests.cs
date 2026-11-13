using NUnit.Framework;

namespace Blacktop.Tests
{
    // Data/game.json is exported from the web build; these catch a stale or hand-edited export.
    public class DataTests
    {
        [Test]
        public void RosterLoadsWithStats()
        {
            var data = GameData.Load();
            Assert.AreEqual(12, data.vehicles.Length); // 10 playable + Kingpin + drone
            var dd = data.Vehicle("dust-devil");
            Assert.AreEqual(4, dd.wheels.Length);
            Assert.AreEqual(1000f, dd.stats.mass, 1e-3f);        // 500 + 250·(armor 3 − 1)
            Assert.AreEqual(45f, dd.stats.topSpeed, 1e-3f);      // 30 + 5·(speed 4 − 1)
            Assert.AreEqual(2f, dd.half.z, 1e-3f);               // long axis is +Z in Unity
            Assert.Greater(dd.wheels[0].pos.z, 0f);              // first wheel is a front wheel
            Assert.IsTrue(dd.wheels[0].front);
        }

        [Test]
        public void ExportedFeelAndGearsMatchTheCode()
        {
            var data = GameData.Load();
            for (int i = 0; i < 3; i++)
            {
                Assert.AreEqual(data.tiers[i].trauma, Feel.Tiers[i].Trauma, 1e-5f);
                Assert.AreEqual(data.tiers[i].stop, Feel.Tiers[i].Stop, 1e-5f);
                Assert.AreEqual(data.tiers[i].rumbleMs / 1000f, Feel.Tiers[i].RumbleSeconds, 1e-5f);
            }
            CollectionAssert.AreEqual(data.gears, Gearbox.Gears);
        }
    }
}
