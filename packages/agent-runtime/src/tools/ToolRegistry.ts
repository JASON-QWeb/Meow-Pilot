import { exec as execCallback, spawn } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";
import { jsonSchema, tool, type ModelMessage, type ToolSet } from "ai";
import { load as loadHtml } from "cheerio";
import { streamAgentStepWithAiSdk } from "../providers/aiSdk";
import type {
  Memory,
  PermissionRequest,
  ScheduledTask,
  SkillManageParams,
  SurfaceSpec,
  ToolInvokeParams,
  ToolInvokePayload,
  ToolRunRecord,
  ToolSummary,
} from "@pet/protocol";
import type { PetStore } from "../storage";
import type { MemoryService } from "../memory/MemoryService";
import type { SkillService } from "../skills/SkillService";
import { findWorkspaceRoot } from "../workspace";

const exec = promisify(execCallback);
const MAX_FILE_BYTES = 1_000_000;
const MAX_TOOL_OUTPUT = 24_000;
const EMPTY_INPUT_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
} satisfies Record<string, unknown>;

export type ToolContext = {
  sessionId?: string;
  runId?: string;
  approved?: boolean;
};

type ApprovalDecision =
  | { required: false }
  | {
      required: true;
      title: string;
      description: string;
      permissionLevel: "confirm" | "dangerous";
      risk: string;
      diff?: string;
      command?: string;
      cwd?: string;
    };

export type ToolDefinition = {
  summary: ToolSummary;
  run: (input: Record<string, unknown>, context: ToolContext) => Promise<ToolExecutionResult> | ToolExecutionResult;
  approval?: (input: Record<string, unknown>, context: ToolContext) => ApprovalDecision;
};

type ToolExecutionResult = {
  output: unknown;
  summary?: string;
  exitCode?: number;
  cwd?: string;
};

