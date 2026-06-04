import type {
  A2UIComponent,
  A2UIEnvelope,
  A2UIValidationError,
  ComponentNode,
  SurfaceSpec,
  UIAction,
} from "@pet/protocol";

type A2UISurfaceState = {
  id: string;
  title?: string;
  intent: SurfaceSpec["intent"];
  type: SurfaceSpec["type"];
  root?: string;
  components: Map<string, A2UIComponent>;
  dataModel: Record<string, unknown>;
  actions: UIAction[];
  sendDataModel?: boolean;
  createdAt: string;
};

export type A2UIRuntimeState = {
  surfaces: Map<string, A2UISurfaceState>;
};

export type A2UIApplyResult = {
  surface?: SurfaceSpec;
  deletedSurfaceId?: string;
  created?: boolean;
  updated?: boolean;
  errors: A2UIValidationError[];
};

export type A2UIParseResult = {
  envelopes: A2UIEnvelope[];
  errors: A2UIValidationError[];
  matched: boolean;
};

const surfaceTypes = new Set<SurfaceSpec["type"]>(["bubble", "panel", "media", "modal", "canvas", "mini-widget"]);
const surfaceIntents = new Set<SurfaceSpec["intent"]>(["chat", "search", "calendar", "weather", "music", "video", "task", "memory", "skill", "settings"]);
const actionStyles = new Set<NonNullable<UIAction["style"]>>(["primary", "secondary", "danger"]);
const actionIcons = new Set<NonNullable<UIAction["icon"]>>(["play", "pause", "plus", "check", "search", "calendar", "external"]);
const componentKinds = new Set(["stack", "text", "list", "table", "timeline", "media-player", "form", "metric-row", "pie-chart"]);
const catalogComponents = new Set(["card", "column", "row", "text", "button", "list", "table", "timeline", "form", "metricrow", "metric-row", "piechart", "pie-chart", "mediaplayer", "media-player"]);

const MAX_COMPONENTS = 64;
const MAX_ACTIONS = 12;
const MAX_TEXT = 1_200;
const MAX_CHILDREN = 12;
const MAX_ROWS = 24;
const MAX_COLUMNS = 8;

export function createA2UIRuntimeState(): A2UIRuntimeState {
  return { surfaces: new Map() };
}

export function parseA2UIEnvelopes(value: unknown): A2UIParseResult {
  const candidates = candidateEnvelopes(value);
  if (!candidates.length) return { envelopes: [], errors: [], matched: false };

  const envelopes: A2UIEnvelope[] = [];
  const errors: A2UIValidationError[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const normalized = normalizeA2UIEnvelope(candidates[index], index);
    if (normalized.envelope) envelopes.push(normalized.envelope);
    if (normalized.error) errors.push(normalized.error);
  }
  return { envelopes, errors, matched: true };
}

export function applyA2UIEnvelope(runtime: A2UIRuntimeState, envelope: A2UIEnvelope, now = new Date().toISOString()): A2UIApplyResult {
  const errors = validateA2UIEnvelope(envelope);
  if (errors.length) return { errors };

  switch (envelope.type) {
    case "createSurface": {
      const existing = runtime.surfaces.get(envelope.surfaceId);
      const state: A2UISurfaceState = {
        id: envelope.surfaceId,
        title: envelope.title,
        intent: envelope.intent ?? existing?.intent ?? "chat",
        type: envelope.surfaceType ?? existing?.type ?? "panel",
        root: envelope.root ?? existing?.root,
        components: existing?.components ?? new Map(),
        dataModel: existing?.dataModel ?? {},
        actions: existing?.actions ?? [],
        sendDataModel: envelope.sendDataModel ?? existing?.sendDataModel,
        createdAt: envelope.createdAt ?? existing?.createdAt ?? now,
      };
      runtime.surfaces.set(state.id, state);
      return { surface: surfaceFromState(state), created: !existing, updated: Boolean(existing), errors: [] };
    }
    case "updateComponents": {
      const state = runtime.surfaces.get(envelope.surfaceId);
      if (!state) return { errors: [validationError(envelope.surfaceId, "/surfaceId", "createSurface must be sent before updateComponents.")] };
      for (const component of envelope.components) state.components.set(component.id, component);
      if (envelope.root) state.root = envelope.root;
      if (envelope.actions) state.actions = sanitizeActions(envelope.actions);
      return { surface: surfaceFromState(state), updated: true, errors: [] };
    }
    case "updateDataModel": {
      const state = runtime.surfaces.get(envelope.surfaceId);
      if (!state) return { errors: [validationError(envelope.surfaceId, "/surfaceId", "createSurface must be sent before updateDataModel.")] };
      state.dataModel = updateDataModel(state.dataModel, envelope.path ?? "/", envelope.value, envelope.mode ?? "replace");
      return { surface: surfaceFromState(state), updated: true, errors: [] };
    }
    case "deleteSurface":
      runtime.surfaces.delete(envelope.surfaceId);
      return { deletedSurfaceId: envelope.surfaceId, updated: true, errors: [] };
  }
}

