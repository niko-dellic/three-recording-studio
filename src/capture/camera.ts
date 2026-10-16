import { Camera, PerspectiveCamera, OrthographicCamera } from "three";
import type { CameraFit } from "../core/types.js";
/** Preserve world transform even when source camera is parented. */
export function fitCamera(
  source: Camera,
  width: number,
  height: number,
  fit: CameraFit = "auto",
): Camera {
  source.updateWorldMatrix(true, false);
  const camera = source.clone();
  source.matrixWorld.decompose(
    camera.position,
    camera.quaternion,
    camera.scale,
  );
  camera.parent = null;
  camera.matrix.copy(source.matrixWorld);
  camera.updateMatrixWorld(true);
  const aspect = width / height;
  if (
    camera instanceof PerspectiveCamera &&
    source instanceof PerspectiveCamera
  ) {
    // Auto uses a virtual square sensor: the source's larger image dimension anchors FOV.
    const vertical =
      2 * Math.atan(Math.tan((source.fov * Math.PI) / 360) / source.zoom);
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * source.aspect);
    const anchor =
      fit === "auto"
        ? source.aspect >= 1
          ? horizontal
          : vertical
        : fit === "horizontal"
          ? horizontal
          : vertical;
    const useHorizontal =
      fit === "horizontal" || (fit === "auto" && aspect >= 1);
    camera.zoom = 1;
    camera.fov =
      ((useHorizontal ? 2 * Math.atan(Math.tan(anchor / 2) / aspect) : anchor) *
        180) /
      Math.PI;
    camera.aspect = aspect;
    camera.clearViewOffset();
    camera.updateProjectionMatrix();
  } else if (
    camera instanceof OrthographicCamera &&
    source instanceof OrthographicCamera
  ) {
    const sw = (source.right - source.left) / source.zoom,
      sh = (source.top - source.bottom) / source.zoom;
    const horizontal = fit === "horizontal" || (fit === "auto" && aspect >= 1);
    const anchor = fit === "auto" ? Math.max(sw, sh) : horizontal ? sw : sh;
    const w = horizontal ? anchor : anchor * aspect,
      h = horizontal ? anchor / aspect : anchor;
    const cx = (source.left + source.right) / 2,
      cy = (source.top + source.bottom) / 2;
    camera.left = cx - w / 2;
    camera.right = cx + w / 2;
    camera.top = cy + h / 2;
    camera.bottom = cy - h / 2;
    camera.zoom = 1;
    camera.clearViewOffset();
    camera.updateProjectionMatrix();
  } else
    throw new Error("Only perspective and orthographic cameras are supported");
  return camera;
}
