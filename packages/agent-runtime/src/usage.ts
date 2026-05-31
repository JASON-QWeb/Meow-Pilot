import type { ProviderSummary, TokenUsageSummary } from "@pet/protocol";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { loadAiProviderConfig, loadXiaomiConfig } from "./apiConfig";
import { listProviders } from "./catalog";

type CodexAuthFile = {
  tokens?: {
    access_token?: string;
    account_id?: string;
  };
};

type CodexUsageResponse = {
  plan_type?: string;
  rate_limit?: CodexRateLimit;
  additional_rate_limits?: Array<{
    limit_name?: string;
    rate_limit?: CodexRateLimit;
  }>;
};

type CodexRateLimit = {
  allowed?: boolean;
  limit_reached?: boolean;
  primary_window?: CodexRateLimitWindow;
  secondary_window?: CodexRateLimitWindow;
};

type CodexRateLimitWindow = {
  used_percent?: number | string;
  limit_window_seconds?: number | string;
  reset_after_seconds?: number | string;
  reset_at?: number | string;
};

type DeepSeekBalanceResponse = {
  is_available?: boolean;
  balance_infos?: Array<{
    currency?: string;
    total_balance?: string;
    granted_balance?: string;
    topped_up_balance?: string;
  }>;
};

type XiaomiQuota = {
  used: number;
  limit: number;
  percent?: number;
  percentLabel?: string;
};

type XiaomiParsedItem = XiaomiQuota & {
  name?: string;
};

type ParsedXiaomiPlanUsage = {
  currentPlan: XiaomiQuota;
  compensation?: XiaomiQuota;
};

type XiaomiPlanUsage = ParsedXiaomiPlanUsage & {
  sourceLabel: string;
  updatedAt?: string;
};

type AntigravityCredentials = {
  token?: {
    access_token?: string;
  };
};

type AntigravityLoadCodeAssistResponse = {
  currentTier?: {
    id?: string;
    name?: string;
  };
  paidTier?: {
    id?: string;
    name?: string;
  };
  cloudaicompanionProject?: string;
};

type AntigravityQuotaResponse = {
  buckets?: AntigravityQuotaBucket[];
};

type AntigravityQuotaBucket = {
  remainingAmount?: number | string;
  remainingFraction?: number | string;
  resetTime?: string;
  tokenType?: string;
  modelId?: string;
};

type AntigravityUsage = {
  buckets: AntigravityQuotaBucket[];
  planName?: string;
};

const CODEX_USAGE_API = "https://chatgpt.com/backend-api/wham/usage";
const XIAOMI_USAGE_PAGE = "https://platform.xiaomimimo.com/console/plan-manage";
const XIAOMI_USAGE_API = "https://platform.xiaomimimo.com/api/v1/tokenPlan/usage";
const ANTIGRAVITY_CODE_ASSIST_API = "https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist";
const ANTIGRAVITY_QUOTA_API = "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota";
const XIAOMI_USED_KEYS = ["used", "usedToken", "usedTokens", "used_token", "used_tokens", "usage", "consumed"];
const XIAOMI_LIMIT_KEYS = ["limit", "limitToken", "limitTokens", "limit_token", "limit_tokens", "total", "totalToken", "totalTokens", "quota"];
const XIAOMI_PERCENT_KEYS = ["percent", "usagePercent", "usage_percent", "ratio", "rate"];

export async function listTokenUsage(): Promise<TokenUsageSummary[]> {
  const providers = listProviders();
  const providerById = new Map(providers.map((provider) => [provider.id, provider]));

  const [codexCard, antigravityCard, xiaomiCard, deepseekCard] = await Promise.all([
    makeCodexCard(providerById.get("codex-cli")),
    makeAntigravityCard(providerById.get("antigravity-cli")),
    makeXiaomiCard(providerById.get("xiaomi-voice")),
    makeDeepSeekCard(),
  ]);

  return [
    codexCard,
    makeSubscriptionCard({
      id: "claude",
      label: "Claude",
      provider: providerById.get("claude-code-cli"),
      href: "https://claude.ai/settings/usage",
      accent: "violet",
    }),
    antigravityCard,
    xiaomiCard,
    deepseekCard,
  ];
}

