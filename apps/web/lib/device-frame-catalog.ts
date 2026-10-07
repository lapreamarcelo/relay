import { defaultDeviceFrame, deviceFrameGeometry } from "./device-frames.ts";
import { videoSizes } from "./video-timeline.ts";

/** Agent-facing design information derived from the same geometry as preview/export. */
export function deviceFrameCatalog() {
  return {
    version: 4,
    requiresAi: false,
    appliesTo: ["timeline.clips[].deviceFrame", "slides[].deviceFrame"],
    fields: {
      device: { required: true, values: ["phone", "tablet", "browser", "iphone", "iphone-duo", "mac", "watch", "android"] },
      background: { required: true, format: "#RRGGBB", description: "Solid color outside the device." },
      color: { required: true, format: "#RRGGBB", description: "Device frame color." },
      backgroundEnd: { required: false, format: "#RRGGBB", description: "Optional second endpoint of a diagonal gradient." },
      x: { required: false, min: 0, max: 1, default: .5, description: "Whole-canvas device center; video timelines only." },
      y: { required: false, min: 0, max: 1, default: .5, description: "Whole-canvas device center; video timelines only." },
      scale: { required: false, min: .25, max: 1.5, default: 1, videoOnly: true },
      rotateX: { required: false, min: -60, max: 60, default: 0, units: "degrees", videoOnly: true },
      rotateY: { required: false, min: -60, max: 60, default: 0, units: "degrees", videoOnly: true },
      rotateZ: { required: false, min: -180, max: 180, default: 0, units: "degrees", videoOnly: true },
      foldAngle: { required: false, min: 0, max: 165, default: 0, units: "degrees", device: "iphone-duo", description: "0 is open; symmetric inward hinge. Video timelines only." },
      motion: { required: false, values: ["none", "orbit", "float", "fold", "unfold", "fold-cycle"], default: "none", videoOnly: true },
      motionDurationMs: { required: false, min: 500, max: 60000, default: 4000, videoOnly: true },
      motionEasing: { required: false, values: ["linear", "ease-in", "ease-out", "ease-in-out"], videoOnly: true },
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
      field: "timeline.layers", maximum: 12, order: "Back-to-front above sequential clips; text labels are topmost.",
      timing: "Each layer has startMs on the shared timeline and inMs/outMs source trims. End is startMs+outMs-inMs. Animation time zero is startMs. Layers may share a source or use separate recordings; each has independent pose, motion/keyframes and volume. No incoming clip transitions on layers.",
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
      layouts: Object.entries(videoSizes).map(([aspectRatio, [width, height]]) => ({
        aspectRatio,
        ...deviceFrameGeometry(width, height, frame.device),
      })),
    })),
    design: {
      units: "Layout canvas, outer and screen rectangles are output pixels. Convert label positions to 0–1 full-canvas fractions.",
      media: "Use your Relay media URL as the clip sourceUrl or slide mediaUrl. The frame is drawn automatically; no frame image upload is needed.",
      fit: "contain preserves the entire screenshot/recording and may letterbox; cover fills the screen and can crop UI. Video x/y/zoom apply inside the screen; zoom applies only to cover.",
      labels: "Labels are placed above the frame on the full output canvas. Use the layout rectangles to avoid covering important UI.",
      images: "Slideshows export 1080×1920 JPEGs. Use the 9:16 layout for slides, including single-image posts.",
      videos: "Video timelines support all listed aspect ratios and both video and image clips. Device pose and motion are saved in the project. Source video and audio keep playing while the device moves. timeline.layers adds up to 12 independently timed devices over the clips (or on a shared background with clips:[]).",
      canvasBackground: "Optional timeline.background {color:#RRGGBB,endColor?:#RRGGBB,imageUrl?:HTTPS_R2_LIBRARY_URL,imageFit?:cover|contain} overrides per-frame backgrounds. A static image is center-cropped (cover, default) or center-letterboxed (contain) above the color/gradient. It appears behind framed media/layers, around contain-fit media and after sequential clips end while remaining layers play. Unframed cover-fit footage fills the canvas.",
      motion: "Motion is evaluated from local clip time (assembled playhead minus clip start), at 30fps on export. orbit and float repeat; fold/unfold hold their final pose; fold-cycle folds and opens repeatedly. Fold presets require iphone-duo. foldAngle sets their maximum fold; 0 or omission uses 150 degrees. Set motion:none to pose manually.",
      duo: "A stylized two-panel hinge, using the left and right halves of one source recording. It does not capture a Simulator or attach a separate outer-screen recording.",
      geometry: "Layouts describe the default unposed device. Position/scale/rotation/motion/keyframes change its screen location; use modest tilt and scale and leave margin for motion. Projected metal body depth follows X/Y tilt, orbit and Duo folding in preview and export. Rotate X/Y within -60–60 degrees and Z within -180–180 degrees; this is perspective depth, not a full 360-degree mesh with modeled rear cameras. Labels use full-canvas positions and may have their own animation.",
      remove: "Omit deviceFrame from the updated clip/slide in the full project document to disable it. Preserve other clips/slides; video updates require the retrieved revision.",
      rerender: "After editing, render again before creating a post. Remove stale renderedUrl from edited slideshow slides. Existing published outputs do not change.",
      limits: "Built-in detailed bezels with projected body depth, not full photorealistic 3D meshes or 360-degree spins with modeled rear cameras. Static PNG/JPEG/WebP/AVIF image backgrounds support Relay library images up to 30 MB and 40 megapixels; animated images and SVG backgrounds are rejected. No custom frame uploads, video backgrounds, lighting or depth of field. Slideshow frames support static device shapes/colors/gradients; image canvas backgrounds, pose, motion and keyframes require video timelines.",
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
