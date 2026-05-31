import { useEffect, useMemo, useState } from "react";
import { Brain, Check, Cpu, Heart, KeyRound, Mic2, PackagePlus, RefreshCw, Send, Shield, Sparkles, X, Zap } from "lucide-react";
import { PetdexSprite } from "../pet/PetdexSprite";
import { getPetdexTemplate, pickFriendPetdexTemplate } from "../pet/petdexCatalog";
import type { PetProfile } from "../pet/petProfile";
import { usePersistentState } from "../../lib/usePersistentState";
import type {
  AccountProfile,
  AiProviderId,
  FriendSummary,
  Memory,
  ProviderConfigureParams,
  ProviderSummary,
  SkillSummary,
  SocialExchangeRecord,
  VoiceConfigureParams,
} from "@pet/protocol";

type RuntimeSidePanelProps = {
  view?: "friends" | "settings" | "memory" | "skills";
  petProfile?: PetProfile;
  memories: Memory[];
  memoryProposal: Memory | null;
  skills: SkillSummary[];
  providers: ProviderSummary[];
  account: AccountProfile | null;
  friends: FriendSummary[];
  latestExchange: SocialExchangeRecord | null;
  onCommitMemory: () => void | Promise<void>;
  onRejectMemory: () => void | Promise<void>;
  onRunSkill: (name: string) => void | Promise<void>;
  onSignIn: (displayName: string) => void | Promise<void>;
  onAddFriend: (handle: string) => void | Promise<void>;
  onExchangeFriend: (friendId: string) => void | Promise<void>;
  onConfigureProvider: (params: ProviderConfigureParams) => void | Promise<void>;
  onConfigureVoice: (params: VoiceConfigureParams) => void | Promise<void>;
  onSaveMemory: (content: string) => void | Promise<void>;
};

type FriendCard = {
  id: string;
  displayName: string;
  handle: string;
  petName: string;
  activity: string;
  mood: string;
  tone: "lime" | "peach" | "blue" | "violet";
  real: boolean;
  petdexSlug: string;
};

type SkillCatalogItem = SkillSummary & {
  origin: "runtime" | "codex" | "local";
  maturity: "active" | "available" | "reference";
};

type PeerSkillOffer = SkillSummary & {
  pitch: string;
};

const providerOptions: Array<{ id: AiProviderId; label: string; defaultModel: string; defaultBaseUrl?: string }> = [
  { id: "deepseek", label: "DeepSeek", defaultModel: "deepseek-chat", defaultBaseUrl: "https://api.deepseek.com" },
  { id: "openai", label: "OpenAI", defaultModel: "gpt-4o-mini" },
  { id: "anthropic", label: "Anthropic", defaultModel: "claude-3-5-haiku-latest" },
  { id: "google", label: "Google Gemini", defaultModel: "gemini-2.5-flash" },
  { id: "xai", label: "xAI Grok", defaultModel: "grok-3-mini" },
  { id: "openrouter", label: "OpenRouter", defaultModel: "openai/gpt-4o-mini", defaultBaseUrl: "https://openrouter.ai/api/v1" },
  { id: "openai-compatible", label: "OpenAI-compatible", defaultModel: "gpt-4o-mini" },
];

const defaultProviderOption = providerOptions[0]!;

