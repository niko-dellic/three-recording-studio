import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import {
  RenderController,
  RenderResults,
  RenderSession,
  type RenderResult,
} from "three-recording-studio/core";
import { MemorySequenceDestination } from "three-recording-studio/destinations";
import {
  RenderPreview,
  RenderSettingsView,
  RenderTransport,
  RenderProgress,
} from "three-recording-studio/ui";
import { createReplay } from "./replay";
import "three-recording-studio/ui/style.css";
import "../style.css";

// Application lifetime is deliberately outside the React view lifetime.
const results = new RenderResults();
const session = new RenderSession(createReplay());
const controller = new RenderController({
  session,
  results,
  job: {
    id: "replay",
    fileName: "replay",
    contentId: "bars-v1",
    width: 320,
    height: 180,
    fps: 10,
    startFrame: 0,
    endFrame: 19,
    transparent: false,
  },
  destination: (job) =>
    new MemorySequenceDestination({
      onComplete(sequence) {
        controller.addResult({
          blob: sequence.archive,
          filename: `${job.fileName}.zip`,
          sequence,
          job,
        });
      },
    }),
});
void controller
  .inspect(new MemorySequenceDestination({ onComplete() {} }))
  .catch((error) => {
    if (error?.name !== "AbortError") controller.reportError(error);
  });

function Preview() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const view = new RenderPreview({ container: host.current!, controller });
    return () => view.dispose(); // Never dispose the session on a pane unmount.
  }, []);
  return <div className="preview" ref={host} />;
}
function Controls() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const settings = new RenderSettingsView({
      container: host.current!,
      controller,
      controls: { cameraFit: false },
    });
    const transport = new RenderTransport({
      container: host.current!,
      controller,
    });
    const progress = new RenderProgress({
      container: host.current!,
      controller,
    });
    return () => {
      settings.dispose();
      transport.dispose();
      progress.dispose();
    };
  }, []);
  return <div className="controls" ref={host} />;
}
function Save({ result }: { result: RenderResult }) {
  const state = useSyncExternalStore(results.subscribe, () =>
    results.getSaveState(result.id),
  );
  const save = async () => {
    try {
      if (state.state === "failed") await results.retry(result.id);
      else
        await results.save(result.id, async (recording, signal) => {
          const response = await fetch(
            `/api/recordings/${recording.id}/${encodeURIComponent(recording.filename)}`,
            { method: "POST", body: recording.blob, signal },
          );
          if (!response.ok)
            throw new Error(
              `Backend save failed (${response.status}). Run npm run examples:dev for the local backend.`,
            );
        });
    } catch {
      /* The result remains retained; the observable save state displays the error. */
    }
  };
  return (
    <section>
      <p>{result.filename}</p>
      <button onClick={() => void save()} disabled={state.state === "saving"}>
        {state.state === "failed" ? "Retry save" : "Save to backend"}
      </button>
      <p role="status">{state.error ?? state.state}</p>
    </section>
  );
}
function App() {
  const [visible, setVisible] = useState(true);
  const recordings = useSyncExternalStore(
    results.subscribe,
    results.getSnapshot,
  );
  return (
    <>
      <a href="../">Recipes</a>
      <h1>React asynchronous replay</h1>
      <p>
        Hide and remount the preview during rendering; the session and completed
        results stay alive.
      </p>
      <main>
        <section>
          <button onClick={() => setVisible((value) => !value)}>
            {visible ? "Hide preview" : "Show preview"}
          </button>
          {visible && <Preview />}
          {recordings.map((result) => (
            <Save key={result.id} result={result} />
          ))}
        </section>
        <aside>
          <Controls />
        </aside>
      </main>
    </>
  );
}
const root = createRoot(document.querySelector("#root")!);
root.render(<App />);
window.addEventListener(
  "pagehide",
  () => {
    root.unmount();
    controller.dispose();
    void session.dispose().finally(() => results.dispose());
  },
  { once: true },
);
Object.assign(window, { recipe: { session, controller, results } });
