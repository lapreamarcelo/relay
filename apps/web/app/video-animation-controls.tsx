"use client";

import { useState, useRef, type PointerEvent } from "react";
import type { AnimationCurve, AnimationEasing, AnimationEffect, LayerAnimation, LayerKeyframe, VideoClip } from "@relay/core";

import { compileMotionRecipe, motionRecipes, retimeMotion } from "../lib/video-motion-presets";
import { LayerKeyframeLane } from "./video-keyframe-lanes";
import "./motion-editor.css";

import { animationState, easingProgress, textOnlyPresets } from "../lib/video-animation";

export const easingOptions: Array<[AnimationEasing, string]> = [["linear", "Linear"], ["ease-in", "Ease in"], ["ease-out", "Ease out"], ["ease-in-out", "Ease in & out"], ["spring", "Spring"], ["bouncy", "Bounce"], ["cubic-bezier", "Custom curve"]];
const effects: Array<[AnimationEffect["preset"], string]> = [["fade", "Fade"], ["slide-up", "Slide up"], ["slide-down", "Slide down"], ["slide-left", "Slide left"], ["slide-right", "Slide right"], ["pop", "Pop"], ["zoom", "Zoom"], ["typewriter", "Typewriter"], ["letter-rise", "Letter lift"], ["word-spring", "Word bounce"], ["line-cascade", "Line sequence"], ["tracking", "Letter spacing"], ["soft-reveal", "Soft reveal"], ["focus", "Focus in"], ["ripple", "Ripple"], ["spin-in", "Turn in"], ["letter-drop", "Letter fall"], ["letter-slide", "Letter slide"], ["word-slide", "Word slide"], ["word-blur", "Word focus"], ["line-wipe", "Line reveal"], ["letter-zoom", "Letter grow"], ["word-zoom", "Word settle"], ["letter-flip", "Letter flip"], ["wave-rise", "Wave arrival"], ["arc-in", "Arc arrival"], ["bounce-in", "Spring lift"], ["elastic-in", "Elastic scale"], ["scatter-in", "Gather letters"], ["wipe-left", "Reveal from left"], ["wipe-right", "Reveal from right"], ["mask-up", "Reveal upward"], ["mask-down", "Reveal downward"], ["pulse-reveal", "Pulse arrival"], ["alternating-rise", "Alternating arrival"], ["ink-reveal", "Ink passage"]];
const textEffects = textOnlyPresets;
const properties = [
  ["x", "Horizontal", 0, 1, .01], ["y", "Vertical", 0, 1, .01], ["scale", "Scale", .1, 3, .05],
  ["rotateX", "Tilt X", -60, 60, 1], ["rotateY", "Tilt Y", -60, 60, 1], ["rotateZ", "Rotation", -180, 180, 1], ["depth", "Depth", -2, 2, .01],
  ["foldAngle", "Fold angle", 0, 165, 1], ["opacity", "Opacity", 0, 1, .05],
] as const;