async function makeCodexCard(provider?: ProviderSummary): Promise<TokenUsageSummary> {
  if (!provider?.configured) {
    return makeSubscriptionCard({
      id: "codex",
      label: "Codex",
      provider,
      href: "https://chatgpt.com/codex/settings/usage",
      accent: "blue",
    });
  }

  try {
    const usage = await fetchCodexUsage();
    const primaryWindow = usage.rate_limit?.primary_window;
    const secondaryWindow = usage.rate_limit?.secondary_window;
    if (!primaryWindow || !secondaryWindow) {
      throw new Error("Codex 用量接口返回结构暂未识别。");
    }

    const primaryLeft = windowRemainingPercent(primaryWindow);
    const weekLeft = windowRemainingPercent(secondaryWindow);
    const metrics: TokenUsageSummary["metrics"] = [
      {
        label: "5h 窗口",
        value: formatPercentValue(primaryLeft),
        hint: formatResetHint(primaryWindow, false),
        percent: primaryLeft,
      },
      {
        label: "一周额度",
        value: formatPercentValue(weekLeft),
        hint: formatResetHint(secondaryWindow, true),
        percent: weekLeft,
      },
    ];

    for (const extraLimit of usage.additional_rate_limits?.slice(0, 1) ?? []) {
      const extraName = shortCodexLimitName(extraLimit.limit_name);
      const extraPrimary = extraLimit.rate_limit?.primary_window;
      const extraSecondary = extraLimit.rate_limit?.secondary_window;
      if (extraPrimary) {
        const left = windowRemainingPercent(extraPrimary);
        metrics.push({
          label: `${extraName} 5h`,
          value: formatPercentValue(left),
          hint: formatResetHint(extraPrimary, false),
          percent: left,
        });
      }
      if (extraSecondary) {
        const left = windowRemainingPercent(extraSecondary);
        metrics.push({
          label: `${extraName} 周`,
          value: formatPercentValue(left),
          hint: formatResetHint(extraSecondary, true),
          percent: left,
        });
      }
    }

    const limited = usage.rate_limit?.allowed === false || usage.rate_limit?.limit_reached === true || primaryLeft <= 0 || weekLeft <= 0;
    return {
      id: "codex",
      label: "Codex",
      kind: "subscription",
      primaryLabel: "5h 余量",
      primaryValue: `${formatPercentValue(primaryLeft)} 剩余`,
      status: limited ? "error" : "connected",
      sourceLabel: "Codex Usage API",
      href: "https://chatgpt.com/codex/settings/usage",
      accent: "blue",
      metrics,
      updatedAt: new Date().toISOString(),
    };
  } catch (error) {
    const probe = probeCodexCli(provider);
    return {
      id: "codex",
      label: "Codex",
      kind: "subscription",
      primaryLabel: "5h 余量",
      primaryValue: probe.primaryValue,
      status: probe.status,
      sourceLabel: probe.sourceLabel,
      href: "https://chatgpt.com/codex/settings/usage",
      accent: "blue",
      metrics: [
        {
          label: "5h 窗口",
          value: probe.windowValue,
          hint: probe.windowHint,
        },
        {
          label: "一周额度",
          value: probe.weekValue,
          hint: probe.weekHint,
        },
      ],
      message: `Codex 用量同步失败：${error instanceof Error ? error.message : "未知错误"}`,
    };
  }
}

function makeSubscriptionCard({
  id,
  label,
  provider,
  href,
  accent,
}: {
  id: string;
  label: string;
  provider?: ProviderSummary;
  href: string;
  accent: TokenUsageSummary["accent"];
}): TokenUsageSummary {
  const probe = probeSubscriptionCli(id, provider);
  return {
    id,
    label,
    kind: "subscription",
    primaryLabel: "5h 余量",
    primaryValue: probe.primaryValue,
    status: probe.status,
    sourceLabel: probe.sourceLabel,
    href,
    accent,
    metrics: [
      {
        label: "5h 窗口",
        value: probe.windowValue,
        hint: probe.windowHint,
      },
      {
        label: "一周额度",
        value: probe.weekValue,
        hint: probe.weekHint,
      },
    ],
    message: probe.message,
  };
}

