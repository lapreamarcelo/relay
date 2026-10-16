# Relay video studio implementation

Implemented on 8–9 October 2026 following the behavior research in [the Matte study](MATTE_REVERSE_ENGINEERING_PLAN.md). Relay uses independently written algorithms, original procedural geometry and separately licensed device models, its existing visual identity, and original editable recipes. No Matte code, shaders, device assets, fonts, textures, or preset files are included in the application.

## Authoring

- Spring, bouncy, and custom cubic Bézier curves share numeric preview and FFmpeg expression sampling. Curve controls include handles and spring response settings.
- Sparse property keyframes support direct timeline drag, selection, keyboard nudging, duplication, deletion, retiming, and one undo transaction per drag. Perceptual scale interpolation and optional return to resting pose are available.
- Thirty original recipes include Quiet arrival, Accent beat, Slow drift, and Turn & land. They compile into ordinary editable keyframes.
- Thirty-six effects include letter rise/drop, word spring/blur, line cascade/wipe, tracking, soft reveal, focus, ripple, and spin. Character segmentation respects grapheme clusters; unit layout remains stable while animating. Both entrance and exit effects use absolute time.
- Clip tools support source slip, playback speed, held frames, linked motion, and ripple timing edits. Linked cuts retain a continuous device-animation clock. Independent layers can also change speed or hold a source frame.
- Sound layers have independent placement, offsets, volume, fades, looped source sampling, and an optional BPM grid for beat snapping.
- Pointer events are imported as normalized source coordinates and source timestamps. Trimming, speed, freeze, crop, camera motion, and screen projection preserve alignment. Duo inner and rear display cues are kept separate. Tap rings remain at the recorded tap location.
- Seeded shapes, particles, bars, and rings provide constrained procedural graphics. They have bounded counts and configurable timing, size, color, position, and motion speed.

## Scene and output

Classic vector devices retain their legacy behavior. Studio devices use original rounded extruded geometry, backs, hardware, laptop decks, Watch straps, and a hinged Duo with rear cover display. Sparse scene keyframes animate XYZ camera offsets, rotations, and focal length; studio device keys can animate depth. Shared scene settings control camera, lens, environment, exposure, material response, shadows, focus softness, and shutter sampling. Object and scene camera clocks remain separate from source playback and final canvas focus/zoom.

Output settings support MP4, WebM, GIF, PNG, and JPEG, 24/30/60 fps, 720p/1080p/2160p, and draft/standard/high quality. PNG/JPEG use the cover frame. Downloads use the actual format and MIME type. Text is rendered in the canonical design canvas and scaled for output, preserving typography across resolutions. Video post handoff remains available for MP4/WebM.

The editor, preview helpers, renderer, templates, composition compiler, catalogs, API normalizers, and MCP schemas preserve the new optional fields. Timeline version 1 remains compatible with existing documents. Invalid recovered drafts are ignored; renderer source assets remain restricted to the Relay media library.

## Optional GPU models and recording

`deviceFrame.renderMode:"gpu"` uses the same Three.js scene in the browser preview and headless Chromium export. Choosing this mode/model preserves the current authored motion; a new frame has a static pose and no generated rotation. Rotation is optional through pose controls, keyframes, or a selected recipe. Licensed Watch Ultra 2, iPhone 15 Pro Max and Galaxy S25 Ultra models ship with credits. Other device families use original generic geometry, including the folding two-screen rig. A tablet is not advertised as an exact licensed iPad, and the folding rig is not a manufacturer model. Model URLs are bundled; arbitrary remote GLB loading is not supported.

The shared GPU scene provides per-pixel depth, multisampled bezel edges, PBR room reflections, exposure/material/light controls, cast shadows, exact unlit recording colors, camera/lens animation, depth of field and five temporal shutter samples of geometry, source media and scene text. Scene labels are vector glyph textures on depth-tested 3D planes, with optional X/Y rotation and animated depth. Flat labels can sit behind devices or above the scene. The preview follows its displayed size and up to 2× display density, bounded to 1920 pixels; exports retain the selected resolution. Source audio stays in the existing FFmpeg mix. GPU source media is capped at 512 MB per scene. Chromium export uses software GPU rendering for a consistent host runtime and is more expensive than flat frames. See [deployment requirements](GPU_RENDERING_DEPLOYMENT.md).

