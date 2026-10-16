# Saving and recovery

## PNG sequences

Start the companion in a terminal:

```sh
npx three-recording-receiver --directory ./recordings
```

For an unpublished checkout use `npm run receiver -- --directory ./recordings`. The receiver prints a WebSocket URL and token. It listens on loopback, not the external network. Default accepted browser origins use `127.0.0.1` or `localhost` on ports 5187, 5190, and 5191.

```sh
npx three-recording-receiver --port 8787 --directory ./recordings \
  --origins http://localhost:3000
```

```ts
import { WebSocketDestination } from "three-recording-studio";
const destination = new WebSocketDestination({
  url: "ws://127.0.0.1:8787",
  token: tokenFromTerminal,
});
await session.start(job, destination);
```

Each job gets a directory containing numbered PNGs and `manifest.json`. The receiver writes a temporary file, synchronizes it, renames it, and updates the manifest before acknowledging the frame. Unacknowledged frames are rendered again. Concurrent writers to the same job are rejected.

On restart, the receiver compares normalized settings and `contentId`, verifies saved frame hashes, and returns valid completed frame numbers. Missing or damaged frames are regenerated. Change the job ID when changing the scene or export settings.

**`contentId` is an application contract.** It must identify every input affecting output: scene, assets, animation, camera, custom shaders and relevant renderer settings. The library cannot infer these from arbitrary JavaScript. The demo hashes its prepared scene version, Theatre state, camera and backend.

## MP4

`Mp4Destination` uses Mediabunny and WebCodecs. It checks H.264 support for the requested dimensions before acquiring the scene, requires even dimensions, and rejects transparency. `onComplete(blob)` receives the finalized file.

The output file is buffered in memory with a configurable encoded-byte ceiling (256 MiB by default). Codec queues, container metadata and temporary allocations add heap overhead; this is an output-size guard, not a hard process-memory quota. Frame buffers are reused; encoded output necessarily grows until completion. Use PNG sequences for long renders. A paused in-memory MP4 can resume in the same session; a reload starts it over.

For a completed sequence, encode with your own FFmpeg installation:

```sh
ffmpeg -framerate 30 -start_number 0 -i frame-%08d.png \
  -c:v libx264 -pix_fmt yuv420p output.mp4
```

Adjust the framerate and first frame to the manifest. The receiver does not bundle FFmpeg.

## Custom backend

Implement `RenderDestination`: `open(job, signal)` returns saved frame indices, `write(frame, context)` resolves after the destination has safely consumed the data, `close()` finalizes, and `abort(reason)` releases resources while retaining durable progress where appropriate.

A destination must honor cancellation and propagate failures. A WebSocket send completing is not evidence of persistence; acknowledge at the receiving storage boundary. Remote service authentication and deployment are application responsibilities. A hosted HTTPS demo may require a secure WebSocket endpoint or running the demo locally to reach a local receiver.

## Demo destinations

The demo separates **Format** from **Save to**. Both MP4 and PNG sequences support **Memory**, **Folder**, and **Receiver**.

| Destination | PNG sequence                                        | MP4                                                  |
| ----------- | --------------------------------------------------- | ---------------------------------------------------- |
| Memory      | Channel playback, frame scrubbing, and ZIP download | Channel playback and manual download                 |
| Folder      | Writes each PNG as it renders                       | Saves the finalized MP4 after encoding               |
| Receiver    | Sends each PNG with durable acknowledgement         | Sends the finalized MP4 with durable acknowledgement |

In-memory PNG sequences have a 128 MiB encoded-output limit, including ZIP overhead. ZIP creation and preview retention require additional memory. Retained channel results are limited to 256 MiB in total; PNG frames and their ZIP both count toward that limit. MP4 encoding has a 256 MiB output limit for every destination. These limits bound retained output, not total browser heap usage.

For folder output, select **Save to → Folder → Choose folder…**. The browser requests write access. Each render creates a fresh subfolder. PNG exports include numbered images and `render.json`; MP4 exports contain the completed movie. Cancelled PNG renders keep completed files. Folder exports start a new run; use the receiver for resumable PNG exports. Browsers without a directory picker can use Memory or Receiver.

Select **Save to → Receiver**, then enter the URL and token printed by the companion. The status reports connection, completion, and errors. MP4 uploads use the same authentication and save a movie plus `manifest.json`; they require the updated companion and are not resumable. MP4 playback remains available in the channel after a successful folder or receiver save.

**Render image** always produces a PNG, saves it to the selected destination, and retains it in the channel preview.

The library exports `MemorySequenceDestination`, `DirectoryDestination(directoryHandle)`, and `saveFileToDirectory(directoryHandle, job, blob, signal)`. Call `showDirectoryPicker({mode: "readwrite"})` from a user click. For MP4 receiver saving, call `WebSocketDestination.saveMp4(job, blob, signal)` with the finalized blob from `Mp4Destination.onComplete`.
