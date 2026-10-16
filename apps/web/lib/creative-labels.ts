import type { CreativeLabel, LabelFont, LabelStylePreset, SlideshowTextBackground } from "@relay/core";
import { labelGraphemes, labelWords, measureLabelText, type FontSettings } from "./label-font-metrics.ts";

export interface LabelTypography extends FontSettings {
  textAlign?: "left" | "center" | "right"; lineHeight?: number;
  strokeColor?: string; strokeWidth?: number;
  shadowColor?: string; shadowBlur?: number; shadowX?: number; shadowY?: number;
  backgroundOpacity?: number; backgroundRadius?: number; padding?: number;
  sceneLayer?: "overlay" | "scene" | "back"; sceneDepth?: number;
}

export const labelFonts: Record<LabelFont, { name: string; css: string; svg: string }> = {
  modern: { name: "Modern", css: '"DejaVu Sans", sans-serif', svg: "DejaVu Sans,Arial,sans-serif" },
  editorial: { name: "Editorial", css: '"DejaVu Serif", Georgia, serif', svg: "DejaVu Serif,Georgia,serif" },
  mono: { name: "Mono", css: '"DejaVu Sans Mono", monospace', svg: "DejaVu Sans Mono,monospace" },
};

export const labelPresets: Record<LabelStylePreset, { name: string; textColor: string; background: SlideshowTextBackground; backgroundColor: string }> = {
  dark: { name: "Black / white", textColor: "#FFFFFF", background: "dark", backgroundColor: "#000000" },
  light: { name: "White / black", textColor: "#111111", background: "light", backgroundColor: "#FFFFFF" },
  outline: { name: "White / clear", textColor: "#FFFFFF", background: "none", backgroundColor: "#000000" },
};

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));
const color = (value: unknown, fallback: string) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : fallback;

export function wrapCreativeLabel(value: string, fontSize: number, width: number, typography: LabelTypography = {}): string[] {
  const limit = Math.max(1, width);
  const fits = (text: string) => measureLabelText(text, fontSize, typography).width <= limit;
  const lines: string[] = [];
  for (const paragraph of value.split(/\n/)) {
    let current = "";
    for (const word of labelWords(paragraph.trim().replace(/\s+/g, " "))) {
      if (current && !fits(current + word.trimEnd())) { lines.push(current.trimEnd()); current = ""; }
      for (const grapheme of labelGraphemes(word)) {
        if (current && !fits(current + grapheme)) { lines.push(current.trimEnd()); current = ""; }
        if (!current && /^\s+$/u.test(grapheme)) continue;
        current += grapheme;
      }
    }
    lines.push(current.trimEnd());
  }
  return lines.slice(0, 10);
}

export function creativeLabelHeight(label: Pick<CreativeLabel, "text" | "width" | "height" | "fontSize"> & LabelTypography, canvasWidth = 1080, canvasHeight = 1920): number {
  const boxWidth = Math.round(canvasWidth * label.width);
  const lines = wrapCreativeLabel(label.text, label.fontSize, boxWidth - (label.padding ?? 35) * 2, label);
  const minimum = Math.round(canvasHeight * (label.height ?? .12));
  const content = Math.round(lines.length * label.fontSize * (label.lineHeight ?? 1.16) + Math.max(label.fontSize, (label.padding ?? 35) * 2));
  return Math.min(Math.round(canvasHeight * .88), Math.max(minimum, content));
}

/** Shared with the timeline normalizer; omitted settings retain the original label style. */
export function normalizeLabelTypography(input: Record<string, unknown>): LabelTypography {
  const result: LabelTypography = {};
  for (const [key, minimum, maximum] of [["letterSpacing", -10, 40], ["lineHeight", .8, 2], ["strokeWidth", 0, 16], ["shadowBlur", 0, 40], ["shadowX", -40, 40], ["shadowY", -40, 40], ["backgroundOpacity", 0, 1], ["backgroundRadius", 0, 80], ["padding", 0, 100], ["sceneDepth", -2, 2]] as const) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== "number" || !Number.isFinite(input[key])) throw new Error(`Label ${key} must be a finite number.`);
    result[key] = clamp(input[key] as number, minimum, maximum);
  }
  if (input.fontWeight !== undefined) { if (![400, 700, 800].includes(input.fontWeight as number)) throw new Error("Choose regular, bold, or heavy label weight."); result.fontWeight = input.fontWeight as LabelTypography["fontWeight"]; }
  if (input.textAlign !== undefined) { if (!["left", "center", "right"].includes(input.textAlign as string)) throw new Error("Choose left, center, or right text alignment."); result.textAlign = input.textAlign as LabelTypography["textAlign"]; }
  for (const key of ["italic", "kerning"] as const) if (input[key] !== undefined) { if (typeof input[key] !== "boolean") throw new Error(`Label ${key} must be a boolean.`); result[key] = input[key]; }
  for (const key of ["strokeColor", "shadowColor"] as const) if (input[key] !== undefined) { if (typeof input[key] !== "string" || !/^#[0-9a-f]{6}$/i.test(input[key] as string)) throw new Error(`Choose a valid label ${key}.`); result[key] = (input[key] as string).toUpperCase(); }
  if (input.sceneLayer !== undefined) { if (!["overlay", "scene", "back"].includes(input.sceneLayer as string)) throw new Error("Choose a supported text scene layer."); result.sceneLayer = input.sceneLayer as LabelTypography["sceneLayer"]; }
  return result;
}

export function normalizeCreativeLabels(value: unknown): CreativeLabel[] | null {
  if (!Array.isArray(value) || value.length > 12) return null;
  const labels: CreativeLabel[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const input = candidate as Record<string, unknown>;
    const text = typeof input.text === "string" ? input.text.trim().slice(0, 500) : "";
    if (!text) continue;
    const style: LabelStylePreset = input.style === "light" || input.style === "outline" ? input.style : "dark";
    const preset = labelPresets[style];
    labels.push({
      id: typeof input.id === "string" && /^[a-zA-Z0-9_-]{1,120}$/.test(input.id) ? input.id : crypto.randomUUID(),
      text,
      x: clamp(Number(input.x) || .5, .08, .92),
      y: clamp(Number(input.y) || .18, .06, .94),
      width: clamp(Number(input.width) || .82, .25, .92),
      height: clamp(Number(input.height) || .12, .06, .35),
      fontSize: Math.round(clamp(Number(input.fontSize) || 72, 28, 160)),
      font: input.font === "editorial" || input.font === "mono" ? input.font : "modern",
      textColor: color(input.textColor, preset.textColor),
      background: input.background === "dark" || input.background === "light" || input.background === "none" ? input.background : preset.background,
      backgroundColor: color(input.backgroundColor, preset.backgroundColor),
      style,
      ...normalizeLabelTypography(input),
    });
  }
  return labels;
}

export function presetChanges(style: LabelStylePreset): Pick<CreativeLabel, "style" | "textColor" | "background" | "backgroundColor"> {
  return { style, textColor: labelPresets[style].textColor, background: labelPresets[style].background, backgroundColor: labelPresets[style].backgroundColor };
}
