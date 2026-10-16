# Recording sources in Relay

`VideoRecordingControls` records only after a user presses **Record window or tab** and accepts the browser's screen-sharing chooser. It never initiates screen capture on page load. The take is local, previewable, and discardable; **Add recording** uploads it through the existing authenticated media library and calls the editor integration callback. The browser chooses a supported MP4/WebM codec. Captures stop at five minutes or the 100 MB memory limit; browser Stop sharing and leaving the editor stop all capture tracks. Shared audio is optional and depends on the chosen browser/source.

The normal screen-share API cannot see pointer/touch events in another window, tab, or native app. Relay does not invent those events. Import gesture JSON for those sources. When a caller supplies an actual `captureCanvas`, the separate **Record canvas with gestures** action records that canvas and collects primary pointer events in its normalized screen coordinates. This is a supported integration seam, not a claim that a DOM preview is a canvas.

## Editor integration

```tsx
import { VideoRecordingControls } from './video-recording-controls';

<VideoRecordingControls
  onCaptured={async ({key, name, url, durationMs, pointer}) => {
    // Add a video clip through the editor's existing asset operation.
    // Set its source trim to 0..durationMs, and copy pointer onto that clip.
  }}
  onImportPointer={pointer => { /* update the selected source clip's pointer */ }}
/>
```

The callback receives `RecordingAsset` (`key`, `url`, `name`, `durationMs`, optional `pointer`). New recordings use the media upload authorization and CORS-safe server fallback already used by the library. No new server-controlled desktop recorder exists. An optional `POST /api/v1/recordings/events` validates event imports with `media:write` authorization and a 1 MB body limit; it stores nothing.

## Simulator capture on macOS

Install Xcode and AXE, boot a Simulator, and open the app to the screen to demonstrate. Capture is an explicit local command; Relay's web server does not spawn native commands. Inspect the Simulator UI and determine its logical screen bounds before choosing coordinates. Width/height below are **logical device points**, not Retina screenshot pixels. Do not rotate the device during a take.

Create a plan such as:

```json
{
  "width": 402,
  "height": 874,
  "durationMs": 12000,
  "steps": [
    { "kind": "tap", "timeMs": 1000, "from": { "x": 0.5, "y": 0.6 } },
    { "kind": "swipe", "timeMs": 3000, "durationMs": 600,
      "from": { "x": 0.5, "y": 0.8 }, "to": { "x": 0.5, "y": 0.3 } }
  ]
}
```

From the repository root:

```sh
node apps/web/scripts/local-recording.mjs --udid <simulator-uuid> --plan /path/to/plan.json --output /path/to/capture.mp4 --dry-run
node apps/web/scripts/local-recording.mjs --udid <simulator-uuid> --plan /path/to/plan.json --output /path/to/capture.mp4
```

The first command only validates the plan and prints the commands. The second runs `simctl io recordVideo` and timestamped AXE gestures. It never uploads, launches an app, changes a simulator selection, or overwrites an existing capture. Ctrl-C finalizes a partial take. Import `capture.mp4`, then `capture.events.json` into the recording panel. AXE must support the selected Simulator; desktop mouse clicks and hardware/crown events are not observed.

The sidecar logs the **dispatch time** of actions sent through the CLI; native delivery latency is not observed. Swipe positions are interpolated from issued start/end coordinates. This is useful for editable gesture cues, but is not exact OS touch telemetry. No manual OS gesture hook or private Simulator API is installed.

## Gesture interchange

Import either an array of events or a `VideoPointerTrack` object. `timeMs` is milliseconds from the beginning of the source recording; `x` and `y` range from 0 to 1 in the source screen. Trimming/playback speed are applied by the editor. Supported kinds are `move`, `down`, and `up`; up to 2000 events are accepted. Imported times must fit the video duration. Events are sorted and validated before upload/use. JSON imports are limited to 1 MB.

```json
{"events":[{"timeMs":1200,"x":0.5,"y":0.6,"kind":"down"},{"timeMs":1300,"x":0.5,"y":0.6,"kind":"up"}],"style":"touch","display":"tap-only"}
```

References: [MDN getDisplayMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia), [canvas captureStream](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream), and the installed AXE `tap --help` / `swipe --help` syntax. Native capture is verified with command fakes in this workspace; a real Simulator run requires a local CoreSimulator service connection.