type ToolRegistryOptions = {
  onTaskChanged?: (action: "created" | "updated" | "deleted" | "triggered", task?: ScheduledTask) => void;
  onSurfaceUpdated?: (sessionId: string, surface: SurfaceSpec) => void;
};

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(
    private readonly store: PetStore,
    private readonly memory: MemoryService,
    private readonly skills: SkillService,
    private readonly workspaceRoot = findWorkspaceRoot(),
    extraTools: ToolDefinition[] = [],
    private readonly options: ToolRegistryOptions = {},
  ) {
    for (const tool of [...this.createTools(), ...extraTools]) this.register(tool);
  }

  register(definition: ToolDefinition) {
    this.tools.set(definition.summary.name, definition);
    return definition.summary;
  }

  catalog() {
    return [...this.tools.values()].map((tool) => tool.summary);
  }

  aiSdkTools(allowedNames?: Iterable<string>): ToolSet {
    const allowed = allowedNames ? new Set(allowedNames) : null;
    return Object.fromEntries(
      [...this.tools.values()].filter((definition) => !allowed || allowed.has(definition.summary.name)).map((definition) => [
        definition.summary.name,
        tool({
          description: `${definition.summary.description} 权限级别：${definition.summary.permissionLevel}`,
          inputSchema: jsonSchema(definition.summary.inputSchema ?? EMPTY_INPUT_SCHEMA),
          strict: true,
        }),
      ]),
    ) as ToolSet;
  }

  async invoke(params: ToolInvokeParams, context: ToolContext = {}): Promise<ToolInvokePayload> {
    const tool = this.tools.get(params.name);
    if (!tool) throw new Error(`Unknown tool: ${params.name}`);
    if (tool.summary.permissionLevel === "forbidden") {
      throw new Error(`Tool is forbidden: ${params.name}`);
    }

    const input = params.input ?? {};
    const sessionId = params.sessionId ?? context.sessionId;
    const runId = params.runId ?? context.runId;
    const approval = context.approved ? { required: false as const } : tool.approval?.(input, { sessionId, runId }) ?? defaultApproval(tool.summary);
    const createdAt = new Date().toISOString();

    if (approval.required) {
      const permission: PermissionRequest = {
        id: `perm_${crypto.randomUUID()}`,
        sessionId,
        runId,
        toolName: tool.summary.name,
        title: approval.title,
        description: approval.description,
        permissionLevel: approval.permissionLevel,
        risk: approval.risk,
        input,
        diff: approval.diff,
        command: approval.command,
        cwd: approval.cwd,
        status: "pending",
        createdAt,
      };
      this.store.savePermission(permission);
      const pendingRun: ToolRunRecord = {
        id: `toolrun_${crypto.randomUUID()}`,
        sessionId,
        runId,
        toolName: tool.summary.name,
        input,
        status: "pending_permission",
        permissionId: permission.id,
        cwd: approval.cwd,
        createdAt,
        summary: approval.description,
        risk: approval.risk,
      };
      this.store.saveToolRun(pendingRun);
      return { run: pendingRun };
    }

    return this.executeTool(tool, input, { sessionId, runId, approved: context.approved });
  }

  async resolvePermission(permissionId: string, approved: boolean) {
    const request = this.store.getPermission(permissionId);
    if (!request) throw new Error("Permission request not found.");
    if (request.status !== "pending") {
      return { request };
    }

    const resolved = this.store.resolvePermission(permissionId, approved ? "approved" : "denied");
    if (!resolved) throw new Error("Permission request could not be resolved.");

    if (!approved) {
      const pending = this.store.getToolRunByPermission(permissionId);
      if (pending) {
        const deniedRun: ToolRunRecord = {
          ...pending,
          status: "denied",
          completedAt: new Date().toISOString(),
          summary: "用户拒绝了这次工具调用。",
        };
        this.store.saveToolRun(deniedRun);
        return { request: resolved, run: deniedRun };
      }
      return { request: resolved };
    }

    const payload = await this.invoke(
      {
        name: request.toolName,
        input: request.input,
        sessionId: request.sessionId,
        runId: request.runId,
        source: "ui",
      },
      { sessionId: request.sessionId, runId: request.runId, approved: true },
    );
    return { request: resolved, ...payload };
  }

  private skillExecutable(name: string | undefined) {
    if (!name) return undefined;
    const view = this.skills.view(name);
    const skillPath = view?.skill.path;
    if (!skillPath) return undefined;
    const candidate = resolve(skillPath, "run.sh");
    return existsSync(candidate) ? candidate : undefined;
  }

  private async executeTool(tool: ToolDefinition, input: Record<string, unknown>, context: ToolContext): Promise<ToolInvokePayload> {
    const started = new Date().toISOString();
    const run: ToolRunRecord = {
      id: `toolrun_${crypto.randomUUID()}`,
      sessionId: context.sessionId,
      runId: context.runId,
      toolName: tool.summary.name,
      input,
      status: "success",
      createdAt: started,
    };

    try {
      const result = await tool.run(input, context);
      const completed: ToolRunRecord = {
        ...run,
        output: result.output,
        exitCode: result.exitCode,
        cwd: result.cwd,
        completedAt: new Date().toISOString(),
        summary: result.summary ?? summarizeOutput(result.output),
      };
      this.store.saveToolRun(completed);
      return { run: completed, result: result.output };
    } catch (error) {
      const failed: ToolRunRecord = {
        ...run,
        status: "failed",
        output: { error: error instanceof Error ? error.message : "Unknown tool error" },
        completedAt: new Date().toISOString(),
        summary: error instanceof Error ? error.message : "Unknown tool error",
      };
      this.store.saveToolRun(failed);
      return { run: failed, result: failed.output };
    }
  }

  private createTools(): ToolDefinition[] {
    return [
      {
        summary: {
          name: "terminal_exec",
          description: "执行本机 shell 命令，危险命令需要用户确认。",
          category: "terminal",
          permissionLevel: "confirm",
          inputSchema: inputSchema(
            {
              command: stringProperty("要执行的 shell 命令。"),
              cwd: stringProperty("命令工作目录，相对 workspace 或绝对路径。"),
              timeoutMs: numberProperty("超时时间，单位毫秒，范围 1000-120000。"),
              env: objectProperty("允许注入的环境变量，只接受安全前缀。"),
            },
            ["command"],
          ),
        },
        approval: (input) => terminalApproval(input, this.workspaceRoot),
        run: async (input) => {
          const command = readString(input.command);
          if (!command) throw new Error("terminal_exec requires command.");
          const cwd = normalizeCwd(readString(input.cwd), this.workspaceRoot);
          const timeout = clampNumber(input.timeoutMs, 1_000, 120_000, 20_000);
          const { stdout, stderr, exitCode } = await runShellCommand(command, {
            cwd,
            timeout,
            env: allowedEnv(input.env),
            shell: process.env.SHELL || "/bin/zsh",
          });
          const output = {
            stdout: stdout.slice(0, MAX_TOOL_OUTPUT),
            stderr: stderr.slice(0, MAX_TOOL_OUTPUT),
            exitCode,
          };
          return { output, summary: stdout || stderr || `命令已执行，退出码 ${exitCode}。`, cwd, exitCode };
        },
      },
      {
        summary: {
          name: "file_search",
          description: "用 rg 搜索文件名或内容。",
          category: "file",
          permissionLevel: "read",
          inputSchema: inputSchema(
            {
              query: stringProperty("搜索关键词、正则或文件名片段。"),
              path: stringProperty("搜索目录，默认 workspace。"),
              mode: stringProperty("搜索模式。content 搜内容，files 搜文件名。", { enum: ["content", "files"] }),
            },
            ["query"],
          ),
        },
        approval: (input) => filePathReadApproval(input, this.workspaceRoot, "确认搜索文件"),
        run: async (input) => {
          const query = readString(input.query);
          if (!query) throw new Error("file_search requires query.");
          const target = normalizeCwd(readString(input.path), this.workspaceRoot);
          const mode = readString(input.mode) === "files" ? "--files" : "-n";
          const command = mode === "--files" ? `rg --files ${shellQuote(target)}` : `rg -n --hidden --glob '!node_modules' --glob '!dist' --glob '!target' ${shellQuote(query)} ${shellQuote(target)}`;
          const { stdout, stderr } = await exec(command, { cwd: this.workspaceRoot, timeout: 12_000, maxBuffer: 1_000_000, shell: process.env.SHELL || "/bin/zsh" });
          return { output: { stdout: stdout.slice(0, MAX_TOOL_OUTPUT), stderr }, summary: stdout.slice(0, 500), cwd: target };
        },
      },
      {
        summary: {
          name: "file_list",
          description: "列出目录下的文件和子目录。",
          category: "file",
          permissionLevel: "read",
          inputSchema: inputSchema({
            path: stringProperty("要列出的目录路径，默认 workspace。"),
            limit: numberProperty("最多返回条目数。"),
          }),
        },
        approval: (input) => filePathReadApproval(input, this.workspaceRoot, "确认列出目录"),
        run: async (input) => {
          const target = normalizeCwd(readString(input.path), this.workspaceRoot);
          const entries = await listDirectory(target, clampNumber(input.limit, 1, 500, 120));
          return { output: { path: target, entries }, summary: `列出 ${entries.length} 个条目。`, cwd: target };
        },
      },
      {
        summary: {
          name: "file_read",
          description: "读取文本文件。workspace 外或大文件需要确认。",
          category: "file",
          permissionLevel: "read",
          inputSchema: inputSchema(
            {
              path: stringProperty("要读取的文件路径。"),
              maxBytes: numberProperty("最大读取字节数。"),
            },
            ["path"],
          ),
        },
        approval: (input) => fileReadApproval(input, this.workspaceRoot),
        run: async (input) => {
          const path = normalizePathRequired(input.path, this.workspaceRoot);
          const maxBytes = clampNumber(input.maxBytes, 1_000, 2_000_000, MAX_FILE_BYTES);
          const bytes = await readFile(path);
          if (bytes.byteLength > maxBytes) throw new Error(`File is too large (${bytes.byteLength} bytes).`);
          return { output: { path, content: bytes.toString("utf8") }, summary: `读取 ${relative(this.workspaceRoot, path) || path}` };
        },
      },
      {
        summary: {
          name: "file_write",
          description: "创建或覆盖文本文件，写入前展示 diff。",
          category: "file",
          permissionLevel: "confirm",
          inputSchema: inputSchema(
            {
              path: stringProperty("要写入的文件路径。"),
              content: stringProperty("完整文件内容。"),
            },
            ["path", "content"],
          ),
        },
        approval: (input) => fileWriteApproval(input, this.workspaceRoot),
        run: async (input) => {
          const path = normalizePathRequired(input.path, this.workspaceRoot);
          const content = readString(input.content) ?? "";
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, content, "utf8");
          return { output: { path, bytes: Buffer.byteLength(content) }, summary: `已写入 ${relative(this.workspaceRoot, path) || path}` };
        },
      },
      {
        summary: {
          name: "file_patch",
          description: "按 search/replace 修改文本文件，写入前展示 diff。",
          category: "file",
          permissionLevel: "confirm",
          inputSchema: inputSchema(
            {
              path: stringProperty("要修改的文件路径。"),
              search: stringProperty("要查找的原文。"),
              replace: stringProperty("替换后的文本。"),
            },
            ["path", "search", "replace"],
          ),
        },
        approval: (input) => filePatchApproval(input, this.workspaceRoot),
        run: async (input) => {
          const path = normalizePathRequired(input.path, this.workspaceRoot);
          const search = readString(input.search);
          const replace = readString(input.replace) ?? "";
          if (!search) throw new Error("file_patch requires search.");
          const before = await readFile(path, "utf8");
          if (!before.includes(search)) throw new Error("Search text was not found.");
          const replacements = countOccurrences(before, search);
          const after = before.split(search).join(replace);
          await writeFile(path, after, "utf8");
          return { output: { path, replacements }, summary: `已修改 ${relative(this.workspaceRoot, path) || path}，替换 ${replacements} 处。` };
        },
      },
      {
        summary: {
          name: "file_delete",
          description: "删除文件或目录。",
          category: "file",
          permissionLevel: "dangerous",
          inputSchema: inputSchema({ path: stringProperty("要删除的文件或目录路径。") }, ["path"]),
        },
        approval: (input) => fileDeleteApproval(input, this.workspaceRoot),
        run: async (input) => {
          const path = normalizePathRequired(input.path, this.workspaceRoot);
          await rm(path, { recursive: true, force: true });
          return { output: { path, deleted: true }, summary: `已删除 ${relative(this.workspaceRoot, path) || path}` };
        },
      },
      {
        summary: {
          name: "file_move",
          description: "移动或重命名文件。",
          category: "file",
          permissionLevel: "confirm",
          inputSchema: inputSchema(
            {
              from: stringProperty("原路径。"),
              to: stringProperty("目标路径。"),
            },
            ["from", "to"],
          ),
        },
        approval: (input) => fileMoveApproval(input, this.workspaceRoot),
        run: async (input) => {
          const from = normalizePathRequired(input.from, this.workspaceRoot);
          const to = normalizePathRequired(input.to, this.workspaceRoot);
          await mkdir(dirname(to), { recursive: true });
          await rename(from, to);
          return { output: { from, to }, summary: `已移动到 ${relative(this.workspaceRoot, to) || to}` };
        },
      },
      {
        summary: {
          name: "memory_search",
          description: "查询长期记忆。",
          category: "memory",
          permissionLevel: "read",
          inputSchema: inputSchema({
            query: stringProperty("记忆查询关键词。"),
            limit: numberProperty("返回数量上限。"),
          }),
        },
        run: (input) => ({ output: { memories: this.memory.query(readString(input.query), undefined, clampNumber(input.limit, 1, 20, 8)) } }),
      },
      {
        summary: {
          name: "memory_propose",
          description: "生成记忆提案，不直接写入。",
          category: "memory",
          permissionLevel: "read",
          inputSchema: inputSchema(
            {
              content: stringProperty("记忆内容。"),
              kind: stringProperty("记忆类型。", { enum: ["user_profile", "pet_note", "semantic", "episodic", "procedural", "social"] }),
            },
            ["content"],
          ),
        },
        run: (input, context) => {
          const content = readString(input.content);
          if (!content) throw new Error("memory_propose requires content.");
          return { output: { proposal: this.memory.propose({ sessionId: context.sessionId, content, kind: readMemoryKind(input.kind), source: "tool" }) } };
        },
      },
      {
        summary: {
          name: "memory_commit",
          description: "提交长期记忆。",
          category: "memory",
          permissionLevel: "confirm",
          inputSchema: inputSchema(
            {
              content: stringProperty("要保存的记忆内容。"),
              kind: stringProperty("记忆类型。", { enum: ["user_profile", "pet_note", "semantic", "episodic", "procedural", "social"] }),
            },
            ["content"],
          ),
        },
        approval: (input) => ({
          required: true,
          title: "保存长期记忆",
          description: readString(input.content) ?? "保存一条长期记忆。",
          permissionLevel: "confirm",
          risk: "写入本地长期记忆，会影响后续上下文。",
        }),
        run: (input, context) => {
          const content = readString(input.content);
          if (!content) throw new Error("memory_commit requires content.");
          const memory = this.memory.commit(this.memory.propose({ sessionId: context.sessionId, content, kind: readMemoryKind(input.kind), source: "tool", confidence: 0.86 }), "tool", context.runId ?? "manual");
          return { output: { memory }, summary: `已保存记忆：${memory.summary ?? memory.content}` };
        },
      },
      {
        summary: {
          name: "skill_search",
          description: "搜索可用 Skill 摘要。",
          category: "skill",
          permissionLevel: "read",
          inputSchema: inputSchema({
            query: stringProperty("Skill 搜索关键词。"),
            limit: numberProperty("返回数量上限。"),
          }),
        },
        run: (input) => ({ output: { skills: this.skills.search(readString(input.query), clampNumber(input.limit, 1, 12, 5)) } }),
      },
      {
        summary: {
          name: "skill_view",
          description: "读取某个 Skill 的完整 SKILL.md。",
          category: "skill",
          permissionLevel: "read",
          inputSchema: inputSchema({ name: stringProperty("Skill 名称。") }, ["name"]),
        },
        run: (input) => {
          const name = readString(input.name);
          if (!name) throw new Error("skill_view requires name.");
          const view = this.skills.view(name);
          if (!view) throw new Error(`Skill not found: ${name}`);
          return { output: view, summary: `已读取 Skill：${name}` };
        },
      },
      {
        summary: {
          name: "skill_run",
          description: "加载 prompt-only Skill，或在 Skill 提供 run.sh 时经确认执行。",
          category: "skill",
          permissionLevel: "read",
          inputSchema: inputSchema(
            {
              name: stringProperty("Skill 名称。"),
              input: stringProperty("传给 Skill 的用户输入。"),
            },
            ["name"],
          ),
        },
        approval: (input) => {
          const executable = this.skillExecutable(readString(input.name));
          if (!executable) return { required: false };
          return {
            required: true,
            title: "执行 Skill 脚本",
            description: executable,
            permissionLevel: "confirm",
            risk: "Skill 脚本会在本机运行，可能读取或修改本地资源。",
            command: executable,
            cwd: dirname(executable),
          };
        },
        run: (input, context) => {
          const name = readString(input.name);
          if (!name) throw new Error("skill_run requires name.");
          const view = this.skills.view(name);
          if (!view) throw new Error(`Skill not found: ${name}`);
          const executable = this.skillExecutable(name);
          if (!executable) {
            this.skills.recordRun(name, { sessionId: context.sessionId, runId: context.runId, input: readString(input.input), status: "loaded" });
            return { output: { skill: view.skill, instructions: view.content, executable: false }, summary: `已加载 Skill：${name}` };
          }
          return runShellCommand(shellQuote(executable), {
            cwd: dirname(executable),
            timeout: 30_000,
            env: { ...allowedEnv(undefined), PET_SKILL_INPUT: readString(input.input) ?? "" },
            shell: process.env.SHELL || "/bin/zsh",
          }).then(({ stdout, stderr, exitCode }) => {
            const output = { skill: view.skill, executable: true, stdout: stdout.slice(0, MAX_TOOL_OUTPUT), stderr: stderr.slice(0, MAX_TOOL_OUTPUT), exitCode };
            this.skills.recordRun(name, { sessionId: context.sessionId, runId: context.runId, input: readString(input.input), status: exitCode === 0 ? "success" : "failed", result: output });
            return { output, summary: stdout || stderr || `Skill 脚本退出码 ${exitCode}`, exitCode, cwd: dirname(executable) };
          });
        },
      },
      {
        summary: {
          name: "skill_manage",
          description: "启用、禁用或隔离 Skill。",
          category: "skill",
          permissionLevel: "confirm",
          inputSchema: inputSchema(
            {
              action: stringProperty("管理动作。", { enum: ["enable", "disable", "quarantine"] }),
              name: stringProperty("Skill 名称。"),
            },
            ["action", "name"],
          ),
        },
        approval: (input) => ({
          required: true,
          title: "管理 Skill",
          description: `${readString(input.action) ?? "manage"} ${readString(input.name) ?? ""}`,
          permissionLevel: "confirm",
          risk: "会改变 Skill 是否能被 Agent 自动使用。",
        }),
        run: (input) => {
          const action = readString(input.action) as SkillManageParams["action"] | undefined;
          const name = readString(input.name);
          if (!action || !name) throw new Error("skill_manage requires action and name.");
          const skill = this.skills.setState(name, action);
          if (!skill) throw new Error(`Skill not found: ${name}`);
          return { output: { skill }, summary: `Skill ${name} 已${action}` };
        },
      },
      {
        summary: {
          name: "surface_render",
          description: "生成受控 SurfaceSpec。",
          category: "surface",
          permissionLevel: "read",
          inputSchema: inputSchema({
            title: stringProperty("卡片标题。"),
            text: stringProperty("卡片正文。"),
            body: stringProperty("卡片正文，text 的别名。"),
            intent: stringProperty("卡片意图。", { enum: ["chat", "search", "calendar", "weather", "music", "video", "task", "memory", "skill", "settings"] }),
          }),
        },
        run: (input) => ({ output: { surface: createSurfaceFromInput(input) }, summary: "已生成可交互卡片。" }),
      },
      {
        summary: {
          name: "surface_update",
          description: "更新已渲染 Surface。",
          category: "surface",
          permissionLevel: "read",
          inputSchema: inputSchema({
            surfaceId: stringProperty("要更新的 Surface id。"),
            patch: objectProperty("更新草案对象。"),
          }),
        },
        run: (input, context) => {
          const sessionId = context.sessionId;
          const surfaceId = readString(input.surfaceId);
          if (!sessionId) throw new Error("surface_update requires session context.");
          if (!surfaceId) throw new Error("surface_update requires surfaceId.");
          const current = this.store.getSurface(sessionId, surfaceId);
          if (!current) throw new Error(`Surface not found: ${surfaceId}`);
          const updated = this.store.updateSurface(sessionId, applySurfacePatch(current, input.patch));
          if (!updated) throw new Error(`Surface not found: ${surfaceId}`);
          this.options.onSurfaceUpdated?.(sessionId, updated);
          return { output: { surface: updated }, summary: `已更新 Surface：${updated.title ?? updated.id}` };
        },
      },
      {
        summary: {
          name: "web_search",
          description: "联网搜索网页。",
          category: "web",
          permissionLevel: "confirm",
          inputSchema: inputSchema({ query: stringProperty("搜索关键词。") }, ["query"]),
        },
        approval: (input) => webApproval("联网搜索", readString(input.query) ?? ""),
        run: async (input) => {
          const query = readString(input.query);
          if (!query) throw new Error("web_search requires query.");
          const results = await duckDuckGoSearch(query);
          return { output: { results }, summary: results.map((item) => item.title).join("\n") };
        },
      },
      {
        summary: {
          name: "web_fetch",
          description: "读取网页文本。",
          category: "web",
          permissionLevel: "confirm",
          inputSchema: inputSchema({ url: stringProperty("要读取的网页 URL。") }, ["url"]),
        },
        approval: (input) => webApproval("读取网页", readString(input.url) ?? ""),
        run: async (input) => {
          const url = readString(input.url);
          if (!url) throw new Error("web_fetch requires url.");
          const page = await fetchWebPage(url);
          return { output: page, summary: `已读取 ${page.title ? `${page.title} ` : ""}${url}` };
        },
      },
      {
        summary: {
          name: "calendar_read",
          description: "读取 macOS 日历摘要。",
          category: "calendar",
          permissionLevel: "read",
          inputSchema: inputSchema({
            start: stringProperty("开始日期或时间，默认今天。"),
            end: stringProperty("结束日期或时间。"),
            days: numberProperty("从 start 起读取多少天，默认 1 天。"),
          }),
        },
        run: async (input) => {
          const calendar = await readCalendarEvents(input, this.workspaceRoot);
          return { output: calendar, summary: calendar.summary };
        },
      },
      {
        summary: {
          name: "clipboard",
          description: "读取或写入系统剪贴板。",
          category: "clipboard",
          permissionLevel: "confirm",
          inputSchema: inputSchema(
            {
              action: stringProperty("剪贴板动作。", { enum: ["read", "write"] }),
              text: stringProperty("写入剪贴板的文本。"),
            },
            ["action"],
          ),
        },
        approval: (input) => ({
          required: true,
          title: readString(input.action) === "write" ? "写入剪贴板" : "读取剪贴板",
          description: readString(input.action) === "write" ? (readString(input.text) ?? "").slice(0, 160) : "读取当前系统剪贴板文本。",
          permissionLevel: "confirm",
          risk: "剪贴板可能包含敏感信息，读取或覆盖前需要确认。",
        }),
        run: async (input) => {
          const action = readString(input.action);
          if (action === "read") {
            const { stdout } = await runShellCommand("pbpaste", { cwd: this.workspaceRoot, timeout: 5_000, env: allowedEnv(undefined), shell: process.env.SHELL || "/bin/zsh" });
            return { output: { text: stdout.slice(0, MAX_TOOL_OUTPUT) }, summary: "已读取剪贴板文本。" };
          }
          if (action === "write") {
            const text = readString(input.text) ?? "";
            await writeClipboard(text);
            return { output: { bytes: Buffer.byteLength(text) }, summary: "已写入剪贴板。" };
          }
          throw new Error("clipboard requires action read or write.");
        },
      },
      {
        summary: {
          name: "notification",
          description: "发送本机通知。",
          category: "notification",
          permissionLevel: "confirm",
          inputSchema: inputSchema(
            {
              title: stringProperty("通知标题。"),
              body: stringProperty("通知正文。"),
            },
            ["title"],
          ),
        },
        approval: (input) => ({
          required: true,
          title: "发送系统通知",
          description: readString(input.title) ?? "通知",
          permissionLevel: "confirm",
          risk: "会调用系统通知能力。",
        }),
        run: async (input) => {
          const title = readString(input.title) ?? "Meow Pilot";
          const body = readString(input.body) ?? "";
          await runShellCommand(`osascript -e ${shellQuote(`display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`)}`, {
            cwd: this.workspaceRoot,
            timeout: 5_000,
            env: allowedEnv(undefined),
            shell: process.env.SHELL || "/bin/zsh",
          });
          return { output: { sent: true }, summary: "系统通知已发送。" };
        },
      },
      {
        summary: {
          name: "browser_open",
          description: "用系统默认浏览器打开 URL。",
          category: "browser",
          permissionLevel: "confirm",
          inputSchema: inputSchema({ url: stringProperty("要打开的 URL。") }, ["url"]),
        },
        approval: (input) => ({
          required: true,
          title: "打开浏览器",
          description: readString(input.url) ?? "",
          permissionLevel: "confirm",
          risk: "会打开外部应用并访问目标地址。",
        }),
        run: async (input) => {
          const url = readString(input.url);
          if (!url) throw new Error("browser_open requires url.");
          await runShellCommand(`open ${shellQuote(url)}`, { cwd: this.workspaceRoot, timeout: 8_000, env: allowedEnv(undefined), shell: process.env.SHELL || "/bin/zsh" });
          return { output: { opened: true, url }, summary: `已打开 ${url}` };
        },
      },
      {
        summary: {
          name: "screenshot",
          description: "截取当前屏幕并保存到 .pet/screenshots。",
          category: "system",
          permissionLevel: "confirm",
          inputSchema: inputSchema({
            fileName: stringProperty("截图文件名，默认自动生成。"),
          }),
        },
        approval: () => ({
          required: true,
          title: "截取屏幕",
          description: "保存当前屏幕截图。",
          permissionLevel: "confirm",
          risk: "截图可能包含隐私信息。",
        }),
        run: async (input) => {
          const dir = resolve(this.workspaceRoot, ".pet", "screenshots");
          await mkdir(dir, { recursive: true });
          const fileName = safeFileName(readString(input.fileName) ?? `screenshot-${Date.now()}.png`);
          const path = resolve(dir, fileName.endsWith(".png") ? fileName : `${fileName}.png`);
          await runShellCommand(`screencapture -x ${shellQuote(path)}`, { cwd: this.workspaceRoot, timeout: 10_000, env: allowedEnv(undefined), shell: process.env.SHELL || "/bin/zsh" });
          return { output: { path }, summary: `截图已保存：${relative(this.workspaceRoot, path)}` };
        },
      },
      {
        summary: {
          name: "system_info",
          description: "读取运行时和 workspace 基础信息。",
          category: "system",
          permissionLevel: "read",
          inputSchema: EMPTY_INPUT_SCHEMA,
        },
        run: () => ({
          output: {
            platform: process.platform,
            arch: process.arch,
            node: process.version,
            workspaceRoot: this.workspaceRoot,
            cwd: process.cwd(),
          },
          summary: `${process.platform}/${process.arch} ${process.version}`,
        }),
      },
      {
        summary: {
          name: "subagent_research",
          description: "委派一个只负责研究和信息整理的子 Agent。",
          category: "agent",
          permissionLevel: "read",
          inputSchema: inputSchema(
            {
              task: stringProperty("要委派给研究子 Agent 的任务。"),
              context: stringProperty("主 Agent 已知上下文。"),
            },
            ["task"],
          ),
        },
        run: async (input, context) => runSubAgent("research", readString(input.task), readString(input.context), this, context),
      },
      {
        summary: {
          name: "subagent_code",
          description: "委派一个只负责代码分析和风险检查的子 Agent。",
          category: "agent",
          permissionLevel: "read",
          inputSchema: inputSchema(
            {
              task: stringProperty("要委派给代码子 Agent 的任务。"),
              context: stringProperty("相关代码或文件摘要。"),
            },
            ["task"],
          ),
        },
        run: async (input, context) => runSubAgent("code", readString(input.task), readString(input.context), this, context),
      },
      {
        summary: {
          name: "task_create",
          description: "创建待办/提醒草案。",
          category: "task",
          permissionLevel: "confirm",
          inputSchema: inputSchema(
            {
              title: stringProperty("待办标题。"),
              dueAt: stringProperty("截止时间或提醒时间。"),
              repeat: stringProperty("重复规则。", { enum: ["once", "daily", "weekly"] }),
              channel: stringProperty("提醒方式。", { enum: ["pet", "chat", "voice"] }),
              note: stringProperty("补充说明。"),
            },
            ["title"],
          ),
        },
        approval: (input) => ({ required: true, title: "创建待办", description: readString(input.title) ?? "创建待办", permissionLevel: "confirm", risk: "会写入本地任务列表或提醒系统。" }),
        run: (input) => {
          const title = readString(input.title);
          if (!title) throw new Error("task_create requires title.");
          const task = this.store.createTask({
            title,
            dueAt: readString(input.dueAt) ?? defaultTaskDueAt(),
            repeat: readTaskRepeat(input.repeat),
            channel: readTaskChannel(input.channel),
            note: readString(input.note),
          });
          this.options.onTaskChanged?.("created", task);
          return { output: { task }, summary: `已创建待办：${task.title}` };
        },
      },
      {
        summary: {
          name: "media_prepare",
          description: "准备音乐或视频播放器卡片。",
          category: "media",
          permissionLevel: "read",
          inputSchema: inputSchema({
            media: stringProperty("媒体类型。", { enum: ["music", "video"] }),
            title: stringProperty("播放器标题。"),
            sourceUrl: stringProperty("媒体来源 URL。"),
          }),
        },
        run: (input) => ({ output: { surface: createSurfaceFromInput({ ...input, intent: readString(input.media) === "video" ? "video" : "music", title: readString(input.title) ?? "媒体播放器" }) }, summary: "已准备媒体卡片。" }),
      },
      {
        summary: {
          name: "friend_exchange_prepare",
          description: "准备好友交换草案。",
          category: "social",
          permissionLevel: "confirm",
          inputSchema: inputSchema({
            friendId: stringProperty("好友 id。"),
            note: stringProperty("交换备注。"),
          }),
        },
        approval: () => ({ required: true, title: "准备好友交换", description: "生成好友交换草案。", permissionLevel: "confirm", risk: "可能暴露可分享记忆摘要或 Skill 信息。" }),
        run: (input) => ({ output: { draft: input, createdAt: new Date().toISOString() }, summary: "好友交换草案已生成。" }),
      },
    ];
  }
}

