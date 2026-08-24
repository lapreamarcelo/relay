import "server-only";

import type { CreativeLabel } from "@relay/core";
import { creativeLabelHeight, labelFonts, wrapCreativeLabel } from "./creative-labels";

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export function creativeLabelsSvg(labels: CreativeLabel[], width = 1080, height = 1920): Buffer {
  const elements = labels.map((label, index) => {
    const boxWidth = Math.round(width * label.width);
    const lines = wrapCreativeLabel(label.text, label.fontSize, boxWidth - 70);
    const lineHeight = Math.round(label.fontSize * 1.16);
    const boxHeight = creativeLabelHeight(label, width, height);
    const left = Math.round(width * label.x - boxWidth / 2);
    const top = Math.round(height * label.y - boxHeight / 2);
    const fill = label.background === "none" ? "none" : label.backgroundColor ?? (label.background === "dark" ? "#000000" : "#FFFFFF");
    const stroke = label.background === "none" ? "#10110f" : "none";
    const firstBaseline = top + Math.round((boxHeight - lines.length * lineHeight) / 2) + label.fontSize;
    const text = lines.map((line, lineIndex) => `<tspan x="${Math.round(width * label.x)}" y="${firstBaseline + lineIndex * lineHeight}">${escapeXml(line)}</tspan>`).join("");
    return `<clipPath id="label-${index}"><rect x="${left}" y="${top}" width="${boxWidth}" height="${boxHeight}" rx="28"/></clipPath><rect x="${left}" y="${top}" width="${boxWidth}" height="${boxHeight}" rx="28" fill="${fill}"/><text clip-path="url(#label-${index})" text-anchor="middle" fill="${label.textColor}" stroke="${stroke}" stroke-width="7" paint-order="stroke" font-family="${labelFonts[label.font].svg}" font-weight="800" font-size="${label.fontSize}">${text}</text>`;
  }).join("");
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${elements}</svg>`);
}
