"use client";

import {useEffect,useRef,useState} from "react";
import type {VideoTimeline} from "@relay/core";
import {videoCameraTransform} from "../lib/video-camera";
import type {VideoGpuScene} from "../lib/video-gpu-scene";

export function VideoGpuPreview({timeline,timeMs,playing=false,width,height}:{timeline:VideoTimeline;timeMs:number;playing?:boolean;width:number;height:number}) {
  const canvas=useRef<HTMLCanvasElement>(null),engine=useRef<VideoGpuScene|null>(null),requestDraw=useRef(()=>{});
  const current=useRef({timeline,timeMs,playing});current.current={timeline,timeMs,playing};
  const [error,setError]=useState("");
  const [renderSize,setRenderSize]=useState<{width:number;height:number}|null>(null);
  const enabled=[...timeline.clips,...(timeline.layers??[])].some(c=>c.deviceFrame?.renderMode==="gpu")||timeline.labels.some(l=>l.sceneLayer==="scene");
  const signature=JSON.stringify([...timeline.clips,...(timeline.layers??[])].filter(c=>c.deviceFrame?.renderMode==="gpu").map(c=>[c.id,c.kind,c.sourceUrl,c.deviceFrame?.device,c.deviceFrame?.modelId,c.deviceFrame?.finish,c.deviceFrame?.band]));
  useEffect(()=>{
    if(!enabled||!canvas.current)return;
    const host=canvas.current.parentElement!;
    const resize=()=>{
      const rect=host.getBoundingClientRect(),density=Math.min(2,window.devicePixelRatio||1);
      const side=Math.min(1920,Math.max(640,Math.ceil(Math.max(rect.width,rect.height)*density)));
      const ratio=side/Math.max(width,height),next={width:Math.round(width*ratio),height:Math.round(height*ratio)};
      setRenderSize(previous=>previous?.width===next.width&&previous.height===next.height?previous:next);
    };
    const observer=new ResizeObserver(resize);observer.observe(host);window.addEventListener("resize",resize);resize();
    return()=>{observer.disconnect();window.removeEventListener("resize",resize);};
  },[enabled,width,height]);
  useEffect(()=>{
    if(!enabled||!canvas.current||!renderSize)return;
    let disposed=false,raf=0,instance:VideoGpuScene|undefined,busy=false;
    setError("");
    void import("../lib/video-gpu-scene").then(async ({VideoGpuScene})=>{
      if(disposed)return;
      // Match the displayed canvas and HiDPI density, with a bounded pixel budget.
      // Export still uses the exact chosen output dimensions.
      instance=new VideoGpuScene(canvas.current!,renderSize.width,renderSize.height);engine.current=instance;
      await instance.prepare(current.current.timeline);
      const draw=async()=>{
        if(disposed||busy)return;
        busy=true;const next=current.current;
        try {instance!.play(next.playing);await instance!.frame(next.timeline,next.timeMs,{seek:!next.playing,blur:true});}
        catch(e){if(!disposed){setError(e instanceof Error?e.message:"3D preview failed.");instance?.dispose();requestDraw.current=()=>{};}return;}
        finally{busy=false;}
        if(!disposed&&current.current!==next)raf=requestAnimationFrame(()=>void draw());
      };
      requestDraw.current=()=>{if(!disposed&&!busy){cancelAnimationFrame(raf);raf=requestAnimationFrame(()=>void draw());}};
      await draw();
    }).catch(e=>{if(!disposed){setError(e instanceof Error?e.message:"This browser cannot initialize the 3D renderer.");instance?.dispose();}});
    return()=>{disposed=true;cancelAnimationFrame(raf);requestDraw.current=()=>{};engine.current=null;instance?.dispose();};
  },[enabled,signature,width,height,renderSize]);
  useEffect(()=>{requestDraw.current();},[timeline,timeMs,playing]);
  if(!enabled)return null;
  return <div className="video-gpu-preview" style={{position:"absolute",inset:0,zIndex:1,transform:videoCameraTransform(timeline.camera,timeMs),pointerEvents:"none"}}><canvas ref={canvas} aria-label="3D device scene" style={{width:"100%",height:"100%",display:"block"}}/>{error&&<p role="alert" style={{position:"absolute",left:8,right:8,bottom:8,padding:8,background:"#141820",color:"#fff",fontSize:12}}>{error}</p>}</div>;
}
