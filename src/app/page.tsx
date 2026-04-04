"use client";

import { useRef, useState, useEffect, useCallback } from "react";

// ─── Canvas Dimensions ────────────────��──────────────────────
const MOCAP_W = 320;
const MOCAP_H = 240;
const STAGE_W = 800;
const STAGE_H = 560;
const TIMELINE_H = 80;
/** Timeline bar spans at least this many “slots” so ~1 min @ 30fps fits the full width when the clip is short. */
const TIMELINE_ASSUMED_FPS = 30;
const TIMELINE_MIN_VISIBLE_FRAMES = TIMELINE_ASSUMED_FPS * 60;
/** How long the arm pose must be held (after HUD appears) before record/play fires. Tune here — peace-sign etc. needs Hand Landmarker, not Pose-only. */
const GESTURE_ARM_MS = 4000;
/** After right-hand pose completes: “Get ready… 2… 1…” before capture starts. */
const PRE_RECORD_COUNTDOWN_MS = 2000;
const TRIM_HANDLE_PX = 10;

type GestureHudState =
  | null
  | {
      mode: "pose_hold";
      side: "right" | "left";
      secondsLeft: number;
      action: string;
    }
  | { mode: "get_ready"; secondsLeft: number };

// ─── Types ───────────────────────────────────────────────────
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

// ─── Skeleton Connections (for wireframe) ────────────────────
const WIRE_CONNECTIONS: [number, number][] = [
  [11, 12], [11, 23], [12, 24], [23, 24], // torso
  [11, 13], [13, 15],                       // left arm
  [12, 14], [14, 16],                       // right arm
  [23, 25], [25, 27],                       // left leg
  [24, 26], [26, 28],                       // right leg
];
const JOINT_INDICES = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

// ─── Coordinate Helpers ──────────────────────────────────────
function toCS(lm: Landmark, W: number, H: number): [number, number] {
  return [(1 - lm.x) * W, lm.y * H];
}

function vis(lm: Landmark | undefined, threshold = 0.4): boolean {
  if (!lm) return false;
  return (lm.visibility ?? 1) > threshold;
}

// ─── Smoothing ────────────────────────────────���──────────────
function applySmoothing(frames: FrameData[], window = 7): FrameData[] {
  const half = Math.floor(window / 2);
  return frames.map((frame, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(frames.length - 1, i + half);
    const slice = frames.slice(lo, hi + 1);
    const n = slice.length;
    const smoothed = frame.landmarks[0].map((_, li) => ({
      x: slice.reduce((s, f) => s + f.landmarks[0][li].x, 0) / n,
      y: slice.reduce((s, f) => s + f.landmarks[0][li].y, 0) / n,
      z: slice.reduce((s, f) => s + f.landmarks[0][li].z, 0) / n,
      visibility: frame.landmarks[0][li].visibility ?? 1,
    }));
    return { ...frame, landmarks: [smoothed] };
  });
}

