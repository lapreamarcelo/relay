"use client";

import { videoBackgroundCss } from "../lib/video-background";
import { cloneElement, isValidElement, useEffect, useRef, useState } from "react";
import type { DeviceFrame, VideoPointerTrack, VideoScene, VideoTimeline } from "@relay/core";
import { AppWindow, Smartphone, Tablet, Monitor, Watch, Rotate3d } from "lucide-react";
import { defaultDeviceFrame, deviceFrameGeometry, deviceFrameSvg, deviceFrameLayerSvg, deviceBodyLayerSvg } from "../lib/device-frames";
import { deviceModels, deviceModel } from "../lib/device-model-catalog";
import { emptyTimeline } from "../lib/video-timeline";
import { VideoGpuPreview } from "./video-gpu-preview";
import { pointerSvg } from "../lib/video-pointer";
import { sceneShutterSamples } from "../lib/video-scene";
import { deviceScene, devicePanelAtScale } from "../lib/device-motion";
import { LayerAnimationControls, easingOptions } from "./video-animation-controls";
import "./app-demo-editor.css";
import "./typography-controls.css";

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
  const setRendering = (renderMode: DeviceFrame["renderMode"]) => {
    if (!value) return;
    if (renderMode !== "vector") { update({ renderMode }); return; }
    const animation = value.animation ? { ...value.animation, keyframes: value.animation.keyframes?.map(({ depth: _depth, ...frame }) => ({ ...frame,
      ...(frame.rotateX === undefined ? {} : { rotateX: Math.max(-60, Math.min(60, frame.rotateX)) }),
      ...(frame.rotateY === undefined ? {} : { rotateY: Math.max(-60, Math.min(60, frame.rotateY)) }),
      ...(frame.rotateZ === undefined ? {} : { rotateZ: Math.max(-180, Math.min(180, frame.rotateZ)) }),
    })).filter(frame => [frame.x, frame.y, frame.scale, frame.rotateX, frame.rotateY, frame.rotateZ, frame.foldAngle, frame.opacity].some(property => property !== undefined)) } : undefined;
    update({ renderMode, depth: undefined, rotateX: Math.max(-60, Math.min(60, value.rotateX ?? 0)), rotateY: Math.max(-60, Math.min(60, value.rotateY ?? 0)), rotateZ: Math.max(-180, Math.min(180, value.rotateZ ?? 0)), animation });
  };
  const select = (device: DeviceChoice) => {
    if (device === "none") return onChange(undefined);
    const frame = { ...(value ?? defaultDeviceFrame), device };
    if (frame.modelId && !deviceModels.some(model => model.id === frame.modelId && model.device === device)) delete frame.modelId;
    if (device !== "iphone-duo") {
      delete frame.foldAngle;
      if (frame.animation?.keyframes) frame.animation = { ...frame.animation, keyframes: frame.animation.keyframes.map(({ foldAngle: _fold, ...keyframe }) => keyframe).filter(keyframe => Object.keys(keyframe).some(key => key !== "timeMs" && key !== "easing")) };
      if (["fold", "unfold", "fold-cycle"].includes(frame.motion ?? "none")) frame.motion = "none";
    }
    onChange(frame);
  };
  const spatial = value?.renderMode === "mesh" || value?.renderMode === "gpu";
  const model = value ? deviceModel(value) : undefined;
  const transformFields = [
    { key: "x", name: "Device horizontal position", label: "Horizontal", min: 0, max: 100, step: 1, fallback: .5, factor: 100, unit: "%" },
    { key: "y", name: "Device vertical position", label: "Vertical", min: 0, max: 100, step: 1, fallback: .5, factor: 100, unit: "%" },
    { key: "scale", name: "Device scale", label: "Scale", min: 25, max: 150, step: 1, fallback: 1, factor: 100, unit: "%" },
    { key: "rotateX", name: "Device rotation X", label: "Tilt X", min: spatial ? -360 : -60, max: spatial ? 360 : 60, step: 1, fallback: 0, factor: 1, unit: "°" },
    { key: "rotateY", name: "Device rotation Y", label: "Tilt Y", min: spatial ? -360 : -60, max: spatial ? 360 : 60, step: 1, fallback: 0, factor: 1, unit: "°" },
    { key: "rotateZ", name: "Device rotation Z", label: "Rotate", min: spatial ? -360 : -180, max: spatial ? 360 : 180, step: 1, fallback: 0, factor: 1, unit: "°" },
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
        <div className="device-demo-background device-render-settings"><label>Rendering<select aria-label="Device rendering" value={value.renderMode ?? "vector"} disabled={disabled} onChange={event => setRendering(event.target.value as DeviceFrame["renderMode"])}><option value="vector">Classic frame</option><option value="mesh">Studio geometry</option><option value="gpu">3D model / GPU</option></select></label>
        {spatial && <label>Depth<input aria-label="Device depth" type="range" min="-2" max="2" step=".01" value={value.depth ?? 0} disabled={disabled} onChange={event=>update({depth:Number(event.target.value)})}/><output>{(value.depth ?? 0).toFixed(2)}</output></label>}</div>
        {value.renderMode === "gpu" && model && <div className="device-model-settings">
          <label>Device model<select aria-label="Device 3D model" disabled={disabled} value={value.modelId ?? model.id} onChange={event => update({ modelId: event.target.value })}>{deviceModels.filter(item => item.device === value.device).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <small>{model.name} · {model.author} · {model.license}{"source" in model && <> · <a href={model.source} target="_blank" rel="noreferrer">Model attribution</a></>}</small>
          <small>Keep a still pose or choose motion below. Switching rendering preserves your authored motion.</small>
        </div>}
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
        <LayerAnimationControls target="Device" value={value.animation} onChange={animation => update({ animation })} timeMs={timeMs} durationMs={durationMs} disabled={disabled} mesh={spatial} duo={value.device === "iphone-duo"} base={{ x: value.x ?? .5, y: value.y ?? .5, scale: value.scale ?? 1, rotateX: value.rotateX ?? 0, rotateY: value.rotateY ?? 0, rotateZ: value.rotateZ ?? 0, depth:value.depth??0, ...(value.device === "iphone-duo" ? { foldAngle: value.foldAngle ?? 0 } : {}), opacity: 1 }}/>
      </>}
    </>}
  </div>;
}

