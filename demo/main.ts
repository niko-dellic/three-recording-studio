import * as THREE from "three";
import { WebGPURenderer, ClippingGroup } from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Workspace, themeFamilies, defaultShortcuts } from "quilt-vanilla";
import { ThreeSession, CameraHelpers } from "quilt-three";
import type { PaneContext } from "quilt-vanilla";
import type { Layout } from "quilt-core";
import type { AnimationRuntime } from "./keyframes";

import {
  RenderSession,
  fitCamera,
  type RenderJob,
  WebGLCaptureAdapter,
  WebGPUCaptureAdapter,
  WebSocketDestination,
  DirectoryDestination,
} from "three-recording-studio";
import { RenderPanel } from "three-recording-studio/ui";
import { Mp4Destination } from "three-recording-studio/encoding";
import { renderIcon } from "./icons";

import { CameraViewSettings } from "./camera-view";

async function main() {
  for (const element of document.querySelectorAll<HTMLElement>(
    "[data-site-icon]",
  )) {
    const icon = renderIcon(element.dataset.siteIcon!, document);
    if (icon) element.replaceChildren(icon);
  }
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      location.href = "/?search=1";
    }
  });
  const preferredMode = document.documentElement.classList.contains("light")
    ? "light"
    : "dark";
  // Keep the editor document mounted so both workspaces share one Theatre runtime.
  const editorFrame = document.createElement("iframe");
  editorFrame.title = "Keyframe editor";
  editorFrame.className = "keyframe-editor-frame";
  const editorLoaded = new Promise<void>((resolve, reject) => {
    editorFrame.onload = () => resolve();
    editorFrame.onerror = () =>
      reject(new Error("Could not load the keyframe editor"));
  });
  editorFrame.src = `${import.meta.env.BASE_URL}keyframes.html`;
  document.querySelector("#studio-workspace")!.append(editorFrame);
  await editorLoaded;
  const { studio, project, sheet, driver, animated, animatedCamera } = await (
    editorFrame.contentWindow as unknown as {
      animationRuntime: Promise<AnimationRuntime>;
    }
  ).animationRuntime;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#262626");
  const camera = new THREE.PerspectiveCamera(38, 4 / 3, 0.1, 100);
  camera.name = "Main camera";
  camera.position.set(3.2, 2.1, 5.8);
  camera.lookAt(0, 0.4, 0);
  const sideCamera = new THREE.PerspectiveCamera(38, 4 / 3, 0.1, 100);
  sideCamera.name = "Side camera";
  sideCamera.position.set(-4, 1.4, 5);
  sideCamera.lookAt(0, 0, 0);
  scene.add(camera, sideCamera);
  let renderCamera: THREE.Camera = camera;
  const orbitCamera = sideCamera;
  orbitCamera.position.set(15, 11, 19);
  orbitCamera.fov = 55;
  orbitCamera.updateProjectionMatrix();
  orbitCamera.lookAt(0, 0, 0);
  const viewportCamera = camera.clone();
  const renderViewportCamera = camera.clone();
  const bunnyAsset = await new GLTFLoader().loadAsync(
    `${import.meta.env.BASE_URL}models/bunny.glb`,
  );
  const geometry = (bunnyAsset.scene.children[0] as THREE.Mesh).geometry;
  geometry.computeBoundingBox();
  const size = geometry.boundingBox!.getSize(new THREE.Vector3());
  geometry.center();
  geometry.scale(2.4 / size.y, 2.4 / size.y, 2.4 / size.y);
  geometry.computeVertexNormals();
  const clippingPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1.35);
  const material = new THREE.MeshStandardMaterial({
    color: "#dedbd4",
    roughness: 0.6,
    side: THREE.DoubleSide,
  });
  const bunny = new THREE.Mesh(geometry, material);
  const planeGuide = new THREE.Mesh(
    new THREE.PlaneGeometry(3.5, 2.6),
    new THREE.MeshBasicMaterial({
      color: "#b6c5cd",
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  planeGuide.rotation.x = -Math.PI / 2;
  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(planeGuide.geometry),
    new THREE.LineBasicMaterial({
      color: "#9da9af",
      transparent: true,
      opacity: 0.65,
    }),
  );
  planeGuide.add(outline);
  scene.add(planeGuide);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: "#262626", roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.24;
  scene.add(floor);
  scene.add(new THREE.HemisphereLight("#ffffff", "#777777", 2.5));
  const key = new THREE.DirectionalLight("#fff7eb", 3);
  key.position.set(3, 5, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight("#dce7f0", 2);
  rim.position.set(-4, 2, -3);
  scene.add(rim);
  const gpu = new URLSearchParams(location.search).get("backend") === "webgpu";
  const renderer = gpu
    ? new WebGPURenderer({ antialias: true, alpha: true, stencil: true })
    : new THREE.WebGLRenderer({ antialias: true, alpha: true, stencil: true });
  if (gpu) await (renderer as WebGPURenderer).init();
  // Count clipped back/front faces. The cap only draws where their counts differ.
  const stencilMeshes = [THREE.BackSide, THREE.FrontSide].map((side, index) => {
    const operation =
      index === 0 ? THREE.IncrementWrapStencilOp : THREE.DecrementWrapStencilOp;
    const stencilMaterial = new THREE.MeshBasicMaterial({
      side,
      depthWrite: false,
      depthTest: false,
      colorWrite: false,
      stencilWrite: true,
      stencilFunc: THREE.AlwaysStencilFunc,
      stencilFail: operation,
      stencilZFail: operation,
      stencilZPass: operation,
    });
    const mesh = new THREE.Mesh(geometry, stencilMaterial);
    mesh.renderOrder = index + 1;
    return mesh;
  });
  const cap = new THREE.Mesh(
    new THREE.PlaneGeometry(3.5, 2.6),
    new THREE.MeshStandardMaterial({
      color: "#b87345",
      roughness: 0.75,
      side: THREE.DoubleSide,
      stencilWrite: true,
      stencilRef: 0,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilFail: THREE.ReplaceStencilOp,
      stencilZFail: THREE.ReplaceStencilOp,
      stencilZPass: THREE.ReplaceStencilOp,
    }),
  );
  cap.rotation.x = -Math.PI / 2;
  cap.renderOrder = 3;
  bunny.renderOrder = 4;
  scene.add(cap);
  if (gpu) {
    const clipped = new ClippingGroup();
    clipped.clippingPlanes = [clippingPlane];
    clipped.add(...stencilMeshes, bunny);
    scene.add(clipped);
  } else {
    (renderer as THREE.WebGLRenderer).localClippingEnabled = true;
    for (const mesh of [...stencilMeshes, bunny])
      mesh.material.clippingPlanes = [clippingPlane];
    scene.add(...stencilMeshes, bunny);
  }
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.domElement.className = "scene-canvas";
  const hosts = Object.fromEntries(
    ["scene", "recording", "preview", "settings", "timeline"].map((key) => {
      const element = document.createElement("div");
      element.className = `pane-content ${key === "settings" ? "settings-host" : ""}`;
      return [key, element];
    }),
  );

  const note = document.createElement("div");
  note.className = "scene-note";
  note.textContent = "PERSPECTIVE / Orbit to compose";
  hosts.scene.append(note);
  const renderNote = document.createElement("div");
  renderNote.className = "scene-note";
  hosts.recording.append(renderNote);
  const viewportControls = new Set<OrbitControls<THREE.Camera>>();
  let playing = false,
    exclusive = false,
    position = 0,
    raf = 0,
    previous = 0,
    studioVisible = false;
  let appliedTime = -1;
  let appliedAngle = NaN;
  const apply = (time: number, forceCamera = true) => {
    sheet.sequence.position = time;
    driver.tick(time * 1000);
    const value = animated.value;
    clippingPlane.constant = value.height;
    planeGuide.position.y = value.height;
    cap.position.y = value.height;
    if (
      forceCamera ||
      time !== appliedTime ||
      animatedCamera.value.angle !== appliedAngle
    ) {
      const angle = animatedCamera.value.angle + Math.atan2(3.2, 5.8);
      camera.position.set(Math.sin(angle) * 6.62, 2.1, Math.cos(angle) * 6.62);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld(true);
    }
    appliedTime = time;
    appliedAngle = animatedCamera.value.angle;
  };
  apply(0);
  const capture = gpu
    ? new WebGPUCaptureAdapter({
        renderer: renderer as WebGPURenderer,
        stencil: true,
        scene,
        camera: () => renderCamera,
      })
    : new WebGLCaptureAdapter({
        renderer: renderer as THREE.WebGLRenderer,
        stencil: true,
        scene,
        camera: () => renderCamera,
      });
  const session = new RenderSession({
    capture,
    animation: {
      acquire() {
        const snapshot = { position, playing, background: scene.background };
        exclusive = true;
        playing = false;
        for (const controls of viewportControls) controls.enabled = false;
        editorFrame.style.visibility = "hidden";
        scene.background = panel.getJob().transparent
          ? null
          : new THREE.Color("#262626");
        return snapshot;
      },
      seek({ time }) {
        apply(time);
        scrub.value = String(time);
        timeOutput.textContent = `${time.toFixed(2)}s`;
      },
      restore(value) {
        const saved = value as {
          position: number;
          playing: boolean;
          background: THREE.Scene["background"];
        };
        position = saved.position;
        playing = saved.playing;
        scene.background = saved.background;
        apply(position);
        exclusive = false;
        for (const controls of viewportControls) controls.enabled = true;
        previous = performance.now();
        resize();
      },
    },
  });
  const destination = document.createElement("div");
  destination.className = "destination";
  destination.innerHTML = `<label class="studio-outlined-field"><span>Save as</span><select id="format"><option value="mp4">MP4</option><option value="frames">PNG sequence</option></select></label><div id="png-fields" hidden><label class="studio-outlined-field"><span>PNG destination</span><select id="png-destination"><option value="folder">Folder</option><option value="receiver">Receiver URL</option></select></label><div id="folder-fields"><button id="pick-folder" type="button">Choose folder…</button><small id="folder-status" role="status">No folder selected</small></div></div><form id="receiver-fields" hidden><label>Receiver URL<input id="receiver-url" value="ws://127.0.0.1:8787"></label><label>Session token<input id="receiver-token" type="password" autocomplete="off" placeholder="Paste token from receiver terminal"></label><small>Run: npx three-recording-studio --directory ./recordings</small></form>`;
  const settingsSection = (title: string, content: HTMLElement) => {
    const section = document.createElement("details");
    section.className = "trs-accordion";
    section.open = true;
    const summary = document.createElement("summary");
    summary.textContent = title;
    section.append(summary, content);
    return section;
  };

  destination
    .querySelector<HTMLFormElement>("#receiver-fields")!
    .addEventListener("submit", (event) => event.preventDefault());
  const select = destination.querySelector<HTMLSelectElement>("#format")!;
  const pngDestination =
    destination.querySelector<HTMLSelectElement>("#png-destination")!;
  const picker = destination.querySelector<HTMLButtonElement>("#pick-folder")!;
  const folderStatus =
    destination.querySelector<HTMLElement>("#folder-status")!;
  const pickerWindow = window as Window & {
    showDirectoryPicker?: (options: {
      mode: "readwrite";
    }) => Promise<FileSystemDirectoryHandle>;
  };
  let directory: FileSystemDirectoryHandle | undefined;
  if (!pickerWindow.showDirectoryPicker) {
    pngDestination.value = "receiver";
    pngDestination.options[0].disabled = true;
    folderStatus.textContent =
      "Folder picking is unavailable in this browser. Use the receiver URL.";
  }
  const syncDestination = () => {
    destination.querySelector<HTMLElement>("#png-fields")!.hidden =
      select.value !== "frames";
    destination.querySelector<HTMLElement>("#folder-fields")!.hidden =
      pngDestination.value !== "folder";
    destination.querySelector<HTMLElement>("#receiver-fields")!.hidden =
      select.value !== "frames" || pngDestination.value !== "receiver";
  };
  select.onchange = syncDestination;
  pngDestination.onchange = syncDestination;
  picker.onclick = async () => {
    try {
      const selected = await pickerWindow.showDirectoryPicker!({
        mode: "readwrite",
      });
      directory = selected;
      folderStatus.textContent = selected.name;
    } catch (error) {
      if ((error as Error).name !== "AbortError")
        folderStatus.textContent = `Could not open folder: ${(error as Error).message}`;
    }
  };
  const createPngDestination = () => {
    if (pngDestination.value === "folder") {
      if (!directory) throw new Error("Choose a folder before rendering PNGs.");
      return new DirectoryDestination(directory);
    }
    return new WebSocketDestination({
      url: destination.querySelector<HTMLInputElement>("#receiver-url")!.value,
      token:
        destination.querySelector<HTMLInputElement>("#receiver-token")!.value,
    });
  };
  syncDestination();
  const createDestination = async (job: RenderJob) => {
    const content = JSON.stringify({
      version: 3,
      // Save-file revisions and object UUIDs are bookkeeping, not visual inputs.
      animation: (
        studio.createContentOfSaveFile(project.address.projectId) as {
          sheetsById: unknown;
        }
      ).sheetsById,
      camera: (() => {
        renderCamera.updateWorldMatrix(true, false);
        return {
          matrix: renderCamera.matrixWorld.toArray(),
          projection: renderCamera.projectionMatrix.toArray(),
          type: renderCamera.type,
        };
      })(),
      threeRevision: THREE.REVISION,
      toneMapping: renderer.toneMapping,
      exposure: renderer.toneMappingExposure,
      backend: gpu ? "webgpu" : "webgl",
    });
    job.contentId = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(content),
        ),
      ),
    )
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
    if (select.value === "frames") return createPngDestination();
    const channel = panel.channel;
    return new Mp4Destination({
      onComplete(blob) {
        panel.addResult(blob, `${job.fileName ?? job.id}.mp4`, channel);
      },
    });
  };
  const panelHost = document.createElement("div");
  hosts.settings.append(panelHost);
  const panel: RenderPanel = new RenderPanel({
    container: panelHost,
    renderIcon,
    allowFloating: false,
    imageDestination: (job) =>
      select.value === "frames" ? createDestination(job) : undefined,
    currentFrame: () => Math.round(position * panel.getJob().fps),
    previewContainer: hosts.preview,
    session,
    job: {
      id: "bunny-01",
      contentId: "bunny-v2",
      transparent: true,
      width: 1280,
      height: 720,
      fps: 30,
      startFrame: 0,
      endFrame: 179,
      cameraFit: "auto",
    },
    destination: createDestination,
  });
  const syncTransparency = () =>
    panel.setTransparencySupported(select.value !== "mp4");
  select.addEventListener("change", syncTransparency);
  syncTransparency();
  const cameraSettings = new CameraViewSettings(
    scene,
    [camera, sideCamera],
    (selected) => {
      renderCamera = selected;
    },
  );
  const secondaryCamera = () =>
    renderCamera === sideCamera ? camera : sideCamera;
  hosts.settings.prepend(
    settingsSection("Camera and guides", cameraSettings.element),
  );
  hosts.scene.append(cameraSettings.viewportToolbar);
  hosts.recording.append(cameraSettings.overlay);
  panel.element.querySelector(".trs-accordion > summary")!.after(destination);
  hosts.timeline.innerHTML = `<div class="timeline"><div class="timeline-top"><span>Bunny / clipping plane + camera orbit</span><span>180 frames · 30 fps</span></div><div class="timeline-row"><div class="transport"><button id="play" aria-label="Play" title="Play"></button><output id="time">0.00s</output></div><div class="timeline-scrubber"><input id="scrub" aria-label="Animation time" type="range" min="0" max="6" step="0.0333333" value="0"><div class="timeline-ruler"><span>0s</span><span>1s</span><span>2s</span><span>3s</span><span>4s</span><span>5s</span><span>6s</span></div></div></div><div class="timeline-track"><i class="keyframe" style="left:0"></i><i class="keyframe" style="left:50%"></i><i class="keyframe" style="left:99%"></i></div></div>`;
  const scrub = hosts.timeline.querySelector<HTMLInputElement>("#scrub")!,
    timeOutput = hosts.timeline.querySelector<HTMLOutputElement>("#time")!,
    play = hosts.timeline.querySelector<HTMLButtonElement>("#play")!;
  let displayedPlaying: boolean | undefined;
  const syncPlay = () => {
    if (displayedPlaying === playing) return;
    displayedPlaying = playing;
    play.setAttribute("aria-label", playing ? "Pause" : "Play");
    play.title = playing ? "Pause" : "Play";
    play.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">${playing ? '<path d="M6 4h4v16H6zm8 0h4v16h-4z"/>' : '<path d="m7 4 14 8-14 8z"/>'}</svg>`;
  };
  syncPlay();
  play.onclick = () => {
    playing = !playing;
    syncPlay();
  };

  scrub.oninput = () => {
    position = Number(scrub.value);
    apply(position);
  };
  const group = (id: string) => ({
    kind: "group" as const,
    id: `${id}-group`,
    panes: [id],
    active: id,
    dedicatedPaneId: id,
  });
  const liveViews = () => ({
    kind: "split" as const,
    id: "live-cameras",
    axis: "vertical" as const,
    ratio: 0.68,
    children: [group("scene"), group("recording")] as [
      ReturnType<typeof group>,
      ReturnType<typeof group>,
    ],
  });
  const layout: Layout = {
    version: 1,
    panes: Object.fromEntries(
      Object.keys(hosts).map((id) => [
        id,
        {
          id,
          type: id,
          icon: {
            scene: "canvas",
            recording: "camera-helper",
            preview: "camera-helper",
            settings: "settings",
            timeline: "timeline",
          }[id],
          title: {
            scene: "Secondary camera",
            recording: "Render camera viewport",
            preview: "Render preview",
            settings: "Render settings",
            timeline: "Animation",
          }[id]!,
          capabilities: { close: true, popout: true },
        },
      ]),
    ),
    root: {
      kind: "split",
      id: "main",
      axis: "horizontal",
      ratio: 0.76,
      children: [
        {
          kind: "split",
          id: "left",
          axis: "vertical",
          ratio: 0.77,
          children: [
            {
              kind: "split",
              id: "views",
              axis: "horizontal",
              ratio: 0.52,
              children: [liveViews(), group("preview")],
            },
            group("timeline"),
          ],
        },
        group("settings"),
      ],
    },
    popouts: [],
    maximized: null,
  };
  const viewportSession = new ThreeSession({
    scene,
    window,
    requestFrame: () => {},
    createRenderer: async (canvas) => {
      const viewportRenderer = gpu
        ? new WebGPURenderer({ canvas, antialias: true, stencil: true })
        : new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true });
      if (viewportRenderer instanceof WebGPURenderer)
        await viewportRenderer.init();
      else viewportRenderer.localClippingEnabled = true;
      viewportRenderer.toneMapping = THREE.ACESFilmicToneMapping;
      return viewportRenderer;
    },
  });
  const cameraHelpers = new CameraHelpers(viewportSession, {
    cameras: [camera, sideCamera],
    ray: "center",
    maxDistance: 12,
    visibleIn: (viewCamera) => viewCamera === viewportCamera,
  });
  hosts.keyframes = document.createElement("div");
  hosts.keyframes.className = "pane-content keyframes-host";
  const editorPane = {
    id: "keyframes",
    type: "keyframes",
    title: "Keyframe editor",
    icon: "timeline",
    capabilities: { popout: false, close: false },
  };
  const workspace: Workspace = new Workspace({
    container: document.querySelector<HTMLElement>("#workspace")!,
    initialLayout: layout,
    resizeMode: "border",
    shortcuts: defaultShortcuts,
    tabBar: { attachment: "floating", fit: "fit" },
    renderIcon,
    theme: {
      ...themeFamilies.neutral[preferredMode],
      fontSize: "11px",
      headerHeight: "32px",
      cornerHandleDisplay: "none",
    },
    paneTypes: Object.fromEntries(
      Object.keys(hosts).map((id) => [
        id,
        {
          title: (layout.panes[id] ?? editorPane).title,
          icon: (layout.panes[id] ?? editorPane).icon,
          create: () =>
            Object.values(workspace.exportLayout().panes).some(
              (pane) => pane.type === id,
            )
              ? undefined
              : { ...(layout.panes[id] ?? editorPane) },
          render: (context: PaneContext) => {
            context.element.append(hosts[id]);
            if (id !== "scene" && id !== "recording") return;
            const recordingView = id === "recording";
            return viewportSession.register(
              { ...context, element: hosts[id] },
              {
                camera: recordingView ? renderViewportCamera : viewportCamera,
                controls: ({ element }) => {
                  const controls = new OrbitControls<THREE.Camera>(
                    recordingView ? renderCamera : secondaryCamera(),
                    element,
                  );
                  controls.target.set(0, 0, 0);
                  viewportControls.add(controls);
                  return {
                    get enabled() {
                      return controls.enabled;
                    },
                    set enabled(value) {
                      controls.enabled = value;
                    },
                    update() {
                      controls.object = recordingView
                        ? renderCamera
                        : secondaryCamera();
                      controls.enabled =
                        !exclusive && (!playing || !recordingView);
                    },
                    dispose() {
                      viewportControls.delete(controls);
                      controls.dispose();
                    },
                  };
                },
                pipeline: (viewportRenderer) => ({
                  resize() {},
                  dispose() {},
                  render({ width, height }) {
                    if (exclusive) return;
                    const job = panel.getJob();
                    const fitted = fitCamera(
                      renderCamera,
                      job.width,
                      job.height,
                      job.cameraFit,
                    );
                    // WebGPU rebuilds projections when the coordinate system changes.
                    // Do that before applying the preview frame's custom X/Y scale.
                    fitted.coordinateSystem = viewportRenderer.coordinateSystem;
                    if (
                      fitted instanceof THREE.PerspectiveCamera ||
                      fitted instanceof THREE.OrthographicCamera
                    ) {
                      fitted.updateProjectionMatrix();
                    }
                    const view = recordingView
                      ? cameraSettings.update(
                          fitted,
                          width,
                          height,
                          job.width / job.height,
                        )
                      : undefined;
                    const observer = secondaryCamera().clone();
                    observer.aspect = width / height;
                    observer.updateProjectionMatrix();

                    viewportRenderer.render(scene, view ?? observer);
                  },
                }),
              },
            );
          },
        },
      ]),
    ),
  });
  const compact = matchMedia("(max-width: 760px)");
  let desktopLayout = layout;
  const adaptLayout = () => {
    if (studioVisible) return;
    if (compact.matches) {
      desktopLayout = workspace.exportLayout();
      workspace.loadLayout({
        ...layout,
        root: {
          kind: "group",
          id: "mobile-group",
          panes: ["scene", "recording", "preview", "settings", "timeline"],
          active: "scene",
        },
      });
    } else workspace.loadLayout(desktopLayout);
  };
  compact.addEventListener("change", adaptLayout);
  if (compact.matches) adaptLayout();
  const timelineContent =
    hosts.timeline.querySelector<HTMLElement>(".timeline")!;
  const fitTimeline = () => {
    if (compact.matches || !timelineContent.isConnected) return;
    const height = Math.ceil(timelineContent.getBoundingClientRect().height);
    const pane = workspace.exportLayout().panes.timeline;
    if (height > 0 && pane && pane.size?.minHeight !== height) {
      workspace.getPane("timeline")?.update({
        ...pane,
        size: { ...pane.size, minHeight: height, maxHeight: height },
      });
    }
  };
  const timelineObserver = new ResizeObserver(fitTimeline);
  timelineObserver.observe(timelineContent);
  compact.addEventListener("change", fitTimeline);
  fitTimeline();
  const resize = () => {
    if (exclusive) return;
    viewportSession.invalidate();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(hosts.scene);
  observer.observe(hosts.recording);
  resize();
  const backend = document.querySelector<HTMLSelectElement>("#backend")!;
  backend.value = gpu ? "webgpu" : "webgl";
  backend.onchange = () => {
    location.search = `?backend=${backend.value}`;
  };
  const workspaceButtons =
    document.querySelectorAll<HTMLButtonElement>("[data-workspace]");
  let renderingLayout = workspace.exportLayout();
  const keyframeLayout: Layout = {
    version: 1,
    panes: {
      scene: layout.panes.scene,
      recording: layout.panes.recording,
      keyframes: editorPane,
    },
    root: {
      kind: "split",
      id: "keyframe-split",
      axis: "vertical",
      ratio: 0.38,
      children: [{ ...liveViews(), axis: "horizontal" }, group("keyframes")],
    },
    popouts: [],
    maximized: null,
  };
  let editingLayout = keyframeLayout;
  const selectWorkspace = (editing: boolean) => {
    if (editing === studioVisible) return;
    playing = false;
    sheet.sequence.pause();
    if (editing) renderingLayout = workspace.exportLayout();
    else editingLayout = workspace.exportLayout();
    studioVisible = editing;
    workspaceButtons.forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String((button.dataset.workspace === "keyframes") === editing),
      ),
    );
    editorFrame.style.visibility = "hidden";
    workspace.loadLayout(editing ? editingLayout : renderingLayout);
    fitTimeline();
  };
  workspaceButtons.forEach((button) => {
    button.onclick = () =>
      selectWorkspace(button.dataset.workspace === "keyframes");
  });
  const positionEditor = () => {
    if (!studioVisible || exclusive || !hosts.keyframes.isConnected) {
      editorFrame.style.visibility = "hidden";
      return;
    }
    const rect = hosts.keyframes.getBoundingClientRect();
    Object.assign(editorFrame.style, {
      visibility: "visible",
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  };
  const themeButton = document.querySelector<HTMLButtonElement>("#theme")!;
  const applyTheme = (light: boolean) => {
    editorFrame.contentDocument?.documentElement.classList.toggle(
      "light",
      light,
    );
    document.body.classList.toggle("light", light);
    document.documentElement.classList.toggle("light", light);
    document.documentElement.classList.toggle("dark", !light);
    themeButton.setAttribute("aria-checked", String(!light));
    themeButton.title = light
      ? "Switch to dark theme"
      : "Switch to light theme";
    const icon = renderIcon(light ? "sun" : "moon", document)!;
    themeButton.querySelector(".theme-thumb")!.replaceChildren(icon);
    const theme = themeFamilies.neutral[light ? "light" : "dark"];
    workspace.setTheme({
      ...theme,
      fontSize: "11px",
      headerHeight: "32px",
      cornerHandleDisplay: "none",
    });
    panel.setTheme({
      "color-scheme": light ? "light" : "dark",
      background: theme.panel,
      surface: theme.header,
      text: theme.text,
      muted: theme.muted,
      accent: theme.accent,
      border: theme.line,
    });
  };
  applyTheme(preferredMode === "light");
  themeButton.onclick = () => {
    const light = !document.body.classList.contains("light");
    applyTheme(light);
    try {
      localStorage.setItem(
        "vitepress-theme-appearance",
        light ? "light" : "dark",
      );
    } catch {}
  };
  const fullscreen = document.querySelector<HTMLButtonElement>("#fullscreen")!;
  const syncFullscreen = () => {
    const active = !!document.fullscreenElement;
    fullscreen.setAttribute(
      "aria-label",
      active ? "Exit fullscreen" : "Enter fullscreen",
    );
    fullscreen.title = active ? "Exit fullscreen" : "Enter fullscreen";
    fullscreen.setAttribute("aria-pressed", String(active));
  };
  fullscreen.disabled = !document.fullscreenEnabled;
  fullscreen.onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else
        await document
          .querySelector<HTMLElement>("#studio-workspace")!
          .requestFullscreen();
    } catch (error) {
      document.querySelector("#app-status")!.textContent =
        `Fullscreen unavailable: ${String(error)}`;
    }
  };
  document.addEventListener("fullscreenchange", syncFullscreen);

  session.subscribe((progress) => {
    const busy = ["preparing", "rendering", "paused", "cancelling"].includes(
      progress.state,
    );
    for (const input of destination.querySelectorAll<HTMLInputElement>(
      "input,select,button",
    ))
      input.disabled = busy;
    cameraSettings.setDisabled(busy);
    scrub.disabled = busy;
    play.disabled = busy;
    backend.disabled = busy;
    workspaceButtons.forEach((button) => {
      button.disabled = busy;
    });
    document.querySelector("#app-status")!.textContent =
      `${gpu ? "WebGPU" : "WebGL"} · ${progress.state} · ${progress.completed}/${progress.total}`;
  });
  function tick(now: number) {
    raf = requestAnimationFrame(tick);
    positionEditor();
    if (!exclusive && !session.busy) {
      if (playing) position = (position + (now - previous) / 1000) % 6;
      else position = sheet.sequence.position;
      apply(position, false);
      syncPlay();
      scrub.value = String(position);
      timeOutput.textContent = `${position.toFixed(2)}s`;
      cameraSettings.refresh();
      for (const source of [camera, sideCamera])
        cameraHelpers.setCameraVisible(source, source !== secondaryCamera());
      viewportSession.render(now);
      const job = panel.getJob();
      note.textContent = "Secondary camera · drag to navigate";
      renderNote.textContent = `${renderCamera.name || renderCamera.type} · ${job.width} × ${job.height}`;
    }
    previous = now;
  }
  raf = requestAnimationFrame(tick);
  Object.assign(window, {
    trsDemo: {
      session,
      panel,
      capture,
      renderer,
      scene,
      camera,
      workspace,
      cameraSettings,
      animationRuntime: { studio, project, sheet, animated, animatedCamera },
      viewportSession,
      cameraHelpers,
      orbitCamera,
      get renderCamera() {
        return renderCamera;
      },
      clippingPlane,
      cap,
      stencilMeshes,
      apply,
      get position() {
        return position;
      },
    },
  });
  window.addEventListener(
    "pagehide",
    () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      timelineObserver.disconnect();
      editorFrame.remove();
      document.removeEventListener("fullscreenchange", syncFullscreen);
      compact.removeEventListener("change", adaptLayout);
      cameraHelpers.dispose();
      void viewportSession.dispose();
      panel.dispose();
      workspace.dispose();
      void session.dispose().finally(() => {
        renderer.dispose();
        scene.traverse((object) => {
          const mesh = object as THREE.Mesh;
          if (mesh.geometry) mesh.geometry.dispose();
          if (mesh.material)
            for (const material of Array.isArray(mesh.material)
              ? mesh.material
              : [mesh.material])
              material.dispose();
        });
      });
    },
    { once: true },
  );
}
main().catch((error) => {
  const box = document.querySelector<HTMLElement>("#fatal")!;
  box.hidden = false;
  box.textContent = `${error.message}. Try WebGL mode if WebGPU is unavailable.`;
  console.error(error);
});
