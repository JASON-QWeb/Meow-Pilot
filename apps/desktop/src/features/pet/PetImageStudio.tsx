import { Download, ImagePlus, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type DragEvent } from "react";
import { createPortal } from "react-dom";
import type { PetImageCutoutParams, PetImageCutoutPayload } from "@pet/protocol";
import { createPetRig, readPetImageDataUrl, readPetImageFileDataUrl, restoreRigSource, rigSettings, type PetImageSource } from "./petImagePipeline";
import { buildPetRigLayerPackage, buildPetdexPackage } from "./petPackageExport";
import { PetdexSprite } from "./PetdexSprite";
import type { PetdexSpriteStateId, PetdexTemplate } from "./petdexCatalog";
import type { PetRigAsset, PetRigSettings } from "./petProfile";

type PetImageStudioProps = {
  asset: PetRigAsset | null;
  onApply: (asset: PetRigAsset) => void | Promise<void>;
  onClose: () => void;
  onCutoutImage: (params: PetImageCutoutParams) => Promise<PetImageCutoutPayload>;
};

export function PetImageStudio({ asset, onApply, onClose, onCutoutImage }: PetImageStudioProps) {
  const [source, setSource] = useState<PetImageSource | null>(() => (asset ? restoreRigSource(asset) : null));
  const [originalPreview, setOriginalPreview] = useState<string | null>(() => asset?.sourceDataUrl ?? null);
  const [settings, setSettings] = useState<PetRigSettings>(() => rigSettings(asset));
  const [preview, setPreview] = useState<PetRigAsset | null>(asset);
  const [status, setStatus] = useState(asset ? "预览已准备好，确认后会应用到桌面宠物。" : "选择一张宠物照片，AI 会先抠出宠物主体，再生成桌面宠物。");
  const [processing, setProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    if (!source) return;
    let current = true;
    setProcessing(true);
    setStatus("正在生成结构拆件和动作预览...");
    void createPetRig(source, settings, asset?.id)
      .then((rig) => {
        if (!current) return;
        setPreview(asset ? { ...rig, createdAt: asset.createdAt } : rig);
        setStatus("结构拆件和动作预览已生成。确认后会应用到桌面宠物。");
      })
      .catch((error: unknown) => {
        if (!current) return;
        setStatus(error instanceof Error ? error.message : "生成预览失败，请更换图片重试。");
      })
      .finally(() => {
        if (current) setProcessing(false);
      });
    return () => {
      current = false;
    };
  }, [asset, settings, source]);

  async function importFile(file?: File) {
    if (!file) return;
    setProcessing(true);
    setPreview(null);
    setSource(null);
    try {
      const imageDataUrl = await readPetImageFileDataUrl(file);
      setOriginalPreview(imageDataUrl);
      setStatus("正在调用 AI 智能抠图，识别宠物主体并移除背景...");
      const cutout = await onCutoutImage({
        imageDataUrl,
        fileName: file.name,
        mimeType: file.type || undefined,
      });
      const nextSource = await readPetImageDataUrl(file.name, cutout.imageDataUrl);
      setSettings((current) => ({ ...current, removeBackground: true, artStyle: "natural" }));
      setSource(nextSource);
      setStatus(`AI 抠图完成（${cutout.provider} / ${cutout.model}），正在生成结构拆件。`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "图片导入失败。");
      setProcessing(false);
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    void importFile(event.target.files?.[0]);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    void importFile(event.dataTransfer.files[0]);
  }

  async function applyRig() {
    if (!preview) return;
    setProcessing(true);
    try {
      await onApply({ ...preview, updatedAt: new Date().toISOString() });
      onClose();
    } catch {
      setStatus("保存形象失败，请重试。");
      setProcessing(false);
    }
  }

  async function downloadLayers() {
    if (!preview) return;
    setProcessing(true);
    try {
      const packageBlob = await buildPetRigLayerPackage(preview);
      downloadBlob(packageBlob, `${safeFileName(preview.sourceName)}-pet-assets.zip`);
      setStatus("素材包已导出，包含预览图、三层拆件和配置文件。");
    } catch {
      setStatus("素材包导出失败，请重试。");
    } finally {
      setProcessing(false);
    }
  }

  async function downloadActionPackage() {
    if (!preview?.actionSpritesheet) return;
    setProcessing(true);
    try {
      const packageBlob = await buildPetdexPackage(preview);
      downloadBlob(packageBlob, `${safeFileName(preview.sourceName)}-petdex.zip`);
      setStatus("动作包已导出，结构与 Petdex zip 兼容。");
    } catch {
      setStatus("动作包导出失败，请重试。");
    } finally {
      setProcessing(false);
    }
  }

  return createPortal(
    <div className="petStudioBackdrop">
      <section className="petStudio" role="dialog" aria-modal="true" aria-label="从图片生成宠物形象">
        <header className="petStudioHeader">
          <div>
            <p className="eyebrow">宠物图片生成</p>
            <h2>把图片变成桌面宠物</h2>
            <p className="studioIntro">选图后自动完成 AI 抠图、结构拆件和动作预览，确认即可应用。</p>
          </div>
          <button className="studioClose" type="button" aria-label="关闭图片工作室" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="petStudioWorkspace">
          <div
            className="studioImageCard uploadCard"
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
          >
            <h3>上传原图</h3>
            {originalPreview ? <img src={originalPreview} alt="导入的宠物原图" /> : <div className="emptyImage">支持 JPG / PNG / WebP，最大 15 MB</div>}
            <input ref={fileInputRef} className="visuallyHidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFileChange} />
            <button type="button" className="studioAction" onClick={() => fileInputRef.current?.click()}>
              <ImagePlus size={15} />
              {originalPreview ? "更换图片" : "选择图片"}
            </button>
          </div>

          <div className="studioImageCard rigCard primaryPreviewCard">
            <h3>AI 结果预览</h3>
            {preview ? <ActionSpritePreview asset={preview} /> : <div className="emptyImage">AI 抠图完成后显示生成形象</div>}
            <span className="aiCutoutBadge">已配置模型抠图</span>
            <p className="studioHint">会先得到透明宠物主体，再生成三层拆件和 Petdex 动作图集。</p>
          </div>
        </div>

        <details className="studioAdvancedPanel">
          <summary>
            <span>高级：拆件与导出</span>
            <small>普通使用不需要调整</small>
          </summary>
          <div className="studioAdvancedBody">
            <fieldset className="studioControls">
              <legend>可选微调</legend>
              <RangeControl label="整体缩放" value={settings.frameScale} min={70} max={145} unit="%" onChange={(value) => setSettings({ ...settings, frameScale: value })} />
              <RangeControl label="主体左右位置" value={settings.frameOffsetX} min={-64} max={64} onChange={(value) => setSettings({ ...settings, frameOffsetX: value })} />
              <RangeControl label="主体上下位置" value={settings.frameOffsetY} min={-64} max={64} onChange={(value) => setSettings({ ...settings, frameOffsetY: value })} />
              <RangeControl label="头部边界" value={settings.headSplit} min={24} max={58} unit="%" onChange={(value) => setSettings({ ...settings, headSplit: value })} />
              <RangeControl label="脚部边界" value={settings.feetSplit} min={58} max={92} unit="%" onChange={(value) => setSettings({ ...settings, feetSplit: value })} />
              <RangeControl label="头部左右调整" value={settings.headOffsetX} min={-22} max={22} onChange={(value) => setSettings({ ...settings, headOffsetX: value })} />
              <RangeControl label="头部上下调整" value={settings.headOffsetY} min={-22} max={22} onChange={(value) => setSettings({ ...settings, headOffsetY: value })} />

              <label>
                <span>生成样式</span>
                <select value={settings.artStyle} onChange={(event) => setSettings({ ...settings, artStyle: event.target.value as PetRigSettings["artStyle"] })}>
                  <option value="sticker">贴纸轮廓</option>
                  <option value="natural">保留照片</option>
                  <option value="pixel">像素伙伴</option>
                </select>
              </label>
              <label>
                <span>动作性格</span>
                <select
                  value={settings.motionStyle}
                  onChange={(event) => setSettings({ ...settings, motionStyle: event.target.value as PetRigSettings["motionStyle"] })}
                >
                  <option value="bounce">活泼弹跳</option>
                  <option value="curious">好奇歪头</option>
                  <option value="calm">安静漂浮</option>
                </select>
              </label>
            </fieldset>

            <section className="layerReview" aria-label="生成图层">
              <div className="layerReviewTitle">
                <h3>结构拆件</h3>
                <p>AI 主体图会拆成脚部、身体、头部，并同步生成动作图集。</p>
              </div>
              <div className="layerTiles">
                {preview?.layers.map((layer) => (
                  <figure className="layerTile" key={layer.id}>
                    <img src={layer.imageDataUrl} alt={layer.label} />
                    <figcaption>{layer.label}</figcaption>
                  </figure>
                )) ?? <p className="emptyLayers">等待图片导入</p>}
              </div>
              {preview?.actionSpritesheet ? (
                <div className="actionPreviewStrip" aria-label="动作行预览">
                  {actionPreviewStates.map((state) => (
                    <figure className="actionPreviewTile" key={state.id}>
                      <PetdexSprite template={customTemplate(preview)} state={state.id} scale={0.24} animated={false} className="customActionSpriteFrame" />
                      <figcaption>{state.label}</figcaption>
                    </figure>
                  ))}
                </div>
              ) : null}
              <div className="advancedDownloadRow">
                <button type="button" className="studioSecondary" disabled={!preview || processing} onClick={() => void downloadLayers()}>
                  <Download size={15} />
                  导出素材包
                </button>
                <button type="button" className="studioSecondary" disabled={!preview?.actionSpritesheet || processing} onClick={() => void downloadActionPackage()}>
                  <Download size={15} />
                  导出 Petdex 包
                </button>
              </div>
            </section>
          </div>
        </details>

        <footer className="petStudioFooter">
          <p className="studioStatus" aria-live="polite">
            {processing ? "处理中... " : ""}
            {status}
          </p>
          <div className="studioButtons">
            <button type="button" className="studioPrimary" disabled={!preview || processing} onClick={() => void applyRig()}>
              <Sparkles size={15} />
              确认并应用
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

const actionPreviewStates: Array<{ id: PetdexSpriteStateId; label: string }> = [
  { id: "idle", label: "待机" },
  { id: "running-right", label: "右跑" },
  { id: "running-left", label: "左跑" },
  { id: "waving", label: "挥手" },
  { id: "jumping", label: "跳跃" },
  { id: "failed", label: "失败" },
  { id: "waiting", label: "等待" },
  { id: "running", label: "奔跑" },
  { id: "review", label: "思考" },
];

function ActionSpritePreview({ asset }: { asset: PetRigAsset }) {
  if (!asset.actionSpritesheet) return <RigPreview asset={asset} />;
  return (
    <div className="studioActionSpritePreview">
      <PetdexSprite template={customTemplate(asset)} state="idle" scale={1.08} className="customActionSpriteFrame" label="自定义动作图集预览" />
    </div>
  );
}

function RigPreview({ asset }: { asset: PetRigAsset }) {
  return (
    <div className={`studioRigPreview motion-${asset.settings.motionStyle}`}>
      {asset.layers.map((layer) => (
        <img
          className={`studioRigLayer layer-${layer.id}`}
          src={layer.imageDataUrl}
          alt=""
          key={layer.id}
          style={{ "--layer-x": `${layer.offsetX}px`, "--layer-y": `${layer.offsetY}px` } as CSSProperties}
        />
      ))}
    </div>
  );
}

function customTemplate(asset: PetRigAsset): PetdexTemplate {
  return {
    slug: asset.id,
    displayName: asset.sourceName.replace(/\.[^.]+$/, "") || "自定义宠物",
    submittedBy: "local image",
    sprite: asset.actionSpritesheet?.dataUrl ?? asset.previewDataUrl,
    sourceUrl: "local-image",
    accentColor: "#117b69",
  };
}

function RangeControl({
  label,
  value,
  min,
  max,
  unit = "",
  disabled = false,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="rangeControl">
      <span>
        {label}
        <strong>
          {value}
          {unit}
        </strong>
      </span>
      <input type="range" min={min} max={max} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function safeFileName(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "-") || "pet";
}

function downloadBlob(blob: Blob, fileName: string) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
