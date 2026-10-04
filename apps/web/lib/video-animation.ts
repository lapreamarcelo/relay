import type { AnimationEasing, AnimationEffect, ClipTransition, LayerAnimation, LayerKeyframe } from "@relay/core";
export const animationEasings = ["linear", "ease-in", "ease-out", "ease-in-out"] as const;
export const animationPresets = ["fade", "slide-up", "slide-down", "slide-left", "slide-right", "pop", "zoom", "typewriter"] as const;
export const transitionKinds = ["crossfade", "slide-left", "slide-right", "wipe-left", "wipe-right", "zoom"] as const;
export type AnimationScalar = number | string;
export interface AnimationState {
  x: number;
  y: number;
  scale: number;
  rotateX: number;
  rotateY: number;
  rotateZ: number;
  foldAngle: number;
  opacity: number;
  reveal: number;
}
export type AnimationExpressions = {
  [K in keyof AnimationState]: AnimationScalar;
};
export const scalarAdd = (a: AnimationScalar, b: AnimationScalar): AnimationScalar => typeof a === "number" && typeof b === "number" ? a + b : a === 0 ? b : b === 0 ? a : `(${a}+${b})`;
export const scalarMul = (a: AnimationScalar, b: AnimationScalar): AnimationScalar => typeof a === "number" && typeof b === "number" ? a * b : a === 0 || b === 0 ? 0 : a === 1 ? b : b === 1 ? a : `(${a}*${b})`;
const sub = (a: AnimationScalar, b: AnimationScalar) => scalarAdd(a, scalarMul(-1, b));
export const scalarClamp = (v: AnimationScalar): AnimationScalar => typeof v === "number" ? Math.min(1, Math.max(0, v)) : `min(1,max(0,${v}))`;
const less = (t: AnimationScalar, boundary: number, a: AnimationScalar, b: AnimationScalar): AnimationScalar => typeof t === "number" ? t < boundary ? a : b : `if(lt(${t},${boundary}),${a},${b})`;
const lerp = (a: AnimationScalar, b: AnimationScalar, p: AnimationScalar) => scalarAdd(a, scalarMul(sub(b, a), p));
/** Same algebra generates preview values and FFmpeg expressions. */
export function animationEase(progress: AnimationScalar, easing: AnimationEasing = "linear"): AnimationScalar {
  const p = scalarClamp(progress);
  if (easing === "ease-in")
      return scalarMul(p, p);
  if (easing === "ease-out")
      return sub(1, scalarMul(sub(1, p), sub(1, p)));
  if (easing === "ease-in-out")
      return less(p, .5, scalarMul(2, scalarMul(p, p)), sub(1, scalarMul(2, scalarMul(sub(1, p), sub(1, p)))));
  return p;
}
export const easingProgress = (progress: number, easing?: AnimationEasing): number => animationEase(progress, easing) as number;
export const easingExpression = (progress: string, easing?: AnimationEasing): string => String(animationEase(progress, easing));
const fields = ["x", "y", "scale", "rotateX", "rotateY", "rotateZ", "foldAngle", "opacity"] as const;
function track(animation: LayerAnimation | undefined, key: typeof fields[number], time: AnimationScalar, base: number): AnimationScalar {
  const keys = (animation?.keyframes ?? []).filter(k => k[key] !== undefined);
  if (!keys.length)
      return base;
  const points = keys[0].timeMs > 0 ? [{ timeMs: 0, [key]: base }, ...keys] : keys;
  const segments = points.slice(0,-1).map((a,index) => {
    const b = points[index+1];
    const progress = animationEase(scalarMul(sub(time,a.timeMs),1/(b.timeMs-a.timeMs)),a.easing);
    return {endMs:b.timeMs,value:lerp(a[key]!,b[key]!,progress)};
  });
  segments.push({endMs:Infinity,value:points[points.length-1][key]!});
  // Balance the decision tree: long keyframe tracks must stay within FFmpeg's
  // expression parser nesting limit, rather than nesting one if per keyframe.
  function choose(start:number,end:number):AnimationScalar {
    if(end-start===1) return segments[start].value;
    const middle=Math.floor((start+end)/2);
    return less(time,segments[middle-1].endMs,choose(start,middle),choose(middle,end));
  }
  return choose(0,segments.length);
}

