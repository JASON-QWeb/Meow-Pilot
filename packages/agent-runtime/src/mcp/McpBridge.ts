import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import type { ToolSummary } from "@pet/protocol";
import { logger } from "../logger";
import type { ToolDefinition, ToolContext } from "../tools/ToolRegistry";
import type { ToolRegistry } from "../tools/ToolRegistry";

type McpServerConfig = {
  id: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
};

export async function loadConfiguredMcpTools(registry: ToolRegistry) {
  const configs = readMcpServerConfigs();
  const loaded: string[] = [];
  for (const config of configs) {
    try {
      const client = await createMCPClient({
        clientName: "meow-pilot",
        version: "0.1.0",
        transport: new Experimental_StdioMCPTransport({
          command: config.command,
          args: config.args,
          cwd: config.cwd,
          env: config.env,
          stderr: "pipe",
        }),
      });
      await registerMcpClientTools(registry, config, client);
      loaded.push(config.id);
    } catch (error) {
      logger.warn("mcp.load_failed", { serverId: config.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (loaded.length) logger.info("mcp.loaded", { servers: loaded });
  return loaded;
}

async function registerMcpClientTools(registry: ToolRegistry, config: McpServerConfig, client: MCPClient) {
  const [toolSet, listed] = await Promise.all([client.tools(), client.listTools()]);
  const metadata = new Map(listed.tools.map((item) => [item.name, item]));
  for (const [name, mcpTool] of Object.entries(toolSet)) {
    const info = metadata.get(name);
    const summary: ToolSummary = {
      name: mcpToolName(config.id, name),
      description: info?.description ?? `MCP tool ${name} from ${config.id}`,
      category: "mcp",
      permissionLevel: "confirm",
      inputSchema: info?.inputSchema ?? { type: "object", properties: {}, additionalProperties: true },
    };
    registry.register({
      summary,
      approval: () => ({
        required: true,
        title: `执行 MCP 工具 ${name}`,
        description: `${config.id}:${name}`,
        permissionLevel: "confirm",
        risk: "MCP 工具由外部 server 执行，可能访问该 server 暴露的资源。",
      }),
      run: async (input, context) => runMcpTool(mcpTool, input, context),
    });
  }
}

async function runMcpTool(mcpTool: { execute?: (input: unknown, options: { toolCallId: string; messages: []; experimental_context: ToolContext }) => unknown }, input: Record<string, unknown>, context: ToolContext) {
  if (!mcpTool.execute) throw new Error("MCP tool is not executable.");
  const output = await mcpTool.execute(input, {
    toolCallId: `mcp_${crypto.randomUUID()}`,
    messages: [],
    experimental_context: context,
  });
  return { output, summary: summarizeMcpOutput(output) };
}

function readMcpServerConfigs(): McpServerConfig[] {
  const raw = process.env.PET_MCP_SERVERS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeServerConfig).filter(isDefined);
  } catch {
    return [];
  }
}

function normalizeServerConfig(value: unknown): McpServerConfig | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  const id = typeof item.id === "string" ? item.id.trim() : "";
  const command = typeof item.command === "string" ? item.command.trim() : "";
  if (!id || !command) return undefined;
  return {
    id: id.replace(/[^A-Za-z0-9_-]/g, "_"),
    command,
    args: Array.isArray(item.args) ? item.args.map(String) : undefined,
    cwd: typeof item.cwd === "string" ? item.cwd : undefined,
    env: isStringRecord(item.env) ? item.env : undefined,
  };
}

function mcpToolName(serverId: string, toolName: string) {
  return `mcp_${serverId}_${toolName.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

function summarizeMcpOutput(output: unknown) {
  if (typeof output === "string") return output.slice(0, 240);
  if (output && typeof output === "object" && "content" in output && Array.isArray((output as { content?: unknown[] }).content)) {
    return (output as { content: Array<{ text?: string }> }).content.map((item) => item.text).filter(Boolean).join("\n").slice(0, 240);
  }
  try {
    return JSON.stringify(output).slice(0, 240);
  } catch {
    return "MCP 工具已执行。";
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(value) && typeof value === "object" && Object.values(value as Record<string, unknown>).every((item) => typeof item === "string");
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
