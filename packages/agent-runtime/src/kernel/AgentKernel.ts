import type {
  AgentDeltaEvent,
  AgentLifecycleEvent,
  ChatMessage,
  MemoryProposalEvent,
  PermissionRequestEvent,
  PetActivityEvent,
  PetEmotionEvent,
  SurfaceEvent,
  SurfaceSpec,
  ToolRunEvent,
} from "@pet/protocol";
import type { ModelMessage, ToolCallPart, ToolResultPart } from "ai";
import { parseAgentSurfaceResponse } from "../surfaceProtocol";
import {
  chatMessagesToModelMessages,
  generateAgentPlanWithAiSdk,
  generateAgentReflectionWithAiSdk,
  streamAgentStepWithAiSdk,
  type AgentPlan,
  type AiSdkToolCall,
} from "../providers/aiSdk";
import type { MemoryService } from "../memory/MemoryService";
import type { PetStore, RuntimeSession } from "../storage";
import type { ToolRegistry } from "../tools/ToolRegistry";
import { ContextBuilder } from "./ContextBuilder";

export type AgentToolResult = {
  call: AiSdkToolCall;
  value: unknown;
  permissionId?: string;
};

export type AgentContinuation = {
  sessionId: string;
  runId: string;
  userText: string;
  instructions: string;
  messages: ModelMessage[];
  completedToolResults: AgentToolResult[];
  pendingTools: Array<{ permissionId: string; call: AiSdkToolCall }>;
  nextRound: number;
  streamedText: string;
};

export type AgentRunResult = {
  message: ChatMessage;
  continuation?: AgentContinuation;
};

type KernelEventMap = {
  "agent.lifecycle": AgentLifecycleEvent;
  "agent.delta": AgentDeltaEvent;
  "memory.proposal": MemoryProposalEvent;
  "permission.request": PermissionRequestEvent;
  "tool.run": ToolRunEvent;
  "pet.emotion": PetEmotionEvent;
  "pet.activity": PetActivityEvent;
  "ui.surface.create": SurfaceEvent;
};

type AgentKernelOptions = {
  store: PetStore;
  memory: MemoryService;
  tools: ToolRegistry;
  contextBuilder: ContextBuilder;
  emit: <TEvent extends keyof KernelEventMap>(event: TEvent, payload: KernelEventMap[TEvent]) => void;
};

type RunOptions = {
  userMessageId?: string;
  attachments?: ChatMessage["attachments"];
  abortSignal?: AbortSignal;
  isActive?: () => boolean;
};

const MAX_TOOL_ROUNDS = 5;

export class AgentKernel {
  constructor(private readonly options: AgentKernelOptions) {}

  async run(session: RuntimeSession, runId: string, userText: string, runOptions: RunOptions = {}) {
    const isActive = runOptions.isActive ?? (() => true);
    this.options.emit("agent.lifecycle", { sessionId: session.id, runId, phase: "start" });
    this.options.emit("pet.activity", { sessionId: session.id, activity: activityForTask(userText), active: true, reason: "task-start" });
    this.options.emit("pet.emotion", { sessionId: session.id, emotion: "thinking", intensity: 0.72, reason: "agent-kernel" });

    const explicitMemory = this.options.memory.extractExplicitMemory(userText, session.id);
    if (explicitMemory) {
      const committed = this.options.memory.commit(explicitMemory, "chat", runOptions.userMessageId ?? runId);
      this.options.emit("memory.proposal", { sessionId: session.id, proposal: committed });
    }

    const history = this.options.store.listMessages(session.id).filter((message) => message.id !== runOptions.userMessageId);
    const context = await this.options.contextBuilder.build({ session, userText, history, abortSignal: runOptions.abortSignal });
    const messages = chatMessagesToModelMessages(context.recentHistory, userText, runOptions.attachments);
    const plan = await this.createPlan(session.id, runId, userText, context.context, runOptions.abortSignal);
    const instructions = plan ? `${context.context}\n\n执行计划：\n${formatPlan(plan)}` : context.context;
    return this.runLoop(session, runId, userText, {
      instructions,
      messages,
      streamedText: "",
      startRound: 0,
      completedToolResults: [],
    }, runOptions);
  }

  async resume(session: RuntimeSession, continuation: AgentContinuation, resolvedToolResults: AgentToolResult[], runOptions: RunOptions = {}) {
    const isActive = runOptions.isActive ?? (() => true);
    if (!isActive()) return null;
    this.options.emit("agent.lifecycle", {
      sessionId: session.id,
      runId: continuation.runId,
      phase: "step",
      message: "权限确认后继续推理",
    });
    this.options.emit("pet.activity", { sessionId: session.id, activity: activityForTask(continuation.userText), active: true, reason: "permission-resume" });
    this.options.emit("pet.emotion", { sessionId: session.id, emotion: "thinking", intensity: 0.72, reason: "agent-resume" });

    const allResults = [...continuation.completedToolResults, ...resolvedToolResults];
    return this.runLoop(session, continuation.runId, continuation.userText, {
      instructions: continuation.instructions,
      messages: [...continuation.messages, createToolResultMessage(allResults)],
      streamedText: continuation.streamedText,
      startRound: continuation.nextRound,
      completedToolResults: [],
    }, runOptions);
  }

