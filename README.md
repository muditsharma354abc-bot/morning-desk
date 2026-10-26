# Morning Desk

A 5-minute mixed-reality morning planning ritual for Meta Quest 3, built with WebXR and IWSDK (`@iwsdk/core`).

**Live:** https://muditsharma354abc-bot.github.io/morning-desk/ (add `?demo=1` for the demo state)

- Passthrough AR. A desk of task cards sits within seated reach. The wall timeline pins to a detected wall (plane detection + anchor). With no wall, it is placed 1.2 m ahead at eye height, and the header says so.
- Hands first: pinch-grab a card, aim it at the timeline and let go to schedule it. Flick it sideways to skip it. A quick pinch opens its details.
- Planner agent (rule-based, pluggable `Planner` interface): splits blocks over 90 min and detects overload (scheduled > available), then moves the lowest-priority block to tomorrow. Each change animates and can be kept (👍) or undone (👎).
- Daily streak with a desk plant that grows, a 30-second hands tutorial, and soft pentatonic sounds.
- Runs on desktop through the built-in IWER emulator (no extension needed). In the flat view, the mouse drags cards and clicks buttons.

```bash
npm install
npm run dev          # managed IWSDK dev server + emulator
npm run build        # dist/ with base /morning-desk/ (override: VITE_BASE=./)
```

MIT © 2026 Shubham Sharma
