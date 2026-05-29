import { CalendarDays, Check, ExternalLink, Pause, Play, Plus, Search, Sparkles, Volume2 } from "lucide-react";
import type { ComponentNode, SurfaceSpec, UIAction } from "@pet/protocol";

type SurfaceRendererProps = {
  surface: SurfaceSpec;
  onAction: (action: UIAction, surface: SurfaceSpec) => void | Promise<void>;
};

const actionIcons = {
  play: Play,
  pause: Pause,
  plus: Plus,
  check: Check,
  search: Search,
  calendar: CalendarDays,
  external: ExternalLink,
};

export function GeneratedSurfacePanel({
  surfaces,
  activeSurface,
  activeSurfaceId,
  onSelectSurface,
  onAction,
}: {
  surfaces: SurfaceSpec[];
  activeSurface?: SurfaceSpec;
  activeSurfaceId: string | null;
  onSelectSurface: (id: string) => void;
  onAction: (action: UIAction, surface: SurfaceSpec) => void | Promise<void>;
}) {
  return (
    <section className="surfacePanel" aria-label="生成式界面">
      <div className="surfaceTabs">
        {surfaces.length ? (
          surfaces.slice(0, 5).map((surface) => (
            <button className={surface.id === activeSurfaceId ? "active" : ""} type="button" key={surface.id} onClick={() => onSelectSurface(surface.id)}>
              {surface.title ?? surface.intent}
            </button>
          ))
        ) : (
          <span>生成内容</span>
        )}
      </div>
      {activeSurface ? <SurfaceRenderer surface={activeSurface} onAction={onAction} /> : <EmptySurface />}
    </section>
  );
}

export function SurfaceRenderer({ surface, onAction }: SurfaceRendererProps) {
  return (
    <article className={`surfaceCard intent-${surface.intent}`}>
      <div className="surfaceHeader">
        <div>
          <span>{surface.type}</span>
          <h2>{surface.title ?? surface.intent}</h2>
        </div>
        <small>{new Date(surface.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>
      </div>
      <ComponentRenderer node={surface.layout} />
      {surface.actions?.length ? (
        <div className="surfaceActions">
          {surface.actions.map((action) => {
            const Icon = action.icon ? actionIcons[action.icon] : undefined;
            return (
              <button className={action.style ?? "secondary"} type="button" key={action.id} onClick={() => void onAction(action, surface)}>
                {Icon ? <Icon size={16} /> : null}
                {action.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </article>
  );
}

function EmptySurface() {
  return (
    <div className="emptySurface">
      <Sparkles size={28} />
      <p>发送任务后，视频、图片、表格、表单等交互界面会出现在这里。</p>
    </div>
  );
}

function ComponentRenderer({ node }: { node: ComponentNode }) {
  switch (node.kind) {
    case "stack":
      return (
        <div className={`stack ${node.direction ?? "column"} gap-${node.gap ?? "md"}`}>
          {node.children.map((child, index) => (
            <ComponentRenderer node={child} key={`${child.kind}-${index}`} />
          ))}
        </div>
      );
    case "text":
      return <p className={`surfaceText ${node.variant ?? "body"}`}>{node.text}</p>;
    case "list":
      return (
        <div className="surfaceList">
          {node.items.map((item) => (
            <button type="button" key={item.id}>
              <span>{item.title}</span>
              {item.description ? <small>{item.description}</small> : null}
              {item.meta ? <em>{item.meta}</em> : null}
            </button>
          ))}
        </div>
      );
    case "table":
      return (
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                {node.columns.map((column) => (
                  <th key={column.key}>{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {node.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {node.columns.map((column) => (
                    <td key={column.key}>{String(row[column.key] ?? "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "timeline":
      return (
        <div className="timeline">
          {node.items.map((item) => (
            <div className={`timelineItem tone-${item.tone ?? "focus"}`} key={item.id}>
              <time>{item.time}</time>
              <span>{item.title}</span>
            </div>
          ))}
        </div>
      );
    case "media-player":
      return (
        <section className={`mediaPlayer tone-${node.posterTone ?? "aqua"}`}>
          <div className="poster">{node.media === "music" ? <Volume2 size={42} /> : <Play size={42} />}</div>
          <div className="mediaMeta">
            <span>{node.provider ?? node.media}</span>
            <h3>{node.title}</h3>
            <p>{node.subtitle}</p>
            <div className="mediaControls">
              {node.controls.map((control) => (
                <button type="button" key={control} aria-label={control}>
                  {control === "play" ? <Play size={16} /> : control === "pause" ? <Pause size={16} /> : control === "open" ? <ExternalLink size={16} /> : <Plus size={16} />}
                </button>
              ))}
            </div>
          </div>
        </section>
      );
    case "form":
      return (
        <form className="surfaceForm">
          {node.fields.map((field) => (
            <label key={field.id}>
              <span>{field.label}</span>
              {field.type === "textarea" ? <textarea defaultValue={field.value} /> : <input type={field.type === "date" || field.type === "time" ? field.type : "text"} defaultValue={field.value} />}
            </label>
          ))}
        </form>
      );
    case "metric-row":
      return (
        <div className="metricRow">
          {node.metrics.map((metric) => (
            <div className={`metric tone-${metric.tone ?? "neutral"}`} key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </div>
          ))}
        </div>
      );
    default:
      return null;
  }
}