Bundled licensed DejaVu fonts provide actual TrueType advance widths, pair kerning, grapheme-safe wrapping and deterministic glyph paths. Weight, alignment, spacing, stroke, shadow and backdrop controls are shared by preview/export. Heavy and bold share a bold face; italic is a deterministic shear. Missing glyphs use the font fallback glyph. Contextual Arabic/Indic shaping, bidi layout and color emoji are not implemented.

Recording uses an explicit browser screen/window chooser, local review/discard, then authenticated library upload. Finite measured duration and source-relative imported gesture events are preserved. The optional native simulator CLI dispatches timestamped AXE gestures and captures with simctl; real Simulator recording has not been exercised in the sandbox. Browser screen sharing cannot observe pointer gestures inside another app. See [recording instructions](VIDEO_RECORDING.md).

If public library media cannot load directly because of cross-origin settings, GPU textures and audio analysis retry through an authenticated, bounded same-origin preview endpoint. This endpoint accepts only configured public library URLs, disallows redirects and active document types, and supports validated video byte ranges.

Audio analysis decodes actual PCM in a Worker to estimate BPM/phase/confidence, beats, 4/4 bars, energy changes, quiet sections, waveform and frequency bands. Silent/uncertain analysis is visible and not applied automatically. Graphics can react to current source timing, gain, fades and loops. Custom drawing clips interpret bounded JSON/math instructions with editable number/color/text controls; they do not execute arbitrary JavaScript or GLSL.

## Rendering limits

The existing `mesh` mode remains a deterministic software projection with approximate lighting, painter ordering and geometry-only shutter sampling. The optional `gpu` path adds actual depth and materials; it is an independent Relay implementation, and exact native Matte parity has not been established. All three rendering modes remain available. No Matte code, models, textures, shaders or preset files are copied.

## Verification

Unit and integration tests cover legacy documents, curve algebra parity, seeded arbitrary-time sampling, text rasterization, clip clocks, links, source events, templates, normalization, download metadata, and MCP transports. Production renderer tests use real FFmpeg with local media/storage mocks, including accelerated source sampling, held-frame audio, independent sounds, all formats, rear screen events, mesh motion, depth order, and typography at multiple output resolutions. Desktop and mobile browser tests cover persistence, curves, recipe editing, keyframe gestures, scene controls, source edits, graphics, output settings, and the existing editor workflows. No remote media was published during verification.

The 8 October baseline passed 173 web library tests and four MCP transport tests; web and MCP TypeScript checks passed. The final affected browser suite passed 13 tests, with one intentionally skipped mobile mouse-drag test. Broader editor layout, camera, multi-device, composer, and variant browser regressions also passed during integration.

The longer showcase exposed a finite pointer-overlay framesync stall in single-screen mesh exports. Pointer compositing now finishes before entering the scene graph, and a five-second real-FFmpeg regression verifies all 120 frames and both tap cues. Actual editor screenshot/playback capture also verified the narrow scene inspector after correcting its control layout. [Showcase artifacts](demos/video-studio/) include screenshots, browser playback, the rendered sample, and source timelines.


The 9 October upgrade passed 207 web library tests, four MCP transport tests, web/MCP typechecks and the production build. Browser checks exercise real PCM Worker analysis, actual MediaRecorder with a test canvas source, finite recording duration/gestures, static GPU mode selection, typography and drawing persistence. GPU visual checks use the actual licensed models and production browser bundle. The new [12-second Racketly showcase](demos/racketly-2026-10-09/racketly-relay-demo-3d.mp4) uses the production FFmpeg/Chromium pipeline with local library/storage adapters; no cloud writes. Device poses stay still first, then use explicitly authored rotation keys.

The five GPU browser regressions verify exact static-frame equality, native screen integrity through rotation, transparent depth-of-field output, scene text depth/tilt, all six transition kinds, a single shared canvas for simultaneous devices, and recovery after a direct cross-origin media load fails. Sixteen affected Chromium editor/runtime cases pass, including recording and actual audio Worker analysis. Container asset/browser inventory is checked; no container image was built or deployed in this session.

The bezel-quality follow-up passed the production build and nine affected Chromium checks, including fractional alpha coverage on the real Watch silhouette, HiDPI resizing, exact source colors, static poses, explicit rotation, depth-of-field alpha, all six transitions, shared scenes, and media fallback. Wipes clip both incoming and outgoing halves to avoid relying on coplanar depth ties after MSAA resolution. The Racketly showcase was re-rendered at 1920×1080 with 288 video frames and AAC audio.
