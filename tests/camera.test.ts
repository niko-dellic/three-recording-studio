import { describe, it, expect } from "vitest";
import { PerspectiveCamera, OrthographicCamera, Group, Vector3 } from "three";
import { fitCamera } from "../src/capture/camera";
const vertical = (camera: PerspectiveCamera) =>
  Math.tan((camera.fov * Math.PI) / 360) / camera.zoom;
describe("camera fit", () => {
  it("preserves horizontal framing for landscape auto and leaves the source unchanged", () => {
    const source = new PerspectiveCamera(50, 4 / 3);
    const result = fitCamera(source, 3840, 1280) as PerspectiveCamera;
    expect(vertical(result) * result.aspect).toBeCloseTo(
      vertical(source) * source.aspect,
    );
    expect(result.fov).toBeLessThan(source.fov);
    expect(source.aspect).toBe(4 / 3);
  });
  it("vertical fit reveals more horizontally", () => {
    const source = new PerspectiveCamera(50, 4 / 3);
    const result = fitCamera(
      source,
      3840,
      1280,
      "vertical",
    ) as PerspectiveCamera;
    expect(result.fov).toBeCloseTo(50);
    expect(result.aspect).toBe(3);
  });
  it("auto uses the same sensor anchor when switching to portrait", () => {
    const source = new PerspectiveCamera(50, 4 / 3);
    const result = fitCamera(source, 1280, 3840) as PerspectiveCamera;
    expect(vertical(result)).toBeCloseTo(vertical(source) * source.aspect);
  });
  it("keeps a parented camera world transform", () => {
    const parent = new Group();
    parent.position.set(3, 2, 1);
    const source = new PerspectiveCamera();
    source.position.set(0, 1, 2);
    parent.add(source);
    const result = fitCamera(source, 100, 100);
    expect(result.getWorldPosition(new Vector3()).toArray()).toEqual([3, 3, 3]);
    expect(result.parent).toBeNull();
  });
  it("fits orthographic output without changing the source", () => {
    const source = new OrthographicCamera(-2, 2, 1.5, -1.5);
    const result = fitCamera(source, 300, 100) as OrthographicCamera;
    expect(result.right - result.left).toBe(4);
    expect(result.top - result.bottom).toBeCloseTo(4 / 3);
  });
});
