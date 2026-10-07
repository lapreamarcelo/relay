import { videoBackgroundCss } from "../lib/video-background";
import { cloneElement, isValidElement, useEffect, useRef, useState } from "react";
import type { DeviceFrame, VideoTimeline } from "@relay/core";
import { AppWindow, Smartphone, Tablet, Monitor, Watch, Rotate3d } from "lucide-react";
import { defaultDeviceFrame, deviceFrameGeometry, deviceFrameSvg, deviceFrameLayerSvg, deviceBodyLayerSvg } from "../lib/device-frames";
import { deviceScene, devicePanelAtScale } from "../lib/device-motion";
import { LayerAnimationControls, easingOptions } from "./video-animation-controls";
import "./app-demo-editor.css";

type DeviceChoice = DeviceFrame["device"] | "none";
const choices: Array<{ value: DeviceChoice; label: string; icon?: typeof Smartphone; advanced?: boolean }> = [
  { value: "none", label: "None" },
  { value: "phone", label: "Phone", icon: Smartphone },
  { value: "tablet", label: "Tablet", icon: Tablet },
  { value: "browser", label: "Browser", icon: AppWindow },
  { value: "iphone", label: "iPhone", icon: Smartphone, advanced: true },
  { value: "iphone-duo", label: "iPhone Duo", icon: Tablet, advanced: true },
  { value: "mac", label: "Mac", icon: Monitor, advanced: true },
  { value: "watch", label: "Watch", icon: Watch, advanced: true },
  { value: "android", label: "Android", icon: Smartphone, advanced: true },
];

