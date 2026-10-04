import type { DeviceFrame } from "@relay/core";
import { normalizeAnimationEasing, normalizeLayerAnimation } from "./video-animation.ts";

export const defaultDeviceFrame: DeviceFrame = {
  device: "phone",
  background: "#E8E2D8",
  color: "#171717",
};

export interface DeviceFrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}

export interface DeviceFrameGeometry {
  canvas: { width: number; height: number };
  outer: DeviceFrameRect;
  screen: DeviceFrameRect;
  border: number;
  browserHeader: number;
  shadow: { y: number; blur: number; opacity: number };
}

function hex(value: unknown): string {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error("Device frame colors must be six-digit hex colors.");
  return value.toUpperCase();
}

export const deviceFrameDevices = ["phone", "tablet", "browser", "iphone", "iphone-duo", "mac", "watch", "android"] as const;
export const deviceFrameMotions = ["none", "orbit", "float", "fold", "unfold", "fold-cycle"] as const;

export function normalizeDeviceFrame(value: unknown, options: { allowMotion?: boolean } = {}): DeviceFrame | undefined {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Device frame settings must be an object.");
  const input = value as Record<string, unknown>;
  if (!deviceFrameDevices.includes(input.device as DeviceFrame["device"])) throw new Error(`Device frame must be ${deviceFrameDevices.join(", ")}.`);
  const result: DeviceFrame = { device: input.device as DeviceFrame["device"], background: hex(input.background), color: hex(input.color) };
  if (input.backgroundEnd !== undefined) result.backgroundEnd = hex(input.backgroundEnd);
  const ranges = { x: [0, 1, .5], y: [0, 1, .5], scale: [.25, 1.5, 1], rotateX: [-60, 60, 0], rotateY: [-60, 60, 0], rotateZ: [-180, 180, 0], foldAngle: [0, 165, 0], motionDurationMs: [500, 60000, 4000] } as const;
  for (const key of Object.keys(ranges) as Array<keyof typeof ranges>) {
    if (input[key] === undefined) continue;
    const [min, max, fallback] = ranges[key], value = input[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`Device frame ${key} must be between ${min} and ${max}.`);
    if (!options.allowMotion && value !== fallback) throw new Error("Device position, rotation, and motion are supported in video timelines only.");
    result[key] = value;
  }
  if (input.motion !== undefined) {
    if (!deviceFrameMotions.includes(input.motion as NonNullable<DeviceFrame["motion"]>)) throw new Error("Choose a supported device motion preset.");
    if (!options.allowMotion && input.motion !== "none") throw new Error("Device motion is supported in video timelines only.");
    result.motion = input.motion as DeviceFrame["motion"];
  }
  if (input.motionEasing !== undefined) {
    if (!options.allowMotion) throw new Error("Animation easing is supported in video timelines only.");
    result.motionEasing = normalizeAnimationEasing(input.motionEasing);
  }
  if (input.animation !== undefined) {
    if (!options.allowMotion) throw new Error("Layer animation is supported in video timelines only.");
    result.animation = normalizeLayerAnimation(input.animation, "device", result.device === "iphone-duo");
  }
  if (result.device !== "iphone-duo" && ((result.foldAngle ?? 0) !== 0 || ["fold", "unfold", "fold-cycle"].includes(result.motion ?? "none"))) throw new Error("Folding requires the iPhone Duo frame.");
  return result;
}

export function deviceBackgroundCss(frame: Pick<DeviceFrame, "background" | "backgroundEnd">): string {
  return frame.backgroundEnd ? `linear-gradient(135deg, ${frame.background}, ${frame.backgroundEnd})` : frame.background;
}

