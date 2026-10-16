import type {
  CapturedFrame,
  FrameContext,
  RenderDestination,
  RenderJob,
} from "../core/types.js";
import { pngBlob } from "./pixels.js";
export interface WebSocketDestinationOptions {
  url: string;
  token: string;
  timeoutMs?: number;
}
export class WebSocketDestination implements RenderDestination {
  private socket?: WebSocket;
  private signal?: AbortSignal;
  private job?: RenderJob;
  private pending?: {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  private abortListener = () => {
    this.fail(new Error("Cancelled"));
    this.socket?.close();
  };
  constructor(private readonly options: WebSocketDestinationOptions) {}
  private fail(error: Error) {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(error);
      this.pending = undefined;
    }
  }
  private request(message: unknown): Promise<any> {
    if (this.pending)
      return Promise.reject(
        new Error("Only one receiver request may be in flight"),
      );
    this.signal?.throwIfAborted();
    if (this.socket?.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error("Receiver is not connected"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new Error("Receiver acknowledgement timed out"));
        this.socket?.close();
      }, this.options.timeoutMs ?? 30000);
      this.pending = { resolve, reject, timer };
      try {
        this.socket!.send(
          typeof message === "string" || message instanceof Blob
            ? message
            : JSON.stringify(message),
        );
      } catch (error) {
        this.fail(error as Error);
      }
    });
  }
  async open(job: RenderJob, signal: AbortSignal) {
    this.signal = signal;
    this.job = job;
    signal.throwIfAborted();
    const socket = (this.socket = new WebSocket(this.options.url));
    signal.addEventListener("abort", this.abortListener, { once: true });
    socket.addEventListener("message", (event) => {
      try {
        const value = JSON.parse(event.data);
        if (value.error) {
          this.fail(new Error(value.error));
          return;
        }
        if (this.pending) {
          clearTimeout(this.pending.timer);
          this.pending.resolve(value);
          this.pending = undefined;
        }
      } catch {
        this.fail(new Error("Invalid receiver response"));
      }
    });
    socket.addEventListener("close", () =>
      this.fail(new Error("Receiver disconnected")),
    );
    socket.addEventListener("error", () =>
      this.fail(new Error("Receiver connection failed")),
    );
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error("Receiver connection timed out"));
      }, this.options.timeoutMs ?? 30000);
      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(new Error("Cannot connect to receiver"));
        },
        { once: true },
      );
      socket.addEventListener(
        "close",
        () => {
          clearTimeout(timer);
          reject(new Error("Receiver disconnected"));
        },
        { once: true },
      );
    });
    const response = await this.request({
      type: "open",
      token: this.options.token,
      job,
    });
    if (response.type !== "opened" || !Array.isArray(response.saved))
      throw new Error("Invalid receiver handshake");
    return new Set<number>(response.saved);
  }
  async write(frame: CapturedFrame, context: FrameContext) {
    const png = await pngBlob(frame);
    context.signal.throwIfAborted();
    // Four-byte little-endian frame index followed by PNG bytes.
    const header = new ArrayBuffer(4);
    new DataView(header).setUint32(0, context.frame, true);
    const response = await this.request(new Blob([header, png]));
    if (response.type !== "saved" || response.frame !== context.frame)
      throw new Error("Receiver acknowledged a different frame");
  }
  async close() {
    await this.request({ type: "finish" });
    this.disconnect();
  }
  async abort() {
    this.disconnect();
  }
  private disconnect() {
    this.signal?.removeEventListener("abort", this.abortListener);
    this.fail(new Error("Destination closed"));
    this.socket?.close();
    this.socket = undefined;
  }
}
