import type { VideoPointerTrack } from '@relay/core';
export function normalizePointer(value:unknown):VideoPointerTrack|undefined{
 if(value===undefined)return undefined;
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Expected pointer track.');
 const v=value as VideoPointerTrack;
 if(!Array.isArray(v.events)||v.events.length>2000)throw new Error('Use up to 2000 pointer events.');
 const num=(n:unknown,min:number,max:number,fallback:number)=>{const x=n??fallback;if(typeof x!=='number'||!Number.isFinite(x)||x<min||x>max)throw new Error('Invalid pointer value.');return x;};
 const events=v.events.map(e=>{if(!e||!['move','down','up'].includes(e.kind)||(e.screen!==undefined&&!['inner','outer'].includes(e.screen)))throw new Error('Invalid pointer event.');return {timeMs:num(e.timeMs,0,86400000,0),x:num(e.x,0,1,.5),y:num(e.y,0,1,.5),kind:e.kind,...(e.screen?{screen:e.screen}:{})};}).sort((a,b)=>a.timeMs-b.timeMs);
 if(v.style!==undefined&&!['arrow','touch'].includes(v.style)||v.display!==undefined&&!['continuous','tap-only'].includes(v.display))throw new Error('Choose pointer style and display.');
 if(v.color!==undefined&&!/^#[0-9a-f]{6}$/i.test(v.color))throw new Error('Choose a pointer color.');
 return {events,style:v.style??'arrow',display:v.display??'continuous',color:v.color??'#FFFFFF',size:num(v.size,4,100,24),smoothing:num(v.smoothing,0,1000,80),idleMs:num(v.idleMs,0,60000,1200),fadeMs:num(v.fadeMs,0,5000,250)};
}
/** Event times are source times. Random seeking never accumulates pointer state. */
export function pointerMarkup(timeMs:number,width:number,height:number,track?:VideoPointerTrack,screen?:'inner'|'outer'):string{
 const events=(track?.events??[]).filter(e=>!screen||!e.screen||e.screen===screen);if(!track||!events.length||timeMs<events[0].timeMs)return '';
 let i=0;while(i+1<events.length&&events[i+1].timeMs<=timeMs)i++;
 const event=events[i],next=events[i+1];const smoothing=track.smoothing;
 const p=next&&next.timeMs>event.timeMs?Math.min(1,(timeMs-event.timeMs)/(next.timeMs-event.timeMs)):0;
 // Smooth interpolation uses only surrounding samples, so export and scrub agree.
 const blend=next?Math.min(1,smoothing/Math.max(1,next.timeMs-event.timeMs)):0;
 const eased=p+(p*p*(3-2*p)-p)*blend;
 const x=(event.x+(next?next.x-event.x:0)*eased)*width,y=(event.y+(next?next.y-event.y:0)*eased)*height;
 const tap=events.slice(0,i+1).findLast(e=>e.kind==='down');const age=tap?timeMs-tap.timeMs:Infinity;
 const idle=timeMs-event.timeMs;const opacity=track.display==='tap-only'?Math.max(0,1-age/500):track.idleMs===0?1:Math.max(0,Math.min(1,1-(idle-track.idleMs)/Math.max(1,track.fadeMs)));
 if(opacity<=0)return '';
 const s=track.size*width/1080;
 const ring=age<500?`<circle r="${s*(1+age/250)}" fill="none" stroke="${track.color}" stroke-width="${Math.max(1,s*.12)}" opacity="${1-age/500}"/>`:'';
 const cursor=track.style==='touch'?`<circle r="${s*.55}" fill="${track.color}" stroke="#111111" stroke-width="${s*.08}"/>`:`<path d="M0 0 L${s*.2} ${s} L${s*.43} ${s*.72} L${s*.7} ${s*1.12} L${s*.92} ${s*.98} L${s*.63} ${s*.6} L${s} ${s*.52}Z" fill="${track.color}" stroke="#111111" stroke-width="${s*.08}"/>`;
 return `${ring&&tap?`<g transform="translate(${tap.x*width} ${tap.y*height})" opacity="${opacity}">${ring}</g>`:""}<g transform="translate(${x} ${y})" opacity="${opacity}">${cursor}</g>`;
}
export function pointerSvg(timeMs:number,width:number,height:number,track?:VideoPointerTrack,screen?:'inner'|'outer'){return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${pointerMarkup(timeMs,width,height,track,screen)}</svg>`;}
