using UnityEngine;

namespace Blacktop
{
    /// <summary>
    /// AAA_PLAN §4.1 chase camera, ported from updateCamera() in src/play.ts: exponential follow (rate 8),
    /// 0.25 s velocity lead on the look point (rate 12), FOV 70 → 82° by speed, wall pull-in (snap in, ease out),
    /// trauma shake from FeelRunner. Runs on unscaled time so it stays smooth through hit-stops.
    /// ponytail: hand-rolled rather than Cinemachine to keep the web numbers exact; move to a Cinemachine
    /// extension if kill cams and cutscene blends (§4.9) need it.
    /// </summary>
    [RequireComponent(typeof(Camera))]
    public class ChaseCamera : MonoBehaviour
    {
        public RaycastVehicle target;

        Camera cam;
        Vector3 camPos, look;
        float camDist = 10f;
        readonly RaycastHit[] hits = new RaycastHit[8];

        static float Ease(float rate, float dt) => 1 - Mathf.Exp(-rate * dt);

        void Start()
        {
            cam = GetComponent<Camera>();
            if (target) camPos = look = target.transform.position;
        }

        void LateUpdate()
        {
            if (!target) return;
            float dt = Time.unscaledDeltaTime;
            var car = target.transform;
            Vector3 fwd = Vector3.ProjectOnPlane(car.forward, Vector3.up);
            fwd = fwd.sqrMagnitude < 1e-4f ? Vector3.forward : fwd.normalized;
            Vector3 p = car.position;
            var half = target.Def.half;

            Vector3 want = p - fwd * (7 + half.z);
            want.y = p.y + 3 + half.y;
            camPos = Vector3.Lerp(camPos, want, Ease(8, dt));

            // Pull in when a wall is between car and camera: snap in, ease back out. Only static colliders count.
            Vector3 pivot = p + Vector3.up * 1.2f;
            Vector3 dir = camPos - pivot;
            float len = dir.magnitude;
            dir /= Mathf.Max(len, 1e-4f);
            float wantDist = len;
            int n = Physics.RaycastNonAlloc(pivot, dir, hits, len, ~0, QueryTriggerInteraction.Ignore);
            for (int i = 0; i < n; i++)
                if (hits[i].rigidbody == null || hits[i].rigidbody.isKinematic) wantDist = Mathf.Min(wantDist, Mathf.Max(1.5f, hits[i].distance - 0.4f));
            camDist = wantDist < camDist ? wantDist : camDist + (wantDist - camDist) * Ease(3, dt);
            transform.position = pivot + dir * camDist;

            // Look slightly ahead of where the car is going.
            Vector3 v = target.Body.linearVelocity;
            Vector3 lookWant = p + fwd * 4 + new Vector3(v.x, 0, v.z) * 0.25f;
            lookWant.y = p.y + 1;
            look = Vector3.Lerp(look, lookWant, Ease(12, dt));
            transform.LookAt(look, Vector3.up);

            if (FeelRunner.Instance)
            {
                var (x, y, roll) = FeelRunner.Instance.Feel.Offset();
                transform.Translate(x, y, 0, Space.Self);
                transform.Rotate(0, 0, roll * Mathf.Rad2Deg, Space.Self);
            }

            float speedFov = 70 + 12 * Mathf.Min(Mathf.Abs(target.Speed) / 40f, 1);
            cam.fieldOfView += (speedFov - cam.fieldOfView) * Ease(4, dt);
        }
    }
}
