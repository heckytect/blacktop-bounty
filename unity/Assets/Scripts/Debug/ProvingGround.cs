using UnityEngine;
using UnityEngine.InputSystem;

namespace Blacktop
{
    /// <summary>
    /// Port test bed (AAA_PLAN §11 step 4): add this to an empty GameObject in an empty scene and press Play.
    /// Builds a flat ground with ramps, walls and crates, spawns a placeholder car from Data/game.json, and wires the
    /// chase camera and feel. Keyboard: WASD/arrows, Space handbrake, J jump, R reset, Tab next car, 1/2/3 test hit tiers.
    /// Pad: R2/L2 throttle/brake, left stick steer, B handbrake, A jump.
    /// </summary>
    public class ProvingGround : MonoBehaviour
    {
        public string startCar = "dust-devil";

        GameData data;
        RaycastVehicle car;
        ChaseCamera chase;
        FeelRunner feel;
        Transform[] wheels;
        int carIndex;

        void Start()
        {
            data = GameData.Load();
            Physics.gravity = new Vector3(0, data.gravity, 0);
            Time.fixedDeltaTime = 1f / 60f;
            BuildCourse();
            feel = new GameObject("Feel").AddComponent<FeelRunner>();
            var camGo = Camera.main ? Camera.main.gameObject : new GameObject("Main Camera", typeof(Camera)) { tag = "MainCamera" };
            camGo.GetComponent<Camera>().fieldOfView = 70;
            camGo.GetComponent<Camera>().farClipPlane = 1000;
            if (!camGo.TryGetComponent(out chase)) chase = camGo.AddComponent<ChaseCamera>();
            carIndex = System.Array.FindIndex(data.vehicles, v => v.id == startCar);
            Spawn(Mathf.Max(0, carIndex));
        }

        void Spawn(int index)
        {
            Vector3 pos = new Vector3(0, 2, 0);
            Quaternion rot = Quaternion.identity;
            if (car) { pos = car.transform.position + Vector3.up; rot = Quaternion.Euler(0, car.transform.eulerAngles.y, 0); Destroy(car.gameObject); }
            carIndex = index;
            var def = data.vehicles[index];
            var go = new GameObject(def.name);
            go.transform.SetPositionAndRotation(pos, rot);
            var box = go.AddComponent<BoxCollider>();
            box.size = def.half * 2;
            box.material = new PhysicsMaterial { dynamicFriction = 0.3f, staticFriction = 0.3f };
            go.AddComponent<Rigidbody>();
            car = go.AddComponent<RaycastVehicle>();
            car.Init(def, data.suspensionRest);
            go.AddComponent<VehicleFeel>();

            foreach (var part in def.parts) Visual(PrimitiveType.Cube, go.transform, part.pos, part.size, ParseColor(part.color));
            wheels = new Transform[def.wheels.Length];
            for (int i = 0; i < wheels.Length; i++)
            {
                var w = Visual(PrimitiveType.Cylinder, go.transform, def.wheels[i].pos, new Vector3(def.wheelR * 2, 0.15f, def.wheelR * 2), new Color(0.13f, 0.13f, 0.13f));
                w.localRotation = Quaternion.Euler(0, 0, 90);
                wheels[i] = w;
            }
            chase.target = car;
        }

        void Update()
        {
            if (!car) return;
            var k = Keyboard.current;
            var pad = Gamepad.current;
            bool Held(Key a, Key b = Key.None) => k != null && (k[a].isPressed || (b != Key.None && k[b].isPressed));
            var input = new DriveInput
            {
                throttle = Mathf.Max(Held(Key.W, Key.UpArrow) ? 1 : 0, pad?.rightTrigger.ReadValue() ?? 0),
                brake = Mathf.Max(Held(Key.S, Key.DownArrow) ? 1 : 0, pad?.leftTrigger.ReadValue() ?? 0),
                steer = Mathf.Clamp((Held(Key.D, Key.RightArrow) ? 1 : 0) - (Held(Key.A, Key.LeftArrow) ? 1 : 0) + (pad?.leftStick.x.ReadValue() ?? 0), -1, 1),
                handbrake = Held(Key.Space) || (pad?.buttonEast.isPressed ?? false),
                jump = Held(Key.J) || (pad?.buttonSouth.isPressed ?? false),
                reset = Held(Key.R),
            };
            car.Input = input;

            if (k != null)
            {
                if (k.tabKey.wasPressedThisFrame) Spawn((carIndex + 1) % data.vehicles.Length);
                if (k.digit1Key.wasPressedThisFrame) feel.Hit(Tier.Small);
                if (k.digit2Key.wasPressedThisFrame) feel.Hit(Tier.Medium);
                if (k.digit3Key.wasPressedThisFrame) feel.Hit(Tier.Large);
            }

            float y0 = -car.Def.half.y + 0.1f;
            for (int i = 0; i < wheels.Length; i++)
            {
                var p = wheels[i].localPosition;
                wheels[i].localPosition = new Vector3(p.x, y0 - car.WheelLength[i], p.z);
            }
        }