export function applyA2UIEnvelopes(runtime: A2UIRuntimeState, envelopes: A2UIEnvelope[], now = new Date().toISOString()) {
  const results: A2UIApplyResult[] = [];
  for (const envelope of envelopes) results.push(applyA2UIEnvelope(runtime, envelope, now));
  return results;
}

export function surfaceSpecToA2UIEnvelopes(surface: SurfaceSpec): A2UIEnvelope[] {
  const components: A2UIComponent[] = [];
  let nextId = 0;
  const root = flattenSurfaceNode(surface.layout, `${surface.id}_root`);

  return [
    {
      version: "0.10",
      type: "createSurface",
      surfaceId: surface.id,
      title: surface.title,
      intent: surface.intent,
      surfaceType: surface.type,
      root,
      sendDataModel: Boolean(surface.data),
      createdAt: surface.createdAt,
    },
    {
      version: "0.10",
      type: "updateComponents",
      surfaceId: surface.id,
      root,
      components,
      ...(surface.actions?.length ? { actions: surface.actions } : {}),
    },
    {
      version: "0.10",
      type: "updateDataModel",
      surfaceId: surface.id,
      path: "/",
      value: surface.data ?? {},
      mode: "replace",
    },
  ];

  function flattenSurfaceNode(node: ComponentNode, preferredId?: string): string {
    const id = preferredId ?? `${surface.id}_component_${(nextId += 1)}`;
    if (node.kind === "stack") {
      const childIds = node.children.map((child) => flattenSurfaceNode(child));
      components.push({ id, ...node, children: childIds });
      return id;
    }
    components.push({ id, ...node });
    return id;
  }
}

export function formatA2UIValidationFeedback(errors: A2UIValidationError[]) {
  return [
    "上一次 A2UI JSON 未通过宿主校验。请只返回修正后的 A2UI JSON，不要返回 React/Vue/HTML/CSS/JSX/TSX 代码。",
    "错误列表：",
    ...errors.slice(0, 8).map((error) => `- ${error.surfaceId} ${error.path}: ${error.message}`),
    "必须使用完整 JSON envelope，例如 createSurface、updateComponents、updateDataModel。",
  ].join("\n");
}

function candidateEnvelopes(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];

  for (const key of ["a2ui", "envelopes", "messages", "uiStream"]) {
    const nested = value[key];
    if (Array.isArray(nested)) return nested;
  }
  if (isEnvelopeLike(value)) return [value];
  return [];
}

