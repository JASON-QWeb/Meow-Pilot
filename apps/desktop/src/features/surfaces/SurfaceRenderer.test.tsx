import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { SurfaceSpec } from "@pet/protocol";
import { SurfaceRenderer } from "./SurfaceRenderer";

test("SurfaceRenderer renders table data and actions", () => {
  const surface: SurfaceSpec = {
    id: "surface_test",
    type: "panel",
    intent: "task",
    title: "任务看板",
    layout: {
      kind: "stack",
      direction: "column",
      gap: "md",
      children: [
        { kind: "text", variant: "body", text: "今日重点" },
        {
          kind: "table",
          columns: [
            { key: "name", label: "任务" },
            { key: "state", label: "状态" },
          ],
          rows: [{ name: "补测试", state: "进行中" }],
        },
      ],
    },
    actions: [{ id: "done", label: "完成", icon: "check", style: "primary" }],
    createdAt: "2026-06-04T00:00:00.000Z",
  };

  const html = renderToStaticMarkup(<SurfaceRenderer surface={surface} onAction={() => undefined} />);

  assert.match(html, /任务看板/);
  assert.match(html, /今日重点/);
  assert.match(html, /补测试/);
  assert.match(html, /完成/);
});
