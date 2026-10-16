"use client";
import type { VideoScene } from "@relay/core";
import { animationEasings } from "../lib/video-animation";
import { sceneCameraState, defaultVideoScene, cameraRanges, sceneRanges, sceneEnvironments } from "../lib/video-scene";
import { CurveControls } from "./video-animation-controls";
import "./scene-controls.css";

export function VideoSceneControls({value,timeMs=0,disabled=false,onChange}:{value?:VideoScene;timeMs?:number;disabled?:boolean;onChange:(scene:VideoScene|undefined)=>void}) {
  const scene=value ?? defaultVideoScene;
  const update=(change:Partial<VideoScene>)=>onChange({...scene,...change});
  const camera=sceneCameraState(scene,timeMs);
  const canKeyframe=(scene.camera.keyframes?.length ?? 0)<100 || !!scene.camera.keyframes?.some(key=>key.timeMs===Math.round(timeMs));
  const updateCamera=(field:keyof typeof cameraRanges,n:number)=>{
    if(!scene.camera.keyframes?.length) return update({camera:{...scene.camera,[field]:n}});
    if(!canKeyframe) return;
    const time=Math.round(timeMs),key={...camera,timeMs:time,[field]:n,easing:"ease-in-out" as const};
    update({camera:{...scene.camera,keyframes:[...scene.camera.keyframes.filter(k=>k.timeMs!==time),key].sort((a,b)=>a.timeMs-b.timeMs)}});
  };
  const addCameraKey=()=>{
    const key={...camera,timeMs:Math.round(timeMs),easing:"ease-in-out" as const};
    update({camera:{...scene.camera,keyframes:[...(scene.camera.keyframes ?? []).filter(k=>k.timeMs!==key.timeMs),key].sort((a,b)=>a.timeMs-b.timeMs)}});
  };
  return <details className="scene-controls"><summary>Studio scene</summary>
    <p>Studio devices share one camera and light rig. Classic frames keep their existing look.</p>
    <label>Environment<select aria-label="Scene environment" disabled={disabled} value={scene.environment} onChange={e=>update({environment:e.target.value as VideoScene["environment"]})}>{sceneEnvironments.map(env=><option key={env} value={env}>{env[0].toUpperCase()+env.slice(1)}</option>)}</select></label>
    <fieldset disabled={disabled}><legend>Camera</legend>
      {(Object.keys(cameraRanges) as Array<keyof typeof cameraRanges>).map(key=><label key={key}>{({x:"Horizontal",y:"Vertical",z:"Dolly depth",rotateX:"Pitch",rotateY:"Yaw",rotateZ:"Roll",focalLength:"Lens (mm)"})[key]}<input aria-label={`Scene camera ${key}`} type="range" min={cameraRanges[key][0]} max={cameraRanges[key][1]} step={key.startsWith("rotate")||key==="focalLength"?1:.01} disabled={!canKeyframe} value={camera[key]} onChange={e=>updateCamera(key,Number(e.target.value))}/><output>{camera[key].toFixed(key.startsWith("rotate")||key==="focalLength"?0:2)}</output></label>)}
      <button type="button" onClick={addCameraKey} disabled={!canKeyframe}>Record camera at {(timeMs/1000).toFixed(2)}s</button>
      {(scene.camera.keyframes ?? []).map((key,index)=><div className="scene-camera-key" key={key.timeMs}><span>{(key.timeMs/1000).toFixed(2)}s</span>{(["z","focalLength"] as const).map(field=><label key={field}>{field==="z"?"Dolly depth":"Lens (mm)"}<input aria-label={`Camera key ${index+1} ${field}`} type="number" min={cameraRanges[field][0]} max={cameraRanges[field][1]} step={field==="z"?.01:1} value={key[field] ?? sceneCameraState(scene,key.timeMs)[field]} onChange={e=>{const n=Number(e.target.value);if(e.target.value&&Number.isFinite(n)&&n>=cameraRanges[field][0]&&n<=cameraRanges[field][1])update({camera:{...scene.camera,keyframes:scene.camera.keyframes!.map((k,i)=>i===index?{...k,[field]:n}:k)}});}}/></label>)}<label>Lens multiplier<input aria-label={`Camera key ${index+1} lens multiplier`} type="number" min=".25" max="4" step=".05" value={key.scale ?? 1} onChange={e=>{const scale=Number(e.target.value);if(scale>=.25&&scale<=4)update({camera:{...scene.camera,keyframes:scene.camera.keyframes!.map((k,i)=>i===index?{...k,scale}:k)}});}}/></label><label>Easing<select aria-label={`Camera key ${index+1} easing`} value={key.easing ?? "linear"} onChange={e=>update({camera:{...scene.camera,keyframes:scene.camera.keyframes!.map((k,i)=>i===index?{...k,easing:e.target.value as typeof k.easing}:k)}})}>{animationEasings.map(e=><option key={e} value={e}>{e}</option>)}</select></label><CurveControls name={`Scene camera key ${index+1}`} easing={key.easing} value={key.curve} disabled={disabled} onChange={curve=>update({camera:{...scene.camera,keyframes:scene.camera.keyframes!.map((k,i)=>i===index?{...k,curve}:k)}})}/><button type="button" aria-label={`Delete camera key ${index+1}`} onClick={()=>update({camera:{...scene.camera,keyframes:scene.camera.keyframes?.filter((_,i)=>i!==index)}})}>Remove</button></div>)}
    </fieldset>
    <fieldset disabled={disabled}><legend>Lighting and surface</legend>
      {(["exposure","roughness","metallic","shadow","lightAngle"] as const).map(key=><label key={key}>{({exposure:"Exposure",roughness:"Surface softness",metallic:"Metal reflection",shadow:"Shadow strength",lightAngle:"Light direction"})[key]}<input aria-label={`Scene ${key}`} type="range" min={sceneRanges[key][0]} max={sceneRanges[key][1]} step={key==="lightAngle"?1:.01} value={scene[key]} onChange={e=>update({[key]:Number(e.target.value)})}/><output>{scene[key].toFixed(key==="lightAngle"?0:2)}</output></label>)}
    </fieldset>
    <fieldset disabled={disabled}><legend>Focus and shutter</legend>
      {(["focusDepth","aperture","motionBlur"] as const).map(key=><label key={key}>{({focusDepth:"Focus depth",aperture:"Depth softness",motionBlur:"Shutter blur"})[key]}<input aria-label={`Scene ${key}`} type="range" min={sceneRanges[key][0]} max={sceneRanges[key][1]} step=".01" value={scene[key]} onChange={e=>update({[key]:Number(e.target.value)})}/><output>{scene[key].toFixed(2)}</output></label>)}
      <small>Software rendering approximates reflection and depth softness. Shutter blur samples movement over time.</small>
    </fieldset>
    <button className="secondary-button" type="button" disabled={disabled} onClick={()=>onChange(undefined)}>Reset studio scene</button>
  </details>;
}