  private async runLoop(
    session: RuntimeSession,
    runId: string,
    userText: string,
    state: {
      instructions: string;
      messages: ModelMessage[];
      streamedText: string;
      startRound: number;
      completedToolResults: AgentToolResult[];
    },
    runOptions: RunOptions,
  ): Promise<AgentRunResult | null> {
    const isActive = runOptions.isActive ?? (() => true);
    const messages = [...state.messages];
    const instructions = state.instructions;
    let finalText = "";
    let finalSurface: SurfaceSpec | undefined;
    let streamedText = state.streamedText;

    for (let round = state.startRound; round < MAX_TOOL_ROUNDS; round += 1) {
      if (!isActive()) return null;
      this.options.emit("agent.lifecycle", {
        sessionId: session.id,
        runId,
        phase: "step",
        message: round === 0 ? "构建上下文" : "工具结果回填后继续推理",
      });

      const step = await this.generate(instructions, messages, runOptions.abortSignal, (chunk) => {
        streamedText += chunk;
        this.options.emit("agent.delta", { sessionId: session.id, runId, text: chunk });
      });
      if (!isActive()) return null;
      if (!step) {
        finalText = "还没有可用的模型 API 配置。请在配置页保存模型 API Key 和模型名后再发送消息。";
        break;
      }

      if (!step.toolCalls.length) {
        const parsed = parseAgentSurfaceResponse(step.text, { now: new Date().toISOString(), userText });
        finalText = parsed.text || step.text.trim();
        finalSurface = parsed.surface;
        break;
      }

      const toolResults = await Promise.all(
        step.toolCalls.map(async (call) => {
          const payload = await this.options.tools.invoke(
            { name: call.toolName, input: call.input, sessionId: session.id, runId, source: "agent" },
            { sessionId: session.id, runId },
          );
          return { call, payload };
        }),
      );

      for (const { call, payload } of toolResults) {
        this.options.emit("tool.run", { run: payload.run });
        if (payload.run.permissionId) {
          const request = this.options.store.getPermission(payload.run.permissionId);
          if (request) this.options.emit("permission.request", { request });
        }
        if (payload.run.status === "pending_permission") {
          this.options.emit("agent.lifecycle", {
            sessionId: session.id,
            runId,
            phase: "waiting_permission",
            toolName: call.toolName,
            message: "等待用户确认危险工具调用",
          });
          finalText = `需要你确认后才能执行工具：${call.toolName}。我已经把确认请求放到工具面板。`;
          const continuation = createContinuation({
            sessionId: session.id,
            runId,
            userText,
            instructions,
            messages,
            stepText: step.text,
            calls: step.toolCalls,
            toolResults,
            nextRound: round + 1,
            streamedText,
          });
          return {
            message: this.finish(session, runId, finalText, undefined, streamedText),
            continuation,
          };
        }
      }

      messages.push(createAssistantToolMessage(step.text, step.toolCalls));
      messages.push(createToolResultMessage(toolResults.map(({ call, payload }) => ({
        call,
        value: {
          tool: call.toolName,
          status: payload.run.status,
          result: payload.result,
        },
      }))));
    }

    if (!finalText && !finalSurface) {
      finalText = "这轮工具链没有产出最终回答，请重试或缩小任务范围。";
    }
    finalText = await this.reflect(userText, finalText, runId, session.id, runOptions.abortSignal);
    return { message: this.finish(session, runId, finalText, finalSurface, streamedText) };
  }

  private async createPlan(sessionId: string, runId: string, userText: string, context: string, abortSignal?: AbortSignal) {
    try {
      const plan = (await generateAgentPlanWithAiSdk({ userText, context, abortSignal })) ?? heuristicPlan(userText);
      this.emitPlan(sessionId, runId, plan);
      return plan;
    } catch {
      const plan = heuristicPlan(userText);
      this.emitPlan(sessionId, runId, plan);
      return plan;
    }
  }

  private emitPlan(sessionId: string, runId: string, plan: AgentPlan) {
    if (!plan.steps.length) return;
    this.options.emit("agent.lifecycle", {
      sessionId,
      runId,
      phase: "step",
      message: `计划：${formatPlan(plan)}`,
    });
  }

  private async reflect(userText: string, finalText: string, runId: string, sessionId: string, abortSignal?: AbortSignal) {
    try {
      const reflection = await generateAgentReflectionWithAiSdk({ userText, finalText, abortSignal });
      if (!reflection) return finalText;
      this.options.emit("agent.lifecycle", {
        sessionId,
        runId,
        phase: "step",
        message: reflection.complete ? "反思检查：回答已覆盖用户请求。" : `反思检查：${reflection.issues.join("；")}`,
      });
      if (reflection.finalAnswer?.trim() && reflection.finalAnswer.trim() !== finalText.trim()) {
        return reflection.finalAnswer.trim();
      }
      if (!reflection.complete && reflection.issues.length) {
        return `${finalText.trim()}\n\n补充检查：${reflection.issues.join("；")}`;
      }
      return finalText;
    } catch {
      return finalText;
    }
  }

