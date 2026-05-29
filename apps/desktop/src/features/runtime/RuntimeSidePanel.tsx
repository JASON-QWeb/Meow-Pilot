import { useEffect, useMemo, useState } from "react";
import { Brain, Check, Cpu, KeyRound, Mic2, Play, RefreshCw, UserPlus, Zap } from "lucide-react";
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
  view?: "all" | "friends" | "settings";
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

const providerOptions: Array<{ id: AiProviderId; label: string; defaultModel: string; defaultBaseUrl?: string }> = [
  { id: "deepseek", label: "DeepSeek", defaultModel: "deepseek-chat", defaultBaseUrl: "https://api.deepseek.com" },
  { id: "openai", label: "OpenAI", defaultModel: "gpt-4o-mini" },
  { id: "anthropic", label: "Anthropic", defaultModel: "claude-3-5-haiku-latest" },
  { id: "google", label: "Google Gemini", defaultModel: "gemini-2.5-flash" },
  { id: "xai", label: "xAI Grok", defaultModel: "grok-3-mini" },
  { id: "openrouter", label: "OpenRouter", defaultModel: "openai/gpt-4o-mini", defaultBaseUrl: "https://openrouter.ai/api/v1" },
  { id: "openai-compatible", label: "OpenAI-compatible", defaultModel: "gpt-4o-mini" },
];

const skillColors = ["pink", "cyan", "violet", "emerald"];
const defaultProviderOption = providerOptions[0]!;

export function RuntimeSidePanel({
  view = "all",
  memories,
  memoryProposal,
  skills,
  providers,
  account,
  friends,
  latestExchange,
  onCommitMemory,
  onRejectMemory,
  onRunSkill,
  onSignIn,
  onAddFriend,
  onExchangeFriend,
  onConfigureProvider,
  onConfigureVoice,
  onSaveMemory,
}: RuntimeSidePanelProps) {
  const [displayName, setDisplayName] = useState("");
  const [friendHandle, setFriendHandle] = useState("");
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
  const [memoryDraft, setMemoryDraft] = useState(memoryText);

  useEffect(() => {
    setMemoryDraft(memoryText);
  }, [memoryText]);

  if (view === "friends") {
    return (
      <section className="friendsPage" aria-label="好友列表">
        <div className="friendsHero">
          <UsersArtwork />
          <div>
            <p className="eyebrow">本地社交</p>
            <h2>好友列表</h2>
          </div>
        </div>

        <div className="friendsGrid">
          <section className="runtimeList accountPanel">
            <div className="sideTitle">
              <UserPlus size={18} />
              <span>本地账号</span>
            </div>
            {account ? (
              <article className="runtimeCard compact">
                <strong>{account.displayName}</strong>
                <p>@{account.handle}</p>
              </article>
            ) : (
              <div className="inlineForm">
                <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="昵称" />
                <button type="button" onClick={() => void submitSignIn()}>
                  登录
                </button>
              </div>
            )}
          </section>

          <section className="runtimeList friendsPanel">
            <div className="sideTitle">
              <RefreshCw size={18} />
              <span>好友交换</span>
            </div>
            <div className="inlineForm">
              <input value={friendHandle} onChange={(event) => setFriendHandle(event.target.value)} placeholder="@friend" />
              <button type="button" onClick={() => void submitFriend()}>
                添加
              </button>
            </div>
            <div className="runtimeItems">
              {friends.map((friend) => (
                <article className="runtimeCard compact" key={friend.id}>
                  <strong>{friend.displayName}</strong>
                  <p>{friend.lastExchangeAt ? `最近交换 ${new Date(friend.lastExchangeAt).toLocaleDateString()}` : `@${friend.handle}`}</p>
                  <button type="button" onClick={() => void onExchangeFriend(friend.id)}>
                    交换
                  </button>
                </article>
              ))}
              {!friends.length ? <p className="emptyState">还没有好友记录。</p> : null}
              {latestExchange ? (
                <article className="runtimeCard compact highlight">
                  <strong>最近交换</strong>
                  <p>{latestExchange.summary}</p>
                </article>
              ) : null}
            </div>
          </section>
        </div>
      </section>
    );
  }

  return (
    <section className="configPage" aria-label="代理与技能配置">
      <section className="memoryPanel">
        <div className="panelTitle">
          <span className="titleIcon rose">
            <Brain size={24} />
          </span>
          <h2>个性化记忆</h2>
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
        <label className="memoryEditor">
          <span>记忆与设定内容</span>
          <textarea
            value={memoryDraft}
            placeholder="添加一些关于你的设定..."
            onChange={(event) => setMemoryDraft(event.target.value)}
          />
        </label>
        <button className="gradientButton roseButton" type="button" onClick={() => void saveMemory()}>
          保存记忆
        </button>
      </section>

      <section className="configStack">
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
            <h2>小米语音模型</h2>
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

        <section className="skillsPanel">
          <div className="panelTitle">
            <span className="titleIcon yellow">
              <Zap size={24} />
            </span>
            <h2>技能组 Skills</h2>
          </div>
          <div className="skillGrid">
            {skills.map((skill, index) => (
              <article className={`skillCard ${skillColors[index % skillColors.length]}`} key={skill.name}>
                <h3>{skill.name}</h3>
                <p>{skill.description}</p>
                <button type="button" onClick={() => void onRunSkill(skill.name)}>
                  <Play size={13} fill="currentColor" />
                  运行测试
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="providerStatus">
          {providers.map((provider) => (
            <span className={provider.configured ? "configured" : ""} key={provider.id}>
              <KeyRound size={13} />
              {provider.label}: {provider.configured ? provider.model ?? provider.source ?? "已配置" : "未配置"}
            </span>
          ))}
        </section>
      </section>
    </section>
  );

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
    await onSaveMemory(memoryDraft);
  }
}

function UsersArtwork() {
  return (
    <div className="usersArtwork" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}