const mockFriends: FriendCard[] = [
  {
    id: "popular_doraemon",
    displayName: "哆啦A梦",
    handle: "@doraemon",
    petName: "哆啦A梦",
    activity: "正在整理百宝袋里的提醒",
    mood: "热门",
    tone: "blue",
    real: false,
    petdexSlug: "doraemon",
  },
  {
    id: "popular_spiderman",
    displayName: "Peter Parker",
    handle: "@spidey",
    petName: "蜘蛛侠",
    activity: "正在巡逻今天的待办",
    mood: "热门",
    tone: "violet",
    real: false,
    petdexSlug: "chaossprite-default",
  },
  {
    id: "popular_doubao",
    displayName: "豆包",
    handle: "@doubao",
    petName: "豆包",
    activity: "正在陪聊和总结灵感",
    mood: "热门",
    tone: "peach",
    real: false,
    petdexSlug: "clawd",
  },
  {
    id: "popular_pikachu",
    displayName: "皮卡丘",
    handle: "@pikachu",
    petName: "皮卡丘",
    activity: "正在给任务充电",
    mood: "热门",
    tone: "lime",
    real: false,
    petdexSlug: "yupi-penguin",
  },
  {
    id: "popular_nezha",
    displayName: "哪吒",
    handle: "@nezha",
    petName: "哪吒",
    activity: "正在同步今日状态",
    mood: "热门",
    tone: "peach",
    real: false,
    petdexSlug: "ducduc",
  },
  {
    id: "popular_baymax",
    displayName: "Baymax",
    handle: "@baymax",
    petName: "大白",
    activity: "正在记录健康提醒",
    mood: "热门",
    tone: "blue",
    real: false,
    petdexSlug: "eve",
  },
  {
    id: "mock_mianmian",
    displayName: "沈棉",
    handle: "@mian",
    petName: "白桃",
    activity: "正在整理会议纪要",
    mood: "专注",
    tone: "peach",
    real: false,
    petdexSlug: "fafa",
  },
  {
    id: "mock_akira",
    displayName: "Akira",
    handle: "@akira",
    petName: "Pixel",
    activity: "正在跑前端截图检查",
    mood: "忙碌",
    tone: "blue",
    real: false,
    petdexSlug: "capy",
  },
  {
    id: "mock_luna",
    displayName: "林鹿",
    handle: "@luna",
    petName: "小栀",
    activity: "正在听 Lo-fi 歌单",
    mood: "放松",
    tone: "lime",
    real: false,
    petdexSlug: "maodie",
  },
  {
    id: "mock_noah",
    displayName: "Noah",
    handle: "@noah",
    petName: "Nova",
    activity: "正在同步 Skill 清单",
    mood: "在线",
    tone: "violet",
    real: false,
    petdexSlug: "boba",
  },
];

const extraSkills: SkillCatalogItem[] = [
  {
    name: "browser-control",
    description: "打开、点击、截图和验证本地 Web 页面，适合前端验收。",
    category: "browser",
    permissions: ["browser:local"],
    enabled: true,
    path: "Browser/control-in-app-browser",
    origin: "codex",
    maturity: "available",
  },
  {
    name: "playwright",
    description: "用真实浏览器执行导航、表单、截图和 UI 流程检查。",
    category: "browser",
    permissions: ["browser:automation"],
    enabled: true,
    path: "~/.codex/skills/playwright",
    origin: "codex",
    maturity: "available",
  },
  {
    name: "documents",
    description: "创建和检查 docx 文档，支持渲染后视觉验收。",
    category: "files",
    permissions: ["file:write"],
    enabled: true,
    path: "Documents/skills/documents",
    origin: "codex",
    maturity: "available",
  },
  {
    name: "spreadsheets",
    description: "生成、分析和格式化 xlsx/csv 表格。",
    category: "files",
    permissions: ["file:write"],
    enabled: true,
    path: "Spreadsheets/skills/spreadsheets",
    origin: "codex",
    maturity: "available",
  },
  {
    name: "presentations",
    description: "制作 PPTX 演示文稿并做版面验证。",
    category: "files",
    permissions: ["file:write"],
    enabled: true,
    path: "Presentations/skills/presentations",
    origin: "codex",
    maturity: "available",
  },
  {
    name: "pdf",
    description: "读取、生成和渲染 PDF，适合合同、报告和票据检查。",
    category: "files",
    permissions: ["file:read", "file:write"],
    enabled: true,
    path: "~/.codex/skills/pdf",
    origin: "codex",
    maturity: "available",
  },
  {
    name: "github-pr",
    description: "检查 PR、处理 review comments、定位 CI 失败。",
    category: "dev",
    permissions: ["github:read", "github:write"],
    enabled: true,
    path: "GitHub/skills",
    origin: "codex",
    maturity: "available",
  },
  {
    name: "openai-docs",
    description: "查询 OpenAI 官方文档，帮助选择模型和升级提示词。",
    category: "research",
    permissions: ["network:openai-docs"],
    enabled: true,
    path: "~/.codex/skills/openai-docs",
    origin: "codex",
    maturity: "reference",
  },
  {
    name: "imagegen",
    description: "生成或编辑位图资产，用于宠物形象、贴纸和页面视觉。",
    category: "creative",
    permissions: ["image:generate"],
    enabled: true,
    path: "~/.codex/skills/imagegen",
    origin: "codex",
    maturity: "available",
  },
  {
    name: "redesign-existing-projects",
    description: "审计并升级现有前端项目，不迁移框架。",
    category: "creative",
    permissions: ["file:write"],
    enabled: true,
    path: "~/.agents/skills/redesign-existing-projects",
    origin: "local",
    maturity: "reference",
  },
  {
    name: "skill-creator",
    description: "创建新的 Codex skill，维护说明、脚本和资产目录。",
    category: "dev",
    permissions: ["file:write"],
    enabled: true,
    path: "~/.codex/skills/skill-creator",
    origin: "codex",
    maturity: "reference",
  },
  {
    name: "skill-installer",
    description: "从 curated 列表或 GitHub 路径安装 Codex skills。",
    category: "dev",
    permissions: ["file:write", "network:github"],
    enabled: true,
    path: "~/.codex/skills/skill-installer",
    origin: "codex",
    maturity: "reference",
  },
];

