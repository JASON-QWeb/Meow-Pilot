import { ExternalLink, Mic, Music, Plus, Send, Square, Trash2, Video, Volume2 } from "lucide-react";
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import type { ChatMessage, ChatSendPayload, MediaPlayerNode, SessionSummary, SurfaceSpec, UIAction, VoiceSpeakPayload, VoiceTranscribePayload } from "@pet/protocol";
import { SurfaceRenderer, type SurfaceActionHandler } from "../surfaces/SurfaceRenderer";
import { useVirtualWindow } from "../../hooks/useVirtualWindow";

type ChatPanelProps = {
  sessions: SessionSummary[];
  activeSessionId: string | null;
  messages: ChatMessage[];
  draft: string;
  draftSurface?: SurfaceSpec | null;
  petName: string;
  onSelectSession: (sessionId: string) => void | Promise<void>;
  onCreateSession: () => void | Promise<void>;
  onDeleteSession: (sessionId: string) => void | Promise<void>;
  onSend: (text: string) => unknown | Promise<unknown>;
  onSendVoice: (text: string) => Promise<ChatSendPayload | undefined>;
  onTranscribe: (audioData: string) => Promise<VoiceTranscribePayload>;
  onSpeak: (text: string) => Promise<VoiceSpeakPayload>;
  onSurfaceAction: SurfaceActionHandler;
  isAgentRunning?: boolean;
};

type VoicePhase = "idle" | "recording" | "transcribing" | "synthesizing" | "playing" | "error";

