# Matte investigation and Relay video-editor plan

Investigated 8 October 2026. Target: `/Applications/Matte.app`, version **2.0.2 (231)**, bundle identifier `com.jose.Matte`. This is a research report and implementation proposal. **No Relay editor, schema, renderer, API, or test code was changed.**

Matte's shipped resources reveal a substantial animation system: separate camera and clip-transform tracks, spring/custom curves, 27 motion presets, 36 documented text effects, layered 3D composition, cursor/touch styling, and deterministic JavaScript code clips. Native metadata corroborates the presence of timeline, curve editing, SceneKit/Metal rendering, and export components. Relay already implements core animation, audio, timeline, and recovery features; its largest differences are animation authoring, expressive text, cursor tracks, and mesh-backed 3D rendering.

**Coverage limit:** this is a broad shipped-artifact investigation, not a complete recovery of every implementation. REA opened the executable and inspected its Mach-O and application inventory, but Hopper startup timed out before any native function could be decompiled. A retry after dismissing its first-run demo prompt also timed out. Matte's welcome window was observed; subsequent UI access timed out, so editor playback, curve manipulation, and export were not runtime-verified. Claims below distinguish observed resources, controlled replay, bundled documentation, inference, and unknowns.

## Evidence and reproducibility

The [evidence index](research/matte-2026-10-08/evidence-index.json) preserves artifact identity, selected inventory locations, dependencies, helper-replay output, and exact failure records. More detailed passes are in [resource findings](research/matte-2026-10-08/resource-findings.md), [guide findings](research/matte-2026-10-08/guide-findings.md), [class addresses](research/matte-2026-10-08/class-addresses.txt), [ivar metadata](research/matte-2026-10-08/ivar-fields.txt), and [string offsets](research/matte-2026-10-08/string-offsets.txt).

| Evidence alias | REA Evidence ID / source | What it establishes |
|---|---|---|
| E1 | `ev_0957334f0e6a9249cfa8188d9666d33a81d38f3d0ff98081dfd3c28d55116e61` | Mach-O slices, executable identity, dependencies, load commands; static only |
| E2 | `ev_0bface269c6984e8b60074d168bc9a27b4f9bd28f73509edf32b2eb380078c42` | Application artifact inspection; includes E3 inventory |
| E3 | `ev_90399b3ee1f92db9c2c59a5feea6c90dc9b2ef0fd02f9a4e952637d945e661e3` | Content-addressed inventory: 527 nodes, 539 occurrences, 532 edges; completeness applies to inventory, not behavior |
| E4 | `ev_0284046a6ab4a4afe8b202dccc40d3958e53122db75c1a4832f4f1ef7289d278` | Controlled Node replay of shipped `CodeClipHelpers.js`; six behavioral assertions passed, exit 0 |
| S1 | `Resources/Presets/*/preset.json`, linked through E3 | Parsed preset formats, curves, channels, and values |
| S2 | `Resources/CodeClipHelpers.js` and `CodeClipCanvas.js`, linked through E3 | Actual shipped JavaScript source; the native replay backend remains unknown |
| D1 | `Resources/CraftGuide.md`, linked through E3 | Bundled descriptions of intended editor and agent behavior; not observed execution |
| D2 | `Resources/3DModelVariants/README.md` and JSON manifests, linked through E3 | Resource schemas and model-authoring descriptions; not proof of runtime algorithms |
| M1 | `otool -arch arm64 -ov`, `nm`, `strings`, saved inventories | Runtime type/ivar names and embedded text; architecture clues, not recovered calls |
| R1 | Relay source references below | Current implementation inspected; existing QA results are recorded, not rerun here |

Executable SHA-256: `cf669b5e3a8f99e1235f80075c7872c10e37e0db19c2d684fc8f761bb4d62452`. REA artifact manifest: `agm_8b0427f042a1381c2ac780ca86c1900bd492b4dffc34891721d840d5a088bfce`. Helper SHA-256: `51ccfff1e4b13bb002d3797e317ffab768012c0ac89cd4148939a9f079e59da8`.

Replay the bounded helper probe with:

```sh
node docs/research/matte-2026-10-08/probe-shipped-helpers.mjs
```

