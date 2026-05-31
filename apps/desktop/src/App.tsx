import {
  Bell,
  Brain,
  CalendarDays,
  Circle,
  CircleUserRound,
  FolderPlus,
  Gauge,
  Home,
  LogOut,
  MessageCircle,
  Plus,
  Puzzle,
  Search,
  Settings,
  Users,
} from "lucide-react";
import { Window as TauriWindow, getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChatPanel } from "./features/chat/ChatPanel";
import { DraggablePetOverlay } from "./features/pet/DraggablePetOverlay";
import { deletePetRigAsset, loadPetRigAsset, savePetRigAsset } from "./features/pet/petAssetStore";
import { PetCustomizer } from "./features/pet/PetCustomizer";
import { defaultPetPosition, defaultPetProfile, type PetPosition, type PetProfile, type PetRigAsset } from "./features/pet/petProfile";
import { HomeDashboard } from "./features/runtime/HomeDashboard";
import { RuntimeSidePanel } from "./features/runtime/RuntimeSidePanel";
import { createDefaultTasks, ScheduledTasksPanel, type ScheduledTask } from "./features/runtime/ScheduledTasksPanel";
import { TokenUsagePanel } from "./features/runtime/TokenUsagePanel";
import { usePetAgent, type ConnectionStatus } from "./hooks/usePetAgent";
import { usePersistentState } from "./lib/usePersistentState";

type AppWindow = "pet" | "work";
type WorkView = "home" | "chat" | "friends" | "custom" | "usage" | "tasks" | "memory" | "skills" | "config";
type StoredWorkView = WorkView | "settings";
type NavIndicator = {
  height: number;
  width: number;
  x: number;
  y: number;
  visible: boolean;
};

const initialAppWindow = currentAppWindow();
document.documentElement.dataset.window = initialAppWindow;
const defaultScheduledTasks = createDefaultTasks();

