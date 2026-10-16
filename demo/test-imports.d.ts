declare module "/test-harness.ts" {
  export function verifyCapture(
    backend: "webgl" | "webgpu",
    transparent: boolean,
  ): Promise<any>;
  export function verifyMp4(): Promise<any>;
}
