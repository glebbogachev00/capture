# Capture media-reduction scan (GitHub)

Date: 2026-08-06.
Purpose: find algorithms/projects to shrink images, video, and web pages before they hit Capture storage, so a future media-capturing agent stays cheap and local.

Status: research only. Nothing built.

## Image reduction

| Repo | Stars | Use for Capture |
|---|---|---|
| phoboslab/qoi | 7.5k | Lossless, fast, simple format. Good for screenshots/UI captures where fidelity matters and speed beats ratio. |
| zetbaitsu/Compressor | 7.2k | Android native compression. Not web, but the algorithm pattern (downscale + re-encode) is the reference. |
| Donaldcwl/browser-image-compression | 1.7k | Runs in browser. Directly usable: compress before upload. Canvas-based. |
| addyosmani/squish | 1k | Batch browser compression. Good for a "shrink before store" step. |
| Netflix/image_compression_comparison | 277 | Benchmark framework. Use to pick a codec, not a dependency. |
| iamaaditya/image-compression-cnn | 338 | Neural compression. Overkill now; note for later if storage gets tight. |

Takeaway: for web/local-first, use browser-image-compression + modern codec (WebP/AVIF). qoi for lossless fast path.

## Video reduction

| Repo | Stars | Use for Capture |
|---|---|---|
| paulpacifico/shutter-encoder | 2.6k | FFmpeg front-end. The "what to run" reference: H.265/AV1, crf-based shrink. |
| xiph/daala | 560 | Modern internet video codec. Research, not drop-in. |
| microsoft/DCVC | 801 | Deep contextual video compression. Strong ratio, needs GPU. Defer. |
| NVIDIA/NvPipe | 394 | Zero-latency HW accel. Mac has VideoToolbox; same idea, use the native path. |
| commaai/comma_video_compression_challenge | 63 | Lossy challenge. Tells you the floor on ratio vs quality. |

Takeaway: for local-first Mac, use VideoToolbox (native HW) via ffmpeg or a small wrapper. Target H.265/HEVC at crf 28-32. AV1 if longer-term storage matters more than encode time. No cloud.

## Web page storage

| Repo | Stars | Use for Capture |
|---|---|---|
| gildas-lormeau/SingleFile | 22k | Save a full page as one self-contained HTML. The standard. Faithful, offline. |
| gildas-lormeau/SingleFileZ | 1.9k | Same, as self-extracting ZIP. Smaller if page has many assets. |
| gildas-lormeau/SingleFile-MV3 | 592 | Manifest V3 build. For extension capture path. |
| richardtallent/vite-plugin-singlefile | 1.2k | Inlines JS/CSS. Useful if Capture ever renders saved pages. |

Takeaway: SingleFile (or its lib form) is the move. One HTML file, no asset sprawl, opens offline. Pair with readability extract if only the article text is wanted.

## How this feeds the agent idea

Gleb wants Capture to capture images, video, web pages, and have an agent that scans them.
- Storage: apply the above at capture time (shrink before store). Keeps local-first cheap.
- Agent scan: needs a stronger model for image/video understanding. That is a separate cost tier from the sort/distill chain. Design it as an opt-in "analyze media" action, not automatic.
- Order: capture + shrink first (cheap, safe). Agent scan later (model cost, opt-in).

## Deferred

- Neural compression (CNN/DCVC) — only if storage pressure justifies the GPU cost.
- Graph/web-graph storage — rejected per PKM guidance.

## Reference queries used

- gh search repos 'image compression'
- gh search repos 'video compression'
- gh search repos 'web page archive'
- gh search repos 'singlefile'