function effect(state: AnimationExpressions, e: AnimationEffect | undefined, time: AnimationScalar, duration: number, exit: boolean) {
  if (!e)
      return;
  const length = Math.min(e.durationMs, duration / 2);
  const p = animationEase(scalarMul(sub(time, exit ? duration - length : 0), 1 / Math.max(1, length)), e.easing ?? "ease-out");
  const amount = exit ? p : sub(1, p);
  if (e.preset === "fade")
      state.opacity = scalarMul(state.opacity, sub(1, amount));
  if (e.preset.startsWith("slide-")) {
      const vertical = e.preset === "slide-up" || e.preset === "slide-down";
      const direction = e.preset === "slide-up" || e.preset === "slide-left" ? 1 : -1;
      const key = vertical ? "y" : "x";
      state[key] = scalarAdd(state[key], scalarMul(.12 * direction * (exit ? -1 : 1), amount));
      state.opacity = scalarMul(state.opacity, sub(1, amount));
  }
  if (e.preset === "pop" || e.preset === "zoom") {
      state.scale = scalarMul(state.scale, lerp(1, e.preset === "pop" ? .65 : 1.2, amount));
      state.opacity = scalarMul(state.opacity, sub(1, amount));
  }
  if (e.preset === "typewriter")
      state.reveal = scalarMul(state.reveal, sub(1, amount));
}
export function animationExpressions(animation: LayerAnimation | undefined, timeMs: AnimationScalar, durationMs: number, basePose: Partial<AnimationState> = {}, target: "label" | "device" = "label"): AnimationExpressions {
  const base: AnimationState = { x: .5, y: target === "label" ? .2 : .5, scale: 1, rotateX: 0, rotateY: 0, rotateZ: 0, foldAngle: 0, opacity: 1, reveal: 1 };
  for (const key of [...fields, "reveal"] as const) if (basePose[key] !== undefined) base[key] = basePose[key]!;
  const state: AnimationExpressions = { ...base };
  for (const key of fields)
      state[key] = track(animation, key, timeMs, base[key]);
  effect(state, animation?.entrance, timeMs, durationMs, false);
  effect(state, animation?.exit, timeMs, durationMs, true);
  state.opacity = scalarClamp(state.opacity);
  state.reveal = scalarClamp(state.reveal);
  return state;
}
export function animationState(animation: LayerAnimation | undefined, timeMs: number, durationMs: number, basePose: Partial<AnimationState> = {}, target: "label" | "device" = "label"): AnimationState {
  return animationExpressions(animation, Math.max(0, timeMs), Math.max(1, durationMs), basePose, target) as AnimationState;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Animation settings must be an object.");
  return value as Record<string, unknown>;
}
function number(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`Animation value must be between ${min} and ${max}.`);
  return value;
}
export function normalizeAnimationEasing(value: unknown): AnimationEasing | undefined {
  if (value === undefined) return undefined;
  if (!animationEasings.includes(value as AnimationEasing)) throw new Error("Choose a supported animation easing.");
  return value as AnimationEasing;
}
export function normalizeLayerAnimation(value: unknown, target: "label" | "device" = "label", duo = false): LayerAnimation | undefined {
  if (value === undefined) return undefined;
  const input = object(value);
  const animation: LayerAnimation = {};
  for (const key of ["entrance", "exit"] as const) {
      if (input[key] === undefined) continue;
      const effect = object(input[key]);
      if (!animationPresets.includes(effect.preset as AnimationEffect["preset"])) throw new Error("Choose a supported animation preset.");
      if (target === "device" && effect.preset === "typewriter") throw new Error("Typewriter is supported on text labels only.");
      animation[key] = {
          preset: effect.preset as AnimationEffect["preset"],
          durationMs: number(effect.durationMs, 50, 60000),
          ...(effect.easing === undefined ? {} : { easing: normalizeAnimationEasing(effect.easing) }),
      };
  }
  if (input.keyframes !== undefined) {
      if (!Array.isArray(input.keyframes) || input.keyframes.length > 100) throw new Error("Use up to 100 animation keyframes.");
      let previous = -1;
      animation.keyframes = input.keyframes.map(value => {
          const input = object(value);
          const timeMs = number(input.timeMs, 0, 900000);
          if (timeMs <= previous) throw new Error("Keyframe times must be unique and increasing.");
          previous = timeMs;
          const keyframe: LayerKeyframe = { timeMs, ...(input.easing === undefined ? {} : { easing: normalizeAnimationEasing(input.easing) }) };
          const ranges = { x: [0, 1], y: [0, 1], scale: target === "device" ? [.25, 1.5] : [.1, 3], rotateX: [-60, 60], rotateY: [-60, 60], rotateZ: [-180, 180], foldAngle: [0, 165], opacity: [0, 1] } as const;
          for (const field of fields) {
              if (input[field] === undefined) continue;
              if (field === "foldAngle" && !duo) throw new Error("Folding keyframes require the iPhone Duo frame.");
              if (target === "label" && (field === "rotateX" || field === "rotateY")) throw new Error("Text keyframes support 2D rotation only.");
              keyframe[field] = number(input[field], ranges[field][0], ranges[field][1]);
          }
          if (!fields.some(field => keyframe[field] !== undefined)) throw new Error("Each keyframe needs an animated property.");
          return keyframe;
      });
  }
  return animation;
}
export function normalizeClipTransition(value: unknown): ClipTransition | undefined {
  if (value === undefined) return undefined;
  const transition = object(value);
  if (!transitionKinds.includes(transition.kind as ClipTransition["kind"])) throw new Error("Choose a supported clip transition.");
  return {
      kind: transition.kind as ClipTransition["kind"],
      durationMs: number(transition.durationMs, 50, 60000),
      ...(transition.easing === undefined ? {} : { easing: normalizeAnimationEasing(transition.easing) }),
  };
}
