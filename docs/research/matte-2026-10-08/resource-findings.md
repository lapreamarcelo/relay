# Matte bundled-resource findings

Read-only inspection of `/Applications/Matte.app` (bundle metadata: `com.jose.Matte`, 2.0.2/build 231, minimum macOS 15.6). No files in the app or Relay were changed; no REA tools were called. These are static bundle/resource findings. The app’s runtime behavior still needs the parent’s separate REA corroboration.

## Motion preset schema and catalog

`Resources/Presets` contains 53 `.mattepreset` directories: 27 `type=motion` and 26 `type=style`. Motion presets are `kind=device`, `category=motion`, `slotCount=1`, have `motion.duration`, `motion.slots=[]`, and contain either `motion.camera` (20 presets) or `motion.clipTransform` (7), never both. Twenty use `formatVersion=4`; seven older entries use version 2. Fourteen include `endsAtCurrentPose=true`; the other 13 omit it. Camera motion optionally has `transitionIn`/`transitionOut: {duration: 1}`. Duration values span 1.15–8.016666666666667; there is no explicit time-unit or frame-rate field in these presets.

Camera track targets are offset XYZ, rotation XYZ degrees, scale, aperture stops, focus depth, environment pitch/roll/yaw, and `deviceModelParameterTracks.lidOpening`. Across shipped motion presets, only offset XYZ, rotation XYZ, and scale have keyframes; the others are present in the common camera schema but empty. Clip-transform targets are offset XYZ, rotation XYZ, scale, and sometimes an empty `deviceModelParameterTracks`; populated channels are offsets and rotations, with `scale` empty. Aggregate populated keyframe counts: camera offsetX 55, offsetY 55, offsetZ 52, rotationX 55, rotationY 55, rotationZ 53, scale 41; clip-transform offsetX/Y 15 each, offsetZ 17, rotationX 21, rotationY/Z 17 each.

Keyframe fields are `id` (UUID), `time` (number), `value` (number), `curve`, and `curveParameter`; `customControlPoints` appears only on custom-curve keys and contains `control1`/`control2` 2D points. Across all 468 populated keys: 314 `easeInOut`, 80 `spring`, 74 `custom`. Exact `curveParameter` distribution: easeInOut `{0.0747260551948052:12, 0.15193790584415584:14, 0.21226663961038955:14, 0.30205965909090904:14, 0.5387358621077827:12, 0.5390644995971182:12, 0.6:214, 0.6087662337662337:14, 0.809375:8}`; custom `{0.6:64, 0.809375:10}`; spring `{0.6:80}`. Spring keys have no named stiffness/damping/mass/bounce fields in these motion presets; do not equate the preset parameter with the separate JS helper’s spring options without native/runtime evidence. The 74 custom keys contain 26 distinct control-point pairs; the most common appears 21 times: `control1=[0.4996916451985595,0]`, `control2=[0.7979318526117024,0.4036496794714228]`. These points strongly resemble cubic-Bezier handles, but interpolation implementation is not in these JSON files. The version-4 model tracks also provide an empty `lidOpening` target, but no shipped motion preset animates it.

All 27 names, durations, and target group:

| Preset | Duration | Target |
|---|---:|---|
| Reveal Down | 1.9 | camera |
| Orbit Bottom | 4.983333333333333 | camera |
| Zoom Center | 3.283333333333333 | camera |
| Showcase | 8.016666666666667 | camera |
| Reveal Lay | 1.7333333333333334 | camera |
| Clean Sweep | 6 | camera |
| Rotate In | 1.7000000000000002 | clipTransform |
| Zoom Bottom | 3.283333333333333 | camera |
| Flip and Flip | 2.5166666666666666 | clipTransform |
| Flip Up | 3.3 | clipTransform |
| Float By | 7.016666666666667 | clipTransform |
| Zoom & Tilt | 5 | camera |
| Orbit Slow | 6 | camera |
| Side Entrance | 2.2333333333333334 | camera |
| Float In | 2.6666666666666665 | camera |
| Reveal Back | 1.95 | camera |
| Orbit Top | 4.983333333333333 | camera |
| Reveal Flat | 6.033333333333333 | camera |
| Lift Up | 1.15 | clipTransform |
| Flip Down | 1.1833333333333333 | clipTransform |
| Flat Travel | 6.016666666666667 | camera |
| Reveal Vertical | 3.0166666666666666 | camera |
| Reveal Dynamic | 6.65 | camera |
| Lift Bottom | 3 | camera |
| Reveal Side | 4.983333333333333 | camera |
| Tilt Pop | 6 | clipTransform |
| Zoom Top | 3.283333333333333 | camera |

Representative serialized keys:

```json
// Reveal Down: camera.tracks.offsetY, preset.json lines 67–83
{"curve":"easeInOut","curveParameter":0.5387358621077827,"time":0,"value":0.22511544893666602}
{"curve":"easeInOut","curveParameter":0.5387358621077827,"time":1.9,"value":-0.21884403935185182}
```