        void OnGUI()
        {
            if (!car) return;
            var (gear, rpm) = Gearbox.Rpm(Mathf.Abs(car.Speed), car.Input.throttle);
            GUI.Label(new Rect(12, 12, 600, 22), $"{car.Def.name} · {Mathf.Round(Mathf.Abs(car.Speed) * 3.6f)} km/h · gear {gear + 1} · rpm {rpm:0.00} · energy {car.Energy:0} · {1f / Mathf.Max(Time.unscaledDeltaTime, 1e-4f):0} fps");
            GUI.Label(new Rect(12, 32, 900, 22), "WASD drive · Space handbrake · J jump · R reset · Tab next car · 1/2/3 test hit tiers");
        }

        // --- course ------------------------------------------------------------------------------------------
        void BuildCourse()
        {
            var sand = new Color(0.78f, 0.68f, 0.52f);
            var concrete = new Color(0.55f, 0.55f, 0.55f);
            Static(new Vector3(0, -0.5f, 0), new Vector3(400, 1, 400), Quaternion.identity, sand);
            for (int i = 0; i < 4; i++) // perimeter walls
            {
                var rot = Quaternion.Euler(0, i * 90, 0);
                Static(rot * new Vector3(0, 2, 120), new Vector3(240, 4, 2), rot, concrete);
            }
            Static(new Vector3(0, 0.8f, 40), new Vector3(10, 0.5f, 16), Quaternion.Euler(-12, 0, 0), concrete);   // ramp
            Static(new Vector3(-40, 1.5f, -20), new Vector3(16, 0.5f, 24), Quaternion.Euler(-15, 90, 0), concrete); // side ramp
            Static(new Vector3(40, 3, 30), new Vector3(20, 6, 20), Quaternion.identity, new Color(0.55f, 0.35f, 0.25f)); // block for pull-in
            for (int i = 0; i < 6; i++) // crates to ram
            {
                var c = Visual(PrimitiveType.Cube, null, new Vector3(-20 + i * 3, 0.75f, 60), Vector3.one * 1.5f, new Color(0.6f, 0.15f, 0.12f), collider: true);
                c.gameObject.AddComponent<Rigidbody>().mass = 120;
            }
        }

        static void Static(Vector3 pos, Vector3 size, Quaternion rot, Color color)
        {
            var t = Visual(PrimitiveType.Cube, null, pos, size, color, collider: true);
            t.rotation = rot;
            t.gameObject.isStatic = true;
        }

        static Transform Visual(PrimitiveType type, Transform parent, Vector3 pos, Vector3 size, Color color, bool collider = false)
        {
            var go = GameObject.CreatePrimitive(type);
            if (!collider) Destroy(go.GetComponent<Collider>());
            go.transform.SetParent(parent, false);
            go.transform.localPosition = pos;
            go.transform.localScale = size;
            go.GetComponent<Renderer>().material.color = color;
            return go.transform;
        }

        static Color ParseColor(string hex) => ColorUtility.TryParseHtmlString(hex, out var c) ? c : Color.magenta;
    }

    /// <summary>Hard landings and big impacts feed the feel layer (same thresholds as the web build where it has them).</summary>
    [RequireComponent(typeof(RaycastVehicle))]
    public class VehicleFeel : MonoBehaviour
    {
        RaycastVehicle car;
        bool wasAir;
        float fallSpeed;

        void Awake() => car = GetComponent<RaycastVehicle>();

        void FixedUpdate()
        {
            if (car.Body == null || FeelRunner.Instance == null) return;
            if (!car.Grounded) fallSpeed = Mathf.Min(fallSpeed, car.Body.linearVelocity.y);
            else
            {
                if (wasAir && fallSpeed < -9f) FeelRunner.Instance.Hit(Tier.Medium); // hard landing
                fallSpeed = 0;
            }
            wasAir = !car.Grounded;
        }

        void OnCollisionEnter(Collision c)
        {
            if (FeelRunner.Instance == null || car.Body == null) return;
            float dv = c.impulse.magnitude / car.Body.mass; // m/s lost in the hit
            // ponytail: impact thresholds are first guesses; real ram damage arrives with §4.2's damage model.
            if (dv > 14f) FeelRunner.Instance.Hit(Tier.Large);
            else if (dv > 6f) FeelRunner.Instance.Hit(Tier.Medium);
            else if (dv > 3f) FeelRunner.Instance.Hit(Tier.Small);
        }
    }
}
