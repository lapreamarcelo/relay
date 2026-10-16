"use client";

import type { VideoClip, VideoTimeline } from "@relay/core";
import { clipDuration, clipSchedule, clipSourceTime, splitVideoClip } from "../lib/video-timeline";
import { duplicateVideoClip, freezeVideoClip, linkVideoClips, moveVideoClip, rippleDeleteVideoClip, setVideoClipSpeed, slipVideoClip, snapToBeat, trimVideoClip, unlinkVideoClip } from "../lib/video-edit-operations";

type Props = { timeline: VideoTimeline; clip: VideoClip; timeMs: number; onChange: (timeline: VideoTimeline) => void };
export function VideoEditControls({ timeline, clip, timeMs, onChange }: Props) {
 const schedule = clipSchedule(timeline), row = schedule.find(row => row.clip.id === clip.id);
 const local = Math.max(0, Math.min(clipDuration(clip), timeMs-(row?.startMs ?? 0)));
 const update = (value: VideoTimeline) => onChange(value);
 const number = (value: number, action: (value: number) => VideoTimeline) => { if (Number.isFinite(value)) update(action(value)); };
 return <fieldset className="video-edit-controls"><legend>Clip tools</legend>
  <div className="video-edit-actions">
   <button type="button" className="secondary-button" disabled={local < 100 || clipDuration(clip)-local < 100 || timeline.clips.length >= 50} onClick={() => update(splitVideoClip(timeline,clip.id,local))}>Cut at playhead</button>
   <button type="button" className="secondary-button" disabled={timeline.clips.length >= 50} onClick={() => update(duplicateVideoClip(timeline,clip.id))}>Copy clip</button>
   <button type="button" className="secondary-button" disabled={!row?.index} onClick={() => update(moveVideoClip(timeline,clip.id,-1))}>Move earlier</button>
   <button type="button" className="secondary-button" disabled={row?.index === timeline.clips.length-1} onClick={() => update(moveVideoClip(timeline,clip.id,1))}>Move later</button>
   <button type="button" className="secondary-button" onClick={() => update(rippleDeleteVideoClip(timeline,clip.id))}>Delete and close gap</button>
  </div>
  <div className="video-edit-fields">
   <label>Playback speed<select aria-label="Playback speed" value={clip.speed ?? 1} onChange={e => update(setVideoClipSpeed(timeline,clip.id,Number(e.target.value)))}>{[.25,.5,.75,1,1.25,1.5,2,3,4].map(speed => <option key={speed} value={speed}>{speed}×</option>)}</select></label>
   <label>Source starts (s)<input type="number" min="0" step="0.1" value={clip.inMs/1000} onChange={e => number(e.target.valueAsNumber,value => trimVideoClip(timeline,clip.id,value*1000,clip.outMs))}/></label>
   <label>Source ends (s)<input type="number" min={(clip.inMs+100)/1000} max={(clip.sourceDurationMs ?? 3_600_000)/1000} step="0.1" value={clip.outMs/1000} onChange={e => number(e.target.valueAsNumber,value => trimVideoClip(timeline,clip.id,clip.inMs,value*1000))}/></label>
  </div>
  {clip.kind === "video" && <div className="video-edit-actions">
   <button type="button" className="secondary-button" onClick={() => update(slipVideoClip(timeline,clip.id,-100))}>Earlier source · 0.1s</button>
   <button type="button" className="secondary-button" onClick={() => update(slipVideoClip(timeline,clip.id,100))}>Later source · 0.1s</button>
   <button type="button" className="secondary-button" aria-pressed={clip.freezeMs !== undefined} onClick={() => update(freezeVideoClip(timeline,clip.id,clip.freezeMs === undefined ? local : undefined))}>{clip.freezeMs === undefined ? `Hold frame at ${(clipSourceTime(clip,local)/1000).toFixed(1)}s` : "Resume footage"}</button>
  </div>}
  <div className="video-edit-actions">
   {clip.groupId ? <button type="button" className="secondary-button" onClick={() => update(unlinkVideoClip(timeline,clip.id))}>Unlink motion</button> : <button type="button" className="secondary-button" disabled={!row || row.index >= timeline.clips.length-1} onClick={() => update(linkVideoClips(timeline,[clip.id,timeline.clips[(row?.index ?? 0)+1]?.id]))}>Link motion to next clip</button>}
   {timeline.beatGrid && <button type="button" className="secondary-button" disabled={!row || clipDuration(clip) < 200} onClick={() => { const end = snapToBeat(row!.endMs,timeline.beatGrid); update(trimVideoClip(timeline,clip.id,clip.inMs,clip.inMs+(end-row!.startMs)*(clip.speed ?? 1))); }}>End on nearest beat</button>}
  </div>
  <small>Timing edits move later text, camera moves and sound together. Linking carries the same pose and motion through adjacent cuts.</small>
 </fieldset>;
}
