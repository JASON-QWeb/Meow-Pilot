import { Circle, Database, Maximize2, MessageSquare, Minimize2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { PetEmotion } from "@pet/protocol";
import { ChatPanel } from "./features/chat/ChatPanel";
import { DraggablePetOverlay } from "./features/pet/DraggablePetOverlay";
import { deletePetRigAsset, loadPetRigAsset, savePetRigAsset } from "./features/pet/petAssetStore";
import { PetCustomizer } from "./features/pet/PetCustomizer";
import { PetSceneBoard } from "./features/pet/PetSceneBoard";
import { defaultPetPosition, defaultPetProfile, type PetPosition, type PetProfile, type PetRigAsset } from "./features/pet/petProfile";
import { RuntimeSidePanel } from "./features/runtime/RuntimeSidePanel";
import { GeneratedSurfacePanel } from "./features/surfaces/SurfaceRenderer";
import { usePetAgent, type ConnectionStatus } from "./hooks/usePetAgent";
import { usePersistentState } from "./lib/usePersistentState";

type ShellMode = "workspace" | "pet-only";

export function App() {
  const agent = usePetAgent();
  const [shellMode, setShellMode] = usePersistentState<ShellMode>("pet.shell.mode", "workspace");
  const [petProfile, setPetProfile] = usePersistentState<PetProfile>("pet.profile", defaultPetProfile);
  const [petPosition, setPetPosition] = usePersistentState<PetPosition>("pet.position", defaultPetPosition);
  const [petAsset, setPetAsset] = useState<PetRigAsset | null>(null);

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

  const latestAssistant = agent.messages.filter((message) => message.role === "assistant").at(-1);

  if (shellMode === "pet-only") {
    return (
      <main className="appShell petOnlyShell" aria-label="Desktop pet overlay mode">
        <DraggablePetOverlay
          profile={petProfile}
          asset={petAsset}
          emotion={agent.petEmotion}
          position={petPosition}
          onPositionChange={setPetPosition}
          onOpenChat={() => setShellMode("workspace")}
        />
      </main>
    );
  }

  return (
    <main className="appShell">
      <header className="topBar">
        <div>
          <p className="eyebrow">Pet Agent</p>
          <h1>{petProfile.name} Desktop</h1>
        </div>
        <div className="topActions" aria-label="Runtime status">
          <StatusPill status={agent.connection} />
          <span className="miniStat">
            <Database size={15} />
            {agent.memories.length}
          </span>
          <span className="miniStat">
            <Sparkles size={15} />
            {agent.skills.filter((skill) => skill.enabled).length}
          </span>
          <button className="modeButton" type="button" onClick={() => setShellMode("pet-only")}>
            <Minimize2 size={15} />
            Pet only
          </button>
        </div>
      </header>

      <section className="workspace">
        <section className="petStage" aria-label="Desktop pet">
          <PetSceneBoard
            profile={petProfile}
            asset={petAsset}
            emotion={agent.petEmotion}
            activity={agent.petActivity.activity}
            active={agent.petActivity.active}
            onPetClick={() => void agent.sendText("我现在可以做什么？")}
          />
          <div className="petCaption">
            <span>{emotionCopy[agent.petEmotion]}</span>
            <small>{latestAssistant?.content ?? "Ready"}</small>
          </div>
          <div className="petStageActions">
            <button type="button" onClick={() => setShellMode("pet-only")}>
              <Maximize2 size={15} />
              Place on desktop
            </button>
            <button type="button" onClick={() => void agent.sendText("打开聊天")}>
              <MessageSquare size={15} />
              Talk
            </button>
          </div>
          <PetCustomizer
            profile={petProfile}
            asset={petAsset}
            onChange={setPetProfile}
            onSaveAsset={saveGeneratedPet}
            onDeleteAsset={deleteGeneratedPet}
          />
        </section>

        <ChatPanel
          messages={agent.messages}
          draft={agent.draft}
          petName={petProfile.name}
          onSend={agent.sendText}
          onSendVoice={agent.sendVoiceTranscript}
          onTranscribe={agent.transcribeVoice}
          onSpeak={agent.speakText}
        />

        <GeneratedSurfacePanel
          surfaces={agent.surfaces}
          activeSurface={agent.activeSurface}
          activeSurfaceId={agent.activeSurfaceId}
          onSelectSurface={agent.setActiveSurfaceId}
          onAction={agent.handleSurfaceAction}
        />

        <RuntimeSidePanel
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
        />
      </section>
    </main>
  );
}

function StatusPill({ status }: { status: ConnectionStatus }) {
  return (
    <span className={`statusPill ${status}`}>
      <Circle size={10} fill="currentColor" />
      {status}
    </span>
  );
}

const emotionCopy: Record<PetEmotion, string> = {
  idle: "Waiting",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  celebrating: "Done",
  needs_attention: "Needs review",
};