export function ChatPanel({
  sessions,
  activeSessionId,
  messages,
  draft,
  draftSurface,
  petName,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
  onSend,
  onSendVoice,
  onTranscribe,
  onSpeak,
  onSurfaceAction,
  isAgentRunning = false,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [voiceNotice, setVoiceNotice] = useState("");
  const [pendingVoiceRunId, setPendingVoiceRunId] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingTimeoutRef = useRef<number | null>(null);
  const discardRecordingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const messageWindow = useVirtualWindow(messages, { estimateItemHeight: 132, overscan: 8, enabled: messages.length > 120 });

  useEffect(() => {
    if (!pendingVoiceRunId) return;
    const answer = messages.find((message) => message.role === "assistant" && message.runId === pendingVoiceRunId);
    if (!answer) return;

    setPendingVoiceRunId(null);
    void playAnswer(answer.content);
  }, [messages, pendingVoiceRunId]);

  useEffect(
    () => () => {
      stopRecording(true);
      stopPlayback();
    },
    [],
  );

  async function send(text: string, source: "text" | "voice" = "text") {
    const trimmed = text.trim();
    if (!trimmed) return;
    setInput("");
    if (source === "voice") {
      const payload = await onSendVoice(trimmed);
      if (payload) {
        setPendingVoiceRunId(payload.runId);
      }
      return;
    }
    await onSend(trimmed);
  }

  const activeSession = sessions.find((session) => session.id === activeSessionId);

  return (
    <section className="chatPanel" aria-label="对话">
      <aside className="chatSessionRail" aria-label="会话列表">
        <div className="chatSessionTitle">
          <div>
            <span>Sessions</span>
            <strong>会话</strong>
          </div>
          <button className="sessionCreateButton" type="button" onClick={() => void onCreateSession()} aria-label="新建会话" title="新建会话">
            <Plus size={16} />
          </button>
        </div>
        <div className="chatSessionList">
          {sessions.map((session) => (
            <div className={`chatSessionItem ${session.id === activeSessionId ? "active" : ""}`} key={session.id}>
              <button className="chatSessionSelect" type="button" onClick={() => void onSelectSession(session.id)}>
                <span>{session.title}</span>
                <small>{formatSessionMeta(session)}</small>
              </button>
              <button className="chatSessionDelete" type="button" onClick={() => void onDeleteSession(session.id)} aria-label={`删除${session.title}`} title="删除会话">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {!sessions.length ? <p className="chatSessionEmpty">还没有会话。</p> : null}
        </div>
      </aside>

      <div className="chatConversation">
        <div className="chatConversationHeader">
          <strong>{activeSession?.title ?? "当前会话"}</strong>
          <span>{activeSession ? `${activeSession.messageCount} 条消息` : "准备中"}</span>
        </div>
      <div className={`messageList ${messageWindow.enabled ? "virtualized" : ""}`} ref={messageWindow.containerRef} onScroll={messageWindow.onScroll}>
        {messageWindow.enabled ? (
          <div className="virtualListSpacer" style={{ height: messageWindow.totalHeight }}>
            <div className="messageVirtualWindow" style={{ transform: `translateY(${messageWindow.offsetY}px)` }}>
              {messageWindow.items.map(({ item: message }) => renderMessage(message))}
            </div>
          </div>
        ) : (
          messageWindow.items.map(({ item: message }) => renderMessage(message))
        )}
        {draft || draftSurface ? (
          <article className={`message assistant streaming ${draftSurface ? "hasSurface" : ""}`}>
            <span>{petName}</span>
            {draft ? <MarkdownText text={draft} /> : null}
            {draftSurface ? <InlineSurface surface={draftSurface} onAction={onSurfaceAction} /> : null}
          </article>
        ) : null}
        {isAgentRunning && !draft && !draftSurface ? (
          <article className="message assistant streaming waiting">
            <span>{petName}</span>
            <div className="messageLoading">
              <i />
              <strong>正在整理</strong>
            </div>
          </article>
        ) : null}
        </div>

        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send(input);
          }}
        >
          <button
            className={`iconButton ${phase === "recording" ? "listening" : ""}`}
            type="button"
            aria-label={phase === "recording" ? "停止并发送语音" : "开始语音输入"}
            title={phase === "recording" ? "停止并发送语音" : "开始语音对话"}
            onClick={() => void captureVoice()}
          >
            {phase === "recording" ? <Square size={16} /> : <Mic size={18} />}
          </button>
          <button className="iconButton" type="button" aria-label="朗读最近回复" title="朗读最近回复" onClick={speakLatestAnswer}>
            <Volume2 size={18} />
          </button>
          <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="输入消息，或使用麦克风对话" />
          <button className="iconButton primary" type="submit" aria-label="发送消息">
            <Send size={18} />
          </button>
        </form>
        {voiceNotice ? (
          <p className={`voiceStatus ${phase}`} aria-live="polite">
            {voiceNotice}
          </p>
        ) : null}
      </div>
    </section>
  );

  function renderMessage(message: ChatMessage) {
    return (
      <article className={`message ${message.role} ${message.surface ? "hasSurface" : ""}`} key={message.id}>
        <span>{message.role === "user" ? "你" : petName}</span>
        {message.content ? <MarkdownText text={message.content} /> : null}
        {message.surface ? <InlineSurface surface={message.surface} onAction={onSurfaceAction} /> : null}
      </article>
    );
  }

  async function captureVoice() {
    if (phase === "recording") {
      stopRecording();
      return;
    }

    stopPlayback();
    if (!navigator.mediaDevices?.getUserMedia || !("MediaRecorder" in window)) {
      startBrowserRecognition();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = preferredRecordingMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];

      streamRef.current = stream;
      recorderRef.current = recorder;
      discardRecordingRef.current = false;
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      });
      recorder.addEventListener("stop", () => {
        const discard = discardRecordingRef.current;
        releaseRecorder();
        if (!discard && chunks.length > 0) {
          const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/mp4" });
          void transcribeRecording(blob);
          return;
        }
        setPhase("idle");
      });
      recorder.addEventListener("error", () => {
        setPhase("error");
        setVoiceNotice("录音失败，请检查麦克风权限后重试。");
        stopRecording(true);
      });
      recorder.start();
      setPhase("recording");
      setVoiceNotice("正在录音，再次点击麦克风即可发送（最长 30 秒）。");
      recordingTimeoutRef.current = window.setTimeout(() => stopRecording(), 30_000);
    } catch {
      setVoiceNotice("无法访问麦克风，尝试使用系统语音识别。");
      startBrowserRecognition();
    }
  }

  function stopRecording(discard = false) {
    const recorder = recorderRef.current;
    if (!recorder) return;
    discardRecordingRef.current = discard;
    clearRecordingTimeout();
    if (!discard) {
      setPhase("transcribing");
      setVoiceNotice("正在通过小米 MiMo 转写录音...");
    }
    if (recorder.state !== "inactive") {
      recorder.stop();
      return;
    }
    releaseRecorder();
  }

  function releaseRecorder() {
    clearRecordingTimeout();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }

  function clearRecordingTimeout() {
    if (recordingTimeoutRef.current !== null) {
      window.clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
  }

  async function transcribeRecording(blob: Blob) {
    setPhase("transcribing");
    try {
      const audioData = await convertRecordingToWavDataUrl(blob);
      const transcription = await onTranscribe(audioData);
      const transcript = transcription.text.trim();
      if (!transcript) throw new Error("Empty transcription");
      setVoiceNotice(`已识别：${transcript}`);
      await send(transcript, "voice");
      setPhase("idle");
    } catch (error) {
      setPhase("error");
      setVoiceNotice(
        isVoiceProviderRequiredError(error) ? "语音转写需要小米 MiMo 或 OpenAI 语音配置；当前模型 provider 仍可继续文字对话。" : "语音识别失败，请重试或输入文字。",
      );
    }
  }

  function startBrowserRecognition() {
    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) {
      setPhase("error");
      setVoiceNotice("此环境无法录音或转写，请检查麦克风权限后使用文字输入。");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = navigator.language || "zh-CN";
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    setPhase("recording");
    setVoiceNotice("正在使用系统语音识别，请开始说话。");

    recognition.onresult = (event: BrowserSpeechRecognitionEvent) => {
      const result = event.results[event.results.length - 1];
      const transcript = result?.[0]?.transcript?.trim();
      if (transcript) setInput(transcript);
      if (transcript && result?.isFinal) {
        setVoiceNotice(`系统已识别：${transcript}`);
        void send(transcript, "voice");
      }
    };
    recognition.onerror = () => {
      setPhase("error");
      setVoiceNotice("系统语音识别失败，请重试或输入文字。");
    };
    recognition.onend = () => setPhase((current) => (current === "recording" ? "idle" : current));
    recognition.start();
  }

  function speakLatestAnswer() {
    const latest = [...messages].reverse().find((message) => message.role === "assistant")?.content || draft;
    if (latest) void playAnswer(latest);
  }

  async function playAnswer(text: string) {
    stopPlayback();
    setPhase("synthesizing");
    setVoiceNotice("正在通过小米 MiMo 生成语音回复...");
    try {
      const speech = await onSpeak(text);
      const audioUrl = URL.createObjectURL(base64AudioBlob(speech.audioData, speech.mimeType));
      const audio = new Audio(audioUrl);
      audioUrlRef.current = audioUrl;
      audioRef.current = audio;
      audio.addEventListener("play", () => {
        setPhase("playing");
        setVoiceNotice(`正在播放 ${speech.model} / ${speech.voice} 语音。`);
      });
      audio.addEventListener("ended", () => {
        setPhase("idle");
        setVoiceNotice("语音回复播放完成。");
        stopPlayback();
      });
      audio.addEventListener("error", () => playSystemSpeech(text));
      await audio.play();
    } catch (error) {
      playSystemSpeech(
        text,
        isVoiceProviderRequiredError(error) ? "语音回复需要小米 MiMo 或 OpenAI 语音配置；当前已切换为系统朗读。" : undefined,
      );
    }
  }

  function playSystemSpeech(text: string, fallbackNotice = "语音模型暂不可用，已切换为系统朗读。") {
    stopPlayback();
    if (!("speechSynthesis" in window)) {
      setPhase("error");
      setVoiceNotice("语音模型暂不可用，且系统不支持朗读。");
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = navigator.language || "zh-CN";
    utterance.rate = 1;
    utterance.onstart = () => {
      setPhase("playing");
      setVoiceNotice(fallbackNotice);
    };
    utterance.onend = () => setPhase("idle");
    utterance.onerror = () => {
      setPhase("error");
      setVoiceNotice("语音播放失败，请稍后重试。");
    };
    window.speechSynthesis.speak(utterance);
  }

  function stopPlayback() {
    audioRef.current?.pause();
    audioRef.current = null;
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }
}

function formatSessionMeta(session: SessionSummary) {
  const updated = new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(session.updatedAt));
  return `${session.messageCount} 条 · ${updated}`;
}