function inputSchema(properties: Record<string, unknown>, required: string[] = []) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function stringProperty(description: string, extra: Record<string, unknown> = {}) {
  return { type: "string", description, ...extra };
}

function numberProperty(description: string, extra: Record<string, unknown> = {}) {
  return { type: "number", description, ...extra };
}

function objectProperty(description: string, extra: Record<string, unknown> = {}) {
  return { type: "object", description, additionalProperties: true, ...extra };
}

function defaultApproval(summary: ToolSummary): ApprovalDecision {
  if (summary.permissionLevel === "read") return { required: false };
  return {
    required: true,
    title: `确认执行 ${summary.name}`,
    description: summary.description,
    permissionLevel: summary.permissionLevel === "dangerous" ? "dangerous" : "confirm",
    risk: summary.permissionLevel === "dangerous" ? "高风险操作，需要人工确认。" : "会改变本地状态，需要确认。",
  };
}

function terminalApproval(input: Record<string, unknown>, workspaceRoot: string): ApprovalDecision {
  const command = readString(input.command) ?? "";
  const cwd = normalizeCwd(readString(input.cwd), workspaceRoot);
  const risk = classifyCommand(command);
  if (risk.level === "read" && isInside(cwd, workspaceRoot)) return { required: false };
  return {
    required: true,
    title: "确认执行终端命令",
    description: command,
    permissionLevel: risk.level === "dangerous" ? "dangerous" : "confirm",
    risk: risk.reason,
    command,
    cwd,
  };
}