This reads the installed helper, evaluates it in an isolated JavaScript context with a stubbed Path2D, and checks tween timing, holds, scale interpolation, spring evaluation order, seeded randomness, and screen-point projection. It does **not** execute Matte's native editor or verify drawing, native animation curves, Metal rendering, export, or preview/export parity. The process capture did not observe network or general filesystem activity.

## What the animation system contains

### Camera and per-clip motion

**Observed preset structure (S1/E3):** 53 preset packages contain 27 motion and 26 style/layout presets. Twenty motion presets target camera tracks, seven target clip transforms. Motion presets span format versions 2 and 4; 20 use version 4. Their populated tracks contain 468 keys: 314 `easeInOut`, 80 `spring`, and 74 `custom`.

Keys store UUID, `time`, `value`, `curve`, and `curveParameter`. Custom keys also store two 2D control points. Track schemas include XYZ offsets, XYZ rotation in degrees, scale, aperture/focus, environment rotation, and device-model parameters such as lid opening. Only offsets, rotations, and scale are populated in this motion-preset inventory. Empty schema channels are not evidence of a shipped animated example.

**Documented model (D1:214–279):** camera animation moves the shared scene; clip animation moves one card. Resting poses are distinct from animation segments. Segments have entry/exit transitions and optional hold-after behavior. Camera moves can span cuts; clip transforms can span linked clip nests. Camera moves and whole-frame zooms share a non-overlapping effects track. Presets become ordinary editable keyframes and can be retimed or shifted around the user's framing.

**Unknown:** the native evaluator's exact spring equation, meaning of `curveParameter`, duplicate-key policy, interpolation of every native property, quaternion/Euler handling, and direct preview/export call chain. Do not map the preset's spring parameter to the separate code-clip spring coefficients without more evidence.

### Easing and deterministic sampling

**Shipped code and controlled replay (S2/E4):** code clips expose 21 named easing functions, including polynomial, exponential, sine, back, elastic, and bounce families. `M.tween` holds the first/last value outside the key span and interpolates scalar or component-array values. Its easing belongs to the **arriving key**. Default easing is cubic in/out. Perceptual scaling uses geometric interpolation, `a × (b/a)^u`, with a small positive fallback for zero endpoints.

`M.spring` evaluates a damped spring directly at the supplied time. It accepts duration/bounce or stiffness/damping/mass and initial velocity; defaults for physical coefficients are 170/20/1. It implements underdamped, critically damped, and overdamped branches. No incremental animation clock is needed by this helper. Replay at out-of-order times produced identical results; the default helper spring overshot to about 1.01339 at 0.6 seconds.

**Important subsystem distinction:** the bundled guide describes native key curves as belonging to the segment a key starts (D1:221). The code-clip helper uses the arriving key (S2:56–73). Relay also uses the departing key (`video-animation.ts:41–50`). These conventions must not be silently mixed.

### Text animation

**Documented catalog (D1:295–345), not implementation recovered:**

| Family | Presets |
|---|---|
| Whole text, 12 | fade, rise, descend, focus, zoom, zoomOut, slideLeft, slideRight, squeeze, drift, swing, streak |
| Character/word/line, 14 | typewriter, cascade, dissolve, reveal, ascend, tracking, gather, stack, fadeLines, slideLines, dropLines, weave, wave, pulse |
| Playful, 10 | pop, bounce, punch, flip, tumble, wobble, shuffle, twirl, scatter, rain |

The guide describes enter/exit switches and durations, front/back/3D text layers, kerning, line height, stroke, shadow, and box/per-line backgrounds. Code-clip helper source separately provides staggered progress and per-piece text drawing facilities. Native glyph layout, individual preset equations, exact staggering, blur kernels, and text rasterization were not recovered.

### Cursor and touch animation

**Observed configuration (S1/E3):** two macOS style presets serialize cursor size, low smoothing, continuous display, system design, contrast, auto-hide delay 0.85 s, fade 0.2 s, shape morphing, release scale 1.8, opacity, border/fill, and shadow. Resources include cursor SVG shapes. M1 identifies `CursorTracker`, `SimulatorCursorTracker`, cursor timeline caches, and smoothed cursor caches.

**Documented behavior (D1:139–149,501–504):** simulator gestures record screen position and time; cursor controls support phone touches and desktop pointers, smoothing and continuous/tap-only display. Duo recordings can associate touches with separate screens and keyed folds.

