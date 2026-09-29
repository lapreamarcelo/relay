import type { DeviceFrame } from "@relay/core";

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

export function normalizeDeviceFrame(value: unknown): DeviceFrame | undefined {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Device frame settings must be an object.");
  const input = value as Record<string, unknown>;
  if (input.device !== "phone" && input.device !== "tablet" && input.device !== "browser") throw new Error("Device frame must be phone, tablet, or browser.");
  return { device: input.device, background: hex(input.background), color: hex(input.color) };
}

const rounded = (value: number) => Math.max(1, Math.round(value));

export function deviceFrameGeometry(width: number, height: number, device: DeviceFrame["device"]): DeviceFrameGeometry {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) throw new Error("Device frame dimensions must be positive.");
  let outerWidth: number;
  let outerHeight: number;
  let border: number;
  let browserHeader = 0;
  let outerRadius: number;

  if (device === "phone") {
    outerWidth = Math.min(width * .68, height * .84 * 9 / 19.5);
    outerHeight = outerWidth * 19.5 / 9;
    border = Math.max(4, outerWidth * .035);
    outerRadius = outerWidth * .13;
  } else if (device === "tablet") {
    outerWidth = Math.min(width * .78, height * .82 * 3 / 4);
    outerHeight = outerWidth * 4 / 3;
    border = Math.max(4, outerWidth * .035);
    outerRadius = outerWidth * .06;
  } else {
    outerWidth = Math.min(width * .88, height * .72 * 16 / 10);
    outerHeight = outerWidth * 10 / 16;
    border = Math.max(3, outerWidth * .006);
    browserHeader = Math.max(18, outerWidth * .075);
    outerRadius = outerWidth * .025;
  }

  const outer: DeviceFrameRect = {
    x: rounded((width - outerWidth) / 2),
    y: rounded((height - outerHeight) / 2),
    width: rounded(outerWidth),
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

export function deviceFrameSvg(width: number, height: number, frame: DeviceFrame): string {
  const geometry = deviceFrameGeometry(width, height, frame.device);
  const { outer, screen, shadow } = geometry;
  const decoration = frame.device === "phone"
    ? `<rect x="${outer.x + outer.width * .38}" y="${outer.y + geometry.border * .7}" width="${outer.width * .24}" height="${Math.max(4, geometry.border * .38)}" rx="${Math.max(2, geometry.border * .2)}" fill="#050505"/>`
    : frame.device === "browser"
      ? ["#FF5F57", "#FEBC2E", "#28C840"].map((fill, index) => `<circle cx="${outer.x + geometry.browserHeader * (.38 + index * .34)}" cy="${outer.y + geometry.browserHeader / 2}" r="${Math.max(3, geometry.browserHeader * .09)}" fill="${fill}"/>`).join("")
      : `<circle cx="${outer.x + outer.width / 2}" cy="${outer.y + geometry.border / 2}" r="${Math.max(2, geometry.border * .12)}" fill="#050505"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${geometry.canvas.width}" height="${geometry.canvas.height}" viewBox="0 0 ${geometry.canvas.width} ${geometry.canvas.height}">
    <defs>
      <filter id="shadow" x="-40%" y="-40%" width="180%" height="200%"><feDropShadow dx="0" dy="${shadow.y}" stdDeviation="${shadow.blur}" flood-color="#000000" flood-opacity="${shadow.opacity}"/></filter>
      <mask id="screen-cutout"><rect width="100%" height="100%" fill="#fff"/><rect x="${screen.x}" y="${screen.y}" width="${screen.width}" height="${screen.height}" rx="${screen.radius}" fill="#000"/></mask>
    </defs>
    <g mask="url(#screen-cutout)">
      <rect width="100%" height="100%" fill="${frame.background}"/>
      <rect x="${outer.x}" y="${outer.y}" width="${outer.width}" height="${outer.height}" rx="${outer.radius}" fill="${frame.color}" filter="url(#shadow)"/>
      <rect x="${outer.x}" y="${outer.y}" width="${outer.width}" height="${outer.height}" rx="${outer.radius}" fill="${frame.color}"/>
    </g>
    ${decoration}
  </svg>`;
}