function classifyCommand(command: string) {
  const dangerous = /\b(sudo|rm|mv|chmod|chown|kill|pkill|launchctl|curl\s+.*\|\s*(sh|bash|zsh)|wget\s+.*\|\s*(sh|bash|zsh)|npm\s+i|pnpm\s+(add|install)|brew\s+(install|remove)|pip\s+install|docker|ssh|scp|rsync)\b|>{1,2}/i;
  const network = /\b(curl|wget|nc|ssh|scp|rsync|gh\s+release|git\s+push)\b/i;
  const shellControl = /(;|&&|\|\||`|\$\(|\n)/;
  const sensitiveRead = /\b(env|printenv|set)\b|\b(cat|less|more|head|tail)\s+(~|\/(?:Users|etc|private|var|Library|Volumes)|\.\.)/i;
  const outsidePath = /(^|\s)(~\/|\/(?:Users|etc|private|var|Library|Volumes)\b|\.\.\/)/i;
  if (dangerous.test(command)) return { level: "dangerous" as const, reason: "命令可能修改文件、安装依赖、联网上传、提升权限或终止进程。" };
  if (network.test(command)) return { level: "confirm" as const, reason: "命令会访问网络或远程服务。" };
  if (shellControl.test(command)) return { level: "confirm" as const, reason: "命令包含 shell 控制符，需要确认实际执行范围。" };
  if (sensitiveRead.test(command)) return { level: "confirm" as const, reason: "命令可能读取敏感环境变量或 workspace 外文件。" };
  if (outsidePath.test(command)) return { level: "confirm" as const, reason: "命令引用了 workspace 外路径，需要确认。" };
  return { level: "read" as const, reason: "只读终端命令。" };
}

function fileReadApproval(input: Record<string, unknown>, workspaceRoot: string): ApprovalDecision {
  const path = normalizePathRequired(input.path, workspaceRoot);
  const size = existsSync(path) ? readFileSync(path).byteLength : 0;
  if (isInside(path, workspaceRoot) && size <= MAX_FILE_BYTES) return { required: false };
  return {
    required: true,
    title: "确认读取文件",
    description: path,
    permissionLevel: "confirm",
    risk: "文件在 workspace 外或体积较大。",
  };
}

function filePathReadApproval(input: Record<string, unknown>, workspaceRoot: string, title: string): ApprovalDecision {
  const path = normalizeCwd(readString(input.path), workspaceRoot);
  if (isInside(path, workspaceRoot)) return { required: false };
  return {
    required: true,
    title,
    description: path,
    permissionLevel: "confirm",
    risk: "目标路径在 workspace 外，可能暴露本机文件名或内容。",
  };
}

function fileWriteApproval(input: Record<string, unknown>, workspaceRoot: string): ApprovalDecision {
  const path = normalizePathRequired(input.path, workspaceRoot);
  const before = existsSync(path) ? readFileSync(path, "utf8") : "";
  const after = readString(input.content) ?? "";
  return {
    required: true,
    title: "确认写入文件",
    description: path,
    permissionLevel: isInside(path, workspaceRoot) ? "confirm" : "dangerous",
    risk: isInside(path, workspaceRoot) ? "会修改 workspace 文件。" : "会修改 workspace 外文件。",
    diff: unifiedDiff(path, before, after),
  };
}

function filePatchApproval(input: Record<string, unknown>, workspaceRoot: string): ApprovalDecision {
  const path = normalizePathRequired(input.path, workspaceRoot);
  const before = existsSync(path) ? readFileSync(path, "utf8") : "";
  const search = readString(input.search) ?? "";
  const replace = readString(input.replace) ?? "";
  const after = search ? before.split(search).join(replace) : before;
  return {
    required: true,
    title: "确认修改文件",
    description: path,
    permissionLevel: isInside(path, workspaceRoot) ? "confirm" : "dangerous",
    risk: isInside(path, workspaceRoot) ? "会修改 workspace 文件。" : "会修改 workspace 外文件。",
    diff: unifiedDiff(path, before, after),
  };
}

function fileDeleteApproval(input: Record<string, unknown>, workspaceRoot: string): ApprovalDecision {
  const path = normalizePathRequired(input.path, workspaceRoot);
  return {
    required: true,
    title: "确认删除文件",
    description: path,
    permissionLevel: "dangerous",
    risk: isInside(path, workspaceRoot) ? "删除 workspace 文件或目录。" : "删除 workspace 外文件或目录。",
  };
}

function fileMoveApproval(input: Record<string, unknown>, workspaceRoot: string): ApprovalDecision {
  return {
    required: true,
    title: "确认移动文件",
    description: `${readString(input.from) ?? ""} -> ${readString(input.to) ?? ""}`,
    permissionLevel: "confirm",
    risk: "会移动或重命名文件。",
  };
}

function webApproval(title: string, target: string): ApprovalDecision {
  return {
    required: true,
    title,
    description: target,
    permissionLevel: "confirm",
    risk: "会访问网络；确认后执行本次请求。",
  };
}

async function duckDuckGoSearch(query: string) {
  const jsonResults = await duckDuckGoInstantAnswer(query).catch(() => []);
  if (jsonResults.length) return jsonResults.slice(0, 5);
  return duckDuckGoHtmlSearch(query);
}

async function duckDuckGoInstantAnswer(query: string) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1`;
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`DuckDuckGo API returned HTTP ${response.status}`);
  const body = await response.json() as {
    Heading?: string;
    AbstractText?: string;
    AbstractURL?: string;
    RelatedTopics?: Array<unknown>;
  };
  const results: Array<{ title: string; url: string; snippet?: string }> = [];
  if (body.Heading && body.AbstractURL) {
    results.push({ title: body.Heading, url: body.AbstractURL, snippet: body.AbstractText });
  }
  for (const item of flattenRelatedTopics(body.RelatedTopics ?? [])) {
    if (results.length >= 5) break;
    if (item.FirstURL && item.Text) {
      results.push({ title: item.Text.split(" - ")[0] ?? item.Text, url: item.FirstURL, snippet: item.Text });
    }
  }
  return dedupeResults(results);
}

