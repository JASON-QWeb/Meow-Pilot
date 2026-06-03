import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAgentSurfaceResponse } from "./surfaceProtocol";

test("parseAgentSurfaceResponse converts fenced surface JSON into a SurfaceSpec", () => {
  const parsed = parseAgentSurfaceResponse(
    [
      "```pet-surface",
      JSON.stringify({
        answer: "已生成卡片。",
        surface: {
          title: "任务",
          type: "panel",
          intent: "task",
          root: "root",
          components: [
            { id: "root", kind: "stack", direction: "column", gap: "md", children: ["title"] },
            { id: "title", kind: "text", variant: "body", text: "完成测试" },
          ],
        },
      }),
      "```",
    ].join("\n"),
    { now: "2026-06-03T00:00:00.000Z", userText: "生成任务卡" },
  );

  assert.equal(parsed.text, "已生成卡片。");
  assert.equal(parsed.surface?.title, "任务");
  assert.equal(parsed.surface?.intent, "task");
  assert.equal(parsed.surface?.createdAt, "2026-06-03T00:00:00.000Z");
});

test("parseAgentSurfaceResponse falls back to text when no structured surface exists", () => {
  const parsed = parseAgentSurfaceResponse("普通回答", { now: "2026-06-03T00:00:00.000Z", userText: "问答" });
  assert.equal(parsed.text, "普通回答");
  assert.equal(parsed.surface, undefined);
});