export function App() {
  const agent = usePetAgent();
  const navRef = useRef<HTMLElement | null>(null);
  const [appWindow] = useState<AppWindow>(initialAppWindow);
  const [storedWorkView, setStoredWorkView] = usePersistentState<StoredWorkView>("pet.work.view", "home");
  const [petProfile, setPetProfile] = usePersistentState<PetProfile>("pet.profile", defaultPetProfile);
  const [petPosition, setPetPosition] = usePersistentState<PetPosition>("pet.position", defaultPetPosition);
  const [scheduledTasks, setScheduledTasks] = usePersistentState<ScheduledTask[]>("pet.scheduled.tasks", defaultScheduledTasks);
  const [petAsset, setPetAsset] = useState<PetRigAsset | null>(null);
  const [navIndicator, setNavIndicator] = useState<NavIndicator>({ height: 48, width: 48, x: 0, y: 0, visible: false });

  useEffect(() => {
    if (petProfile.name === "BabyQ") {
      setPetProfile({ ...petProfile, name: defaultPetProfile.name });
      return;
    }
    if (
      petProfile.name === "糯糯" &&
      petProfile.species === "nori-cat" &&
      petProfile.primaryColor === "#f7fbf8" &&
      petProfile.accentColor === "#d5ebe5"
    ) {
      setPetProfile(defaultPetProfile);
      return;
    }
    if (
      petProfile.name === "Q Assistant" &&
      petProfile.species === "qbot-fox" &&
      petProfile.primaryColor === "#8b5cf6" &&
      petProfile.accentColor === "#f04fd8" &&
      (petProfile.appearance === "classic" || !petProfile.appearance) &&
      !petProfile.assetId
    ) {
      setPetProfile(defaultPetProfile);
      return;
    }
    if (
      petProfile.name === "Q Assistant" &&
      petProfile.appearance === "petdex-sprite" &&
      petProfile.petdexSlug === "boba" &&
      !petProfile.assetId
    ) {
      setPetProfile(defaultPetProfile);
    }
  }, [petProfile, setPetProfile]);

  useEffect(() => {
    let current = true;
    void loadPetRigAsset(petProfile.assetId)
      .then((asset) => {
        if (current) setPetAsset(asset);
      })
      .catch(() => {
        if (current) setPetAsset(null);
      });
    return () => {
      current = false;
    };
  }, [petProfile.assetId]);

  useLayoutEffect(() => {
    document.documentElement.dataset.window = appWindow;
  }, [appWindow]);

  const workView: WorkView = storedWorkView === "settings" ? "config" : storedWorkView;
  const navIndicatorStyle = {
    "--nav-indicator-height": `${navIndicator.height}px`,
    "--nav-indicator-width": `${navIndicator.width}px`,
    "--nav-indicator-x": `${navIndicator.x}px`,
    "--nav-indicator-y": `${navIndicator.y}px`,
  } as CSSProperties;
  const nowLabel = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date());
  const dateLabel = new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", weekday: "short" }).format(new Date());

  useLayoutEffect(() => {
    const nav = navRef.current;
    const activeButton = nav?.querySelector<HTMLButtonElement>(".workNavButton.active");
    if (!nav || !activeButton) return;

    const updateIndicator = () => {
      const navRect = nav.getBoundingClientRect();
      const buttonRect = activeButton.getBoundingClientRect();
      const isHorizontal = getComputedStyle(nav).flexDirection === "row";
      const width = isHorizontal ? 42 : 48;
      const height = width;
      const x = buttonRect.left - navRect.left + (buttonRect.width - width) / 2;
      const y = buttonRect.top - navRect.top + (buttonRect.height - height) / 2;

      setNavIndicator((current) => {
        const next = { height, width, x, y, visible: true };
        if (
          current.visible === next.visible &&
          current.height === next.height &&
          current.width === next.width &&
          Math.abs(current.x - next.x) < 0.5 &&
          Math.abs(current.y - next.y) < 0.5
        ) {
          return current;
        }
        return next;
      });
    };

    updateIndicator();

    const resizeObserver = "ResizeObserver" in window ? new ResizeObserver(updateIndicator) : null;
    resizeObserver?.observe(nav);
    resizeObserver?.observe(activeButton);
    window.addEventListener("resize", updateIndicator);
    nav.addEventListener("scroll", updateIndicator, { passive: true });

    const scrollParents = Array.from(nav.querySelectorAll<HTMLElement>(".workNavItems, .workNavBottom"));
    scrollParents.forEach((element) => element.addEventListener("scroll", updateIndicator, { passive: true }));

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateIndicator);
      nav.removeEventListener("scroll", updateIndicator);
      scrollParents.forEach((element) => element.removeEventListener("scroll", updateIndicator));
    };
  }, [workView]);

  function changeWorkView(view: WorkView) {
    setStoredWorkView(view);
  }

  async function saveGeneratedPet(asset: PetRigAsset) {
    await savePetRigAsset(asset);
    setPetAsset(asset);
    setPetProfile({ ...petProfile, appearance: "layered-image", assetId: asset.id });
  }

  async function deleteGeneratedPet() {
    if (petProfile.assetId) {
      await deletePetRigAsset(petProfile.assetId);
    }
    setPetAsset(null);
    setPetProfile({ ...petProfile, appearance: "classic", assetId: undefined });
  }

  if (appWindow === "pet") {
    return (
      <main className="appShell petOnlyShell" aria-label="桌面宠物常驻层">
        <DraggablePetOverlay
          profile={petProfile}
          asset={petAsset}
          emotion={agent.petEmotion}
          activity={agent.petActivity.activity}
          active={agent.petActivity.active}
          tokenUsage={agent.tokenUsage}
          position={petPosition}
          onPositionChange={setPetPosition}
          onOpenWork={openWorkWindow}
          dragWindow={isTauriApp()}
        />
      </main>
    );
  }

  return (
    <main className="appShell workShell" aria-label="Q Console">
      <nav className="workNav" aria-label="主导航" ref={navRef}>
        <span className={`workNavIndicator ${navIndicator.visible ? "visible" : ""}`} aria-hidden="true" style={navIndicatorStyle} />
        <div className="workLogo" aria-label="Q Console">
          <span>Q</span>
        </div>
        <div className="workNavItems">
          <NavButton active={workView === "custom"} icon={<FolderPlus size={24} />} label="形象" onClick={() => changeWorkView("custom")} />
          <NavButton active={workView === "home"} icon={<Home size={24} />} label="主页" onClick={() => changeWorkView("home")} />
          <NavButton active={workView === "tasks"} icon={<CalendarDays size={24} />} label="任务" onClick={() => changeWorkView("tasks")} />
          <NavButton active={workView === "usage"} icon={<Gauge size={24} />} label="用量" onClick={() => changeWorkView("usage")} />
          <NavButton active={workView === "friends"} icon={<Users size={24} />} label="好友" onClick={() => changeWorkView("friends")} />
          <NavButton active={workView === "chat"} icon={<MessageCircle size={24} />} label="会话" onClick={() => changeWorkView("chat")} />
          <NavButton active={workView === "memory"} icon={<Brain size={24} />} label="记忆" onClick={() => changeWorkView("memory")} />
          <NavButton active={workView === "skills"} icon={<Puzzle size={24} />} label="Skill" onClick={() => changeWorkView("skills")} />
        </div>
        <div className="workNavBottom">
          <NavButton active={workView === "config"} icon={<Settings size={24} />} label="配置" onClick={() => changeWorkView("config")} />
          <button className="workNavUtility profile" type="button" aria-label="账户" title="账户">
            <CircleUserRound size={24} />
          </button>
          <button className="workNavUtility" type="button" aria-label="退出" title="退出">
            <LogOut size={24} />
          </button>
        </div>
      </nav>

      <section className="workMain">
        <header className="workHeader">
          <div className="workGreeting">
            <h1>{viewTitle(workView)}</h1>
            <p>Q Console · 本地智能体运行台</p>
          </div>
          <div className="workHeaderActions" aria-label="快捷操作">
            <button className={`headerChip ${workView === "home" ? "active" : ""}`} type="button" onClick={() => changeWorkView("home")}>
              <Home size={16} />
              总览
            </button>
            <button className="headerChip" type="button" onClick={() => changeWorkView("tasks")}>
              <Plus size={16} />
              新任务
            </button>
            <label className="headerSearch">
              <Search size={17} />
              <input aria-label="搜索" placeholder="Search" readOnly />
            </label>
            <button className="headerIcon" type="button" aria-label="通知">
              <Bell size={18} />
              <span />
            </button>
            <div className="headerClock" aria-label={`${dateLabel} ${nowLabel}`}>
              <strong>{nowLabel}</strong>
              <span>{dateLabel}</span>
            </div>
            <StatusPill status={agent.connection} />
          </div>
        </header>
        <section className="workContent">{renderWorkView()}</section>
      </section>
    </main>
  );

  function renderWorkView() {
    if (workView === "home") {
      return (
        <HomeDashboard
          petProfile={petProfile}
          petAsset={petAsset}
          petEmotion={agent.petEmotion}
          petActivity={agent.petActivity.activity}
          connection={agent.connection}
          providers={agent.providers}
          tokenUsage={agent.tokenUsage}
          runtimeStats={agent.runtimeStats}
          tasks={scheduledTasks}
          onSendPrompt={agent.sendText}
          onNavigate={changeWorkView}
        />
      );
    }

    if (workView === "friends") {
      return (
        <RuntimeSidePanel
          view="friends"
          memories={agent.memories}
          memoryProposal={agent.memoryProposal}
          skills={agent.skills}
          providers={agent.providers}
          account={agent.account}
          friends={agent.friends}
          latestExchange={agent.latestExchange}
          onCommitMemory={agent.commitMemoryProposal}
          onRejectMemory={agent.rejectMemoryProposal}
          onRunSkill={agent.runSkill}
          onSignIn={agent.signIn}
          onAddFriend={agent.addFriend}
          onExchangeFriend={agent.exchangeWithFriend}
          onConfigureProvider={agent.configureProvider}
          onConfigureVoice={agent.configureVoice}
          onSaveMemory={agent.saveMemoryText}
        />
      );
    }

    if (workView === "custom") {
      return (
        <PetCustomizer
          profile={petProfile}
          asset={petAsset}
          onChange={setPetProfile}
          onSaveAsset={saveGeneratedPet}
          onDeleteAsset={deleteGeneratedPet}
        />
      );
    }

    if (workView === "usage") {
      return <TokenUsagePanel providers={agent.providers} summaries={agent.tokenUsage} onRefresh={agent.refreshTokenUsage} />;
    }

    if (workView === "tasks") {
      return <ScheduledTasksPanel tasks={scheduledTasks} onChange={setScheduledTasks} />;
    }

    if (workView === "memory") {
      return (
        <RuntimeSidePanel
          view="memory"
          memories={agent.memories}
          memoryProposal={agent.memoryProposal}
          skills={agent.skills}
          providers={agent.providers}
          account={agent.account}
          friends={agent.friends}
          latestExchange={agent.latestExchange}
          onCommitMemory={agent.commitMemoryProposal}
          onRejectMemory={agent.rejectMemoryProposal}
          onRunSkill={agent.runSkill}
          onSignIn={agent.signIn}
          onAddFriend={agent.addFriend}
          onExchangeFriend={agent.exchangeWithFriend}
          onConfigureProvider={agent.configureProvider}
          onConfigureVoice={agent.configureVoice}
          onSaveMemory={agent.saveMemoryText}
        />
      );
    }

    if (workView === "skills") {
      return (
        <RuntimeSidePanel
          view="skills"
          memories={agent.memories}
          memoryProposal={agent.memoryProposal}
          skills={agent.skills}
          providers={agent.providers}
          account={agent.account}
          friends={agent.friends}
          latestExchange={agent.latestExchange}
          onCommitMemory={agent.commitMemoryProposal}
          onRejectMemory={agent.rejectMemoryProposal}
          onRunSkill={agent.runSkill}
          onSignIn={agent.signIn}
          onAddFriend={agent.addFriend}
          onExchangeFriend={agent.exchangeWithFriend}
          onConfigureProvider={agent.configureProvider}
          onConfigureVoice={agent.configureVoice}
          onSaveMemory={agent.saveMemoryText}
        />
      );
    }

    if (workView === "config") {
      return (
        <RuntimeSidePanel
          view="settings"
          memories={agent.memories}
          memoryProposal={agent.memoryProposal}
          skills={agent.skills}
          providers={agent.providers}
          account={agent.account}
          friends={agent.friends}
          latestExchange={agent.latestExchange}
          onCommitMemory={agent.commitMemoryProposal}
          onRejectMemory={agent.rejectMemoryProposal}
          onRunSkill={agent.runSkill}
          onSignIn={agent.signIn}
          onAddFriend={agent.addFriend}
          onExchangeFriend={agent.exchangeWithFriend}
          onConfigureProvider={agent.configureProvider}
          onConfigureVoice={agent.configureVoice}
          onSaveMemory={agent.saveMemoryText}
        />
      );
    }

    return (
      <section className="chatSurfaceLayout chatOnly">
        <ChatPanel
          sessions={agent.sessions}
          activeSessionId={agent.sessionId}
          messages={agent.messages}
          draft={agent.draft}
          draftSurface={agent.draftSurface}
          petName={petProfile.name}
          isAgentRunning={agent.isAgentRunning}
          onSelectSession={agent.resumeSession}
          onCreateSession={agent.createSession}
          onDeleteSession={agent.deleteSession}
          onSend={agent.sendText}
          onSendVoice={agent.sendVoiceTranscript}
          onTranscribe={agent.transcribeVoice}
          onSpeak={agent.speakText}
          onSurfaceAction={agent.handleSurfaceAction}
        />
      </section>
    );
  }
}