async function duckDuckGoHtmlSearch(query: string) {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, { headers: { accept: "text/html" } });
  if (!response.ok) throw new Error(`DuckDuckGo HTML returned HTTP ${response.status}`);
  const html = await response.text();
  const $ = loadHtml(html);
  const results: Array<{ title: string; url: string; snippet?: string }> = [];
  $(".result").each((_, element) => {
    if (results.length >= 5) return false;
    const link = $(element).find(".result__a").first();
    const title = normalizeWhitespace(link.text());
    const rawUrl = link.attr("href");
    const snippet = normalizeWhitespace($(element).find(".result__snippet").text());
    const resolvedUrl = resolveDuckDuckGoUrl(rawUrl);
    if (title && resolvedUrl) results.push({ title, url: resolvedUrl, snippet });
    return undefined;
  });
  return dedupeResults(results);
}

async function fetchWebPage(url: string) {
  const response = await fetch(url, { headers: { accept: "text/html,text/plain,application/xhtml+xml" } });
  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();
  if (!contentType.includes("html")) {
    return {
      url,
      status: response.status,
      contentType,
      title: "",
      text: normalizeWhitespace(body).slice(0, MAX_TOOL_OUTPUT),
      headings: [],
      links: [],
    };
  }

  const $ = loadHtml(body);
  $("script, style, noscript, svg, canvas, iframe").remove();
  const title = normalizeWhitespace($("title").first().text() || $("h1").first().text());
  const headings = $("h1,h2,h3")
    .toArray()
    .map((element) => ({ level: element.tagName.toLowerCase(), text: normalizeWhitespace($(element).text()) }))
    .filter((item) => item.text)
    .slice(0, 24);
  const main = $("main, article, [role='main']").first();
  const textRoot = main.length ? main : $("body");
  const text = normalizeWhitespace(textRoot.text()).slice(0, MAX_TOOL_OUTPUT);
  const links = $("a[href]")
    .toArray()
    .map((element) => {
      const href = $(element).attr("href");
      return href ? { text: normalizeWhitespace($(element).text()).slice(0, 160), url: resolveUrl(url, href) } : null;
    })
    .filter(isDefined)
    .filter((item) => item.text && item.url)
    .slice(0, 40);
  return { url, status: response.status, contentType, title, text, headings, links };
}

