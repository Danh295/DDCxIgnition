# PuppetMaster — Demo Walkthrough (~2 minutes)

---

### Beat 1: Live Tracking (15 sec)

> *[PuppetMaster is loaded. Step into frame.]*

"On the left — the MoCap Studio: my raw webcam with a skeletal wireframe overlaid in real-time. On the right — the Stage: a 2D puppet mirroring every joint. 33 landmarks, 30 frames per second, running entirely in the browser."

> *[Wave hands, tilt body.]*

---

### Beat 2: Gesture Recording (25 sec)

"I don't need the mouse. Watch — I raise my right hand above my head."

> *[Raise RIGHT hand. Hold 4 seconds. Countdown appears. "Get Ready... 2... 1..."]*

"4-second hold confirms intent. 2-second countdown to get into position. Now I'm recording."

> *[Perform a clear motion — 5 seconds. Then raise LEFT hand to stop.]*

"Left hand stops it — and it auto-trims the stop gesture from the recording."

---

### Beat 3: Timeline Editing (20 sec)

"The timeline shows my frames. I can click anywhere to scrub."

> *[Click-scrub across the timeline.]*

"These red handles are trim markers — drag to crop dead air."

> *[Drag a trim handle. Release.]*

"And one button — Smooth — applies a rolling average across all joints."

> *[Click Smooth. Click Play. Buttery playback.]*

---

### Beat 4: Asset Layers (30 sec)

"Now — layered assets. I add a layer, pick a hat, and bind it to a body part."

> *[Click '+ Add Layer'. Select 'hat'. Click 'Bind to body part...'. Click Head hotspot.]*

"The hat tracks my head live. I click the layer to make it the active recording target — now the Stage shows only the hat, and recording is independent from the puppet."

> *[Click the hat layer card. Record 3 seconds of head movement. Stop.]*

"Two tracks in the timeline — puppet and hat — each recorded separately. Switch back to puppet and they composite together."

> *[Click '2D Character (Puppet)'. Click Play.]*

---

### Beat 5: Export (15 sec)

"Flash published `.swf` files. We publish to the open web."

> *[Click Publish. Click 'Export Player (.html)'. Open the downloaded file.]*

"One HTML file. No server, no dependencies. The animation data is embedded as JSON with an 80-line vanilla JS player. Email it to someone — it just works."

---

### Beat 6: Close (15 sec)

"Flash gave a generation the tools to create. PuppetMaster brings that back — but instead of hours of keyframing, you just move.

Every creator with a webcam becomes an animator."

---

## Timing

| Beat | Duration |
|------|----------|
| Live tracking | 15s |
| Gesture recording | 25s |
| Timeline editing | 20s |
| Asset layers | 30s |
| Export | 15s |
| Close | 15s |
| **Total** | **~2:00** |

## Emergency Bailouts

| Problem | Say this |
|---------|----------|
| Camera won't load | "WASM loads from CDN — one sec." Refresh. |
| Gesture misfire | "The 4-second hold prevents accidental triggers. Let me use the button." Click Record. |
| FPS drop | "Lite model on this hardware — full model does 60fps on GPU." |
| Bind click misses | Click again, aim for the orange circle center. |
| Export won't open | Open a pre-exported backup. "From our rehearsal." |