// ─── Character Drawing (Stage) ───────────────────────────────
function drawCharacterOnCanvas(
  ctx: CanvasRenderingContext2D,
  allLandmarks: Landmark[][] | null,
  W: number,
  H: number
) {
  // White stage
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // Subtle grid
  ctx.strokeStyle = "rgba(0, 0, 0, 0.04)";
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y < H; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  if (!allLandmarks || allLandmarks.length === 0) return;
  const lm = allLandmarks[0];

  // Helpers
  const pt = (i: number) => toCS(lm[i], W, H);
  const mid = (a: number, b: number): [number, number] => {
    const [ax, ay] = pt(a);
    const [bx, by] = pt(b);
    return [(ax + bx) / 2, (ay + by) / 2];
  };

  function drawLimb(
    a: number,
    b: number,
    width: number,
    fill: string,
    stroke: string
  ) {
    if (!vis(lm[a]) || !vis(lm[b])) return;
    const [x1, y1] = pt(a);
    const [x2, y2] = pt(b);
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const len = Math.hypot(x2 - x1, y2 - y1);

    ctx.save();
    ctx.translate(x1, y1);
    ctx.rotate(angle);

    // Rounded rectangle along the bone
    const hw = width / 2;
    const r = Math.min(hw, 6);
    ctx.beginPath();
    ctx.moveTo(r, -hw);
    ctx.lineTo(len - r, -hw);
    ctx.arcTo(len, -hw, len, -hw + r, r);
    ctx.lineTo(len, hw - r);
    ctx.arcTo(len, hw, len - r, hw, r);
    ctx.lineTo(r, hw);
    ctx.arcTo(0, hw, 0, hw - r, r);
    ctx.lineTo(0, -(hw - r));
    ctx.arcTo(0, -hw, r, -hw, r);
    ctx.closePath();

    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();
  }

  function drawJoint(i: number, radius: number) {
    if (!vis(lm[i])) return;
    const [x, y] = pt(i);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = "#e67e22";
    ctx.fill();
    ctx.strokeStyle = "#c0561a";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // ── Draw Order: legs → torso → arms → head ──

  // LEGS
  drawLimb(23, 25, 22, "#1e4d5c", "#163a47"); // L upper leg
  drawLimb(25, 27, 16, "#1e4d5c", "#163a47"); // L lower leg
  drawLimb(24, 26, 22, "#1e4d5c", "#163a47"); // R upper leg
  drawLimb(26, 28, 16, "#1e4d5c", "#163a47"); // R lower leg

  // Shoes
  for (const ankle of [27, 28]) {
    if (!vis(lm[ankle])) continue;
    const [ax, ay] = pt(ankle);
    ctx.fillStyle = "#2c3e50";
    ctx.beginPath();
    ctx.ellipse(ax, ay + 6, 14, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#1a2634";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // TORSO (quadrilateral from shoulders to hips)
  if (vis(lm[11]) && vis(lm[12]) && vis(lm[23]) && vis(lm[24])) {
    const [lsx, lsy] = pt(11);
    const [rsx, rsy] = pt(12);
    const [lhx, lhy] = pt(23);
    const [rhx, rhy] = pt(24);

    // Slightly widen shoulders
    const expand = 8;
    ctx.beginPath();
    ctx.moveTo(lsx - expand, lsy);
    ctx.lineTo(rsx + expand, rsy);
    ctx.lineTo(rhx + 4, rhy);
    ctx.lineTo(lhx - 4, lhy);
    ctx.closePath();
    ctx.fillStyle = "#2d6a7a";
    ctx.fill();
    ctx.strokeStyle = "#1f4f5c";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Belt detail
    const beltY = (lhy + lsy) * 0.85 + (rhy + rsy) * 0.15;
    const beltLX = lhx - 2 + (lsx - lhx) * 0.15;
    const beltRX = rhx + 2 + (rsx - rhx) * 0.15;
    ctx.beginPath();
    ctx.moveTo(beltLX, beltY);
    ctx.lineTo(beltRX, beltY);
    ctx.strokeStyle = "#1f4f5c";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // ARMS
  drawLimb(11, 13, 16, "#4a9aad", "#3a7a8a"); // L upper arm
  drawLimb(13, 15, 12, "#4a9aad", "#3a7a8a"); // L lower arm
  drawLimb(12, 14, 16, "#4a9aad", "#3a7a8a"); // R upper arm
  drawLimb(14, 16, 12, "#4a9aad", "#3a7a8a"); // R lower arm

  // Hands
  for (const wrist of [15, 16]) {
    if (!vis(lm[wrist])) continue;
    const [wx, wy] = pt(wrist);
    ctx.beginPath();
    ctx.arc(wx, wy, 8, 0, Math.PI * 2);
    ctx.fillStyle = "#f5efe6";
    ctx.fill();
    ctx.strokeStyle = "#c4b9a8";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // JOINTS (marionette hinges)
  for (const j of [11, 12, 13, 14, 23, 24, 25, 26]) {
    drawJoint(j, 5);
  }

  // HEAD
  if (vis(lm[0]) && vis(lm[11]) && vis(lm[12])) {
    const [nx, ny] = pt(0);
    const shoulderW = Math.hypot(...[pt(11)[0] - pt(12)[0], pt(11)[1] - pt(12)[1]].map(Math.abs));
    const headR = Math.max(24, shoulderW * 0.35);

    // Head circle
    ctx.beginPath();
    ctx.arc(nx, ny, headR, 0, Math.PI * 2);
    ctx.fillStyle = "#f5efe6";
    ctx.fill();
    ctx.strokeStyle = "#c4b9a8";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Eyes
    ctx.fillStyle = "#1a1a1a";
    const eyeOff = headR * 0.3;
    ctx.beginPath();
    ctx.ellipse(nx - eyeOff, ny - headR * 0.1, 3.5, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(nx + eyeOff, ny - headR * 0.1, 3.5, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Mouth
    ctx.beginPath();
    ctx.arc(nx, ny + headR * 0.3, headR * 0.2, 0, Math.PI);
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Antenna
    const antH = headR * 0.5;
    ctx.beginPath();
    ctx.moveTo(nx, ny - headR);
    ctx.lineTo(nx, ny - headR - antH);
    ctx.strokeStyle = "#c4b9a8";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(nx, ny - headR - antH, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#e67e22";
    ctx.fill();
  }

  // Neck line (shoulders midpoint → head)
  if (vis(lm[0]) && vis(lm[11]) && vis(lm[12])) {
    const [nx, ny] = pt(0);
    const [mx, my] = mid(11, 12);
    const shoulderW = Math.hypot(pt(11)[0] - pt(12)[0], pt(11)[1] - pt(12)[1]);
    const headR = Math.max(24, shoulderW * 0.35);
    ctx.beginPath();
    ctx.moveTo(mx, my);
    ctx.lineTo(nx, ny + headR);
    ctx.strokeStyle = "#f5efe6";
    ctx.lineWidth = 10;
    ctx.stroke();
    ctx.strokeStyle = "#c4b9a8";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

// ─── MoCap Wireframe Drawing ─────────────────────────────────
// NOTE: MoCap canvas has CSS transform: scaleX(-1) for selfie mirror.
// We draw in RAW camera space (no X-flip) so wireframe aligns with video.
function toMoCap(lm: Landmark): [number, number] {
  return [lm.x * MOCAP_W, lm.y * MOCAP_H];
}

function drawMoCap(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  landmarks: Landmark[][] | null
) {
  // Blit video frame (raw camera space)
  ctx.drawImage(video, 0, 0, MOCAP_W, MOCAP_H);

  // Semi-transparent overlay for contrast
  ctx.fillStyle = "rgba(0, 0, 0, 0.15)";
  ctx.fillRect(0, 0, MOCAP_W, MOCAP_H);

  if (!landmarks || landmarks.length === 0) return;
  const lm = landmarks[0];

  // Bones
  ctx.strokeStyle = "#00FF88";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.shadowColor = "#00FF88";
  ctx.shadowBlur = 6;

  for (const [i, j] of WIRE_CONNECTIONS) {
    if (!vis(lm[i]) || !vis(lm[j])) continue;
    const [x1, y1] = toMoCap(lm[i]);
    const [x2, y2] = toMoCap(lm[j]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  ctx.shadowBlur = 0;

  // Joints
  ctx.fillStyle = "#ffffff";
  for (const i of JOINT_INDICES) {
    if (!vis(lm[i])) continue;
    const [x, y] = toMoCap(lm[i]);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ─── Timeline layout (min width = 1 minute @ TIMELINE_ASSUMED_FPS; longer clips still fit whole bar) ────
function timelineMaxVisible(bufferLen: number) {
  return Math.max(bufferLen, TIMELINE_MIN_VISIBLE_FRAMES);
}

function frameIndexFromCanvasX(canvasX: number, canvasW: number, bufferLen: number) {
  if (bufferLen <= 0) return 0;
  const mv = timelineMaxVisible(bufferLen);
  let idx = Math.floor((canvasX / canvasW) * mv);
  return Math.max(0, Math.min(idx, bufferLen - 1));
}

function canvasXForFrameStart(frameIdx: number, canvasW: number, bufferLen: number) {
  const mv = timelineMaxVisible(bufferLen);
  return (frameIdx / mv) * canvasW;
}

function canvasXForFrameEnd(frameIdx: number, canvasW: number, bufferLen: number) {
  const mv = timelineMaxVisible(bufferLen);
  return ((frameIdx + 1) / mv) * canvasW;
}

function timelineHitKind(
  canvasX: number,
  canvasW: number,
  bufferLen: number,
  trimIn: number,
  trimOut: number
): "in" | "out" | "scrub" {
  if (bufferLen <= 1) return "scrub";
  const xIn = canvasXForFrameStart(trimIn, canvasW, bufferLen);
  const xOut = canvasXForFrameEnd(trimOut, canvasW, bufferLen);
  if (Math.abs(canvasX - xIn) <= TRIM_HANDLE_PX) return "in";
  if (Math.abs(canvasX - xOut) <= TRIM_HANDLE_PX) return "out";
  return "scrub";
}

// ─── Timeline Drawing ────────────────────────────────────────
function drawTimeline(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  bufferLen: number,
  playbackIdx: number,
  isPlaying: boolean,
  isSmoothed: boolean,
  trimIn: number,
  trimOut: number,
  isRecording: boolean,
  showTrimHandles: boolean
) {
  const h = TIMELINE_H;
  ctx.fillStyle = "#3a3a3a";
  ctx.fillRect(0, 0, canvasW, h);

  if (bufferLen === 0) {
    // Empty timeline — show frame grid
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 1;
    for (let x = 0; x < canvasW; x += 12) {
      ctx.beginPath();
      ctx.moveTo(x, 20);
      ctx.lineTo(x, h - 4);
      ctx.stroke();
    }
    // Frame numbers
    ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
    ctx.font = "9px 'JetBrains Mono', monospace";
    for (let f = 0; f * 12 < canvasW; f += 5) {
      ctx.fillText(String(f + 1), f * 12 + 2, 14);
    }
    return;
  }

  const maxVisible = timelineMaxVisible(bufferLen);
  const cellW = canvasW / maxVisible;

  const tIn = isRecording ? 0 : Math.max(0, Math.min(trimIn, bufferLen - 1));
  const tOut = isRecording ? bufferLen - 1 : Math.max(tIn, Math.min(trimOut, bufferLen - 1));

  // Frame number ruler
  ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
  ctx.font = "9px 'JetBrains Mono', monospace";
  const step = Math.max(1, Math.floor(10 / cellW) * 5) || 5;
  for (let f = 0; f < bufferLen; f += step) {
    const x = (f / maxVisible) * canvasW;
    ctx.fillText(String(f + 1), x + 1, 14);
  }

  const fillColor = isSmoothed ? "#3d8dcc" : "#c0c0c0";
  const dimColor = "rgba(30, 30, 30, 0.72)";

  // Filled frame cells + dim outside trim (when not recording)
  for (let i = 0; i < bufferLen; i++) {
    const x = (i / maxVisible) * canvasW;
    ctx.fillStyle = fillColor;
    ctx.fillRect(x, 20, Math.max(1, cellW - 1), h - 24);
    if (!isRecording && (i < tIn || i > tOut)) {
      ctx.fillStyle = dimColor;
      ctx.fillRect(x, 20, Math.max(1, cellW - 1), h - 24);
    }
  }

  // Keyframe markers every 30 frames (inside strip)
  ctx.fillStyle = "#ffffff";
  for (let i = 0; i < bufferLen; i += 30) {
    const x = (i / maxVisible) * canvasW + cellW / 2;
    ctx.beginPath();
    ctx.arc(x, h - 8, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Trim handles (draggable in / out)
  if (showTrimHandles && !isRecording && bufferLen > 1) {
    const xIn = canvasXForFrameStart(tIn, canvasW, bufferLen);
    const xOut = canvasXForFrameEnd(tOut, canvasW, bufferLen);
    ctx.fillStyle = "rgba(236, 28, 36, 0.22)";
    ctx.fillRect(xIn, 20, Math.max(0, xOut - xIn), h - 24);
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#ec1c24";
    ctx.lineWidth = 1;
    for (const x of [xIn, xOut]) {
      ctx.fillRect(x - 3, 16, 6, h - 18);
      ctx.strokeRect(x - 3, 16, 6, h - 18);
    }
  }

  // Playhead (center of current frame cell)
  if (bufferLen > 0) {
    const headX = ((playbackIdx + 0.5) / maxVisible) * canvasW;
    ctx.strokeStyle = "#ec1c24";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(headX, 0);
    ctx.lineTo(headX, h);
    ctx.stroke();
    ctx.fillStyle = "#ec1c24";
    ctx.beginPath();
    ctx.moveTo(headX - 5, 0);
    ctx.lineTo(headX + 5, 0);
    ctx.lineTo(headX, 8);
    ctx.closePath();
    ctx.fill();
  }
}

// ─── Standalone HTML Export ──────────────────────────────────
function generatePlayerHTML(timelineJSON: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PuppetMaster Export</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#d4d4d4;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:system-ui,sans-serif}
h1{font-size:18px;color:#1a1a1a;margin-bottom:12px}
h1 span{color:#ec1c24}
canvas{border:2px solid #b8b8b8;background:#fff;box-shadow:0 4px 20px rgba(0,0,0,0.15)}
p{font-size:11px;color:#888;margin-top:10px}
</style>
</head>
<body>
<h1>Puppet<span>Master</span> Export</h1>
<canvas id="c" width="800" height="560"></canvas>
<p>Auto-playing recorded animation</p>
<script>
const T=${timelineJSON};
const ctx=document.getElementById("c").getContext("2d");
let si=0,st=performance.now();
function pt(l,W,H){return[(1-l.x)*W,l.y*H]}
function v(l){return l&&(l.visibility??1)>0.4}
function limb(a,b,w,f,s,lm){
if(!v(lm[a])||!v(lm[b]))return;
const[x1,y1]=pt(lm[a],800,560),[x2,y2]=pt(lm[b],800,560);
const an=Math.atan2(y2-y1,x2-x1),ln=Math.hypot(x2-x1,y2-y1),hw=w/2,r=Math.min(hw,6);
ctx.save();ctx.translate(x1,y1);ctx.rotate(an);
ctx.beginPath();ctx.moveTo(r,-hw);ctx.lineTo(ln-r,-hw);ctx.arcTo(ln,-hw,ln,-hw+r,r);
ctx.lineTo(ln,hw-r);ctx.arcTo(ln,hw,ln-r,hw,r);ctx.lineTo(r,hw);ctx.arcTo(0,hw,0,hw-r,r);
ctx.lineTo(0,-(hw-r));ctx.arcTo(0,-hw,r,-hw,r);ctx.closePath();
ctx.fillStyle=f;ctx.fill();ctx.strokeStyle=s;ctx.lineWidth=1.5;ctx.stroke();ctx.restore();
}
function joint(i,lm){if(!v(lm[i]))return;const[x,y]=pt(lm[i],800,560);
ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fillStyle="#e67e22";ctx.fill();
ctx.strokeStyle="#c0561a";ctx.lineWidth=1.5;ctx.stroke();}
function draw(lm){
ctx.fillStyle="#fff";ctx.fillRect(0,0,800,560);
ctx.strokeStyle="rgba(0,0,0,0.04)";ctx.lineWidth=1;
for(let x=0;x<800;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,560);ctx.stroke()}
for(let y=0;y<560;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(800,y);ctx.stroke()}
if(!lm||!lm.length)return;const l=lm[0];
limb(23,25,22,"#1e4d5c","#163a47",l);limb(25,27,16,"#1e4d5c","#163a47",l);
limb(24,26,22,"#1e4d5c","#163a47",l);limb(26,28,16,"#1e4d5c","#163a47",l);
[27,28].forEach(a=>{if(!v(l[a]))return;const[x,y]=pt(l[a],800,560);
ctx.fillStyle="#2c3e50";ctx.beginPath();ctx.ellipse(x,y+6,14,8,0,0,Math.PI*2);ctx.fill();
ctx.strokeStyle="#1a2634";ctx.lineWidth=1.5;ctx.stroke()});
if(v(l[11])&&v(l[12])&&v(l[23])&&v(l[24])){
const[a,b]=pt(l[11],800,560),[c,d]=pt(l[12],800,560),[e,f]=pt(l[23],800,560),[g,h]=pt(l[24],800,560);
ctx.beginPath();ctx.moveTo(a-8,b);ctx.lineTo(c+8,d);ctx.lineTo(g+4,h);ctx.lineTo(e-4,f);ctx.closePath();
ctx.fillStyle="#2d6a7a";ctx.fill();ctx.strokeStyle="#1f4f5c";ctx.lineWidth=2;ctx.stroke()}
limb(11,13,16,"#4a9aad","#3a7a8a",l);limb(13,15,12,"#4a9aad","#3a7a8a",l);
limb(12,14,16,"#4a9aad","#3a7a8a",l);limb(14,16,12,"#4a9aad","#3a7a8a",l);
[15,16].forEach(w=>{if(!v(l[w]))return;const[x,y]=pt(l[w],800,560);
ctx.beginPath();ctx.arc(x,y,8,0,Math.PI*2);ctx.fillStyle="#f5efe6";ctx.fill();
ctx.strokeStyle="#c4b9a8";ctx.lineWidth=1.5;ctx.stroke()});
[11,12,13,14,23,24,25,26].forEach(j=>joint(j,l));
if(v(l[0])&&v(l[11])&&v(l[12])){
const[nx,ny]=pt(l[0],800,560),sw=Math.hypot(pt(l[11],800,560)[0]-pt(l[12],800,560)[0],pt(l[11],800,560)[1]-pt(l[12],800,560)[1]);
const hr=Math.max(24,sw*0.35),[mx,my]=[(pt(l[11],800,560)[0]+pt(l[12],800,560)[0])/2,(pt(l[11],800,560)[1]+pt(l[12],800,560)[1])/2];
ctx.beginPath();ctx.moveTo(mx,my);ctx.lineTo(nx,ny+hr);ctx.strokeStyle="#f5efe6";ctx.lineWidth=10;ctx.stroke();
ctx.strokeStyle="#c4b9a8";ctx.lineWidth=1.5;ctx.stroke();
ctx.beginPath();ctx.arc(nx,ny,hr,0,Math.PI*2);ctx.fillStyle="#f5efe6";ctx.fill();
ctx.strokeStyle="#c4b9a8";ctx.lineWidth=2;ctx.stroke();
ctx.fillStyle="#1a1a1a";const eo=hr*0.3;
ctx.beginPath();ctx.ellipse(nx-eo,ny-hr*0.1,3.5,4.5,0,0,Math.PI*2);ctx.fill();
ctx.beginPath();ctx.ellipse(nx+eo,ny-hr*0.1,3.5,4.5,0,0,Math.PI*2);ctx.fill();
ctx.beginPath();ctx.arc(nx,ny+hr*0.3,hr*0.2,0,Math.PI);ctx.strokeStyle="#1a1a1a";ctx.lineWidth=2;ctx.stroke();
ctx.beginPath();ctx.moveTo(nx,ny-hr);ctx.lineTo(nx,ny-hr-hr*0.5);ctx.strokeStyle="#c4b9a8";ctx.lineWidth=2;ctx.stroke();
ctx.beginPath();ctx.arc(nx,ny-hr-hr*0.5,4,0,Math.PI*2);ctx.fillStyle="#e67e22";ctx.fill()}}
function loop(){
requestAnimationFrame(loop);
if(!T.length)return;
const el=performance.now()-st,bt=T[0].timestamp;
let i=si;
while(i<T.length-1&&T[i+1].timestamp-bt<=el)i++;
if(i>=T.length-1){si=0;st=performance.now();i=0}else si=i;
draw(T[i].landmarks)}
loop();
</script>
</body>
</html>`;
}

// ═════════════���═══════════════════════════════��═════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════
export default function PuppetMaster() {
  // ─── UI State ───────────────────��──────────────────────────
  const [modelLoaded, setModelLoaded] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSmoothing, setIsSmoothing] = useState(false);
  const [fps, setFps] = useState(0);
  const [debugRWrist, setDebugRWrist] = useState("—");
  const [debugLWrist, setDebugLWrist] = useState("—");
  const [frameCount, setFrameCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [gestureHud, setGestureHud] = useState<GestureHudState>(null);

  // ─── Refs (30fps mutation, never trigger re-render) ────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const poseLandmarkerRef = useRef<any>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const mocapCanvasRef = useRef<HTMLCanvasElement>(null);
  const mocapCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const stageCanvasRef = useRef<HTMLCanvasElement>(null);
  const stageCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const tlCanvasRef = useRef<HTMLCanvasElement>(null);
  const tlCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  const rafRef = useRef<number>(0);
  const lastVidTimeRef = useRef<number>(-1);
  const landmarksRef = useRef<Landmark[][] | null>(null);
  const bufferRef = useRef<FrameData[]>([]);
  const smoothBufRef = useRef<FrameData[]>([]);
  const isRecRef = useRef(false);
  const isPlayRef = useRef(false);
  const isSmoothRef = useRef(false);
  const pbIdxRef = useRef(0);
  const pbStartRef = useRef(0);
  const fpsRingRef = useRef<number[]>([]);
  const lastDbgRef = useRef(0);
  const gestureCooldownRef = useRef(0);
  const pendingRightRef = useRef<{ startAt: number } | null>(null);
  const pendingLeftRef = useRef<{ startAt: number } | null>(null);
  const trimStartIdxRef = useRef(0);
  const trimEndIdxRef = useRef(0);
  const tlDragRef = useRef<{
    kind: "in" | "out";
    trimIn0: number;
    trimOut0: number;
  } | null>(null);
  const lastGestureHudJsonRef = useRef<string>("");
  /** performance.now() when pre–record “Get ready” countdown ends and capture should start; 0 = idle */
  const preRecordCountdownEndRef = useRef(0);

  const redrawTimelineCanvas = useCallback(() => {
    const ctx = tlCtxRef.current;
    const canvas = tlCanvasRef.current;
    if (!ctx || !canvas) return;
    drawTimeline(
      ctx,
      canvas.width,
      bufferRef.current.length,
      pbIdxRef.current,
      isPlayRef.current,
      isSmoothRef.current,
      trimStartIdxRef.current,
      trimEndIdxRef.current,
      isRecRef.current,
      !isPlayRef.current && !isRecRef.current && bufferRef.current.length > 0
    );
  }, []);


  const finalizeRecordingStop = useCallback(
    (
      _gNow: number,
      kind: "button_or_right" | "left_gesture",
      leftArmStartedAt?: number
    ) => {
      isRecRef.current = false;
      setIsRecording(false);
      let buf = bufferRef.current;
      if (kind === "left_gesture" && leftArmStartedAt != null) {
        buf = buf.filter((f) => f.timestamp < leftArmStartedAt);
      }
      bufferRef.current = buf;
      preRecordCountdownEndRef.current = 0;
      if (isSmoothRef.current && bufferRef.current.length > 0) {
        smoothBufRef.current = applySmoothing(bufferRef.current);
      } else {
        smoothBufRef.current = [];
      }
      const n = bufferRef.current.length;
      trimStartIdxRef.current = 0;
      trimEndIdxRef.current = n > 0 ? n - 1 : 0;
      pbIdxRef.current = 0;
      if (n > 0) landmarksRef.current = bufferRef.current[0].landmarks;
      setFrameCount(n);
      redrawTimelineCanvas();
    },
    [redrawTimelineCanvas]
  );

  // ─── Main animation / capture loop ───
  const loop = useCallback(() => {
    rafRef.current = requestAnimationFrame(loop);

    // Phase 1: Get landmarks
    if (isPlayRef.current) {
      const buf = isSmoothRef.current ? smoothBufRef.current : bufferRef.current;
      if (buf.length === 0) {
        isPlayRef.current = false;
        setIsPlaying(false);
        return;
      }
      const elapsed = performance.now() - pbStartRef.current;
      const base = buf[0].timestamp;
      let idx = pbIdxRef.current;
      while (idx < buf.length - 1 && buf[idx + 1].timestamp - base <= elapsed) idx++;
      if (idx >= buf.length - 1) {
        pbIdxRef.current = 0;
        pbStartRef.current = performance.now();
        idx = 0;
      } else {
        pbIdxRef.current = idx;
      }
      landmarksRef.current = buf[idx].landmarks;
    } else {
      const video = videoRef.current;
      const lm = poseLandmarkerRef.current;
      if (video && lm && video.readyState >= 2 && video.currentTime !== lastVidTimeRef.current) {
        lastVidTimeRef.current = video.currentTime;
        try {
          const r = lm.detectForVideo(video, performance.now());
          if (r.landmarks?.length > 0) landmarksRef.current = r.landmarks;
        } catch { /* skip */ }
      }
    }

    // Phase 1.25: “Get ready” finished → start recording (gesture path only)
    const gPhase = performance.now();
    if (
      preRecordCountdownEndRef.current > 0 &&
      gPhase >= preRecordCountdownEndRef.current &&
      !isPlayRef.current &&
      !isRecRef.current
    ) {
      preRecordCountdownEndRef.current = 0;
      const hadClip = bufferRef.current.length > 0;
      if (!hadClip) {
        bufferRef.current = [];
        smoothBufRef.current = [];
        pbIdxRef.current = 0;
        trimStartIdxRef.current = 0;
        trimEndIdxRef.current = 0;
      } else {
        pbIdxRef.current = Math.max(0, bufferRef.current.length - 1);
      }
      isRecRef.current = true;
      setIsRecording(true);
    }

    // Phase 1.5: Gesture detection — arm hold, exclusive hands; skip while “get ready” is running
    const inPreRecordGetReady =
      preRecordCountdownEndRef.current > 0 && gPhase < preRecordCountdownEndRef.current;
    if (landmarksRef.current && !isPlayRef.current && !inPreRecordGetReady) {
      const glm = landmarksRef.current[0];
      const gNow = performance.now();
      const nose = glm[0], rW = glm[16], lW = glm[15];
      const rightHeld = vis(nose) && vis(rW) && rW.y < nose.y - 0.15;
      const leftHeld = vis(nose) && vis(lW) && lW.y < nose.y - 0.15;

      if (rightHeld && leftHeld) {
        pendingRightRef.current = null;
        pendingLeftRef.current = null;
      } else {
        if (!rightHeld) pendingRightRef.current = null;
        if (!leftHeld) pendingLeftRef.current = null;
      }

      if (gNow - gestureCooldownRef.current > 2000) {
        if (rightHeld && !leftHeld) {
          if (!pendingRightRef.current) pendingRightRef.current = { startAt: gNow };
          else if (gNow - pendingRightRef.current.startAt >= GESTURE_ARM_MS) {
            pendingRightRef.current = null;
            pendingLeftRef.current = null;
            gestureCooldownRef.current = gNow;
            if (isRecRef.current) {
              finalizeRecordingStop(gNow, "button_or_right");
            } else {
              preRecordCountdownEndRef.current = gNow + PRE_RECORD_COUNTDOWN_MS;
            }
          }
        } else if (leftHeld && !rightHeld) {
          if (!pendingLeftRef.current) pendingLeftRef.current = { startAt: gNow };
          else if (gNow - pendingLeftRef.current.startAt >= GESTURE_ARM_MS) {
            const leftArmStartedAt = pendingLeftRef.current.startAt;
            pendingLeftRef.current = null;
            pendingRightRef.current = null;
            gestureCooldownRef.current = gNow;
            if (isRecRef.current) {
              finalizeRecordingStop(gNow, "left_gesture", leftArmStartedAt);
            } else if (bufferRef.current.length > 0) {
              pbIdxRef.current = 0;
              pbStartRef.current = performance.now();
              isPlayRef.current = true;
              setIsPlaying(true);
            }
          }
        }
      }
    }

    // Phase 2: Record
    if (isRecRef.current && landmarksRef.current) {
      bufferRef.current.push({
        landmarks: structuredClone(landmarksRef.current),
        timestamp: performance.now(),
      });
    }

    // Phase 3a: MoCap canvas (live mode only — draw video + wireframe)
    if (!isPlayRef.current && mocapCtxRef.current && videoRef.current) {
      drawMoCap(mocapCtxRef.current, videoRef.current, landmarksRef.current);
    }

    // Phase 3b: Stage canvas
    if (stageCtxRef.current) {
      drawCharacterOnCanvas(stageCtxRef.current, landmarksRef.current, STAGE_W, STAGE_H);
    }

    // Phase 4: Throttled debug + timeline update (4Hz)
    const now = performance.now();
    fpsRingRef.current.push(now);
    if (fpsRingRef.current.length > 30) fpsRingRef.current.shift();

    if (now - lastDbgRef.current > 250) {
      lastDbgRef.current = now;
      const ts = fpsRingRef.current;
      if (ts.length > 1) {
        setFps(Math.round(((ts.length - 1) / (ts[ts.length - 1] - ts[0])) * 1000));
      }
      const lm0 = landmarksRef.current?.[0];
      if (lm0?.[16]) {
        const w = lm0[16];
        setDebugRWrist(JSON.stringify({ x: +w.x.toFixed(4), y: +w.y.toFixed(4), z: +w.z.toFixed(4) }));
      } else {
        setDebugRWrist("—");
      }
      if (lm0?.[15]) {
        const w = lm0[15];
        setDebugLWrist(JSON.stringify({ x: +w.x.toFixed(4), y: +w.y.toFixed(4), z: +w.z.toFixed(4) }));
      } else {
        setDebugLWrist("—");
      }
      setFrameCount(bufferRef.current.length);

      if (isRecRef.current && bufferRef.current.length > 0) {
        trimStartIdxRef.current = 0;
        trimEndIdxRef.current = bufferRef.current.length - 1;
      }

      let nextHud: GestureHudState = null;
      if (
        preRecordCountdownEndRef.current > 0 &&
        now < preRecordCountdownEndRef.current
      ) {
        const sec = Math.max(
          0,
          Math.ceil((preRecordCountdownEndRef.current - now) / 1000)
        );
        nextHud = { mode: "get_ready", secondsLeft: sec };
      } else if (now - gestureCooldownRef.current > 2000) {
        const pr = pendingRightRef.current;
        const pl = pendingLeftRef.current;
        if (pr && !pl) {
          const sec = Math.max(0, Math.ceil((GESTURE_ARM_MS - (now - pr.startAt)) / 1000));
          nextHud = {
            mode: "pose_hold",
            side: "right",
            secondsLeft: sec,
            action: isRecRef.current
              ? "Stop — right (keeps tail)"
              : "Arm OK → get ready next",
          };
        } else if (pl && !pr) {
          const sec = Math.max(0, Math.ceil((GESTURE_ARM_MS - (now - pl.startAt)) / 1000));
          nextHud = {
            mode: "pose_hold",
            side: "left",
            secondsLeft: sec,
            action: isRecRef.current
              ? "Stop — drop from left-hold start"
              : "Play from start",
          };
        }
      }
      const hudJson = JSON.stringify(nextHud);
      if (hudJson !== lastGestureHudJsonRef.current) {
        lastGestureHudJsonRef.current = hudJson;
        setGestureHud(nextHud);
      }

      redrawTimelineCanvas();
    }
  }, [redrawTimelineCanvas, finalizeRecordingStop]);

  // ─── Init ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const { PoseLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
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

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: "user" },
        });
        if (cancelled) return;

        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();

        if (mocapCanvasRef.current && stageCanvasRef.current && tlCanvasRef.current) {
          mocapCtxRef.current = mocapCanvasRef.current!.getContext("2d")!;
          stageCtxRef.current = stageCanvasRef.current!.getContext("2d")!;
          tlCtxRef.current = tlCanvasRef.current!.getContext("2d")!;
        } else {
          throw new Error("Canvas initialization failed");
        }

        setModelLoaded(true);
      } catch (err) {
        console.error("Init error:", err);
        setError(err instanceof Error ? err.message : "Initialization failed");
      }
    }

    init();
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Start loop when model loads
  useEffect(() => {
    if (modelLoaded) loop();
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [modelLoaded, loop]);

  // ─── Control Handlers ──────────────────────────────────────
  const applyTimelineTrim = useCallback(() => {
    const len = bufferRef.current.length;
    if (len === 0) return;
    let a = trimStartIdxRef.current;
    let b = trimEndIdxRef.current;
    if (a > b) [a, b] = [b, a];
    if (a === 0 && b === len - 1) return;
    const prevPb = pbIdxRef.current;
    bufferRef.current = bufferRef.current.slice(a, b + 1);
    if (isSmoothRef.current && bufferRef.current.length > 0) {
      smoothBufRef.current = applySmoothing(bufferRef.current);
    } else {
      smoothBufRef.current = [];
    }
    trimStartIdxRef.current = 0;
    trimEndIdxRef.current = Math.max(0, bufferRef.current.length - 1);
    const newLen = bufferRef.current.length;
    pbIdxRef.current = Math.max(0, Math.min(prevPb - a, newLen - 1));
    const buf = isSmoothRef.current ? smoothBufRef.current : bufferRef.current;
    if (buf.length > 0) landmarksRef.current = buf[pbIdxRef.current].landmarks;
    setFrameCount(bufferRef.current.length);
    redrawTimelineCanvas();
  }, [redrawTimelineCanvas]);

  const scrubTimelineAtEvent = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = tlCanvasRef.current;
      if (!canvas || bufferRef.current.length === 0) return;
      const buf = isSmoothRef.current ? smoothBufRef.current : bufferRef.current;
      if (buf.length === 0) return;
      const canvasX = (e.nativeEvent.offsetX / canvas.clientWidth) * canvas.width;
      const frameIdx = frameIndexFromCanvasX(canvasX, canvas.width, buf.length);
      pbIdxRef.current = frameIdx;
      landmarksRef.current = buf[frameIdx].landmarks;
      if (isPlayRef.current) {
        pbStartRef.current = performance.now() - (buf[frameIdx].timestamp - buf[0].timestamp);
      }
      redrawTimelineCanvas();
    },
    [redrawTimelineCanvas]
  );

  const onTimelineMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (bufferRef.current.length === 0) return;
      if (isRecRef.current || isPlayRef.current) {
        scrubTimelineAtEvent(e);
        return;
      }
      const canvas = tlCanvasRef.current;
      if (!canvas) return;
      const canvasX = (e.nativeEvent.offsetX / canvas.clientWidth) * canvas.width;
      const len = bufferRef.current.length;
      const hit = timelineHitKind(
        canvasX,
        canvas.width,
        len,
        trimStartIdxRef.current,
        trimEndIdxRef.current
      );
      if (hit === "scrub") {
        scrubTimelineAtEvent(e);
        return;
      }
      tlDragRef.current = {
        kind: hit,
        trimIn0: trimStartIdxRef.current,
        trimOut0: trimEndIdxRef.current,
      };
      const onMove = (ev: MouseEvent) => {
        const drag = tlDragRef.current;
        if (!drag || !tlCanvasRef.current) return;
        const c = tlCanvasRef.current;
        const r = c.getBoundingClientRect();
        const cx = ((ev.clientX - r.left) / r.width) * c.width;
        let idx = frameIndexFromCanvasX(cx, c.width, bufferRef.current.length);
        if (drag.kind === "in") {
          idx = Math.min(idx, trimEndIdxRef.current);
          trimStartIdxRef.current = idx;
        } else {
          idx = Math.max(idx, trimStartIdxRef.current);
          trimEndIdxRef.current = idx;
        }
        redrawTimelineCanvas();
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        const drag = tlDragRef.current;
        if (
          drag &&
          (trimStartIdxRef.current !== drag.trimIn0 || trimEndIdxRef.current !== drag.trimOut0)
        ) {
          applyTimelineTrim();
        }
        tlDragRef.current = null;
        redrawTimelineCanvas();
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      e.preventDefault();
    },
    [applyTimelineTrim, redrawTimelineCanvas, scrubTimelineAtEvent]
  );

  const toggleRec = useCallback(() => {
    if (isRecRef.current) {
      finalizeRecordingStop(performance.now(), "button_or_right");
    } else {
      preRecordCountdownEndRef.current = 0;
      const hadClip = bufferRef.current.length > 0;
      if (!hadClip) {
        bufferRef.current = [];
        smoothBufRef.current = [];
        pbIdxRef.current = 0;
        trimStartIdxRef.current = 0;
        trimEndIdxRef.current = 0;
      } else {
        pbIdxRef.current = Math.max(0, bufferRef.current.length - 1);
      }
      isRecRef.current = true;
      setIsRecording(true);
      redrawTimelineCanvas();
    }
  }, [finalizeRecordingStop, redrawTimelineCanvas]);

  const clearTimeline = useCallback(() => {
    if (isRecRef.current || isPlayRef.current) return;
    bufferRef.current = [];
    smoothBufRef.current = [];
    pbIdxRef.current = 0;
    trimStartIdxRef.current = 0;
    trimEndIdxRef.current = 0;
    setFrameCount(0);
    redrawTimelineCanvas();
  }, [redrawTimelineCanvas]);

  const togglePlay = useCallback(() => {
    if (isPlayRef.current) {
      isPlayRef.current = false;
      setIsPlaying(false);
    } else if (bufferRef.current.length > 0) {
      pbIdxRef.current = 0;
      pbStartRef.current = performance.now();
      isPlayRef.current = true;
      setIsPlaying(true);
    }
  }, []);

  const toggleSmooth = useCallback(() => {
    const next = !isSmoothRef.current;
    isSmoothRef.current = next;
    if (next && bufferRef.current.length > 0) {
      smoothBufRef.current = applySmoothing(bufferRef.current);
    }
    setIsSmoothing(next);
  }, []);

  const doExportJSON = useCallback(() => {
    const payload = {
      version: "1.0",
      exportedAt: new Date().toISOString(),
      frameCount: bufferRef.current.length,
      fps: 30,
      smoothed: isSmoothRef.current,
      timeline: isSmoothRef.current ? smoothBufRef.current : bufferRef.current,
      character: "puppet-default",
    };
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "puppetmaster-export.json";
    a.click();
    URL.revokeObjectURL(a.href);
    setPublishOpen(false);
  }, []);

  const doExportHTML = useCallback(() => {
    const buf = isSmoothRef.current ? smoothBufRef.current : bufferRef.current;
    const html = generatePlayerHTML(JSON.stringify(buf));
    const blob = new Blob([html], { type: "text/html" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "puppetmaster-player.html";
    a.click();
    URL.revokeObjectURL(a.href);
    setPublishOpen(false);
  }, []);

  // Close publish menu on outside click
  useEffect(() => {
    if (!publishOpen) return;
    const handler = () => setPublishOpen(false);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [publishOpen]);

  const hasFrames = frameCount > 0;

  // ─── JSX ───────────────────��───────────────────────────────
  return (
    <div className="flex flex-col h-screen select-none" style={{ background: "#d4d4d4" }}>
      {/* ── Menu Bar ─────────────────��───────────────────── */}
      <header
        className="flex items-center justify-between px-3 shrink-0"
        style={{
          height: 36,
          background: "linear-gradient(180deg, #606060 0%, #4a4a4a 100%)",
          borderBottom: "1px solid #333",
        }}
      >
        <div className="flex items-center gap-6">
          <span className="text-white font-bold text-sm tracking-tight">
            Puppet<span style={{ color: "#ec1c24" }}>Master</span>
          </span>
          <nav className="flex gap-4 text-[11px] text-gray-300">
            <span className="cursor-default hover:text-white">File</span>
            <span className="cursor-default hover:text-white">Edit</span>
            <span className="cursor-default hover:text-white">Control</span>
          </nav>
        </div>

        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setPublishOpen(!publishOpen);
            }}
            disabled={!hasFrames}
            className="px-3 py-1 text-[11px] font-semibold text-white rounded disabled:opacity-30"
            style={{ background: hasFrames ? "#ec1c24" : "#666" }}
          >
            Publish
          </button>
          {publishOpen && (
            <div
              className="absolute top-full right-0 mt-1 rounded shadow-lg overflow-hidden z-50"
              style={{ background: "#f0f0f0", border: "1px solid #b8b8b8", minWidth: 180 }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={doExportJSON}
                className="block w-full px-4 py-2 text-left text-[11px] hover:bg-white"
                style={{ color: "#1a1a1a" }}
              >
                Export Data (.json)
              </button>
              <button
                onClick={doExportHTML}
                className="block w-full px-4 py-2 text-left text-[11px] hover:bg-white"
                style={{ color: "#1a1a1a", borderTop: "1px solid #d0d0d0" }}
              >
                Export Player (.html)
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ── Workspace ────────────────────────────────────── */}
      <div className="flex flex-1 gap-1 p-1" style={{ minHeight: 0 }}>
        {/* ── MoCap Studio (Left Panel) ────────────────── */}
        <div
          className="flex flex-col shrink-0 rounded-md overflow-hidden shadow-md"
          style={{ width: 288, border: "1px solid #b8b8b8" }}
        >
          <div
            className="px-2 py-1.5 text-[10px] font-semibold text-white tracking-widest uppercase"
            style={{
              background: "linear-gradient(180deg, #5e5e5e 0%, #464646 100%)",
              borderBottom: "1px solid #333",
            }}
          >
            MoCap Studio
          </div>
          <div
            className="flex items-center justify-center flex-1"
            style={{ background: "#2a2a2a" }}
          >
            <canvas
              ref={mocapCanvasRef}
              width={MOCAP_W}
              height={MOCAP_H}
              style={{
                width: 280,
                height: 210,
                border: "1px solid #444",
                display: modelLoaded ? "block" : "none",
                transform: "scaleX(-1)",
              }}
            />
            {!modelLoaded && !error && (
              <div className="text-gray-500 text-[11px] animate-pulse">
                Initializing camera...
              </div>
            )}
          </div>
          {/* Pose debug — MediaPipe landmark indices */}
          {modelLoaded && (
            <div
              className="px-2 py-2 text-[9px] leading-snug mono"
              style={{
                background: "#1a1a1a",
                color: "#b8e0c8",
                borderTop: "1px solid #333",
              }}
            >
              <div className="font-semibold text-white mb-1" style={{ fontFamily: "Archivo, system-ui, sans-serif" }}>
                Live pose (debug)
              </div>
              <p className="mb-2" style={{ color: "#7a9a8a", fontFamily: "Archivo, system-ui, sans-serif" }}>
                Normalized body landmarks (0–1 in image space). Gestures use wrist vs nose height (y).
              </p>
              <div className="space-y-1.5">
                <div>
                  <div className="flex justify-between gap-1" style={{ color: "#6abf8f" }}>
                    <span>#16 right wrist</span>
                  </div>
                  <div className="truncate text-[9px]" style={{ color: "#00ff88" }}>
                    {debugRWrist}
                  </div>
                </div>
                <div>
                  <div className="flex justify-between gap-1" style={{ color: "#6abf8f" }}>
                    <span>#15 left wrist</span>
                  </div>
                  <div className="truncate text-[9px]" style={{ color: "#00ff88" }}>
                    {debugLWrist}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Stage (Center Panel) ─────────────────────── */}
        <div
          className="flex flex-col flex-1 rounded-md overflow-hidden shadow-md"
          style={{ border: "1px solid #b8b8b8" }}
        >
          <div
            className="px-2 py-1.5 text-[10px] font-semibold text-white tracking-widest uppercase flex items-center justify-between"
            style={{
              background: "linear-gradient(180deg, #5e5e5e 0%, #464646 100%)",
              borderBottom: "1px solid #333",
            }}
          >
            <span>Stage</span>
            {isRecording && (
              <span className="flex items-center gap-1">
                <span
                  className="inline-block w-2 h-2 rounded-full animate-pulse"
                  style={{ background: "#ec1c24" }}
                />
                <span style={{ color: "#ec1c24" }}>REC</span>
              </span>
            )}
            {isPlaying && (
              <span style={{ color: "#3d8dcc" }}>PLAYBACK</span>
            )}
          </div>
          <div
            className="flex items-center justify-center flex-1 relative"
            style={{ background: "#c0c0c0" }}
          >
            {/* Always render canvas so the ref exists, toggle visibility via display */}
            <canvas
              ref={stageCanvasRef}
              width={STAGE_W}
              height={STAGE_H}
              style={{
                maxWidth: "100%",
                maxHeight: "100%",
                border: "1px solid #999",
                boxShadow: "0 4px 24px rgba(0,0,0,0.2)",
                display: modelLoaded ? "block" : "none",
              }}
            />
            
            {/* Overlay the loading/error state when model is not loaded */}
            {!modelLoaded && (
              <div className="absolute text-gray-600 text-sm">
                {error ? (
                  <div className="text-red-600 text-center max-w-xs">
                    <div className="font-semibold mb-1">Error</div>
                    <div className="text-[11px]">{error}</div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-5 h-5 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
                    <div className="animate-pulse font-medium">Loading Studio...</div>
                  </div>
                )}
              </div>
            )}

            {modelLoaded && gestureHud && (
              <div
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
                style={{ background: "rgba(0,0,0,0.35)" }}
              >
                <div
                  className="rounded-lg px-6 py-4 text-center shadow-lg"
                  style={{
                    background: "linear-gradient(180deg, #2a2a2a 0%, #1a1a1a 100%)",
                    border: "2px solid #ec1c24",
                    minWidth: 220,
                  }}
                >
                  {gestureHud.mode === "get_ready" ? (
                    <>
                      <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: "#888" }}>
                        Get ready
                      </div>
                      <div className="text-4xl font-bold tabular-nums mb-2" style={{ color: "#ec1c24" }}>
                        {gestureHud.secondsLeft}
                      </div>
                      <div className="text-[12px] text-white font-medium">Recording starts in…</div>
                    </>
                  ) : (
                    <>
                      <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: "#888" }}>
                        Hold pose · {gestureHud.side === "right" ? "Right hand" : "Left hand"}
                      </div>
                      <div className="text-4xl font-bold tabular-nums mb-2" style={{ color: "#ec1c24" }}>
                        {gestureHud.secondsLeft}
                      </div>
                      <div className="text-[12px] text-white font-medium">{gestureHud.action}</div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Properties (Right Panel) ────────��────────── */}
        <div
          className="flex flex-col shrink-0 rounded-md overflow-hidden shadow-md overflow-y-auto"
          style={{ width: 236, border: "1px solid #b8b8b8", maxHeight: "100%" }}
        >
          <div
            className="px-2 py-1.5 text-[10px] font-semibold text-white tracking-widest uppercase shrink-0"
            style={{
              background: "linear-gradient(180deg, #5e5e5e 0%, #464646 100%)",
              borderBottom: "1px solid #333",
            }}
          >
            Properties
          </div>
          <div className="flex-1 p-3 flex flex-col gap-4 min-h-0" style={{ background: "#f0f0f0" }}>
            {/* Stats */}
            <div>
              <div className="text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: "#888" }}>
                Performance
              </div>
              <div className="flex justify-between text-[11px] mb-1">
                <span style={{ color: "#888" }}>FPS</span>
                <span className="mono font-semibold" style={{ color: fps >= 24 ? "#1a1a1a" : "#ec1c24" }}>
                  {fps}
                </span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span style={{ color: "#888" }}>Frames</span>
                <span className="mono font-semibold">{frameCount}</span>
              </div>
            </div>

            <div style={{ borderTop: "1px solid #d0d0d0" }} />

            {/* Character */}
            <div>
              <div className="text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: "#888" }}>
                Character
              </div>
              <div
                className="px-2 py-1.5 rounded text-[11px] mb-2"
                style={{ background: "#e0e0e0", border: "1px solid #c0c0c0" }}
              >
                Puppet (Default)
              </div>
              <button
                type="button"
                className="w-full px-2 py-1.5 rounded text-[11px] font-medium cursor-pointer"
                style={{
                  background: "#ffffff",
                  border: "1px solid #b8b8b8",
                  color: "#1a1a1a",
                }}
              >
                Upload Asset…
              </button>
            </div>

            <div style={{ borderTop: "1px solid #d0d0d0" }} />

            {/* Layered motion — WIP (pitch: multi-asset mocap) */}
            <div>
              <div className="text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: "#888" }}>
                Layered assets
              </div>
              <p className="text-[10px] mb-2" style={{ color: "#666", lineHeight: 1.35 }}>
                Import rigs or motion layers to drive extra props/characters on top of your base take (in progress).
              </p>
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  disabled
                  title="Coming soon"
                  className="w-full px-2 py-1.5 rounded text-[10px] font-medium text-left cursor-not-allowed opacity-60"
                  style={{
                    background: "#e8e8e8",
                    border: "1px dashed #b0b0b0",
                    color: "#444",
                  }}
                >
                  Import sprite / rig…
                </button>
                <button
                  type="button"
                  disabled
                  title="Coming soon"
                  className="w-full px-2 py-1.5 rounded text-[10px] font-medium text-left cursor-not-allowed opacity-60"
                  style={{
                    background: "#e8e8e8",
                    border: "1px dashed #b0b0b0",
                    color: "#444",
                  }}
                >
                  Import motion layer (.json)…
                </button>
                <button
                  type="button"
                  disabled
                  title="Coming soon"
                  className="w-full px-2 py-1.5 rounded text-[10px] font-medium text-left cursor-not-allowed opacity-60"
                  style={{
                    background: "#e8e8e8",
                    border: "1px dashed #b0b0b0",
                    color: "#444",
                  }}
                >
                  Asset library…
                </button>
              </div>
            </div>

            <div style={{ borderTop: "1px solid #d0d0d0" }} />

            {/* Smoothing info */}
            <div>
              <div className="text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: "#888" }}>
                Processing
              </div>
              <div className="text-[11px]">
                Smoothing:{" "}
                <span className="font-semibold" style={{ color: isSmoothing ? "#3d8dcc" : "#888" }}>
                  {isSmoothing ? "ON (7-frame)" : "OFF"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Timeline Panel ──────────────────────���────────── */}
      <div
        className="flex flex-col shrink-0"
        style={{
          height: 120,
          borderTop: "1px solid #333",
        }}
      >
        {/* Timeline toolbar */}
        <div
          className="flex items-center gap-2 px-3 shrink-0"
          style={{
            height: 32,
            background: "linear-gradient(180deg, #4a4a4a 0%, #3a3a3a 100%)",
            borderBottom: "1px solid #2a2a2a",
          }}
        >
          <button
            onClick={toggleRec}
            disabled={isPlaying}
            className="px-2.5 py-0.5 rounded text-[11px] font-semibold text-white disabled:opacity-30 transition-colors duration-150"
            style={{
              background: isRecording ? "#ec1c24" : "#666",
              boxShadow: isRecording ? "0 0 8px rgba(236,28,36,0.4)" : "none",
            }}
          >
            {isRecording ? "Stop" : hasFrames ? "Record more" : "Record"}
          </button>
          <button
            type="button"
            onClick={clearTimeline}
            disabled={isRecording || isPlaying || !hasFrames}
            className="px-2 py-0.5 rounded text-[10px] font-semibold text-white disabled:opacity-30 transition-colors duration-150"
            style={{ background: "#555" }}
            title="Clear the timeline (new take)"
          >
            Clear
          </button>
          <button
            onClick={togglePlay}
            disabled={!hasFrames && !isPlaying}
            className="px-2.5 py-0.5 rounded text-[11px] font-semibold text-white disabled:opacity-30 transition-colors duration-150"
            style={{ background: isPlaying ? "#3d8dcc" : "#666" }}
          >
            {isPlaying ? "Stop" : "Play"}
          </button>

          <div style={{ width: 1, height: 16, background: "#555" }} />

          <button
            onClick={toggleSmooth}
            disabled={!hasFrames}
            className="px-2.5 py-0.5 rounded text-[11px] font-semibold text-white disabled:opacity-30 transition-colors duration-150"
            style={{ background: isSmoothing ? "#3d8dcc" : "#555" }}
          >
            Smooth
          </button>

          <div className="flex-1" />

          <span className="text-[9px] hidden sm:inline" style={{ color: "#666" }}>
            Drag red/white trim handles · click to scrub
          </span>

          <span className="mono text-[10px]" style={{ color: "#888" }}>
            {hasFrames
              ? `Frame ${isPlaying ? pbIdxRef.current + 1 : frameCount} / ${frameCount}`
              : "No frames recorded"}
          </span>
        </div>

        {/* Timeline canvas (click to scrub) */}
        <canvas
          ref={tlCanvasRef}
          width={1400}
          height={TIMELINE_H}
          onMouseDown={onTimelineMouseDown}
          style={{
            flex: 1,
            width: "100%",
            display: "block",
            background: "#444",
            cursor:
              hasFrames && !isRecording && !isPlaying && frameCount > 1
                ? "col-resize"
                : hasFrames
                  ? "crosshair"
                  : "default",
          }}
        />
      </div>

      {/* ── Hidden video element ──────────────────────────── */}
      <video
        ref={videoRef}
        width={640}
        height={480}
        playsInline
        muted
        style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}
      />
    </div>
  );
}
