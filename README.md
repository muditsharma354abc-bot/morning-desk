# Morning Desk

**Plan, focus, adapt and measure your day with your hands.** Morning Desk is a mixed-reality day planner for Meta Quest 3: your tasks sit on the desk in front of you, your day hangs on the wall in front of you, a focus mode helps you do one thing at a time, and a rule-based smart planner keeps the schedule realistic as the day changes.

[![Live demo](https://img.shields.io/badge/live%20demo-GitHub%20Pages-2f7d5b)](https://muditsharma354abc-bot.github.io/morning-desk/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![WebXR](https://img.shields.io/badge/WebXR-IWSDK-6b5bd2)](https://github.com/facebook/immersive-web-sdk)

Built for the Start Developer Competition (Productivity track, New Experience division).

| Link | What you get |
| --- | --- |
| [Live app](https://muditsharma354abc-bot.github.io/morning-desk/) | Your own plan, saved on this device. The hands tutorial starts on your first visit. |
| [Demo state](https://muditsharma354abc-bot.github.io/morning-desk/?demo=1) | A fixed sample day with a 14:00 Client sync and a 90-minute deep-work block that runs into it, so the planner has something to fix. It uses separate storage and never touches your real plan. |
| [Autoplay demo](https://muditsharma354abc-bot.github.io/morning-desk/?demo=1&autoplay=1) | A hands-free walkthrough of about 2–3 minutes that drives the real app through emulated hands, with captions. It needs a desktop browser (it uses the built-in emulator). |
| [v2 MR autoplay](https://muditsharma354abc-bot.github.io/morning-desk/?demo=1&autoplay=1&mr=1) | About 2 minutes in the emulator's simulated room: desk and timeline placed on the room's table and wall, the same spot after re-entering XR, Re-place, one focus block, and Wind-down. |

On a Quest 3, open the live app in the Meta Quest Browser and press **Enter XR**. On a desktop browser the built-in emulator runs it, no headset or extension needed.

![Morning Desk layout: meetings on the left, timeline ahead, pending tasks on the right clear of the hand marker, must-dos on the desk](docs/screenshots/01-spatial-layout-final.png)

## Plan, Focus, Adapt, Measure

1. **Plan.** Pinch a task card off the desk and drop it on the timeline. Fixed meetings are part of the day, and any block that runs into one is flagged.
2. **Focus.** A quick pinch on a task opens Focus Mode with a 25 or 50 minute timer.
3. **Adapt.** When a focus block ends early or late, later blocks shift by the measured time, and the smart planner re-checks the day for meeting clashes and overload.
4. **Measure.** The day summary reports only what was actually measured.
5. **Wind down.** In the evening, **🌙 Wind down** recaps what got done, lets you keep or drop each unfinished task, and starts tomorrow's timeline with the ones you kept.

## The spatial layout

Everything is placed for a seated user, with key UI close to the centre of view.

- **In front:** the wall timeline, and the Focus panel when you're focusing.
- **Left:** the meetings board. A meeting that a scheduled block runs into shows a **⚠ clash** warning.
- **Right:** the pending board with tasks you haven't planned yet ("drag to plan").
- **On the desk:** must-do task cards within reach, plus the **✨ Plan for me**, **✓ Done**, **? Tutorial** and **↺ Demo reset** buttons.
- **Behind the timeline:** a completed strip showing how many tasks are done.

## Focus Mode

- **Quick pinch (tap)** a task card to open a big Focus panel in front of you. The timer starts at 25 minutes; switch to **50 min** with a button.
- While you focus, the other tasks fade and the passthrough view dims around you.
- **Thumbs-up** (or **✓ Done**) finishes the task, early if you like. **✕ Exit** leaves without finishing.
- When the timer runs out, the panel asks **Done or more time?** Thumbs-up means done; a pinch (or **+15 min**) adds 15 minutes.
- In the demo state the timer is accelerated so a full block fits in a video, and the panel says so: **⏩ Demo: 1 s = 2 min (accelerated)**. Outside the demo it runs in real time.

![Focus Mode with the accelerated demo timer label](docs/screenshots/02-focus-mode.png)

## The smart planner

Tap **✨ Plan for me** and the planner proposes one concrete change at a time. Each change animates into place and waits for your decision: thumbs-up keeps it, thumbs-down undoes it and restores the exact previous plan. **👍 Keep** and **👎 Undo** buttons are there as a fallback.

It checks, in this order:

1. **Meeting clash.** In the demo, "Deep work: quarterly report" (90 min) runs into the 14:00 Client sync. The planner splits it around the meeting: the first part fills the free time before 14:00, and the rest goes straight after the meeting. The meeting stays put and the full 90 minutes still fit. How the split falls depends on when the block starts. If the free gap before the meeting is under 15 minutes, the whole block moves after the meeting instead. A thumbs-up keeps the fix.
2. **Long blocks.** Any block longer than 90 minutes is split into focus blocks of 90 minutes or less, with another task between the parts so you get a break.
3. **Overload.** If the day runs past your free time, it says by how much and moves a low-priority block to a **Tomorrow** row.

After a focus block, later blocks shift by the measured time (for example, "done 8m early, later blocks moved 8m earlier"), and the planner runs these checks again.

The planner is rule-based and runs entirely on the device: there's no AI model, no API key and no network call. It sits behind a small `Planner` interface in `src/planner.ts`.

![The smart planner flagging the 90-minute block that runs into the 14:00 meeting](docs/screenshots/03-meeting-clash.png)

## The day summary

Press **✓ Done** on the desk to close the day. Your streak goes up if you also finished yesterday. It's a plain day count, with no other rewards. A **Day so far** panel shows:

- **Tasks:** done out of today's scheduled tasks, for example "4 of 6 scheduled done". A split task counts once, and unscheduled tasks are listed separately ("4 not scheduled").
- **Focus time:** the focus minutes actually measured by the timer.
- **Meetings:** how many and how long.
- **Postponed:** tasks moved to tomorrow.
- **Time saved** (or **Over plan**): shown only when there are measured focus blocks, always with the baseline next to it, for example "8m (planned 30m vs actual 22m)". In demo mode the clock runs fast, so this row is labelled "(demo clock, accelerated)".

It ends with a short rule-based note on why the day went that way and one suggestion for tomorrow.

![Day so far summary from the demo run: 4 of 6 done, 1h 30m focus, 1 meeting, nothing postponed, 1 meeting clash fixed, streak 5 days](docs/screenshots/04-day-summary-final.png)

## Hands-only interactions

Everything works with bare hands (controllers and mouse work too).

| Gesture | What happens |
| --- | --- |
| **Pinch-grab** a card | Picks it up. |
| **Drop on the wall timeline** | Aim the card at the timeline and open your fingers. It's placed along the head-to-card ray, so you don't have to reach the wall from your chair. |
| **Flick sideways** | Skips the card for today. |
| **Quick pinch (tap)** | Opens Focus Mode for that task. |
| **Thumbs-up / thumbs-down** | Keeps or undoes the planner's change, and thumbs-up finishes a focus block. Hold it for about half a second. |
| **Fingertip poke** | Presses buttons. |

The **hands tutorial** starts on your first visit and moves on only when you actually do each gesture. Replay it with **? Tutorial**, or add `?tutorial=1` to the URL.

## Trying it in the emulator

The autoplay demo selects the emulator's hands mode by itself. To pinch by hand on a desktop instead, outside the emulator's play mode:

1. Open [?demo=1](https://muditsharma354abc-bot.github.io/morning-desk/?demo=1) and click **Enter MR**.
2. In the emulator toolbar, **Select input mode**, then **Hands**; both panels should say hand.
3. Drag the right hand's arrows onto a card.
4. Click the **Pinch** latch (pin icon) in the right hand panel to grab it.
5. Drag the hand to the timeline.
6. Click the latch again to drop it.

## What's tested and what isn't

- Everything has been run in the built-in WebXR emulator (IWER) and its simulated room only. Nothing has been tested on a real Quest 3 yet.
- **Needs a headset to verify:** how real passthrough looks and feels, whether cards read well on a real desk, plane detection and hit-test in real rooms, anchors surviving real sessions, reboots and space changes, real-world reach and comfort (seated or standing), real hand tracking for pinch, poke and thumbs, and the VR fallback on a device without immersive-ar.
- Manual pinch through the emulator's pinch latch has been verified by script, but not yet by a person dragging by hand.
- Ray pinch on far timeline blocks is untested.

## Mixed reality: desk, wall and anchors (v2)

On a headset the app starts an immersive-ar passthrough session, so the planner sits in your real room.

- **Desk:** it looks for a table-height surface first, then tries a hit-test, and if both fail it asks you to tap to place the desk about 60 cm ahead.
- **Timeline:** it goes on a detected wall in front of you. If no wall is found, it floats about 1.1 m ahead at eye height.
- **Same spot next session:** the desk and wall positions are saved against a persistent WebXR anchor and restored next time. If the anchor can't be found, you place them again.
- **📍 Re-place** on the desk moves everything to where you're sitting now.
- **VR fallback:** if the browser can't do immersive-ar, you get a virtual room instead.

![v2 in the emulator's simulated room: desk on the room's table, timeline on its wall](docs/screenshots/05-mr-placement.png)

![Wind-down: keep or drop each unfinished task for tomorrow](docs/screenshots/06-wind-down.png)

Close-up distances: cards sit within reach (about 60 cm), the Focus and summary panels open about 0.6 m in front of you, and a task's detail card about 0.7 m. Key UI stays within about ±30° of the centre of view.

### URL flags

- `?mr=1` runs the MR flow in the emulator, seated at the simulated room's desk. Real headsets use it automatically.
- `?demo=1&autoplay=1&mr=1` is the v2 walkthrough. `?demo=1&autoplay=1&clean=1` is the original walkthrough, unchanged.
- `?tutorial=1` restarts the tutorial on a fresh sample desk, and `?hands=1` opens the emulator in hands mode.
- Test flags: `?vr=1` (as if immersive-ar weren't supported), `?noplanes=1` (forces tap to place) and `?nextday=1` (pretends it's tomorrow, to check the wind-down rollover).

## Run it locally

You need Node.js 20.19+, 22.12+ or 24+.

```bash
npm ci
npm run dev
```

`npm run dev` starts the managed IWSDK dev server and opens the app with the **built-in WebXR emulator (IWER)**, so you can enter XR on a desktop with emulated hands. In the flat view, the mouse drags cards and clicks buttons.

To try it on a **Quest 3**, the simplest path is the [live site](https://muditsharma354abc-bot.github.io/morning-desk/) in the Meta Quest Browser, then press **Enter XR**. For a local build on the headset, serve it over HTTPS (WebXR needs a secure context) or forward the dev port with `adb reverse`.

Other scripts: `npm run build` (production build to `dist/`), `npm run preview`, `npm run typecheck`.

## Deploy

```bash
scripts/deploy-pages.sh
```

It builds with the `/morning-desk/` base path and publishes `dist/` to the `gh-pages` branch, which GitHub Pages serves at <https://muditsharma354abc-bot.github.io/morning-desk/> about a minute later. Set `VITE_BASE=./` for a build that works from any folder.

## Tech stack

- [IWSDK](https://github.com/facebook/immersive-web-sdk) (`@iwsdk/core`) for the ECS world, hand grab, poke and ray interaction, plane detection and anchors, and the IWER emulator
- [three.js](https://threejs.org/) for rendering
- [pmndrs uikit](https://github.com/pmndrs/uikit) (`@pmndrs/uikit`, Horizon kit) for spatial UI
- [WebXR](https://immersive-web.github.io/webxr/) with passthrough (immersive AR) and hand tracking
- TypeScript and Vite

```
src/
  desk-system.ts   desk, wall timeline, boards, gestures, Focus Mode, summary, tutorial, wind-down, streak
  planner.ts       Planner interface + RulePlanner (meeting clash, long-block split, overload)
  state.ts         plan state, demo day with meetings, layout around meetings, local storage, streak
  autoplay.ts      ?demo=1&autoplay=1 walkthrough through emulated hands
  autoplay-v2.ts   ?demo=1&autoplay=1&mr=1 walkthrough (placement, Re-place, wind-down)
  label.ts, style.ts   canvas labels, palette, sounds
```

## License

[MIT](LICENSE) © 2026 Shubham Sharma