async function runSubAgent(kind: "research" | "code", task: string | undefined, context: string | undefined, registry: ToolRegistry, toolContext: ToolContext) {
  if (!task) throw new Error(`subagent_${kind} requires task.`);
  const role = kind === "research" ? "研究子 Agent" : "代码分析子 Agent";
  const allowedTools = kind === "research" ? ["file_read", "file_search", "web_fetch", "web_search"] : ["file_read", "file_search", "file_list"];
  const prompt = [
    `你是 Meow Pilot 的${role}。`,
    "只完成委派任务，输出简洁结论、关键依据、风险或下一步建议。",
    `你只能使用这些受限工具：${allowedTools.join(", ")}。不要请求终端、写文件、删除、移动、记忆写入或社交工具。`,
    "",
    `任务：${task}`,
    context ? `上下文：\n${context}` : "",
  ].filter(Boolean).join("\n");
  const firstStep = await streamAgentStepWithAiSdk({
    instructions: prompt,
    messages: [{ role: "user", content: task }] satisfies ModelMessage[],
    tools: registry.aiSdkTools(allowedTools),
  });
  if (!firstStep) {
    return { output: { status: "unavailable", reason: "没有可用模型配置。", task }, summary: "子 Agent 未运行：没有可用模型配置。" };
  }

  if (!firstStep.toolCalls.length) {
    const text = firstStep.text.trim();
    return {
      output: { status: "success", kind, text, provider: firstStep.provider, model: firstStep.model, tools: [] },
      summary: text.slice(0, 240),
    };
  }

  const toolResults = [];
  for (const call of firstStep.toolCalls.slice(0, 3)) {
    if (!allowedTools.includes(call.toolName)) {
      toolResults.push({ tool: call.toolName, status: "blocked", result: "该工具不在子 Agent 允许范围内。" });
      continue;
    }
    const payload = await registry.invoke(
      {
        name: call.toolName,
        input: call.input,
        sessionId: toolContext.sessionId,
        runId: toolContext.runId,
        source: "agent",
      },
      { sessionId: toolContext.sessionId, runId: toolContext.runId },
    );
    toolResults.push({
      tool: call.toolName,
      status: payload.run.status,
      permissionId: payload.run.permissionId,
      result: payload.result,
      summary: payload.run.summary,
    });
  }

  const finalStep = await streamAgentStepWithAiSdk({
    instructions: [
      prompt,
      "",
      "根据受限工具结果输出最终结论。不要再调用工具；如果工具等待权限，说明需要用户批准后才能继续。",
    ].join("\n"),
    messages: [
      {
        role: "user",
        content: [
          `任务：${task}`,
          firstStep.text.trim() ? `初步结论：${firstStep.text.trim()}` : "",
          `工具结果：${JSON.stringify(toolResults).slice(0, MAX_TOOL_OUTPUT)}`,
        ].filter(Boolean).join("\n\n"),
      },
    ] satisfies ModelMessage[],
    tools: {},
  });
  const text = finalStep?.text.trim() || firstStep.text.trim() || summarizeOutput(toolResults);
  return {
    output: { status: "success", kind, text, provider: finalStep?.provider ?? firstStep.provider, model: finalStep?.model ?? firstStep.model, tools: toolResults },
    summary: text.slice(0, 240),
  };
}

