# PuppetMaster — Technical Architecture

---

## Pipeline Diagram

```mermaid
flowchart TB
    subgraph CAPTURE ["1 &middot; CAPTURE"]
        WC["Webcam (640x480)"] --> VID["Hidden &lt;video&gt; element"]
    end

    subgraph DETECT ["2 &middot; AI DETECTION &lpar;~10ms/frame&rpar;"]
        VID --> MP["MediaPipe PoseLandmarker<br/>WASM + WebGL &middot; client-side<br/>pose_landmarker_lite (~4MB)"]
        MP --> LM["33 Skeletal Landmarks<br/>normalized x, y, z in 0..1"]
    end

    subgraph FORK ["3 &middot; COORDINATE TRANSFORM"]
        LM --> MC["MoCap path<br/>raw: lm.x &times; W<br/>CSS scaleX(-1) mirror"]
        LM --> ST["Stage path<br/>flipped: (1 - lm.x) &times; W"]
        LM --> GS["Gesture path<br/>wrist.y &lt; nose.y - 0.15"]
    end

    subgraph RENDER ["4 &middot; DUAL CANVAS RENDER &lpar;~1ms&rpar;"]
        MC --> MOCAP["MoCap Canvas (320x240)<br/>drawImage(video) + wireframe<br/>+ bind-mode hotspots"]
        ST --> STAGE["Stage Canvas (800x560)<br/>Puppet: translate &rarr; rotate per segment<br/>OR single active asset layer"]
    end

    subgraph RECORD ["5 &middot; RECORD &lpar;exclusive target&rpar;"]
        LM --> BUF_P["Puppet Buffer<br/>FrameData[ ] &middot; 33 landmarks/frame"]
        LM --> BUF_L["Layer Buffers<br/>&lbrace;x, y, timestamp&rbrace;[ ] per layer<br/>bound to one landmark each"]
    end

    subgraph TIMELINE ["6 &middot; TIMELINE + NLE"]
        BUF_P --> TL_M["Main Track"]
        BUF_L --> TL_L["Layer Tracks (stacked)"]
        TL_M --> PB["Playback Engine<br/>timestamp-based seeking"]
        TL_L --> PB
    end

    subgraph EXPORT ["7 &middot; EXPORT"]
        PB --> EX_J["JSON<br/>timeline + metadata"]
        PB --> EX_H["Standalone HTML<br/>data + 80-line JS player<br/>zero dependencies"]
    end

    GS -->|"right hand = rec"| BUF_P
    GS -->|"left hand = stop / play"| PB

    style CAPTURE fill:#2d6a7a,stroke:#1f4f5c,color:#fff
    style DETECT fill:#d35400,stroke:#a04000,color:#fff
    style FORK fill:#2980b9,stroke:#1a5276,color:#fff
    style RENDER fill:#16a085,stroke:#0e6655,color:#fff
    style RECORD fill:#c0392b,stroke:#922b21,color:#fff
    style TIMELINE fill:#8e44ad,stroke:#6c3483,color:#fff
    style EXPORT fill:#27ae60,stroke:#1e8449,color:#fff
```

---

## Performance Architecture

```mermaid
flowchart LR
    subgraph RAF ["requestAnimationFrame loop (30fps)"]
        direction TB
        A["Detect landmarks"] --> B["Gesture check"]
        B --> C["Record to active buffer"]
        C --> D["Draw MoCap canvas"]
        D --> E["Draw Stage canvas"]
    end

    subgraph REFS ["useRef (mutated every frame)"]
        R1["landmarksRef"]
        R2["bufferRef / layer.buffer"]
        R3["pbIdxRef"]
        R4["fpsRingRef"]
    end

    subgraph STATE ["useState (4Hz throttle)"]
        S1["fps"]
        S2["frameCount"]
        S3["isRecording / isPlaying"]
        S4["layers (UI refresh)"]
    end

    RAF -->|"writes directly<br/>no re-render"| REFS
    RAF -->|"every 250ms only"| STATE
    STATE --> UI["React UI Shell<br/>panels, buttons, labels"]

    style RAF fill:#1a1a1a,stroke:#444,color:#fff
    style REFS fill:#2d6a7a,stroke:#1f4f5c,color:#fff
    style STATE fill:#c0392b,stroke:#922b21,color:#fff
    style UI fill:#f0f0f0,stroke:#b8b8b8,color:#1a1a1a
```