async function makeAntigravityCard(provider?: ProviderSummary): Promise<TokenUsageSummary> {
  if (!provider?.configured) {
    return makeSubscriptionCard({
      id: "antigravity",
      label: "Antigravity",
      provider,
      href: "https://antigravity.google/docs/plans",
      accent: "mint",
    });
  }

  try {
    const usage = await fetchAntigravityUsage();
    const buckets = usage.buckets.filter((bucket) => bucket.modelId && bucket.remainingFraction !== undefined);
    if (!buckets.length) {
      throw new Error("Antigravity quota 接口没有返回模型额度。");
    }

    const primaryBucket = buckets.find((bucket) => bucket.modelId?.includes("gemini-3")) ?? buckets[0]!;
    const primaryLeft = antigravityBucketPercent(primaryBucket);
    const metrics = buckets.slice(0, 4).map((bucket) => {
      const left = antigravityBucketPercent(bucket);
      return {
        label: formatAntigravityModelName(bucket.modelId),
        value: formatPercentValue(left),
        hint: bucket.resetTime ? `重置 ${formatDateTime(new Date(bucket.resetTime))}` : "Quota available",
        percent: left,
      };
    });

    return {
      id: "antigravity",
      label: "Antigravity",
      kind: "subscription",
      primaryLabel: "模型额度",
      primaryValue: `${formatPercentValue(primaryLeft)} 可用`,
      status: primaryLeft <= 0 ? "error" : "connected",
      sourceLabel: "agy quota API",
      href: "https://antigravity.google/docs/plans",
      accent: "mint",
      metrics,
      updatedAt: new Date().toISOString(),
    };
  } catch (error) {
    const probe = probeAntigravity(provider);
    return {
      id: "antigravity",
      label: "Antigravity",
      kind: "subscription",
      primaryLabel: "模型额度",
      primaryValue: probe.primaryValue,
      status: probe.status,
      sourceLabel: probe.sourceLabel,
      href: "https://antigravity.google/docs/plans",
      accent: "mint",
      metrics: [
        {
          label: "模型额度",
          value: probe.windowValue,
          hint: probe.windowHint,
        },
        {
          label: "刷新窗口",
          value: probe.weekValue,
          hint: probe.weekHint,
        },
      ],
      message: `Antigravity quota 同步失败：${error instanceof Error ? error.message : "未知错误"}`,
    };
  }
}

function probeSubscriptionCli(id: string, provider?: ProviderSummary) {
  if (id === "codex") return probeCodexCli(provider);
  if (id === "claude") return probeClaudeCli(provider);
  if (id === "antigravity") return probeAntigravity(provider);
  return fallbackSubscriptionProbe(Boolean(provider?.configured));
}

function probeCodexCli(provider?: ProviderSummary) {
  if (!provider?.configured) return fallbackSubscriptionProbe(false);
  const result = runCli("codex", ["login", "status"]);
  const loggedIn = result.ok && /logged in/i.test(result.output);
  return {
    primaryValue: loggedIn ? "CLI 已登录" : "CLI 未登录",
    status: loggedIn ? ("connected" as const) : ("unconfigured" as const),
    sourceLabel: "CLI 状态",
    windowValue: "CLI 未提供",
    windowHint: loggedIn ? "codex login status 不返回剩余额度" : "需要先登录 Codex CLI",
    weekValue: "CLI 未提供",
    weekHint: loggedIn ? "Codex CLI 未输出周额度与重置时间" : "需要先登录 Codex CLI",
    message: loggedIn ? "已确认 ChatGPT 登录态；CLI 当前没有公开 5h/周余量字段。" : result.output || undefined,
  };
}

function probeClaudeCli(provider?: ProviderSummary) {
  if (!provider?.configured) return fallbackSubscriptionProbe(false);
  const result = runCli("claude", ["auth", "status"]);
  const status = parseClaudeAuthStatus(result.output);
  const loggedIn = Boolean(result.ok && status?.loggedIn);
  return {
    primaryValue: loggedIn ? "CLI 已登录" : "CLI 未登录",
    status: loggedIn ? ("connected" as const) : ("unconfigured" as const),
    sourceLabel: "CLI 状态",
    windowValue: "CLI 未提供",
    windowHint: loggedIn ? "claude auth status 不返回剩余额度" : "当前 claude 命令未读到登录态",
    weekValue: "CLI 未提供",
    weekHint: loggedIn ? "Claude CLI 未输出周额度与重置时间" : "当前 claude 命令未读到登录态",
    message: loggedIn
      ? "已确认 Claude CLI 登录态；CLI 当前没有公开 5h/周余量字段。"
      : "claude auth status 当前返回未登录；本地 stats-cache 只有历史消耗，不含订阅余量。",
  };
}

