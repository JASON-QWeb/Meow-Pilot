import { Upload, Wand2 } from "lucide-react";
import { useState } from "react";
import { PetImageStudio } from "./PetImageStudio";
import { PetAvatar } from "./PetAvatar";
import { PetdexSprite } from "./PetdexSprite";
import { getPetdexTemplate, petdexTemplates } from "./petdexCatalog";
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
  const currentPetdexTemplate = profile.appearance === "petdex-sprite" ? getPetdexTemplate(profile.petdexSlug) : null;
  const currentAppearanceLabel = currentPetdexTemplate
    ? `Petdex 模板: ${currentPetdexTemplate.displayName}`
    : profile.appearance === "layered-image" && asset
      ? asset.actionSpritesheet
        ? "自定义动作图集"
        : "自定义图片"
      : "Noir 默认形象";

  return (
    <section className="customizationPage" aria-label="宠物图片工作室">
      <div className="customIntro">
        <h2>
          <Wand2 size={28} />
          宠物图片工作室
        </h2>
      </div>

      <div className="customWorkspace">
        <section className="previewStudio">
          <h3>
            <span>1</span>
            形象预览
          </h3>
          <div className="petPreviewStage">
            <PetAvatar profile={profile} asset={asset} emotion="idle" />
            <div className="currentPetBadge">当前形象: {currentAppearanceLabel}</div>
          </div>
        </section>

        <section className="customControls">
          <h3>
            <span>2</span>
            定制操作
          </h3>

          <button className="importPetButton" type="button" onClick={() => setStudioOpen(true)}>
            <Upload size={18} />
            {asset ? "编辑宠物图片" : "导入新宠物图片"}
          </button>

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
            <p>
              {currentPetdexTemplate
                ? `正在使用 Petdex 模板，作者 ${currentPetdexTemplate.submittedBy}`
                : profile.appearance === "layered-image" && asset
                  ? asset.actionSpritesheet
                    ? "正在使用自定义 Petdex 规格动作图集"
                    : "正在使用自定义分层形象"
                  : "默认使用 Noir 立体卡通预设"}
            </p>
            <div className="petdexTemplateGrid" aria-label="Petdex 模板">
              {petdexTemplates.map((template) => (
                <button
                  className={currentPetdexTemplate?.slug === template.slug ? "active" : ""}
                  type="button"
                  key={template.slug}
                  title={`Petdex: ${template.displayName} by ${template.submittedBy}`}
                  onClick={() => onChange({ ...profile, appearance: "petdex-sprite", petdexSlug: template.slug, assetId: undefined })}
                >
                  <PetdexSprite template={template} state="idle" scale={0.2} animated={false} />
                  <span>{template.displayName}</span>
                </button>
              ))}
            </div>
            {profile.appearance === "layered-image" ? (
              <button className="classicAvatarButton" type="button" onClick={() => onChange({ ...profile, appearance: "classic" })}>
                恢复默认造型
              </button>
            ) : asset ? (
              <button className="classicAvatarButton" type="button" onClick={() => onChange({ ...profile, appearance: "layered-image", assetId: asset.id })}>
                使用已生成形象
              </button>
            ) : null}
            {profile.appearance !== "petdex-sprite" ? (
              <button
                className="classicAvatarButton"
                type="button"
                onClick={() => onChange({ ...profile, appearance: "petdex-sprite", petdexSlug: getPetdexTemplate(profile.petdexSlug).slug, assetId: undefined })}
              >
                使用 Petdex 模板
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
