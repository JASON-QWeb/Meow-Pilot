import { CheckCircle2, ImagePlus, Upload, Wand2 } from "lucide-react";
import { useState } from "react";
import { PetImageStudio } from "./PetImageStudio";
import { PetAvatar } from "./PetAvatar";
import type { PetProfile, PetRigAsset } from "./petProfile";
import { accessoryOptions, paletteOptions, speciesOptions } from "./petProfile";

type PetCustomizerProps = {
  profile: PetProfile;
  asset: PetRigAsset | null;
  onChange: (profile: PetProfile) => void;
  onSaveAsset: (asset: PetRigAsset) => void | Promise<void>;
  onDeleteAsset: () => void | Promise<void>;
};

export function PetCustomizer({ profile, asset, onChange, onSaveAsset, onDeleteAsset }: PetCustomizerProps) {
  const [studioOpen, setStudioOpen] = useState(false);

  return (
    <section className="customizationPage" aria-label="宠物图片工作室">
      <div className="customIntro">
        <h2>
          <Wand2 size={28} />
          宠物图片工作室
        </h2>
        <p>调整 BabyQ 的外观，支持透明图层导入与本地微调。</p>
      </div>

      <div className="customWorkspace">
        <section className="previewStudio">
          <h3>
            <span>1</span>
            形象预览
          </h3>
          <div className="petPreviewStage">
            <PetAvatar profile={profile} asset={asset} emotion="idle" />
            <div className="currentPetBadge">当前形象: {profile.appearance === "layered-image" && asset ? "自定义图片" : "QBot 立体狐猫"}</div>
          </div>
        </section>

        <section className="customControls">
          <h3>
            <span>2</span>
            定制操作
          </h3>

          <button className="importPetButton" type="button" onClick={() => setStudioOpen(true)}>
            <Upload size={18} />
            导入新宠物图片
          </button>

          <div className="cleanBadge">
            <CheckCircle2 size={18} />
            清除接近边缘颜色的背景
          </div>

          <label>
            <span>名字</span>
            <input value={profile.name} onChange={(event) => onChange({ ...profile, name: event.target.value })} />
          </label>

          <label>
            <span>预设动物</span>
            <select value={profile.species} onChange={(event) => onChange({ ...profile, species: event.target.value as PetProfile["species"] })}>
              {speciesOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>配饰</span>
            <select value={profile.accessory} onChange={(event) => onChange({ ...profile, accessory: event.target.value as PetProfile["accessory"] })}>
              {accessoryOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="swatchRow" aria-label="配色">
            {paletteOptions.map((palette) => (
              <button
                className={palette.primaryColor === profile.primaryColor && palette.accentColor === profile.accentColor ? "active" : ""}
                type="button"
                key={palette.label}
                title={palette.label}
                style={{ background: `linear-gradient(135deg, ${palette.primaryColor} 0 50%, ${palette.accentColor} 50% 100%)` }}
                onClick={() => onChange({ ...profile, primaryColor: palette.primaryColor, accentColor: palette.accentColor })}
              />
            ))}
          </div>

          <div className="appearanceCard">
            <span>图片形象</span>
            <p>{profile.appearance === "layered-image" && asset ? "正在使用自定义分层形象" : "默认使用 QBot 立体卡通动物预设"}</p>
            <button className="imageStudioButton" type="button" onClick={() => setStudioOpen(true)}>
              <ImagePlus size={15} />
              {asset ? "编辑图片形象" : "从图片生成"}
            </button>
            {profile.appearance === "layered-image" ? (
              <button className="classicAvatarButton" type="button" onClick={() => onChange({ ...profile, appearance: "classic" })}>
                恢复默认造型
              </button>
            ) : asset ? (
              <button className="classicAvatarButton" type="button" onClick={() => onChange({ ...profile, appearance: "layered-image", assetId: asset.id })}>
                使用已生成形象
              </button>
            ) : null}
            {asset ? (
              <button className="deleteAvatarButton" type="button" onClick={() => void onDeleteAsset()}>
                删除导入素材
              </button>
            ) : null}
          </div>

          <button className="applyPetButton" type="button" onClick={() => onChange({ ...profile })}>
            确认应用配置
          </button>
        </section>
      </div>

      {studioOpen ? <PetImageStudio asset={asset} onApply={onSaveAsset} onClose={() => setStudioOpen(false)} /> : null}
    </section>
  );
}
