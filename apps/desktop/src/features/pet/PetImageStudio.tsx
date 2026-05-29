import { Download, ImagePlus, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { createPetRig, readPetImage, restoreRigSource, rigSettings, type PetImageSource } from "./petImagePipeline";
import type { PetRigAsset, PetRigSettings } from "./petProfile";

type PetImageStudioProps = {
  asset: PetRigAsset | null;
  onApply: (asset: PetRigAsset) => void | Promise<void>;
  onClose: () => void;
};

export function PetImageStudio({ asset, onApply, onClose }: PetImageStudioProps) {
  const [source, setSource] = useState<PetImageSource | null>(() => (asset ? restoreRigSource(asset) : null));
  const [settings, setSettings] = useState<PetRigSettings>(() => rigSettings(asset));
  const [preview, setPreview] = useState<PetRigAsset | null>(asset);
  const [status, setStatus] = useState(asset ? "微调拆件并确认应用。" : "导入一张宠物照片或透明 PNG，先在本机生成拆件。");
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
    setStatus("正在本机生成透明拆件预览...");
    void createPetRig(source, settings, asset?.id)
      .then((rig) => {
        if (!current) return;
        setPreview(asset ? { ...rig, createdAt: asset.createdAt } : rig);
        setStatus("拆件已准备好。检查边缘和层级，确认后再应用到桌面。");
      })
      .catch((error: unknown) => {
        if (!current) return;
        setStatus(error instanceof Error ? error.message : "生成拆件失败，请更换图片重试。");
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
    try {
      const nextSource = await readPetImage(file);
      setSource(nextSource);
      setStatus("图片已导入，正在拆件。");
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

  function downloadLayers() {
    if (!preview) return;
    preview.layers.forEach((layer) => {
      const link = document.createElement("a");
      link.href = layer.imageDataUrl;
      link.download = `${safeFileName(preview.sourceName)}-${layer.id}.png`;
      link.click();
    });
  }

  return createPortal(
    <div className="petStudioBackdrop">
      <section className="petStudio" role="dialog" aria-modal="true" aria-label="从图片生成宠物形象">
        <header className="petStudioHeader">
          <div>
            <p className="eyebrow">宠物图片工作室</p>
            <h2>从图片生成桌面宠物</h2>
            <p className="studioIntro">本地拆成透明图层，再以类似 Live2D / sprite rig 的方式驱动动作；原图不会上传。</p>
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
            <h3>1. 导入原图</h3>
            {source ? <img src={source.dataUrl} alt="导入的宠物原图" /> : <div className="emptyImage">支持 JPG / PNG / WebP，最大 15 MB</div>}
            <input ref={fileInputRef} className="visuallyHidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFileChange} />
            <button type="button" className="studioAction" onClick={() => fileInputRef.current?.click()}>
              <ImagePlus size={15} />
              {source ? "更换图片" : "选择图片"}
            </button>
          </div>

          <div className="studioImageCard rigCard">
            <h3>2. 动态预览</h3>
            {preview ? <RigPreview asset={preview} /> : <div className="emptyImage">导入图片后显示生成形象</div>}
            <span className="localBadge">仅本地处理</span>
          </div>

          <fieldset className="studioControls">
            <legend>3. 微调拆件</legend>
            <label className="checkboxRow">
              <input
                type="checkbox"
                checked={settings.removeBackground}
                onChange={(event) => setSettings({ ...settings, removeBackground: event.target.checked })}
              />
              清除接近边缘颜色的背景
            </label>
            {source?.hasTransparency ? <p className="studioHint">检测到透明 PNG，将直接保留原有透明边缘。</p> : null}
            <RangeControl
              label="去背强度"
              value={settings.backgroundThreshold}
              min={0}
              max={112}
              disabled={!settings.removeBackground}
              onChange={(value) => setSettings({ ...settings, backgroundThreshold: value })}
            />
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
        </div>

        <section className="layerReview" aria-label="生成图层">
          <div className="layerReviewTitle">
            <h3>拆件确认</h3>
            <p>头部会响应思考/聆听，身体负责呼吸，脚部作为稳定落点。</p>
          </div>
          <div className="layerTiles">
            {preview?.layers.map((layer) => (
              <figure className="layerTile" key={layer.id}>
                <img src={layer.imageDataUrl} alt={layer.label} />
                <figcaption>{layer.label}</figcaption>
              </figure>
            )) ?? <p className="emptyLayers">等待图片导入</p>}
          </div>
        </section>

        <footer className="petStudioFooter">
          <p className="studioStatus" aria-live="polite">
            {processing ? "处理中... " : ""}
            {status}
          </p>
          <div className="studioButtons">
            <button type="button" className="studioSecondary" disabled={!preview} onClick={downloadLayers}>
              <Download size={15} />
              下载拆件
            </button>
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
