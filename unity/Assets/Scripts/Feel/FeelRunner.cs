using UnityEngine;
using UnityEngine.InputSystem;

namespace Blacktop
{
    /// <summary>
    /// Applies Feel to the engine: Time.timeScale for hit-stop and slow-mo (FixedUpdate slows with it, like the web
    /// build's scaled accumulator), and gamepad rumble. One per scene; ChaseCamera reads Feel.Offset().
    /// </summary>
    public class FeelRunner : MonoBehaviour
    {
        public static FeelRunner Instance { get; private set; }
        public readonly Feel Feel = new Feel();
        [Range(0, 1)] public float shake = 1f, rumble = 1f;

        float rumbleLeft;

        void Awake() => Instance = this;

        public void Hit(Tier tier)
        {
            var (strong, weak, seconds) = Feel.Hit(tier);
            if (seconds <= 0 || Gamepad.current == null) return;
            Gamepad.current.SetMotorSpeeds(strong, weak); // low-frequency (heavy) motor, high-frequency motor
            rumbleLeft = Mathf.Max(rumbleLeft, seconds);
        }

        void Update()
        {
            Feel.Shake = shake;
            Feel.Rumble = rumble;
            Time.timeScale = Feel.Update(Time.unscaledDeltaTime);
            if (rumbleLeft > 0 && (rumbleLeft -= Time.unscaledDeltaTime) <= 0) Gamepad.current?.SetMotorSpeeds(0, 0);
        }

        void OnDisable()
        {
            Time.timeScale = 1f;
            Gamepad.current?.SetMotorSpeeds(0, 0);
        }
    }
}
