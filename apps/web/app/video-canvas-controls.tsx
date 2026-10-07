import type { VideoTimeline } from "@relay/core";
import { FolderOpen, Upload, X } from "lucide-react";

export function VideoCanvasControls({ value, disabled, onChange, onBrowse, onUpload }: {
  value: VideoTimeline["background"];
  disabled: boolean;
  onChange: (background: VideoTimeline["background"]) => void;
  onBrowse: () => void;
  onUpload: () => void;
}) {
  const background = value ?? { color: "#E8E2D8" };
  return <section data-canvas-settings>
    <p className="eyebrow">Canvas background</p>
    <div className="video-canvas-background">
      <label>Style<select aria-label="Canvas background style" value={value?.imageUrl ? "image" : value?.endColor ? "gradient" : value ? "solid" : "default"} onChange={event => {
        const style = event.target.value;
        if (style === "image") return onBrowse();
        onChange(style === "default" ? undefined : { color: background.color, ...(style === "gradient" ? { endColor: background.endColor ?? "#C7D5DF" } : {}) });
      }}><option value="default">Use device default</option><option value="solid">Solid color</option><option value="gradient">Gradient</option><option value="image">Image</option></select></label>
      {value && <label>{value.imageUrl ? "Backdrop color" : "Color"}<input aria-label="Canvas background color" type="color" value={value.color} onChange={event => onChange({ ...value, color: event.target.value.toUpperCase() })}/></label>}
      {value?.endColor && <label>Gradient end<input aria-label="Canvas gradient end color" type="color" value={value.endColor} onChange={event => onChange({ ...value, endColor: event.target.value.toUpperCase() })}/></label>}
    </div>
    {value?.imageUrl && <>
      <img className="video-background-thumbnail" src={value.imageUrl} alt="Canvas background"/>
      <label>Image fit<select aria-label="Background image fit" value={value.imageFit ?? "cover"} onChange={event => onChange({ ...value, imageFit: event.target.value as "cover" | "contain" })}><option value="cover">Fill canvas</option><option value="contain">Fit entire image</option></select></label>
    </>}
    <div className="source-quick-actions">
      <button disabled={disabled} onClick={onBrowse}><FolderOpen/>{value?.imageUrl ? "Replace image" : "Choose image"}</button>
      <button disabled={disabled} onClick={onUpload}><Upload/>Upload image</button>
    </div>
    {value?.imageUrl && <button className="secondary-button" onClick={() => onChange({ color: value.color, ...(value.endColor ? { endColor: value.endColor } : {}) })}><X/>Remove background image</button>}
    <small>Images sit behind the devices. Use Fit entire frame in clip settings to reveal the background around unframed media.</small>
  </section>;
}
