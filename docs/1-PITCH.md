# PuppetMaster — Pitch Script (~45 seconds)

---

> *[Stand center stage. No screen yet.]*

"If you grew up on the internet, you remember Flash. Newgrounds, Homestar Runner, Animator vs. Animation — Flash wasn't just a plugin, it was the reason a generation learned to create. Anyone with a computer could open it up and animate.

When Adobe killed Flash, that accessibility died with it. The tools that replaced it are built for professionals with $55/month subscriptions and hours of tutorials. The kid who just wants to make a stick figure dance? Locked out.

We built **PuppetMaster** as an homage to what Flash represented — and we modernized it. Instead of dragging keyframes on a timeline, you just **move your body**. Your webcam captures your motion, AI maps it to a 2D character in real-time, and you export a portable animation file that plays in any browser.

No install. No account. No subscription. Let me show you."

> *[Turn to screen.]*

---

## Potential Questions & Answers

**Q: Why not just use After Effects or Rive?**
A: Those are professional tools with steep learning curves. PuppetMaster targets creators who want to animate quickly without training — content creators, indie game devs, students. The barrier is literally just having a webcam.

**Q: Does it work on mobile?**
A: The webcam and MediaPipe stack work on mobile browsers. The UI is currently desktop-optimized, but the core pipeline is device-agnostic.

**Q: How accurate is the pose detection?**
A: MediaPipe's PoseLandmarker lite model tracks 33 joints at ~30fps. It handles upper body very well; fast full-body movement can introduce noise, which is why we built the 7-frame smoothing algorithm.

**Q: What about custom characters?**
A: The architecture supports it — the "Upload Asset" button is the entry point. Any PNG/SVG can replace the default puppet's body parts. For this prototype we ship a default marionette character.

**Q: How is this different from motion capture tools like Rokoko or Mixamo?**
A: Those target 3D workflows and require specialized hardware or processing pipelines. PuppetMaster is 2D-native, browser-native, and zero-install. The output is a lightweight HTML file, not a 3D mesh.

**Q: Can multiple people use it at once?**
A: The current prototype tracks one person (`numPoses: 1`). The MediaPipe API supports multi-pose — it's a config flag, not an architecture change.

**Q: What's the export format?**
A: Two options: raw JSON (for developers to load into their own projects) and a standalone HTML file that embeds the animation data and a vanilla JS player. The HTML file is fully self-contained — no server, no dependencies.