function normalizeA2UIEnvelope(value: unknown, index: number): { envelope?: A2UIEnvelope; error?: A2UIValidationError } {
  if (!isRecord(value)) return { error: validationError("unknown", `/${index}`, "Envelope must be a JSON object.") };

  const expanded = expandEnvelopeShape(value);
  if (!expanded) return { error: validationError(readString(value.surfaceId) ?? "unknown", `/${index}/type`, "Unknown A2UI envelope type.") };

  const surfaceId = readString(expanded.surfaceId);
  if (!surfaceId) return { error: validationError("unknown", `/${index}/surfaceId`, "surfaceId is required.") };

  switch (expanded.type) {
    case "createSurface":
      return {
        envelope: {
          version: "0.10",
          type: "createSurface",
          surfaceId,
          title: clampOptional(readString(expanded.title), 120),
          intent: readEnum(expanded.intent, surfaceIntents) ?? "chat",
          surfaceType: readEnum(expanded.surfaceType ?? expanded.typeHint, surfaceTypes) ?? readEnum(expanded.surface, surfaceTypes) ?? "panel",
          root: clampOptional(readString(expanded.root), 120),
          sendDataModel: typeof expanded.sendDataModel === "boolean" ? expanded.sendDataModel : undefined,
          createdAt: readString(expanded.createdAt),
          metadata: readRecord(expanded.metadata),
        },
      };
    case "updateComponents": {
      const rawComponents = Array.isArray(expanded.components) ? expanded.components : [];
      const components = rawComponents.map((component, componentIndex) => sanitizeComponent(component, `/${index}/components/${componentIndex}`)).filter(isDefined);
      return {
        envelope: {
          version: "0.10",
          type: "updateComponents",
          surfaceId,
          root: clampOptional(readString(expanded.root), 120),
          components,
          actions: sanitizeActions(expanded.actions),
        },
      };
    }
    case "updateDataModel":
      return {
        envelope: {
          version: "0.10",
          type: "updateDataModel",
          surfaceId,
          path: readString(expanded.path) ?? "/",
          value: expanded.value ?? expanded.data ?? {},
          mode: expanded.mode === "merge" ? "merge" : "replace",
        },
      };
    case "deleteSurface":
      return { envelope: { version: "0.10", type: "deleteSurface", surfaceId } };
    default:
      return { error: validationError(surfaceId, `/${index}/type`, "Unknown A2UI envelope type.") };
  }
}

function expandEnvelopeShape(value: Record<string, unknown>): (Record<string, unknown> & { type: A2UIEnvelope["type"] }) | undefined {
  const explicitType = readString(value.type);
  if (explicitType === "createSurface" || explicitType === "updateComponents" || explicitType === "updateDataModel" || explicitType === "deleteSurface") {
    return { ...value, type: explicitType };
  }

  for (const type of ["createSurface", "updateComponents", "updateDataModel", "deleteSurface"] as const) {
    const payload = value[type];
    if (isRecord(payload)) return { ...payload, type };
  }
  return undefined;
}

function validateA2UIEnvelope(envelope: A2UIEnvelope): A2UIValidationError[] {
  const errors: A2UIValidationError[] = [];
  if (!envelope.surfaceId || envelope.surfaceId.length > 120) errors.push(validationError(envelope.surfaceId || "unknown", "/surfaceId", "surfaceId must be a non-empty string up to 120 characters."));

  if (envelope.type === "updateComponents") {
    if (!Array.isArray(envelope.components) || !envelope.components.length) errors.push(validationError(envelope.surfaceId, "/components", "components must contain at least one component."));
    if (envelope.components.length > MAX_COMPONENTS) errors.push(validationError(envelope.surfaceId, "/components", `components exceeds ${MAX_COMPONENTS} items.`));
    for (let index = 0; index < envelope.components.length; index += 1) {
      const component = envelope.components[index]!;
      if (!component.id) errors.push(validationError(envelope.surfaceId, `/components/${index}/id`, "component id is required."));
      const name = componentName(component);
      if (name && !componentKinds.has(name) && !catalogComponents.has(name)) {
        errors.push(validationError(envelope.surfaceId, `/components/${index}`, `Unsupported component: ${name}.`));
      }
    }
  }

  if (envelope.type === "updateDataModel" && envelope.path && !envelope.path.startsWith("/")) {
    errors.push(validationError(envelope.surfaceId, "/path", "path must be a JSON Pointer beginning with '/'."));
  }
  return errors;
}

