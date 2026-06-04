import assert from "node:assert/strict";
import { test } from "node:test";
import type { RpcRequest } from "@pet/protocol";
import { PetAgentClient } from "./PetAgentClient";

class MockWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  static latest: MockWebSocket | null = null;

  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];

  constructor(readonly url: string) {
    super();
    MockWebSocket.latest = this;
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN;
      this.dispatchEvent(new Event("open"));
    });
  }

  send(raw: string) {
    this.sent.push(raw);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }

  receive(data: string) {
    const event = new Event("message") as MessageEvent;
    Object.defineProperty(event, "data", { value: data });
    this.dispatchEvent(event);
  }
}

test("PetAgentClient sends RPC requests and resolves responses", async () => {
  installBrowserMocks();
  const client = new PetAgentClient("ws://test");
  await client.connect();

  const request = client.request("hello", { clientName: "test", protocolVersion: "0.1" });
  const socket = MockWebSocket.latest;
  assert.ok(socket);
  const frame = JSON.parse(socket.sent[0] ?? "") as RpcRequest;
  assert.equal(frame.method, "hello");

  socket.receive(JSON.stringify({ type: "res", id: frame.id, ok: true, payload: { ok: true } }));
  assert.deepEqual(await request, { ok: true });
});

test("PetAgentClient forwards events to listeners", async () => {
  installBrowserMocks();
  const client = new PetAgentClient("ws://test");
  await client.connect();
  const received: string[] = [];
  const dispose = client.onEvent((event) => received.push(event.event));

  MockWebSocket.latest?.receive(
    JSON.stringify({
      type: "event",
      event: "task.changed",
      payload: { action: "created", tasks: [] },
      seq: 1,
      at: "2026-06-04T00:00:00.000Z",
    }),
  );

  dispose();
  assert.deepEqual(received, ["task.changed"]);
});

function installBrowserMocks() {
  Object.defineProperty(globalThis, "WebSocket", { value: MockWebSocket, configurable: true });
  Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });
}