function probeAntigravity(provider?: ProviderSummary) {
  if (!provider?.configured) return fallbackSubscriptionProbe(false);
  const hasCli = runCli("agy", ["--version"]).ok || runCli("antigravity", ["--version"]).ok;
  return {
    primaryValue: hasCli ? "agy CLI 可用" : "App 已安装",
    status: "connected" as const,
    sourceLabel: hasCli ? "agy CLI" : "App 检测",
    windowValue: hasCli ? "可打开 /usage" : "未提供",
    windowHint: hasCli ? "agy 的 /usage 是交互式 TUI" : "当前只检测到桌面 App",
    weekValue: "未提供",
    weekHint: hasCli ? "直接 quota API 当前未同步成功" : "当前只检测到桌面 App",
    message: hasCli ? "已检测到 agy CLI；/usage 需要交互式终端。" : "已检测到 Antigravity App；当前没有可调用的 agy CLI。",
  };
}

function fallbackSubscriptionProbe(configured: boolean) {
  return {
    primaryValue: configured ? "待同步" : "未连接",
    status: configured ? ("connected" as const) : ("unconfigured" as const),
    sourceLabel: "额度页",
    windowValue: configured ? "待同步" : "未连接",
    windowHint: "剩余额度与刷新时间",
    weekValue: configured ? "待同步" : "未连接",
    weekHint: "周额度与下次重置",
    message: undefined,
  };
}

function runCli(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 4_000,
    env: { ...process.env, NO_COLOR: "1", TERM: process.env.TERM || "dumb" },
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  return {
    ok: result.status === 0,
    output,
  };
}

function parseClaudeAuthStatus(output: string): { loggedIn?: boolean } | null {
  try {
    return JSON.parse(output) as { loggedIn?: boolean };
  } catch {
    return null;
  }
}

async function fetchCodexUsage(): Promise<CodexUsageResponse> {
  const auth = loadCodexAuth();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6_000);
  try {
    const headers: Record<string, string> = {
      accept: "application/json",
      authorization: `Bearer ${auth.accessToken}`,
    };
    if (auth.accountId) {
      headers["chatgpt-account-id"] = auth.accountId;
    }
    const response = await fetch(CODEX_USAGE_API, {
      headers,
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => null)) as CodexUsageResponse | { error?: { message?: string } } | null;
    if (!response.ok) {
      const message = body && "error" in body ? body.error?.message : undefined;
      throw new Error(message ?? `Codex 用量接口返回 HTTP ${response.status}`);
    }
    return (body ?? {}) as CodexUsageResponse;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Codex 用量同步超时。");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function loadCodexAuth() {
  const authPath = process.env.PET_CODEX_AUTH_PATH ?? resolve(homedir(), ".codex", "auth.json");
  if (!existsSync(authPath)) {
    throw new Error("没有找到 ~/.codex/auth.json。");
  }
  const parsed = JSON.parse(readFileSync(authPath, "utf8")) as CodexAuthFile;
  const accessToken = parsed.tokens?.access_token;
  if (!accessToken) {
    throw new Error("Codex 登录文件里没有 access token。");
  }
  return {
    accessToken,
    accountId: parsed.tokens?.account_id,
  };
}

async function fetchAntigravityUsage(): Promise<AntigravityUsage> {
  const accessToken = loadAntigravityAccessToken();
  const loadResponse = await postAntigravityJson<AntigravityLoadCodeAssistResponse>(ANTIGRAVITY_CODE_ASSIST_API, {}, accessToken);
  const quotaResponse = await postAntigravityJson<AntigravityQuotaResponse>(
    ANTIGRAVITY_QUOTA_API,
    loadResponse.cloudaicompanionProject ? { project: loadResponse.cloudaicompanionProject } : {},
    accessToken,
  );
  return {
    buckets: quotaResponse.buckets ?? [],
    planName: loadResponse.paidTier?.name ?? loadResponse.currentTier?.name,
  };
}