function surfaceFromState(state: A2UISurfaceState): SurfaceSpec {
  const rootId = state.root ?? firstComponentId(state);
  const rendered = rootId ? renderComponent(rootId, state, new Set()) : undefined;
  const actions = uniqueActions([...state.actions, ...(rendered?.actions ?? [])]);
  const layout = rendered?.node ?? {
    kind: "stack",
    direction: "column",
    gap: "md",
    children: [{ kind: "text", variant: "caption", text: "正在生成界面..." }],
  } satisfies ComponentNode;

  return {
    id: state.id,
    type: state.type,
    intent: state.intent,
    title: state.title ?? "Agent 卡片",
    layout,
    data: Object.keys(state.dataModel).length ? state.dataModel : undefined,
    ...(actions.length ? { actions } : {}),
    createdAt: state.createdAt,
  };
}

function renderComponent(componentId: string, state: A2UISurfaceState, seen: Set<string>): { node: ComponentNode; actions: UIAction[] } | undefined {
  if (seen.has(componentId)) return undefined;
  const component = state.components.get(componentId);
  if (!component) return undefined;

  const nextSeen = new Set([...seen, componentId]);
  const spec = catalogSpec(component);
  const name = spec.name;
  const props = spec.props;

  if (name === "card" || name === "column" || name === "row" || name === "stack") {
    const childIds = readChildren(props.children ?? props.child ?? component.children ?? component.child);
    const renderedChildren = childIds.map((childId) => renderComponent(childId, state, nextSeen)).filter(isDefined).slice(0, MAX_CHILDREN);
    const children = renderedChildren.map((child) => child.node);
    if (!children.length) return undefined;
    return {
      node: {
        kind: "stack",
        direction: name === "row" ? "row" : readEnum(props.direction, new Set(["row", "column"] as const)) ?? "column",
        gap: readEnum(props.gap, new Set(["xs", "sm", "md", "lg"] as const)) ?? "md",
        children,
      },
      actions: renderedChildren.flatMap((child) => child.actions),
    };
  }

  if (name === "text") {
    return {
      node: {
        kind: "text",
        variant: normalizeTextVariant(readString(props.variant)),
        text: clampText(stringFromDynamic(props.text ?? props.content ?? props.value ?? props.label, state.dataModel), MAX_TEXT),
      },
      actions: [],
    };
  }

  if (name === "button") {
    const label = clampText(stringFromDynamic(props.label ?? props.text ?? props.title, state.dataModel) || "操作", 60);
    const action = actionFromProps(props.action ?? props.onClick ?? props, component.id, label);
    return {
      node: { kind: "list", items: [{ id: `${component.id}_item`, title: label, actionId: action.id }] },
      actions: [action],
    };
  }

  const direct = directNodeFromProps(name, props, state.dataModel);
  if (direct) return { node: direct, actions: [] };
  return undefined;
}

