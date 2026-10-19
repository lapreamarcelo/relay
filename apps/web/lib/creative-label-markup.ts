import type { CreativeLabel } from "@relay/core";
import { creativeLabelHeight, wrapCreativeLabel, type LabelTypography } from "./creative-labels.ts";
import { labelGlyphEndAt, labelGraphemes, measureLabelText, type MeasuredText } from "./label-font-metrics.ts";
import { labelEmoji } from "./label-emoji.ts";

export const escapeLabelXml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
/** Editable DOM titles use the same local emoji artwork as SVG exports. */
export function labelTextMarkup(text: string): string {
  return labelGraphemes(text).map(grapheme => {
    const emoji = labelEmoji(grapheme);
    return emoji ? emoji.svg.replace("<svg ", `<svg data-label-emoji="${emoji.id}" role="img" aria-label="${escapeLabelXml(grapheme)}" style="display:inline-block;width:1em;height:1em;vertical-align:-0.15em;stroke-width:1" `) : escapeLabelXml(grapheme);
  }).join("");
}
export type StyledLabel = CreativeLabel & LabelTypography;
export interface LabelLine { text: string; x: number; baseline: number; measured: MeasuredText }
export function creativeLabelLayout(label: StyledLabel, width = 1080, height = 1920) {
  const boxWidth = Math.round(width * label.width), boxHeight = creativeLabelHeight(label, width, height);
  const left = Math.round(width * label.x - boxWidth / 2), top = Math.round(height * label.y - boxHeight / 2), padding = label.padding ?? 35;
  const lineHeight = label.fontSize * (label.lineHeight ?? 1.16);
  const strings = wrapCreativeLabel(label.text, label.fontSize, boxWidth - padding * 2, label);
  const firstBaseline = top + Math.round((boxHeight - strings.length * lineHeight) / 2) + label.fontSize;
  const lines: LabelLine[] = strings.map((text, index) => {
    const measured = measureLabelText(text, label.fontSize, label);
    const x = label.textAlign === "left" ? left + padding : label.textAlign === "right" ? left + boxWidth - padding - measured.width : width * label.x - measured.width / 2;
    return { text, x, baseline: firstBaseline + index * lineHeight, measured };
  });
  return { boxWidth, boxHeight, left, top, padding, lineHeight, lines };
}
export function labelBackgroundMarkup(label: StyledLabel, layout: ReturnType<typeof creativeLabelLayout>, id: string): string {
  const { left, top, boxWidth, boxHeight } = layout, radius = label.backgroundRadius ?? 28;
  const rect = `x="${left}" y="${top}" width="${boxWidth}" height="${boxHeight}" rx="${radius}"`;
  const fill = label.background === "none" ? "none" : label.backgroundColor ?? (label.background === "dark" ? "#000000" : "#FFFFFF");
  return `<clipPath id="${id}"><rect ${rect}/></clipPath><rect ${rect} fill="${fill}" opacity="${label.backgroundOpacity ?? 1}"/>`;
}
export function labelShadowMarkup(label: StyledLabel, id: string): string {
  if (!(label.shadowBlur || label.shadowX || label.shadowY)) return "";
  return `<filter id="${id}" x="-100%" y="-100%" width="300%" height="300%" color-interpolation-filters="sRGB"><feDropShadow dx="${label.shadowX ?? 0}" dy="${label.shadowY ?? 0}" stdDeviation="${(label.shadowBlur ?? 0) / 2}" flood-color="${label.shadowColor ?? "#000000"}" flood-opacity="0.7"/></filter>`;
}
export function labelGlyphMarkup(label: StyledLabel, measured: MeasuredText, glyphStart = 0, glyphEnd = measured.glyphs.length): string {
  const scale = label.fontSize / measured.units;
  const stroke = label.strokeColor ?? (label.background === "none" ? "#10110F" : "none"), strokeWidth = label.strokeWidth ?? (label.background === "none" ? 7 : 0);
  return measured.glyphs.slice(glyphStart, glyphEnd).map(glyph => glyph.emoji
    ? glyph.emoji.svg.replace("<svg ", `<svg data-label-emoji="${glyph.emoji.id}" x="${glyph.x}" y="${-label.fontSize * .85}" width="${label.fontSize}" height="${label.fontSize}" style="width:${label.fontSize}px;height:${label.fontSize}px;stroke-width:1" `)
    : glyph.path ? `<path d="${glyph.path}" transform="translate(${glyph.x} 0) scale(${scale})${label.italic ? " skewX(-12)" : ""}" fill="${label.textColor}" stroke="${stroke}" stroke-width="${strokeWidth}" vector-effect="non-scaling-stroke" paint-order="stroke"/>` : "").join("");
}
/** Glyph paths make browser preview, GPU textures and Sharp export independent of host font installation. */
export function creativeLabelsMarkup(labels: StyledLabel[], width = 1080, height = 1920, options: { reveal?: number; idPrefix?: string } = {}): string {
  const elements = labels.map((label, index) => {
    const layout = creativeLabelLayout(label, width, height), id = `${options.idPrefix ?? "label"}-${index}`;
    const total = layout.lines.reduce((count, line) => count + labelGraphemes(line.text).length, 0);
    let remaining = Math.ceil(total * (options.reveal ?? 1));
    const text = layout.lines.map(line => {
      const parts = labelGraphemes(line.text), shown = parts.slice(0, Math.max(0, remaining)).join(""); remaining -= parts.length;
      const glyphEnd = labelGlyphEndAt(line.measured, shown.normalize("NFC").length);
      return `<g transform="translate(${line.x} ${line.baseline})">${labelGlyphMarkup(label, line.measured, 0, glyphEnd)}</g>`;
    }).join("");
    const visibleText = labelGraphemes(label.text).slice(0, Math.ceil(labelGraphemes(label.text).length * (options.reveal ?? 1))).join("");
    const shadowId = `${id}-shadow`, shadow = labelShadowMarkup(label, shadowId);
    return `<g><title>${escapeLabelXml(visibleText)}</title>${labelBackgroundMarkup(label, layout, id)}${shadow}<g clip-path="url(#${id})"${shadow ? ` filter="url(#${shadowId})"` : ""}>${text}</g></g>`;
  }).join("");
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${elements}</svg>`;
}
