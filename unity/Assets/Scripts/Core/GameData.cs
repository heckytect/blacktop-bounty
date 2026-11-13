using System;
using UnityEngine;

namespace Blacktop
{
    // Shapes of Resources/Data/game.json, written by tools/export-unity-data.ts from the web build's data.
    // Field names match the JSON keys (JsonUtility). Positions are already in Unity's frame (+Z forward, +X right).
    // ponytail: read-only JSON for now; move to ScriptableObjects when per-car tuning needs the Inspector (§4.2).

    [Serializable] public class TierData { public string name; public float trauma, stop, slow, strong, weak, rumbleMs; }

    [Serializable] public class VehicleStats { public float maxHp, topSpeed, mass, accel, grip, maxSteer; }

    [Serializable] public class WheelData { public Vector3 pos; public bool front; }

    [Serializable] public class PartData { public Vector3 size, pos; public string color; public bool glow; }

    [Serializable]
    public class VehicleData
    {
        public string id, name, driver, cls, color, ability, abilityName, aiStyle;
        public int armor, speed, handling;
        public float hpScale, wheelR, chargeTime, aiRange;
        public Vector3 half;
        public VehicleStats stats;
        public WheelData[] wheels;
        public PartData[] parts;

        public Color Tint => ColorUtility.TryParseHtmlString(color, out var c) ? c : Color.magenta;
    }

    [Serializable]
    public class GameData
    {
        public int version;
        public float gravity, suspensionRest;
        public float[] gears;
        public TierData[] tiers;
        public VehicleData[] vehicles;

        static GameData cached;

        public static GameData Load()
        {
            if (cached != null) return cached;
            var json = Resources.Load<TextAsset>("Data/game");
            if (json == null) throw new InvalidOperationException("Resources/Data/game.json missing: run `node tools/export-unity-data.ts`.");
            return cached = JsonUtility.FromJson<GameData>(json.text);
        }

        public VehicleData Vehicle(string id) => Array.Find(vehicles, v => v.id == id) ?? throw new ArgumentException($"no vehicle '{id}'");
    }
}