function directNodeFromProps(name: string, props: Record<string, unknown>, dataModel: Record<string, unknown>): ComponentNode | undefined {
  if (name === "list") {
    const items = toArray(dynamicValue(props.items, dataModel))
      .map((item, index) => sanitizeListItem(item, index))
      .filter(isDefined)
      .slice(0, MAX_CHILDREN);
    return items.length ? { kind: "list", items } : undefined;
  }

  if (name === "table") {
    const columns = toArray(dynamicValue(props.columns, dataModel)).map(sanitizeColumn).filter(isDefined).slice(0, MAX_COLUMNS);
    if (!columns.length) return undefined;
    const rows = toArray(dynamicValue(props.rows, dataModel)).filter(isRecord).map((row) => sanitizeRow(row, columns)).slice(0, MAX_ROWS);
    return { kind: "table", columns, rows };
  }

  if (name === "timeline") {
    const items = toArray(dynamicValue(props.items, dataModel)).map((item, index) => sanitizeTimelineItem(item, index)).filter(isDefined).slice(0, MAX_CHILDREN);
    return items.length ? { kind: "timeline", items } : undefined;
  }

  if (name === "form") {
    const fields = toArray(dynamicValue(props.fields, dataModel)).map((field, index) => sanitizeFormField(field, index)).filter(isDefined).slice(0, MAX_CHILDREN);
    const submitActionId = readString(props.submitActionId) ?? readString(props.actionId) ?? "submit";
    return fields.length ? { kind: "form", fields, submitActionId } : undefined;
  }

  if (name === "metricrow" || name === "metric-row") {
    const metrics = toArray(dynamicValue(props.metrics, dataModel)).map(sanitizeMetric).filter(isDefined).slice(0, 4);
    return metrics.length ? { kind: "metric-row", metrics } : undefined;
  }

  if (name === "piechart" || name === "pie-chart") {
    const segments = toArray(dynamicValue(props.segments, dataModel)).map(sanitizePieSegment).filter(isDefined).slice(0, 8);
    return segments.length ? { kind: "pie-chart", title: clampOptional(readString(props.title), 80), segments } : undefined;
  }

  if (name === "mediaplayer" || name === "media-player") {
    return sanitizeMediaPlayer(props);
  }

  if (componentKinds.has(name)) {
    return directNodeFromProps(name.replace(/-/g, ""), props, dataModel);
  }
  return undefined;
}

function catalogSpec(component: A2UIComponent): { name: string; props: Record<string, unknown> } {
  if (isRecord(component.component)) {
    const [rawName, rawProps] = Object.entries(component.component)[0] ?? [];
    if (rawName) return { name: normalizeComponentName(rawName), props: isRecord(rawProps) ? rawProps : {} };
  }
  if (typeof component.type === "string") return { name: normalizeComponentName(component.type), props: isRecord(component.props) ? component.props : component };
  if (typeof component.kind === "string") return { name: normalizeComponentName(component.kind), props: component };
  return { name: "", props: component };
}

function componentName(component: A2UIComponent) {
  return catalogSpec(component).name;
}

function sanitizeComponent(value: unknown, _path: string): A2UIComponent | undefined {
  if (!isRecord(value)) return undefined;
  const id = readString(value.id);
  if (!id) return undefined;
  return {
    ...value,
    id: clampText(id, 120),
  };
}

function actionFromProps(value: unknown, sourceComponentId: string, fallbackLabel: string): UIAction {
  if (typeof value === "string") {
    return { id: clampText(value, 64), label: fallbackLabel, sourceComponentId };
  }
  const action = isRecord(value) ? value : {};
  const name = readString(action.name) ?? readString(action.id) ?? readString(action.actionId) ?? sourceComponentId;
  const label = readString(action.label) ?? readString(action.title) ?? fallbackLabel;
  return {
    id: clampText(name, 64),
    label: clampText(label, 60),
    style: readEnum(action.style, actionStyles) ?? "secondary",
    icon: readEnum(action.icon, actionIcons),
    sourceComponentId,
    context: readRecord(action.context),
    sendDataModel: typeof action.sendDataModel === "boolean" ? action.sendDataModel : undefined,
    wantResponse: typeof action.wantResponse === "boolean" ? action.wantResponse : undefined,
  };
}

