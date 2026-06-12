export type RpcRequest<TParams = unknown> = {
  type: "req";
  id: string;
  method: LocalRpcMethod;
  params?: TParams;
  idempotencyKey?: string;
};

export type RpcResponse<TPayload = unknown> =
  | {
      type: "res";
      id: string;
      ok: true;
      payload: TPayload;
    }
  | {
      type: "res";
      id: string;
      ok: false;
      error: {
        code: string;
        message: string;
        details?: unknown;
      };
    };

export type RpcEvent<TPayload = unknown> = {
  type: "event";
  event: LocalEventName;
  payload: TPayload;
  seq: number;
  at: string;
};

export type LocalRpcFrame = RpcRequest | RpcResponse | RpcEvent;

export type LocalRpcMethod =
  | "hello"
  | "session.create"
  | "session.list"
  | "session.resume"
  | "session.delete"
  | "chat.send"
  | "voice.transcribe"
  | "voice.speak"
  | "voice.configure"
  | "agent.cancel"
  | "runtime.stats"
  | "account.current"
  | "account.signIn"
  | "friend.list"
  | "friend.add"
  | "social.exchange"
  | "task.list"
  | "task.create"
  | "task.update"
  | "task.delete"
  | "memory.list"
  | "memory.query"
  | "memory.propose"
  | "memory.commit"
  | "memory.reject"
  | "skill.list"
  | "skill.search"
  | "skill.view"
  | "skill.run"
  | "skill.manage"
  | "tool.catalog"
  | "tool.invoke"
  | "tool.audit.list"
  | "permission.list"
  | "permission.resolve"
  | "usage.list"
  | "pet.image.cutout"
  | "provider.configure"
  | "provider.list";

export type LocalEventName =
  | "agent.lifecycle"
  | "agent.delta"
  | "chat.message"
  | "memory.proposal"
  | "permission.request"
  | "tool.run"
  | "pet.emotion"
  | "pet.activity"
  | "task.changed"
  | "ui.surface.create"
  | "ui.surface.update"
  | "ui.surface.delete";

export type HelloParams = {
  clientName: string;
  protocolVersion: "0.1";
};

export type HelloPayload = {
  serverName: "pet-agentd";
  protocolVersion: "0.1";
  features: {
    methods: LocalRpcMethod[];
    events: LocalEventName[];
    surfaceVersion: "0.1";
    a2uiVersion?: A2UIVersion;
  };
};

export type SessionCreateParams = {
  title?: string;
};

export type SessionCreatePayload = {
  sessionId: string;
  title: string;
  messages?: ChatMessage[];
  surfaces?: SurfaceSpec[];
};

export type SessionSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

export type SessionListPayload = {
  sessions: SessionSummary[];
};

export type SessionResumeParams = {
  sessionId?: string;
};

export type SessionResumePayload = {
  sessionId: string;
  title: string;
  messages: ChatMessage[];
  surfaces: SurfaceSpec[];
};

export type SessionDeleteParams = {
  sessionId: string;
};

export type SessionDeletePayload = {
  sessionId: string;
  deleted: true;
};

export type ChatSendParams = {
  sessionId: string;
  text: string;
  attachments?: ChatAttachment[];
  source?: "text" | "voice" | "ui";
  surfaceAction?: {
    surfaceId: string;
    actionId: string;
    name?: string;
    sourceComponentId?: string;
    context?: Record<string, unknown>;
    dataModel?: Record<string, unknown>;
    value?: unknown;
  };
};

export type ChatSendPayload = {
  runId: string;
  status: "accepted";
};

export type RuntimeStatsPayload = {
  generatedAt: string;
  totalSessions: number;
  totalMessages: number;
  totalSurfaces: number;
  todayMessages: number;
  yesterdayMessages: number;
  todayEstimatedTokens: number;
  yesterdayEstimatedTokens: number;
};

export type VoiceTranscribeParams = {
  audioData: string;
};

export type VoiceTranscribePayload = {
  text: string;
  model: string;
};

export type VoiceSpeakParams = {
  text: string;
};

export type VoiceSpeakPayload = {
  accepted: true;
  mode: "ai-sdk-tts" | "xiaomi-tts";
  audioData: string;
  mimeType: string;
  model: string;
  voice: string;
};

export type VoiceConfigureParams = {
  provider: "xiaomi";
  apiKey: string;
  baseUrl?: string;
  audioModel?: string;
  ttsModel?: string;
  voice?: string;
  instruction?: string;
};

export type VoiceConfigurePayload = {
  providers: ProviderSummary[];
};

export type AccountProfile = {
  id: string;
  handle: string;
  displayName: string;
  avatarSeed: string;
  createdAt: string;
};

export type AccountCurrentPayload = {
  account: AccountProfile | null;
};

