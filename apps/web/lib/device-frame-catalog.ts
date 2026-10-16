import { defaultDeviceFrame, deviceFrameGeometry } from "./device-frames.ts";
import { deviceModels } from "./device-model-catalog.ts";
import { videoSizes } from "./video-timeline.ts";

/** Agent-facing design information derived from the same geometry as preview/export. */
export function deviceFrameCatalog() {
  return {
    version: 5,
    renderModes: { values: ["vector", "mesh", "gpu"], default: "vector", recommended: "gpu", defaultMotion: "none", description: "GPU loads bundled 3D models or Relay geometry. Static pose is the default; rotations and motion are optional." },
    models: deviceModels.map(model=>({...model, geometry: "file" in model ? "licensed-glb" : "original", ...( "file" in model ? {assetPath:`/devices/${model.file}`} : {})})),
    requiresAi: false,
    appliesTo: ["timeline.clips[].deviceFrame", "timeline.layers[].deviceFrame", "slides[].deviceFrame"],
    fields: {
      renderMode: { required: false, values: ["vector","mesh","gpu"], default: "vector", videoOnly: true },
      modelId: { required: false, values: deviceModels.map(model=>model.id), description: "Choose an id whose device matches this frame; omitted selects that device's default model. Bundled assets only; no remote model URLs." },
      finish: { required: false, values: ["graphite","silver","gold","natural"], videoOnly: true },
      band: { required: false, values: ["woven","none"], device: "watch", videoOnly: true },
      depth: { required: false, min: -2, max: 2, default: 0, videoOnly: true },
      scene: { required: false, videoOnly: true, description: "Standalone scene lighting/material/camera settings. timeline.scene shares these across devices." },
      device: { required: true, values: ["phone", "tablet", "browser", "iphone", "iphone-duo", "mac", "watch", "android"] },
      background: { required: true, format: "#RRGGBB", description: "Solid color outside the device." },
      color: { required: true, format: "#RRGGBB", description: "Device frame color." },
      backgroundEnd: { required: false, format: "#RRGGBB", description: "Optional second endpoint of a diagonal gradient." },
      x: { required: false, min: 0, max: 1, default: .5, description: "Whole-canvas device center; video timelines only." },
      y: { required: false, min: 0, max: 1, default: .5, description: "Whole-canvas device center; video timelines only." },
      scale: { required: false, min: .25, max: 1.5, default: 1, videoOnly: true },
      rotateX: { required: false, min: -1080, max: 1080, vectorLimits: [-60,60], default: 0, units: "degrees", videoOnly: true },
      rotateY: { required: false, min: -1080, max: 1080, vectorLimits: [-60,60], default: 0, units: "degrees", videoOnly: true },
      rotateZ: { required: false, min: -1080, max: 1080, vectorLimits: [-180,180], default: 0, units: "degrees", videoOnly: true },
      foldAngle: { required: false, min: 0, max: 165, default: 0, units: "degrees", device: "iphone-duo", description: "0 is open; symmetric inward hinge. Video timelines only." },
      motion: { required: false, values: ["none", "orbit", "float", "fold", "unfold", "fold-cycle"], default: "none", videoOnly: true },
      motionDurationMs: { required: false, min: 500, max: 60000, default: 4000, videoOnly: true },
      motionEasing: { required: false, values: ["linear", "ease-in", "ease-out", "ease-in-out", "spring", "bouncy", "cubic-bezier"], videoOnly: true },
      animation: { required: false, videoOnly: true, description: "Entrance/exit presets and sparse keyframes. Call MCP list_video_animations or capabilities?section=video-animation for the full contract." },
    },
    canvasBackground: {
      field: "timeline.background", videoOnly: true,
      color: { required: true, format: "#RRGGBB", description: "Backdrop beneath the image, or the solid canvas when there is no image." },
      endColor: { required: false, format: "#RRGGBB", description: "Diagonal gradient endpoint." },
      imageUrl: { required: false, protocol: "https", source: "Relay R2 media library", maximumBytes: 30 * 1024 * 1024, maximumPixels: 40_000_000, description: "Static image behind all device layers and text; upload/select from Media." },
      imageFit: { required: false, values: ["cover", "contain"], default: "cover", description: "Centered crop or letterbox. Transparent image areas and letterboxes show the color/gradient." },
      example: { color: "#112233", imageUrl: "https://your_r2_library/background.jpg", imageFit: "cover" },
    },
    parallelLayers: {
      field: "timeline.layers", maximum: 12, order: "Vector layers use array order. GPU devices share depth testing. Text uses sceneLayer to choose overlay, scene or back.",
      timing: "Each layer has startMs on the shared timeline and inMs/outMs source trims. End is startMs+(outMs-inMs)/speed (speed defaults to 1). Animation time zero is startMs. Layers may share a source or use separate recordings; each has independent pose, motion/keyframes and volume. No incoming clip transitions on layers.",
      background: "Device layers have transparent backgrounds outside their bezels. Set timeline.background once for the whole scene. Empty clips supports a layers-only scene.",
      interaction: "Synchronize app recordings and device/text animations to demonstrate a handoff. This does not connect to or drive live apps.",
      example: {
        clips: [], background: { color: "#112233", endColor: "#445566" },
        layers: [
          { id: "watch", name: "Watch demo", sourceUrl: "https://YOUR_R2_LIBRARY/watch.mp4", kind: "video", startMs: 0, inMs: 0, outMs: 4000, fit: "contain", x: .5, y: .5, zoom: 1, volume: 0, deviceFrame: { device: "watch", background: "#112233", color: "#171717", x: .3, y: .5, scale: .65, motion: "orbit", motionDurationMs: 4000, animation: { entrance: { preset: "pop", durationMs: 500 } } } },
          { id: "iphone", name: "iPhone demo", sourceUrl: "https://YOUR_R2_LIBRARY/iphone.mp4", kind: "video", startMs: 1000, inMs: 0, outMs: 3000, fit: "contain", x: .5, y: .5, zoom: 1, volume: 1, deviceFrame: { device: "iphone", background: "#112233", color: "#171717", x: .7, y: .5, scale: .5, motion: "float", motionDurationMs: 3000, animation: { entrance: { preset: "slide-up", durationMs: 500 } } } },
        ],
      },
    },
    defaults: { ...defaultDeviceFrame },
    frames: ([
      { device: "phone", name: "Generic phone", useFor: "Portrait mobile app screenshots and screen recordings." },
      { device: "tablet", name: "Generic tablet", useFor: "Tablet app screenshots and screen recordings." },
      { device: "browser", name: "Generic browser", useFor: "Desktop web app screenshots and screen recordings." },
      { device: "iphone", name: "iPhone", useFor: "Mobile app demo with a slim metal rim, side buttons, glass bezel and Dynamic Island." },
      { device: "iphone-duo", name: "iPhone Duo", useFor: "Stylized folding demo; source content is split across the two hinged panels." },
      { device: "mac", name: "Mac", useFor: "Stylized desktop display for Mac app demos." },
      { device: "watch", name: "Watch", useFor: "Rounded square wearable app demos." },
      { device: "android", name: "Android", useFor: "Stylized mobile app demo with a round camera cutout." },
    ] as const).map(frame => ({
      ...frame,
      example: { ...defaultDeviceFrame, device: frame.device },
      gpuExample: { ...defaultDeviceFrame, device: frame.device, renderMode: "gpu", modelId: deviceModels.find(model=>model.device===frame.device)!.id, motion: "none" },
      layouts: Object.entries(videoSizes).map(([aspectRatio, [width, height]]) => ({
        aspectRatio,
        ...deviceFrameGeometry(width, height, frame.device),
      })),
    })),
    design: {
      units: "Layout canvas, outer and screen rectangles are output pixels. Convert label positions to 0–1 full-canvas fractions.",
      media: "Use your Relay media URL as the clip sourceUrl or slide mediaUrl. The frame is drawn automatically; no frame image upload is needed.",
      fit: "contain preserves the entire screenshot/recording and may letterbox; cover fills the screen and can crop UI. Video x/y/zoom apply inside the screen; zoom applies only to cover.",
      labels: "Labels use full-canvas positions. sceneLayer overlay stays above devices, back stays below them, and scene participates in 3D placement. Use layout rectangles and depth to avoid covering important UI.",
      images: "Slideshows export 1080×1920 JPEGs. Use the 9:16 layout for slides, including single-image posts.",
      videos: "Video timelines support all listed aspect ratios and both video and image clips. Device pose and motion are saved in the project. Source video and audio keep playing while the device moves. timeline.layers adds up to 12 independently timed devices over the clips (or on a shared background with clips:[]).",
      canvasBackground: "Optional timeline.background {color:#RRGGBB,endColor?:#RRGGBB,imageUrl?:HTTPS_R2_LIBRARY_URL,imageFit?:cover|contain} overrides per-frame backgrounds. A static image is center-cropped (cover, default) or center-letterboxed (contain) above the color/gradient. It appears behind framed media/layers, around contain-fit media and after sequential clips end while remaining layers play. Unframed cover-fit footage fills the canvas.",
      motion: "Motion is evaluated from local clip time (assembled playhead minus clip start), at the selected export frame rate. orbit and float repeat; fold/unfold hold their final pose; fold-cycle folds and opens repeatedly. Fold presets require iphone-duo. foldAngle sets their maximum fold; 0 or omission uses 150 degrees. Set motion:none to pose manually.",
      duo: "Relay original folding-phone geometry with a two-panel hinge, using the left and right halves of one source recording. This is a generic folding demonstration, not an official iPhone Duo model. Tablet likewise uses generic geometry, not a complete catalog of iPad models.",
      geometry: "Layouts describe unposed vector screen rectangles. GPU devices use bundled GLB assets for Watch Ultra 2, iPhone 15 Pro Max and Galaxy S25 Ultra, and original Relay geometry for other devices. GPU/mesh poses allow full rotations up to 1080 degrees; vector X/Y remains within 60 degrees and Z within 180. Static motion:none is supported for every model.",
      remove: "Omit deviceFrame from the updated clip/slide in the full project document to disable it. Preserve other clips/slides; video updates require the retrieved revision.",
      rerender: "After editing, render again before creating a post. Remove stale renderedUrl from edited slideshow slides. Existing published outputs do not change.",
      limits: "GPU requires browser WebGL and uses the same bundled scene for preview/export. Licensed model credits are listed in models. Generic tablet, folding phone, laptop and browser geometry do not represent all Apple hardware variants. Arbitrary remote models and custom frame uploads are unsupported. Vector/mesh modes preserve older projects. Image backgrounds support static Relay PNG/JPEG/WebP/AVIF up to 30 MB / 40 megapixels; SVG and animation backgrounds are rejected. Slideshows use static vector devices only.",
    },
    motionExample: {
      device: "iphone-duo", background: "#182422", backgroundEnd: "#537C68", color: "#171717",
      x: .5, y: .55, scale: .85, rotateX: -8, rotateY: 12, rotateZ: -4,
      motion: "fold-cycle", motionDurationMs: 4000,
    },
    workflow: {
      video: ["videos create/update (MCP save_video)", "videos render with async:true (MCP render_video)", "render-jobs get until completed (MCP get_video_render_job)", "Use completed renderedUrl for a draft post"],
      image: ["slideshows create/update (MCP save_slideshow)", "slideshows render (MCP render_slideshow)", "Use ordered slides[].renderedUrl for a draft image post"],
    },
  };
}