function updateDataModel(current: Record<string, unknown>, path: string, value: unknown, mode: "replace" | "merge") {
  if (path === "/" || path === "") {
    if (mode === "merge" && isRecord(value)) return { ...current, ...value };
    return isRecord(value) ? { ...value } : { value };
  }

  const next = structuredCloneSafe(current);
  const parts = path.split("/").slice(1).map(unescapePointer).filter(Boolean);
  if (!parts.length) return next;
  let cursor: Record<string, unknown> = next;
  for (const part of parts.slice(0, -1)) {
    const child = cursor[part];
    if (!isRecord(child)) cursor[part] = {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  const key = parts[parts.length - 1]!;
  if (mode === "merge" && isRecord(cursor[key]) && isRecord(value)) cursor[key] = { ...(cursor[key] as Record<string, unknown>), ...value };
  else cursor[key] = value;
  return next;
}

function dynamicValue(value: unknown, dataModel: Record<string, unknown>) {
  if (!isRecord(value)) return value;
  const path = readString(value.path);
  if (path) return readJsonPointer(dataModel, path);
  if ("value" in value) return value.value;
  if ("literal" in value) return value.literal;
  return value;
}

function stringFromDynamic(value: unknown, dataModel: Record<string, unknown>) {
  const resolved = dynamicValue(value, dataModel);
  if (resolved === undefined || resolved === null) return "";
  if (typeof resolved === "string") return resolved;
  if (typeof resolved === "number" || typeof resolved === "boolean") return String(resolved);
  return JSON.stringify(resolved);
}

function readJsonPointer(data: Record<string, unknown>, path: string): unknown {
  if (path === "/" || path === "") return data;
  let cursor: unknown = data;
  for (const part of path.split("/").slice(1).map(unescapePointer)) {
    if (!isRecord(cursor) && !Array.isArray(cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function readChildren(value: unknown): string[] {
  const resolved = isRecord(value) && Array.isArray(value.array) ? value.array : value;
  if (typeof resolved === "string") return [resolved];
  return toArray(resolved).filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, MAX_CHILDREN);
}

function firstComponentId(state: A2UISurfaceState) {
  return state.components.keys().next().value as string | undefined;
}

function sanitizeActions(value: unknown): UIAction[] {
  return toArray(value)
    .map((item, index) => {
      if (!isRecord(item)) return undefined;
      const id = readString(item.id) ?? readString(item.name) ?? `action_${index + 1}`;
      const label = readString(item.label) ?? readString(item.title);
      if (!label) return undefined;
      return {
        id: clampText(id, 64),
        label: clampText(label, 60),
        style: readEnum(item.style, actionStyles) ?? (index === 0 ? "primary" : "secondary"),
        icon: readEnum(item.icon, actionIcons),
        sourceComponentId: readString(item.sourceComponentId),
        context: readRecord(item.context),
        sendDataModel: typeof item.sendDataModel === "boolean" ? item.sendDataModel : undefined,
        wantResponse: typeof item.wantResponse === "boolean" ? item.wantResponse : undefined,
      } satisfies UIAction;
    })
    .filter(isDefined)
    .slice(0, MAX_ACTIONS);
}

function uniqueActions(actions: UIAction[]) {
  const seen = new Set<string>();
  const result: UIAction[] = [];
  for (const action of actions) {
    const key = `${action.id}:${action.sourceComponentId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(action);
  }
  return result.slice(0, MAX_ACTIONS);
}

function sanitizeListItem(value: unknown, index: number) {
  if (!isRecord(value)) return undefined;
  const title = readString(value.title) ?? readString(value.label);
  if (!title) return undefined;
  return {
    id: readString(value.id) ?? `item_${index + 1}`,
    title: clampText(title, 120),
    description: clampOptional(readString(value.description), 220),
    meta: clampOptional(readString(value.meta), 80),
    actionId: clampOptional(readString(value.actionId), 64),
  };
}

function sanitizeColumn(value: unknown) {
  if (!isRecord(value)) return undefined;
  const key = readString(value.key);
  const label = readString(value.label) ?? key;
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
  const title = readString(value.title);
  if (!title) return undefined;
  return {
    id: readString(value.id) ?? `time_${index + 1}`,
    time: clampText(readString(value.time) ?? `${index + 1}`, 30),
    title: clampText(title, 140),
    tone: readEnum(value.tone, new Set(["focus", "meeting", "personal", "travel"] as const)) ?? "focus",
  };
}

function sanitizeFormField(value: unknown, index: number) {
  if (!isRecord(value)) return undefined;
  const label = readString(value.label);
  if (!label) return undefined;
  return {
    id: readString(value.id) ?? `field_${index + 1}`,
    label: clampText(label, 80),
    type: readEnum(value.type, new Set(["text", "textarea", "select", "date", "time"] as const)) ?? "text",
    options: toArray(value.options).filter((option): option is string => typeof option === "string").map((option) => clampText(option, 80)).slice(0, 8),
    value: clampOptional(readString(value.value), 240),
  };
}

function sanitizeMetric(value: unknown) {
  if (!isRecord(value)) return undefined;
  const label = readString(value.label);
  const metricValue = readString(value.value);
  return label && metricValue
    ? {
        label: clampText(label, 40),
        value: clampText(metricValue, 40),
        tone: readEnum(value.tone, new Set(["neutral", "good", "warn"] as const)) ?? "neutral",
      }
    : undefined;
}

function sanitizePieSegment(value: unknown) {
  if (!isRecord(value)) return undefined;
  const label = readString(value.label);
  const rawValue = value.value;
  const segmentValue = typeof rawValue === "number" ? rawValue : typeof rawValue === "string" ? Number(rawValue.replace(/%$/, "")) : NaN;
  if (!label || !Number.isFinite(segmentValue) || segmentValue <= 0) return undefined;
  const color = readString(value.color);
  return {
    label: clampText(label, 80),
    value: Math.round(segmentValue * 100) / 100,
    ...(color && /^#[0-9a-f]{6}$/i.test(color) ? { color } : {}),
  };
}

function sanitizeMediaPlayer(value: Record<string, unknown>): ComponentNode | undefined {
  const media = readEnum(value.media, new Set(["music", "video"] as const));
  const title = readString(value.title);
  if (!media || !title) return undefined;
  return {
    kind: "media-player",
    media,
    title: clampText(title, 120),
    subtitle: clampOptional(readString(value.subtitle), 220),
    provider: clampOptional(readString(value.provider), 80),
    posterTone: readEnum(value.posterTone, new Set(["aqua", "rose", "amber", "violet"] as const)) ?? "aqua",
    sourceUrl: clampOptional(readString(value.sourceUrl), 400),
    src: clampOptional(readString(value.src), 400),
    embedUrl: clampOptional(readString(value.embedUrl), 400),
    mimeType: clampOptional(readString(value.mimeType), 80),
    thumbnailUrl: clampOptional(readString(value.thumbnailUrl), 400),
    status: readEnum(value.status, new Set(["ready", "needs-source", "external-only"] as const)) ?? "needs-source",
    controls: toArray(value.controls).filter((control): control is "play" | "pause" | "queue" | "open" | "save" => typeof control === "string" && ["play", "pause", "queue", "open", "save"].includes(control)).slice(0, 5),
  };
}

function normalizeTextVariant(value?: string): Extract<ComponentNode, { kind: "text" }>["variant"] {
  if (value === "title" || value === "heading" || value === "h1") return "title";
  if (value === "subtitle" || value === "subheading" || value === "h2") return "subtitle";
  if (value === "caption" || value === "small") return "caption";
  return "body";
}

function normalizeComponentName(value: string) {
  return value.trim().replace(/_/g, "-").toLowerCase();
}

function isEnvelopeLike(value: Record<string, unknown>) {
  return Boolean(value.type || value.createSurface || value.updateComponents || value.updateDataModel || value.deleteSurface);
}

function validationError(surfaceId: string, path: string, message: string): A2UIValidationError {
  return { code: "VALIDATION_FAILED", surfaceId, path, message };
}

function unescapePointer(value: string) {
  return value.replace(/~1/g, "/").replace(/~0/g, "~");
}

function structuredCloneSafe(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readEnum<T extends string>(value: unknown, allowed: Set<T>): T | undefined {
  return typeof value === "string" && allowed.has(value as T) ? (value as T) : undefined;
}

function clampText(value: string, max: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function clampOptional(value: string | undefined, max: number) {
  return value ? clampText(value, max) : undefined;
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