export type AccountSignInParams = {
  displayName: string;
  handle?: string;
};

export type AccountSignInPayload = {
  account: AccountProfile;
};

export type FriendSummary = {
  id: string;
  handle: string;
  displayName: string;
  status: "pending" | "accepted" | "blocked";
  petName?: string;
  lastExchangeAt?: string;
};

export type FriendListPayload = {
  friends: FriendSummary[];
};

export type FriendAddParams = {
  handle: string;
  displayName?: string;
  petName?: string;
};

export type FriendAddPayload = {
  friend: FriendSummary;
};

export type SocialExchangeRecord = {
  id: string;
  friendId: string;
  direction: "outgoing" | "incoming" | "local";
  summary: string;
  sharedSkills: string[];
  sharedMemoryCount: number;
  createdAt: string;
};

export type SocialExchangeParams = {
  friendId: string;
  note?: string;
  skillNames?: string[];
};

export type SocialExchangePayload = {
  exchange: SocialExchangeRecord;
};

export type ScheduledTaskRepeat = "once" | "daily" | "weekly";

export type ScheduledTaskChannel = "pet" | "chat" | "voice";

export type ScheduledTask = {
  id: string;
  title: string;
  dueAt: string;
  repeat: ScheduledTaskRepeat;
  channel: ScheduledTaskChannel;
  enabled: boolean;
  note?: string;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
  lastTriggeredAt?: string;
};

export type TaskTriggerRecord = {
  id: string;
  taskId: string;
  triggeredAt: string;
  channel: ScheduledTaskChannel;
  status: "sent" | "skipped" | "failed";
  summary?: string;
};

export type TaskListPayload = {
  tasks: ScheduledTask[];
};

export type TaskCreateParams = {
  title: string;
  dueAt?: string;
  repeat?: ScheduledTaskRepeat;
  channel?: ScheduledTaskChannel;
  note?: string;
  enabled?: boolean;
};

export type TaskCreatePayload = {
  task: ScheduledTask;
};

export type TaskUpdateParams = {
  taskId: string;
  title?: string;
  dueAt?: string;
  repeat?: ScheduledTaskRepeat;
  channel?: ScheduledTaskChannel;
  note?: string | null;
  enabled?: boolean;
  completedAt?: string | null;
};

export type TaskUpdatePayload = {
  task: ScheduledTask;
};

export type TaskDeleteParams = {
  taskId: string;
};

export type TaskDeletePayload = {
  taskId: string;
  deleted: true;
};

export type TaskChangedEvent = {
  action: "created" | "updated" | "deleted" | "triggered";
  task?: ScheduledTask;
  taskId?: string;
  tasks: ScheduledTask[];
};

export type AgentLifecycleEvent = {
  sessionId: string;
  runId: string;
  phase: "start" | "step" | "waiting_permission" | "end" | "error";
  message?: string;
  toolName?: string;
};

export type AgentDeltaEvent = {
  sessionId: string;
  runId: string;
  text: string;
  surface?: SurfaceSpec;
};

export type ChatMessageEvent = {
  sessionId: string;
  message: ChatMessage;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  attachments?: ChatAttachment[];
  createdAt: string;
  runId?: string;
  surface?: SurfaceSpec;
};

export type ChatAttachment = {
  id: string;
  kind: "image";
  dataUrl: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  name?: string;
};

export type PetEmotion =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "celebrating"
  | "needs_attention";

export type PetEmotionEvent = {
  sessionId: string;
  emotion: PetEmotion;
  intensity: number;
  reason?: string;
};

export type PetActivity = "coding" | "research" | "exercise" | "sleeping";

export type PetActivityEvent = {
  sessionId: string;
  activity: PetActivity;
  active: boolean;
  reason?: string;
};

export type SurfaceType = "bubble" | "panel" | "media" | "modal" | "canvas" | "mini-widget";

export type SurfaceSpec = {
  id: string;
  type: SurfaceType;
  title?: string;
  intent:
    | "chat"
    | "search"
    | "calendar"
    | "weather"
    | "music"
    | "video"
    | "task"
    | "memory"
    | "skill"
    | "settings";
  layout: ComponentNode;
  data?: Record<string, unknown>;
  actions?: UIAction[];
  createdAt: string;
  expiresAt?: string;
};

export type ComponentNode =
  | StackNode
  | TextNode
  | ListNode
  | TableNode
  | TimelineNode
  | MediaPlayerNode
  | FormNode
  | MetricRowNode
  | PieChartNode;

export type StackNode = {
  kind: "stack";
  direction?: "row" | "column";
  gap?: "xs" | "sm" | "md" | "lg";
  children: ComponentNode[];
};

export type TextNode = {
  kind: "text";
  variant?: "title" | "subtitle" | "body" | "caption";
  text: string;
};