```json
// Zoom Center: custom camera offsetX key, preset.json lines 59–75
{"curve":"custom","curveParameter":0.6,"customControlPoints":{"control1":[0.4996916451985595,0],"control2":[0.7979318526117024,0.4036496794714228]},"time":0.85,"value":0}
```

```json
// Rotate In: clipTransform.tracks.offsetY, preset.json lines 32–57
// The end key is spring; its descriptor has no named physical coefficients.
{"curve":"spring","curveParameter":0.6,"time":1.7000000000000002,"value":0}
```

Primary examples: `Presets/1A9079DF-3AD0-4F76-939D-B9630ABFC846.mattepreset/preset.json:8–16,49–83`; `Presets/2BED6853-D772-407A-8D76-4FDCF2F345C1.mattepreset/preset.json:50–89`; `Presets/4B0B9CEB-4B0B-440A-ABAB-9B3ADFB925E9.mattepreset/preset.json:9–57`. `formatVersion=2` example: Rotate In lines 1–13.

## Code-clip helper math and frame protocol

`CodeClipHelpers.js` provides named easing functions `linear`, quadratic/cubic/quartic in/out/inOut, exponential in/out/inOut, sine in/out/inOut, back in/out/inOut, elastic-out, and bounce-out (`:17–43`). `M.tween(t, keys, o)` returns 0 for an empty key list, holds the first/last value outside the keys, and for a segment computes `u=(t-t0)/(t1-t0)`, then applies the *next key’s* easing (default `inOutCubic`) and linearly interpolates scalar values or each array component. With `o.perceptual`, it uses geometric `scaleLerp` instead of linear interpolation (`:56–73`). `M.stagger` is eased progress after `index*step`, with defaults `step=.06`, `duration=.6`, `outCubic` (`:102–105`).

`M.spring(t,o)` defaults `from=0`, `to=1`, `velocity=0`. It accepts either duration/bounce (defaults `.6` / `.25`) or stiffness/damping/mass (defaults 170/20/1); `w0=sqrt(k/m)`, `zeta=c/(2*sqrt(k*m))`, or for duration/bounce `w0=2π/max(.05,duration)`, `zeta=1-clamp(bounce,0,.95)`. With `d=from-to`, the underdamped branch uses `to+exp(-zeta*w0*t)*(d*cos(wd*t)+(v0+zeta*w0*d)/wd*sin(wd*t))`, `wd=w0*sqrt(1-zeta²)`; critical damping uses `to+exp(-w0*t)*(d+(v0+w0*d)*t)`; overdamping uses roots `r1=-w0*(zeta-sqrt(zeta²-1))`, `r2=-w0*(zeta+sqrt(zeta²-1))`, coefficients `c1=(v0-r2*d)/(r1-r2)`, `c2=d-c1`, and `to+c1*exp(r1*t)+c2*exp(r2*t)`. `t<=0` returns `from`. `perceptual` wraps the scalar result through `scaleLerp` (`:75–99`).

`CodeClipCanvas.js` implements Canvas 2D as an opcode recorder. State, transform, path, fill/stroke, text, image, SF Symbol, backdrop, vector, filter, and shader operations are encoded as numeric opcodes/arguments in a `Float64Array`; strings are interned in a side table. `flush()` calls `native.run(buf,len,strs)`, then clears the buffer/string IDs; the numeric flush threshold is `1<<16` values (`:15–46`). `global.__frame` resets per-clip image handles and module cache, sets clip timeline start and current `t`, recreates the factory/context, resolves image controls, calls `program.draw(ctx,t,values,clip)`, then flushes (`:1507–1522`). `global.__describe` returns controls/order and `device`, `motionBlur`, `hasDraw` metadata (`:1500–1505`). This supports stateless frame rendering; `Date.now` throws with “animate from t” (`:980`), and the helper’s seeded `M.random` is documented as the reproducible random source for preview/export (`CodeClipHelpers.js:508–517`).

Feature references: `M.cache` caches full-canvas layers across frames keyed with code, controls, render size, and explicit key (`CodeClipCanvas.js:982–998`); `M.shader` accepts Shadertoy-style `mainImage`, `iTime/iResolution/iFrame`, uniforms, and image textures (`:1013–1034`); `M.video` obtains attached-video metadata or a frame via `native.videoInfo`/`native.videoFrame` and returns an image (`:1036–1054`); project `M.use`, `M.data`, and SVG helpers appear at `:1230–1278`; `M.audio` exposes BPM, beat/downbeat/drop times, level/bass/mid/high, spectrum, waveform, beat phase, and pulse (`:1342–1461`). The sample `CodeClipTemplate.js:1–48` declares text, color, picker, slider, toggle controls and animates a card using clip time.

## Style, layout, title, and cursor preset data