**Why this matters:** React re-renders are expensive. If we used `useState` for landmark data at 30fps, React would reconcile 30 times per second — GC pressure, layout thrashing, dropped frames. By keeping all per-frame data in `useRef` and only updating React state 4 times per second for UI labels, we get native canvas performance with zero jank.

---

## Layer System Architecture

```mermaid
flowchart TB
    subgraph LAYER_MODEL ["Layer Data Model"]
        L["AssetLayer"]
        L --> ID["id: string (UUID)"]
        L --> ASSET["asset: star | circle | diamond | hat | heart | sword"]
        L --> BOUND["boundLandmark: number | null<br/>(MediaPipe index: 0=head, 15=L.hand, 16=R.hand...)"]
        L --> BUF["buffer: {x, y, timestamp}[ ]"]
        L --> SCALE["scale: 0.3 .. 3.0"]
        L --> VIS["visible: boolean"]
    end

    subgraph BIND ["Bind Mode Flow"]
        B1["User clicks 'Bind'"] --> B2["MoCap shows 7 hotspots<br/>Head, L/R Hand, L/R Shoulder, L/R Foot"]
        B2 --> B3["User clicks hotspot"]
        B3 --> B4["layer.boundLandmark = idx"]
        B4 --> B5["Asset follows landmark live"]
    end

    subgraph REC_TARGET ["Exclusive Recording"]
        RT1["activeLayerId = null"] -->|"Record"| RT2["Writes to puppet bufferRef<br/>Stage shows puppet"]
        RT3["activeLayerId = layer.id"] -->|"Record"| RT4["Writes to layer.buffer only<br/>Stage shows only that asset"]
    end

    style LAYER_MODEL fill:#f0f0f0,stroke:#b8b8b8,color:#1a1a1a
    style BIND fill:#e67e22,stroke:#c0561a,color:#fff
    style REC_TARGET fill:#2980b9,stroke:#1a5276,color:#fff
```

---

## Tech Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| Framework | Next.js 16 (App Router, Turbopack) | Fast dev builds, SSR-safe with `"use client"` |
| Pose Detection | `@mediapipe/tasks-vision` PoseLandmarker | Single package, 2-call init, WASM from CDN |
| Model | `pose_landmarker_lite` (float16, ~4MB) | Fast load, GPU-delegated, 33 landmarks |
| Rendering | HTML5 Canvas 2D API | Direct pixel control, no DOM overhead |
| Styling | Tailwind CSS + inline styles | Rapid iteration, Flash CS3/CS4 aesthetic |
| Typography | Archivo + JetBrains Mono | Professional UI feel + debug readouts |
| State | React useRef (30fps) + useState (4Hz) | Canvas perf outside React render cycle |
| Export | Blob API + vanilla JS template | Zero-dependency portable HTML animations |

## Key Numbers

| Metric | Value |
|--------|-------|
| Landmarks per frame | 33 joints |
| Detection latency | ~10ms (GPU) |
| Dual canvas render | ~1ms |
| React re-renders | ~4/sec (throttled) |
| Gesture hold time | 4 seconds |
| Pre-record countdown | 2 seconds |
| Smoothing window | 7 frames |
| Trackable anchor points | 7 (head, hands, shoulders, feet) |
| Built-in asset shapes | 6 |
| Exported HTML player | ~80 lines JS |
| Total codebase | ~2100 lines (single file) |