**Unknown:** event serialization, smoothing filter, spring/morph math, click-release timing, coordinate conversion through crop/scale/3D, and exact capture synchronization.

### Code clips and arbitrary graphics

**Observed implementation (S2):** a code clip declares controls and `draw(ctx,t,controls,clip)`. `CodeClipCanvas.js:15–46` records drawing operations in a Float64 command buffer with interned strings, then calls native replay. Operations include state, transforms, paths, fill/stroke, text, images, symbols, backdrop, filters, and shaders.

`__frame` at lines 1507–1522 recreates the program and module state for each supplied time, draws, then flushes. Lines 978–980 disable unseeded randomness and wall-clock time. `M.random(seed)` is repeatable (E4). Cache and video/audio facilities delegate to native APIs; their native implementation was not recovered.

**Documented behavior (D1:366–499):** code clips can draw transparent overlays or device-screen content, expose editable controls, share modules/data/fonts, use audio analysis, and render at arbitrary times. Per-clip motion blur has shutter/sample controls. The source supports a deterministic frame contract; the guide's claims about GPU composition, background execution, and performance need runtime corroboration.

## How the editor and renderer are organized

### Timeline and editing

**Bundled documentation (D1:99–178):** 16 video, 5 text, 5 caption, and 6 audio tracks; one effects track; a 60 fps editing grid; half-open clip intervals. Operations include trim, split, slip, move, ripple deletion, keeping source ranges, speed changes, freeze frames, duplication, and linking. Nests share device appearance and motion while member clips keep source timing/audio/cursor settings. Export range can include text before footage. These documented limits were not exercised.

M1 exposes `TimelineModel`, `TimelineDocumentView`, `TimelineClipRenderer`, `TimelineKeyframeDragState`, and `TimelineSegmentCurvePopoverPresenter`. Fields cover video/audio tracks, linked clips, selected camera/transform keys, motion-blur settings, and default curves. That corroborates the presence of components, but does not prove every documented operation or UI behavior.

### Scene composition, devices, and lighting

**Documented composition (D1:99–124,180–199):** video/image cards and optional 3D text share one scene camera. Front/back elements and the canvas background stay flat. A whole-frame zoom magnifies the final frame, including text/background. Scene controls include environment lighting/reflections, exposure, bloom, focus/lens blur, shadows, and screen light.

**Observed assets (S1/D2/E3):** 16 protected `.matte3d` resources and 16 variant/material-index pairs; five HDR/EXR studio resources; Metal library and LTC lookup textures. Material schemas expose diffuse, normal, occlusion, metallic, roughness, opacity, emissive, clearcoat, texture channels/UV sets, and scalar overrides. Variant JSON carries colors and texture adjustments.

The model README describes a prepared USDZ path and Duo rig with 27 joints and 61 samples of a two-second fold animation. It says the app samples bone transforms directly for scrubbing, blur, lighting, and export. The installed models have a `MATTE3D1` wrapper instead of exposed USDZ files. **Wrapper decoding and runtime rig sampling remain unknown**; README statements are not function-level proof.

M1 identifies `Scene3DCardSceneRenderer`, scene/camera/card/model nodes, contact/drop-shadow pipelines, depth-of-field, screen-light, and spatial/supersampling resolve fields. E1 confirms SceneKit, Metal, MetalKit, MetalPerformanceShaders, JavaScriptCore, AVFoundation, CoreVideo, ScreenCaptureKit, and VideoToolbox dependencies. Dependencies and fields support an architecture inference; they do not reveal shader algorithms or quality/performance measurements.

### Preview and export

M1 contains `MetalPreviewRenderer`, `MetalPreviewExporter`, `CodeClipMetalRasterizer`, output/render buffer pools, and frame sources keyed by track, webcam clip, and background slot. AVAssetWriter-related strings and AVFoundation/VideoToolbox dependencies are observed. A shared GPU scene with media decoding, frame evaluation, compositing, and encoding is a **plausible architecture**, not a verified native call graph.

D1:572–593 documents video, GIF, still, transparent PNG, preview/contact-sheet, export profiles, and review checks for timing/cuts/gaps/gestures. Codec settings, audio sample synchronization, color management, alpha handling, cancellation, memory use, proxy generation, export speed, and preview/export equality remain unverified.

