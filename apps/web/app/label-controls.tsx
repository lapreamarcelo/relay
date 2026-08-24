"use client";

import type { CreativeLabel, LabelFont, LabelStylePreset } from "@relay/core";

import { labelFonts, labelPresets, presetChanges } from "../lib/creative-labels";

export type LabelControlValue = Pick<CreativeLabel, "text" | "font" | "fontSize" | "width" | "textColor" | "background" | "style"> & { height: number; backgroundColor: string };

interface LabelControlsProps {
  value: LabelControlValue;
  disabled?: boolean;
  helper?: string;
  placeholder?: string;
  onChange: (changes: Partial<LabelControlValue>) => void;
}

export function LabelControls({ value, disabled = false, helper, placeholder = "Add your hook or label…", onChange }: LabelControlsProps) {
  return <div className="label-controls">
    <textarea aria-label="Label text" disabled={disabled} value={value.text} maxLength={500} placeholder={placeholder} onChange={(event) => onChange({ text: event.target.value })} />
    <small>{value.text.length}/500{helper ? ` · ${helper}` : ""}</small>
    <div className="label-style-shortcuts" aria-label="Label style">{(Object.keys(labelPresets) as LabelStylePreset[]).map((style) => { const preset = labelPresets[style]; const active = value.style === style && value.textColor === preset.textColor && value.background === preset.background && value.backgroundColor === preset.backgroundColor; return <button type="button" disabled={disabled} aria-pressed={active} className={active ? "active" : ""} onClick={() => onChange(presetChanges(style))} key={style}><i className={style}/><span>{preset.name}</span></button>; })}</div>
    <div className="label-color-controls"><label>Text color<input aria-label="Label text color" disabled={disabled} type="color" value={value.textColor} onChange={(event) => onChange({ textColor: event.target.value.toUpperCase() })}/><span>{value.textColor}</span></label><label>Background<input aria-label="Label background color" disabled={disabled} type="color" value={value.backgroundColor} onChange={(event) => onChange({ backgroundColor: event.target.value.toUpperCase(), background: "dark", style: "dark" })}/><span>{value.background === "none" ? "Clear" : value.backgroundColor}</span></label></div>
    <label>Font<select aria-label="Label font" disabled={disabled} value={value.font} onChange={(event) => onChange({ font: event.target.value as LabelFont })}>{(Object.keys(labelFonts) as LabelFont[]).map((font) => <option value={font} key={font}>{labelFonts[font].name}</option>)}</select></label>
    <label>Size<input aria-label="Label size" disabled={disabled} type="range" min="28" max="160" value={value.fontSize} onChange={(event) => onChange({ fontSize: Number(event.target.value) })}/><span>{value.fontSize}px</span></label>
    <label>Width<input aria-label="Label width" disabled={disabled} type="range" min="25" max="92" value={Math.round(value.width * 100)} onChange={(event) => onChange({ width: Number(event.target.value) / 100 })}/><span>{Math.round(value.width * 100)}%</span></label>
    <label>Min height<input aria-label="Label minimum height" disabled={disabled} type="range" min="6" max="35" value={Math.round(value.height * 100)} onChange={(event) => onChange({ height: Number(event.target.value) / 100 })}/><span>{Math.round(value.height * 100)}%</span></label>
  </div>;
}