export function DeviceFrameControls({ value, disabled = false, advanced = false, sharedBackground = false, timeMs = 0, durationMs = 5000, onChange }: {
  value?: DeviceFrame;
  disabled?: boolean;
  advanced?: boolean;
  sharedBackground?: boolean;
  timeMs?: number;
  durationMs?: number;
  onChange: (value: DeviceFrame | undefined) => void;
}) {
  const placement = useRef<HTMLDetailsElement>(null);
  const update = (changes: Partial<DeviceFrame>) => value && onChange({ ...value, ...changes });
  const select = (device: DeviceChoice) => {
    if (device === "none") return onChange(undefined);
    const frame = { ...(value ?? defaultDeviceFrame), device };
    if (device !== "iphone-duo") {
      delete frame.foldAngle;
      if (frame.animation?.keyframes) frame.animation = { ...frame.animation, keyframes: frame.animation.keyframes.map(({ foldAngle: _fold, ...keyframe }) => keyframe).filter(keyframe => Object.keys(keyframe).some(key => key !== "timeMs" && key !== "easing")) };
      if (["fold", "unfold", "fold-cycle"].includes(frame.motion ?? "none")) frame.motion = "none";
    }
    onChange(frame);
  };
  const transformFields = [
    { key: "x", name: "Device horizontal position", label: "Horizontal", min: 0, max: 100, step: 1, fallback: .5, factor: 100, unit: "%" },
    { key: "y", name: "Device vertical position", label: "Vertical", min: 0, max: 100, step: 1, fallback: .5, factor: 100, unit: "%" },
    { key: "scale", name: "Device scale", label: "Scale", min: 25, max: 150, step: 1, fallback: 1, factor: 100, unit: "%" },
    { key: "rotateX", name: "Device rotation X", label: "Tilt X", min: -60, max: 60, step: 1, fallback: 0, factor: 1, unit: "°" },
    { key: "rotateY", name: "Device rotation Y", label: "Tilt Y", min: -60, max: 60, step: 1, fallback: 0, factor: 1, unit: "°" },
    { key: "rotateZ", name: "Device rotation Z", label: "Rotate", min: -180, max: 180, step: 1, fallback: 0, factor: 1, unit: "°" },
  ] as const;

  return <div className={`device-frame-controls ${advanced ? "device-demo-controls" : ""}`} data-testid="device-frame-controls">
    <div className="device-frame-options" role="group" aria-label="Device frame">
      {choices.filter(choice => advanced || !choice.advanced).map(choice => {
        const Icon = choice.icon;
        const selected = (value?.device ?? "none") === choice.value;
        return <button key={choice.value} type="button" disabled={disabled} className={selected ? "active" : ""} aria-pressed={selected} data-device-frame={choice.value} onClick={() => select(choice.value)}>
          {Icon ? <Icon aria-hidden="true" /> : <span aria-hidden="true" className="device-frame-none" />}{choice.label}
        </button>;
      })}
    </div>
    {value && <>
      <div className="device-frame-colors">
        {!sharedBackground && <label><input aria-label="Device background color" type="color" value={value.background} disabled={disabled} onChange={event => update({ background: event.target.value.toUpperCase() })}/><span>Background</span><small>{value.background}</small></label>}
        <label><input aria-label="Device frame color" type="color" value={value.color} disabled={disabled} onChange={event => update({ color: event.target.value.toUpperCase() })}/><span>Frame</span><small>{value.color}</small></label>
      </div>
      {advanced && <>
        {!sharedBackground && <div className="device-demo-background">
          <label>Background style<select aria-label="Device background style" value={value.backgroundEnd ? "gradient" : "solid"} disabled={disabled} onChange={event => update({ backgroundEnd: event.target.value === "gradient" ? "#C7D5DF" : undefined })}><option value="solid">Solid color</option><option value="gradient">Gradient</option></select></label>
          {value.backgroundEnd && <label className="device-demo-gradient-end">Gradient end<input aria-label="Device gradient end color" type="color" value={value.backgroundEnd} disabled={disabled} onChange={event => update({ backgroundEnd: event.target.value.toUpperCase() })}/></label>}
        </div>}
        <div className="device-demo-motion">
          <label>Animation<select aria-label="Device animation" value={value.motion ?? "none"} disabled={disabled} onChange={event => update({ motion: event.target.value as DeviceFrame["motion"] })}>
            <option value="none">Still</option><option value="orbit">Orbit / rotate</option><option value="float">Float</option>
            {value.device === "iphone-duo" && <><option value="fold">Fold closed</option><option value="unfold">Unfold open</option><option value="fold-cycle">Fold & unfold</option></>}
          </select></label>
          {value.motion && value.motion !== "none" && <label>Duration (seconds)<input aria-label="Device animation duration" type="number" min=".5" max="60" step=".5" disabled={disabled} value={(value.motionDurationMs ?? 4000) / 1000} onChange={event => { if (event.target.value) update({ motionDurationMs: Math.min(60000, Math.max(500, Number(event.target.value) * 1000)) }); }}/></label>}
          {value.motion && value.motion !== "none" && <label>Motion easing<select aria-label="Device motion easing" value={value.motionEasing ?? "linear"} disabled={disabled} onChange={event => update({ motionEasing: event.target.value as DeviceFrame["motionEasing"] })}>{easingOptions.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>}
          {value.device === "iphone-duo" && <label className="device-demo-slider">Fold angle<input aria-label="Duo fold angle" type="range" min="0" max="165" step="1" value={value.foldAngle ?? 0} disabled={disabled} onChange={event => update({ foldAngle: Number(event.target.value) })}/><output>{value.foldAngle ?? 0}°</output></label>}
          <button type="button" className="secondary-button" disabled={disabled} onClick={() => { if (placement.current) { placement.current.open = true; placement.current.scrollIntoView({ block: "nearest" }); } }}><Rotate3d/>3D rotation</button>
          <small>Scrub or play the timeline to preview the animation.</small>
        </div>
        <details ref={placement} className="device-demo-transform"><summary>Position, scale & rotation</summary>
          <small>Tilt the device on X/Y or rotate it on Z. Orbit animates the tilt over time.</small>
          {transformFields.map(field => <label className="device-demo-slider" key={field.key}>{field.label}<input aria-label={field.name} type="range" min={field.min} max={field.max} step={field.step} value={Math.round((value[field.key] ?? field.fallback) * field.factor)} disabled={disabled} onChange={event => update({ [field.key]: Number(event.target.value) / field.factor })}/><output>{Math.round((value[field.key] ?? field.fallback) * field.factor)}{field.unit}</output></label>)}
          <button type="button" className="secondary-button" disabled={disabled} onClick={() => update({ x: .5, y: .5, scale: 1, rotateX: 0, rotateY: 0, rotateZ: 0 })}>Reset placement</button>
        </details>
        <LayerAnimationControls target="Device" value={value.animation} onChange={animation => update({ animation })} timeMs={timeMs} durationMs={durationMs} disabled={disabled} duo={value.device === "iphone-duo"} base={{ x: value.x ?? .5, y: value.y ?? .5, scale: value.scale ?? 1, rotateX: value.rotateX ?? 0, rotateY: value.rotateY ?? 0, rotateZ: value.rotateZ ?? 0, ...(value.device === "iphone-duo" ? { foldAngle: value.foldAngle ?? 0 } : {}), opacity: 1 }}/>
      </>}
    </>}
  </div>;
}

export function DeviceFramePreview({ value, width, height, children, timeMs = 0, durationMs = 5000, sourceTimeMs, playing = false, sourceVolume, background, advanced = false, transparent = false }: {
  value?: DeviceFrame;
  width: number;
  height: number;
  children: React.ReactNode;
  timeMs?: number;
  durationMs?: number;
  sourceTimeMs?: number;
  advanced?: boolean;
  playing?: boolean;
  sourceVolume?: number;
  background?: VideoTimeline["background"];
  /** Layered devices share the canvas backdrop instead of painting over peers. */
  transparent?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [previewWidth, setPreviewWidth] = useState(0);
  const source = isValidElement<{ src?: string }>(children) ? children.props.src : undefined;
  const scene = value && advanced ? deviceScene(width, height, value, timeMs, durationMs) : undefined;
  const geometry = scene?.geometry ?? (value ? deviceFrameGeometry(width, height, value.device) : undefined);
  const overlay = value ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(advanced ? deviceFrameLayerSvg(width, height, value) : deviceFrameSvg(width, height, value))}` : undefined;
  const backgroundColor = background?.color ?? value?.background ?? "#000000";
  const backgroundEnd = background?.endColor ?? (background ? undefined : value?.backgroundEnd);
  const backgroundStyle = videoBackgroundCss(width,height,background ?? {color:backgroundColor,endColor:backgroundEnd});
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const resize = () => setPreviewWidth(element.clientWidth);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // A folding screen has two projected copies of the same recording. The last
  // copy retains the editor's video ref; only that copy emits source audio.
  useEffect(() => {
    if (sourceTimeMs === undefined) return;
    const videos = Array.from(root.current?.querySelectorAll("video") ?? []);
    const sync = () => videos.forEach((video, index) => {
      video.muted = index < videos.length - 1;
      if (sourceVolume !== undefined) video.volume = sourceVolume;
      if (Math.abs(video.currentTime - sourceTimeMs / 1000) > (playing ? .15 : .001)) video.currentTime = Math.max(0, sourceTimeMs / 1000);
      if (playing) { if (video.paused) void video.play().catch(() => {}); }
      else video.pause();
    });
    sync();
    videos.forEach(video => video.addEventListener("loadedmetadata", sync));
    return () => videos.forEach(video => video.removeEventListener("loadedmetadata", sync));
  }, [sourceTimeMs, playing, value?.device, scene?.panels.length, source, sourceVolume]);
  const previewScale = previewWidth > 0 ? previewWidth / width : 1;
  const previewHeight = height * previewScale;
  const screenStyle = geometry ? {
    left: geometry.screen.x * previewScale, top: geometry.screen.y * previewScale, width: geometry.screen.width * previewScale, height: geometry.screen.height * previewScale,
    borderRadius: geometry.screen.radius * previewScale, background: "#000000",
  } : undefined;
  return <div ref={root} className={`device-frame-preview ${value?.device ?? "none"}`} style={{ background: transparent ? "transparent" : backgroundStyle }} data-device-preview={value?.device ?? "none"} data-device-time={Math.round(timeMs)}>
    {scene ? <div className="device-demo-scene" style={{ width: previewWidth, height: previewHeight, opacity: scene.opacity }}>
      {scene.bodyPanels.map(panel => devicePanelAtScale(panel, previewScale)).map((panel, index) => <div key={`body-${index}`} className="device-demo-panel device-demo-body-panel" data-device-body={index} style={{ width: panel.rect.width, height: panel.rect.height, transform: panel.transform, visibility: panel.visible ? "visible" : "hidden", pointerEvents: "none" }}>
        <div className="device-demo-panel-content" style={{ width: previewWidth, height: previewHeight, left: -panel.rect.x, top: -panel.rect.y }}>
          <img className="device-frame-overlay" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(deviceBodyLayerSvg(width,height,value!,panel.shade))}`} alt="" aria-hidden="true"/>
        </div>
      </div>)}
      {scene.panels.map(panel => devicePanelAtScale(panel, previewScale)).map((panel, index) => <div key={index} className="device-demo-panel" data-device-panel={index} data-device-panel-transform={panel.transform} style={{ width: panel.rect.width, height: panel.rect.height, transform: panel.transform, visibility: panel.visible ? "visible" : "hidden" }}>
        <div className="device-demo-panel-content" style={{ width: previewWidth, height: previewHeight, left: -panel.rect.x, top: -panel.rect.y }}>
          <div className="device-frame-screen" style={screenStyle}>{isValidElement<{ref?:React.Ref<HTMLVideoElement>}>(children) ? cloneElement(children, {ref:index===scene.panels.length-1?children.props.ref:undefined}) : children}</div>
          <img className="device-frame-overlay" src={overlay} alt="" aria-hidden="true"/>
        </div>
      </div>)}
    </div> : <>
      <div className="device-frame-screen" style={geometry ? {
        left: `${geometry.screen.x / width * 100}%`, top: `${geometry.screen.y / height * 100}%`,
        width: `${geometry.screen.width / width * 100}%`, height: `${geometry.screen.height / height * 100}%`,
        borderRadius: `${geometry.screen.radius / geometry.screen.width * 100}% / ${geometry.screen.radius / geometry.screen.height * 100}%`,
      } : { background: "transparent" }}>{children}</div>
      {overlay && <img className="device-frame-overlay" src={overlay} alt="" aria-hidden="true"/>}
    </>}
  </div>;
}
