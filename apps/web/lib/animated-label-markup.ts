import type { TimedVideoLabel } from "@relay/core";
import { creativeLabelsMarkup, creativeLabelLayout, escapeLabelXml, labelBackgroundMarkup, labelGlyphMarkup, labelShadowMarkup } from "./creative-label-markup.ts";
import { labelGraphemes, labelWords } from "./label-font-metrics.ts";
import { animationState, easingProgress, textOnlyPresets } from "./video-animation.ts";

function staggeredText(label: TimedVideoLabel, timeMs: number, width: number, height: number, index: number): string | null {
  const duration = label.endMs - label.startMs, exitEffect = label.animation?.exit;
  const exiting = Boolean(exitEffect && textOnlyPresets.has(exitEffect.preset) && exitEffect.preset !== "typewriter" && timeMs >= duration - Math.min(exitEffect.durationMs, duration / 2));
  const effect = exiting ? exitEffect : label.animation?.entrance;
  if (!effect || !textOnlyPresets.has(effect.preset) || effect.preset === "typewriter") return null;
  const layout = creativeLabelLayout(label, width, height), preset = effect.preset;
  const wordMode = ["word-spring", "word-slide", "word-blur", "word-zoom"].includes(preset);
  const lineMode = ["line-cascade", "line-wipe", "wipe-left", "wipe-right", "mask-up", "mask-down", "ink-reveal"].includes(preset);
  const parts = layout.lines.map(line => lineMode ? [line.text] : wordMode ? labelWords(line.text) : labelGraphemes(line.text));
  const length = Math.min(effect.durationMs, duration / 2), local = exiting ? timeMs - (duration - length) : timeMs;
  const count = parts.reduce((n, line) => n + line.length, 0), stagger = Math.min(effect.staggerMs ?? 35, length / Math.max(1, count));
  const span = Math.max(1, length - stagger * (count - 1)); let unit = 0;
  const id = `text-box-${index}`, shadowId = `${id}-shadow`, shadow = labelShadowMarkup(label, shadowId);
  const text = parts.map((parts, lineIndex) => {
    const line = layout.lines[lineIndex]; let glyphStart = 0;
    return parts.map(part => {
      const glyphCount = Array.from(part.normalize("NFC")).filter(character => !/\p{Default_Ignorable_Code_Point}/u.test(character)).length;
      const glyphEnd = glyphStart + glyphCount, first = line.measured.glyphs[glyphStart], last = line.measured.glyphs[glyphEnd - 1];
      const begin = first?.x ?? 0, end = last ? last.x + last.advance : begin, partWidth = Math.max(1, end - begin), center = (begin + end) / 2;
      const phase = unit++, progress = Math.max(0, Math.min(1, (local - stagger * phase) / span)), p = exiting ? 1 - progress : progress;
      const spring = ["word-spring", "bounce-in", "elastic-in"].includes(preset);
      const ease = easingProgress(p, effect.easing ?? (spring ? "spring" : "ease-out"), effect.curve), amount = 1 - ease;
      let dy = 0, rotation = 0, scale = 1, scaleX = 1, dx = 0;
      if (["letter-rise", "word-spring", "line-cascade", "bounce-in"].includes(preset)) dy = amount * label.fontSize * .8;
      if (preset === "letter-drop") dy = -amount * label.fontSize * .8;
      if (["letter-slide", "word-slide"].includes(preset)) dx = -amount * label.fontSize * .8;
      if (["ripple", "wave-rise"].includes(preset)) dy = amount * Math.sin(phase * .75 + p * Math.PI * 2) * label.fontSize * .5;
      if (preset === "spin-in") { rotation = amount * -100; scale = .4 + .6 * ease; }
      if (preset === "letter-flip") scaleX = Math.max(.02, Math.cos(amount * Math.PI / 2));
      if (preset === "tracking") dx = amount * (phase - (count - 1) / 2) * label.fontSize * .18;
      if (preset === "letter-zoom") scale = .2 + .8 * ease;
      if (preset === "word-zoom") scale = 1.5 - .5 * ease;
      if (preset === "elastic-in") scale = .55 + .45 * ease;
      if (preset === "arc-in") { dx = -amount * label.fontSize * .4; dy = -Math.sin(amount * Math.PI / 2) * label.fontSize * .65; rotation = amount * 16; }
      if (preset === "scatter-in") { const angle = phase * 2.399963; dx = Math.cos(angle) * amount * label.fontSize; dy = Math.sin(angle) * amount * label.fontSize; rotation = Math.sin(phase * 1.7) * amount * 36; }
      if (preset === "pulse-reveal") scale = 1 + Math.sin(p * Math.PI) * .15;
      if (preset === "alternating-rise") dy = amount * label.fontSize * .6 * (phase % 2 ? -1 : 1);
      const blur = ["focus", "soft-reveal", "word-blur"].includes(preset) ? (1 - p) * label.fontSize * .12 : 0;
      const focusId = `text-focus-${index}-${phase}`, maskId = `text-mask-${index}-${phase}`;
      let mask = "";
      if (p < 1 && ["line-wipe", "wipe-left", "wipe-right", "ink-reveal"].includes(preset)) {
        const fromRight = preset === "wipe-right", revealed = partWidth * p;
        mask = `<clipPath id="${maskId}"><rect x="${fromRight ? partWidth / 2 - revealed : -partWidth / 2}" y="${-label.fontSize * 1.3}" width="${revealed}" height="${label.fontSize * 1.7}"/></clipPath>`;
      }
      if (p < 1 && (preset === "mask-up" || preset === "mask-down")) {
        const revealed = label.fontSize * 1.7 * p;
        mask = `<clipPath id="${maskId}"><rect x="${-partWidth / 2 - 20}" y="${preset === "mask-up" ? label.fontSize * .4 - revealed : -label.fontSize * 1.3}" width="${partWidth + 40}" height="${revealed}"/></clipPath>`;
      }
      const paths = labelGlyphMarkup(label, line.measured, glyphStart, glyphEnd); glyphStart = glyphEnd;
      return `<g opacity="${p}" transform="translate(${line.x + center + dx} ${line.baseline + dy}) rotate(${rotation}) scale(${scale * scaleX} ${scale})">${blur > .05 ? `<filter id="${focusId}" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="${blur}"/></filter>` : ""}${mask}<g${blur > .05 ? ` filter="url(#${focusId})"` : ""}${mask ? ` clip-path="url(#${maskId})"` : ""}><g transform="translate(${-center} 0)">${paths}</g></g></g>`;
    }).join("");
  }).join("");
  return `<title>${escapeLabelXml(label.text)}</title>${labelBackgroundMarkup(label, layout, id)}${shadow}<g clip-path="url(#${id})"${shadow ? ` filter="url(#${shadowId})"` : ""}>${text}</g>`;
}