export function LayerAnimationControls({ value, onChange, target, timeMs, durationMs, base, disabled = false, duo = false, mesh = false, onSeek }: {
  value?: LayerAnimation; onChange: (animation: LayerAnimation | undefined) => void;
  target: "Label" | "Device"; timeMs: number; durationMs: number; base: Partial<LayerKeyframe>; disabled?: boolean; duo?: boolean; mesh?: boolean; onSeek?: (localTimeMs: number) => void;
}) {
  const [recipeDuration, setRecipeDuration] = useState(durationMs);
  const update = (changes: Partial<LayerAnimation>) => onChange({ ...value, ...changes });
  const frames = value?.keyframes ?? [];
  const updateFrame = (index: number, changes: Partial<LayerKeyframe>) => update({ keyframes: frames.map((frame, i) => i === index ? (() => { const next = { ...frame, ...changes }; return properties.some(([key]) => next[key] !== undefined) ? next : { ...next, opacity: 1 }; })() : frame).sort((a, b) => a.timeMs - b.timeMs) });
  const capture = () => {
    const time = Math.min(durationMs, Math.max(0, Math.round(timeMs)));
    const pose = animationState(value ? { keyframes: value.keyframes, scaleMode: value.scaleMode, returnMs: value.returnMs } : undefined, time, durationMs, base, target.toLowerCase() as "label" | "device");
    const keyframe: LayerKeyframe = { timeMs: time, easing: "ease-in-out", x: pose.x, y: pose.y, scale: pose.scale, rotateZ: pose.rotateZ, opacity: pose.opacity, ...(target === "Device" || mesh ? { rotateX: pose.rotateX, rotateY: pose.rotateY, ...(mesh?{depth:pose.depth}:{}), ...(duo ? { foldAngle: pose.foldAngle } : {}) } : {}) };
    update({ keyframes: [...frames.filter(frame => frame.timeMs !== time), keyframe].sort((a, b) => a.timeMs - b.timeMs) });
  };
  return <details className="video-animation-controls" open data-testid={`${target.toLowerCase()}-animation-controls`}>
    <summary>{target === "Label" ? "Text animation" : "Entrance, exit & keyframes"}</summary>
    <div className="video-animation-effects">{(["entrance", "exit"] as const).map(edge => <div key={edge}>
      <label>{edge === "entrance" ? "Entrance" : "Exit"}<select aria-label={`${target} ${edge} animation`} disabled={disabled} value={value?.[edge]?.preset ?? "none"} onChange={event => update({ [edge]: event.target.value === "none" ? undefined : { preset: event.target.value as AnimationEffect["preset"], durationMs: Math.min(600, Math.max(50, durationMs / 2)), easing: "ease-out" } })}>
        <option value="none">None</option>{effects.filter(([preset]) => target === "Label" || !textEffects.has(preset)).map(([preset, name]) => <option key={preset} value={preset}>{name}</option>)}
      </select></label>
      {value?.[edge] && <><label>Duration (ms)<input aria-label={`${target} ${edge} duration`} type="number" min="50" max={Math.min(60000,durationMs)} step="50" value={value[edge]!.durationMs} disabled={disabled} onChange={event => { if (event.target.value) update({ [edge]: { ...value[edge]!, durationMs: Math.max(50, Math.min(60000, durationMs, Number(event.target.value))) } }); }}/></label>
      <label>Easing<select aria-label={`${target} ${edge} easing`} value={value[edge]!.easing ?? "ease-out"} disabled={disabled} onChange={event => update({ [edge]: { ...value[edge]!, easing: event.target.value as AnimationEasing } })}>{easingOptions.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      <CurveControls name={`${target} ${edge}`} easing={value[edge]!.easing} value={value[edge]!.curve} disabled={disabled} onChange={curve => update({ [edge]: { ...value[edge]!, curve } })}/>
      {target === "Label" && textEffects.has(value[edge]!.preset) && <label>Stagger (ms)<input aria-label={`${target} ${edge} stagger`} type="number" min={0} max={500} step={10} value={value[edge]!.staggerMs ?? 45} disabled={disabled} onChange={event => update({ [edge]: { ...value[edge]!, staggerMs: Math.max(0, Math.min(500, Number(event.target.value))) } })}/></label>}</>}
    </div>)}</div>
    <MotionTimingControls name={target} value={value} durationMs={durationMs} disabled={disabled} onChange={update}/>
    <details className="motion-recipes"><summary>Relay motion recipes</summary><small>Replace keys with a move around your current resting pose. Every pose remains editable.</small><div className="motion-recipe-grid">{motionRecipes.filter(recipe => (!recipe.deviceOnly || target === "Device") && (!recipe.requiresMesh || mesh) && (!recipe.duoOnly || duo)).map(recipe => <button type="button" className="secondary-button" key={recipe.id} title={recipe.description} disabled={disabled} onClick={() => update(compileMotionRecipe(recipe.id, durationMs, mesh?base:{...base,depth:undefined}, target.toLowerCase() as "label" | "device"))}>{recipe.name}</button>)}</div><label>Keyframe sequence length (ms)<input aria-label={`${target} motion length`} type="number" min={1} max={durationMs} value={Math.min(durationMs, recipeDuration)} disabled={disabled || !frames.length} onChange={event => setRecipeDuration(Math.max(1, Math.min(durationMs, Number(event.target.value))))}/></label><button type="button" className="secondary-button" disabled={disabled || !frames.length} onClick={() => update({ keyframes: retimeMotion(frames, Math.max(1, frames.at(-1)!.timeMs), Math.min(durationMs, recipeDuration)) })}>Retime {target.toLowerCase()} keys</button></details>
    {!!frames.length && <LayerKeyframeLane name={target} value={value} durationMs={durationMs} timeMs={timeMs} disabled={disabled} onChange={onChange} onSeek={onSeek}/>}
    <div className="video-keyframes-head"><b>Keyframes</b><button type="button" className="secondary-button" disabled={disabled || frames.length >= 100} onClick={capture}>Add {target.toLowerCase()} keyframe at playhead</button></div>
    <small>Times are relative to this {target === "Label" ? "label" : "clip"}. Adjust a keyframe below to move, resize or rotate over time. Easing applies after that keyframe.</small>
    {frames.map((frame, index) => <details className="video-keyframe" key={index} open={frames.length === 1}>
      <summary>{(frame.timeMs / 1000).toFixed(2)}s · Keyframe {index + 1}</summary>
      <div className="video-keyframe-fields"><label>Time (ms)<input aria-label={`${target} keyframe ${index + 1} time`} type="number" min="0" max={durationMs} step="100" value={frame.timeMs} disabled={disabled} onChange={event => { const next = Math.max(0, Math.min(durationMs, Number(event.target.value))); if (!frames.some((f, i) => i !== index && f.timeMs === next)) updateFrame(index, { timeMs: next }); }}/></label>
      <label>Easing<select aria-label={`${target} keyframe ${index + 1} easing`} value={frame.easing ?? "linear"} disabled={disabled} onChange={event => updateFrame(index, { easing: event.target.value as AnimationEasing })}>{easingOptions.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      <CurveControls name={`${target} keyframe ${index + 1}`} easing={frame.easing} value={frame.curve} disabled={disabled} onChange={curve => updateFrame(index, { curve })}/>
      {properties.filter(([key]) => (target === "Device" || mesh || !["rotateX", "rotateY", "foldAngle", "depth"].includes(key)) && (key !== "foldAngle" || duo) && (key!=="depth"||mesh)).map(([key, name, min, max, step]) => <label key={key}>{name}<input aria-label={`${target} keyframe ${index + 1} ${name.toLowerCase()}`} type="number" min={mesh&&key.startsWith("rotate")?-1080:key === "scale" && target === "Device" ? .25 : min} max={mesh&&key.startsWith("rotate")?1080:key === "scale" && target === "Device" ? 1.5 : max} step={step} value={frame[key] ?? ""} placeholder="Base" disabled={disabled} onChange={event => updateFrame(index, { [key]: event.target.value === "" ? undefined : Math.max(mesh&&key.startsWith("rotate")?-1080:key === "scale" && target === "Device" ? .25 : min, Math.min(mesh&&key.startsWith("rotate")?1080:key === "scale" && target === "Device" ? 1.5 : max, Number(event.target.value))) })}/></label>)}</div>
      <button type="button" className="secondary-button" disabled={disabled} onClick={() => update({ keyframes: frames.filter((_, i) => i !== index) })}>Delete {target.toLowerCase()} keyframe {index + 1}</button>
    </details>)}
    {!!value && <button type="button" className="secondary-button" disabled={disabled} onClick={() => onChange(undefined)}>Clear {target.toLowerCase()} animation</button>}
  </details>;
}

export function ClipTransitionControls({ value, disabled, onChange, durationMs }: { value?: VideoClip["transition"]; disabled?: boolean; onChange: (transition: VideoClip["transition"]) => void; durationMs: number }) {
  return <div className="video-transition-controls"><label>Transition into clip<select aria-label="Clip transition" disabled={disabled} value={value?.kind ?? "none"} onChange={event => onChange(event.target.value === "none" ? undefined : { kind: event.target.value as NonNullable<VideoClip["transition"]>["kind"], durationMs: Math.min(600, durationMs / 2), easing: "linear" })}>
    <option value="none">Cut</option><option value="crossfade">Crossfade</option><option value="slide-left">Slide left</option><option value="slide-right">Slide right</option><option value="wipe-left">Wipe left</option><option value="wipe-right">Wipe right</option><option value="zoom">Zoom</option>
  </select></label>{value && <><label>Duration (ms)<input aria-label="Clip transition duration" type="number" min="50" max={Math.min(60000,durationMs / 2)} step="50" value={value.durationMs} disabled={disabled} onChange={event => { if (event.target.value) onChange({ ...value, durationMs: Math.min(60000, durationMs / 2, Math.max(50, Number(event.target.value))) }); }}/></label><label>Easing<select aria-label="Clip transition easing" value={value.easing ?? "linear"} disabled={disabled} onChange={event => onChange({ ...value, easing: event.target.value as AnimationEasing })}>{easingOptions.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label><CurveControls name="Clip transition" easing={value.easing} value={value.curve} disabled={disabled} onChange={curve => onChange({ ...value, curve })}/></>}
    <small>Clips overlap during transitions. Audio crossfades with the picture.</small>
  </div>;
}

export function MotionTimingControls({ name, value, durationMs, disabled, onChange }: { name: string; value?: Pick<LayerAnimation, "scaleMode" | "returnMs">; durationMs: number; disabled?: boolean; onChange: (patch: Pick<LayerAnimation, "scaleMode" | "returnMs">) => void }) {
  return <div className="motion-timing-controls"><label>Scale interpolation<select aria-label={`${name} scale interpolation`} disabled={disabled} value={value?.scaleMode ?? "linear"} onChange={event => onChange({ scaleMode: event.target.value as "linear" | "perceptual" })}><option value="linear">Even size change</option><option value="perceptual">Even perceived speed</option></select></label><label>After last keyframe<select aria-label={`${name} after last keyframe`} disabled={disabled} value={value?.returnMs === undefined ? "hold" : "return"} onChange={event => onChange({ returnMs: event.target.value === "hold" ? undefined : Math.min(durationMs, 700) })}><option value="hold">Hold final pose</option><option value="return">Return to resting pose</option></select></label>{value?.returnMs !== undefined && <label>Return duration (ms)<input aria-label={`${name} return duration`} disabled={disabled} type="number" min={50} max={Math.min(60000, durationMs)} step={50} value={value.returnMs} onChange={event => onChange({ returnMs: Math.max(50, Math.min(60000, durationMs, Number(event.target.value))) })}/></label>}</div>;
}

/** Numeric and direct-manipulation curve editing share the serialized curve used by rendering. */
export function CurveControls({ name, easing, value, disabled, onChange }: { name: string; easing?: AnimationEasing; value?: AnimationCurve; disabled?: boolean; onChange: (curve: AnimationCurve | undefined) => void }) {
  const [draft, setDraft] = useState<AnimationCurve["controlPoints"] | null>(null);
  const transaction = useRef<{ index: number; initial: [number, number, number, number]; current: [number, number, number, number] } | null>(null);
  const points = draft ?? value?.controlPoints ?? [.22, 1, .36, 1];
  const graph = useRef<SVGSVGElement>(null);
  const finish = (cancel = false) => { const drag = transaction.current; transaction.current = null; setDraft(null); if (!cancel && drag && drag.current.some((v, i) => v !== drag.initial[i])) onChange({ ...value, controlPoints: drag.current }); };
  const handleMove = (event: PointerEvent<SVGCircleElement>) => {
    const drag = transaction.current, rect = graph.current?.getBoundingClientRect();
    if (!drag || !rect) return;
    const x = Math.max(0, Math.min(1, ((event.clientX - rect.left) / rect.width * 180 - 24) / 132));
    const y = Math.max(-2, Math.min(3, (100 - (graph.current!.viewBox.baseVal.y + (event.clientY - rect.top) / rect.height * graph.current!.viewBox.baseVal.height)) / 76));
    const next = [...drag.current] as [number, number, number, number]; next[drag.index * 2] = Math.round(x * 100) / 100; next[drag.index * 2 + 1] = Math.round(y * 100) / 100;
    drag.current = next; setDraft(next);
  };
  if (easing === "spring" || easing === "bouncy") return <div className="motion-spring-controls" aria-label={`${name} spring settings`}>
    <svg className="motion-spring-graph" viewBox="0 0 180 96" role="img" aria-label={`${name} spring response`}><path className="motion-curve-grid" d="M8 72H172 M8 24H172"/><path className="motion-curve-path" d={Array.from({ length: 65 }, (_, i) => `${i ? "L" : "M"}${8 + i / 64 * 164} ${72 - easingProgress(i / 64, easing, value) * 48}`).join(" ")}/></svg>
    {([["stiffness", "Strength", 1, 1000, 1, 180], ["damping", "Damping", .1, 100, .1, easing === "bouncy" ? 12 : 22], ["mass", "Mass", .1, 10, .1, 1], ["velocity", "Initial velocity", -20, 20, .1, 0]] as const).map(([key, label, min, max, step, fallback]) => <label key={key}>{label}<input aria-label={`${name} spring ${key}`} type="number" min={min} max={max} step={step} value={value?.[key] ?? fallback} disabled={disabled} onChange={event => { if (event.target.value) onChange({ ...value, [key]: Math.max(min, Math.min(max, Number(event.target.value))) }); }}/></label>)}
    <small>Higher damping settles sooner; strength speeds up the response.</small><button className="secondary-button" type="button" disabled={disabled} onClick={() => onChange(undefined)}>Reset spring</button>
  </div>;
  if (easing !== "cubic-bezier") return null;
  const cx = (value: number) => 24 + value * 132, cy = (value: number) => 100 - value * 76;
  const graphTop = Math.min(0, cy(points[1]) - 10, cy(points[3]) - 10), graphBottom = Math.max(124, cy(points[1]) + 10, cy(points[3]) + 10);
  return <div className="motion-curve-editor" aria-label={`${name} custom curve`}>
    <svg ref={graph} viewBox={`0 ${graphTop} 180 ${graphBottom - graphTop}`} preserveAspectRatio="none" className="motion-curve-graph" role="group" aria-label={`${name} curve graph`}><path className="motion-curve-grid" d="M24 24V100H156 M24 62H156 M90 24V100 M24 100L156 24"/><path className="motion-curve-tangents" d={`M24 100L${cx(points[0])} ${cy(points[1])} M156 24L${cx(points[2])} ${cy(points[3])}`}/><path className="motion-curve-path" d={`M24 100C${cx(points[0])} ${cy(points[1])},${cx(points[2])} ${cy(points[3])},156 24`}/>{[0, 1].map(index => <circle key={index} cx={cx(points[index * 2])} cy={cy(points[index * 2 + 1])} r={5} className="motion-curve-handle" role="slider" tabIndex={disabled ? -1 : 0} aria-disabled={disabled} aria-label={`${name} curve handle ${index + 1}`} aria-valuemin={0} aria-valuemax={1} aria-valuenow={points[index * 2]} aria-valuetext={`Time ${points[index * 2]}, progress ${points[index * 2 + 1]}`} onPointerDown={event => { if (disabled) return; event.currentTarget.setPointerCapture(event.pointerId); transaction.current = { index, initial: [...points], current: [...points] }; }} onPointerMove={handleMove} onPointerUp={event => { finish(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => finish(true)} onLostPointerCapture={() => finish(true)} onKeyDown={event => { if (disabled) return; if (event.key === "Escape") { finish(true); return; } const coordinate = ["ArrowLeft", "ArrowRight"].includes(event.key) ? index * 2 : ["ArrowUp", "ArrowDown"].includes(event.key) ? index * 2 + 1 : -1; if (coordinate < 0) return; event.preventDefault(); const next = [...points] as [number, number, number, number]; next[coordinate] = Math.max(coordinate % 2 ? -2 : 0, Math.min(coordinate % 2 ? 3 : 1, next[coordinate] + (["ArrowRight", "ArrowUp"].includes(event.key) ? .01 : -.01))); onChange({ ...value, controlPoints: next }); }}/>)}</svg>
    <div className="motion-curve-coordinates">{["Start time", "Start progress", "End time", "End progress"].map((label, index) => <label key={label}>{label}<input aria-label={`${name} curve ${label.toLowerCase()}`} type="number" min={index % 2 ? -2 : 0} max={index % 2 ? 3 : 1} step={.01} value={points[index]} disabled={disabled} onChange={event => { if (!event.target.value) return; const next = [...points] as [number, number, number, number]; next[index] = Math.max(index % 2 ? -2 : 0, Math.min(index % 2 ? 3 : 1, Number(event.target.value))); onChange({ ...value, controlPoints: next }); }}/></label>)}</div><small>Drag the handles or use arrow keys. Progress outside 0–1 adds overshoot.</small><button className="secondary-button" type="button" disabled={disabled} onClick={() => onChange(undefined)}>Reset curve</button>
  </div>;
}