export function deviceBackgroundSvg(width: number, height: number, color: string, endColor?: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs>${backgroundGradient(width, height, hex(color), hex(endColor ?? color))}</defs><rect width="100%" height="100%" fill="url(#background)"/></svg>`;
}

// Match CSS linear-gradient(135deg) even on non-square canvases.
function backgroundGradient(width: number, height: number, color: string, endColor: string): string {
  return `<linearGradient id="background" gradientUnits="userSpaceOnUse" x1="${(width - height) / 4}" y1="${(height - width) / 4}" x2="${(3 * width + height) / 4}" y2="${(width + 3 * height) / 4}"><stop stop-color="${color}"/><stop offset="1" stop-color="${endColor}"/></linearGradient>`;
}

const rounded = (value: number) => Math.max(1, Math.round(value));

export function deviceFrameGeometry(width: number, height: number, device: DeviceFrame["device"]): DeviceFrameGeometry {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) throw new Error("Device frame dimensions must be positive.");
  let outerWidth: number;
  let outerHeight: number;
  let border: number;
  let browserHeader = 0;
  let outerRadius: number;

  if (device === "phone" || device === "iphone" || device === "android") {
    outerWidth = Math.min(width * .68, height * .84 * 9 / 19.5);
    outerHeight = outerWidth * 19.5 / 9;
    border = Math.max(4, outerWidth * .035);
    outerRadius = outerWidth * .13;
  } else if (device === "tablet") {
    outerWidth = Math.min(width * .78, height * .82 * 3 / 4);
    outerHeight = outerWidth * 4 / 3;
    border = Math.max(4, outerWidth * .035);
    outerRadius = outerWidth * .06;
  } else if (device === "iphone-duo") {
    outerWidth = Math.min(width * .82, height * .68 * 1.12);
    outerHeight = outerWidth / 1.12;
    border = Math.max(4, outerWidth * .025);
    outerRadius = outerWidth * .055;
  } else if (device === "watch") {
    outerWidth = Math.min(width * .56, height * .62 * .83);
    outerHeight = outerWidth / .83;
    border = Math.max(4, outerWidth * .08);
    outerRadius = outerWidth * .24;
  } else {
    outerWidth = Math.min(width * .88, height * .72 * 16 / 10);
    outerHeight = outerWidth * 10 / 16;
    border = Math.max(3, outerWidth * (device === "mac" ? .025 : .006));
    browserHeader = device === "browser" ? Math.max(18, outerWidth * .075) : 0;
    outerRadius = outerWidth * .025;
  }

  const outer: DeviceFrameRect = {
    x: rounded((width - outerWidth) / 2),
    y: rounded((height - outerHeight) / 2),
    width: device === "iphone-duo" ? Math.max(2, Math.round(outerWidth / 2) * 2) : rounded(outerWidth),
    height: rounded(outerHeight),
    radius: rounded(outerRadius),
  };
  const inset = rounded(border);
  const header = rounded(browserHeader);
  const screen: DeviceFrameRect = {
    x: outer.x + inset,
    y: outer.y + (device === "browser" ? header : inset),
    width: outer.width - inset * 2,
    height: outer.height - (device === "browser" ? header + inset : inset * 2),
    radius: device === "browser" ? rounded(outer.radius * .18) : rounded(Math.max(2, outer.radius - inset)),
  };
  return {
    canvas: { width: Math.round(width), height: Math.round(height) },
    outer,
    screen,
    border: inset,
    browserHeader: device === "browser" ? header : 0,
    shadow: { y: rounded(Math.min(width, height) * .018), blur: rounded(Math.min(width, height) * .035), opacity: .28 },
  };
}

/** Transparent device layer used by both the projected preview and video export. */
export function deviceFrameLayerSvg(width: number, height: number, frame: DeviceFrame): string {
  return frameSvg(width, height, frame, false);
}

export function deviceFrameSvg(width: number, height: number, frame: DeviceFrame): string {
  return frameSvg(width, height, frame, true);
}

function frameSvg(width: number, height: number, frame: DeviceFrame, includeBackground: boolean): string {
  const geometry = deviceFrameGeometry(width, height, frame.device);
  const { outer, screen, shadow } = geometry;
  const decoration = frame.device === "phone" || frame.device === "iphone"
    ? `<rect x="${outer.x + outer.width * .38}" y="${outer.y + geometry.border * .7}" width="${outer.width * .24}" height="${Math.max(4, geometry.border * .38)}" rx="${Math.max(2, geometry.border * .2)}" fill="#050505"/>`
    : frame.device === "iphone-duo"
      ? `<rect x="${outer.x + outer.width / 2 - 1}" y="${outer.y + geometry.border}" width="2" height="${outer.height - geometry.border * 2}" fill="${frame.color}" opacity=".35"/>`
      : frame.device === "browser"
      ? ["#FF5F57", "#FEBC2E", "#28C840"].map((fill, index) => `<circle cx="${outer.x + geometry.browserHeader * (.38 + index * .34)}" cy="${outer.y + geometry.browserHeader / 2}" r="${Math.max(3, geometry.browserHeader * .09)}" fill="${fill}"/>`).join("")
      : `<circle cx="${outer.x + outer.width / 2}" cy="${outer.y + geometry.border / 2}" r="${Math.max(2, geometry.border * .12)}" fill="#050505"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${geometry.canvas.width}" height="${geometry.canvas.height}" viewBox="0 0 ${geometry.canvas.width} ${geometry.canvas.height}">
    <defs>
      <filter id="shadow" x="-40%" y="-40%" width="180%" height="200%"><feDropShadow dx="0" dy="${shadow.y}" stdDeviation="${shadow.blur}" flood-color="#000000" flood-opacity="${shadow.opacity}"/></filter>
      ${backgroundGradient(width, height, frame.background, frame.backgroundEnd ?? frame.background)}
      <mask id="screen-cutout"><rect width="100%" height="100%" fill="#fff"/><rect x="${screen.x}" y="${screen.y}" width="${screen.width}" height="${screen.height}" rx="${screen.radius}" fill="#000"/></mask>
    </defs>
    <g mask="url(#screen-cutout)">
      ${includeBackground ? `<rect width="100%" height="100%" fill="url(#background)"/><rect x="${outer.x}" y="${outer.y}" width="${outer.width}" height="${outer.height}" rx="${outer.radius}" fill="${frame.color}" filter="url(#shadow)"/>` : ""}
      <rect x="${outer.x}" y="${outer.y}" width="${outer.width}" height="${outer.height}" rx="${outer.radius}" fill="${frame.color}"/>
    </g>
    ${decoration}
  </svg>`;
}
