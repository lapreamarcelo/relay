# Matte `CraftGuide.md` editor and animation inventory

Evidence source: `/Applications/Matte.app/Contents/Resources/CraftGuide.md` (bundled documentation; section and line references below). The guide describes Matte's intended interface and behavior. This pass did not exercise the app, so guide claims are not runtime observations. Separate static source evidence for code-clip helpers is explicitly identified below; it also does not prove native rendering behavior.

## Timeline, tracks, clip layers, and editing

- **Bundled documentation describes** a shared 3D scene and single camera for video/image cards; 16 video, 5 text, 5 caption, 6 audio tracks plus one effects track shared by camera animations and zooms; 60 fps timeline; clips cover `[start,end)`; hidden tracks do not render and locked tracks reject edits. Export defaults from first video/text to last unless range is set. Text, captions, and branding can play through video gaps. (`99–106`)
- **Bundled documentation describes** default video/image clips as 3D cards; Back and Front video/image/text layers remain flat relative to camera; background is flat; 3D text moves with camera/parallax; captions and branding stay above scene. `matte_text` layer can also set video clips to Front/Back/3D. Zoom magnifies the whole rendered image, including background and text. (`108–124`)
- **Bundled documentation describes** timeline operations: split, trim/source-in/source-out, slip, move between tracks, delete, ripple-delete, keep source ranges, delete-gap, duplicate, speed, freeze-frame, link/unlink. Ripple edits move later material across tracks, including camera moves; speed defaults to ripple; move either lands exactly or refuses collisions. Images default to 5 s. (`126–137`)
- **Bundled documentation describes** freezes, standalone still-at-source-time clips, and linked nests: device/look/shadow/3D pose and in/out animation shared across linked clips; timing, speed, audio, crop, cursor per clip. One clip animation can span a nest/cuts; camera animation can span any cuts. Duo has inner/outer lanes and keyed folds. (`150–178`)
- **Bundled documentation describes** simulator gesture recording including taps, double/long press, swipe/flick, pinch, home, typing and key presses; recorded touch positions/times; idle trimming and `hold_after`; Duo poses and screen lanes. (`139–149`)

## Device transforms, lighting, environment, and camera

- **Bundled documentation describes** device/style controls: device model, flat/photoreal/3D bezel, frame color or bare screen; scale; 3D rotation x/y/z, x/y offsets in canvas heights, z toward/away from camera, scale; behind/below shadow; screen light; per-clip depth of field; fade/slide/scale entrance and exit. Multiple simultaneous clips on different video tracks appear in the shared scene; higher track draws in front at same depth. Orientation, Duo pose, Mac lid-open and Duo fold-open can be keyed. (`180–189`)
- **Bundled documentation describes** solid/gradient/image/pattern backgrounds and looping background video; environment presets/custom image lights and reflections, optional environment as background, yaw/pitch, exposure/contrast, bloom, camera-keyed focus depth/lens blur, and scene motion blur enabled by default. (`191–199`)
- **Bundled documentation describes** camera animation as whole-scene motion affecting devices, lighting/reflections, and 3D text, while clip animation affects only one card. `matte_scene` camera values define resting pose; `matte_animate target=camera` supports start/end pose or absolute keys, carrying unset values forward. `hold` keeps the landing pose through the next move/end; without hold it returns over `out`. First key on a cut with `in=0` aligns the framing cut to the video cut; one-frame-spaced keys can make a hard cut; Matte may adjust keys near video cuts. (`214–220`)
- **Bundled documentation describes** easing `ease`, `ease-out`, `ease-in`, `linear`, `spring`, `bouncy`, `curve_strength`, or CSS-style cubic Bézier `curve_points=[x1,y1,x2,y2]`, globally or per key segment. `in`/`out` blend from prior/resting pose and back to rest; touching animations blend directly; the shared effects track prohibits overlapping camera moves and zooms. Device animations use similar in/out and hold behavior within their clip/nest. (`221–232`)
- **Bundled documentation describes** same-named camera and clip transform values having some opposite screen directions (camera orbit inversion); offsets in canvas heights; focal length changes scale/perspective with a specified z compensation; camera `rotation_z` is roll. A zoom magnifies a fixed point of the final frame rather than repositioning scene elements; `fit_rect` and tap target coordinates are available. `matte_director` composes one flowing camera move across screen areas/times and replaces overlapping manual camera/zoom moves. Presets can be retimed/shifted/key-edited; camera entrance lands at resting framing, other camera presets are centered with `ends_off_framing` adjustment. (`234–270`)
- **Bundled documentation describes** device animations as clip-local pose/keys with `hold`; keyframes must fit within clip boundaries unless linked into a nest. Camera moves have no cut-span restriction. (`272–279`)

