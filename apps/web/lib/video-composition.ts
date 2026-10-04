import type { AnimationEffect, DeviceFrame, LayerKeyframe, TimedVideoLabel, VideoClip, VideoLayer, VideoTimeline } from "@relay/core";
import { animationPresets, transitionKinds } from "./video-animation.ts";
import { deviceFrameDevices } from "./device-frames.ts";
import { clipSchedule, normalizeVideoTimeline, timelineDuration } from "./video-timeline.ts";

export interface VideoCompositionRequest {
  prompt: string;
  timeline: VideoTimeline;
  productName?: string;
  durationMs: number;
}
export interface VideoCompositionResult {
  timeline: VideoTimeline;
  summary: string;
  warnings: string[];
  provider: "openai";
}

const cameras = ["still", "push-in", "pull-back", "pan-left", "pan-right", "orbit", "float", "fold", "unfold", "fold-cycle"] as const;
type Camera = typeof cameras[number];
type Title = { text: string; startMs: number; endMs: number; position: "top" | "middle" | "bottom"; font: "modern" | "editorial" | "mono"; fontSize: number; style: "dark" | "light" | "outline"; entrance: "none" | AnimationEffect["preset"]; exit: "none" | AnimationEffect["preset"] };
type Shot = { sourceClipId: string; inMs: number; outMs: number; fit: "cover" | "contain"; device: "none" | DeviceFrame["device"]; camera: Camera; position: "center" | "left" | "right"; transition: "none" | NonNullable<VideoClip["transition"]>["kind"]; transitionDurationMs: number; entrance: "none" | Exclude<AnimationEffect["preset"], "typewriter">; exit: "none" | Exclude<AnimationEffect["preset"], "typewriter">; titles: Title[] };
type CompositionLayer = Shot & { startMs: number; x: number; y: number; scale: number; rotateX: number; rotateY: number; rotateZ: number; volume: number };
export interface VideoCompositionPlan { summary: string; background: string; backgroundEnd: string; shots: Shot[]; layers?: CompositionLayer[] }

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a composition object.");
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== "string" || value.trim().length < min || value.trim().length > max) throw new Error(`${field} must contain ${min} to ${max} characters.`);
  return value.trim();
}
function number(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) throw new Error(`${field} must be an integer between ${min} and ${max}.`);
  return value;
}
function choice<T extends string>(value: unknown, field: string, values: readonly T[]): T {
  if (!values.includes(value as T)) throw new Error(`Unsupported ${field}.`);
  return value as T;
}
function keys(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error("Unexpected composition property.");
}
export function normalizeVideoCompositionRequest(raw: unknown): VideoCompositionRequest {
  const input = object(raw);
  keys(input, ["prompt", "timeline", "productName", "durationMs"]);
  const timeline = normalizeVideoTimeline(input.timeline);
  if (!timeline.clips.length && !timeline.layers?.length) throw new Error("Add at least one recording or image before composing.");
  return { prompt: text(input.prompt, "Prompt", 10, 4000), timeline, ...(input.productName === undefined ? {} : { productName: text(input.productName, "Product name", 1, 120) }), durationMs: number(input.durationMs ?? 15000, "Duration", 1000, 60000) };
}

