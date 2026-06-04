import { useEffect, useMemo, useState } from "react";
import { Brain, Check, Cpu, FileText, Heart, KeyRound, Mic2, PackagePlus, RefreshCw, Save, Send, Settings2, Shield, Sparkles, SquareTerminal, X, Zap } from "lucide-react";
import { PetdexSprite } from "../pet/PetdexSprite";
import { getPetdexTemplate, pickFriendPetdexTemplate } from "../pet/petdexCatalog";
import type { PetProfile } from "../pet/petProfile";
import { usePersistentState } from "../../lib/usePersistentState";
import { useVirtualWindow } from "../../hooks/useVirtualWindow";
import type {
  AccountProfile,
  AiProviderId,
  FriendSummary,
  Memory,
  PermissionRequest,
  ProviderConfigureParams,
  ProviderSummary,
  SkillSummary,
  SocialExchangeRecord,
  ToolRunRecord,
  VoiceConfigureParams,
} from "@pet/protocol";

type RuntimeSidePanelProps = {
  view?: "friends" | "settings" | "memory" | "skills" | "tools";
  petProfile?: PetProfile;
  memories: Memory[];
  memoryProposal: Memory | null;
  skills: SkillSummary[];
  providers: ProviderSummary[];
  account: AccountProfile | null;
  friends: FriendSummary[];
  latestExchange: SocialExchangeRecord | null;
  pendingPermissions?: PermissionRequest[];
  toolRuns?: ToolRunRecord[];
  onCommitMemory: () => void | Promise<void>;
  onRejectMemory: () => void | Promise<void>;
  onRunSkill: (name: string) => void | Promise<void>;
  onResolvePermission?: (permissionId: string, approved: boolean) => unknown | Promise<unknown>;
  onSignIn: (displayName: string) => void | Promise<void>;
  onAddFriend: (handle: string) => void | Promise<void>;
  onExchangeFriend: (friendId: string) => void | Promise<void>;
  onConfigureProvider: (params: ProviderConfigureParams) => void | Promise<void>;
  onConfigureVoice: (params: VoiceConfigureParams) => void | Promise<void>;
  onSaveMemory: (content: string, id?: string) => void | Promise<void>;
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

type MemorySectionId = "petPersona" | "ownerPreference" | "longMemory";

const memorySectionConfig: Record<MemorySectionId, { id: string; title: string }> = {
  petPersona: { id: "mem_pet_persona", title: "宠物人格" },
  ownerPreference: { id: "mem_owner_preference", title: "主人偏好" },
  longMemory: { id: "mem_long_term", title: "长期记忆" },
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

const defaultInstalledFriendSkills: SkillSummary[] = [];

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
  pendingPermissions = [],
  toolRuns = [],
  onCommitMemory,
  onRejectMemory,
  onResolvePermission,
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
  const [memoryNotice, setMemoryNotice] = useState("");
  const [savingMemorySection, setSavingMemorySection] = useState<MemorySectionId | null>(null);
  const toolRunWindow = useVirtualWindow(toolRuns, { estimateItemHeight: 86, overscan: 8, enabled: toolRuns.length > 40 });

  const memoryText = useMemo(() => memories.map((memory) => memory.content).join("\n"), [memories]);
  const savedPetPersona = useMemo(
    () => memorySectionContent(memories, memorySectionConfig.petPersona.id, memorySectionConfig.petPersona.title) || defaultPetPersona(memoryText),
    [memories, memoryText],
  );
  const savedOwnerPreference = useMemo(
    () => memorySectionContent(memories, memorySectionConfig.ownerPreference.id, memorySectionConfig.ownerPreference.title) || defaultOwnerPreference(memoryText),
    [memories, memoryText],
  );
  const savedLongMemory = useMemo(
    () => memorySectionContent(memories, memorySectionConfig.longMemory.id, memorySectionConfig.longMemory.title) || extractSection(memoryText, "长期记忆") || memoryText,
    [memories, memoryText],
  );
  const [petPersonaDraft, setPetPersonaDraft] = useState(savedPetPersona);
  const [ownerPreferenceDraft, setOwnerPreferenceDraft] = useState(savedOwnerPreference);
  const [memoryDraft, setMemoryDraft] = useState(savedLongMemory);

  const friendCards = useMemo(() => {
    return friends.map((friend, index) => ({
      id: friend.id,
      displayName: friend.displayName,
      handle: `@${friend.handle}`,
      petName: friend.petName ?? friend.displayName,
      activity: friend.lastExchangeAt ? `上次交换 ${new Date(friend.lastExchangeAt).toLocaleDateString()}` : "暂无交换记录",
      mood: friend.status === "accepted" ? "在线" : "待确认",
      tone: ["lime", "peach", "blue", "violet"][index % 4] as FriendCard["tone"],
      real: true,
      petdexSlug: pickFriendPetdexTemplate(friend.id || friend.handle || index).slug,
    }));
  }, [friends]);

  const skillGroups = useMemo(() => groupSkills(skills, installedFriendSkills), [installedFriendSkills, skills]);
  const activeExchangeFriend = useMemo(
    () => friendCards.find((friend) => friend.id === activeExchangeFriendId) ?? null,
    [activeExchangeFriendId, friendCards],
  );
  const installedSkillNames = useMemo(
    () => new Set([...skills, ...installedFriendSkills].map((skill) => skill.name)),
    [installedFriendSkills, skills],
  );
  const localPetTemplate = getPetdexTemplate(petProfile?.appearance === "petdex-sprite" ? petProfile.petdexSlug : undefined);
  const localPetName = petProfile?.name?.trim() || "我的宠物";

  useEffect(() => {
    setPetPersonaDraft(savedPetPersona);
    setOwnerPreferenceDraft(savedOwnerPreference);
    setMemoryDraft(savedLongMemory);
  }, [savedLongMemory, savedOwnerPreference, savedPetPersona]);

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

  async function saveMemorySection(section: MemorySectionId) {
    const config = memorySectionConfig[section];
    const content =
      section === "petPersona" ? petPersonaDraft.trim() : section === "ownerPreference" ? ownerPreferenceDraft.trim() : memoryDraft.trim();
    if (!content) return;

    setSavingMemorySection(section);
    setMemoryNotice("");
    try {
      await onSaveMemory(`# ${config.title}\n${content}`, config.id);
      setMemoryNotice(`${config.title}已保存`);
    } catch (error) {
      setMemoryNotice(error instanceof Error ? error.message : `${config.title}保存失败`);
    } finally {
      setSavingMemorySection(null);
    }
  }

  if (view === "tools") {
    const dangerousCount = pendingPermissions.filter((permission) => permission.permissionLevel === "dangerous").length;
    const renderToolRun = (run: ToolRunRecord) => (
      <article className={`toolAuditItem status-${run.status}`} key={run.id}>
        <span className="toolAuditIcon">
          {run.toolName.startsWith("file_") ? <FileText size={16} /> : <SquareTerminal size={16} />}
        </span>
        <div>
          <header>
            <strong>{run.toolName}</strong>
            <span>{toolRunStatusLabel(run.status)}</span>
          </header>
          <p>{run.summary ?? toolRunPreview(run.output) ?? toolRunPreview(run.input)}</p>
          <small>{formatRuntimeTime(run.completedAt ?? run.createdAt)}{run.cwd ? ` · ${run.cwd}` : ""}</small>
        </div>
      </article>
    );
    return (
      <section className="toolsPage" aria-label="工具与权限">
        <section className="toolsHero">
          <div className="panelTitle">
            <span className="titleIcon blue">
              <SquareTerminal size={24} />
            </span>
            <div>
              <p className="eyebrow">Agent runtime</p>
              <h2>工具与权限</h2>
            </div>
          </div>
          <div className="toolStats">
            <article>
              <span>待确认</span>
              <strong>{pendingPermissions.length}</strong>
            </article>
            <article>
              <span>高风险</span>
              <strong>{dangerousCount}</strong>
            </article>
            <article>
              <span>审计记录</span>
              <strong>{toolRuns.length}</strong>
            </article>
          </div>
        </section>

        <section className="permissionSection" aria-label="待确认权限">
          <div className="sectionHeaderRow">
            <div>
              <p className="eyebrow">Approval queue</p>
              <h3>待确认操作</h3>
            </div>
            <span>{pendingPermissions.length} 项</span>
          </div>
          {pendingPermissions.length ? (
            <div className="permissionGrid">
              {pendingPermissions.map((permission) => (
                <article className={`permissionCard ${permission.permissionLevel}`} key={permission.id}>
                  <header>
                    <div>
                      <span className="permissionLevel">{permission.permissionLevel}</span>
                      <h4>{permission.title}</h4>
                    </div>
                    <strong>{permission.toolName}</strong>
                  </header>
                  <p>{permission.description}</p>
                  <dl className="permissionMeta">
                    <div>
                      <dt>风险</dt>
                      <dd>{permission.risk}</dd>
                    </div>
                    {permission.cwd ? (
                      <div>
                        <dt>CWD</dt>
                        <dd>{permission.cwd}</dd>
                      </div>
                    ) : null}
                  </dl>
                  {permission.command ? (
                    <pre className="commandBlock" aria-label="待执行命令">{permission.command}</pre>
                  ) : null}
                  {permission.diff ? (
                    <pre className="diffBlock" aria-label="文件变更 diff">{permission.diff}</pre>
                  ) : (
                    <pre className="inputBlock" aria-label="工具输入">{formatToolInput(permission.input)}</pre>
                  )}
                  <div className="permissionActions">
                    <button type="button" className="approveButton" disabled={!onResolvePermission} onClick={() => void onResolvePermission?.(permission.id, true)}>
                      <Check size={15} />
                      批准
                    </button>
                    <button type="button" className="denyButton" disabled={!onResolvePermission} onClick={() => void onResolvePermission?.(permission.id, false)}>
                      <X size={15} />
                      拒绝
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <article className="emptyPermissionState">
              <Shield size={22} />
              <div>
                <strong>当前没有待确认操作</strong>
                <p>终端写入、文件变更、联网和 Skill 管理会在这里等待你批准。</p>
              </div>
            </article>
          )}
        </section>

        <section className="toolAuditSection" aria-label="工具审计时间线">
          <div className="sectionHeaderRow">
            <div>
              <p className="eyebrow">Audit timeline</p>
              <h3>最近工具运行</h3>
            </div>
            <span>{toolRuns.length} 条</span>
          </div>
          <div className={`toolAuditList ${toolRunWindow.enabled ? "virtualized" : ""}`} ref={toolRunWindow.containerRef} onScroll={toolRunWindow.onScroll}>
            {toolRuns.length ? (
              toolRunWindow.enabled ? (
                <div className="virtualListSpacer" style={{ height: toolRunWindow.totalHeight }}>
                  <div className="toolAuditVirtualWindow" style={{ transform: `translateY(${toolRunWindow.offsetY}px)` }}>
                    {toolRunWindow.items.map(({ item: run }) => renderToolRun(run))}
                  </div>
                </div>
              ) : (
                toolRunWindow.items.map(({ item: run }) => renderToolRun(run))
              )
            ) : (
              <article className="emptyPermissionState compact">
                <Shield size={20} />
                <div>
                  <strong>还没有工具运行记录</strong>
                  <p>Agent 使用工具后，这里会显示结果、状态和审计摘要。</p>
                </div>
              </article>
            )}
          </div>
        </section>
      </section>
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
                  onClick={() => void exchangeSkill(friend)}
                  aria-expanded={activeExchangeFriendId === friend.id}
                  aria-label={`和 ${friend.petName} 记录一次本地交换`}
                >
                  <RefreshCw size={15} />
                  记录交换
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
                  <h3>{activeExchangeFriend.petName} 的交换记录</h3>
                  <span>{activeExchangeFriend.displayName} · {activeExchangeFriend.handle}</span>
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
                  <strong>{exchangePulseSkillName ?? "等待真实好友 Skill 数据"}</strong>
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
                {[].map((skill: PeerSkillOffer) => {
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
            <article className="memoryEditor">
              <div className="memoryEditorHeader">
                <span>
                  <Sparkles size={14} />
                  宠物人格
                </span>
                <button type="button" onClick={() => void saveMemorySection("petPersona")} disabled={savingMemorySection === "petPersona"}>
                  <Save size={14} />
                  保存
                </button>
              </div>
              <textarea aria-label="宠物人格" value={petPersonaDraft} onChange={(event) => setPetPersonaDraft(event.target.value)} />
            </article>
            <article className="memoryEditor">
              <div className="memoryEditorHeader">
                <span>
                  <Heart size={14} />
                  主人偏好
                </span>
                <button type="button" onClick={() => void saveMemorySection("ownerPreference")} disabled={savingMemorySection === "ownerPreference"}>
                  <Save size={14} />
                  保存
                </button>
              </div>
              <textarea aria-label="主人偏好" value={ownerPreferenceDraft} onChange={(event) => setOwnerPreferenceDraft(event.target.value)} />
            </article>
            <article className="memoryEditor longMemoryEditor">
              <div className="memoryEditorHeader">
                <span>
                  <Shield size={14} />
                  长期记忆
                </span>
                <button type="button" onClick={() => void saveMemorySection("longMemory")} disabled={savingMemorySection === "longMemory"}>
                  <Save size={14} />
                  保存
                </button>
              </div>
              <textarea
                aria-label="长期记忆"
                value={memoryDraft}
                placeholder="记录稳定偏好、工作习惯、称呼、常用工具和需要长期遵守的设定。"
                onChange={(event) => setMemoryDraft(event.target.value)}
              />
            </article>
          </div>
          {memoryNotice ? <p className="runtimeNotice memoryNotice">{memoryNotice}</p> : null}
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
            <Settings2 size={24} />
          </span>
          <div>
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

  async function exchangeSkill(friend: FriendCard) {
    setExchangePulseSkillName(null);
    setFriendNotice("");
    if (!friend.real) return;
    try {
      await onExchangeFriend(friend.id);
      setFriendNotice(`已记录和 ${friend.displayName} 的本地交换。`);
    } catch (error) {
      setFriendNotice(error instanceof Error ? error.message : "交换记录写入失败");
    }
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
    setFriendNotice(`好友消息通道尚未接入运行时，未发送给 ${friend.displayName}。`);
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
  const merged = [...runtimeItems, ...installedItems].filter((skill) => {
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

function formatToolInput(input: Record<string, unknown>) {
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

function toolRunStatusLabel(status: ToolRunRecord["status"]) {
  const labels: Record<ToolRunRecord["status"], string> = {
    success: "成功",
    failed: "失败",
    pending_permission: "待确认",
    denied: "已拒绝",
  };
  return labels[status];
}

function toolRunPreview(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.slice(0, 180);
  try {
    return JSON.stringify(value).slice(0, 180);
  } catch {
    return String(value).slice(0, 180);
  }
}

function formatRuntimeTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function extractSection(content: string, title: string) {
  const pattern = new RegExp(`#\\s*${title}\\s*\\n([\\s\\S]*?)(?=\\n#\\s|$)`);
  return content.match(pattern)?.[1]?.trim() ?? "";
}

function memorySectionContent(memories: Memory[], id: string, title: string) {
  const memory = memories.find((item) => item.id === id);
  if (!memory) return "";
  return extractSection(memory.content, title) || memory.content.trim();
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
