import type { AnimationEasing, AnimationEffect, LayerAnimation, LayerKeyframe, VideoClip } from "@relay/core";

import { animationState } from "../lib/video-animation";

export const easingOptions: Array<[AnimationEasing, string]> = [["linear", "Linear"], ["ease-in", "Ease in"], ["ease-out", "Ease out"], ["ease-in-out", "Ease in & out"]];
const effects: Array<[AnimationEffect["preset"], string]> = [["fade", "Fade"], ["slide-up", "Slide up"], ["slide-down", "Slide down"], ["slide-left", "Slide left"], ["slide-right", "Slide right"], ["pop", "Pop"], ["zoom", "Zoom"], ["typewriter", "Typewriter"]];
const properties = [
  ["x", "Horizontal", 0, 1, .01], ["y", "Vertical", 0, 1, .01], ["scale", "Scale", .1, 3, .05],
  ["rotateX", "Tilt X", -60, 60, 1], ["rotateY", "Tilt Y", -60, 60, 1], ["rotateZ", "Rotation", -180, 180, 1],
  ["foldAngle", "Fold angle", 0, 165, 1], ["opacity", "Opacity", 0, 1, .05],
] as const;

export function LayerAnimationControls({ value, onChange, target, timeMs, durationMs, base, disabled = false, duo = false }: {
  value?: LayerAnimation; onChange: (animation: LayerAnimation | undefined) => void;
  target: "Label" | "Device"; timeMs: number; durationMs: number; base: Partial<LayerKeyframe>; disabled?: boolean; duo?: boolean;
}) {
  const update = (changes: Partial<LayerAnimation>) => onChange({ ...value, ...changes });
  const frames = value?.keyframes ?? [];
  const updateFrame = (index: number, changes: Partial<LayerKeyframe>) => update({ keyframes: frames.map((frame, i) => i === index ? (() => { const next = { ...frame, ...changes }; return properties.some(([key]) => next[key] !== undefined) ? next : { ...next, opacity: 1 }; })() : frame).sort((a, b) => a.timeMs - b.timeMs) });
  const capture = () => {
    const time = Math.min(durationMs, Math.max(0, Math.round(timeMs)));
    const pose = animationState(value ? { keyframes: value.keyframes } : undefined, time, durationMs, base, target.toLowerCase() as "label" | "device");
    const keyframe: LayerKeyframe = { timeMs: time, easing: "ease-in-out", x: pose.x, y: pose.y, scale: pose.scale, rotateZ: pose.rotateZ, opacity: pose.opacity, ...(target === "Device" ? { rotateX: pose.rotateX, rotateY: pose.rotateY, ...(duo ? { foldAngle: pose.foldAngle } : {}) } : {}) };
    update({ keyframes: [...frames.filter(frame => frame.timeMs !== time), keyframe].sort((a, b) => a.timeMs - b.timeMs) });
  };
  return <details className="video-animation-controls" open data-testid={`${target.toLowerCase()}-animation-controls`}>
    <summary>{target === "Label" ? "Text animation" : "Entrance, exit & keyframes"}</summary>
    <div className="video-animation-effects">{(["entrance", "exit"] as const).map(edge => <div key={edge}>
      <label>{edge === "entrance" ? "Entrance" : "Exit"}<select aria-label={`${target} ${edge} animation`} disabled={disabled} value={value?.[edge]?.preset ?? "none"} onChange={event => update({ [edge]: event.target.value === "none" ? undefined : { preset: event.target.value as AnimationEffect["preset"], durationMs: Math.min(600, Math.max(50, durationMs / 2)), easing: "ease-out" } })}>
        <option value="none">None</option>{effects.filter(([preset]) => target === "Label" || preset !== "typewriter").map(([preset, name]) => <option key={preset} value={preset}>{name}</option>)}
      </select></label>
      {value?.[edge] && <><label>Duration (ms)<input aria-label={`${target} ${edge} duration`} type="number" min="50" max={Math.min(60000,durationMs)} step="50" value={value[edge]!.durationMs} disabled={disabled} onChange={event => { if (event.target.value) update({ [edge]: { ...value[edge]!, durationMs: Math.max(50, Math.min(60000, durationMs, Number(event.target.value))) } }); }}/></label>
      <label>Easing<select aria-label={`${target} ${edge} easing`} value={value[edge]!.easing ?? "ease-out"} disabled={disabled} onChange={event => update({ [edge]: { ...value[edge]!, easing: event.target.value as AnimationEasing } })}>{easingOptions.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label></>}
    </div>)}</div>
    <div className="video-keyframes-head"><b>Keyframes</b><button type="button" className="secondary-button" disabled={disabled || frames.length >= 100} onClick={capture}>Add {target.toLowerCase()} keyframe at playhead</button></div>
    <small>Times are relative to this {target === "Label" ? "label" : "clip"}. Adjust a keyframe below to move, resize or rotate over time. Easing applies after that keyframe.</small>
    {frames.map((frame, index) => <details className="video-keyframe" key={index} open={frames.length === 1}>
      <summary>{(frame.timeMs / 1000).toFixed(2)}s · Keyframe {index + 1}</summary>
      <div className="video-keyframe-fields"><label>Time (ms)<input aria-label={`${target} keyframe ${index + 1} time`} type="number" min="0" max={durationMs} step="100" value={frame.timeMs} disabled={disabled} onChange={event => { const next = Math.max(0, Math.min(durationMs, Number(event.target.value))); if (!frames.some((f, i) => i !== index && f.timeMs === next)) updateFrame(index, { timeMs: next }); }}/></label>
      <label>Easing<select aria-label={`${target} keyframe ${index + 1} easing`} value={frame.easing ?? "linear"} disabled={disabled} onChange={event => updateFrame(index, { easing: event.target.value as AnimationEasing })}>{easingOptions.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      {properties.filter(([key]) => (target === "Device" || !["rotateX", "rotateY", "foldAngle"].includes(key)) && (key !== "foldAngle" || duo)).map(([key, name, min, max, step]) => <label key={key}>{name}<input aria-label={`${target} keyframe ${index + 1} ${name.toLowerCase()}`} type="number" min={key === "scale" && target === "Device" ? .25 : min} max={key === "scale" && target === "Device" ? 1.5 : max} step={step} value={frame[key] ?? ""} placeholder="Base" disabled={disabled} onChange={event => updateFrame(index, { [key]: event.target.value === "" ? undefined : Math.max(key === "scale" && target === "Device" ? .25 : min, Math.min(key === "scale" && target === "Device" ? 1.5 : max, Number(event.target.value))) })}/></label>)}</div>
      <button type="button" className="secondary-button" disabled={disabled} onClick={() => update({ keyframes: frames.filter((_, i) => i !== index) })}>Delete {target.toLowerCase()} keyframe {index + 1}</button>
    </details>)}
    {!!value && <button type="button" className="secondary-button" disabled={disabled} onClick={() => onChange(undefined)}>Clear {target.toLowerCase()} animation</button>}
  </details>;
}

export function ClipTransitionControls({ value, disabled, onChange, durationMs }: { value?: VideoClip["transition"]; disabled?: boolean; onChange: (transition: VideoClip["transition"]) => void; durationMs: number }) {
  return <div className="video-transition-controls"><label>Transition into clip<select aria-label="Clip transition" disabled={disabled} value={value?.kind ?? "none"} onChange={event => onChange(event.target.value === "none" ? undefined : { kind: event.target.value as NonNullable<VideoClip["transition"]>["kind"], durationMs: Math.min(600, durationMs / 2), easing: "linear" })}>
    <option value="none">Cut</option><option value="crossfade">Crossfade</option><option value="slide-left">Slide left</option><option value="slide-right">Slide right</option><option value="wipe-left">Wipe left</option><option value="wipe-right">Wipe right</option><option value="zoom">Zoom</option>
  </select></label>{value && <><label>Duration (ms)<input aria-label="Clip transition duration" type="number" min="50" max={Math.min(60000,durationMs / 2)} step="50" value={value.durationMs} onChange={event => { if (event.target.value) onChange({ ...value, durationMs: Math.min(60000, durationMs / 2, Math.max(50, Number(event.target.value))) }); }}/></label><label>Easing<select aria-label="Clip transition easing" value={value.easing ?? "linear"} onChange={event => onChange({ ...value, easing: event.target.value as AnimationEasing })}>{easingOptions.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label></>}
    <small>Clips overlap during transitions. Audio crossfades with the picture.</small>
  </div>;
}
