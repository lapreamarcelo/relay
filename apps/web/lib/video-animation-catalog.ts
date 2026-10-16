import { animationEasings, animationPresets, textOnlyPresets, transitionKinds } from "./video-animation.ts";
import { compileMotionRecipe, motionRecipes } from "./video-motion-presets.ts";
import { videoCameraPresets } from "./video-camera.ts";

export function videoAnimationCatalog() {
  return {
    version: 3,
    motionRecipes: motionRecipes.map(recipe=>({...recipe, example: compileMotionRecipe(recipe.id, 2000)})),
    curves: { kinds: ["spring", "bouncy", "cubic-bezier"], controlPoints: "[startTime, startProgress, endTime, endProgress]; time 0–1, progress -2–3", stiffness: [1,1000], damping: [.1,100], mass: [.1,10], velocity: [-20,20], scaleMode: ["linear", "perceptual"], returnMs: [50,60000], staggerMs: [0,500] },
    pointers: { maxEvents: 2000, styles: ["arrow", "touch"], display: ["continuous", "tap-only"], timing: "Original source timestamps. Source trim, speed and freeze map pointer events with footage." },
    graphics: { kinds: ["shape", "particles", "bars", "ring", "code"], maxLayers: 24, timing: "Global start/end time with local animation. Fixed seeds and absolute-time evaluation match scrubbing/export.", code: { language: "Bounded JSON drawing commands and arithmetic expressions", shapes: ["circle","rect","line","text"], sourceCharacters: 24000, controls: 16, commands: 64, shapesPerFrame: 512, expressionTokens: 96, expressionDepth: 12, hostAccess: false, variables: ["time","width","height","seed","index","count","audio","bass","mid","treble","pi"], parameterKinds: ["number","color","text"], shaderSupport: "Math-driven drawings. Arbitrary JavaScript, HTML and GLSL are unsupported." }, audioReactive: { signals: ["envelope","bass","mid","treble"], amount: [0,10], source: "Choose a timeline.audioAnalysis sourceUrl; follows source trim, active lifetime, looping, gain and fades." } },
    typography: { fonts: ["modern","editorial","mono"], fontWeight: [400,700,800], italic: true, kerning: true, letterSpacing: [-10,40], lineHeight: [.8,2], textAlign: ["left","center","right"], strokeWidth: [0,16], shadowBlur: [0,40], shadowOffset: [-40,40], backgroundOpacity: [0,1], backgroundRadius: [0,80], padding: [0,100], sceneLayer: ["overlay","scene","back"], sceneDepth: [-2,2], geometry: "Bundled font glyph measurements and paths are shared by preview/export. Scene text accepts rotateX/rotateY/depth keyframes; overlay and back text stay in canvas space." },
    audioAnalysis: { field: "timeline.audioAnalysis", maxSources: 13, maximumSourceDurationMs: 900000, maximumDownloadBytes: 100*1024*1024, frameMs: 20, maximumFrames: 45000, frameSignals: ["rms","peak","bass","mid","treble"], markers: ["beats","bars","drops","quiet"], tempo: "Onset/autocorrelation estimates constant BPM and first beat; inspect confidence and apply the detected grid in Sound layers.", bars: "Assumes 4/4 time", drops: "Energy-rise estimates, not semantic music annotations", portability: "Decoded source-time values persist in timeline JSON and drive identical reactive SVG sampling in preview/export." },
    editing: { speed: [.25,4], freeze: "freezeMs holds an original source frame", groups: "groupId links motion across cuts; motionOffsetMs continues the local motion clock.", audioTracks: 12, beatGrid: { bpm: [20,300], offsetMs: [0,900000] } },
    scene: { environments: ["studio", "softbox", "sunset", "night"], rendering: ["vector", "mesh", "gpu"], controls: ["exposure", "roughness", "metallic", "shadow", "lightAngle", "focusDepth", "aperture", "motionBlur"] },
    exportSettings: { formats: ["mp4", "webm", "gif", "png", "jpeg"], fps: [24,30,60], resolution: ["720p", "1080p", "2160p"], quality: ["draft", "standard", "high"] },
    textPresets: animationPresets,
    framePresets: animationPresets.filter(preset => !textOnlyPresets.has(preset)),
    transitionKinds,
    easings: animationEasings,
    camera: {
      presets: videoCameraPresets,
      zoom: [1, 4], focusRange: [0, 1], keyframes: 100, keyframeTimeMs: [0, 900000],
      scope: "Camera magnifies the composited clips and device layers below labels. Text, music and source trims remain unchanged. Zoom 1 shows the full scene; zooming out returns toward 1.",
      focus: "x/y are a point on the unzoomed canvas, not clip crop or device position. The viewport centers there and clamps at edges to avoid blank borders.",
      timing: "Global timeline milliseconds, continuous across cuts and overlaps. Sparse zoom/x/y interpolate from the base pose; last values hold unless returnMs blends back to rest. scaleMode chooses linear size or perceptual interpolation. Easing belongs to the departing keyframe. Keep keys inside the timeline lifetime to see them.",
    },
    limits: { effectDurationMs: [50, 60000], keyframes: 100, keyframeTimeMs: [0, 900000], labelScale: [.1, 3], deviceScale: [.25, 1.5] },
    timing: {
      labels: "Animation time zero is label.startMs; label.endMs is excluded. Entrance/exit duration caps at half the layer lifetime.",
      devices: "Animation/keyframe time zero is the start of this trimmed clip. Original source inMs does not offset animation time. Authored foldAngle keyframes override canned folding motion. Linked clips continue motion using groupId/motionOffsetMs; unlinked clips use a fresh local clock.",
      keyframes: "Times must be unique and increasing. Sparse properties interpolate independently from the base pose at time zero; the last value holds. Easing belongs to the departing keyframe. Entrance/exit presets compose with the keyframed pose.",
      transitions: "Set transition on the incoming clip. First clip ignores it. Actual overlap is min(durationMs, previous clip lifetime/2, incoming clip lifetime/2). Timeline duration subtracts overlaps. Labels/music/cover use the resulting timeline clock. Source audio crossfades linearly during overlap.",
    },
    examples: {
      labelAnimation: { entrance: { preset: "typewriter", durationMs: 1200, easing: "linear" }, exit: { preset: "fade", durationMs: 400, easing: "ease-in" }, keyframes: [{ timeMs: 0, x: .4, y: .2, scale: .9, easing: "ease-in-out" }, { timeMs: 2000, x: .6, y: .3, scale: 1.1, rotateZ: -4 }] },
      frameAnimation: { entrance: { preset: "slide-up", durationMs: 600 }, exit: { preset: "zoom", durationMs: 500 }, keyframes: [{ timeMs: 0, rotateY: -20, foldAngle: 0, easing: "ease-in-out" }, { timeMs: 2000, rotateY: 20, foldAngle: 150, opacity: .8 }] },
      incomingTransition: { kind: "crossfade", durationMs: 600, easing: "ease-in-out" },
      camera: { zoom: 1, x: .5, y: .5, keyframes: [{timeMs:0,zoom:1,x:.5,y:.5,easing:"ease-in-out"},{timeMs:1000,zoom:2.5,x:.7,y:.35},{timeMs:3000,zoom:2.5,x:.7,y:.35,easing:"ease-in-out"},{timeMs:4000,zoom:1,x:.5,y:.5}] },
    },
    constraints: ["Text rotation uses rotateZ; frame tilt uses rotateX/rotateY. Folding keyframes require iphone-duo.", "Animations apply to video timelines. Static slideshow frames do not accept them.", "MCP save_video and save_video_template preserve all animation fields. Retrieve the project and revision before editing."],
  };
}
