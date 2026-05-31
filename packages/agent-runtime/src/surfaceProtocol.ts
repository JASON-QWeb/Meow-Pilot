import type { ComponentNode, SurfaceSpec, UIAction } from "@pet/protocol";

type ParsedSurfaceResponse = {
  text: string;
  surface?: SurfaceSpec;
};

type SurfaceBuildContext = {
  now: string;
  userText: string;
};

type JsonBlock = {
  raw: string;
  body: string;
  language: string;
};

const MAX_TEXT = 1_200;
const MAX_CHILDREN = 8;
const MAX_ROWS = 8;
const MAX_COLUMNS = 6;

const surfaceTypes = new Set<SurfaceSpec["type"]>(["bubble", "panel", "media", "modal", "canvas", "mini-widget"]);
const surfaceIntents = new Set<SurfaceSpec["intent"]>(["chat", "search", "calendar", "weather", "music", "video", "task", "memory", "skill", "settings"]);
const actionStyles = new Set<NonNullable<UIAction["style"]>>(["primary", "secondary", "danger"]);
const actionIcons = new Set<NonNullable<UIAction["icon"]>>(["play", "pause", "plus", "check", "search", "calendar", "external"]);

export function parseAgentSurfaceResponse(rawText: string, context: SurfaceBuildContext): ParsedSurfaceResponse {
  const blocks = extractJsonBlocks(rawText);
  for (const block of blocks) {
    const parsed = parseJsonObject(block.body);
    if (!parsed) continue;

    const answer = readString(parsed, "answer") ?? readString(parsed, "text") ?? readString(parsed, "message");
    const candidate = readRecord(parsed, "surface") ?? readRecord(parsed, "ui") ?? (looksLikeSurfaceCandidate(parsed) ? parsed : undefined);
    if (!candidate) continue;

    const surface = buildSurface(candidate, context);
    if (!surface) continue;

    const text = (answer ?? rawText.replace(block.raw, "")).trim() || defaultSurfaceText(surface);
    return { text: stripImplementationCode(text, context.userText), surface };
  }

  return {
    text: stripImplementationCode(rawText, context.userText).trim(),
  };
}

export function createResponseSurface(userText: string, assistantText: string, now: string): SurfaceSpec {
  const intent = inferIntent(userText);
  const title = inferTitle(userText, assistantText);
  const lines = extractUsefulLines(assistantText);
  const summary = lines.slice(0, 2).join("\n") || assistantText.trim() || "我把回复整理成一张可继续操作的卡片。";
  const listItems = lines.slice(2, 7).map((line, index) => ({
    id: `item_${index + 1}`,
    title: line,
    actionId: "refine",
  }));

  const children: ComponentNode[] = [
    {
      kind: "text",
      variant: "body",
      text: clampText(summary, MAX_TEXT),
    },
  ];

  if (listItems.length > 0) {
    children.push({
      kind: "list",
      items: listItems,
    });
  }

  return {
    id: `surface_${crypto.randomUUID()}`,
    type: "panel",
    intent,
    title,
    layout: {
      kind: "stack",
      direction: "column",
      gap: "md",
      children,
    },
    actions: [
      { id: "refine", label: "继续细化", style: "primary", icon: "plus" },
    ],
    createdAt: now,
  };
}

function buildSurface(candidate: Record<string, unknown>, context: SurfaceBuildContext): SurfaceSpec | undefined {
  const layout = buildLayout(candidate);
  if (!layout) return undefined;

  const type = readEnum(candidate, "type", surfaceTypes) ?? "panel";
  const intent = readEnum(candidate, "intent", surfaceIntents) ?? inferIntent(context.userText);
  const title = clampText(readString(candidate, "title") ?? inferTitle(context.userText, ""), 80);
  const actions = sanitizeActions(candidate.actions);

  return {
    id: `surface_${crypto.randomUUID()}`,
    type,
    intent,
    title,
    layout,
    ...(actions.length ? { actions } : {}),
    data: readRecord(candidate, "data"),
    createdAt: context.now,
  };
}

function buildLayout(candidate: Record<string, unknown>) {
  const nestedLayout = readRecord(candidate, "layout");
  if (nestedLayout) {
    return sanitizeNode(nestedLayout, 0);
  }

  const root = readString(candidate, "root") ?? readString(candidate, "rootId");
  const components = Array.isArray(candidate.components) ? candidate.components : undefined;
  if (root && components) {
    return hydrateFlatComponents(root, components);
  }

  return undefined;
}

