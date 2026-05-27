import { ImagePlus } from "lucide-react";
import { useState } from "react";
import { PetImageStudio } from "./PetImageStudio";
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
    <section className="petCustomizer" aria-label="Pet customization">
      <label>
        <span>Name</span>
        <input value={profile.name} onChange={(event) => onChange({ ...profile, name: event.target.value })} />
      </label>

      <label>
        <span>Shape</span>
        <select value={profile.species} onChange={(event) => onChange({ ...profile, species: event.target.value as PetProfile["species"] })}>
          {speciesOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span>Accessory</span>
        <select value={profile.accessory} onChange={(event) => onChange({ ...profile, accessory: event.target.value as PetProfile["accessory"] })}>
          {accessoryOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <div className="swatchRow" aria-label="Color palette">
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
        <span>Photo avatar</span>
        <p>{profile.appearance === "layered-image" && asset ? "正在使用自定义分层形象" : "导入宠物照片，生成可动拆件"}</p>
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

      {studioOpen ? <PetImageStudio asset={asset} onApply={onSaveAsset} onClose={() => setStudioOpen(false)} /> : null}
    </section>
  );
}
