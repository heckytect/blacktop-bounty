using UnityEngine;

namespace Blacktop
{
    public struct DriveInput
    {
        public float throttle, brake, steer; // 0..1, 0..1, -1 (left)..1 (right)
        public bool handbrake, jump, reset;
    }

    /// <summary>
    /// AAA_PLAN §3: arcade ray-cast vehicle on a Rigidbody, ported from src/vehicle.ts (Rapier DynamicRayCastVehicleController).
    /// Rapier follows Bullet's btRaycastVehicle: suspension force = stiffness · compression · chassis mass per wheel,
    /// engine force in N, brake as a per-step impulse cap. Those semantics are kept so the web numbers carry over.
    /// ponytail: lateral grip is a cap-by-load approximation of Bullet's friction solver; tune it against the web
    /// build's handling course (parity gate: lap times within 5 %).
    /// </summary>
    [RequireComponent(typeof(Rigidbody))]
    public class RaycastVehicle : MonoBehaviour
    {
        // Same constants as src/vehicle.ts.
        const float RefMass = 800f, BrakeImpulse = 60f, DriftGripRatio = 0.7f, ReverseTop = 15f;
        const float JumpSpeed = 9f, JumpCooldown = 1f, SelfRighting = 4f;
        const float Stiffness = 28f, Compression = 2.4f, Relaxation = 2.8f, MaxTravel = 0.4f;

        public VehicleData Def { get; private set; }
        public Rigidbody Body { get; private set; }
        public DriveInput Input;
        public float Energy = 100f;

        /// <summary>Signed speed along the car's forward axis (m/s).</summary>
        public float Speed => Vector3.Dot(Body.linearVelocity, transform.forward);
        public bool Grounded { get; private set; }
        /// <summary>Suspension length per wheel this step (for wheel visuals).</summary>
        public readonly float[] WheelLength = new float[4];

        float rest, jumpTimer, flippedTimer;
        Vector3[] attach;

        public void Init(VehicleData def, float suspensionRest)
        {
            Def = def;
            rest = suspensionRest;
            Body = GetComponent<Rigidbody>();
            var s = def.stats;
            Body.mass = s.mass;
            Body.linearDamping = 0.05f;
            Body.angularDamping = 0.6f;
            Body.interpolation = RigidbodyInterpolation.Interpolate;
            Body.collisionDetectionMode = CollisionDetectionMode.ContinuousDynamic;
            // Box inertia with extra roll resistance and a lowered centre of mass: arcade-stable (web values).
            float w = def.half.x * 2, h = def.half.y * 2, l = def.half.z * 2, m = s.mass;
            Body.centerOfMass = new Vector3(0, -0.4f, 0);
            Body.inertiaTensor = new Vector3(m / 12 * (l * l + h * h), m / 12 * (l * l + w * w), m / 12 * (h * h + w * w) * 1.7f);
            Body.inertiaTensorRotation = Quaternion.identity;

            attach = new Vector3[def.wheels.Length];
            for (int i = 0; i < attach.Length; i++)
            {
                var p = def.wheels[i].pos;
                attach[i] = new Vector3(p.x, -def.half.y + 0.1f, p.z); // suspension top, as in the web build
                WheelLength[i] = rest;
            }
        }

        void FixedUpdate()
        {
            if (Def == null) return;
            float dt = Time.fixedDeltaTime;
            var s = Def.stats;
            float mass = s.mass, speed = Speed;
            Energy = Mathf.Min(100f, Energy + 8f * dt);

            float steer = Input.steer * s.maxSteer / (1 + Mathf.Abs(speed) * 0.07f); // less steering at speed
            bool reversing = Input.brake > 0 && speed < 1;
            float engineForce = mass * s.accel;
            float fwdPull = Input.throttle * engineForce * Mathf.Max(0, 1 - speed / s.topSpeed);
            float revPull = reversing ? Input.brake * engineForce * 0.6f * Mathf.Max(0, 1 + speed / ReverseTop) : 0;
            float engine = fwdPull - revPull;
            float brakeImpulse = !reversing ? Input.brake * BrakeImpulse * (mass / RefMass) : 0;

            Vector3 up = transform.up;
            Grounded = false;
            for (int i = 0; i < attach.Length; i++)
            {
                bool front = Def.wheels[i].front;
                Vector3 origin = transform.TransformPoint(attach[i]);
                float reach = rest + Def.wheelR; // Bullet/Rapier ray length
                if (!Physics.Raycast(origin, -up, out var hit, reach, ~0, QueryTriggerInteraction.Ignore) || hit.rigidbody == Body)
                {
                    WheelLength[i] = rest;
                    continue;
                }
                Grounded = true;
                float length = Mathf.Max(rest - MaxTravel, hit.distance - Def.wheelR);
                WheelLength[i] = Mathf.Max(0, length);
                float compression = rest - length;
                Vector3 pointVel = Body.GetPointVelocity(hit.point);
                float suspVel = Vector3.Dot(pointVel, up); // < 0: compressing
                float damping = suspVel < 0 ? Compression : Relaxation;
                float load = Mathf.Max(0, (Stiffness * compression - damping * suspVel) * mass);
                Body.AddForceAtPosition(up * load, hit.point);

                // Tyre: steered forward axis, sideways grip capped by load (handbrake loosens the rear).
                Vector3 fwd = front ? Quaternion.AngleAxis(steer * Mathf.Rad2Deg, up) * transform.forward : transform.forward;
                fwd = Vector3.ProjectOnPlane(fwd, hit.normal).normalized;
                Vector3 side = Vector3.Cross(hit.normal, fwd);
                float grip = !front && Input.handbrake ? s.grip * DriftGripRatio : s.grip;
                float lateral = Vector3.Dot(pointVel, side);
                float sideForce = Mathf.Clamp(-lateral * mass / attach.Length / dt, -grip * load, grip * load);

                float drive = engine * (front ? 0.3f : 0.7f); // AWD, rear-biased
                float brakeCap = (brakeImpulse + (!front && Input.handbrake ? BrakeImpulse * (mass / RefMass) * 0.15f : 0)) / dt;
                float along = Vector3.Dot(pointVel, fwd);
                float brake = -Mathf.Sign(along) * Mathf.Min(brakeCap, Mathf.Abs(along) * mass / attach.Length / dt);
                Body.AddForceAtPosition(side * sideForce + fwd * (drive + brake), hit.point);
            }

            jumpTimer -= dt;
            if (Input.jump && jumpTimer <= 0 && Grounded && Energy >= 15f)
            {
                Energy -= 15f;
                Body.AddForce(Vector3.up * mass * JumpSpeed, ForceMode.Impulse);
                jumpTimer = JumpCooldown;
            }

            // Arcade anti-roll: torque back toward upright so hits rarely roll the car.
            Body.AddTorque(Vector3.Cross(up, Vector3.up) * mass * SelfRighting);

            flippedTimer = up.y < 0.3f && Body.linearVelocity.y * Body.linearVelocity.y < 1 ? flippedTimer + dt : 0;
            if (Input.reset || flippedTimer > 1.5f) Recover();
        }

        void Recover()
        {
            float yaw = transform.eulerAngles.y;
            Body.position += Vector3.up * 2f;
            Body.rotation = Quaternion.Euler(0, yaw, 0);
            Body.linearVelocity = Vector3.zero;
            Body.angularVelocity = Vector3.zero;
            flippedTimer = 0;
        }
    }
}