const enumSchema = (values: readonly string[]) => ({ type: "string", enum: values });
const integerSchema = (minimum: number, maximum: number) => ({ type: "integer", minimum, maximum });
const strictSchema = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const shotProperties = {
    sourceClipId: { type: "string", minLength: 1, maxLength: 120 }, inMs: integerSchema(0, 3600000), outMs: integerSchema(100, 3600000),
    fit: enumSchema(["cover", "contain"]), device: enumSchema(["none", ...deviceFrameDevices]), camera: enumSchema(cameras), position: enumSchema(["center", "left", "right"]),
    transition: enumSchema(["none", ...transitionKinds]), transitionDurationMs: integerSchema(50, 2000),
    entrance: enumSchema(["none", ...animationPresets.filter(p => p !== "typewriter")]), exit: enumSchema(["none", ...animationPresets.filter(p => p !== "typewriter")]),
    titles: { type: "array", maxItems: 2, items: strictSchema({ text: { type: "string", minLength: 1, maxLength: 180 }, startMs: integerSchema(0, 60000), endMs: integerSchema(100, 60000), position: enumSchema(["top", "middle", "bottom"]), font: enumSchema(["modern", "editorial", "mono"]), fontSize: integerSchema(28, 160), style: enumSchema(["dark", "light", "outline"]), entrance: enumSchema(["none", ...animationPresets]), exit: enumSchema(["none", ...animationPresets]) }) },
};
const { transition: _transition, transitionDurationMs: _transitionDuration, position: _position, ...layerProperties } = shotProperties;
/** No URLs or arbitrary executable expressions enter the provider output. */
export const videoCompositionPlanSchema = strictSchema({
  summary: { type: "string", minLength: 1, maxLength: 800 },
  background: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
  backgroundEnd: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
  shots: { type: "array", minItems: 0, maxItems: 12, items: strictSchema(shotProperties) },
  layers: { type: "array", maxItems: 12, items: strictSchema({ ...layerProperties, device: enumSchema(deviceFrameDevices), startMs: integerSchema(0, 59900), x: { type: "number", minimum: 0, maximum: 1 }, y: { type: "number", minimum: 0, maximum: 1 }, scale: { type: "number", minimum: .25, maximum: 1.5 }, rotateX: { type: "number", minimum: -60, maximum: 60 }, rotateY: { type: "number", minimum: -60, maximum: 60 }, rotateZ: { type: "number", minimum: -180, maximum: 180 }, volume: { type: "number", minimum: 0, maximum: 1 } }) },
});

