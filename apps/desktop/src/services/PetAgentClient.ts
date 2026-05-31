import type { LocalEventName, LocalRpcFrame, RpcEvent, RpcRequest, RpcResponse } from "@pet/protocol";

type PendingRequest = {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
};

type EventListener = (event: RpcEvent) => void;
type StatusListener = (status: "ready" | "offline") => void;

export class PetAgentClient {
  private socket: WebSocket | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly eventListeners = new Set<EventListener>();
  private readonly statusListeners = new Set<StatusListener>();

  constructor(private readonly url: string) {}

  connect() {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;

      socket.addEventListener("open", () => {
        this.emitStatus("ready");
        resolve();
      });

      socket.addEventListener("close", () => this.handleClose());
      socket.addEventListener("error", () => {
        this.emitStatus("offline");
        reject(new Error("pet-agentd connection failed"));
      });
      socket.addEventListener("message", (event) => this.handleMessage(event.data as string));
    });
  }

  close() {
    this.socket?.close();
    this.socket = null;
    this.pending.forEach((pending) => pending.reject(new Error("pet-agentd connection closed")));
    this.pending.clear();
  }

  onEvent(listener: EventListener) {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onStatus(listener: StatusListener) {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  request<TPayload>(method: RpcRequest["method"], params?: unknown): Promise<TPayload> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("pet-agentd is not connected"));
    }

    const id = `ui_${crypto.randomUUID()}`;
    const frame: RpcRequest = { type: "req", id, method, params, idempotencyKey: `idem_${crypto.randomUUID()}` };
    socket.send(JSON.stringify(frame));

    return new Promise((resolve, reject) => {
      const timeoutMs = method.startsWith("pet.image.") ? 120_000 : method.startsWith("voice.") ? 60_000 : 12_000;
      this.pending.set(id, {
        resolve: (payload) => resolve(payload as TPayload),
        reject,
      });

      window.setTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        pending.reject(new Error(`${method} timed out`));
      }, timeoutMs);
    });
  }

  private handleMessage(raw: string) {
    const frame = JSON.parse(raw) as LocalRpcFrame;

    if (frame.type === "res") {
      this.handleResponse(frame);
      return;
    }

    if (frame.type === "event") {
      this.eventListeners.forEach((listener) => listener(frame));
    }
  }

  private handleResponse(frame: RpcResponse) {
    const pending = this.pending.get(frame.id);
    if (!pending) return;

    this.pending.delete(frame.id);
    if (frame.ok) {
      pending.resolve(frame.payload);
    } else {
      pending.reject(new Error(frame.error.message));
    }
  }

  private handleClose() {
    this.emitStatus("offline");
    this.pending.forEach((pending) => pending.reject(new Error("pet-agentd connection closed")));
    this.pending.clear();
  }

  private emitStatus(status: "ready" | "offline") {
    this.statusListeners.forEach((listener) => listener(status));
  }
}

export type PetAgentEventHandlerMap = Partial<Record<LocalEventName, EventListener>>;
