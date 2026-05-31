import { Plus, Upload, Wand2 } from "lucide-react";
import { useState } from "react";
import { PetImageStudio } from "./PetImageStudio";
import { PetAvatar } from "./PetAvatar";
import { PetdexSprite } from "./PetdexSprite";
import { getPetdexTemplate, petdexTemplates } from "./petdexCatalog";
import type { PetImageCutoutParams, PetImageCutoutPayload } from "@pet/protocol";
import type { PetProfile, PetRigAsset } from "./petProfile";

type PetCustomizerProps = {
  profile: PetProfile;
  asset: PetRigAsset | null;
  onChange: (profile: PetProfile) => void;
  onSaveAsset: (asset: PetRigAsset) => void | Promise<void>;
  onDeleteAsset: () => void | Promise<void>;
  onCutoutImage: (params: PetImageCutoutParams) => Promise<PetImageCutoutPayload>;
};

const petdexGalleryUrl = "https://petdex.crafter.run/zh";

export function PetCustomizer({ profile, asset, onChange, onSaveAsset, onDeleteAsset, onCutoutImage }: PetCustomizerProps) {
  const [studioOpen, setStudioOpen] = useState(false);
  const currentPetdexTemplate = profile.appearance === "petdex-sprite" ? getPetdexTemplate(profile.petdexSlug) : null;
  const currentAppearanceLabel = currentPetdexTemplate
    ? `来自 Petdex: ${currentPetdexTemplate.displayName}`
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
          <button className="importPetButton" type="button" onClick={() => setStudioOpen(true)}>
            <Upload size={18} />
            {asset ? "编辑宠物图片" : "导入新宠物图片"}
          </button>

          <label>
            <span>名字</span>
            <input value={profile.name} onChange={(event) => onChange({ ...profile, name: event.target.value })} />
          </label>

          <div className="appearanceCard">
            <span>图片形象</span>
            <p>
              {currentPetdexTemplate
                ? "来自 Petdex"
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
                  title={`Petdex: ${template.displayName}`}
                  onClick={() => onChange({ ...profile, appearance: "petdex-sprite", petdexSlug: template.slug, assetId: undefined })}
                >
                  <PetdexSprite template={template} state="idle" scale={0.2} animated={false} />
                  <span>{template.displayName}</span>
                </button>
              ))}
              <a className="petdexTemplateAdd" href={petdexGalleryUrl} target="_blank" rel="noreferrer" aria-label="打开 Petdex 获取更多宠物形象">
                <Plus size={24} />
                <span>更多</span>
              </a>
            </div>
            {profile.appearance === "layered-image" ? (
              <button
                className="classicAvatarButton"
                type="button"
                onClick={() => onChange({ ...profile, appearance: "petdex-sprite", petdexSlug: getPetdexTemplate(profile.petdexSlug).slug, assetId: undefined })}
              >
                使用 Petdex 形象
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
        </section>
      </div>

      {studioOpen ? <PetImageStudio asset={asset} onApply={onSaveAsset} onClose={() => setStudioOpen(false)} onCutoutImage={onCutoutImage} /> : null}
    </section>
  );
}
