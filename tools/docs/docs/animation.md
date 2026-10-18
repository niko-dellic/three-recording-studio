# Animation lifecycle

## Exclusive export

A `RenderSession` owns scene time during export. Its lifecycle is:

1. Validate the job and run read-only capture/destination preflight.
2. Open the destination, then acquire exclusive scene access and save application state.
3. Prepare output targets under the acquired scene lease.
4. For each missing frame, seek, await readiness, render, await readback, and await saving.
5. Finalize the destination, release GPU targets, and restore application state.

Your `acquire()` hook must stop every writer of animated state, including mixers, physics, controls, external timelines, and application callbacks. If acquisition throws before returning a snapshot, roll back partial changes directly or register cleanup with `context.defer()`. `restore()` receives that snapshot on success, cancellation, or failure after acquisition.

`ready()` is for textures, asynchronous data, video seeking, or simulation work. GPU completion does not imply that these application resources are ready. Load shared assets before export when possible.

## Clock integration

A clock alone cannot pause your application or reconstruct a scene. Supply lifecycle hooks instead. The library does not intercept `requestAnimationFrame`, replace global timers, or depend on an animation framework.

```ts
function animate(now: number) {
  requestAnimationFrame(animate);
  if (exporting) return;
  updateLiveAnimation(now);
  renderer.render(scene, camera);
}
```

## Theatre.js

Pause the sheet sequence, assign `sequence.position`, and explicitly flush values through the RAF driver used by your listeners. The demo reads `object.value` after positioning and applies it to the scene. Theatre Studio is hidden during export to prevent editing.

```ts
const driver = createRafDriver({ name: "export" });
function seek(time: number) {
  sheet.sequence.position = time;
  driver.tick(time * 1000);
  const values = object.value;
  mesh.rotation.y = values.rotation;
}
```

## Pause, cancel, and dispose

Pause waits until the current frame is safely saved. It retains the scene lock. Resume continues the same job. Cancellation requests an abort and restores state after pending capture work settles. GPU commands cannot be forcibly interrupted; application hooks should observe `context.signal` during long asynchronous operations.

`dispose()` cancels pending work, waits for cleanup, and disposes the adapter. Disposing a panel only removes its UI; it does not cancel an application-owned session.

## Recovery limits

Durable recovery requires the scene to be reproducible at an absolute timestamp. Physics and stateful particle systems need application-provided reconstruction in `seek()`; automatic simulation replay and checkpoint serialization are outside this release. GPU output is not promised to be byte-identical across devices or drivers.
