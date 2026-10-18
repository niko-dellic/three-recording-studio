import * as THREE from "three";
import { RenderSession } from "three-recording-studio/core";
import { WebGLCaptureAdapter } from "three-recording-studio/capture/webgl";
import { RenderPanel } from "three-recording-studio/ui";
import {
  createRecordingDestination,
  MemoryFileStorage,
} from "three-recording-studio/destinations";
import "three-recording-studio/ui/style.css";
import "../style.css";

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(560, 280, false);
const scene = new THREE.Scene();
scene.background = new THREE.Color("#202020");
const camera = new THREE.PerspectiveCamera(45, 2, 0.1, 100);
camera.position.z = 4;
const geometry = new THREE.BoxGeometry();
const material = new THREE.MeshNormalMaterial();
const cube = new THREE.Mesh(geometry, material);
scene.add(cube);
let time = 0,
  exporting = false,
  live = 0;
function evaluate(value: number) {
  time = value;
  cube.rotation.set(value * 0.4, value, 0);
}
function tick() {
  live = requestAnimationFrame(tick);
  if (!exporting) {
    evaluate(time + 1 / 60);
    renderer.render(scene, camera);
  }
}
tick();
const session = new RenderSession({
  capture: new WebGLCaptureAdapter({ renderer, scene, camera }),
  animation: {
    acquire() {
      const snapshot = time;
      exporting = true;
      return snapshot;
    },
    seek({ time }) {
      evaluate(time);
    },
    restore(snapshot) {
      evaluate(snapshot as number);
      exporting = false;
    },
  },
});
const panel = new RenderPanel({
  container: document.querySelector<HTMLElement>("#controls")!,
  previewContainer: document.querySelector<HTMLElement>("#preview")!,
  session,
  allowFloating: false,
  job: {
    id: "cube",
    fileName: "cube",
    contentId: "cube-v1",
    width: 640,
    height: 360,
    fps: 30,
    startFrame: 0,
    endFrame: 29,
    transparent: false,
  },
  destination: (job) =>
    createRecordingDestination({
      format: "mp4",
      storage: new MemoryFileStorage({
        onComplete(files) {
          const file = files[0];
          panel.recording.addResult({
            blob: file.blob,
            filename: file.filename,
            job,
          });
        },
      }),
    }),
});
// Inspect without opening storage; subsequent dimension edits are rechecked.
void createRecordingDestination({
  format: "mp4",
  storage: new MemoryFileStorage(),
})
  .then((destination) => panel.recording.inspect(destination))
  .catch((error) => {
    if (error?.name !== "AbortError") panel.recording.reportError(error);
  });
window.addEventListener(
  "pagehide",
  () => {
    cancelAnimationFrame(live);
    panel.dispose();
    void session.dispose().finally(() => {
      renderer.dispose();
      geometry.dispose();
      material.dispose();
    });
  },
  { once: true },
);
Object.assign(window, { recipe: { session, controller: panel.recording } });
