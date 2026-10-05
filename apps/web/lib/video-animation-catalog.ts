import { animationEasings, animationPresets, transitionKinds } from "./video-animation.ts";
import { videoCameraPresets } from "./video-camera.ts";

export function videoAnimationCatalog() {
  return {
    version: 1,
    textPresets: animationPresets,
    framePresets: animationPresets.filter(preset => preset !== "typewriter"),
    transitionKinds,
    easings: animationEasings,
    camera: {
      presets: videoCameraPresets,
      zoom: [1, 4], focusRange: [0, 1], keyframes: 100, keyframeTimeMs: [0, 900000],
      scope: "Camera magnifies the composited clips and device layers below labels. Text, music and source trims remain unchanged. Zoom 1 shows the full scene; zooming out returns toward 1.",
      focus: "x/y are a point on the unzoomed canvas, not clip crop or device position. The viewport centers there and clamps at edges to avoid blank borders.",
      timing: "Global timeline milliseconds, continuous across cuts and overlaps. Sparse zoom/x/y interpolate from the base pose; last values hold. Easing belongs to the departing keyframe. Keep keys inside the timeline lifetime to see them.",
    },
    limits: { effectDurationMs: [50, 60000], keyframes: 100, keyframeTimeMs: [0, 900000], labelScale: [.1, 3], deviceScale: [.25, 1.5] },
    timing: {
      labels: "Animation time zero is label.startMs; label.endMs is excluded. Entrance/exit duration caps at half the layer lifetime.",
      devices: "Animation/keyframe time zero is the start of this trimmed clip. Original source inMs does not offset animation time. Authored foldAngle keyframes override canned folding motion. Splitting or trimming starts a new clip-local animation.",
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