### Persistence and history

`Info.plist` registers `.matte` as a package document. Presets are JSON packages; their structure does not establish the project format. No bundled project example was found under Resources. `StudioEditor` state fields include playback clock, current time, export state, cached frame renderer, and drag previews. Project schema, migration rules, undo grouping, autosave durability, and missing-media recovery remain unresolved.

## Comparison with Relay

These Relay findings are source observations, not a new browser/export test run. Existing QA records are in `docs/VIDEO_EDITOR_QA.md` and describe fixture-backed verification with real media renders; they do not establish deployed cloud services.

| Area | Matte evidence | Relay now | Consequence for the plan |
|---|---|---|---|
| Curves | Preset spring/custom keys; helper math; documented native Bezier/strength | Four curves, three quadratic; same algebra generates numeric preview and FFmpeg expressions | Add expressive curves while preserving existing departing-key convention |
| Authoring | Curve-popover/drag-state metadata; documented editable keys | Text/device keys edited in inspector; camera markers on timeline | Expose direct keyframe lanes and curve handles |
| Text | 36 documented whole-text/per-piece effects | Eight effects; shared SVG label markup | Build per-piece text layout/evaluation before expanding presets |
| Camera | Documented scene camera distinct from final-frame zoom | Global 2D focus/zoom, 1×–4×; CSS preview and FFmpeg zoompan | Name scope explicitly; do not treat current camera as a 3D orbit camera |
| Devices | Protected models, PBR material data, renderer metadata | Projected SVG/vector bodies, two depth sheets, shared projection math | Mesh-backed 3D is a separate renderer project |
| Cursor/touch | Serialized design settings, tracker/cache metadata, documented gestures | No authored cursor/touch model found in inspected core/editor/render files | Add source-time event tracks and transform-aware overlays |
| Timeline | Documented multi-track edits, nests, effects segments | Sequential clips plus 12 timed layers, labels, global camera, one music object | Add linked groups and edit semantics incrementally |
| Audio | Documented multiple tracks, beat/bar/drop analysis and snapping | Clip/layer audio plus timed music with source offset, fades, volume | Multiple sound lanes and beat guides can follow core animation work |
| Custom graphics | Shipped deterministic code-clip protocol | Declarative labels/devices/AI-generated timeline | Consider a constrained procedural graphics contract later |
| Persistence | Package UTI observed; internal schema unknown | Versioned timeline JSON, revisions, render snapshots, local draft, 50-snapshot undo | Preserve current guarantees while evolving the format |

Relevant Relay anchors:

- `packages/core/src/index.ts:266–367`: animation, clips/layers, camera, and timeline types.
- `apps/web/lib/video-animation.ts:27–96`: easing, sparse tracks, entrance/exit composition; `:106–157`: validation.
- `apps/web/app/video-animation-controls.tsx:13–45`: inspector keyframe capture/editing.
- `apps/web/lib/video-camera.ts:50–89`: shared camera evaluation, CSS transform, 30 fps FFmpeg zoompan.
- `apps/web/app/video-label-editor.tsx:52–73`: history, autosave, local recovery; `:142–150`: preview and timeline lanes.
- `apps/web/lib/device-motion.ts:115–242` and `device-frames.ts:145–178`: projection/vector geometry.
- `apps/web/lib/video-renderer.ts:216–267`: layers, camera, labels, audio/music, final encoding.
- `apps/web/lib/video-timeline.ts:8–25` and `video-transition.ts:11–41`: overlap schedule and transitions.

One concrete compatibility finding: Relay applies easing after an authored key; Matte's code-clip helper applies the next key's easing. Existing Relay projects must keep their current meaning. Any imported or new animation format should convert that convention explicitly.

## Proposed implementation sequence — no implementation performed

### 0. Close the evidence gaps and define the reference scenes

Use isolated test projects to exercise curve editing, arbitrary-time scrubbing, holds, nest cuts, cursor transformations, 3D lighting, motion blur, and exports. Record exact app/build identity. Pair native function evidence with runtime captures once a working analysis provider is available. Recover only the internal contracts needed for design decisions.

