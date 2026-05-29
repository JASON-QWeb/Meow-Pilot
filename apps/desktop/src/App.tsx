import { Circle, MessageCircle, Settings, Users, Wand2 } from "lucide-react";
import { Window as TauriWindow, getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { ChatPanel } from "./features/chat/ChatPanel";
import { DraggablePetOverlay } from "./features/pet/DraggablePetOverlay";
import { deletePetRigAsset, loadPetRigAsset, savePetRigAsset } from "./features/pet/petAssetStore";
import { PetCustomizer } from "./features/pet/PetCustomizer";
import { defaultPetPosition, defaultPetProfile, type PetPosition, type PetProfile, type PetRigAsset } from "./features/pet/petProfile";
import { RuntimeSidePanel } from "./features/runtime/RuntimeSidePanel";
import { GeneratedSurfacePanel } from "./features/surfaces/SurfaceRenderer";
import { usePetAgent, type ConnectionStatus } from "./hooks/usePetAgent";
import { usePersistentState } from "./lib/usePersistentState";
import qbotMascotUrl from "./assets/qbot-mascot.png";

type AppWindow = "pet" | "work";
type WorkView = "chat" | "friends" | "custom" | "config";
type StoredWorkView = WorkView | "settings";

const initialAppWindow = currentAppWindow();
document.documentElement.dataset.window = initialAppWindow;

export function App() {
  const agent = usePetAgent();
  const [appWindow] = useState<AppWindow>(initialAppWindow);
  const [storedWorkView, setStoredWorkView] = usePersistentState<StoredWorkView>("pet.work.view", "chat");
  const [petProfile, setPetProfile] = usePersistentState<PetProfile>("pet.profile", defaultPetProfile);
  const [petPosition, setPetPosition] = usePersistentState<PetPosition>("pet.position", defaultPetPosition);
  const [petAsset, setPetAsset] = useState<PetRigAsset | null>(null);

  useEffect(() => {
    if (
      petProfile.name === "糯糯" &&
      petProfile.species === "nori-cat" &&
      petProfile.primaryColor === "#f7fbf8" &&
      petProfile.accentColor === "#d5ebe5"
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
          position={petPosition}
          onPositionChange={setPetPosition}
          onOpenWork={openWorkWindow}
          dragWindow={isTauriApp()}
        />
      </main>
    );
  }

  return (
    <main className="appShell workShell" aria-label="宠物工作窗口">
      <nav className="workNav" aria-label="工作窗口导航">
        <div className="workLogo" aria-label="BabyQ">
          <img src={qbotMascotUrl} alt="" />
        </div>
        <div className="workNavItems">
          <NavButton active={workView === "chat"} icon={<MessageCircle size={24} />} label="聊天" onClick={() => changeWorkView("chat")} />
          <NavButton active={workView === "friends"} icon={<Users size={24} />} label="好友" onClick={() => changeWorkView("friends")} />
          <NavButton active={workView === "custom"} icon={<Wand2 size={24} />} label="定制" onClick={() => changeWorkView("custom")} />
        </div>
        <div className="workNavBottom">
          <NavButton active={workView === "config"} icon={<Settings size={24} />} label="配置" onClick={() => changeWorkView("config")} />
        </div>
      </nav>

      <section className="workMain">
        <header className="workHeader">
          <h1>{viewTitle(workView, petProfile.name)}</h1>
          <StatusPill status={agent.connection} />
        </header>
        <section className="workContent">{renderWorkView()}</section>
      </section>
    </main>
  );

  function renderWorkView() {
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

    const generatedSurfaces = agent.surfaces.filter((surface) => surface.type !== "media");
    const activeGeneratedSurface = generatedSurfaces.find((surface) => surface.id === agent.activeSurfaceId) ?? generatedSurfaces[0];

    return (
      <section className={`chatSurfaceLayout ${generatedSurfaces.length ? "" : "chatOnly"}`}>
        <ChatPanel
          messages={agent.messages}
          draft={agent.draft}
          draftSurface={agent.draftSurface}
          petName={petProfile.name}
          onSend={agent.sendText}
          onSendVoice={agent.sendVoiceTranscript}
          onTranscribe={agent.transcribeVoice}
          onSpeak={agent.speakText}
        />

        {generatedSurfaces.length ? (
          <GeneratedSurfacePanel
            surfaces={generatedSurfaces}
            activeSurface={activeGeneratedSurface}
            activeSurfaceId={activeGeneratedSurface?.id ?? null}
            onSelectSurface={agent.setActiveSurfaceId}
            onAction={agent.handleSurfaceAction}
          />
        ) : null}
      </section>
    );
  }
}

function viewTitle(view: WorkView, petName: string) {
  const titles: Record<WorkView, string> = {
    chat: `${petName} 的工作窗口`,
    friends: "好友列表",
    custom: "宠物图片工作室",
    config: "代理与技能配置",
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
    <button className={`workNavButton ${active ? "active" : ""}`} type="button" aria-pressed={active} onClick={onClick}>
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