function MarkdownText({ text }: { text: string }) {
  return <div className="messageMarkdown">{renderMarkdownBlocks(text)}</div>;
}

function renderMarkdownBlocks(text: string) {
  const lines = normalizeMarkdownTables(text).split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (isHorizontalRule(line)) {
      blocks.push(<hr key={`hr-${blocks.length}`} />);
      index += 1;
      continue;
    }

    const fence = line.match(/^```([a-zA-Z0-9_-]*)/);
    if (fence) {
      const language = fence[1] ?? "";
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index] ?? "")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        <pre key={`code-${blocks.length}`}>
          {language ? <span>{language}</span> : null}
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1]?.length ?? 1;
      const content = renderInlineMarkdown(heading[2] ?? "", `h-${blocks.length}`);
      blocks.push(level === 1 ? <h3 key={`h-${blocks.length}`}>{content}</h3> : <h4 key={`h-${blocks.length}`}>{content}</h4>);
      index += 1;
      continue;
    }

    const table = parseMarkdownTable(lines, index, blocks.length);
    if (table) {
      blocks.push(table.node);
      index = table.nextIndex;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index] ?? "")) {
        const itemText = (lines[index] ?? "").replace(/^\s*[-*]\s+/, "");
        items.push(<li key={`li-${index}`}>{renderInlineMarkdown(itemText, `li-${index}`)}</li>);
        index += 1;
      }
      blocks.push(<ul key={`ul-${blocks.length}`}>{items}</ul>);
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index] ?? "")) {
        const itemText = (lines[index] ?? "").replace(/^\s*\d+[.)]\s+/, "");
        items.push(<li key={`oli-${index}`}>{renderInlineMarkdown(itemText, `oli-${index}`)}</li>);
        index += 1;
      }
      blocks.push(<ol key={`ol-${blocks.length}`}>{items}</ol>);
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length &&
      (lines[index] ?? "").trim() &&
      !/^```/.test(lines[index] ?? "") &&
      !/^(#{1,3})\s+/.test(lines[index] ?? "") &&
      !isHorizontalRule(lines[index] ?? "") &&
      !isTableStart(lines, index) &&
      !/^\s*[-*]\s+/.test(lines[index] ?? "") &&
      !/^\s*\d+[.)]\s+/.test(lines[index] ?? "")
    ) {
      paragraph.push((lines[index] ?? "").trim());
      index += 1;
    }
    blocks.push(<p key={`p-${blocks.length}`}>{renderInlineMarkdown(paragraph.join(" "), `p-${blocks.length}`)}</p>);
  }

  return blocks;
}

