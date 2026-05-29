import { ExternalLink, Mic, Music, Send, Square, Video, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ChatMessage, ChatSendPayload, MediaPlayerNode, SurfaceSpec, VoiceSpeakPayload, VoiceTranscribePayload } from "@pet/protocol";
import { starterPrompts } from "../../config/starterPrompts";

type ChatPanelProps = {
  messages: ChatMessage[];
  draft: string;
  draftSurface?: SurfaceSpec | null;
  petName: string;
  onSend: (text: string) => unknown | Promise<unknown>;
  onSendVoice: (text: string) => Promise<ChatSendPayload | undefined>;
  onTranscribe: (audioData: string) => Promise<VoiceTranscribePayload>;
  onSpeak: (text: string) => Promise<VoiceSpeakPayload>;
};

type VoicePhase = "idle" | "recording" | "transcribing" | "synthesizing" | "playing" | "error";

export function ChatPanel({ messages, draft, draftSurface, petName, onSend, onSendVoice, onTranscribe, onSpeak }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [voiceNotice, setVoiceNotice] = useState("点击麦克风开始语音对话；优先使用小米 MiMo 语音模型。");
  const [pendingVoiceRunId, setPendingVoiceRunId] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingTimeoutRef = useRef<number | null>(null);
  const discardRecordingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

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

  return (
    <section className="chatPanel" aria-label="对话">
      <div className="messageList">
        {messages.map((message) => (
          <article className={`message ${message.role}`} key={message.id}>
            <span>{message.role === "user" ? "你" : petName}</span>
            <p>{message.content}</p>
            {message.surface ? <InlineSurface surface={message.surface} /> : null}
          </article>
        ))}
        {draft || draftSurface ? (
          <article className="message assistant streaming">
            <span>{petName}</span>
            {draft ? <p>{draft}</p> : null}
            {draftSurface ? <InlineSurface surface={draftSurface} /> : null}
          </article>
        ) : null}
      </div>

      <div className="starterRow">
        {starterPrompts.map((prompt) => (
          <button type="button" key={prompt} onClick={() => void send(prompt)}>
            {prompt}
          </button>
        ))}
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
        <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="输入问题，或点击麦克风直接对话" />
        <button className="iconButton primary" type="submit" aria-label="发送消息">
          <Send size={18} />
        </button>
      </form>
      <p className={`voiceStatus ${phase}`} aria-live="polite">
        {voiceNotice}
      </p>
    </section>
  );

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

function InlineSurface({ surface }: { surface: SurfaceSpec }) {
  if (surface.layout.kind !== "media-player") return null;
  return <InlineMediaPlayer node={surface.layout} />;
}

function InlineMediaPlayer({ node }: { node: MediaPlayerNode }) {
  const Icon = node.media === "music" ? Music : Video;
  const playable = Boolean(node.src || node.embedUrl);
  return (
    <section className={`inlineMediaPlayer media-${node.media} status-${node.status ?? "ready"}`}>
      <div className="inlineMediaHeader">
        <Icon size={18} />
        <div>
          <strong>{node.title}</strong>
          {node.subtitle ? <small>{node.subtitle}</small> : null}
        </div>
        {node.sourceUrl ? (
          <a href={node.sourceUrl} target="_blank" rel="noreferrer" aria-label="打开媒体来源" title="打开来源">
            <ExternalLink size={16} />
          </a>
        ) : null}
      </div>

      {node.src && node.media === "music" ? (
        <audio controls src={node.src}>
          {node.mimeType ? <source src={node.src} type={node.mimeType} /> : null}
        </audio>
      ) : null}

      {node.src && node.media === "video" ? (
        <video controls poster={node.thumbnailUrl} src={node.src}>
          {node.mimeType ? <source src={node.src} type={node.mimeType} /> : null}
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
          <span>{node.status === "external-only" ? "该来源需要在外部打开" : "等待可播放链接"}</span>
        </div>
      ) : null}
    </section>
  );
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