export type ListNode = {
  kind: "list";
  items: Array<{
    id: string;
    title: string;
    description?: string;
    meta?: string;
    actionId?: string;
  }>;
};

export type TableNode = {
  kind: "table";
  columns: Array<{
    key: string;
    label: string;
  }>;
  rows: Array<Record<string, string | number | boolean>>;
};

export type TimelineNode = {
  kind: "timeline";
  items: Array<{
    id: string;
    time: string;
    title: string;
    tone?: "focus" | "meeting" | "personal" | "travel";
  }>;
};

export type MediaPlayerNode = {
  kind: "media-player";
  media: "music" | "video";
  title: string;
  subtitle?: string;
  provider?: string;
  posterTone?: "aqua" | "rose" | "amber" | "violet";
  sourceUrl?: string;
  src?: string;
  embedUrl?: string;
  mimeType?: string;
  thumbnailUrl?: string;
  status?: "ready" | "needs-source" | "external-only";
  controls: Array<"play" | "pause" | "queue" | "open" | "save">;
};

export type FormNode = {
  kind: "form";
  fields: Array<{
    id: string;
    label: string;
    type: "text" | "textarea" | "select" | "date" | "time";
    options?: string[];
    value?: string;
  }>;
  submitActionId: string;
};

export type MetricRowNode = {
  kind: "metric-row";
  metrics: Array<{
    label: string;
    value: string;
    tone?: "neutral" | "good" | "warn";
  }>;
};

export type PieChartNode = {
  kind: "pie-chart";
  title?: string;
  segments: Array<{
    label: string;
    value: number;
    color?: string;
  }>;
};

export type UIAction = {
  id: string;
  label: string;
  style?: "primary" | "secondary" | "danger";
  icon?: "play" | "pause" | "plus" | "check" | "search" | "calendar" | "external";
  sourceComponentId?: string;
  context?: Record<string, unknown>;
  sendDataModel?: boolean;
  wantResponse?: boolean;
};

export type SurfaceEvent = {
  sessionId: string;
  surface: SurfaceSpec;
};

export type A2UIVersion = "0.10";

export type A2UIEnvelope =
  | A2UICreateSurfaceEnvelope
  | A2UIUpdateComponentsEnvelope
  | A2UIUpdateDataModelEnvelope
  | A2UIDeleteSurfaceEnvelope;

export type A2UICreateSurfaceEnvelope = {
  version?: A2UIVersion;
  type: "createSurface";
  surfaceId: string;
  title?: string;
  intent?: SurfaceSpec["intent"];
  surfaceType?: SurfaceSpec["type"];
  root?: string;
  sendDataModel?: boolean;
  createdAt?: string;
  metadata?: Record<string, unknown>;
};

export type A2UIUpdateComponentsEnvelope = {
  version?: A2UIVersion;
  type: "updateComponents";
  surfaceId: string;
  root?: string;
  components: A2UIComponent[];
  actions?: UIAction[];
};

export type A2UIUpdateDataModelEnvelope = {
  version?: A2UIVersion;
  type: "updateDataModel";
  surfaceId: string;
  path?: string;
  value: unknown;
  mode?: "replace" | "merge";
};

export type A2UIDeleteSurfaceEnvelope = {
  version?: A2UIVersion;
  type: "deleteSurface";
  surfaceId: string;
};

export type A2UIComponent = {
  id: string;
  component?: Record<string, unknown>;
  type?: string;
  props?: Record<string, unknown>;
  kind?: ComponentNode["kind"] | "Button" | "Card" | "Column" | "Row" | "Text";
  children?: unknown;
  child?: unknown;
  [key: string]: unknown;
};

export type A2UIValidationError = {
  code: "VALIDATION_FAILED";
  surfaceId: string;
  path: string;
  message: string;
};

export type Memory = {
  id: string;
  kind: "user_profile" | "pet_note" | "semantic" | "episodic" | "procedural" | "social";
  scope: "private" | "social" | "shared" | "system";
  content: string;
  summary?: string;
  confidence: number;
  source: "chat" | "tool" | "calendar" | "import" | "friend" | "skill";
  sourceType?: "chat" | "message" | "tool" | "calendar" | "import" | "friend" | "skill" | "manual";
  sourceId?: string;
  visibility?: "local_only" | "sync_encrypted" | "shareable";
  piiTags?: string[];
  createdAt: string;
  updatedAt?: string;
  expiresAt?: string;
};

export type MemoryProposalEvent = {
  sessionId: string;
  proposal: Memory;
};

export type SkillSummary = {
  name: string;
  description: string;
  category: string;
  permissions: string[];
  enabled: boolean;
  path?: string;
  source?: "workspace" | "project" | "user" | "managed" | "bundled" | "friend" | "market";
  version?: string;
  tags?: string[];
  quarantined?: boolean;
  lastUsedAt?: string;
};

