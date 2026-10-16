"use client";
import type { CreativeLabel, LayerAnimation } from "@relay/core";
import type { LabelTypography } from "../lib/creative-labels";
import "./typography-controls.css";

export function VideoTypographyControls({ value, disabled, onChange }: { value: CreativeLabel & LabelTypography & { animation?: LayerAnimation }; disabled?: boolean; onChange: (patch: Partial<CreativeLabel> & LabelTypography & { animation?: LayerAnimation }) => void }) {
  const changePlacement = (sceneLayer: LabelTypography["sceneLayer"]) => {
    const animation = sceneLayer === "scene" || !value.animation ? value.animation : { ...value.animation, keyframes: value.animation.keyframes?.map(({ rotateX: _rx, rotateY: _ry, depth: _depth, ...frame }) => frame).filter(frame => [frame.x, frame.y, frame.scale, frame.rotateZ, frame.opacity].some(property => property !== undefined)) };
    onChange({ sceneLayer, animation });
  };
  const numeric = (key: keyof LabelTypography, name: string, min: number, max: number, step: number, fallback: number) => <label key={key}>{name}<input aria-label={`Label ${name.toLowerCase()}`} type="number" min={min} max={max} step={step} disabled={disabled} value={value[key] as number ?? fallback} onChange={event => { if (event.target.value !== "") onChange({ [key]: Math.max(min, Math.min(max, Number(event.target.value))) }); }}/></label>;
  return <details className="video-typography-controls"><summary>Typography & text placement</summary><div className="video-typography-grid">
    <label>Weight<select aria-label="Label weight" value={value.fontWeight ?? 800} disabled={disabled} onChange={event => onChange({ fontWeight: Number(event.target.value) as LabelTypography["fontWeight"] })}><option value={400}>Regular</option><option value={700}>Bold</option><option value={800}>Heavy</option></select></label>
    <label>Alignment<select aria-label="Label alignment" value={value.textAlign ?? "center"} disabled={disabled} onChange={event => onChange({ textAlign: event.target.value as LabelTypography["textAlign"] })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
    {numeric("letterSpacing", "Letter spacing", -10, 40, .25, 0)}{numeric("lineHeight", "Line spacing", .8, 2, .05, 1.16)}
    <label className="typography-check"><input aria-label="Label italic" type="checkbox" checked={value.italic ?? false} disabled={disabled} onChange={event => onChange({ italic: event.target.checked })}/>Italic</label>
    <label className="typography-check"><input aria-label="Label font kerning" type="checkbox" checked={value.kerning ?? true} disabled={disabled} onChange={event => onChange({ kerning: event.target.checked })}/>Font kerning</label>
    {numeric("padding", "Text padding", 0, 100, 1, 35)}
    <label>Stroke color<input aria-label="Label stroke color" type="color" value={value.strokeColor ?? "#10110F"} disabled={disabled} onChange={event => onChange({ strokeColor: event.target.value.toUpperCase() })}/></label>{numeric("strokeWidth", "Stroke width", 0, 16, .5, value.background === "none" ? 7 : 0)}
    <label>Shadow color<input aria-label="Label shadow color" type="color" value={value.shadowColor ?? "#000000"} disabled={disabled} onChange={event => onChange({ shadowColor: event.target.value.toUpperCase() })}/></label>{numeric("shadowBlur", "Shadow blur", 0, 40, 1, 0)}
    {numeric("shadowX", "Shadow horizontal", -40, 40, 1, 0)}{numeric("shadowY", "Shadow vertical", -40, 40, 1, 0)}
    {numeric("backgroundOpacity", "Background opacity", 0, 1, .05, 1)}{numeric("backgroundRadius", "Background radius", 0, 80, 1, 28)}
    <label>Backdrop<select aria-label="Label backdrop" value={value.background === "none" ? "none" : "filled"} disabled={disabled} onChange={event => onChange({ background: event.target.value === "none" ? "none" : "dark" })}><option value="filled">Filled</option><option value="none">Clear</option></select></label>
    <label>Scene placement<select aria-label="Label scene placement" value={value.sceneLayer ?? "overlay"} disabled={disabled} onChange={event => changePlacement(event.target.value as LabelTypography["sceneLayer"])}><option value="overlay">In front of composition</option><option value="back">Behind devices</option><option value="scene">Inside 3D scene</option></select></label>
    {value.sceneLayer === "scene" && numeric("sceneDepth", "Scene depth", -2, 2, .05, 0)}
  </div><small>Kerning uses the bundled font. Bold and heavy share the bold face; italic applies a consistent slant. Motion is added separately.</small></details>;
}
