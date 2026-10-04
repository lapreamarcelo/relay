import type { TimedVideoLabel } from "@relay/core";
import { creativeLabelHeight } from "./creative-labels.ts";
import { creativeLabelsMarkup } from "./creative-label-markup.ts";
import { animationState } from "./video-animation.ts";

/** One deterministic SVG shared by the browser and frame-by-frame export. */
export function animatedLabelsMarkup(labels: TimedVideoLabel[], timeMs: number, width = 1080, height = 1920): string {
  const content = labels.filter(label => timeMs >= label.startMs && timeMs < label.endMs).map((label, index) => {
    const pose = animationState(label.animation, timeMs - label.startMs, label.endMs - label.startMs, { x: label.x, y: label.y }, "label");
    if (pose.opacity <= 0 || pose.reveal <= 0) return "";
    const characters = Array.from(label.text);
    const shown = characters.slice(0, Math.ceil(characters.length * pose.reveal)).join("");
    // Keep the full message's layout during typing; revealing letters should
    // not move the label or shrink its background between lines.
    const boxHeight = creativeLabelHeight(label, width, height) / height;
    const svg = creativeLabelsMarkup([{ ...label, text: shown, height: boxHeight }], width, height);
    const inner = svg.slice(svg.indexOf(">") + 1, svg.lastIndexOf("</svg>")).replaceAll("label-0", `animated-label-${index}`);
    const anchorX = width * label.x, anchorY = height * label.y;
    return `<g opacity="${pose.opacity}" transform="translate(${width * pose.x} ${height * pose.y}) rotate(${pose.rotateZ}) scale(${pose.scale}) translate(${-anchorX} ${-anchorY})">${inner}</g>`;
  }).join("");
  // Unique clipPath ids allow labels to share one SVG canvas.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`;
}
