import { getProject, createRafDriver } from "@theatre/core";
import studio from "@theatre/studio";
import { dockTheatre } from "./theatre-dock";
import { animationState } from "./animation";

async function createAnimationRuntime() {
  studio.initialize();
  // The parent iframe controls visibility, so Theatre itself stays restored.
  studio.ui.restore();
  const project = getProject("Three Recording Bunny Cameras", {
    state: animationState,
  });
  await project.ready;
  const sheet = project.sheet("Scene");
  const driver = createRafDriver({ name: "Render clock" });
  const animated = sheet.object("Clipping plane", { height: 1.35 });
  const animatedCamera = sheet.object("Recording camera", { angle: 0 });
  studio.setSelection([animatedCamera]);
  await dockTheatre();
  return { studio, project, sheet, driver, animated, animatedCamera };
}
export type AnimationRuntime = Awaited<
  ReturnType<typeof createAnimationRuntime>
>;
(
  window as unknown as { animationRuntime: Promise<AnimationRuntime> }
).animationRuntime = createAnimationRuntime();
