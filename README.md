🎭 PuppetMaster

PuppetMaster is Flash reimagined for the AI era — instead of keyframing animations by hand, you perform them with your body.

⸻

🚀 Overview

PuppetMaster is a browser-based 2D animation studio that uses real-time pose detection to turn your body movements into character animation.

No installs. No plugins. No expensive software.

Just open your laptop, move, and animate.

⸻

✨ Features
	•	🎥 Real-Time Motion Capture
Uses your webcam to track 33 body landmarks and map them onto a 2D puppet live at ~30fps.
	•	🧍 Perform-Based Animation
Animate by acting — your body becomes the controller.
	•	✋ Gesture Controls
Start/stop recording using hand gestures (no mouse required).
	•	🎬 Timeline Editor (NLE-style)
	•	Scrub through frames
	•	Trim clips
	•	Append recordings
	•	Non-linear editing workflow
	•	🧈 Motion Smoothing
Apply rolling-average smoothing for cleaner animations.
	•	📦 Export Anywhere
Export as a standalone HTML file — shareable, portable, runs in any browser.

⸻

🧠 How It Works
	1.	Webcam captures video input
	2.	Pose detection extracts 33 skeletal landmarks per frame
	3.	Landmarks are transformed into joint rotations
	4.	A rigged 2D character is rendered on canvas
	5.	Motion data is recorded into a timeline buffer
	6.	Playback, edit, smooth, and export

⸻

🛠️ Tech Stack
	•	Frontend: React + HTML5 Canvas
	•	Pose Detection: MediaPipe Pose
	•	Rendering: Canvas 2D API
	•	State Handling: useRef for real-time data (avoids re-render lag)

⸻

⚡ Performance
	•	Runs at ~30fps in-browser
	•	Minimal React re-renders (~4/sec)
	•	All animation logic runs outside React’s render cycle

⸻

🎮 Controls

Action	Gesture
Start Recording	Right hand above head (hold)
Stop / Play	Left hand above head (hold)
Cancel	Both hands above head


⸻

📤 Export
	•	JSON → raw animation data
	•	HTML Player → self-contained animation file
	•	No dependencies
	•	Auto-play + loop
	•	Works offline

⸻

🔮 Vision

PuppetMaster is the foundation for a spatial animation OS:
	•	Import custom characters & rigs
	•	Layer multiple animations
	•	Build motion libraries
	•	Collaborate in real time
	•	Publish directly to the web

⸻

🧪 Demo Use Cases
	•	Social media animations
	•	Indie game character prototyping
	•	Storyboarding
	•	Educational content
	•	Meme creation (yes, really)

⸻

🏁 Getting Started

git clone https://github.com/your-username/puppetmaster.git
cd puppetmaster
npm install
npm run dev

Open in browser → enable camera → start moving.

⸻

⚠️ Requirements
	•	Webcam access
	•	Modern browser (Chrome recommended)
	•	Good lighting for best tracking

⸻

💡 Why This Matters

Animation has always been gated by time, skill, and tools.

PuppetMaster removes that barrier.

You don’t animate anymore —
you perform.

⸻

📄 License

MIT (or choose your preferred license)

⸻

🙌 Acknowledgements
	•	MediaPipe for pose detection
	•	The web platform for making this possible

⸻

👀 Final Thought

Every creator with a webcam is now an animator.