The 26 style presets split into 15 `category=layout` and 11 `category=style`; each has one slot. Layout names: Peek Top Vertical, Flat, Bottom Focus, Corner Right, Clean Bottom Landscape, Clean Top Landscape, Screen Circle Webcam, Peek Bottom Vertical, Tower Right, Tower Left, Clean Centered, Right Aligned, Aqua Webcam Center, Split Left, Corner Left. Style names: Naked Calm, Moody Orange, Swirly, Punchy, Glum Blue, Basic White, Naked Purple, Naked White, Dreamy, Vertical macOS, Vertical Gloomy.

Style JSON slots carry `slotIndex`, a `clip` with `bezel` configuration (crop, orientation/style, device/frame color, corner radius, shadow, censor, Dynamic Island, stroke) and/or `transform3D` (`offsetX/Y/Z`, `rotationX/Y/ZDegrees`, `scale`). Composition presets can set aspect ratio, solid/gradient/pattern background fill, and built-in background image/fit/position/scale/blur. Twenty-two packages include `agent.json` descriptive metadata: `summary`, `intents`, `keywords`, recommended/default aspect ratios, and aspect-ratio rationale. These are static descriptive fields, not evidence of an animation engine.

Webcam overlays set `macOSTitleText` in five styles: `Screen Circle Webcam`, `Aqua Webcam Center`, and `Split Left` use `Jose`; `Vertical macOS` and `Vertical Gloomy` use `Webcam`. In the latter two, inline `cursorDesign` sets `designType=macOS System`, `colorPreset=Auto`, `contrastMode=Light`, auto-hide enabled (delay .85s, fade .2s), shape morphing enabled, radius 50, releaseScale 1.8, opacity 1, shadow enabled/opacity .6, plus white custom fill alpha .5 and border alpha .8; `cursorDisplayMode=Continuous`, `cursorSize=1`, `cursorSmoothing=low`. The two presets have essentially the same cursor object (`8C6845C7…/preset.json:116–147`, `E9145EFC…/preset.json:116–147`). There is no separate cursor `.mattepreset` package in this inventory. The Resources root separately includes 47 cursor-related SVGs (generic and `tahoe-*` shapes such as arrow, hand, I-beam, crosshair, resize, copy/link).

## 3D model appearance and transform JSON

`3DModelVariants/<device>/manifest.json` uses `resourceName`, `schemaVersion`, `sourceModel`, optional `sourceSHA256/sourceURL`, `modelAnchor.position` and `rotationDegrees`, and a `variants` map. A variant can hold `displayName`, `diffuseColors` (material-name → hex color), `textureAdjustments` (embedded texture path → brightness/contrast/exposure/hueDegrees/saturation), and schema-3 `textureBindings` and `scalarValues` material/surface-input overrides. Example: `3DModelVariants/iphone17/manifest.json:139–188`; schema 3 Duo: `3DModelVariants/iphoneduo/manifest.json:1–83`.

`material-index.json` has `bindingsByMaterialName` (material → surface input → `{archivePath, channel, uvSet}`) and `scalarValuesByMaterialName` (material → numeric input), e.g. `3DModelVariants/iphone17/material-index.json:1–60,327–365`. Observed inputs include diffuseColor, normal, occlusion, roughness, metallic, emissiveColor, opacity, clearcoat, and clearcoatRoughness. `3DModelVariants/README.md:3–18` documents the intended runtime appearance flow: select manifest variant, resolve embedded textures via material index, apply texture adjustments in memory and diffuse colors to material constants. The same README says the app packages prepared USDZ models, but the installed build here instead contains hashed `.matte3d` resources with `MATTE3D1` magic; wrapper internals are not decoded in this pass.

## Environment/assets and verification

Resources has five `Studio01`–`Studio05` HDR/EXR files and matching 256×128 thumbnails. `Studio02`–`04` are 1536×768 EXR; `Studio05` is 1024×512. There are two 64×64 `ltc_ggx_*.dds` textures and `default.metallib`. Grouping/names suggest studio environment maps, but actual use was not proven by this resource pass. Three bundled HEVC example movies are 1120×630 at 30 fps: welcome hero 11.5 s, light/dark “what’s new” hero 7 s each.

Project extension clue: `Contents/Info.plist` registers `.matte` as a `Matte Project`, UTI `com.Matte.matte`, conforms to `public.package`, and sets `LSTypeIsPackage=true`. No project example or internal `.matte` schema was found under Resources. Preset packages are JSON resources, not project files.

Useful reproduction commands (read-only):
- `/usr/libexec/PlistBuddy -c 'Print :CFBundleDocumentTypes' /Applications/Matte.app/Contents/Info.plist`
- `find /Applications/Matte.app/Contents/Resources/Presets -maxdepth 2 -name preset.json`
- `file /Applications/Matte.app/Contents/Resources/3DModels/*.matte3d`
- `python3` with `json`/`pathlib` to enumerate preset names, versions, durations, track keys, and variant/material fields.
- `nl -ba <preset.json> | sed -n '<start>,<end>p'` for the representative examples above.
- `ffprobe -v error -show_entries format=duration:stream=codec_name,width,height,r_frame_rate,pix_fmt -of default=noprint_wrappers=1 <hero.mov>`