function normalizePlan(raw: unknown): VideoCompositionPlan {
  const plan = object(raw); keys(plan, ["summary", "background", "backgroundEnd", "shots", "layers"]);
  const color = (value: unknown) => { if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error("Composition backgrounds require six-digit hex colors."); return value.toUpperCase(); };
  if (!Array.isArray(plan.shots) || plan.shots.length > 12 || (plan.layers !== undefined && (!Array.isArray(plan.layers) || plan.layers.length > 12))) throw new Error("Compose up to 12 shots and 12 device layers.");
  const normalizeShot = (rawShot: unknown): Shot => {
    const s = object(rawShot); keys(s, ["sourceClipId", "inMs", "outMs", "fit", "device", "camera", "position", "transition", "transitionDurationMs", "entrance", "exit", "titles"]);
    if (!Array.isArray(s.titles) || s.titles.length > 2) throw new Error("Use up to two titles per shot.");
    const titles = s.titles.map(rawTitle => {
      const t = object(rawTitle); keys(t, ["text", "startMs", "endMs", "position", "font", "fontSize", "style", "entrance", "exit"]);
      return { text: text(t.text, "Title", 1, 180), startMs: number(t.startMs, "Title start", 0, 60000), endMs: number(t.endMs, "Title end", 100, 60000), position: choice(t.position, "title position", ["top", "middle", "bottom"]), font: choice(t.font, "font", ["modern", "editorial", "mono"]), fontSize: number(t.fontSize, "Font size", 28, 160), style: choice(t.style, "title style", ["dark", "light", "outline"]), entrance: choice(t.entrance, "title entrance", ["none", ...animationPresets]), exit: choice(t.exit, "title exit", ["none", ...animationPresets]) } satisfies Title;
    });
    return { sourceClipId: text(s.sourceClipId, "Source clip id", 1, 120), inMs: number(s.inMs, "Trim start", 0, 3600000), outMs: number(s.outMs, "Trim end", 100, 3600000), fit: choice(s.fit, "fit", ["cover", "contain"]), device: choice(s.device, "device", ["none", ...deviceFrameDevices]), camera: choice(s.camera, "camera", cameras), position: choice(s.position, "position", ["center", "left", "right"]), transition: choice(s.transition, "transition", ["none", ...transitionKinds]), transitionDurationMs: number(s.transitionDurationMs, "Transition duration", 50, 2000), entrance: choice(s.entrance, "frame entrance", ["none", ...animationPresets.filter(p => p !== "typewriter")]), exit: choice(s.exit, "frame exit", ["none", ...animationPresets.filter(p => p !== "typewriter")]), titles } satisfies Shot;
  };
  const shots = plan.shots.map(normalizeShot);
  const scalar = (value: unknown, field: string, min: number, max: number) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid layer ${field}.`);
    return value;
  };
  const layers = ((plan.layers ?? []) as unknown[]).map(raw => {
    const input = object(raw);
    keys(input, [...Object.keys(layerProperties), "startMs", "x", "y", "scale", "rotateX", "rotateY", "rotateZ", "volume"]);
    const { startMs, x, y, scale, rotateX, rotateY, rotateZ, volume, ...shot } = input;
    if (shot.device === "none") throw new Error("Composition layers require a device frame.");
    return { ...normalizeShot({ ...shot, position: "center", transition: "none", transitionDurationMs: 400 }), startMs: number(startMs, "Layer start", 0, 59900), x: scalar(x, "x", 0, 1), y: scalar(y, "y", 0, 1), scale: scalar(scale, "scale", .25, 1.5), rotateX: scalar(rotateX, "rotation X", -60, 60), rotateY: scalar(rotateY, "rotation Y", -60, 60), rotateZ: scalar(rotateZ, "rotation Z", -180, 180), volume: scalar(volume, "volume", 0, 1) } satisfies CompositionLayer;
  });
  if (!shots.length && !layers.length) throw new Error("Compose at least one shot or device layer.");
  return { summary: text(plan.summary, "Summary", 1, 800), background: color(plan.background), backgroundEnd: color(plan.backgroundEnd), shots, layers };

}
function effect(preset: "none" | AnimationEffect["preset"], duration: number) {
  return preset === "none" ? undefined : { preset, durationMs: Math.max(50, Math.min(600, Math.floor(duration / 3))), easing: "ease-out" as const };
}
function frameFor(shot: Shot, plan: VideoCompositionPlan): DeviceFrame | undefined {
  if (shot.device === "none") {
    if (shot.camera !== "still" || shot.entrance !== "none" || shot.exit !== "none") throw new Error("Camera motion and frame animations require a device frame.");
    return undefined;
  }
  if (["fold", "unfold", "fold-cycle"].includes(shot.camera) && shot.device !== "iphone-duo") throw new Error("Folding requires an iPhone Duo frame.");
  const duration = shot.outMs - shot.inMs;
  const x = "x" in shot ? (shot as CompositionLayer).x : shot.position === "left" ? .34 : shot.position === "right" ? .66 : .5;
  const baseScale = "scale" in shot ? (shot as CompositionLayer).scale : 1;
  const keyframes: LayerKeyframe[] = [];
  if (shot.camera === "push-in" || shot.camera === "pull-back") {
    keyframes.push({ timeMs: 0, scale: Math.max(.25, Math.min(1.5, baseScale * (shot.camera === "push-in" ? .78 : 1.08))), easing: "ease-in-out" }, { timeMs: duration, scale: Math.max(.25, Math.min(1.5, baseScale * (shot.camera === "push-in" ? 1.08 : .78))) });
  } else if (shot.camera === "pan-left" || shot.camera === "pan-right") {
    const direction = shot.camera === "pan-left" ? 1 : -1;
    keyframes.push({ timeMs: 0, x: Math.max(0,Math.min(1,x + direction * .1)), rotateY: Math.max(-60,Math.min(60,("rotateY" in shot ? (shot as CompositionLayer).rotateY : 0) + direction * -15)), easing: "ease-in-out" }, { timeMs: duration, x: Math.max(0,Math.min(1,x - direction * .1)), rotateY: Math.max(-60,Math.min(60,("rotateY" in shot ? (shot as CompositionLayer).rotateY : 0) + direction * 15)) });
  }
  const motion = ["orbit", "float", "fold", "unfold", "fold-cycle"].includes(shot.camera) ? shot.camera as NonNullable<DeviceFrame["motion"]> : "none";
  return { device: shot.device, background: plan.background, backgroundEnd: plan.backgroundEnd, color: "#171717", x, y: "y" in shot ? (shot as CompositionLayer).y : .55, scale: "scale" in shot ? (shot as CompositionLayer).scale : .9, rotateX: "rotateX" in shot ? (shot as CompositionLayer).rotateX : 0, rotateY: "rotateY" in shot ? (shot as CompositionLayer).rotateY : 0, rotateZ: "rotateZ" in shot ? (shot as CompositionLayer).rotateZ : 0, motion, motionDurationMs: Math.max(500, Math.min(60000, duration)), motionEasing: "ease-in-out", animation: { entrance: effect(shot.entrance, duration), exit: effect(shot.exit, duration), ...(keyframes.length ? { keyframes } : {}) } };
}

/** Compile a bounded declarative plan into the same editable timeline as manual/MCP edits. */
export function compileVideoComposition(request: VideoCompositionRequest, rawPlan: unknown): VideoCompositionResult {
  const plan = normalizePlan(rawPlan);
  const sources = new Map([...request.timeline.clips, ...(request.timeline.layers ?? [])].map(clip => [clip.id, clip]));
  const warnings: string[] = [];
  const used = new Set<string>();
  const compileShot = (shot: Shot) => {
    const source = sources.get(shot.sourceClipId);
    if (!source) throw new Error("The composition referenced footage outside the selected clips.");
    if (shot.outMs - shot.inMs < 100 || shot.outMs - shot.inMs > 60000 || shot.inMs < source.inMs || shot.outMs > source.outMs || (source.kind === "video" && source.sourceDurationMs !== undefined && shot.outMs > source.sourceDurationMs)) throw new Error("A composition trim exceeds the selected footage range.");
    if (shot.titles.some(title => title.endMs <= title.startMs || title.endMs > shot.outMs - shot.inMs)) throw new Error("Title timing exceeds its shot.");
    if (used.has(source.sourceUrl)) warnings.push("The composition reuses selected footage in more than one shot.");
    used.add(source.sourceUrl);
    return { ...source, id: crypto.randomUUID(), inMs: shot.inMs, outMs: shot.outMs, fit: shot.fit, deviceFrame: frameFor(shot, plan), transition: shot.transition === "none" ? undefined : { kind: shot.transition, durationMs: shot.transitionDurationMs, easing: "ease-in-out" as const } };
  };
  const clips = plan.shots.map(compileShot);
  let timeline: VideoTimeline = { ...request.timeline, layers: [], background: { color: plan.background, endColor: plan.backgroundEnd }, clips, labels: [], coverMs: 0 };
  // Cut excess output on the overlap-aware clock; never stretch or fetch new footage.
  if (timelineDuration(timeline) > request.durationMs) {
    const schedule = clipSchedule(timeline);
    let keep = schedule.findIndex(entry => entry.endMs >= request.durationMs);
    while (keep > 0 && request.durationMs - schedule[keep].startMs < 100) keep--;
    timeline.clips = clips.slice(0, keep + 1);
    const last = timeline.clips[keep];
    // Recomputing the incoming half-duration cap can change the overlap. Solve
    // d - min(overlap, previous/2, d/2) = remaining on the previous end clock.
    const previous = timeline.clips[keep - 1];
    const remaining = request.durationMs - (schedule[keep - 1]?.endMs ?? 0);
    if (!previous || !last.transition) last.outMs = last.inMs + Math.max(100, remaining);
    else {
      const cap = Math.min(last.transition.durationMs, (previous.outMs - previous.inMs) / 2);
      const duration = remaining <= cap ? remaining * 2 : remaining + cap;
      if (duration >= 100) last.outMs = last.inMs + Math.min(last.outMs - last.inMs, duration);
      else { timeline.clips.pop(); }
    }
    warnings.push("The generated sequence was trimmed to the requested duration.");
  }
  const layerPlans: CompositionLayer[] = [];
  const layers: VideoLayer[] = [];
  for (const layer of plan.layers ?? []) {
    // Validate all authored source ranges before cutting excess timeline duration.
    const compiled = compileShot(layer);
    if (layer.startMs + 100 > request.durationMs) { warnings.push("Device layers beyond the requested duration were omitted."); continue; }
    const trimmed = { ...layer, outMs: Math.min(layer.outMs, layer.inMs + request.durationMs - layer.startMs) };
    if (trimmed.outMs !== layer.outMs) warnings.push("Device layers were trimmed to the requested duration.");
    const { transition: _ignored, ...media } = compiled;
    layers.push({ ...media, startMs: layer.startMs, outMs: trimmed.outMs, deviceFrame: frameFor(trimmed, plan), volume: layer.volume });
    layerPlans.push(trimmed);
  }
  if (!layers.length && !timeline.clips.length) throw new Error("No composition footage remains within the requested duration.");
  if (layers.length) timeline.layers = layers; else delete timeline.layers;
  const schedule = clipSchedule(timeline);
  const actualDuration = timelineDuration(timeline);
  const entries = [...schedule.map((entry,index) => ({...entry, shot:plan.shots[index], titleEnd:schedule[index+1]?.startMs ?? actualDuration})), ...layers.map((clip,index) => ({clip,startMs:clip.startMs,endMs:clip.startMs+clip.outMs-clip.inMs,shot:layerPlans[index],titleEnd:clip.startMs+clip.outMs-clip.inMs}))];
  for (const entry of entries) {
    const shot = entry.shot;
    // A trimmed shot still completes its authored camera move on its new clock.
    entry.clip.deviceFrame = frameFor({ ...shot, outMs: entry.clip.outMs }, plan);
    for (const title of shot.titles) {
      const startMs = entry.startMs + title.startMs;
      const endMs = Math.min(entry.startMs + title.endMs, entry.endMs, entry.titleEnd);
      if (endMs - startMs < 100) continue;
      const y = title.position === "top" ? .15 : title.position === "bottom" ? .84 : .5;
      const label: TimedVideoLabel = { id: crypto.randomUUID(), text: title.text, startMs, endMs, x: .5, y, width: .84, height: .1, fontSize: title.fontSize, font: title.font, style: title.style, textColor: title.style === "light" ? "#111111" : "#FFFFFF", background: title.style === "outline" ? "none" : title.style, backgroundColor: title.style === "light" ? "#FFFFFF" : "#000000", animation: { entrance: effect(title.entrance, endMs - startMs), exit: effect(title.exit, endMs - startMs) } };
      timeline.labels.push(label);
    }
  }
  if (Math.abs(actualDuration - request.durationMs) > 1) warnings.push(`The composition is ${(actualDuration / 1000).toFixed(2)}s; requested ${(request.durationMs / 1000).toFixed(2)}s. Adjust shots or provide more footage to match the duration.`);
  timeline = normalizeVideoTimeline(timeline);
  return { timeline, summary: plan.summary, warnings: [...new Set(warnings)], provider: "openai" };
}

export function videoComposerCatalog(available: boolean) {
  return { version: 1, available, provider: "openai" as const, endpoint: "/api/v1/videos/compose", previewOnly: true, limits: { promptCharacters: [10, 4000], productNameCharacters: 120, durationMs: [1000, 60000], shots: 12, deviceLayers: 12, titlesPerShot: 2, sampledSources: 4, thumbnailsPerSource: 2 }, parallelDeviceLayers: true, layerOrder: "Back-to-front layers above sequential clips; text labels are topmost. startMs is timeline time; inMs/outMs are source trims and animation is local to the layer.", cameraPresets: cameras, devices: ["none", ...deviceFrameDevices], transitions: ["none", ...transitionKinds], textAnimations: ["none", ...animationPresets], workflow: "Submit selected footage and a prompt. Review the returned editable timeline, then apply/save it separately. No rendering, persistence, or publishing occurs during composition.", grounding: "Only selected sourceClipId and trim ranges are allowed. Titles must follow the prompt or visible product evidence. Sampling limitations and duration mismatches return warnings." };
}