function sanitizeNode(value: unknown, depth: number): ComponentNode | undefined {
  if (depth > 6 || !isRecord(value)) return undefined;
  const kind = readString(value, "kind");

  switch (kind) {
    case "stack": {
      const children = toArray(value.children).map((child) => sanitizeNode(child, depth + 1)).filter(isDefined).slice(0, MAX_CHILDREN);
      if (!children.length) return undefined;
      return {
        kind: "stack",
        direction: readEnum(value, "direction", new Set(["row", "column"] as const)) ?? "column",
        gap: readEnum(value, "gap", new Set(["xs", "sm", "md", "lg"] as const)) ?? "md",
        children,
      };
    }
    case "text":
      return {
        kind: "text",
        variant: readEnum(value, "variant", new Set(["title", "subtitle", "body", "caption"] as const)) ?? "body",
        text: clampText(readString(value, "text") ?? "", MAX_TEXT),
      };
    case "list": {
      const items = toArray(value.items)
        .map((item, index) => sanitizeListItem(item, index))
        .filter(isDefined)
        .slice(0, MAX_CHILDREN);
      return items.length ? { kind: "list", items } : undefined;
    }
    case "table": {
      const columns = toArray(value.columns)
        .map(sanitizeColumn)
        .filter(isDefined)
        .slice(0, MAX_COLUMNS);
      if (!columns.length) return undefined;
      const rows = toArray(value.rows)
        .filter(isRecord)
        .map((row) => sanitizeRow(row, columns))
        .slice(0, MAX_ROWS);
      return { kind: "table", columns, rows };
    }
    case "timeline": {
      const items = toArray(value.items)
        .map((item, index) => sanitizeTimelineItem(item, index))
        .filter(isDefined)
        .slice(0, MAX_CHILDREN);
      return items.length ? { kind: "timeline", items } : undefined;
    }
    case "media-player":
      return sanitizeMediaPlayer(value);
    case "form": {
      const fields = toArray(value.fields)
        .map((field, index) => sanitizeFormField(field, index))
        .filter(isDefined)
        .slice(0, MAX_CHILDREN);
      const submitActionId = readString(value, "submitActionId") ?? "submit";
      return fields.length ? { kind: "form", fields, submitActionId } : undefined;
    }
    case "metric-row": {
      const metrics = toArray(value.metrics)
        .map(sanitizeMetric)
        .filter(isDefined)
        .slice(0, 4);
      return metrics.length ? { kind: "metric-row", metrics } : undefined;
    }
    case "pie-chart": {
      const segments = toArray(value.segments)
        .map(sanitizePieSegment)
        .filter(isDefined)
        .slice(0, 8);
      return segments.length
        ? {
            kind: "pie-chart",
            title: clampOptional(readString(value, "title"), 80),
            segments,
          }
        : undefined;
    }
    default:
      return undefined;
  }
}

function hydrateFlatComponents(root: string, components: unknown[]) {
  const byId = new Map<string, Record<string, unknown>>();
  for (const component of components) {
    if (!isRecord(component)) continue;
    const id = readString(component, "id");
    if (!id) continue;
    byId.set(id, component);
  }

  const visit = (id: string, depth: number, seen: Set<string>): ComponentNode | undefined => {
    if (depth > 6 || seen.has(id)) return undefined;
    const component = byId.get(id);
    if (!component) return undefined;

    const expanded = expandCatalogComponent(component);
    if (expanded.kind === "stack") {
      const childIds = toArray(expanded.children).filter((child): child is string => typeof child === "string").slice(0, MAX_CHILDREN);
      const children = childIds.map((childId) => visit(childId, depth + 1, new Set([...seen, id]))).filter(isDefined);
      return sanitizeNode({ ...expanded, children }, depth);
    }

    return sanitizeNode(expanded, depth);
  };

  return visit(root, 0, new Set());
}

function expandCatalogComponent(component: Record<string, unknown>): Record<string, unknown> {
  const wrapped = readRecord(component, "component");
  if (!wrapped) return component;

  const [catalogName, props] = Object.entries(wrapped)[0] ?? [];
  if (!catalogName || !isRecord(props)) return component;

  if (catalogName === "Text") {
    return {
      kind: "text",
      variant: readString(props, "variant") ?? "body",
      text: readLiteralString(props.text) ?? "",
    };
  }

  if (catalogName === "Column" || catalogName === "Row" || catalogName === "Card") {
    return {
      kind: "stack",
      direction: catalogName === "Row" ? "row" : "column",
      gap: readString(props, "gap") ?? "md",
      children: readExplicitChildren(props.children),
    };
  }

  return component;
}

