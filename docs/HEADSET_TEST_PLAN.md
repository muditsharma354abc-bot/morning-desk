# Morning Desk: 1-hour Quest 3 / 3S test plan

Goal: prove on real hardware that the whole experience works **hands-only (no controller)**, at **≥ 60 fps**, with placement on a real table and wall. Record honest numbers; don't round up.

## What to bring
- A Quest 3 or 3S, charged, with hand tracking on (Settings → Movement tracking → Hand tracking: on, plus auto-switch to hands). Put the controllers away.
- A laptop and a USB-C cable. On a Mac, install **Meta Quest Developer Hub (MQDH)** or **Android File Transfer** beforehand (see Recording).
- A real desk or table and a wall in front of it. Sit down.

## URLs (Quest Browser)
- Test run: `https://muditsharma354abc-bot.github.io/morning-desk/?test=1`. This shows a checklist panel to your left plus a live fps readout (avg / min over the last 10 s, and draw calls).
- Demo data: `https://muditsharma354abc-bot.github.io/morning-desk/?demo=1&test=1`
- High contrast from the start: add `&contrast=1`

Tap **Enter MR** in the page with a hand pinch-ray (the browser's own hand pointer). No controller is needed anywhere.

## Schedule (60 min)
| Time | Do | Record |
|---|---|---|
| 0–5 | Open the `?test=1` URL, tap Enter MR, and allow the permission prompts (space / anchors). | Did passthrough start? Any prompt text. |
| 5–12 | **Placement.** Look at your table and wait for the desk to appear. Does it sit *on* the real table, squared to its edge? Does the timeline land *on* the real wall, at a sensible size? Tick "Desk on real table" and "Timeline on real wall" by poking them. | Placement mode shown on the header (table plane / hit-test / tap). A photo of the result. |
| 5–12 (cont.) | **Room wakes up + Mood** (steps 1-2): right after placement the room dims, a warm glow rises on the wall, the timeline draws in, cards appear one by one with a soft chime, and the desk buddy opens its eyes (~14 s). Then poke or pinch-ray one of the 3 mood orbs (Low / Okay / Focused), hands only. Low/Okay show a change with 👍 Keep / 👎 Undo; Focused applies directly. Skip it with `&wake=0`. | Did the sequence play smoothly (fps)? Did one pinch pick the mood first try? |
| 12–17 | **Re-place.** Shift your chair, then poke 📍 Re-place. Try once by pinch-ray from a distance too. | Did it re-find the table? |
| 17–22 | **Anchors.** Exit XR (Meta button), reload the page, and re-enter. Do the desk and wall come back in the same spot? Then fully close the browser and reopen. | Same spot? Drift in cm. |
| 22–35 | **Gestures plus their buttons** (tick each one): pinch-drag a card onto the wall timeline · tap a card → Focus → 📅 Plan it · flick a card sideways to skip · ⏭ Skip button · 👍 to finish focus · Done / +15 / Exit · "Plan for me" then 👍 Keep / 👎 Undo (gesture and button) · Wind down → 👍/👎 and → Tomorrow / ✕ Drop. | Per gesture: worked first try? How many tries? Any false triggers (e.g. thumbs firing while typing)? |
| 35–40 | **Accessibility.** Poke ◐ Contrast and check readability in a bright room. Poke 📊 7 days. | Readable? |
| 40–45 | **Tutorial.** Run Tutorial from the desk row and finish all steps. | Time to finish, and any step that got stuck. |
| 45–55 | **FPS proof** (below), then **Recording** (below). | Numbers. |
| 55–60 | Write up the notes. | |

## FPS proof (separate run, NOT while recording)
Recording itself can drop fps, so measure first, without recording.
1. If developer mode and the **OVR Metrics Tool** are available, enable its fps overlay, run the app for 2 minutes (place, drag, focus, wind-down), and take a screenshot of the overlay.
2. Otherwise read the `?test=1` overlay: write down **avg** and **min** (10 s window) during idle, during a card drag, and with the focus panel open.
3. Write down the actual numbers seen. **Claim 60 fps only if it was actually observed** (for example "avg 72 / min 61 during drag"). Tick "60 fps held" only in that case.

## Recording
1. **Before recording**, open Quest **Camera settings** and pick **landscape / 16:9** if offered. The default can be square, which would force a crop.
2. Use **Camera → Record video** (passthrough + app, 1080p). Record a **2–3 min seated, steady** pass covering: placement, Re-place, one pinch-and-drop, a thumbs-up, and Wind-down. Move your head slowly.
3. **Copying:** on a Mac the Quest doesn't mount as a drive, so install **MQDH** or **Android File Transfer** beforehand, and bring the laptop and a USB-C cable.
4. **Shop / borrowed headset:** copy the MP4 off, then have the recording deleted from the device. **Backup** if copying fails: cast via the **Meta Horizon phone app** and screen-record on the phone.
5. **Labelling:** only real headset shots drop the "emulator" label. Any emulator shot left in v6 keeps it.

## Report back
The checklist ticks (a screenshot of the `?test=1` panel), the fps numbers, placement photos, tries per gesture, and any bug with exact steps.

## Optional: driving the headset from the dev machine (`--native-xr-control`)

> **⚠️ Use this for debugging only. Do NOT use it for the judged hands-only run.** Native XR control can inject synthetic controller/pose input into the real headset session. Anything you do through it does not show the experience working hands-only. Before the fps or hands-only checks, stop the dev server, unplug USB, and reload the Pages URL.

1. On the Mac: `npx iwsdk dev up --native-xr-control` (checked against the pinned @iwsdk/cli 1.1.0-rc.2 `iwsdk dev up --help`: "Control native Quest WebXR through ADB-reversed localhost"). Stop it later with `npx iwsdk dev down`. The dev server port is 8081.
2. Connect the Quest 3 over USB with developer mode on and USB debugging allowed, then run `adb devices` and note the headset's serial. Run `adb reverse tcp:8081 tcp:8081` (the CLI does not do this for you).
3. Pair this dev session with that exact headset: `npx iwsdk runtime pair-headset --input-json '{"headsetId":"<adb serial>"}'`. It returns a bootstrap URL: open that URL in the Quest browser and enter MR.
4. Find the headset page: `npx iwsdk runtime targets` (physical targets must be selected explicitly). `npx iwsdk runtime status` shows the session state.
5. If the managed browser fails: `npx iwsdk runtime recover`.
6. Caveats: the commands above may differ between IWSDK versions (check `npx iwsdk --help` on the pinned version). Over USB, timing and fps are not representative. `adb reverse` resets on replug. Synthetic input may switch the session to controllers, so after debugging exit XR, reload, and confirm the hand icons are back.