function normalizeMarkdownTables(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\|\s+(?=\|)/g, "|\n");
}

function isHorizontalRule(line: string) {
  return /^(?:-{3,}|\*{3,}|_{3,})$/.test(line.trim());
}

function isTableStart(lines: string[], index: number) {
  return isTableRow(lines[index] ?? "") && isTableSeparator(lines[index + 1] ?? "");
}

function parseMarkdownTable(lines: string[], start: number, blockIndex: number) {
  if (!isTableStart(lines, start)) return null;

  const headers = splitTableRow(lines[start] ?? "");
  const columnCount = headers.length;
  const rows: string[][] = [];
  let index = start + 2;

  while (index < lines.length && isTableRow(lines[index] ?? "")) {
    if (isTableSeparator(lines[index] ?? "")) break;
    rows.push(normalizeTableRow(splitTableRow(lines[index] ?? ""), columnCount));
    index += 1;
  }

  return {
    nextIndex: index,
    node: (
      <div className="messageTableWrap" key={`table-${blockIndex}`}>
        <table>
          <thead>
            <tr>
              {headers.map((header, cellIndex) => (
                <th key={`th-${cellIndex}`}>{renderInlineMarkdown(header, `table-${blockIndex}-h-${cellIndex}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={`tr-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td key={`td-${rowIndex}-${cellIndex}`}>{renderInlineMarkdown(cell, `table-${blockIndex}-${rowIndex}-${cellIndex}`)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
  };
}

function isTableRow(line: string) {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.slice(1, -1).includes("|");
}

function isTableSeparator(line: string) {
  if (!isTableRow(line)) return false;
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, "")));
}

function splitTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function normalizeTableRow(row: string[], columnCount: number) {
  return Array.from({ length: columnCount }, (_, index) => row[index] ?? "");
}

function renderInlineMarkdown(text: string, keyPrefix: string) {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;
    if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
      nodes.push(
        <a key={key} href={link?.[2]} target="_blank" rel="noreferrer">
          {link?.[1] ?? token}
        </a>,
      );
    }
    cursor = match.index + token.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes.map((node, index) => <Fragment key={`${keyPrefix}-frag-${index}`}>{node}</Fragment>);
}

function InlineSurface({ surface, onAction }: { surface: SurfaceSpec; onAction: SurfaceActionHandler }) {
  if (surface.layout.kind !== "media-player") {
    return (
      <div className="inlineGeneratedSurface">
        <SurfaceRenderer surface={surface} onAction={onAction} />
      </div>
    );
  }
  return <InlineMediaPlayer node={surface.layout} />;
}

function InlineMediaPlayer({ node }: { node: MediaPlayerNode }) {
  const Icon = node.media === "music" ? Music : Video;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [localMedia, setLocalMedia] = useState<{ url: string; name: string; mimeType: string } | null>(null);
  const activeSrc = localMedia?.url ?? resolveMediaSrc(node.src);
  const activeMimeType = localMedia?.mimeType || node.mimeType;
  const playable = Boolean(activeSrc || node.embedUrl);

  useEffect(
    () => () => {
      if (localMedia?.url) URL.revokeObjectURL(localMedia.url);
    },
    [localMedia?.url],
  );

  function chooseLocalFile(file?: File) {
    if (!file) return;
    setLocalMedia((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return {
        url: URL.createObjectURL(file),
        name: file.name,
        mimeType: file.type,
      };
    });
  }

  return (
    <section className={`inlineMediaPlayer media-${node.media} status-${node.status ?? "ready"}`}>
      <div className="inlineMediaHeader">
        <Icon size={18} />
        <div>
          <strong>{node.title}</strong>
          {localMedia ? <small>本地文件：{localMedia.name}</small> : node.subtitle ? <small>{node.subtitle}</small> : null}
        </div>
        {node.sourceUrl ? (
          <a href={node.sourceUrl} target="_blank" rel="noreferrer" aria-label="打开媒体来源" title="打开来源">
            <ExternalLink size={16} />
          </a>
        ) : null}
      </div>

      {activeSrc && node.media === "music" ? (
        <audio controls preload="metadata" src={activeSrc}>
          {activeMimeType ? <source src={activeSrc} type={activeMimeType} /> : null}
        </audio>
      ) : null}

      {activeSrc && node.media === "video" ? (
        <video
          autoPlay
          muted
          playsInline
          controls
          poster={node.thumbnailUrl}
          preload="auto"
          src={activeSrc}
          onLoadedMetadata={(event) => prepareVideoPreview(event.currentTarget)}
          onCanPlay={(event) => void event.currentTarget.play().catch(() => undefined)}
        >
          {activeMimeType ? <source src={activeSrc} type={activeMimeType} /> : null}
        </video>
      ) : null}

      {node.embedUrl ? (
        <iframe
          src={node.embedUrl}
          title={node.title}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
        />
      ) : null}

      {!playable ? (
        <div className="inlineMediaEmpty">
          <Volume2 size={18} />
          <span>{node.status === "external-only" ? "该来源需要在外部打开，也可以选择本地文件。" : "选择本地文件，或发送一个可播放链接。"}</span>
          <button type="button" onClick={() => fileInputRef.current?.click()}>
            选择文件
          </button>
        </div>
      ) : null}
      <input
        className="visuallyHidden"
        ref={fileInputRef}
        type="file"
        accept={node.media === "music" ? "audio/*" : "video/*"}
        onChange={(event) => chooseLocalFile(event.currentTarget.files?.[0])}
      />
    </section>
  );
}

function resolveMediaSrc(src?: string) {
  if (!src?.startsWith("pet-local-file://")) return src;
  try {
    const url = new URL(src);
    const filePath = decodeURIComponent(url.pathname);
    return isTauri() ? `${convertFileSrc(filePath)}${url.hash}` : src;
  } catch {
    return src;
  }
}

function prepareVideoPreview(video: HTMLVideoElement) {
  if (Number.isFinite(video.duration) && video.duration > 45 && video.currentTime < 1) {
    video.currentTime = 30;
  }
  void video.play().catch(() => undefined);
}

function preferredRecordingMimeType() {
  const candidates = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  return candidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
}

async function convertRecordingToWavDataUrl(blob: Blob) {
  const WebAudioContext =
    window.AudioContext ??
    (window as Window & {
      webkitAudioContext?: typeof AudioContext;
    }).webkitAudioContext;
  if (!WebAudioContext) throw new Error("Audio conversion is unavailable.");

  const context = new WebAudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    return blobToDataUrl(new Blob([encodeMonoWav(decoded)], { type: "audio/wav" }));
  } finally {
    await context.close().catch(() => undefined);
  }
}

function encodeMonoWav(buffer: AudioBuffer) {
  const output = new ArrayBuffer(44 + buffer.length * 2);
  const view = new DataView(output);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, output.byteLength - 8, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, buffer.length * 2, true);

  for (let index = 0; index < buffer.length; index += 1) {
    let sample = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      sample += buffer.getChannelData(channel)[index] ?? 0;
    }
    sample /= buffer.numberOfChannels;
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return output;
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to encode audio."));
      }
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Failed to encode audio.")));
    reader.readAsDataURL(blob);
  });
}

function base64AudioBlob(audioData: string, mimeType: string) {
  const raw = window.atob(audioData);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

function isVoiceProviderRequiredError(error: unknown) {
  return error instanceof Error && /api key|provider_unavailable|语音配置/i.test(error.message);
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

type BrowserSpeechRecognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
};

type BrowserSpeechRecognitionResult = ArrayLike<{ transcript: string }> & {
  isFinal: boolean;
};

type BrowserSpeechRecognitionEvent = {
  results: ArrayLike<BrowserSpeechRecognitionResult>;
};

function getSpeechRecognition(): BrowserSpeechRecognitionConstructor | null {
  const win = window as Window & {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}
