# Morning Desk v2: notes (branch `v2`)

## Works today on main (a33faf2) vs new in v2
| Feature | a33faf2 (live) | v2 |
|---|---|---|
| immersive-ar passthrough session | yes (`xr.mode: "ar"`, blend `alpha-blend` in IWER) | same, plus VR-room fallback when AR is unsupported |
| Plane detection | enabled (13 planes in IWER home_office) | used for desk and wall |
| Timeline on a real wall | code exists (vertical plane 0.5–1.7 m ahead), never triggers in IWER (wall is about 2.4 m away), falls back to 1.1 m ahead | wall plane is found from the seated `?mr=1` pose |
| Cards on the real desk | no (desk is always head-relative) | table-height plane → hit-test → tap to place (about 60 cm ahead) |
| Persistent anchor | IWSDK creates and persists one anchor UUID; the app saves the wall pose only after a wall is detected, so in practice never; a failed restore silently reuses the old pose | desk and wall poses saved against the anchor UUID; restored next session; a UUID mismatch or timeout means placing again |
| Re-place button | no | yes (📍 Re-place on the desk) |
| Wind-down | no | 🌙 Wind down: recap → keep/drop each unfinished task → close day; the next morning's timeline starts with the kept tasks |
| Plant reward | yes | removed (the streak is a plain day count) |

## URL flags
- `?mr=1`: MR flow in the IWER emulator (seats the emulated head at the home_office desk). Real headsets use the MR flow automatically (except `?demo` / `?clean`).
- `?vr=1` (test): behaves as if immersive-ar were unsupported, which gives the VR-room fallback.
- `?noplanes=1` (test): ignores planes and hit-test, which gives tap to place.
- `?nextday=1` (test): pretends it is tomorrow, to check the wind-down → morning rollover.
- `?demo=1&autoplay=1&mr=1`: v2 filming pass. `?demo=1&autoplay=1&clean=1` is unchanged (v1 video).

## Cannot be tested without a headset
- Real passthrough look and comfort; whether the cards read well on a real desk surface.
- Plane detection and hit-test in real rooms (sizes, labels, missing or partial planes, clutter).
- Persistent anchors across real sessions, headset reboots and Guardian/space changes (`restorePersistentAnchor`).
- Real-world scale: key UI within about ±30°, interactions within about 60 cm, seated vs standing.
- Pinch to confirm tap to place, thumbs gestures and poke with real hand tracking (IWER emulates hands).
- The VR fallback on a real device without immersive-ar.

## Depth occlusion (v2.1)
- `xr.features.depthSensing` is **optional** (`gpu-optimized`, `float32`). `DepthSensingSystem` is registered, and `DepthOccludable` (soft) is attached to the desk, wall/timeline, Meetings and Pending boards, and every card entity.
- Text shaders: occlusion compiled on 10/10 card materials in IWER 2.7 with its synthetic depth. There were no shader errors and the text still renders.
- When depth isn't granted (tested by removing `depth-sensing` from the session request): the system logs one warning (`depth-sensing feature not enabled… disabled`), occlusion stays off (0/10 enabled), there are no errors, and rendering is normal.
- **Real occlusion is headset-only.** Only the emulator's synthetic depth has been verified. **Quest 3S depth is unverified.**
- Layout: the planner is no longer moved onto the desk; it stays above the timeline header. The 7 days and Contrast chips sit under the Pending cards, clear of the monitor, with or without depth.