const defaultInstalledFriendSkills: SkillSummary[] = [];

const friendSkillOfferPool: PeerSkillOffer[] = [
  {
    name: "task-weaver",
    description: "把聊天、会议和零散提醒整理成今日任务，并标出可立即执行的第一步。",
    category: "productivity",
    permissions: ["calendar:read", "memory:read"],
    enabled: true,
    pitch: "适合每天早上同步计划和晚上复盘。",
  },
  {
    name: "research-snapshot",
    description: "把一次搜索整理成来源卡、关键结论和继续追问列表。",
    category: "research",
    permissions: ["network:web", "file:write"],
    enabled: true,
    pitch: "适合做选题、竞品和资料速读。",
  },
  {
    name: "ui-polish-review",
    description: "快速审查界面层级、间距、状态和移动端适配风险。",
    category: "creative",
    permissions: ["browser:local", "file:read"],
    enabled: true,
    pitch: "适合前端页面交付前做一次视觉检查。",
  },
  {
    name: "focus-soundboard",
    description: "根据当前任务生成专注歌单、番茄钟节奏和收尾提示。",
    category: "media",
    permissions: ["network:music-provider"],
    enabled: true,
    pitch: "适合写作、编码和整理资料时使用。",
  },
  {
    name: "issue-briefing",
    description: "把报错、日志和改动摘要压缩成可交接的问题说明。",
    category: "dev",
    permissions: ["file:read"],
    enabled: true,
    pitch: "适合把调试现场交给另一个智能体继续处理。",
  },
  {
    name: "memory-merge",
    description: "把新的偏好和稳定习惯合并进长期记忆，保留隐私边界。",
    category: "productivity",
    permissions: ["memory:read", "memory:write"],
    enabled: true,
    pitch: "适合频繁微调宠物人格和工作习惯的人。",
  },
  {
    name: "doc-checkline",
    description: "检查文档结构、缺失段落、格式一致性和交付前清单。",
    category: "files",
    permissions: ["file:read", "file:write"],
    enabled: true,
    pitch: "适合合同、说明书和周报交付前整理。",
  },
  {
    name: "prompt-tuner",
    description: "把一段粗略指令改成边界清楚、可复用的执行提示。",
    category: "dev",
    permissions: ["file:read"],
    enabled: true,
    pitch: "适合沉淀自己的工作流模板。",
  },
];

const categoryLabels: Record<string, string> = {
  productivity: "效率",
  media: "媒体",
  research: "研究",
  browser: "浏览器",
  files: "文件",
  dev: "开发",
  creative: "创意",
};

const categoryOrder = ["productivity", "media", "research", "browser", "files", "dev", "creative"];

