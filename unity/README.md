# Blacktop Bounty: Unity 6 port

The port described in [AAA_PLAN.md](../AAA_PLAN.md) (phase PP). The web build in the repo root is the tuning reference: its data is exported here, and the parity gate compares the two.

## First-time setup

1. **Free disk space.** Unity 6 plus the Mac, Windows, iOS and tvOS modules needs about 20 GB, and Xcode (for iPhone and Apple TV builds) about 40 GB more.
2. **Install Git LFS** before adding any art: `brew install git-lfs`, then `git lfs install`. The rules are in `.gitattributes`.
3. **Install Unity Hub** (unity.com/download), sign in, and install **Unity 6.3 LTS** (6000.3.x) with these modules: *Mac Build Support (IL2CPP)*, *Windows Build Support (Mono)*, *iOS Build Support*, *tvOS Build Support*. If the Hub offers a newer 6.3 patch than `ProjectSettings/ProjectVersion.txt`, accept it.
4. In the Hub: **Add → Add project from disk →** this `unity/` folder. Unity generates the rest of `ProjectSettings/` and resolves `Packages/manifest.json` on first open. If a package version fails to resolve, pick the version the Package Manager offers.
5. **Switch to URP:** *Assets → Create → Rendering → URP Asset (with Universal Renderer)*, then assign it in *Project Settings → Graphics → Default Render Pipeline* and in *Quality* for each level.

## Try it

- **Proving Ground:** new empty scene, create an empty GameObject, add the `ProvingGround` component, press Play.
  - Drive with WASD or a pad (R2/L2, left stick).
  - Tab cycles all 12 vehicles.
  - 1/2/3 fire the small, medium and large hit tiers (shake, hit-stop, slow-mo, rumble).
- **Tests:** *Window → General → Test Runner → EditMode → Run All*. `FeelTests` mirror `tests/feel.test.ts`; `DataTests` check the export.

## Updating data from the web build

```bash
node tools/export-unity-data.ts
```

Run it from the repo root. It writes `Assets/Resources/Data/game.json`, with positions converted to Unity's frame (+Z forward, +X right).

## Layout

| Path | What |
|---|---|
| `Assets/Scripts/Core/` | Pure C# rules: `Feel`, `Gearbox`, `GameData` |
| `Assets/Scripts/Vehicle/RaycastVehicle.cs` | Ray-cast suspension car on a `Rigidbody` (Rapier/Bullet semantics) |
| `Assets/Scripts/Feel/FeelRunner.cs` | Applies hit-stop through `Time.timeScale`, gamepad rumble |
| `Assets/Scripts/Camera/ChaseCamera.cs` | Chase camera port |
| `Assets/Scripts/Debug/ProvingGround.cs` | Test bed |
| `Assets/Tests/EditMode/` | Unity Test Framework tests |