## Text, kinetic type, captions, and branding

- **Bundled documentation describes** editable text layers with font, size, weight, color, opacity, alignment, 0–1 canvas position, kerning, line height, rotation, italic, stroke, shadow, and box/pill/per-line backgrounds, borders, shadow, gradients. Front is default, Back and 3D available; text lanes cannot overlap. Styles can be applied/matched but do not change words, position, or timing. Animation preset, enter/exit toggles, and durations are configurable. (`283–293`)
- **Bundled documentation lists** 12 whole-text classic presets (`fade`, `rise`, `descend`, `focus`, `zoom`, `zoomOut`, `slideLeft`, `slideRight`, `squeeze`, `drift`, `swing`, `streak`); 14 editorial letter/word/line presets (`typewriter`, `cascade`, `dissolve`, `reveal`, `ascend`, `tracking`, `gather`, `stack`, `fadeLines`, `slideLines`, `dropLines`, `weave`, `wave`, `pulse`); and 10 playful/springier presets (`pop`, `bounce`, `punch`, `flip`, `tumble`, `wobble`, `shuffle`, `twirl`, `scatter`, `rain`). Descriptive effects are in the guide table. (`295–345`)
- **Bundled documentation describes** captions as speech-only, generated from audio and editable for recognition errors; retiming picture separately from voice-over can desynchronize them. Branding intro/outro/logo cards include background, logo/text layout, and background/text entrance/exit transitions; card layers above text/captions (webcam exception). (`347–364`)

## Code clips, custom animation, audio, cache

- **Bundled documentation describes** a JavaScript Canvas 2D code clip as a video-track clip, either a transparent overlay (author supplies all appearance/motion) or a device-screen rendering that inherits device/camera/shadow/preset treatments. Different video tracks can overlap. `draw(ctx,t,c,clip)` is intended as a deterministic per-frame function called in arbitrary order; `t` is clip-relative and survives start trim; `Math.random`/`Date.now` are disallowed; `M.random(seed)` is documented. Per-clip motion blur uses `motionBlur` shutter and 1–48 samples (default 16). (`366–402`)
- **Bundled documentation describes** overlay placement via `clip.scene.devices` screen corners/bounds, `M.screenPoint`, tap coordinates and `matte_layout`; one code clip per independently timed/moved item; timeline operations apply. Required exposed controls include text, slider, color, picker, toggle, image. (`404–438`, `490–499`)
- **Bundled documentation describes** helpers: `M.ease.*`, `M.tween` keyframes and optional perceptual interpolation, `M.spring` with duration/bounce or stiffness/damping/mass, and `M.stagger`; kinetic text (`M.text` by run/word/letter and per-piece callback), layout, pixels, symbols, image/video, patterns, filters, and GPU shaders are documented. Canvas readback is unavailable. `M.audio` reads the project mix at clip-local time for pulse, level/bands, spectrum, waveform, beat grid and drop data. (`440–463`, `473–480`)
- **Bundled documentation describes** code clip modules/data/fonts/SVG in shared project library, audio-reactive helpers, background-thread rendering/GPU composition, a recommended under-~8ms JS/frame target, and `M.cache` for static layers keyed by code/controls/size (not `t`). Create/update/edit/preview return filmstrips and warnings; `matte_render_contact_sheet` can show code events. (`465–471`, `482–499`)
- **Static source corroboration (not runtime/native renderer proof):** `CodeClipHelpers.js:56–73` implements `M.tween`: empty keys return 0, the first/last values hold outside the key span, and each segment uses the *next key’s* easing (default `inOutCubic`) before scalar/componentwise interpolation; perceptual mode uses `scaleLerp`. `:75–100` implements damped spring equations, accepting either duration/bounce or stiffness/damping/mass. `CodeClipCanvas.js:1507–1522` resets image handles/module cache, sets clip time/timeline start, builds the program, calls `draw`, and flushes each frame. `:978–980` makes `Math.random` and `Date.now` throw. `:982–998` delegates cache layer reuse to native `beginLayer`/`endLayer`; `:1036–1054` delegates video frame retrieval to native `videoInfo`/`videoFrame`. The bundled guide’s claims about render correctness, background execution, GPU composition, or cache performance still require runtime evidence.

