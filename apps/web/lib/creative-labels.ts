import type { CreativeLabel, LabelFont, LabelStylePreset, SlideshowTextBackground } from "@relay/core";

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
    });
  }
  return labels;
}

export function presetChanges(style: LabelStylePreset): Pick<CreativeLabel, "style" | "textColor" | "background" | "backgroundColor"> {
  return { style, textColor: labelPresets[style].textColor, background: labelPresets[style].background, backgroundColor: labelPresets[style].backgroundColor };
}
