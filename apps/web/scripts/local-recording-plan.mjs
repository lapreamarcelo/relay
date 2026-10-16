export function normalizeRecordingPlan(value) {
  if (!value || typeof value !== "object") throw new Error("Use a recording plan object.");
  const number = (input, min, max, label) => {
    if (typeof input !== "number" || !Number.isFinite(input) || input < min || input > max) throw new Error(`Invalid ${label}.`);
    return input;
  };
  const width = number(value.width, 1, 10000, "logical screen width");
  const height = number(value.height, 1, 10000, "logical screen height");
  const durationMs = number(value.durationMs, 100, 300000, "duration");
  if (!Array.isArray(value.steps) || value.steps.length > 500) throw new Error("Use up to 500 gesture steps.");
  let lastEnd = 0, eventCount = 0;
  const point = value => {
    if (!value || typeof value !== "object") throw new Error("Use a normalized gesture point.");
    return { x: number(value.x, 0, 1, "point x"), y: number(value.y, 0, 1, "point y") };
  };
  const steps = value.steps.map(step => {
    if (!step || !["tap", "swipe"].includes(step.kind)) throw new Error("Choose tap or swipe.");
    const timeMs = number(step.timeMs, lastEnd, durationMs, "ordered gesture time");
    const from = point(step.from);
    const gestureDurationMs = step.kind === "swipe" ? number(step.durationMs, 100, 10000, "swipe duration") : 100;
    if (timeMs + gestureDurationMs > durationMs) throw new Error("A gesture extends beyond the recording.");
    lastEnd = timeMs + gestureDurationMs;
    eventCount += step.kind === "tap" ? 2 : Math.ceil(gestureDurationMs / 100) + 1;
    if (eventCount > 2000) throw new Error("Use up to 2000 gesture samples.");
    return { kind: step.kind, timeMs, from, ...(step.kind === "swipe" ? { to: point(step.to), durationMs: gestureDurationMs } : {}) };
  });
  return { width, height, durationMs, steps };
}

export function axeGestureArguments(step, plan, udid) {
  const x = point => String(Math.round(point.x * (plan.width - 1))), y = point => String(Math.round(point.y * (plan.height - 1)));
  return step.kind === "tap"
    ? ["tap", "-x", x(step.from), "-y", y(step.from), "--udid", udid]
    : ["swipe", "--start-x", x(step.from), "--start-y", y(step.from), "--end-x", x(step.to), "--end-y", y(step.to), "--duration", String(step.durationMs / 1000), "--udid", udid];
}

/** Sidecar marks issued AXE commands; coordinates and dispatch times are measured,
 * while intermediate swipe positions are linear approximations, not OS telemetry. */
export function gestureSamples(step, actualTimeMs) {
  if (step.kind === "tap") return [
    { kind: "down", ...step.from, timeMs: Math.round(actualTimeMs) },
    { kind: "up", ...step.from, timeMs: Math.round(actualTimeMs + 100) },
  ];
  const count = Math.ceil(step.durationMs / 100);
  return Array.from({ length: count + 1 }, (_, index) => {
    const progress = index / count;
    return { kind: index === 0 ? "down" : index === count ? "up" : "move", x: step.from.x + (step.to.x - step.from.x) * progress, y: step.from.y + (step.to.y - step.from.y) * progress, timeMs: Math.round(actualTimeMs + step.durationMs * progress) };
  });
}