function flattenRelatedTopics(items: Array<unknown>): Array<{ FirstURL?: string; Text?: string }> {
  const flat: Array<{ FirstURL?: string; Text?: string }> = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    if ("Topics" in item && Array.isArray((item as { Topics?: unknown[] }).Topics)) {
      flat.push(...flattenRelatedTopics((item as { Topics: unknown[] }).Topics));
      continue;
    }
    flat.push(item as { FirstURL?: string; Text?: string });
  }
  return flat;
}

function dedupeResults<T extends { url: string }>(results: T[]) {
  const seen = new Set<string>();
  return results.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

function resolveDuckDuckGoUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value, "https://duckduckgo.com");
    const uddg = url.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : url.toString();
  } catch {
    return undefined;
  }
}

function resolveUrl(base: string, href: string) {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

function createSurfaceFromInput(input: Record<string, unknown>) {
  const now = new Date().toISOString();
  const title = readString(input.title) ?? "Agent 卡片";
  const body = readString(input.text) ?? readString(input.body) ?? "已生成卡片。";
  return {
    id: `surface_${crypto.randomUUID()}`,
    type: "panel" as const,
    intent: (readString(input.intent) as "chat") ?? "chat",
    title,
    layout: {
      kind: "stack" as const,
      direction: "column" as const,
      gap: "md" as const,
      children: [{ kind: "text" as const, variant: "body" as const, text: body }],
    },
    createdAt: now,
  };
}

function applySurfacePatch(surface: SurfaceSpec, patch: unknown): SurfaceSpec {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return surface;
  const value = patch as Record<string, unknown>;
  return {
    ...surface,
    ...(typeof value.title === "string" ? { title: value.title.slice(0, 120) } : {}),
    ...(isSurfaceType(value.type) ? { type: value.type } : {}),
    ...(isSurfaceIntent(value.intent) ? { intent: value.intent } : {}),
    ...(value.layout && typeof value.layout === "object" ? { layout: value.layout as SurfaceSpec["layout"] } : {}),
    ...(value.data && typeof value.data === "object" && !Array.isArray(value.data) ? { data: value.data as Record<string, unknown> } : {}),
    ...(Array.isArray(value.actions) ? { actions: value.actions as SurfaceSpec["actions"] } : {}),
    ...(typeof value.expiresAt === "string" ? { expiresAt: value.expiresAt } : {}),
  };
}

function isSurfaceType(value: unknown): value is SurfaceSpec["type"] {
  return value === "bubble" || value === "panel" || value === "media" || value === "modal" || value === "canvas" || value === "mini-widget";
}

function isSurfaceIntent(value: unknown): value is SurfaceSpec["intent"] {
  return value === "chat" || value === "search" || value === "calendar" || value === "weather" || value === "music" || value === "video" || value === "task" || value === "memory" || value === "skill" || value === "settings";
}

function readTaskRepeat(value: unknown): ScheduledTask["repeat"] {
  return value === "daily" || value === "weekly" || value === "once" ? value : "once";
}

function readTaskChannel(value: unknown): ScheduledTask["channel"] {
  return value === "chat" || value === "voice" || value === "pet" ? value : "pet";
}

function defaultTaskDueAt() {
  return new Date(Date.now() + 3_600_000).toISOString();
}

async function readCalendarEvents(input: Record<string, unknown>, workspaceRoot: string) {
  const range = calendarRange(input);
  const helper = calendarHelperPath(workspaceRoot);
  if (!helper) {
    return {
      source: "eventkit",
      available: false,
      range,
      events: [],
      summary: "未找到随包 EventKit 日历助手。请先运行 pnpm --workspace-root tauri:prepare，或使用 Tauri 安装包中的 runtime。",
    };
  }

  const command = `${shellQuote(helper)} --start ${shellQuote(range.start)} --end ${shellQuote(range.end)}`;
  const { stdout, stderr, exitCode } = await runShellCommand(command, {
    cwd: workspaceRoot,
    timeout: 8_000,
    env: allowedEnv(undefined),
    shell: process.env.SHELL || "/bin/zsh",
  });
  if (exitCode !== 0) {
    return {
      source: "eventkit",
      available: false,
      range,
      events: [],
      error: stderr.trim() || `EventKit helper exited with code ${exitCode}`,
      summary: "读取系统日历失败。",
    };
  }

  try {
    const payload = JSON.parse(stdout.trim() || "{}") as Record<string, unknown>;
    const events = Array.isArray(payload.events) ? payload.events : [];
    return {
      ...payload,
      source: "eventkit",
      available: payload.available !== false,
      range: isRecord(payload.range) ? payload.range : range,
      events,
      summary: typeof payload.summary === "string" ? payload.summary : events.length ? `读取到 ${events.length} 个日程。` : "当前时间范围内没有日程。",
    };
  } catch (error) {
    return {
      source: "eventkit",
      available: false,
      range,
      events: [],
      error: error instanceof Error ? error.message : String(error),
      summary: "解析系统日历结果失败。",
    };
  }
}

function calendarHelperPath(workspaceRoot: string) {
  const candidates = [
    process.env.PET_NATIVE_CALENDAR_HELPER,
    process.env.PET_AGENTD_RESOURCE_DIR ? resolve(process.env.PET_AGENTD_RESOURCE_DIR, "calendar-helper", "pet-calendar-helper") : undefined,
    process.env.PET_AGENTD_RESOURCE_DIR ? resolve(process.env.PET_AGENTD_RESOURCE_DIR, "resources", "calendar-helper", "pet-calendar-helper") : undefined,
    resolve(workspaceRoot, "apps", "desktop", "src-tauri", "resources", "calendar-helper", "pet-calendar-helper"),
    resolve(findWorkspaceRoot(), "apps", "desktop", "src-tauri", "resources", "calendar-helper", "pet-calendar-helper"),
  ];
  return candidates.find((candidate) => candidate && existsSync(candidate));
}

function calendarRange(input: Record<string, unknown>) {
  const startDate = parseDateInput(readString(input.start)) ?? startOfToday();
  const explicitEnd = parseDateInput(readString(input.end), undefined);
  const days = clampNumber(input.days, 1, 14, 1);
  const endDate = explicitEnd ?? addDays(startDate, days);
  return {
    start: startDate.toISOString(),
    end: endDate.toISOString(),
  };
}

function parseDateInput(value: string | undefined, fallback?: Date) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function countOccurrences(value: string, search: string) {
  if (!search) return 0;
  return value.split(search).length - 1;
}

function unifiedDiff(path: string, before: string, after: string) {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const lines = [`--- ${path}`, `+++ ${path}`];
  const max = Math.max(beforeLines.length, afterLines.length);
  for (let index = 0; index < max; index += 1) {
    const oldLine = beforeLines[index];
    const newLine = afterLines[index];
    if (oldLine === newLine) continue;
    if (oldLine !== undefined) lines.push(`-${oldLine}`);
    if (newLine !== undefined) lines.push(`+${newLine}`);
    if (lines.length > 220) {
      lines.push("... diff truncated ...");
      break;
    }
  }
  return lines.join("\n");
}

function normalizePathRequired(value: unknown, workspaceRoot: string) {
  const path = readString(value);
  if (!path) throw new Error("Path is required.");
  return resolve(workspaceRoot, path);
}

function normalizeCwd(value: string | undefined, workspaceRoot: string) {
  return value ? resolve(workspaceRoot, value) : workspaceRoot;
}

function isInside(path: string, root: string) {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"));
}

function allowedEnv(value: unknown) {
  const base: NodeJS.ProcessEnv = {
    HOME: process.env.HOME,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    PATH: process.env.PATH,
    SHELL: process.env.SHELL,
    TERM: process.env.TERM,
    TMPDIR: process.env.TMPDIR,
    USER: process.env.USER,
  };
  if (!value || typeof value !== "object") return base;
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (/^(PATH|NODE_|PET_|OPENAI_|ANTHROPIC_|GOOGLE_|XAI_|DEEPSEEK_|OPENROUTER_)/.test(key) && typeof val === "string") {
      base[key] = val;
    }
  }
  return base;
}

