import type { LayerAnimation, LayerKeyframe } from "@relay/core";

const recipe = <T extends string>(id: T, name: string, description: string, deviceOnly = false, requiresMesh = false, duoOnly = false) => ({ id, name, description, deviceOnly, requiresMesh, duoOnly });
/** Original Relay moves. Choosing a render mode never applies one; each recipe requires an explicit click. */
export const motionRecipes = [
  recipe("hold", "Still pose", "Keep the authored pose throughout the clip."),
  recipe("settle", "Quiet arrival", "Rise gently into the resting pose."),
  recipe("accent", "Accent beat", "A short scale accent, then settle."),
  recipe("drift", "Slow drift", "A measured horizontal move around the resting pose."),
  recipe("turn", "Turn & land", "A small rotation that lands at rest."),
  recipe("glide-left", "Glide from left", "Ease from the left toward the resting position."),
  recipe("glide-right", "Glide from right", "Ease from the right toward the resting position."),
  recipe("drop-land", "Drop & settle", "Descend, pass the resting height slightly, and settle."),
  recipe("scale-arrive", "Grow into place", "Fade in from a smaller scale."),
  recipe("pull-back", "Pull back", "Ease down from a closer view."),
  recipe("soft-pulse", "Soft pulse", "One gentle breathing accent around the resting scale."),
  recipe("double-pulse", "Double pulse", "Two compact scale accents."),
  recipe("breath", "Breathing pace", "A slow scale expansion and return."),
  recipe("float-up", "Vertical float", "Travel above and below the resting position."),
  recipe("diagonal-drift", "Diagonal drift", "Move diagonally, then return to the authored pose."),
  recipe("scan-across", "Across & back", "Pass across the canvas and return."),
  recipe("step-rise", "Two step rise", "Arrive with two measured upward movements."),
  recipe("overshoot-x", "Horizontal settle", "Slide past the resting position, then return."),
  recipe("arc-pass", "Arc passage", "Follow a shallow arc and land at rest."),
  recipe("pendulum", "Pendulum", "Swing gently through two opposing angles."),
  recipe("rock", "Small rock", "Two small orientation changes around the resting angle."),
  recipe("quarter-turn", "Quarter turn", "Turn through a partial revolution before settling."),
  recipe("tilt-peek", "Top edge peek", "Reveal the top edge through an explicit X tilt.", true, true),
  recipe("side-peek", "Side edge peek", "Reveal the side edge through an explicit Y tilt.", true, true),
  recipe("depth-pass", "Depth passage", "Move through scene depth and return.", true, true),
  recipe("orbit-left", "Left inspection", "Inspect the left side with a controlled camera-facing turn.", true, true),
  recipe("orbit-right", "Right inspection", "Inspect the right side with a controlled camera-facing turn.", true, true),
  recipe("fold-peek", "Hinge inspection", "Open the authored hinge slightly, then return.", true, false, true),
  recipe("unfold-arrive", "Open & settle", "Arrive from a partly folded pose.", true, false, true),
  recipe("spin-land", "Full turn & land", "Make one explicit full 3D turn and return to rest.", true, true),
] as const;
export type MotionRecipe = typeof motionRecipes[number]["id"];
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
/** Recipes become ordinary editable keys, with a final authored resting pose. */
export function compileMotionRecipe(recipe: MotionRecipe, durationMs: number, base: Partial<LayerKeyframe> = {}, target: "label" | "device" = "label"): LayerAnimation {
  if (!motionRecipes.some(item => item.id === recipe)) throw new Error("Choose a Relay motion recipe.");
  if (!Number.isFinite(durationMs) || durationMs < 1 || durationMs > 900000) throw new Error("Motion needs a duration between 1 and 900000 ms.");
  const rest = { x: base.x ?? .5, y: base.y ?? (target === "device" ? .5 : .2), scale: base.scale ?? 1, rotateZ: base.rotateZ ?? 0, opacity: base.opacity ?? 1,
    ...(target === "device" ? { rotateX: base.rotateX ?? 0, rotateY: base.rotateY ?? 0, ...(base.depth === undefined && recipe !== "depth-pass" ? {} : { depth: base.depth ?? 0 }), ...(base.foldAngle === undefined ? {} : { foldAngle: base.foldAngle }) } : {}) };
  const scale = (factor: number) => clamp(rest.scale * factor, target === "device" ? .25 : .1, target === "device" ? 1.5 : 3);
  const x = (amount: number) => clamp(rest.x + amount, 0, 1), y = (amount: number) => clamp(rest.y + amount, 0, 1);
  const z = (amount: number) => clamp(rest.rotateZ + amount, -180, 180);
  const tiltX = (amount: number) => target === "device" ? { rotateX: clamp((rest.rotateX ?? 0) + amount, -1080, 1080) } : {};
  const tiltY = (amount: number) => target === "device" ? { rotateY: clamp((rest.rotateY ?? 0) + amount, -1080, 1080) } : {};
  const fold = (amount: number) => target === "device" && rest.foldAngle !== undefined ? { foldAngle: clamp(rest.foldAngle + amount, 0, 165) } : {};
  const depth = (amount: number) => target === "device" ? { depth: clamp((rest.depth ?? 0) + amount, -2, 2) } : {};
  const moves: Record<MotionRecipe, Array<[number, Partial<LayerKeyframe>]>> = {
    hold: [[0, {}]],
    settle: [[0, { y: y(.09), opacity: 0 }], [.24, {}]],
    accent: [[0, {}], [.32, { scale: scale(1.13) }], [.53, {}]],
    drift: [[0, { x: x(-.045) }], [.65, { x: x(.045) }]],
    turn: [[0, { rotateZ: z(-9), scale: scale(.92), opacity: 0 }], [.3, {}]],
    "glide-left": [[0, { x: x(-.14), opacity: 0 }], [.3, {}]],
    "glide-right": [[0, { x: x(.14), opacity: 0 }], [.3, {}]],
    "drop-land": [[0, { y: y(-.12), opacity: 0 }], [.25, { y: y(.015) }], [.4, {}]],
    "scale-arrive": [[0, { scale: scale(.72), opacity: 0 }], [.3, {}]],
    "pull-back": [[0, { scale: scale(1.18), opacity: 0 }], [.35, {}]],
    "soft-pulse": [[0, {}], [.42, { scale: scale(1.07) }], [.7, {}]],
    "double-pulse": [[0, {}], [.2, { scale: scale(1.08) }], [.36, {}], [.54, { scale: scale(1.08) }], [.72, {}]],
    breath: [[0, {}], [.5, { scale: scale(1.045) }]],
    "float-up": [[0, {}], [.28, { y: y(-.04) }], [.72, { y: y(.025) }]],
    "diagonal-drift": [[0, {}], [.6, { x: x(.06), y: y(-.045) }]],
    "scan-across": [[0, {}], [.35, { x: x(-.085) }], [.7, { x: x(.085) }]],
    "step-rise": [[0, { y: y(.1), opacity: 0 }], [.2, { y: y(.04) }], [.5, {}]],
    "overshoot-x": [[0, { x: x(-.12), opacity: 0 }], [.3, { x: x(.02) }], [.45, {}]],
    "arc-pass": [[0, { x: x(-.09), y: y(.045) }], [.4, { y: y(-.06) }], [.72, { x: x(.065), y: y(-.02) }]],
    pendulum: [[0, {}], [.3, { rotateZ: z(-8) }], [.7, { rotateZ: z(8) }]],
    rock: [[0, {}], [.25, { rotateZ: z(-4) }], [.5, { rotateZ: z(4) }], [.75, {}]],
    "quarter-turn": [[0, { rotateZ: z(-65), opacity: 0 }], [.45, {}]],
    "tilt-peek": [[0, {}], [.4, tiltX(-24)], [.75, tiltX(10)]],
    "side-peek": [[0, {}], [.4, tiltY(-35)], [.75, tiltY(12)]],
    "depth-pass": [[0, {}], [.5, depth(.45)]],
    "orbit-left": [[0, {}], [.28, { ...tiltY(-80), x: x(-.04) }], [.55, { ...tiltY(-150), x: x(.025) }], [.8, tiltY(-40)]],
    "orbit-right": [[0, {}], [.28, { ...tiltY(80), x: x(.04) }], [.55, { ...tiltY(150), x: x(-.025) }], [.8, tiltY(40)]],
    "fold-peek": [[0, {}], [.5, fold(50)]],
    "unfold-arrive": [[0, { ...fold(70), opacity: 0 }], [.4, {}]],
    "spin-land": [[0, {}], [.28, tiltY(100)], [.56, tiltY(240)], [.85, tiltY(360)]],
  };
  // A device's hold never gets extra depth keys. A full turn ends at the equivalent orientation, avoiding a reverse spin.
  const points = [...moves[recipe], [1, recipe === "spin-land" ? tiltY(360) : {}] as [number, Partial<LayerKeyframe>]];
  const keyframes = points.map(([fraction, pose]) => ({ timeMs: fraction * durationMs, ...rest, ...pose, easing: "ease-in-out" as const }));
  return { scaleMode: "perceptual", keyframes };
}
/** Retiming preserves poses and departing curves, including fractional-time tracks. */
export function retimeMotion<T extends { timeMs: number }>(frames: T[], oldDurationMs: number, newDurationMs: number): T[] {
  if (!Number.isFinite(oldDurationMs) || !Number.isFinite(newDurationMs) || oldDurationMs <= 0 || newDurationMs <= 0) throw new Error("Retiming needs positive, finite durations.");
  return frames.map(frame => ({ ...frame, timeMs: frame.timeMs / oldDurationMs * newDurationMs }));
}