  private async generate(instructions: string, messages: ModelMessage[], abortSignal?: AbortSignal, onChunk?: (chunk: string) => void) {
    return streamAgentStepWithAiSdk({
      instructions,
      messages,
      tools: this.options.tools.aiSdkTools(),
      abortSignal,
      onChunk,
    });
  }

  private finish(session: RuntimeSession, runId: string, text: string, surface: SurfaceSpec | undefined, streamedText: string) {
    if (surface) {
      this.options.store.saveSurface(session.id, surface);
      this.options.emit("ui.surface.create", { sessionId: session.id, surface });
    }

    const finalDelta = streamedText && text.startsWith(streamedText) ? text.slice(streamedText.length) : text;
    if (finalDelta || surface) {
      this.options.emit("agent.delta", { sessionId: session.id, runId, text: finalDelta, ...(surface ? { surface } : {}) });
    }

    const assistantMessage: ChatMessage = {
      id: `msg_${crypto.randomUUID()}`,
      role: "assistant",
      content: text.trim() || (surface ? "可交互卡片已生成。" : "模型没有返回文本。"),
      createdAt: new Date().toISOString(),
      runId,
      ...(surface ? { surface } : {}),
    };
    this.options.store.saveMessage(session.id, assistantMessage);
    this.options.emit("agent.lifecycle", { sessionId: session.id, runId, phase: "end" });
    this.options.emit("pet.emotion", { sessionId: session.id, emotion: "speaking", intensity: 0.55, reason: "answer-ready" });
    this.options.emit("pet.activity", { sessionId: session.id, activity: restActivity(), active: false, reason: "turn-complete" });
    return assistantMessage;
  }
}

function createAssistantToolMessage(text: string, calls: AiSdkToolCall[]): ModelMessage {
  const content: Array<{ type: "text"; text: string } | ToolCallPart> = [];
  if (text.trim()) content.push({ type: "text", text });
  content.push(
    ...calls.map((call) => ({
      type: "tool-call" as const,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      input: call.input,
    })),
  );
  return { role: "assistant", content };
}

function createToolResultMessage(results: Array<{ call: AiSdkToolCall; value: unknown }>): ModelMessage {
  const content = results.map(({ call, value }) => ({
    type: "tool-result" as const,
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    output: {
      type: "json" as const,
      value: toJsonValue(value),
    },
  })) satisfies ToolResultPart[];
  return { role: "tool", content };
}

function createContinuation(params: {
  sessionId: string;
  runId: string;
  userText: string;
  instructions: string;
  messages: ModelMessage[];
  stepText: string;
  calls: AiSdkToolCall[];
  toolResults: Array<{ call: AiSdkToolCall; payload: { run: { permissionId?: string; status: string }; result?: unknown } }>;
  nextRound: number;
  streamedText: string;
}): AgentContinuation {
  const completedToolResults: AgentToolResult[] = [];
  const pendingTools: AgentContinuation["pendingTools"] = [];

  for (const { call, payload } of params.toolResults) {
    if (payload.run.permissionId && payload.run.status === "pending_permission") {
      pendingTools.push({ permissionId: payload.run.permissionId, call });
      continue;
    }
    completedToolResults.push({
      call,
      value: {
        tool: call.toolName,
        status: payload.run.status,
        result: payload.result,
      },
      permissionId: payload.run.permissionId,
    });
  }

  return {
    sessionId: params.sessionId,
    runId: params.runId,
    userText: params.userText,
    instructions: params.instructions,
    messages: [...params.messages, createAssistantToolMessage(params.stepText, params.calls)],
    completedToolResults,
    pendingTools,
    nextRound: params.nextRound,
    streamedText: params.streamedText,
  };
}

function toJsonValue(value: unknown) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function formatPlan(plan: AgentPlan) {
  return plan.steps.map((step, index) => `${index + 1}. [${step.status}] ${step.title}`).join(" ");
}

function heuristicPlan(userText: string): AgentPlan {
  const needsResearch = /查询|搜索|调研|资料|weather|search|lookup|research/i.test(userText);
  return {
    goal: userText.slice(0, 120),
    steps: [
      { id: "understand", title: "确认用户目标和约束", status: "completed", requiresTool: false },
      { id: "gather", title: needsResearch ? "使用可用工具收集必要信息" : "检查上下文并判断是否需要工具", status: "in_progress", requiresTool: needsResearch },
      { id: "answer", title: "基于结果给出可执行回答", status: "pending", requiresTool: false },
    ],
  };
}

function activityForTask(text: string): PetActivityEvent["activity"] {
  return /查询|天气|搜索|资料|调研|research|search|lookup|docs/i.test(text) ? "research" : "coding";
}

function restActivity(): PetActivityEvent["activity"] {
  return Math.random() > 0.5 ? "exercise" : "sleeping";
}
