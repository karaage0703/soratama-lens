# Validation — 2026-09-30

- `node --check app.js`: PASS
- `uv run --with playwright --with pillow python tests/smoke.py`: 15 checks PASS
- Chromium 153.0.8010.12 / headless / ANGLE SwiftShader (software Vulkan). WebGL error=0.
- Image upload, PNG export, output dimensions, quadrants-based orientation check, lens inversion switch, pointer placement/reset, portrait input, corrupt-input recovery.
- 320 / 375 / 414 / 768 px: sample → adjust → save → reset, horizontal overflow absent. Desktop 1440px and mobile 375px screenshots visually inspected.
- Video play/pause/seek; controls disabled during recording; two-second source exported at 640×360. Last video packet end: 1.911s. Output contains video and audible audio; full decode with ffmpeg passed.
- Early stop produced a decodable partial video; audio unchecked produced no audio stream.
- No uncaught JavaScript errors or external requests. Project-subpath hosting and direct file:// image input/PNG output passed. Additional file:// audio+video export check passed.
- Evidence (local, excluded from distribution): artifacts/test.log, results.json, desktop.png, mobile.png, recorded.webm, partial.webm.

## Boundaries

Physical GPU speed, Safari/Firefox/iOS/Android, large real-world videos and GitHub Pages publication are not verified. Shader operation was tested with software rendering, not measured on the user's GPU. Hardware acceleration depends on the host browser.

MediaRecorder WebM may omit duration metadata. Duration was checked using packet timestamps, not a container duration field. Some players cannot display duration or seek until they scan the file. Encoding is real time, up to 30fps, and does not guarantee every source frame.

## MP4 format selection — 2026-10-01

- JavaScript syntax check and the 15-check browser regression suite passed after this change.
- `uv run --with playwright python tests/formats.py`: 5 additional checks passed. Run after smoke.py to generate its input fixtures.
- A WebM without duration metadata was reopened by seeking to discover its end.
- Explicit MP4 with unsupported AAC audio disabled recording without changing the audio checkbox.
- H.264-only MP4 export produced a real MP4 file and decoded successfully with ffmpeg.
- Automatic format selection preferred MP4 where supported and WebM with audio on this Chromium. Unsupported formats remained disabled; 375px layout was visually inspected.
- This Chromium cannot encode AAC with MediaRecorder. Audio+MP4 recording on other browsers remains unverified; capability checks gate that option. Generic MP4 MIME is deliberately avoided because it can select audio codecs other than AAC.