export type ToolPermissionLevel = "read" | "confirm" | "dangerous" | "forbidden";

export type ToolSummary = {
  name: string;
  description: string;
  category:
    | "terminal"
    | "file"
    | "memory"
    | "skill"
    | "surface"
    | "web"
    | "calendar"
    | "task"
    | "media"
    | "social"
    | "clipboard"
    | "notification"
    | "browser"
    | "system"
    | "mcp"
    | "agent";
  permissionLevel: ToolPermissionLevel;
  inputSchema?: Record<string, unknown>;
};

export type ToolCatalogPayload = {
  tools: ToolSummary[];
};

export type ToolInvokeParams = {
  name: string;
  input?: Record<string, unknown>;
  sessionId?: string;
  runId?: string;
  source?: "agent" | "ui" | "skill";
};

export type ToolRunStatus = "success" | "failed" | "pending_permission" | "denied";

export type ToolRunRecord = {
  id: string;
  sessionId?: string;
  runId?: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  status: ToolRunStatus;
  permissionId?: string;
  exitCode?: number;
  cwd?: string;
  createdAt: string;
  completedAt?: string;
  summary?: string;
  risk?: string;
};

export type ToolInvokePayload = {
  run: ToolRunRecord;
  result?: unknown;
};

export type ToolAuditListPayload = {
  runs: ToolRunRecord[];
};

export type ToolRunEvent = {
  run: ToolRunRecord;
};

export type PermissionRequest = {
  id: string;
  sessionId?: string;
  runId?: string;
  toolName: string;
  title: string;
  description: string;
  permissionLevel: Exclude<ToolPermissionLevel, "read" | "forbidden">;
  risk: string;
  input: Record<string, unknown>;
  diff?: string;
  command?: string;
  cwd?: string;
  status: "pending" | "approved" | "denied";
  createdAt: string;
  resolvedAt?: string;
};

export type PermissionRequestEvent = {
  request: PermissionRequest;
};

export type PermissionListPayload = {
  requests: PermissionRequest[];
};

export type PermissionResolveParams = {
  permissionId: string;
  approved: boolean;
};

export type PermissionResolvePayload = {
  request: PermissionRequest;
  run?: ToolRunRecord;
  result?: unknown;
};

export type MemoryQueryParams = {
  query?: string;
  kinds?: Memory["kind"][];
  limit?: number;
};

export type MemoryQueryPayload = {
  memories: Memory[];
};

export type MemoryProposeParams = {
  sessionId?: string;
  content: string;
  kind?: Memory["kind"];
  scope?: Memory["scope"];
  source?: Memory["source"];
  confidence?: number;
};

export type MemoryProposePayload = {
  proposal: Memory;
};

export type SkillSearchParams = {
  query?: string;
  limit?: number;
};

export type SkillSearchPayload = {
  skills: SkillSummary[];
};

export type SkillViewParams = {
  name: string;
};

export type SkillViewPayload = {
  skill: SkillSummary;
  content: string;
};

export type SkillManageParams = {
  action: "enable" | "disable" | "quarantine";
  name: string;
};

export type SkillManagePayload = {
  skill: SkillSummary;
};

export type AiProviderId = "openai" | "anthropic" | "google" | "xai" | "deepseek" | "openrouter" | "openai-compatible";

export type ProviderConfigureParams = {
  provider: AiProviderId;
  apiKey: string;
  model: string;
  baseUrl?: string;
};

export type ProviderConfigurePayload = {
  providers: ProviderSummary[];
};

export type ProviderSummary = {
  id: string;
  label: string;
  mode: "api" | "cli-bridge" | "local";
  configured: boolean;
  capabilities: string[];
  model?: string;
  source?: "env" | "local-config" | "api-md" | "system";
};

export type PetImageCutoutParams = {
  imageDataUrl: string;
  fileName?: string;
  mimeType?: string;
};

export type PetImageCutoutPayload = {
  imageDataUrl: string;
  mimeType: "image/png";
  model: string;
  provider: AiProviderId;
  source: "responses-image-generation";
};

export type TokenUsageSummary = {
  id: string;
  label: string;
  kind: "subscription" | "api";
  primaryLabel: string;
  primaryValue: string;
  status: "connected" | "unconfigured" | "error";
  sourceLabel: string;
  href: string;
  accent: "blue" | "violet" | "mint" | "amber" | "rose";
  metrics: Array<{
    label: string;
    value: string;
    hint: string;
    percent?: number;
  }>;
  updatedAt?: string;
  message?: string;
};

export type TokenUsageListPayload = {
  summaries: TokenUsageSummary[];
};

export function isRpcRequest(frame: unknown): frame is RpcRequest {
  return typeof frame === "object" && frame !== null && (frame as { type?: unknown }).type === "req";
}