/** One deterministic SVG shared by the browser, GPU scene textures and frame-by-frame export. */
export function animatedLabelsMarkup(labels: TimedVideoLabel[], timeMs: number, width = 1080, height = 1920): string {
  const content = labels.filter(label => timeMs >= label.startMs && timeMs < label.endMs).map((label, index) => {
    const pose = animationState(label.animation, timeMs - label.startMs, label.endMs - label.startMs, { x: label.x, y: label.y }, "label");
    if (pose.opacity <= 0 || pose.reveal <= 0) return "";
    // Always layout the full message first: typewriter visibility cannot change wraps, kerning, alignment, or box size.
    const svg = creativeLabelsMarkup([label], width, height, { reveal: pose.reveal, idPrefix: `animated-label-${index}` });
    const inner = staggeredText(label, timeMs - label.startMs, width, height, index) ?? svg.slice(svg.indexOf(">") + 1, svg.lastIndexOf("</svg>")).replaceAll(`animated-label-${index}-0`, `animated-label-${index}`);
    const anchorX = width * label.x, anchorY = height * label.y;
    return `<g opacity="${pose.opacity}" transform="translate(${width * pose.x} ${height * pose.y}) rotate(${pose.rotateZ}) scale(${pose.scale}) translate(${-anchorX} ${-anchorY})">${inner}</g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`;
}