function sanitizeActions(value: unknown): UIAction[] {
  return toArray(value)
    .map((action, index) => {
      if (!isRecord(action)) return undefined;
      const id = readString(action, "id") ?? `action_${index + 1}`;
      const label = readString(action, "label") ?? readString(action, "title");
      if (!label) return undefined;
      return {
        id: clampText(id, 64),
        label: clampText(label, 36),
        style: readEnum(action, "style", actionStyles) ?? (index === 0 ? "primary" : "secondary"),
        icon: readEnum(action, "icon", actionIcons),
      } satisfies UIAction;
    })
    .filter(isDefined)
    .slice(0, 5);
}

function sanitizeListItem(value: unknown, index: number) {
  if (!isRecord(value)) return undefined;
  const title = readString(value, "title") ?? readString(value, "label");
  if (!title) return undefined;
  return {
    id: readString(value, "id") ?? `item_${index + 1}`,
    title: clampText(title, 120),
    description: clampOptional(readString(value, "description"), 220),
    meta: clampOptional(readString(value, "meta"), 80),
    actionId: clampOptional(readString(value, "actionId"), 64),
  };
}

function sanitizeColumn(value: unknown) {
  if (!isRecord(value)) return undefined;
  const key = readString(value, "key");
  const label = readString(value, "label") ?? key;
  return key && label ? { key: clampText(key, 40), label: clampText(label, 60) } : undefined;
}

function sanitizeRow(row: Record<string, unknown>, columns: Array<{ key: string; label: string }>) {
  const result: Record<string, string | number | boolean> = {};
  for (const column of columns) {
    const value = row[column.key];
    if (typeof value === "string") result[column.key] = clampText(value, 160);
    if (typeof value === "number" || typeof value === "boolean") result[column.key] = value;
  }
  return result;
}

function sanitizeTimelineItem(value: unknown, index: number) {
  if (!isRecord(value)) return undefined;
  const title = readString(value, "title");
  if (!title) return undefined;
  return {
    id: readString(value, "id") ?? `time_${index + 1}`,
    time: clampText(readString(value, "time") ?? `${index + 1}`, 30),
    title: clampText(title, 140),
    tone: readEnum(value, "tone", new Set(["focus", "meeting", "personal", "travel"] as const)) ?? "focus",
  };
}

function sanitizeMediaPlayer(value: Record<string, unknown>): ComponentNode | undefined {
  const media = readEnum(value, "media", new Set(["music", "video"] as const));
  const title = readString(value, "title");
  if (!media || !title) return undefined;
  return {
    kind: "media-player",
    media,
    title: clampText(title, 120),
    subtitle: clampOptional(readString(value, "subtitle"), 220),
    provider: clampOptional(readString(value, "provider"), 80),
    posterTone: readEnum(value, "posterTone", new Set(["aqua", "rose", "amber", "violet"] as const)) ?? "aqua",
    sourceUrl: clampOptional(readString(value, "sourceUrl"), 400),
    src: clampOptional(readString(value, "src"), 400),
    embedUrl: clampOptional(readString(value, "embedUrl"), 400),
    mimeType: clampOptional(readString(value, "mimeType"), 80),
    thumbnailUrl: clampOptional(readString(value, "thumbnailUrl"), 400),
    status: readEnum(value, "status", new Set(["ready", "needs-source", "external-only"] as const)) ?? "needs-source",
    controls: toArray(value.controls)
      .filter((control): control is "play" | "pause" | "queue" | "open" | "save" => typeof control === "string" && ["play", "pause", "queue", "open", "save"].includes(control))
      .slice(0, 5),
  };
}

function sanitizeFormField(value: unknown, index: number) {
  if (!isRecord(value)) return undefined;
  const label = readString(value, "label");
  if (!label) return undefined;
  return {
    id: readString(value, "id") ?? `field_${index + 1}`,
    label: clampText(label, 80),
    type: readEnum(value, "type", new Set(["text", "textarea", "select", "date", "time"] as const)) ?? "text",
    options: toArray(value.options)
      .filter((option): option is string => typeof option === "string")
      .map((option) => clampText(option, 80))
      .slice(0, 8),
    value: clampOptional(readString(value, "value"), 240),
  };
}

function sanitizeMetric(value: unknown) {
  if (!isRecord(value)) return undefined;
  const label = readString(value, "label");
  const metricValue = readString(value, "value");
  return label && metricValue
    ? {
        label: clampText(label, 40),
        value: clampText(metricValue, 40),
        tone: readEnum(value, "tone", new Set(["neutral", "good", "warn"] as const)) ?? "neutral",
      }
    : undefined;
}