Representative source excerpts:

```js
// CodeClipHelpers.js:64–70
const [t1, v1, e] = keys[i];
if (t < t1) {
  const [t0, v0] = keys[i - 1];
  const k = easeFn(e)(t1 > t0 ? (t - t0) / (t1 - t0) : 1);
  return Array.isArray(v0) ? v0.map((a, j) => mix(a, v1[j], k)) : mix(v0, v1, k);
}
```

```js
// CodeClipHelpers.js:81–89
const from = o.from ?? 0, to = o.to ?? 1, v0 = o.velocity ?? 0;
if (o.stiffness !== undefined || o.damping !== undefined) {
  const m = o.mass ?? 1, k = o.stiffness ?? 170, c = o.damping ?? 20;
  w0 = Math.sqrt(k / m); zeta = c / (2 * Math.sqrt(k * m));
} else {
  w0 = (2 * PI) / Math.max(0.05, o.duration ?? 0.6);
  zeta = 1 - clamp(o.bounce ?? 0.25, 0, 0.95);
}
```

```js
// CodeClipCanvas.js:1507–1522
imageHandles.clear(); moduleExports = new Map();
clipTimelineStart = clip.timelineStart || 0; currentT = t;
const c = contextFor(width, height);
const program = factory(c, M);
program.draw(c, t, values, clip);
flush();
```

## Cursor, privacy, sound, exports, and checks

- **Bundled documentation describes** `matte_cursor` controls for phone touch/Desktop pointer appearance, color, size, contrast, smoothing, continuous/tap-only display; `matte_gesture` adds simulator touch marks. Crop/censor tools hide screen regions. (`501–504`)
- **Bundled documentation lists** 27 motion presets by name, target and illustrative duration/behavior: entrances at `516–529`; push-ins at `533–538`; moves at `542–550`; device emphasis/exits at `554–559`. It separates camera moves (whole scene/effects track) from device transforms (clip-local). Exact packaged names and durations are inventoried in `/private/tmp/matte-resources-report.md`; the guide’s durations are rounded. (`506–512`, `514–559`)
- **Bundled documentation describes** importing audio, duplicating effects onto hits, volume/mute/fades; beat/bar/drop/quiet analysis; snapping music, titles, code overlays, camera moves and zooms to beats or bars, with optional cut movement for a BPM grid. (`561–570`)
- **Bundled documentation describes** export profiles: 9:16 social at reel quality 30/60fps; square feed; 16:9 web/YouTube 1080p/4K; muted 1080p H.264 web hero at 30fps and 4–8 Mbps; App Store preview H.264 30fps; GIF height 480/640/720, 15–30fps, loop; still PNG/JPG 1080p/1440p/4K/App Store sizes, with PNG transparency. It also notes social safe areas and watermark behavior. (`572–585`)
- **Bundled documentation describes** frame/contact-sheet render inspection, motion descriptors and checks (timing/easing/speed/holds/camera cuts; abrupt starts/stops, small pushes, overlapping moves, cut mismatch/jump cut), project review (edges/gaps/text/zoom/gesture/dead-time/ending/missing media), preview render and final export. (`587–593`)

## Verification commands

Read the relevant sections with exact line numbers:

```sh
nl -ba /Applications/Matte.app/Contents/Resources/CraftGuide.md | sed -n '99,200p'
nl -ba /Applications/Matte.app/Contents/Resources/CraftGuide.md | sed -n '214,280p'
nl -ba /Applications/Matte.app/Contents/Resources/CraftGuide.md | sed -n '283,365p'
nl -ba /Applications/Matte.app/Contents/Resources/CraftGuide.md | sed -n '366,505p'
nl -ba /Applications/Matte.app/Contents/Resources/CraftGuide.md | sed -n '506,595p'
```
