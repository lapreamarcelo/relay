import type { VideoClip } from "@relay/core";
import { animationEase } from "./video-animation.ts";
import { clipSchedule } from "./video-timeline.ts";

// FFmpeg xfade's P runs from one to zero. Our shared progress runs zero to one.
// Plane-aware sampling gives slides and zoom the same geometry as CSS preview.
function sample(source: "a" | "b", x: string, y = "Y"): string {
  return `if(eq(PLANE,0),${source}0(${x},${y}),if(eq(PLANE,1),${source}1(${x},${y}),if(eq(PLANE,2),${source}2(${x},${y}),${source}3(${x},${y}))))`;
}

export function transitionExpression(transition: NonNullable<VideoClip["transition"]>): string {
  const p = String(animationEase("(1-P)", transition.easing));
  switch (transition.kind) {
    case "slide-left": return `if(lt(X,W*(1-${p})),${sample("a", `X+W*${p}`)},${sample("b", `X-W*(1-${p})`)})`;
    case "slide-right": return `if(lt(X,W*${p}),${sample("b", `X+W*(1-${p})`)},${sample("a", `X-W*${p}`)})`;
    case "wipe-left": return `if(lt(X,W*(1-${p})),A,B)`;
    case "wipe-right": return `if(lt(X,W*${p}),B,A)`;
    case "zoom": {
      const scale = `(1.2-0.2*${p})`;
      return `A*(1-${p})+${sample("b", `W/2+(X-W/2)/${scale}`, `H/2+(Y-H/2)/${scale}`)}*${p}`;
    }
    default: return `A*(1-${p})+B*${p}`;
  }
}

/** Clips have already been rendered individually at 30fps with source audio. */
export function timelineJoinFilter(clips: VideoClip[]): string {
  const schedule = clipSchedule(clips);
  const filters = clips.flatMap((clip, i) => [`[${i}:v]fps=30,settb=AVTB,setpts=PTS-STARTPTS,format=yuv444p[v${i}]`, `[${i}:a]aresample=48000,apad,atrim=duration=${(clip.outMs-clip.inMs)/1000},asetpts=PTS-STARTPTS[a${i}]`]);
  let video = "v0", audio = "a0";
  for (let i = 1; i < clips.length; i++) {
    const outVideo = `joinedv${i}`, outAudio = `joineda${i}`;
    if (schedule[i].transitionMs > 0 && clips[i].transition) {
      const seconds = schedule[i].transitionMs / 1000;
      filters.push(`[${video}][v${i}]xfade=transition=custom:duration=${seconds}:offset=${schedule[i].startMs / 1000}:expr='${transitionExpression(clips[i].transition!)}'[${outVideo}]`);
      filters.push(`[${audio}][a${i}]acrossfade=d=${seconds}:c1=tri:c2=tri[${outAudio}]`);
    } else filters.push(`[${video}][${audio}][v${i}][a${i}]concat=n=2:v=1:a=1[${outVideo}][${outAudio}]`);
    video = outVideo; audio = outAudio;
  }
  filters.push(`[${video}]format=yuv420p[video]`, `[${audio}]anull[audio]`);
  return filters.join(";");
}