async function postAntigravityJson<T>(url: string, body: Record<string, unknown>, accessToken: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const parsed = (await response.json().catch(() => null)) as T | { error?: { message?: string } } | null;
    if (!response.ok) {
      const message = isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.message === "string" ? parsed.error.message : undefined;
      throw new Error(message ?? `Antigravity quota 接口返回 HTTP ${response.status}`);
    }
    return (parsed ?? {}) as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Antigravity quota 同步超时。");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function loadAntigravityAccessToken() {
  const envToken = process.env.PET_ANTIGRAVITY_ACCESS_TOKEN ?? process.env.ANTIGRAVITY_ACCESS_TOKEN;
  if (envToken?.trim()) return envToken.trim();
  if (process.platform !== "darwin") {
    throw new Error("当前系统没有 macOS Keychain，无法读取 agy 登录态。");
  }

  const result = spawnSync("security", ["find-generic-password", "-s", "gemini", "-a", "antigravity", "-w"], {
    encoding: "utf8",
    timeout: 4_000,
  });
  if (result.status !== 0) {
    throw new Error("没有在 Keychain 找到 agy 登录态。");
  }

  const raw = result.stdout.trim();
  const payload = raw.startsWith("go-keyring-base64:") ? Buffer.from(raw.slice("go-keyring-base64:".length), "base64").toString("utf8") : raw;
  const parsed = JSON.parse(payload) as AntigravityCredentials;
  const accessToken = parsed.token?.access_token;
  if (!accessToken) {
    throw new Error("agy 登录态里没有 access token。");
  }
  return accessToken;
}

async function makeXiaomiCard(provider?: ProviderSummary): Promise<TokenUsageSummary> {
  const snapshot = loadXiaomiPlanUsageSnapshot();
  const cookie = loadXiaomiPlatformCookie();
  const configured = Boolean(provider?.configured || loadXiaomiConfig() || snapshot || cookie);

  if (!configured) {
    return {
      id: "xiaomi",
      label: "Xiaomi MiMo",
      kind: "api",
      primaryLabel: "当前套餐用量",
      primaryValue: "未配置",
      status: "unconfigured",
      sourceLabel: "控制台",
      href: XIAOMI_USAGE_PAGE,
      accent: "amber",
      metrics: [
        { label: "当前套餐", value: "未配置", hint: "套餐 token 使用量" },
        { label: "补偿积分", value: "未配置", hint: "补偿 credits 使用量" },
      ],
    };
  }

  let syncError: string | undefined;
  let usage: XiaomiPlanUsage | null = null;

  if (cookie) {
    try {
      usage = await fetchXiaomiPlanUsage(cookie);
    } catch (error) {
      syncError = error instanceof Error ? error.message : "小米套餐用量同步失败。";
    }
  }

  usage ??= snapshot;

  if (usage) {
    return makeXiaomiPlanUsageCard(usage, syncError);
  }

  return {
    id: "xiaomi",
    label: "Xiaomi MiMo",
    kind: "api",
    primaryLabel: "当前套餐用量",
    primaryValue: "待同步",
    status: "connected",
    sourceLabel: "控制台",
    href: XIAOMI_USAGE_PAGE,
    accent: "amber",
    metrics: [
      {
        label: "当前套餐",
        value: "待同步",
        hint: "套餐 token 使用量",
      },
      {
        label: "补偿积分",
        value: "待同步",
        hint: "补偿 credits 使用量",
      },
    ],
    message: syncError ?? "小米套餐用量需要控制台登录 Cookie；也可以继续使用本地快照。",
  };
}

function makeXiaomiPlanUsageCard(usage: XiaomiPlanUsage, syncError?: string): TokenUsageSummary {
  const current = usage.currentPlan;
  const compensation = usage.compensation;
  return {
    id: "xiaomi",
    label: "Xiaomi MiMo",
    kind: "api",
    primaryLabel: "当前套餐用量",
    primaryValue: formatQuota(current),
    status: "connected",
    sourceLabel: usage.sourceLabel,
    href: XIAOMI_USAGE_PAGE,
    accent: "amber",
    metrics: [
      {
        label: "当前套餐",
        value: formatQuotaPercent(current),
        hint: formatQuota(current),
        percent: quotaPercent(current),
      },
      {
        label: "补偿积分",
        value: compensation ? formatQuotaPercent(compensation) : "无",
        hint: compensation ? formatQuota(compensation) : "0 / 0",
        percent: compensation ? quotaPercent(compensation) : 0,
      },
    ],
    updatedAt: usage.updatedAt,
    message: syncError ? `控制台同步失败，显示本地快照：${syncError}` : undefined,
  };
}

