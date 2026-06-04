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

test("parseAgentSurfaceResponse extracts balanced JSON from prose", () => {
  const parsed = parseAgentSurfaceResponse(
    [
      "已整理：",
      JSON.stringify({
        text: "已生成查询卡片。",
        surface: {
          title: "查询",
          type: "panel",
          intent: "search",
          layout: {
            kind: "text",
            variant: "body",
            text: "结果摘要",
          },
        },
      }),
    ].join("\n"),
    { now: "2026-06-03T00:00:00.000Z", userText: "生成查询卡" },
  );

  assert.equal(parsed.text, "已生成查询卡片。");
  assert.equal(parsed.surface?.intent, "search");
});

test("parseAgentSurfaceResponse converts A2UI envelope arrays into a SurfaceSpec", () => {
  const parsed = parseAgentSurfaceResponse(
    [
      "```a2ui",
      JSON.stringify([
        {
          type: "createSurface",
          surfaceId: "surface_a2ui",
          title: "A2UI 卡片",
          intent: "task",
          surfaceType: "panel",
          root: "root",
        },
        {
          type: "updateComponents",
          surfaceId: "surface_a2ui",
          root: "root",
          components: [
            { id: "root", component: { Card: { child: "body" } } },
            { id: "body", component: { Text: { text: "分步生成内容" } } },
          ],
        },
      ]),
      "```",
    ].join("\n"),
    { now: "2026-06-04T00:00:00.000Z", userText: "生成 A2UI 卡" },
  );

  assert.equal(parsed.surface?.id, "surface_a2ui");
  assert.equal(parsed.surface?.title, "A2UI 卡片");
  assert.match(JSON.stringify(parsed.surface), /分步生成内容/);
});

test("parseAgentSurfaceResponse reports A2UI validation errors without rendering", () => {
  const parsed = parseAgentSurfaceResponse(
    [
      "```a2ui",
      JSON.stringify({
        type: "updateComponents",
        surfaceId: "missing",
        components: [{ id: "root", component: { Text: { text: "无 createSurface" } } }],
      }),
      "```",
    ].join("\n"),
    { now: "2026-06-04T00:00:00.000Z", userText: "生成 A2UI 卡" },
  );

  assert.equal(parsed.surface, undefined);
  assert.equal(parsed.validationErrors?.[0]?.code, "VALIDATION_FAILED");
});