export function RuntimeSidePanel({
  view = "settings",
  petProfile,
  memories,
  memoryProposal,
  skills,
  providers,
  account,
  friends,
  latestExchange,
  onCommitMemory,
  onRejectMemory,
  onSignIn,
  onAddFriend,
  onExchangeFriend,
  onConfigureProvider,
  onConfigureVoice,
  onSaveMemory,
}: RuntimeSidePanelProps) {
  const [displayName, setDisplayName] = useState("");
  const [friendHandle, setFriendHandle] = useState("");
  const [friendNotice, setFriendNotice] = useState("");
  const [friendMessageDrafts, setFriendMessageDrafts] = useState<Record<string, string>>({});
  const [activeExchangeFriendId, setActiveExchangeFriendId] = useState<string | null>(null);
  const [exchangePulseSkillName, setExchangePulseSkillName] = useState<string | null>(null);
  const [installedFriendSkills, setInstalledFriendSkills] = usePersistentState<SkillSummary[]>("pet.installed.friend.skills", defaultInstalledFriendSkills);
  const [providerId, setProviderId] = useState<AiProviderId>("deepseek");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("deepseek-chat");
  const [baseUrl, setBaseUrl] = useState("https://api.deepseek.com");
  const [providerNotice, setProviderNotice] = useState("");
  const [voiceKey, setVoiceKey] = useState("");
  const [voiceBaseUrl, setVoiceBaseUrl] = useState("https://token-plan-cn.xiaomimimo.com/v1");
  const [audioModel, setAudioModel] = useState("mimo-v2.5");
  const [ttsModel, setTtsModel] = useState("mimo-v2.5-tts");
  const [voice, setVoice] = useState("mimo_default");
  const [voiceNotice, setVoiceNotice] = useState("");

  const memoryText = useMemo(() => memories.map((memory) => memory.content).join("\n"), [memories]);
  const [petPersonaDraft, setPetPersonaDraft] = useState(defaultPetPersona(memoryText));
  const [ownerPreferenceDraft, setOwnerPreferenceDraft] = useState(defaultOwnerPreference(memoryText));
  const [memoryDraft, setMemoryDraft] = useState(extractSection(memoryText, "长期记忆") || memoryText);

  const friendCards = useMemo(() => {
    const realCards: FriendCard[] = friends.map((friend, index) => ({
      id: friend.id,
      displayName: friend.displayName,
      handle: `@${friend.handle}`,
      petName: friend.petName ?? ["豆包", "Mochi", "泡芙"][index % 3]!,
      activity: friend.lastExchangeAt ? `上次交换 ${new Date(friend.lastExchangeAt).toLocaleDateString()}` : ["正在查资料", "正在写周报", "正在听歌"][index % 3]!,
      mood: friend.status === "accepted" ? "在线" : "待确认",
      tone: ["lime", "peach", "blue", "violet"][index % 4] as FriendCard["tone"],
      real: true,
      petdexSlug: pickFriendPetdexTemplate(friend.id || friend.handle || index).slug,
    }));
    return [...mockFriends, ...realCards].slice(0, 16);
  }, [friends]);

  const skillGroups = useMemo(() => groupSkills(skills, installedFriendSkills), [installedFriendSkills, skills]);
  const activeExchangeFriend = useMemo(
    () => friendCards.find((friend) => friend.id === activeExchangeFriendId) ?? null,
    [activeExchangeFriendId, friendCards],
  );
  const activeExchangeSkills = useMemo(() => (activeExchangeFriend ? offeredSkillsForFriend(activeExchangeFriend) : []), [activeExchangeFriend]);
  const installedSkillNames = useMemo(
    () => new Set([...skills, ...installedFriendSkills, ...extraSkills].map((skill) => skill.name)),
    [installedFriendSkills, skills],
  );
  const localPetTemplate = getPetdexTemplate(petProfile?.appearance === "petdex-sprite" ? petProfile.petdexSlug : "skillbit");
  const localPetName = petProfile?.name?.trim() || "我的宠物";

  useEffect(() => {
    setPetPersonaDraft(defaultPetPersona(memoryText));
    setOwnerPreferenceDraft(defaultOwnerPreference(memoryText));
    setMemoryDraft(extractSection(memoryText, "长期记忆") || memoryText);
  }, [memoryText]);

  useEffect(() => {
    if (!activeExchangeFriendId) return;
    if (!friendCards.some((friend) => friend.id === activeExchangeFriendId)) {
      setActiveExchangeFriendId(null);
    }
  }, [activeExchangeFriendId, friendCards]);

  async function submitSignIn() {
    const value = displayName.trim();
    if (!value) return;
    await onSignIn(value);
    setDisplayName("");
  }

  async function submitFriend() {
    const value = friendHandle.trim();
    if (!value) return;
    await onAddFriend(value);
    setFriendHandle("");
    setFriendNotice(`已添加 ${value}，等待下一次本地交换。`);
  }

  function selectProvider(value: string) {
    const option = providerOptions.find((item) => item.id === value) ?? defaultProviderOption;
    setProviderId(option.id);
    setModel(option.defaultModel);
    setBaseUrl(option.defaultBaseUrl ?? "");
    setProviderNotice("");
  }

  async function submitProvider() {
    const key = apiKey.trim();
    const targetModel = model.trim();
    if (!key || !targetModel) return;

    try {
      await onConfigureProvider({
        provider: providerId,
        apiKey: key,
        model: targetModel,
        baseUrl: baseUrl.trim() || undefined,
      });
      setApiKey("");
      setProviderNotice("已保存到本机运行时配置");
    } catch (error) {
      setProviderNotice(error instanceof Error ? error.message : "保存失败");
    }
  }

  async function submitVoice() {
    const key = voiceKey.trim();
    if (!key) return;
    try {
      await onConfigureVoice({
        provider: "xiaomi",
        apiKey: key,
        baseUrl: voiceBaseUrl.trim() || undefined,
        audioModel: audioModel.trim() || undefined,
        ttsModel: ttsModel.trim() || undefined,
        voice: voice.trim() || undefined,
      });
      setVoiceKey("");
      setVoiceNotice("小米语音配置已保存");
    } catch (error) {
      setVoiceNotice(error instanceof Error ? error.message : "保存失败");
    }
  }

  async function saveMemory() {
    await onSaveMemory(
      [`# 宠物人格`, petPersonaDraft.trim(), "", "# 主人偏好", ownerPreferenceDraft.trim(), "", "# 长期记忆", memoryDraft.trim()]
        .filter((line) => line !== undefined)
        .join("\n"),
    );
  }

  if (view === "friends") {
    return (
      <section className="friendsPage" aria-label="好友列表">
        <section className="friendsToolbar">
          <div>
            <p className="eyebrow">Local social</p>
            <h2>好友宠物</h2>
          </div>
          <div className="compactFriendForms">
            {account ? (
              <span className="accountBadge">{account.displayName} · @{account.handle}</span>
            ) : (
              <div className="inlineForm compact">
                <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="本地昵称" />
                <button type="button" onClick={() => void submitSignIn()}>
                  登录
                </button>
              </div>
            )}
            <div className="inlineForm compact">
              <input value={friendHandle} onChange={(event) => setFriendHandle(event.target.value)} placeholder="@friend" />
              <button type="button" onClick={() => void submitFriend()}>
                添加
              </button>
            </div>
          </div>
        </section>

        {friendNotice ? <p className="runtimeNotice">{friendNotice}</p> : null}

        <section className="friendCardGrid">
          {friendCards.map((friend) => (
            <article className={`friendCard tone-${friend.tone} ${activeExchangeFriendId === friend.id ? "exchange-open" : ""}`} key={friend.id}>
              <div className="friendPetVisual">
                <PetdexSprite template={getPetdexTemplate(friend.petdexSlug)} state="idle" scale={0.34} animated={false} label={`${friend.petName} 的宠物形象`} />
              </div>
              <div className="friendCardBody">
                <div>
                  <span>{friend.mood}</span>
                  <h3>{friend.petName}</h3>
                  <p>{friend.displayName} · {friend.handle}</p>
                </div>
                <strong>{friend.activity}</strong>
              </div>
              <form
                className="friendMessageForm"
                onSubmit={(event) => {
                  event.preventDefault();
                  sendFriendMessage(friend);
                }}
              >
                <input
                  value={friendMessageDrafts[friend.id] ?? ""}
                  onChange={(event) => updateFriendMessage(friend.id, event.target.value)}
                  placeholder={`给 ${friend.petName} 留言`}
                />
                <button type="submit">
                  <Send size={15} />
                  发送
                </button>
              </form>
              <div className="friendActions">
                <button
                  type="button"
                  onClick={() => exchangeSkill(friend)}
                  aria-expanded={activeExchangeFriendId === friend.id}
                  aria-label={`查看 ${friend.petName} 展示的 Skill`}
                >
                  <RefreshCw size={15} />
                  {activeExchangeFriendId === friend.id ? "正在交换" : "交换 Skill"}
                </button>
              </div>
            </article>
          ))}
        </section>

        {latestExchange ? (
          <article className="runtimeCard compact highlight latestExchangeCard">
            <strong>最近交换</strong>
            <p>{latestExchange.summary}</p>
          </article>
        ) : null}

        {activeExchangeFriend ? (
          <section className="skillExchangeBackdrop" role="presentation" onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeExchangeModal();
          }}>
            <article
              className={`skillExchangeModal tone-${activeExchangeFriend.tone} ${exchangePulseSkillName ? "is-transferring" : ""}`}
              role="dialog"
              aria-modal="true"
              aria-label={`${activeExchangeFriend.petName} 的 Skill 交换`}
            >
              <header className="exchangeModalHeader">
                <div>
                  <p className="eyebrow">Skill exchange</p>
                  <h3>{activeExchangeFriend.petName} 正在展示 Skill</h3>
                  <span>{activeExchangeFriend.displayName} · {activeExchangeFriend.handle} · {activeExchangeSkills.length} 个公开选择</span>
                </div>
                <button className="exchangeCloseButton" type="button" onClick={closeExchangeModal} aria-label="关闭 Skill 交换弹窗">
                  <X size={16} />
                </button>
              </header>

              <section className="exchangePetStage" aria-label="双方宠物交换区">
                <article className="exchangePetNode peer">
                  <PetdexSprite
                    className="exchangePetSprite"
                    template={getPetdexTemplate(activeExchangeFriend.petdexSlug)}
                    state={exchangePulseSkillName ? "waving" : "idle"}
                    scale={0.56}
                    animated
                    label={`${activeExchangeFriend.petName} 的宠物形象`}
                  />
                  <span>{activeExchangeFriend.mood}</span>
                  <strong>{activeExchangeFriend.petName}</strong>
                </article>

                <div className="exchangeTransferRail" aria-live="polite">
                  <span className="exchangePacket">
                    <PackagePlus size={17} />
                  </span>
                  <strong>{exchangePulseSkillName ?? "选择一个 Skill 开始交换"}</strong>
                </div>

                <article className="exchangePetNode local">
                  <PetdexSprite
                    className="exchangePetSprite"
                    template={localPetTemplate}
                    state={exchangePulseSkillName ? "review" : "idle"}
                    scale={0.56}
                    animated
                    label={`${localPetName} 的宠物形象`}
                  />
                  <span>我的库</span>
                  <strong>{localPetName}</strong>
                </article>
              </section>

              <section className="exchangeSkillShelf modalShelf" aria-label="可安装 Skill">
                {activeExchangeSkills.map((skill) => {
                  const installed = installedSkillNames.has(skill.name);
                  const transferring = exchangePulseSkillName === skill.name;
                  return (
                    <button
                      className={`exchangeSkillCard ${installed ? "installed" : ""} ${transferring ? "transferring" : ""}`}
                      type="button"
                      key={`${activeExchangeFriend.id}-${skill.name}`}
                      disabled={installed || transferring}
                      onClick={() => void installFriendSkill(activeExchangeFriend, skill)}
                    >
                      <span className="exchangeSkillCategory">{categoryLabels[skill.category] ?? skill.category}</span>
                      <strong>{skill.name}</strong>
                      <p>{skill.description}</p>
                      <small>{skill.pitch}</small>
                      <span className="exchangeInstallBadge">
                        {transferring ? <RefreshCw size={14} /> : installed ? <Check size={14} /> : <PackagePlus size={14} />}
                        {transferring ? "交换中" : installed ? "已在库中" : "选择交换"}
                      </span>
                    </button>
                  );
                })}
              </section>
            </article>
          </section>
        ) : null}
      </section>
    );
  }

  if (view === "memory") {
    return (
      <section className="memoryPage" aria-label="个性化记忆">
        <section className="memoryPanel memoryWorkbench">
          <div className="panelTitle">
            <span className="titleIcon rose">
              <Brain size={24} />
            </span>
            <div>
              <p className="eyebrow">Memory</p>
              <h2>记忆库</h2>
            </div>
          </div>

          <div className={`memoryStats ${memoryProposal ? "hasProposal" : ""}`}>
            <article>
              <span>已保存</span>
              <strong>{memories.length}</strong>
              <p>条长期记忆</p>
            </article>
            {memoryProposal ? (
              <article>
                <span>记忆提案</span>
                <strong>1</strong>
                <p>等待确认</p>
              </article>
            ) : null}
            <article>
              <span>隐私范围</span>
              <strong>private</strong>
              <p>社交交换默认不外发</p>
            </article>
          </div>

          {memoryProposal ? (
            <div className="proposal">
              <div className="sideTitle">
                <Check size={16} />
                <span>记忆提案</span>
              </div>
              <p>{memoryProposal.content}</p>
              <div className="buttonRow">
                <button type="button" onClick={() => void onCommitMemory()}>
                  保存
                </button>
                <button type="button" onClick={() => void onRejectMemory()}>
                  忽略
                </button>
              </div>
            </div>
          ) : null}

          <div className="memoryEditorGrid">
            <label className="memoryEditor">
              <span>
                <Sparkles size={14} />
                宠物人格
              </span>
              <textarea value={petPersonaDraft} onChange={(event) => setPetPersonaDraft(event.target.value)} />
            </label>
            <label className="memoryEditor">
              <span>
                <Heart size={14} />
                主人偏好
              </span>
              <textarea value={ownerPreferenceDraft} onChange={(event) => setOwnerPreferenceDraft(event.target.value)} />
            </label>
            <label className="memoryEditor longMemoryEditor">
              <span>
                <Shield size={14} />
                长期记忆
              </span>
              <textarea
                value={memoryDraft}
                placeholder="记录稳定偏好、工作习惯、称呼、常用工具和需要长期遵守的设定。"
                onChange={(event) => setMemoryDraft(event.target.value)}
              />
            </label>
          </div>
          <button className="gradientButton roseButton" type="button" onClick={() => void saveMemory()}>
            保存记忆
          </button>
        </section>
      </section>
    );
  }

  if (view === "skills") {
    return (
      <section className="skillsPage" aria-label="Skill 中心">
        <section className="skillsPanel skillsWorkbench">
          <div className="panelTitle">
            <span className="titleIcon yellow">
              <Zap size={24} />
            </span>
            <div>
              <p className="eyebrow">Skill catalog</p>
              <h2>Skill 中心</h2>
            </div>
          </div>

          <div className="skillSummaryRow">
            <span>{skillGroups.total} 个 Skill</span>
            <span>{skills.length} 个来自当前运行时</span>
            <span>{installedFriendSkills.length} 个来自好友交换</span>
          </div>

          <div className="skillCategoryStack">
            {skillGroups.groups.map((group) => (
              <section className="skillCategory" key={group.category}>
                <div className="skillCategoryHeader">
                  <h3>{categoryLabels[group.category] ?? group.category}</h3>
                  <span>{group.items.length}</span>
                </div>
                <div className="skillGrid skillGridLarge">
                  {group.items.map((skill) => (
                    <article className={`skillCard origin-${skill.origin}`} key={`${skill.origin}-${skill.name}`}>
                      <div className="skillCardTop">
                        <h3>{skill.name}</h3>
                        <span>{skill.origin}</span>
                      </div>
                      <p>{skill.description}</p>
                      <div className="skillTags">
                        <span>{skill.enabled ? "enabled" : "disabled"}</span>
                        <span>{skill.maturity}</span>
                        {skill.permissions.slice(0, 2).map((permission) => (
                          <span key={permission}>{permission}</span>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>
      </section>
    );
  }

  return (
    <section className="configPage configOnlyPage" aria-label="模型与语音配置">
      <aside className="configSidebar">
        <div className="panelTitle">
          <span className="titleIcon blue">
            <Cpu size={24} />
          </span>
          <div>
            <p className="eyebrow">Runtime</p>
            <h2>配置状态</h2>
          </div>
        </div>
        <section className="providerStatus">
          {providers.map((provider) => (
            <span className={provider.configured ? "configured" : ""} key={provider.id}>
              <KeyRound size={13} />
              {provider.label}: {provider.configured ? provider.model ?? provider.source ?? "已配置" : "未配置"}
            </span>
          ))}
        </section>
      </aside>

      <section className="apiPanel">
        <div className="panelTitle">
          <span className="titleIcon blue">
            <Cpu size={24} />
          </span>
          <h2>模型引擎 API</h2>
        </div>
        <div className="providerForm">
          <label>
            <span>提供商</span>
            <select value={providerId} onChange={(event) => selectProvider(event.target.value)}>
              {providerOptions.map((option) => (
                <option value={option.id} key={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>模型版本</span>
            <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="模型名称" />
          </label>
          <label className="spanTwo">
            <span>Base URL</span>
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="接口地址 Base URL" />
          </label>
          <label className="spanTwo">
            <span>API Key</span>
            <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="API Key" type="password" />
          </label>
          <button className="gradientButton darkButton spanTwo" type="button" onClick={() => void submitProvider()}>
            保存配置
          </button>
        </div>
        {providerNotice ? <p className="runtimeNotice">{providerNotice}</p> : null}
      </section>

      <section className="apiPanel voicePanel">
        <div className="panelTitle">
          <span className="titleIcon cyan">
            <Mic2 size={24} />
          </span>
          <h2>语音模型</h2>
        </div>
        <div className="providerForm voiceForm">
          <label className="spanTwo">
            <span>Base URL</span>
            <input value={voiceBaseUrl} onChange={(event) => setVoiceBaseUrl(event.target.value)} placeholder="https://token-plan-cn.xiaomimimo.com/v1" />
          </label>
          <label className="spanTwo">
            <span>API Key</span>
            <input value={voiceKey} onChange={(event) => setVoiceKey(event.target.value)} placeholder="小米 MiMo API Key" type="password" />
          </label>
          <label>
            <span>转写模型</span>
            <input value={audioModel} onChange={(event) => setAudioModel(event.target.value)} placeholder="mimo-v2.5" />
          </label>
          <label>
            <span>TTS 模型</span>
            <input value={ttsModel} onChange={(event) => setTtsModel(event.target.value)} placeholder="mimo-v2.5-tts" />
          </label>
          <label className="spanTwo">
            <span>音色</span>
            <input value={voice} onChange={(event) => setVoice(event.target.value)} placeholder="mimo_default / 冰糖 / 茉莉" />
          </label>
          <button className="gradientButton cyanButton spanTwo" type="button" onClick={() => void submitVoice()}>
            保存语音配置
          </button>
        </div>
        {voiceNotice ? <p className="runtimeNotice">{voiceNotice}</p> : null}
      </section>
    </section>
  );

  function exchangeSkill(friend: FriendCard) {
    setActiveExchangeFriendId((current) => (current === friend.id ? null : friend.id));
    setExchangePulseSkillName(null);
    setFriendNotice("");
  }

  function closeExchangeModal() {
    setActiveExchangeFriendId(null);
    setExchangePulseSkillName(null);
  }

  async function installFriendSkill(friend: FriendCard, skill: PeerSkillOffer) {
    const skillForLibrary: SkillSummary = {
      name: skill.name,
      description: skill.description,
      category: skill.category,
      permissions: skill.permissions,
      enabled: true,
      path: `friend://${friend.handle.replace(/^@/, "")}/${skill.name}`,
    };

    setExchangePulseSkillName(skill.name);
    window.setTimeout(() => setExchangePulseSkillName((current) => (current === skill.name ? null : current)), 900);

    setInstalledFriendSkills((current) => {
      if (current.some((item) => item.name === skill.name)) return current;
      return [skillForLibrary, ...current];
    });
    setFriendNotice(`已安装 ${skill.name} 到我的 Skill 库。`);

    if (!friend.real) return;

    try {
      await onExchangeFriend(friend.id);
    } catch (error) {
      setFriendNotice(`已安装 ${skill.name}，但交换记录同步失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  }

  function updateFriendMessage(friendId: string, value: string) {
    setFriendMessageDrafts((drafts) => ({ ...drafts, [friendId]: value }));
  }

  function sendFriendMessage(friend: FriendCard) {
    const message = (friendMessageDrafts[friend.id] ?? "").trim();
    if (!message) return;
    setFriendNotice(`已向 ${friend.displayName} 发送消息：${message}`);
    setFriendMessageDrafts((drafts) => {
      const next = { ...drafts };
      delete next[friend.id];
      return next;
    });
  }
}

function groupSkills(runtimeSkills: SkillSummary[], installedSkills: SkillSummary[] = []) {
  const runtimeItems: SkillCatalogItem[] = runtimeSkills.map((skill) => ({
    ...skill,
    origin: "runtime",
    maturity: skill.enabled ? "active" : "available",
  }));
  const installedItems: SkillCatalogItem[] = installedSkills.map((skill) => ({
    ...skill,
    origin: "local",
    maturity: "active",
  }));
  const seen = new Set<string>();
  const merged = [...runtimeItems, ...installedItems, ...extraSkills].filter((skill) => {
    const key = `${skill.category}:${skill.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const groups = categoryOrder
    .map((category) => ({
      category,
      items: merged.filter((skill) => skill.category === category),
    }))
    .filter((group) => group.items.length);

  return { groups, total: merged.length };
}

function offeredSkillsForFriend(friend: FriendCard) {
  const start = hashText(`${friend.id}:${friend.handle}:${friend.petName}`) % friendSkillOfferPool.length;
  return [0, 2, 5].map((offset) => friendSkillOfferPool[(start + offset) % friendSkillOfferPool.length]!);
}

function hashText(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function extractSection(content: string, title: string) {
  const pattern = new RegExp(`#\\s*${title}\\s*\\n([\\s\\S]*?)(?=\\n#\\s|$)`);
  return content.match(pattern)?.[1]?.trim() ?? "";
}

function defaultPetPersona(content: string) {
  return (
    extractSection(content, "宠物人格") ||
    "Q Assistant 说话直接、轻快，优先把事情做完；遇到不确定的信息会说明边界；提醒时不夸张，不撒娇过度。"
  );
}

function defaultOwnerPreference(content: string) {
  return (
    extractSection(content, "主人偏好") ||
    "喜欢中文界面；偏好干净白底、固定导航、信息密度适中；回答要直接，少套话，必要时给可执行下一步。"
  );
}