Reference scenes should include: a spring landing; a custom curve; camera motion across a cut; one device moving independently; glyph/word/line text; a touch following a tilted screen; Duo fold at random times; and a preview/export comparison. This gate is required before claiming exact Matte parity, but is not necessary to justify the independently useful Relay improvements below.

### 1. Strengthen the animation contract

Extend Relay's curve descriptor with custom cubic Bezier, spring/bounce, and optional perceptual scale interpolation. Preserve the existing key convention. Define time units, property interpolation, pose hold/reset, exact cut timing, equal-time key rejection, and endpoint behavior in a versioned contract shared by UI, templates, AI compiler, MCP, and renderer.

Keep arbitrary-time evaluation independent of playback state. Spring progress may overshoot; clamp bounded properties such as opacity without flattening position/scale motion. Use a clear initial-velocity policy. Explicitly convert code-clip-style arriving-key curves if that format is ever accepted.

For export, evaluate whether richer curves can be represented reliably by FFmpeg expressions or should be sampled into frame transforms. Avoid forcing cubic inversion and long spring expressions through parser limits without a measured check.

**Likely change surface:** core animation types; `video-animation.ts`; `video-camera.ts`; normalization, template/composer compilation, MCP schemas, and render translation.

**Acceptance:** old documents evaluate unchanged; spring/Bezier endpoints and overshoot are defined; arbitrary-order scrubbing matches sequential playback; numeric and export evaluation agree at endpoints, midpoints, cuts, and long tracks; save/reload/templates/MCP retain descriptors.

### 2. Put keyframes and curves on the timeline

Expose text/device/camera property lanes with visible keys, playhead capture, multi-selection, drag/retime, duplicate/delete, snapping, and a segment curve editor. Clearly distinguish project-time camera keys from local clip/text keys. Show hold/entry/exit spans when introduced. Treat a drag gesture as one undoable transaction.

Presets should compile into ordinary editable tracks and preserve the chosen resting pose. Retiming must stretch the animation and its transitions together. Keep advanced controls discoverable without crowding simple editing.

**Likely change surface:** `video-label-editor.tsx`, `video-animation-controls.tsx`, `video-camera-controls.tsx`, device lanes, workspace CSS, and timeline interaction helpers.

**Acceptance:** keys move at the correct local/global time; dragging and curve changes survive undo/reload; keyboard edits work; retimed presets maintain timing; long/mobile timelines remain usable. Cover real edit gestures, not only model setters.

### 3. Add expressive text and reusable motion recipes

Create a stable text layout model with grapheme, word, and line units, measured bounds, per-piece transforms/opacity/blur, and stagger controls. Reuse that evaluated layout in preview and export. Introduce a small distinct set first: character rise, word spring, line cascade, tracking, soft reveal, and blur-to-focus. Keep existing eight presets intact.

Develop Relay-owned motion recipes around camera/clip trajectories: entrance, reveal, orbit-like pose change, focus-and-return, and exit. Store them as data with duration/curve/rest-pose rules rather than hard-coded UI effects. Matte's catalog is a reference for coverage, not a requirement to reproduce its assets or preset values.

**Acceptance:** Unicode graphemes, multiline text, wrapping, long copy, font fallback, and arbitrary-time scrubbing behave consistently; decoded exports match layout/timing; motion recipes remain editable after application.

### 4. Add cursor/touch tracks and source-aware editing

Introduce optional timestamped screen events in source-media coordinates, with type, screen identity, pointer/touch state, and appearance. Map events through trim, source offset, speed/freeze, crop, device projection, and camera transformation before compositing. Provide manually authored tap cues even when recordings lack captured events.

Start with size/color/shadow, tap-only/continuous display, fade after idle, and a deterministic smoothing policy. Associate Duo events with the appropriate screen. Keep event evaluation sampleable at any time. Tie optional sound cues to events without double-playing recording audio.

**Likely change surface:** core/source metadata, timeline mapping, preview device projection, render overlays, import interfaces, and later capture integrations.

**Acceptance:** taps remain on the same source pixel after trimming and motion; event timestamps preserve audio sync; hidden/wrong-screen events do not leak; scrubbing and export agree; legacy sources render without events.

### 5. Prototype mesh-backed 3D before replacing the renderer

