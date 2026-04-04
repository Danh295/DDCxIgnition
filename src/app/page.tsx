"use client";

import { useRef, useState, useEffect, useCallback } from "react";

// --- Constants ---
const CANVAS_W = 640;
const CANVAS_H = 480;

const STICK_CONNECTIONS: [number, number][] = [
  // Torso
  [11, 12], [11, 23], [12, 24], [23, 24],
  // Left arm
  [11, 13], [13, 15],
  // Right arm
  [12, 14], [14, 16],
  // Left leg
  [23, 25], [25, 27],
  // Right leg
  [24, 26], [26, 28],
];

const JOINT_INDICES = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

type FrameData = {
  landmarks: Landmark[][];
  timestamp: number;
};

function toCanvas(lm: Landmark): [number, number] {
  return [(1 - lm.x) * CANVAS_W, lm.y * CANVAS_H];
}

export default function Home() {
  // --- UI State (triggers re-renders) ---
  const [modelLoaded, setModelLoaded] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [fps, setFps] = useState(0);
  const [debugWrist, setDebugWrist] = useState("—");
  const [error, setError] = useState<string | null>(null);
  const [frameCount, setFrameCount] = useState(0);

  // --- Refs (mutated at 30fps, no re-renders) ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const poseLandmarkerRef = useRef<any>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const animationFrameIdRef = useRef<number>(0);
  const lastVideoTimeRef = useRef<number>(-1);
  const currentLandmarksRef = useRef<Landmark[][] | null>(null);
  const recordingBufferRef = useRef<FrameData[]>([]);
  const isRecordingRef = useRef(false);
  const isPlayingRef = useRef(false);
  const playbackIndexRef = useRef(0);
  const playbackStartTimeRef = useRef(0);
  const fpsTimestampsRef = useRef<number[]>([]);
  const lastDebugUpdateRef = useRef(0);

  // --- Drawing ---
  const drawStickman = useCallback((allLandmarks: Landmark[][] | null) => {
    const ctx = ctxRef.current;
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Grid background for visual appeal
    ctx.strokeStyle = "rgba(0, 255, 136, 0.05)";
    ctx.lineWidth = 1;
    for (let i = 0; i < CANVAS_W; i += 40) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, CANVAS_H);
      ctx.stroke();
    }
    for (let i = 0; i < CANVAS_H; i += 40) {
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(CANVAS_W, i);
      ctx.stroke();
    }

    if (!allLandmarks || allLandmarks.length === 0) return;

    const lm = allLandmarks[0];

    // Draw bones
    ctx.strokeStyle = "#00FF88";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.shadowColor = "#00FF88";
    ctx.shadowBlur = 8;

    for (const [i, j] of STICK_CONNECTIONS) {
      const vi = lm[i]?.visibility ?? 1;
      const vj = lm[j]?.visibility ?? 1;
      if (vi > 0.5 && vj > 0.5) {
        const [x1, y1] = toCanvas(lm[i]);
        const [x2, y2] = toCanvas(lm[j]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }

    // Draw joints
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#FFFFFF";
    for (const i of JOINT_INDICES) {
      const v = lm[i]?.visibility ?? 1;
      if (v > 0.5) {
        const [x, y] = toCanvas(lm[i]);
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw head circle at nose
    const noseVis = lm[0]?.visibility ?? 1;
    if (noseVis > 0.5) {
      const [hx, hy] = toCanvas(lm[0]);
      ctx.beginPath();
      ctx.arc(hx, hy, 22, 0, Math.PI * 2);
      ctx.strokeStyle = "#00FF88";
      ctx.lineWidth = 3;
      ctx.shadowColor = "#00FF88";
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }, []);

  // --- The Loop ---
  const loop = useCallback(() => {
    animationFrameIdRef.current = requestAnimationFrame(loop);

    // Phase 1: Get landmarks
    if (isPlayingRef.current) {
      const buffer = recordingBufferRef.current;
      if (buffer.length === 0) {
        isPlayingRef.current = false;
        setIsPlaying(false);
        return;
      }

      // Timestamp-based playback for correct speed
      const elapsed = performance.now() - playbackStartTimeRef.current;
      const baseTime = buffer[0].timestamp;
      let idx = playbackIndexRef.current;

      // Advance to the correct frame based on elapsed time
      while (
        idx < buffer.length - 1 &&
        buffer[idx + 1].timestamp - baseTime <= elapsed
      ) {
        idx++;
      }

      if (idx >= buffer.length - 1) {
        // Loop playback
        playbackIndexRef.current = 0;
        playbackStartTimeRef.current = performance.now();
        idx = 0;
      } else {
        playbackIndexRef.current = idx;
      }

      currentLandmarksRef.current = buffer[idx].landmarks;
    } else {
      // Live detection
      const video = videoRef.current;
      const landmarker = poseLandmarkerRef.current;
      if (video && landmarker && video.readyState >= 2) {
        if (video.currentTime !== lastVideoTimeRef.current) {
          lastVideoTimeRef.current = video.currentTime;
          try {
            const result = landmarker.detectForVideo(video, performance.now());
            if (result.landmarks && result.landmarks.length > 0) {
              currentLandmarksRef.current = result.landmarks;
            }
          } catch {
            // Model not ready yet, skip frame
          }
        }
      }
    }

    // Phase 2: Record
    if (isRecordingRef.current && currentLandmarksRef.current) {
      recordingBufferRef.current.push({
        landmarks: structuredClone(currentLandmarksRef.current),
        timestamp: performance.now(),
      });
    }

    // Phase 3: Draw
    drawStickman(currentLandmarksRef.current);

    // Phase 4: Debug panel (throttled to ~4Hz)
    const now = performance.now();
    fpsTimestampsRef.current.push(now);
    if (fpsTimestampsRef.current.length > 30) {
      fpsTimestampsRef.current.shift();
    }

    if (now - lastDebugUpdateRef.current > 250) {
      lastDebugUpdateRef.current = now;
      const ts = fpsTimestampsRef.current;
      if (ts.length > 1) {
        const elapsed = ts[ts.length - 1] - ts[0];
        setFps(Math.round(((ts.length - 1) / elapsed) * 1000));
      }

      if (currentLandmarksRef.current && currentLandmarksRef.current[0]) {
        const wrist = currentLandmarksRef.current[0][16]; // right wrist
        if (wrist) {
          setDebugWrist(
            JSON.stringify({
              x: +wrist.x.toFixed(4),
              y: +wrist.y.toFixed(4),
              z: +wrist.z.toFixed(4),
            })
          );
        }
      }

      setFrameCount(recordingBufferRef.current.length);
    }
  }, [drawStickman]);

  // --- Init ---
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        // Dynamic import — SSR safe
        const { PoseLandmarker, FilesetResolver } = await import(
          "@mediapipe/tasks-vision"
        );

        if (cancelled) return;

        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm"
        );

        if (cancelled) return;

        const landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numPoses: 1,
        });

        if (cancelled) return;
        poseLandmarkerRef.current = landmarker;

        // Webcam
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: CANVAS_W, height: CANVAS_H, facingMode: "user" },
        });

        if (cancelled) return;

        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();

        // Canvas
        ctxRef.current = canvasRef.current!.getContext("2d")!;

        setModelLoaded(true);
      } catch (err) {
        console.error("Init failed:", err);
        setError(
          err instanceof Error ? err.message : "Failed to initialize"
        );
      }
    }

    init();

    return () => {
      cancelled = true;
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
    };
  }, []);

  // Start loop once model is loaded
  useEffect(() => {
    if (modelLoaded) {
      loop();
    }
    return () => {
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
    };
  }, [modelLoaded, loop]);

  // --- Controls ---
  const toggleRecording = useCallback(() => {
    if (isRecordingRef.current) {
      isRecordingRef.current = false;
      setIsRecording(false);
    } else {
      recordingBufferRef.current = [];
      playbackIndexRef.current = 0;
      isRecordingRef.current = true;
      setIsRecording(true);
    }
  }, []);

  const togglePlayback = useCallback(() => {
    if (isPlayingRef.current) {
      isPlayingRef.current = false;
      setIsPlaying(false);
    } else if (recordingBufferRef.current.length > 0) {
      playbackIndexRef.current = 0;
      playbackStartTimeRef.current = performance.now();
      isPlayingRef.current = true;
      setIsPlaying(true);
    }
  }, []);

  // --- Render ---
  return (
    <main className="relative h-screen w-screen bg-gray-950 flex items-center justify-center overflow-hidden">
      {/* Title */}
      <div className="absolute top-6 left-6 z-10">
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Puppet<span className="text-green-400">Master</span>
        </h1>
        <p className="text-xs text-gray-500 mt-1">
          Flash reimagined — animate with your body
        </p>
      </div>

      {/* Loading */}
      {!modelLoaded && !error && (
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm animate-pulse">
            Loading PoseLandmarker model...
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="text-red-400 text-sm max-w-md text-center px-4">
          <p className="font-bold mb-2">Initialization Error</p>
          <p>{error}</p>
        </div>
      )}

      {/* Hidden video — detection source only */}
      <video
        ref={videoRef}
        className="absolute opacity-0 pointer-events-none"
        width={CANVAS_W}
        height={CANVAS_H}
        playsInline
        muted
      />

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        className={`rounded-xl border border-gray-800 shadow-2xl ${modelLoaded ? "" : "hidden"}`}
      />

      {/* Controls */}
      {modelLoaded && (
        <div className="absolute bottom-6 right-6 flex gap-3">
          <button
            onClick={toggleRecording}
            disabled={isPlaying}
            className={`px-5 py-2.5 rounded-lg font-bold text-sm transition-all ${
              isRecording
                ? "bg-red-600 text-white shadow-lg shadow-red-600/30 animate-pulse"
                : "bg-red-500/90 text-white hover:bg-red-400 disabled:opacity-30"
            }`}
          >
            {isRecording ? "Stop Rec" : "Record"}
          </button>
          <button
            onClick={togglePlayback}
            disabled={recordingBufferRef.current.length === 0 && !isPlaying}
            className={`px-5 py-2.5 rounded-lg font-bold text-sm transition-all ${
              isPlaying
                ? "bg-blue-600 text-white shadow-lg shadow-blue-600/30"
                : "bg-blue-500/90 text-white hover:bg-blue-400 disabled:opacity-30"
            }`}
          >
            {isPlaying ? "Stop" : "Play"}
          </button>
        </div>
      )}

      {/* Debug Panel */}
      {modelLoaded && (
        <div className="absolute bottom-6 left-6 bg-black/80 backdrop-blur-sm text-green-400 font-mono text-xs p-4 rounded-lg border border-green-400/20 min-w-[260px]">
          <div className="text-green-300/60 text-[10px] uppercase tracking-widest mb-2">
            Debug Panel
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">FPS</span>
            <span>{fps}</span>
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-gray-500">Frames</span>
            <span>{frameCount}</span>
          </div>
          <div className="mt-2 pt-2 border-t border-green-400/10">
            <div className="text-gray-500 mb-1">R.Wrist</div>
            <div className="text-[11px] break-all">{debugWrist}</div>
          </div>
        </div>
      )}

      {/* Recording indicator */}
      {isRecording && (
        <div className="absolute top-6 right-6 flex items-center gap-2">
          <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
          <span className="text-red-400 text-xs font-mono">REC</span>
        </div>
      )}

      {/* Playback indicator */}
      {isPlaying && (
        <div className="absolute top-6 right-6 flex items-center gap-2">
          <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse" />
          <span className="text-blue-400 text-xs font-mono">PLAYBACK</span>
        </div>
      )}
    </main>
  );
}