function readMemoryKind(value: unknown): Memory["kind"] | undefined {
  const kind = readString(value);
  return kind && ["user_profile", "pet_note", "semantic", "episodic", "procedural", "social"].includes(kind) ? kind as Memory["kind"] : undefined;
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : undefined;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function runShellCommand(
  command: string,
  options: { cwd: string; timeout: number; env: NodeJS.ProcessEnv; shell: string },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(options.shell, ["-lc", command], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 1_000).unref();
    }, options.timeout);

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < 2_000_000) stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 2_000_000) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({
        stdout,
        stderr: timedOut ? `${stderr}\nCommand timed out after ${options.timeout} ms.`.trim() : stderr,
        exitCode: timedOut ? 124 : code ?? 0,
      });
    });
  });
}

async function listDirectory(path: string, limit: number) {
  const entries = await readdir(path, { withFileTypes: true });
  const limited = entries.slice(0, limit);
  return Promise.all(
    limited.map(async (entry) => {
      const fullPath = resolve(path, entry.name);
      const info = await stat(fullPath);
      return {
        name: entry.name,
        type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
        size: info.size,
        updatedAt: info.mtime.toISOString(),
      };
    }),
  );
}

function writeClipboard(text: string) {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn("pbcopy", [], { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(stderr || `pbcopy exited with code ${code ?? "unknown"}.`));
    });
    child.stdin.end(text);
  });
}

function safeFileName(value: string) {
  return value.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^-+/, "").slice(0, 120) || `screenshot-${Date.now()}.png`;
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function summarizeOutput(output: unknown) {
  if (typeof output === "string") return output.slice(0, 240);
  try {
    return JSON.stringify(output).slice(0, 240);
  } catch {
    return "工具已执行。";
  }
}