Define a scene contract separating device/object pose, camera pose/lens, front/back overlays, environment, lights, and final-frame zoom. Prototype one independently sourced/licensed device model with screen texture, materials, cast/contact shadow, and arbitrary-time camera/object pose. Then assess multi-device scenes, fold rigs, depth of field, screen light, and motion blur.

Measure browser capability, worker/export execution, video texture timing, memory, render latency, color/alpha, and preview/export agreement. Choose a renderer/library only after that prototype and current documentation research. Matte's Metal/SceneKit stack cannot simply become Relay's browser/FFmpeg implementation.

Keep the current vector path available during validation and for simple scenes. A backend change should follow a clear quality/performance decision, not the presence of competitor renderer class names. New render jobs should carry scene-format and renderer-version identity so a queued export remains reproducible.

**Acceptance:** scrubbing to arbitrary frames gives the same pose; multiple devices occlude correctly; reflections/shadows respond to the scene; folded screens retain source coordinates; export matches preview framing and timing; resource budgets and fallbacks are measured.

### 6. Expand editing, audio, and procedural graphics

Add linked clip groups/nests and explicit slip/ripple/speed/freeze semantics when the product needs continuous motion across source cuts. Model multi-lane audio with source time, envelope, and optional beat markers. Build beat snapping as a visible authoring aid with a defined collision policy.

Procedural graphics can follow as a constrained declarative or deterministic drawing interface: editable controls, explicit time, seeded random state, asset handles, bounded execution, and versioned rendering. Plan its execution and resource limits before accepting arbitrary user scripts. Cached results must include code/controls/assets/render-size identity and invalidate on edits.

Expand export profiles only after each relevant renderer path supports them. Retain revision snapshots, cancellation, local recovery, and API/MCP validation throughout.

**Acceptance:** group edits preserve camera/device/event/audio timing; beat snapping is undoable; repeated renders are deterministic; cancellation cleans owned resources; saved old projects remain editable and exportable.

## Finding ledger and unanswered questions

| Question | Status | Evidence boundary / remaining work |
|---|---|---|
| Which motion presets and channels ship? | Answered for bundled presets | S1/E3; 27 presets and 468 keys, catalog in resource findings |
| How do code-clip tween/spring helpers work? | Answered for sampled helper behavior | S2/E4; native timeline evaluator is separate |
| What text animation families exist? | Partially answered | D1 documents 36; native equations/layout not recovered |
| How are keys/curves edited in the UI? | Partially answered | M1 component names and D1; editor interaction unavailable |
| How are camera/device/zoom scopes separated? | Partially answered | Preset channels + D1; native pose math/calls unverified |
| How do devices/materials/folding work? | Partially answered | JSON schemas/assets + D2; protected model decoding and runtime rig sampling unknown |
| How are cursor/touch events rendered? | Partially answered | Serialized design + M1/D1; event format and filters unknown |
| How is custom drawing replayed? | Partially answered | JS command protocol recovered; native opcode backend unverified |
| How do preview/export share rendering? | Unresolved at call-flow/parity level | Dependency/class clues only; no native decompilation or export observation |
| How are projects, history, and caches persisted? | Unresolved beyond package identity/metadata | Need isolated project schema and native/runtime traces |
| How do audio/beat analysis and export profiles behave? | Partially answered | D1 only for most behavior; decode/mix/codec internals unverified |
| What should change in Relay? | Plan delivered | Phases above; no editor implementation changed |

Native function names are stripped in the inspected arm64 symbol table: 4,148 entries, only the executable-header symbol defined. `otool` still exposed 233 class/type names and useful ivar metadata. Names alone were not promoted to execution claims. Searches were bounded to the installed app bundle, its arm64 metadata, and the referenced Relay editor files.

REA doctor through the installed 4.0.1 CLI found the Codex registration and skill aligned, Hopper present, and Ghidra unconfigured. Missing registrations for other clients are unrelated to this chat. The requested `npx ...@latest doctor` could not resolve the npm registry in the sandbox, so the installed CLI was used. No setup/configuration writes or provider installation were performed. The broad JavaScript resource graph exceeded REA's IPC frame limit; direct source inspection and bounded helper replay supplied usable evidence instead.

The investigation supports a concrete plan, but **does not establish complete coverage of all Matte animations or editor internals**. Deep native tracing and representative editor/export runtime scenes remain the follow-up boundary.