function sanitizePieSegment(value: unknown) {
  if (!isRecord(value)) return undefined;
  const label = readString(value, "label");
  const rawValue = value.value;
  const segmentValue = typeof rawValue === "number" ? rawValue : typeof rawValue === "string" ? Number(rawValue.replace(/%$/, "")) : NaN;
  if (!label || !Number.isFinite(segmentValue) || segmentValue <= 0) return undefined;
  const color = readString(value, "color");
  return {
    label: clampText(label, 80),
    value: Math.round(segmentValue * 100) / 100,
    ...(color && /^#[0-9a-f]{6}$/i.test(color) ? { color } : {}),
  };
}

function stripImplementationCode(text: string, userText: string) {
  if (!isUiRequest(userText)) return text;
  const stripped = text.replace(/```(?:tsx|jsx|html|css|javascript|typescript|js|ts|vue|svelte|react)?[\s\S]*?```/gi, "").trim();
  if (stripped) return stripped;
  return "我不会把实现代码直接丢给你；这条回复会以宿主可渲染的交互卡片呈现。";
}

function extractJsonBlocks(text: string): JsonBlock[] {
  const blocks: JsonBlock[] = [];
  const codeFence = /```([a-zA-Z0-9_-]*)\s*([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = codeFence.exec(text))) {
    const language = match[1]?.trim().toLowerCase() ?? "";
    const body = match[2]?.trim() ?? "";
    if (["pet-surface", "pet-ui", "a2ui", "json", ""].includes(language) && body.startsWith("{")) {
      blocks.push({ raw: match[0], body, language });
    }
  }
  if (!blocks.length && text.trim().startsWith("{")) {
    blocks.push({ raw: text, body: text.trim(), language: "json" });
  }
  return blocks;
}

function parseJsonObject(text: string) {
  try {
    const value = JSON.parse(text) as unknown;
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function looksLikeSurfaceCandidate(value: Record<string, unknown>) {
  return isRecord(value.layout) || (typeof value.root === "string" && Array.isArray(value.components));
}

function extractUsefulLines(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .split(/\n+/)
    .map((line) => line.replace(/^[-*•\d.、\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 8);
}

function inferIntent(userText: string): SurfaceSpec["intent"] {
  const lower = userText.toLowerCase();
  if (containsAny(lower, ["搜索", "查询", "查一下", "资料", "compare", "search", "research"])) return "search";
  if (containsAny(lower, ["天气", "气温", "降雨", "预报", "weather", "forecast"])) return "weather";
  if (containsAny(lower, ["日程", "计划", "今天", "明天", "calendar", "schedule"])) return "calendar";
  if (containsAny(lower, ["听歌", "音乐", "歌曲", "music", "song"])) return "music";
  if (containsAny(lower, ["视频", "youtube", "bilibili", "video"])) return "video";
  if (containsAny(lower, ["记住", "记忆", "偏好", "memory"])) return "memory";
  if (containsAny(lower, ["skill", "插件", "能力"])) return "skill";
  if (containsAny(lower, ["配置", "api", "模型", "settings"])) return "settings";
  if (containsAny(lower, ["任务", "待办", "todo", "执行"])) return "task";
  return "chat";
}

function inferTitle(userText: string, assistantText: string) {
  const cleanUserText = userText.replace(/\s+/g, " ").trim();
  if (cleanUserText.length > 0) return clampText(cleanUserText, 28);
  const firstLine = extractUsefulLines(assistantText)[0];
  return firstLine ? clampText(firstLine, 28) : "回复卡片";
}

function defaultSurfaceText(surface: SurfaceSpec) {
  return `${surface.title ?? "卡片"}已生成，可以直接在卡片上继续操作。`;
}

function isUiRequest(userText: string) {
  const lower = userText.toLowerCase();
  return containsAny(lower, ["ui", "界面", "卡片", "组件", "表单", "表格", "看板", "生成", "react", "html", "jsx", "tsx", "a2ui"]);
}

function containsAny(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(needle));
}

function readRecord(value: Record<string, unknown>, key: string) {
  const child = value[key];
  return isRecord(child) ? child : undefined;
}

function readString(value: Record<string, unknown>, key: string) {
  const child = value[key];
  return typeof child === "string" ? child.trim() : undefined;
}

function readLiteralString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return undefined;
  return readString(value, "literalString") ?? readString(value, "text") ?? readString(value, "value");
}

function readExplicitChildren(value: unknown): string[] {
  if (!isRecord(value)) return [];
  const explicitList = value.explicitList;
  return Array.isArray(explicitList) ? explicitList.filter((item): item is string => typeof item === "string") : [];
}

function readEnum<T extends string>(value: Record<string, unknown>, key: string, allowed: Set<T>) {
  const child = value[key];
  return typeof child === "string" && allowed.has(child as T) ? (child as T) : undefined;
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function clampText(value: string, max: number) {
  return value.replace(/\s+\n/g, "\n").trim().slice(0, max);
}

function clampOptional(value: string | undefined, max: number) {
  return value ? clampText(value, max) : undefined;
}
