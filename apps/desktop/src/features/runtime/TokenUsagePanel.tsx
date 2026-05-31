import { useMemo } from "react";
import { Activity, ExternalLink, Gauge, RefreshCw } from "lucide-react";
import type { ProviderSummary, TokenUsageSummary } from "@pet/protocol";

type TokenUsagePanelProps = {
  providers: ProviderSummary[];
  summaries: TokenUsageSummary[];
  onRefresh: () => void | Promise<void>;
};

export function TokenUsagePanel({ providers, summaries, onRefresh }: TokenUsagePanelProps) {
  const providerById = useMemo(() => new Map(providers.map((provider) => [provider.id, provider])), [providers]);
  const codex = providerById.get("codex-cli");
  const claude = providerById.get("claude-code-cli");
  const antigravity = providerById.get("antigravity-cli");
  const xiaomi = providerById.get("xiaomi-voice");
  const deepseek = providerById.get("deepseek");

  const fallbackCards = useMemo(
    () => [
      subscriptionCard({
        id: "codex",
        label: "Codex",
        provider: codex,
        href: "https://chatgpt.com/codex/settings/usage",
        accent: "blue",
      }),
      subscriptionCard({
        id: "claude",
        label: "Claude",
        provider: claude,
        href: "https://claude.ai/settings/usage",
        accent: "violet",
      }),
      subscriptionCard({
        id: "antigravity",
        label: "Antigravity",
        provider: antigravity,
        href: "https://antigravity.google/docs/plans",
        accent: "mint",
      }),
      apiBalanceCard({
        id: "xiaomi",
        label: "Xiaomi MiMo",
        provider: xiaomi,
        href: "https://platform.xiaomimimo.com/console/plan-manage",
        accent: "amber",
        primaryLabel: "当前套餐用量",
        balanceLabel: "当前套餐",
        spendLabel: "补偿积分",
      }),
      apiBalanceCard({
        id: "deepseek",
        label: "DeepSeek",
        provider: deepseek,
        href: "https://platform.deepseek.com/usage",
        accent: "rose",
        primaryLabel: "充值金额",
        balanceLabel: "可用余额",
        spendLabel: "赠金余额",
      }),
    ],
    [antigravity, claude, codex, deepseek, xiaomi],
  );
  const cards = summaries.length ? summaries : fallbackCards;

  const connectedCount = cards.filter((card) => card.status === "connected").length;

  return (
    <section className="usagePage" aria-label="Token 用量">
      <section className="tokenBoard" aria-label="Token 用量看板">
        <div className="tokenBoardHeader">
          <div className="panelTitle">
            <span className="titleIcon green">
              <Gauge size={24} />
            </span>
            <div>
              <p className="eyebrow">Token Watch</p>
              <h2>用量看板</h2>
            </div>
          </div>
          <div className="tokenBoardSync">
            <span>
              <Activity size={14} />
              {connectedCount}/{cards.length} 已连接
            </span>
            <button type="button" title="刷新用量" onClick={() => void Promise.resolve(onRefresh()).catch(() => undefined)}>
              <RefreshCw size={15} />
            </button>
          </div>
        </div>

        <div className="tokenBoardGrid">
          {cards.map((card) => (
            <article className={`tokenUsageCard ${card.accent}`} key={card.id}>
              <div className="tokenCardTopline">
                <span className="tokenProvider">{card.label}</span>
                <span className={statusClass(card.status)}>{statusLabel(card.status)}</span>
              </div>
              <div className="tokenPrimary">
                <span>{card.primaryLabel}</span>
                <strong>{card.primaryValue}</strong>
              </div>
              <div className="tokenMeters">
                {card.metrics.map((meter) => (
                  <div className="tokenMeter" key={meter.label}>
                    <div className="tokenMeterLabel">
                      <span>{meter.label}</span>
                      <strong>{meter.value}</strong>
                    </div>
                    <div className="tokenMeterTrack">
                      {typeof meter.percent === "number" ? <span style={{ width: `${meter.percent}%` }} /> : <span className="pending" />}
                    </div>
                    <p>{meter.hint}</p>
                  </div>
                ))}
              </div>
              <div className="tokenCardFoot">
                <span>{card.kind === "subscription" ? "订阅制" : "API付费"}</span>
                <a className="tokenSourceIcon" href={card.href} target="_blank" rel="noreferrer" title={`打开 ${card.label} 用量页面`} aria-label={`打开 ${card.label} ${card.sourceLabel}`}>
                  <ExternalLink size={14} />
                </a>
              </div>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

function subscriptionCard({
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
  const configured = Boolean(provider?.configured);
  return {
    id,
    label,
    kind: "subscription",
    primaryLabel: "5h 余量",
    primaryValue: configured ? "待同步" : "未连接",
    status: configured ? "connected" : "unconfigured",
    sourceLabel: "额度页",
    href,
    accent,
    metrics: [
      {
        label: "5h 窗口",
        value: configured ? "待同步" : "未连接",
        hint: "剩余额度与刷新时间",
      },
      {
        label: "一周额度",
        value: configured ? "待同步" : "未连接",
        hint: "周额度与下次重置",
      },
    ],
  };
}

function apiBalanceCard({
  id,
  label,
  provider,
  href,
  accent,
  primaryLabel,
  balanceLabel,
  spendLabel,
}: {
  id: string;
  label: string;
  provider?: ProviderSummary;
  href: string;
  accent: TokenUsageSummary["accent"];
  primaryLabel: string;
  balanceLabel: string;
  spendLabel: string;
}): TokenUsageSummary {
  const configured = Boolean(provider?.configured);
  return {
    id,
    label,
    kind: "api",
    primaryLabel,
    primaryValue: configured ? "待同步" : "未配置",
    status: configured ? "connected" : "unconfigured",
    sourceLabel: "控制台",
    href,
    accent,
    metrics: [
      {
        label: balanceLabel,
        value: configured ? "待同步" : "未配置",
        hint: "账户可用额度",
      },
      {
        label: spendLabel,
        value: configured ? "待同步" : "未配置",
        hint: "消费与账单对账",
      },
    ],
  };
}

function statusClass(status: TokenUsageSummary["status"]) {
  return status === "connected" ? "tokenStatus connected" : status === "error" ? "tokenStatus error" : "tokenStatus";
}

function statusLabel(status: TokenUsageSummary["status"]) {
  if (status === "connected") return "已连接";
  if (status === "error") return "异常";
  return "待连接";
}
