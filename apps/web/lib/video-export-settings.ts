import type { VideoExportSettings, VideoTimeline } from '@relay/core';
export const defaultExportSettings: VideoExportSettings = {format:'mp4',fps:30,resolution:'1080p',quality:'standard'};
export function normalizeExportSettings(value: unknown): VideoExportSettings | undefined {
 if(value===undefined)return undefined;
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Expected export settings.');
 const v={...defaultExportSettings,...value} as VideoExportSettings;
 if(!['mp4','webm','gif','png','jpeg'].includes(v.format)||![24,30,60].includes(v.fps)||!['720p','1080p','2160p'].includes(v.resolution)||!['draft','standard','high'].includes(v.quality))throw new Error('Choose a supported export format, frame rate, size, and quality.');
 return {format:v.format,fps:v.fps,resolution:v.resolution,quality:v.quality};
}
export function exportDimensions(timeline: Pick<VideoTimeline,'aspectRatio'|'exportSettings'>): [number,number] {
 const short=({'720p':720,'1080p':1080,'2160p':2160})[timeline.exportSettings?.resolution??'1080p'];
 const ratio=({'9:16':9/16,'4:5':4/5,'1:1':1,'16:9':16/9})[timeline.aspectRatio];
 return ratio>1?[Math.round(short*ratio/2)*2,short]:[short,Math.round(short/ratio/2)*2];
}
export function exportProfile(settings?: VideoExportSettings){const s=settings??defaultExportSettings;return {...s,extension:s.format==='jpeg'?'jpg':s.format,contentType:({mp4:'video/mp4',webm:'video/webm',gif:'image/gif',png:'image/png',jpeg:'image/jpeg'})[s.format],crf:({draft:28,standard:21,high:16})[s.quality],still:s.format==='png'||s.format==='jpeg'};}
