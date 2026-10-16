import type {VideoTimeline} from "@relay/core";
import {VideoGpuScene} from "./video-gpu-scene";

let scene:VideoGpuScene,timeline:VideoTimeline;
Object.assign(window,{relayGpu:{
  async prepare(value:VideoTimeline,width:number,height:number){if(scene){scene.dispose();scene.canvas.remove();}timeline=value;const canvas=document.createElement("canvas");document.body.append(canvas);scene=new VideoGpuScene(canvas,width,height,location.origin);await scene.prepare(timeline);},
  async frame(timeMs:number){const canvas=await scene.frame(timeline,timeMs);return canvas.toDataURL("image/png").split(",")[1];},
  dispose(){scene?.dispose();scene?.canvas.remove();}
}});