function viewTitle(view: WorkView) {
  const titles: Record<WorkView, string> = {
    home: "Q Console",
    chat: "会话",
    friends: "好友宠物",
    custom: "形象工作室",
    usage: "用量看板",
    tasks: "定时任务",
    memory: "记忆",
    skills: "Skill",
    config: "配置",
  };
  return titles[view];
}

function StatusPill({ status }: { status: ConnectionStatus }) {
  const label: Record<ConnectionStatus, string> = {
    connecting: "连接中",
    ready: "已连接",
    offline: "离线",
  };
  return (
    <span className={`statusPill ${status}`}>
      <Circle size={10} fill="currentColor" />
      {label[status]}
    </span>
  );
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button className={`workNavButton ${active ? "active" : ""}`} type="button" aria-label={label} aria-pressed={active} title={label} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

async function openWorkWindow() {
  if (!isTauriApp()) return;
  const workWindow = await TauriWindow.getByLabel("work");
  await workWindow?.unminimize();
  await workWindow?.show();
  await workWindow?.setFocus();
}

function currentAppWindow(): AppWindow {
  if (!isTauriApp()) return "work";
  try {
    return getCurrentWindow().label === "pet" ? "pet" : "work";
  } catch {
    return "work";
  }
}

function isTauriApp() {
  return "__TAURI_INTERNALS__" in window;
}
