# Runnable integration recipes

These small applications use the public package APIs without Quilt or Theatre.
From a checkout of the repository:

```sh
npm ci
npm run examples:dev
```

Open `http://127.0.0.1:5188/examples/`. The command builds the library before
starting the examples. `npm run examples:build` builds standalone static pages;
`npm run build:site` includes them in the documentation site.

| Recipe              | Run                                                          | Source                                                | What it demonstrates                                                                                                                                         |
| ------------------- | ------------------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Vanilla Three.js    | <a href="/examples/vanilla/" target="_self">Open example</a> | `examples/vanilla/main.ts`                            | A small existing Three.js scene, exclusive animation ownership, independent capture resolution, MP4 memory output, default panel, and application teardown   |
| React/custom replay | <a href="/examples/react/" target="_self">Open example</a>   | `examples/react/main.tsx`, `examples/react/replay.ts` | Independent settings/preview/transport/progress mounts, async readiness, renderer-neutral capture, PNG sequences, retained results, and backend upload retry |

The source is intentionally complete: it includes initialization, animation state,
capture, destinations, mounted controls, and cleanup. To adapt it to an installed
package, keep its `three-recording-studio/...` imports and install the application's
own framework/renderer dependencies. React is an example development dependency,
not a dependency or requirement of the recording library.

## React ownership and pane changes

The React recipe creates the session, controller, replay, and result store at the
application level. View effects create UI components and dispose only those
components. Use **Hide preview** while rendering, then **Show preview** afterward:
the render continues, and the completed sequence reappears.

| Owner             | Lifetime and cleanup                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Application       | Owns renderer/simulation and calls `session.dispose()` when leaving the project/application                              |
| Session           | Owns the per-run animation lease and capture preparation; finishes/restores before disposal completes                    |
| Controller        | Owns commands and subscriptions; disconnect it when the recording integration is no longer needed                        |
| Result store      | An explicitly supplied store survives controller/view disposal; dispose it when retained recordings are no longer needed |
| React view effect | Mounts and disposes UI components; never cancels the session merely because a pane becomes hidden                        |

After session disposal settles, release the application's renderer, simulation,
and other shared resources. Do not dispose those while capture still owns them.

## Asynchronous replay

The custom capture example uses a canvas renderer with no Three.js import.
`seek()` selects absolute simulation time. `ready()` waits for abort-aware work,
and only then does `capture()` paint the requested frame into an offscreen canvas.
Replace the example's short delay with data loading/evaluation for your simulation.
The same evaluated state must drive live playback and export; do not start a second
wall-clock playback loop to produce export frames.

Capture paints a fresh frame and returns packed, top-left RGBA8 pixels. The example
clears its surface before painting, avoiding accumulation of translucent content
between frames. Use the adapter conformance harness to check your own pixel and
state-restoration guarantees.

## Local backend saving and retries

The development server includes a small upload handler in `examples/vite.config.ts`.
The React recipe's **Save to backend** button writes the retained ZIP to
`recordings/examples/<result-id>/<filename>` relative to the repository. It accepts
at most 16 MiB per request, validates names, and makes identical retries idempotent.
It binds to loopback and is a local development recipe, not a production server.
Static hosted examples can render/download, but backend saving requires the local
`examples:dev` server.

Upload failures leave playback and downloading available and show **Retry save**.
Saving uses `RenderResults.save()` separately from the render session. Replace the
`fetch` writer with the host application's authenticated backend client and metadata
schema. Project permissions, database records, rename/copy/delete operations, and
remote retention policies remain application responsibilities.

## Verification

`tests/browser/recipes.spec.ts` renders a real MP4 and checks that the live canvas
keeps its dimensions. It also unmounts the React preview during rendering,
remounts the completed sequence, injects a temporary upload failure, retries it,
and verifies the resulting backend file. These recipes are part of
`npm run test:browser`, not untested documentation snippets.