async function fetchXiaomiPlanUsage(cookie: string): Promise<XiaomiPlanUsage> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6_000);
  try {
    const response = await fetch(XIAOMI_USAGE_API, {
      headers: {
        accept: "application/json",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        cookie,
        "x-timeZone": Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
      },
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      throw new Error(extractXiaomiApiMessage(body) ?? `小米套餐用量接口返回 HTTP ${response.status}`);
    }
    const usage = parseXiaomiPlanUsage(body);
    if (!usage) {
      throw new Error(extractXiaomiApiMessage(body) ?? "小米套餐用量接口返回结构暂未识别。");
    }
    return {
      ...usage,
      sourceLabel: "小米控制台",
      updatedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("小米套餐用量同步超时。");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseXiaomiPlanUsage(body: unknown): ParsedXiaomiPlanUsage | null {
  const items = findXiaomiUsageItems(body)
    .map(parseXiaomiUsageItem)
    .filter((item): item is XiaomiParsedItem => Boolean(item));
  if (!items.length) return null;

  const compensation = items.find((item) => isCompensationUsage(item.name));
  const currentPlan = items.find((item) => !isCompensationUsage(item.name) && item.limit > 0) ?? items.find((item) => !isCompensationUsage(item.name));
  if (!currentPlan) return null;
  return { currentPlan, compensation };
}

function findXiaomiUsageItems(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 5) return [];
  if (Array.isArray(value)) {
    return value.some(isXiaomiUsageItem) ? value.filter(isRecord) : [];
  }
  if (!isRecord(value)) return [];

  const usage = value.usage;
  if (isRecord(usage) && Array.isArray(usage.items) && usage.items.some(isXiaomiUsageItem)) {
    return usage.items.filter(isRecord);
  }
  if (Array.isArray(value.items) && value.items.some(isXiaomiUsageItem)) {
    return value.items.filter(isRecord);
  }

  for (const key of ["data", "result", "payload"]) {
    const nested = findXiaomiUsageItems(value[key], depth + 1);
    if (nested.length) return nested;
  }
  for (const nestedValue of Object.values(value)) {
    const nested = findXiaomiUsageItems(nestedValue, depth + 1);
    if (nested.length) return nested;
  }
  return [];
}

function isXiaomiUsageItem(value: unknown) {
  if (!isRecord(value)) return false;
  return getNumberFromKeys(value, XIAOMI_USED_KEYS) !== undefined && getNumberFromKeys(value, XIAOMI_LIMIT_KEYS) !== undefined;
}

function parseXiaomiUsageItem(item: Record<string, unknown>): XiaomiParsedItem | null {
  const used = getNumberFromKeys(item, XIAOMI_USED_KEYS);
  const limit = getNumberFromKeys(item, XIAOMI_LIMIT_KEYS);
  if (used === undefined || limit === undefined) return null;
  const rawPercent = getNumberFromKeys(item, XIAOMI_PERCENT_KEYS);
  return {
    name: getStringFromKeys(item, ["name", "type", "key"]),
    used,
    limit,
    percent: rawPercent === undefined ? undefined : normalizeApiPercent(rawPercent),
  };
}

function isCompensationUsage(name?: string) {
  return Boolean(name && /compensation|compensate|compensated|补偿/i.test(name));
}

function loadXiaomiPlanUsageSnapshot(): XiaomiPlanUsage | null {
  const snapshot = loadTokenUsageSnapshot();
  const xiaomi = isRecord(snapshot?.xiaomi) ? snapshot.xiaomi : undefined;
  const currentPlan = parseSnapshotQuota(xiaomi?.currentPlan);
  if (!currentPlan) return null;
  const compensation = parseSnapshotQuota(xiaomi?.compensation);
  const updatedAt = typeof xiaomi?.updatedAt === "string" ? xiaomi.updatedAt : undefined;
  return {
    currentPlan,
    compensation,
    updatedAt,
    sourceLabel: "本地快照",
  };
}

function loadTokenUsageSnapshot(): Record<string, unknown> | null {
  const snapshotPath = process.env.PET_TOKEN_USAGE_SNAPSHOT_PATH ?? resolve(findWorkspaceRoot(), ".pet", "token-usage.json");
  if (!existsSync(snapshotPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(snapshotPath, "utf8")) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function loadXiaomiPlatformCookie() {
  const envCookie = process.env.PET_XIAOMI_PLATFORM_COOKIE ?? process.env.XIAOMI_PLATFORM_COOKIE;
  if (envCookie?.trim()) return envCookie.trim();

  const cookiePath = process.env.PET_XIAOMI_PLATFORM_COOKIE_PATH ?? resolve(findWorkspaceRoot(), ".pet", "xiaomi-platform-cookie.txt");
  if (!existsSync(cookiePath)) return undefined;
  try {
    const cookie = readFileSync(cookiePath, "utf8").trim();
    return cookie || undefined;
  } catch {
    return undefined;
  }
}

function parseSnapshotQuota(value: unknown): XiaomiQuota | undefined {
  if (!isRecord(value)) return undefined;
  const used = toNumber(value.used);
  const limit = toNumber(value.limit);
  if (used === undefined || limit === undefined) return undefined;
  const percent = toNumber(value.percent);
  return {
    used,
    limit,
    percent,
    percentLabel: typeof value.percentLabel === "string" ? value.percentLabel : undefined,
  };
}

function getNumberFromKeys(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const direct = toNumber(record[key]);
    if (direct !== undefined) return direct;
  }
  const lowerKeys = new Set(keys.map((key) => key.toLowerCase()));
  for (const [key, value] of Object.entries(record)) {
    if (lowerKeys.has(key.toLowerCase())) {
      const parsed = toNumber(value);
      if (parsed !== undefined) return parsed;
    }
  }
  return undefined;
}

function getStringFromKeys(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function normalizeApiPercent(value: number) {
  return value <= 1 ? value * 100 : value;
}

function quotaPercent(quota: XiaomiQuota) {
  return clampPercent(quota.percent ?? (quota.limit > 0 ? (quota.used / quota.limit) * 100 : 0));
}

function formatQuotaPercent(quota: XiaomiQuota) {
  return quota.percentLabel ?? `${quotaPercent(quota).toFixed(1)}%`;
}

function formatQuota(quota: XiaomiQuota) {
  return `${formatTokenAmount(quota.used)} / ${formatTokenAmount(quota.limit)}`;
}

function windowRemainingPercent(window: CodexRateLimitWindow) {
  return clampPercent(100 - (toNumber(window.used_percent) ?? 0));
}

function antigravityBucketPercent(bucket: AntigravityQuotaBucket) {
  const fraction = toNumber(bucket.remainingFraction);
  if (fraction !== undefined) {
    return clampPercent(fraction <= 1 ? fraction * 100 : fraction);
  }
  return clampPercent(toNumber(bucket.remainingAmount) ?? 0);
}

function formatPercentValue(value: number) {
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`;
}

function formatResetHint(window: CodexRateLimitWindow, includeDate: boolean) {
  const date = rateLimitResetDate(window);
  if (!date) return "等待重置时间";
  return `重置 ${includeDate ? formatDateTime(date) : formatTime(date)}`;
}

function rateLimitResetDate(window: CodexRateLimitWindow) {
  const resetAt = toNumber(window.reset_at);
  if (resetAt !== undefined) {
    return new Date(resetAt > 1_000_000_000_000 ? resetAt : resetAt * 1000);
  }
  const resetAfter = toNumber(window.reset_after_seconds);
  if (resetAfter !== undefined) {
    return new Date(Date.now() + resetAfter * 1000);
  }
  return undefined;
}

function formatTime(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function shortCodexLimitName(name?: string) {
  if (!name) return "附加";
  if (/spark/i.test(name)) return "Spark";
  return name.replace(/^GPT-/i, "").replace(/-Codex/i, "");
}

function formatAntigravityModelName(modelId?: string) {
  if (!modelId) return "模型额度";
  const known: Record<string, string> = {
    "gemini-2.5-flash": "Gemini 2.5 Flash",
    "gemini-2.5-flash-lite": "Gemini 2.5 Flash Lite",
    "gemini-2.5-pro": "Gemini 2.5 Pro",
    "gemini-3-flash-preview": "Gemini 3.5 Flash",
    "gemini-3-pro-preview": "Gemini 3.5 Pro",
    "gemini-3.1-flash-lite": "Gemini 3.1 Flash Lite",
    "gemini-3.1-flash-lite-preview": "Gemini 3.1 Flash Lite",
    "gemini-3.1-pro-preview": "Gemini 3.1 Pro",
  };
  return known[modelId] ?? modelId.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatTokenAmount(value: number) {
  const normalized = Math.trunc(value);
  if (Math.abs(normalized) < 1_000_000) return formatInteger(normalized);
  const millions = normalized / 1_000_000;
  const maximumFractionDigits = Math.abs(millions) >= 100 ? 0 : Math.abs(millions) >= 10 ? 1 : 2;
  return `${millions.toLocaleString("en-US", { maximumFractionDigits })}M`;
}

function formatInteger(value: number) {
  return Math.trunc(value).toLocaleString("en-US");
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findWorkspaceRoot() {
  let cursor = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(resolve(cursor, "pnpm-workspace.yaml"))) {
      return cursor;
    }
    const parent = resolve(cursor, "..");
    if (parent === cursor) break;
    cursor = parent;
  }
  return process.cwd();
}

function extractXiaomiApiMessage(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of ["message", "msg", "errorMessage", "error"]) {
    const field = value[key];
    if (typeof field === "string" && field.trim()) return field.trim();
  }
  return undefined;
}

async function makeDeepSeekCard(): Promise<TokenUsageSummary> {
  const config = loadAiProviderConfig("deepseek");
  if (!config) {
    return {
      id: "deepseek",
      label: "DeepSeek",
      kind: "api",
      primaryLabel: "充值金额",
      primaryValue: "未配置",
      status: "unconfigured",
      sourceLabel: "控制台",
      href: "https://platform.deepseek.com/usage",
      accent: "rose",
      metrics: [
        { label: "可用余额", value: "未配置", hint: "账户可用额度" },
        { label: "赠金余额", value: "未配置", hint: "未过期赠金" },
      ],
    };
  }

  try {
    const balance = await fetchDeepSeekBalance(config.apiKey, config.baseUrl);
    const preferred = balance.balance_infos?.find((item) => item.currency === "CNY") ?? balance.balance_infos?.[0];
    const currency = preferred?.currency ?? "CNY";
    const total = formatCurrency(currency, preferred?.total_balance);
    const granted = formatCurrency(currency, preferred?.granted_balance);
    const toppedUp = formatCurrency(currency, preferred?.topped_up_balance);

    return {
      id: "deepseek",
      label: "DeepSeek",
      kind: "api",
      primaryLabel: "充值金额",
      primaryValue: toppedUp,
      status: balance.is_available === false ? "error" : "connected",
      sourceLabel: "余额 API",
      href: "https://platform.deepseek.com/usage",
      accent: "rose",
      metrics: [
        { label: "可用余额", value: total, hint: "总余额含充值和赠金" },
        { label: "赠金余额", value: granted, hint: "未过期赠金" },
      ],
      updatedAt: new Date().toISOString(),
      message: balance.is_available === false ? "余额不足，DeepSeek API 可能不可用。" : undefined,
    };
  } catch (error) {
    return {
      id: "deepseek",
      label: "DeepSeek",
      kind: "api",
      primaryLabel: "充值金额",
      primaryValue: "同步失败",
      status: "error",
      sourceLabel: "余额 API",
      href: "https://platform.deepseek.com/usage",
      accent: "rose",
      metrics: [
        { label: "可用余额", value: "同步失败", hint: "账户可用额度" },
        { label: "赠金余额", value: "同步失败", hint: "未过期赠金" },
      ],
      message: error instanceof Error ? error.message : "DeepSeek 余额同步失败。",
    };
  }
}

async function fetchDeepSeekBalance(apiKey: string, baseUrl?: string): Promise<DeepSeekBalanceResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6_000);
  try {
    const endpoint = new URL("/user/balance", baseUrl ?? "https://api.deepseek.com").toString();
    const response = await fetch(endpoint, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => null)) as DeepSeekBalanceResponse | { error?: { message?: string } } | null;
    if (!response.ok) {
      const message = body && "error" in body ? body.error?.message : undefined;
      throw new Error(message ?? `DeepSeek 余额接口返回 HTTP ${response.status}`);
    }
    return (body ?? {}) as DeepSeekBalanceResponse;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("DeepSeek 余额同步超时。");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function formatCurrency(currency: string, value?: string) {
  const normalized = value?.trim();
  if (!normalized) return "待同步";
  if (currency === "CNY") return `¥${normalized}`;
  if (currency === "USD") return `$${normalized}`;
  return `${currency} ${normalized}`;
}