export function DeviceFramePreview({ value, width, height, children, timeMs = 0, durationMs = 5000, sourceTimeMs, playing = false, sourceVolume, background, advanced = false, transparent = false, gpuManaged = false, scene: sharedScene, sceneTimeMs = timeMs, pointer, playbackRate = 1, fps=30 }: {
  value?: DeviceFrame;
  scene?: VideoScene;
  sceneTimeMs?: number;
  pointer?: VideoPointerTrack;
  playbackRate?: number;
  fps?: number;
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
  /** The parent composition renders every GPU layer in one shared depth scene. */
  gpuManaged?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [previewWidth, setPreviewWidth] = useState(0);
  const [sourceSize,setSourceSize] = useState({width:1080,height:1920});
  const childStyle=isValidElement<{style?:React.CSSProperties}>(children)?children.props.style:undefined;
  const source = isValidElement<{ src?: string }>(children) ? children.props.src : undefined;
  const renderedFrame = value && sharedScene ? {...value,scene:sharedScene} : value;
  const gpu = value?.renderMode === "gpu" && advanced;
  const scene = renderedFrame && advanced && !gpu ? deviceScene(width, height, renderedFrame, timeMs, durationMs,sceneTimeMs,fps) : undefined;
  const shutterPanels = scene && renderedFrame?.renderMode === "mesh" ? sceneShutterSamples(renderedFrame.scene,timeMs,fps).map(sample=>({weight:sample.weight,scene:sample.timeMs === timeMs ? scene : deviceScene(width,height,{...renderedFrame,scene:renderedFrame.scene?{...renderedFrame.scene,motionBlur:0}:undefined},sample.timeMs,durationMs,Math.max(0,sceneTimeMs+sample.timeMs-timeMs),fps)})) : scene ? [{weight:1,scene}] : [];
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
  useEffect(()=>{
    const media=root.current?.querySelector("video, .device-frame-screen > img:not([data-pointer])") as HTMLVideoElement | HTMLImageElement | null;
    if(!media) return;
    const resize=()=>{const width=media instanceof HTMLVideoElement?media.videoWidth:media.naturalWidth,height=media instanceof HTMLVideoElement?media.videoHeight:media.naturalHeight;if(width&&height)setSourceSize({width,height});};
    resize();media.addEventListener("loadedmetadata",resize);media.addEventListener("load",resize);
    return ()=>{media.removeEventListener("loadedmetadata",resize);media.removeEventListener("load",resize);};
  },[source,value?.device]);
  const pointerImage=(screen?:"inner"|"outer")=>pointer && <img data-pointer="true" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(pointerSvg(sourceTimeMs ?? timeMs,sourceSize.width,sourceSize.height,pointer,screen))}`} alt="" aria-hidden="true" style={{...childStyle,position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none"}}/>;
  // A folding screen has two projected copies of the same recording. The last
  // copy retains the editor's video ref; only that copy emits source audio.
  useEffect(() => {
    if (sourceTimeMs === undefined) return;
    const videos = Array.from(root.current?.querySelectorAll("video") ?? []);
    const sync = () => videos.forEach((video, index) => {
      video.muted = index < videos.length - 1;
      video.playbackRate = playbackRate;
      if (sourceVolume !== undefined) video.volume = sourceVolume;
      if (Math.abs(video.currentTime - sourceTimeMs / 1000) > (playing ? .15 : .001)) video.currentTime = Math.max(0, sourceTimeMs / 1000);
      if (playing) { if (video.paused) void video.play().catch(() => {}); }
      else video.pause();
    });
    sync();
    videos.forEach(video => video.addEventListener("loadedmetadata", sync));
    return () => videos.forEach(video => video.removeEventListener("loadedmetadata", sync));
  }, [sourceTimeMs, playing, value?.device, scene?.panels.length, source, sourceVolume, playbackRate]);
  const previewScale = previewWidth > 0 ? previewWidth / width : 1;
  const previewHeight = height * previewScale;
  const screenStyle = geometry ? {
    left: geometry.screen.x * previewScale, top: geometry.screen.y * previewScale, width: geometry.screen.width * previewScale, height: geometry.screen.height * previewScale,
    borderRadius: geometry.screen.radius * previewScale, background: "#000000",
  } : undefined;
  if (gpu) {
    const mediaKind = isValidElement(children) && children.type === "video" ? "video" : "image";
    const gpuTimeline: VideoTimeline = { ...emptyTimeline(), exportSettings: { format: "mp4", resolution: "720p", fps: fps === 24 || fps === 60 ? fps : 30, quality: "standard" }, background: background ?? { color: backgroundColor, ...(backgroundEnd ? { endColor: backgroundEnd } : {}) }, ...(sharedScene ? { scene: sharedScene } : {}), clips: source ? [{ id: "device-preview", name: "Device preview", kind: mediaKind, sourceUrl: source, inMs: 0, outMs: durationMs, freezeMs: sourceTimeMs ?? timeMs, sourceDurationMs: Math.max(durationMs, sourceTimeMs ?? timeMs), fit: childStyle?.objectFit === "contain" ? "contain" : "cover", x: .5, y: .5, zoom: 1, volume: 0, ...(pointer ? { pointer } : {}), deviceFrame: renderedFrame }] : [] };
    return <div ref={root} className={`device-frame-preview ${value.device}`} style={{ background: gpuManaged || transparent ? "transparent" : backgroundStyle }} data-device-preview={value.device} data-device-rendering="gpu" data-device-time={Math.round(timeMs)}>
      {!gpuManaged && source && <VideoGpuPreview timeline={gpuTimeline} timeMs={timeMs} playing={playing} width={width} height={height}/>}
      <div aria-hidden="true" className="device-gpu-media-clock" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0, pointerEvents: "none" }}>{children}</div>
    </div>;
  }
  return <div ref={root} className={`device-frame-preview ${value?.device ?? "none"}`} style={{ background: transparent ? "transparent" : backgroundStyle }} data-device-preview={value?.device ?? "none"} data-device-time={Math.round(timeMs)}>
    {scene ? <div className="device-demo-scene" style={{ width: previewWidth, height: previewHeight, opacity: scene.opacity, isolation:"isolate" }}>
      {scene.meshSvg && <img style={{zIndex:0}} className="device-frame-overlay" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(scene.meshSvg)}`} alt="" aria-hidden="true"/>}
      {scene.bodyPanels.map(panel => devicePanelAtScale(panel, previewScale)).map((panel, index) => <div key={`body-${index}`} className="device-demo-panel device-demo-body-panel" data-device-body={index} style={{ width: panel.rect.width, height: panel.rect.height, transform: panel.transform, visibility: panel.visible ? "visible" : "hidden", pointerEvents: "none" }}>
        <div className="device-demo-panel-content" style={{ width: previewWidth, height: previewHeight, left: -panel.rect.x, top: -panel.rect.y }}>
          <img className="device-frame-overlay" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(deviceBodyLayerSvg(width,height,value!,panel.shade))}`} alt="" aria-hidden="true"/>
        </div>
      </div>)}
      <div style={{position:"absolute",inset:0,isolation:"isolate",zIndex:1}}>{shutterPanels.flatMap((sample,sampleIndex)=>sample.scene.panels.map(panel => devicePanelAtScale(panel, previewScale)).map((panel, index) => <div key={`${sampleIndex}-${index}`} className="device-demo-panel" data-device-panel={index} data-device-panel-transform={panel.transform} style={{ width: panel.rect.width, height: panel.rect.height, transform: panel.transform, visibility: panel.visible ? "visible" : "hidden", opacity:sample.weight,mixBlendMode:shutterPanels.length>1?"plus-lighter":undefined, filter:sample.scene.focusBlur?`blur(${sample.scene.focusBlur*previewScale}px)`:undefined }}>
        <div className="device-demo-panel-content" style={{ width: previewWidth, height: previewHeight, left: -panel.rect.x, top: -panel.rect.y }}>
          <div className="device-frame-screen" style={panel.screenRect?{left:panel.screenRect.x*previewScale,top:panel.screenRect.y*previewScale,width:panel.screenRect.width*previewScale,height:panel.screenRect.height*previewScale,borderRadius:panel.screenRect.radius*previewScale,background:"#000"}:screenStyle}>{isValidElement<{ref?:React.Ref<HTMLVideoElement>}>(children) ? cloneElement(children, {ref:sampleIndex===shutterPanels.length-1&&index===scene.panels.length-1?children.props.ref:undefined}) : children}{pointerImage(panel.screen)}</div>
          {!panel.screenRect && <img className="device-frame-overlay" src={overlay} alt="" aria-hidden="true"/>}
        </div>
      </div>))}</div>
    </div> : <>
      <div className="device-frame-screen" style={geometry ? {
        left: `${geometry.screen.x / width * 100}%`, top: `${geometry.screen.y / height * 100}%`,
        width: `${geometry.screen.width / width * 100}%`, height: `${geometry.screen.height / height * 100}%`,
        borderRadius: `${geometry.screen.radius / geometry.screen.width * 100}% / ${geometry.screen.radius / geometry.screen.height * 100}%`,
      } : { background: "transparent" }}>{children}{pointerImage(value?.device === "iphone-duo"?"inner":"outer")}</div>
      {overlay && <img className="device-frame-overlay" src={overlay} alt="" aria-hidden="true"/>}
    </>}
  </div>;
}
