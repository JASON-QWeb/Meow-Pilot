import { useEffect, useState } from "react";
import type { PetActivity, PetEmotion } from "@pet/protocol";
import { PetAvatar } from "./PetAvatar";
import type { PetProfile, PetRigAsset } from "./petProfile";

type PetSceneBoardProps = {
  profile: PetProfile;
  asset: PetRigAsset | null;
  emotion: PetEmotion;
  activity: PetActivity;
  active: boolean;
  onPetClick: () => void;
};

const sceneActivities: PetActivity[] = ["coding", "research", "exercise", "sleeping"];

const scenes: Record<PetActivity, { label: string; copy: string }> = {
  coding: { label: "Coding", copy: "坐在电脑前敲代码，咖啡还温着。" },
  research: { label: "查资料", copy: "在厕所玩手机查文档，灵感十分通畅。" },
  exercise: { label: "运动", copy: "没有排期压身，先完成今日拉伸。" },
  sleeping: { label: "睡觉", copy: "任务队列为空，呼吸灯进入省电模式。" },
};

export function PetSceneBoard({ profile, asset, emotion, activity, active, onPetClick }: PetSceneBoardProps) {
  const [preview, setPreview] = useState<PetActivity | null>(null);

  useEffect(() => {
    setPreview(null);
  }, [activity, active]);

  const displayedActivity = preview ?? activity;
  const displayedScene = scenes[displayedActivity];

  return (
    <section className={`petSceneBoard scene-${displayedActivity}`} aria-label="Pet activity scene board">
      <header className="sceneHeader">
        <div>
          <p className="sceneEyebrow">Live status board</p>
          <strong>{displayedScene.label}</strong>
        </div>
        <span className={`sceneStatus ${preview ? "preview" : active ? "working" : "resting"}`}>
          <i />
          {preview ? "PREVIEW" : active ? "BUSY" : "REST"}
        </span>
      </header>

      <div className="sceneCanvas">
        <span className="sceneWall" />
        {displayedActivity === "coding" ? <CodingSet /> : null}
        {displayedActivity === "research" ? <ResearchSet /> : null}
        {displayedActivity === "exercise" ? <ExerciseSet /> : null}
        {displayedActivity === "sleeping" ? <SleepingSet /> : null}
        <PetAvatar profile={profile} asset={asset} emotion={emotion} size="scene" onClick={onPetClick} />
        <span className="sceneFloor" />
      </div>

      <p className="sceneCopy">{displayedScene.copy}</p>
      <nav className="sceneSwitcher" aria-label="Preview pet scenes">
        {sceneActivities.map((sceneActivity) => (
          <button
            className={displayedActivity === sceneActivity ? "selected" : ""}
            type="button"
            aria-pressed={displayedActivity === sceneActivity}
            onClick={() => setPreview(sceneActivity)}
            key={sceneActivity}
          >
            {scenes[sceneActivity].label}
          </button>
        ))}
        {preview ? (
          <button className="sceneAutoButton" type="button" onClick={() => setPreview(null)}>
            自动
          </button>
        ) : null}
      </nav>
    </section>
  );
}

function CodingSet() {
  return (
    <span className="codingSet" aria-hidden="true">
      <span className="sceneWallNote">SHIP IT</span>
      <span className="sceneDesk">
        <span className="sceneMonitor">
          <i />
          <i />
          <i />
          <b />
        </span>
        <span className="sceneKeyboard" />
      </span>
      <span className="sceneCoffee">
        <i />
      </span>
    </span>
  );
}

function ResearchSet() {
  return (
    <span className="researchSet" aria-hidden="true">
      <span className="sceneTiles" />
      <span className="sceneToilet" />
      <span className="scenePaperRoll" />
      <span className="scenePhone">
        <i />
        <i />
        <i />
      </span>
      <span className="sceneSearchBubble">DOCS</span>
    </span>
  );
}

function ExerciseSet() {
  return (
    <span className="exerciseSet" aria-hidden="true">
      <span className="sceneTimer">03:21</span>
      <span className="sceneMat" />
      <span className="sceneDumbbell left" />
      <span className="sceneDumbbell right" />
      <span className="sceneSweat" />
    </span>
  );
}

function SleepingSet() {
  return (
    <span className="sleepingSet" aria-hidden="true">
      <span className="sceneWindow">
        <i />
      </span>
      <span className="sceneBed" />
      <span className="sceneBlanket" />
      <span className="sceneZzz">
        <i>Z</i>
        <i>z</i>
        <i>z</i>
      </span>
    </span>
  );
}
