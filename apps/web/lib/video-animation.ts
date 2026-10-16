import type { AnimationCurve, AnimationEasing, AnimationEffect, ClipTransition, LayerAnimation, LayerKeyframe } from "@relay/core";
export const animationEasings = ["linear", "ease-in", "ease-out", "ease-in-out", "spring", "bouncy", "cubic-bezier"] as const;
export const animationPresets = ["fade", "slide-up", "slide-down", "slide-left", "slide-right", "pop", "zoom", "typewriter", "letter-rise", "word-spring", "line-cascade", "tracking", "soft-reveal", "focus", "ripple", "spin-in", "letter-drop", "letter-slide", "word-slide", "word-blur", "line-wipe", "letter-zoom", "word-zoom", "letter-flip", "wave-rise", "arc-in", "bounce-in", "elastic-in", "scatter-in", "wipe-left", "wipe-right", "mask-up", "mask-down", "pulse-reveal", "alternating-rise", "ink-reveal"] as const;
export const textOnlyPresets = new Set<AnimationEffect["preset"]>(animationPresets.filter(preset => !["fade", "slide-up", "slide-down", "slide-left", "slide-right", "pop", "zoom"].includes(preset)));
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
  depth: number;
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
const curves = new Map<string, number[]>();
function curveSamples(easing: AnimationEasing, curve?: AnimationCurve): number[] {
  const id = JSON.stringify([easing,curve]);
  const cached = curves.get(id); if(cached) return cached;
  const values = Array.from({length:65},(_,index)=> {
    const p=index/64;
    if(p===0||p===1)return p;
    if(easing==="cubic-bezier") {
      const [x1,y1,x2,y2]=curve?.controlPoints??[.22,1,.36,1];
      const bezier=(t:number,a:number,b:number)=>3*(1-t)*(1-t)*t*a+3*(1-t)*t*t*b+t*t*t;
      let lo=0,hi=1;
      for(let i=0;i<32;i++){const mid=(lo+hi)/2;if(bezier(mid,x1,x2)<p)lo=mid;else hi=mid;}
      return bezier((lo+hi)/2,y1,y2);
    }
    const k=curve?.stiffness??180,c=curve?.damping??(easing==="bouncy"?12:22),m=curve?.mass??1,v=curve?.velocity??0;
    const w=Math.sqrt(k/m),z=c/(2*Math.sqrt(k*m));
    const spring=(t:number)=> {
      if(z<1){const wd=w*Math.sqrt(1-z*z);return 1+Math.exp(-z*w*t)*(-Math.cos(wd*t)+(v-z*w)/wd*Math.sin(wd*t));}
      if(Math.abs(z-1)<1e-8)return 1+Math.exp(-w*t)*(-1+(v-w)*t);
      const q=Math.sqrt(z*z-1),r1=-w*(z-q),r2=-w*(z+q),a=(v+r2)/(r1-r2);
      return 1+a*Math.exp(r1*t)+(-1-a)*Math.exp(r2*t);
    };
    // Resolve the finite segment exactly without truncating useful overshoot.
    return spring(p)-(spring(1)-1)*p*p*p*p;
  });
  if(curves.size>=128)curves.delete(curves.keys().next().value!);
  curves.set(id,values);return values;
}
export function animationEase(progress: AnimationScalar, easing: AnimationEasing = "linear", curve?: AnimationCurve): AnimationScalar {
  const p = scalarClamp(progress);
  if (easing === "ease-in")
      return scalarMul(p, p);
  if (easing === "ease-out")
      return sub(1, scalarMul(sub(1, p), sub(1, p)));
  if (easing === "ease-in-out")
      return less(p, .5, scalarMul(2, scalarMul(p, p)), sub(1, scalarMul(2, scalarMul(sub(1, p), sub(1, p)))));
  if(easing==="spring"||easing==="bouncy"||easing==="cubic-bezier") {
    const samples=curveSamples(easing,curve);
    if(typeof p==="number") {const i=Math.min(63,Math.floor(p*64));return samples[i]+(samples[i+1]-samples[i])*(p*64-i);}
    const choose=(lo:number,hi:number):AnimationScalar=>{
      if(hi-lo===1)return scalarAdd(samples[lo],scalarMul(samples[lo+1]-samples[lo],sub(scalarMul(p,64),lo)));
      const mid=(lo+hi)>>1;return less(p,mid/64,choose(lo,mid),choose(mid,hi));
    };
    return choose(0,64);
  }
  return p;
}
export const easingProgress = (progress: number, easing?: AnimationEasing, curve?: AnimationCurve): number => animationEase(progress, easing,curve) as number;
export const easingExpression = (progress: string, easing?: AnimationEasing, curve?: AnimationCurve): string => String(animationEase(progress, easing,curve));
const fields = ["x", "y", "scale", "rotateX", "rotateY", "rotateZ", "foldAngle", "opacity", "depth"] as const;
function track(animation: LayerAnimation | undefined, key: typeof fields[number], time: AnimationScalar, base: number): AnimationScalar {
  const keys = (animation?.keyframes ?? []).filter(k => k[key] !== undefined);
  if (!keys.length)
      return base;
  const points:LayerKeyframe[] = keys[0].timeMs > 0 ? [{ timeMs: 0, [key]: base }, ...keys] : [...keys];
  if(animation?.returnMs){points[points.length-1]={...points.at(-1)!,easing:"ease-in-out",curve:undefined};points.push({timeMs:points.at(-1)!.timeMs+animation.returnMs,[key]:base});}
  const segments = points.slice(0,-1).map((a,index) => {
    const b = points[index+1];
    const progress = animationEase(scalarMul(sub(time,a.timeMs),1/(b.timeMs-a.timeMs)),a.easing,a.curve);
    const value=key==="scale"&&animation?.scaleMode==="perceptual" ? geometricLerp(a[key]!,b[key]!,progress) : lerp(a[key]!,b[key]!,progress);
    return {endMs:b.timeMs,value};
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
export function geometricLerp(a:number,b:number,p:AnimationScalar):AnimationScalar {
  const from=Math.max(.001,a),ratio=Math.max(.001,b)/from;
  return typeof p==="number" ? from*Math.pow(ratio,p) : `${from}*pow(${ratio},${p})`;
}

function effect(state: AnimationExpressions, e: AnimationEffect | undefined, time: AnimationScalar, duration: number, exit: boolean) {
  if (!e)
      return;
  const length = Math.min(e.durationMs, duration / 2);
  const p = animationEase(scalarMul(sub(time, exit ? duration - length : 0), 1 / Math.max(1, length)), e.easing ?? "ease-out",e.curve);
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
  const base: AnimationState = { x: .5, y: target === "label" ? .2 : .5, scale: 1, rotateX: 0, rotateY: 0, rotateZ: 0, foldAngle: 0, depth: 0, opacity: 1, reveal: 1 };
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
export function normalizeAnimationCurve(value:unknown):AnimationCurve|undefined {
  if(value===undefined)return undefined;
  const input=object(value),result:AnimationCurve={};
  if(Object.keys(input).some(key=>!["controlPoints","stiffness","damping","mass","velocity"].includes(key)))throw new Error("Unknown animation curve parameter.");
  if(input.controlPoints!==undefined){
    if(!Array.isArray(input.controlPoints)||input.controlPoints.length!==4)throw new Error("A curve needs four control point coordinates.");
    result.controlPoints=input.controlPoints.map((v,i)=>number(v,i%2?-2:0,i%2?3:1)) as [number,number,number,number];
  }
  for(const [key,min,max] of [["stiffness",1,1000],["damping",.1,100],["mass",.1,10],["velocity",-20,20]] as const)if(input[key]!==undefined)result[key]=number(input[key],min,max);
  return result;
}
export function normalizeLayerAnimation(value: unknown, target: "label" | "device" = "label", duo = false, meshRotation = false): LayerAnimation | undefined {
  if (value === undefined) return undefined;
  const input = object(value);
  const animation: LayerAnimation = {};
  if(input.scaleMode!==undefined){if(input.scaleMode!=="linear"&&input.scaleMode!=="perceptual")throw new Error("Choose linear or perceptual scaling.");animation.scaleMode=input.scaleMode;}
  if(input.returnMs!==undefined)animation.returnMs=number(input.returnMs,50,60000);
  for (const key of ["entrance", "exit"] as const) {
      if (input[key] === undefined) continue;
      const effect = object(input[key]);
      if (!animationPresets.includes(effect.preset as AnimationEffect["preset"])) throw new Error("Choose a supported animation preset.");
      if (target === "device" && textOnlyPresets.has(effect.preset as AnimationEffect["preset"])) throw new Error("This effect is supported on text labels only.");
      animation[key] = {
          preset: effect.preset as AnimationEffect["preset"],
          durationMs: number(effect.durationMs, 50, 60000),
          ...(effect.easing === undefined ? {} : { easing: normalizeAnimationEasing(effect.easing) }),
          ...(effect.curve === undefined ? {} : { curve: normalizeAnimationCurve(effect.curve) }),
          ...(effect.staggerMs === undefined ? {} : { staggerMs: number(effect.staggerMs,0,500) }),
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
          const keyframe: LayerKeyframe = { timeMs, ...(input.easing === undefined ? {} : { easing: normalizeAnimationEasing(input.easing) }),...(input.curve===undefined?{}:{curve:normalizeAnimationCurve(input.curve)}) };
          const ranges = { x: [0, 1], y: [0, 1], scale: target === "device" ? [.25, 1.5] : [.1, 3], rotateX: meshRotation ? [-1080, 1080] : [-60, 60], rotateY: meshRotation ? [-1080, 1080] : [-60, 60], rotateZ: meshRotation ? [-1080, 1080] : [-180, 180], foldAngle: [0, 165], opacity: [0, 1], depth: [-2,2] } as const;
          for (const field of fields) {
              if (input[field] === undefined) continue;
              if(field === "depth" && !meshRotation)throw new Error("Depth keyframes require a 3D device or scene text.");
              if (field === "foldAngle" && !duo) throw new Error("Folding keyframes require the iPhone Duo frame.");
              if (target === "label" && !meshRotation && (field === "rotateX" || field === "rotateY")) throw new Error("Overlay text supports 2D rotation only. Choose scene placement for 3D rotation.");
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
      ...(transition.curve === undefined ? {} : { curve: normalizeAnimationCurve(transition.curve) }),
  };
}
