import assert from "node:assert/strict";
import { test } from "node:test";
import type { A2UIEnvelope, SurfaceSpec } from "@pet/protocol";
import { applyA2UIEnvelope, createA2UIRuntimeState, surfaceSpecToA2UIEnvelopes } from "./a2uiProtocol";

test("A2UI envelopes progressively build and update a SurfaceSpec", () => {
  const runtime = createA2UIRuntimeState();
  const now = "2026-06-04T00:00:00.000Z";

  const create = applyA2UIEnvelope(
    runtime,
    {
      type: "createSurface",
      surfaceId: "surface_weather",
      title: "天气",
      intent: "weather",
      surfaceType: "panel",
      root: "root",
      createdAt: now,
    },
    now,
  );

  assert.equal(create.created, true);
  assert.equal(create.surface?.title, "天气");
  assert.match(JSON.stringify(create.surface?.layout), /正在生成界面/);

  const components = applyA2UIEnvelope(
    runtime,
    {
      type: "updateComponents",
      surfaceId: "surface_weather",
      root: "root",
      components: [
        { id: "root", component: { Card: { child: "body" } } },
        { id: "body", component: { Column: { children: ["summary", "details"] } } },
        { id: "summary", component: { Text: { variant: "body", text: { path: "/summary" } } } },
        { id: "details", kind: "table", columns: [{ key: "name", label: "项目" }, { key: "value", label: "值" }], rows: { path: "/rows" } },
      ],
      actions: [{ id: "refresh", label: "刷新", sourceComponentId: "refresh_button", context: { scope: "weather" } }],
    },
    now,
  );

  assert.equal(components.errors.length, 0);
  assert.equal(components.surface?.actions?.[0]?.context?.scope, "weather");

  const data = applyA2UIEnvelope(
    runtime,
    {
      type: "updateDataModel",
      surfaceId: "surface_weather",
      path: "/",
      value: {
        summary: "上海 22°C，小雨",
        rows: [{ name: "降雨概率", value: "70%" }],
      },
    },
    now,
  );

  assert.equal(data.errors.length, 0);
  assert.match(JSON.stringify(data.surface), /上海 22°C/);
  assert.match(JSON.stringify(data.surface), /降雨概率/);
});

test("A2UI validation rejects component updates before surface creation", () => {
  const runtime = createA2UIRuntimeState();
  const result = applyA2UIEnvelope(runtime, {
    type: "updateComponents",
    surfaceId: "missing",
    components: [{ id: "root", component: { Text: { text: "hello" } } }],
  });

  assert.equal(result.surface, undefined);
  assert.equal(result.errors[0]?.code, "VALIDATION_FAILED");
});

test("surfaceSpecToA2UIEnvelopes round-trips existing SurfaceSpec", () => {
  const surface: SurfaceSpec = {
    id: "surface_chart",
    type: "panel",
    intent: "chat",
    title: "图表",
    layout: {
      kind: "stack",
      direction: "column",
      gap: "md",
      children: [
        { kind: "text", variant: "body", text: "占比分布" },
        { kind: "pie-chart", segments: [{ label: "A", value: 60 }, { label: "B", value: 40 }] },
      ],
    },
    actions: [{ id: "refine", label: "继续细化" }],
    createdAt: "2026-06-04T00:00:00.000Z",
  };

  const runtime = createA2UIRuntimeState();
  let latest: SurfaceSpec | undefined;
  for (const envelope of surfaceSpecToA2UIEnvelopes(surface)) {
    const result = applyA2UIEnvelope(runtime, envelope as A2UIEnvelope, surface.createdAt);
    if (result.surface) latest = result.surface;
  }

  assert.equal(latest?.id, surface.id);
  assert.equal(latest?.title, surface.title);
  assert.match(JSON.stringify(latest), /pie-chart/);
  assert.equal(latest?.actions?.[0]?.id, "refine");
});
