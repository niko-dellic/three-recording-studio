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

## Composing format and storage

Choose the encoder independently from where encoded files go:

```ts
import {
  createRecordingDestination,
  DirectoryFileStorage,
  MemoryFileStorage,
  ReceiverFileStorage,
} from "three-recording-studio/destinations";

const storage = new DirectoryFileStorage(selectedDirectory);
const destination = await createRecordingDestination({
  format: "mp4", // or "png"
  storage,
});
await session.start(job, destination);
```

`MemoryFileStorage` retains either format with a configurable `maxBytes` ceiling
(default 128 MiB), exposes `getFiles()`, and supports an `onComplete(files)` callback.
PNG files are individual encoded frames. Use `MemorySequenceDestination` when
ZIP generation and sequence playback are desired as a convenience.
`DirectoryFileStorage` writes each run to a fresh folder.
`ReceiverFileStorage({url, token})` uses the included authenticated receiver;
PNG writes are acknowledged and resumable, while MP4 uploads a finalized file
with the receiver's 256 MiB file limit. Existing destination classes remain
compatible.

Custom backend storage implements `FileStorage`: `open(job, format, signal)`,
`write({filename, blob, frame?}, signal)`, `close()`, and `abort(reason)`.
`open` returns durably stored frame indices for resumable PNG output, or an empty
set. An optional read-only `check` reports configuration problems before opening.
Every write is awaited, so slower storage applies backpressure. Storage must
honor cancellation and release partially acquired resources in `abort`.
Backend URLs, authentication, metadata schemas, and remote deletion policy belong
to the application.

MP4 uses buffered encoding by default (256 MiB ceiling, configurable with
`maxBytes`). A completed blob can be played locally, uploaded, or downloaded.
For independent save retries, encode into memory, retain the completed file in
`RenderResults`, and invoke `results.save()` separately. Direct-to-storage export
fails the session if persistence fails; streaming cannot offer a complete local
blob for retry without retaining an additional copy.

## Explicit MP4 streaming

```ts
const destination = await createRecordingDestination({
  format: "mp4",
  storage: new DirectoryFileStorage(selectedDirectory),
  streaming: true,
});
```

Streaming requires `storage.openStream(filename, signal)` returning a
`WritableStream<FileChunk>`. Each chunk contains `{type: "write", data, position}`.
The encoder uses fragmented MP4 so writes are sequential, with stream
backpressure propagated to encoding. Fragmented MP4 is less broadly compatible
than the default regular MP4; choose it explicitly for long recordings and a
compatible downstream player. Memory storage and the bundled receiver do not
support streaming. Custom backends may implement it if their upload protocol
supports incremental writes and cancellation.

The streaming path does not allocate a full output-file buffer. Encoders, frame
buffers, and muxer fragments still consume memory. Streaming has no default total
file-size ceiling; an explicit `maxBytes` limits output bytes. It cannot be paired
with the legacy `onComplete(blob)` callback. Successful finalization commits the
stream; cancellation aborts it rather than committing an incomplete file. Storage
implementations remain responsible for cleaning up partial remote uploads.
